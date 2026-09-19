import { app, BrowserWindow, dialog, ipcMain, Menu, protocol } from "electron";
import { createReadStream } from "node:fs";
import { readFile, stat, unlink } from "node:fs/promises";
import { join, extname } from "node:path";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  categorySchema,
  defaults,
  sourceSchema,
  type SourceVideo,
} from "../src/domain";
import {
  atomicWrite,
  load,
  recoveryPayload,
  resolveSource,
  saveDocument,
} from "./files";
import { children, playbackProxy, probe, sourceFromPath } from "./media";
import { exportSchema, renderExport } from "./export";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "media",
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
]);
if (process.env.VIDEO_ANALYSE_USER_DATA)
  app.setPath("userData", process.env.VIDEO_ANALYSE_USER_DATA);
let win: BrowserWindow;
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", () => {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
let dirty = false,
  approved = false;
let exporter: AbortController | null = null;
let recoveryQueue: Promise<unknown> = Promise.resolve();
const mediaPaths = new Map<string, string>();
const mediaTokens = new Map<string, string>();
const videoFilters = [
  {
    name: "Video",
    extensions: [
      "mp4",
      "mov",
      "m4v",
      "mkv",
      "avi",
      "webm",
      "mts",
      "m2ts",
      "wmv",
    ],
  },
];
const analysisFilters = [{ name: "Analysis", extensions: ["analysis"] }];
const recoveryPath = () => join(app.getPath("userData"), "recovery.json");
function queueRecovery(data: unknown) {
  const job = recoveryQueue
    .catch(() => {})
    .then(() =>
      data == null
        ? unlink(recoveryPath()).catch((e: NodeJS.ErrnoException) => {
            if (e.code !== "ENOENT") throw e;
          })
        : atomicWrite(recoveryPath(), JSON.stringify(recoveryPayload(data))),
    );
  recoveryQueue = job;
  return job;
}
function mediaURL(path: string) {
  let token = mediaTokens.get(path);
  if (!token) {
    token = randomUUID();
    mediaTokens.set(path, token);
    mediaPaths.set(token, path);
  }
  return `media://video/${token}`;
}
function registerIPC() {
  ipcMain.on("window-control", (event, action) => {
    if (
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    )
      return;
    if (action === "minimize") win.minimize();
    else if (action === "maximize")
      win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === "close") win.close();
  });
  const handle = (name: string, fn: (...args: any[]) => unknown) =>
    ipcMain.handle(name, (event, ...args) => {
      if (
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame
      )
        throw new Error("Untrusted request");
      return fn(...args);
    });
  handle("open", async () => {
    const result = await dialog.showOpenDialog(win, {
      filters: analysisFilters,
      properties: ["openFile"],
    });
    return result.canceled ? null : load(result.filePaths[0]);
  });
  handle("save", async (raw, as) => {
    const data = recoveryPayload(raw);
    let path = data.path;
    if (as || !path || data.legacyPath) {
      const result = await dialog.showSaveDialog(win, {
        filters: analysisFilters,
        defaultPath:
          (data.legacyPath
            ? `${data.analysis.title.replace(/[/\\:*?"<>|]/g, "_")} (converted).analysis`
            : path) ||
          `${data.analysis.title.replace(/[/\\:*?"<>|]/g, "_") || "Untitled"}.analysis`,
      });
      if (result.canceled || !result.filePath) return null;
      path = result.filePath.endsWith(".analysis")
        ? result.filePath
        : `${result.filePath}.analysis`;
    }
    return saveDocument(data, path);
  });
  handle("add-videos", async () => {
    const result = await dialog.showOpenDialog(win, {
      filters: videoFilters,
      properties: ["openFile", "multiSelections"],
    });
    const sources: SourceVideo[] = [];
    for (const path of result.filePaths)
      sources.push(await sourceFromPath(path));
    return sources;
  });
  handle("import-paths", async (raw) => {
    const paths = z.array(z.string().min(1)).max(100).parse(raw);
    const sources: SourceVideo[] = [];
    for (const path of paths) sources.push(await sourceFromPath(path));
    return sources;
  });
  handle("media", async (raw, documentPath, proxy) => {
    const source = sourceSchema.parse(raw);
    const original = await resolveSource(
      source,
      z.string().nullable().parse(documentPath),
    );
    const path = proxy
      ? await playbackProxy(
          original,
          join(app.getPath("userData"), "playback-cache"),
        )
      : original;
    return { ...(await probe(path)), path, url: mediaURL(path) };
  });
  handle("relink", async (raw) => {
    const source = sourceSchema.parse(raw);
    const result = await dialog.showOpenDialog(win, {
      title: `Relink ${source.display_name}`,
      filters: videoFilters,
      properties: ["openFile"],
    });
    if (result.canceled) return null;
    const replacement = await sourceFromPath(result.filePaths[0]);
    if (
      !source.fingerprint ||
      source.fingerprint !== replacement.fingerprint ||
      source.byte_size !== replacement.byte_size ||
      source.duration_ms !== replacement.duration_ms
    ) {
      const answer = await dialog.showMessageBox(win, {
        type: "warning",
        message: source.fingerprint
          ? "This is different footage."
          : "The original recording has no identity information.",
        detail:
          "Existing Clips will keep their timestamps. Replace this Source video anyway?",
        buttons: ["Cancel", "Replace Source video"],
        defaultId: 0,
        cancelId: 0,
      });
      if (answer.response !== 1) return null;
    }
    return { ...replacement, id: source.id, display_name: source.display_name };
  });
  handle("recovery", queueRecovery);
  handle("restore", async () => {
    try {
      return recoveryPayload(
        JSON.parse(await readFile(recoveryPath(), "utf8")),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error(
        "The recovery snapshot could not be read. It has been preserved on disk.",
      );
    }
  });
  handle("template", async (raw) => {
    const path = join(app.getPath("userData"), "category-template.json");
    if (raw !== undefined) {
      const categories = z.array(categorySchema).parse(raw);
      if (
        new Set(categories.map((c) => c.name.trim().toLowerCase())).size !==
        categories.length
      )
        throw new Error("Category names must be unique");
      await atomicWrite(path, JSON.stringify(categories));
      return categories;
    }
    try {
      return z
        .array(categorySchema)
        .parse(JSON.parse(await readFile(path, "utf8")));
    } catch {
      return defaults.map((c) => ({ ...c, id: randomUUID() }));
    }
  });
  handle("export", async (raw, rawOptions) => {
    if (exporter) throw new Error("An export is already running");
    const data = recoveryPayload(raw),
      options = exportSchema.parse(rawOptions);
    const result = await dialog.showSaveDialog(win, {
      title: "Combined export",
      defaultPath: `${data.analysis.title.replace(/[/\\:*?"<>|]/g, "_") || "Analysis"}.mp4`,
      filters: [{ name: "MP4 video", extensions: ["mp4"] }],
    });
    if (result.canceled || !result.filePath) return null;
    exporter = new AbortController();
    const output = result.filePath.endsWith(".mp4")
      ? result.filePath
      : `${result.filePath}.mp4`;
    try {
      await renderExport(
        data,
        options,
        output,
        join(
          app.getAppPath(),
          app.isPackaged
            ? "dist/fonts/NotoSans.ttf"
            : "public/fonts/NotoSans.ttf",
        ),
        exporter.signal,
        (progress) => {
          if (!win.isDestroyed()) win.webContents.send("progress", progress);
        },
      );
      return output;
    } finally {
      exporter = null;
    }
  });
  handle("cancel-export", () => exporter?.abort());
  ipcMain.on("dirty", (event, value) => {
    if (event.sender === win.webContents) {
      dirty = Boolean(value);
      win.setDocumentEdited(dirty);
    }
  });
  ipcMain.on("close-approved", (event) => {
    if (event.sender === win.webContents) {
      approved = true;
      win.close();
    }
  });
}
app.whenReady().then(async () => {
  protocol.handle("media", async (request) => {
    const path = mediaPaths.get(new URL(request.url).pathname.slice(1));
    if (!path) return new Response("Not found", { status: 404 });
    try {
      const { size } = await stat(path);
      const range = request.headers.get("range");
      let start = 0,
        end = size - 1;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2]))
          return new Response(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${size}` },
          });
        start = match[1]
          ? Number(match[1])
          : Math.max(0, size - Number(match[2]));
        end =
          match[1] && match[2]
            ? Math.min(Number(match[2]), size - 1)
            : size - 1;
        if (start > end || start >= size)
          return new Response(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${size}` },
          });
      }
      const types: Record<string, string> = {
        ".mp4": "video/mp4",
        ".mov": "video/quicktime",
        ".m4v": "video/mp4",
        ".webm": "video/webm",
        ".mkv": "video/x-matroska",
      };
      const headers: Record<string, string> = {
        "Content-Type":
          types[extname(path).toLowerCase()] || "application/octet-stream",
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
      };
      if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
      return new Response(
        request.method === "HEAD"
          ? null
          : (Readable.toWeb(
              createReadStream(path, { start, end }),
            ) as ReadableStream),
        { status: range ? 206 : 200, headers },
      );
    } catch {
      return new Response("Media unavailable", { status: 404 });
    }
  });
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: "#141619",
    title: "Video Analyse",
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 16, y: 17 },
    ...(process.platform !== "darwin" ? { frame: false } : {}),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  registerIPC();
  if (process.platform !== "darwin") win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  const command = (name: string) => () => win.webContents.send("command", name);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
      {
        label: "File",
        submenu: [
          {
            label: "New Analysis",
            accelerator: "CmdOrCtrl+N",
            click: command("new"),
          },
          {
            label: "Open Analysis…",
            accelerator: "CmdOrCtrl+O",
            click: command("open"),
          },
          {
            label: "Add Source videos…",
            accelerator: "CmdOrCtrl+Shift+V",
            click: command("add"),
          },
          { type: "separator" },
          { label: "Save", accelerator: "CmdOrCtrl+S", click: command("save") },
          {
            label: "Save As…",
            accelerator: "CmdOrCtrl+Shift+S",
            click: command("save-as"),
          },
          {
            label: "Combined export…",
            accelerator: "CmdOrCtrl+E",
            click: command("export"),
          },
          { type: "separator" },
          { role: "close" },
        ],
      },
      { role: "editMenu" },
      {
        label: "Analysis",
        submenu: [
          { label: "Manage Categories", click: command("categories") },
          { label: "Category template", click: command("template") },
        ],
      },
      {
        label: "View",
        submenu: [
          { role: "togglefullscreen" },
          ...(app.isPackaged ? [] : [{ role: "toggleDevTools" as const }]),
        ],
      },
    ]),
  );
  win.on("close", (event) => {
    if (!approved) {
      event.preventDefault();
      win.webContents.send("command", "close");
    }
  });
  if (process.env.VITE_DEV_SERVER_URL)
    await win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else await win.loadFile(join(__dirname, "../dist/index.html"));
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  for (const child of children) child.kill();
});
