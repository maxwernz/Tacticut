import { tFor, type Language } from "../src/i18n";
import { BrowserWindow, dialog } from "electron";
import { randomUUID } from "node:crypto";
import { open, rename, realpath, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { analysisSchema, type Analysis } from "../src/domain";
import { buildHandballReport, reportCsv, reportHtml } from "../src/reports";

/** Build from validated data and explicit clip IDs; the renderer supplies no HTML. */
export async function saveReport(
  owner: BrowserWindow,
  analysis: Analysis,
  ids: string[],
  format: "pdf" | "csv",
  documentPath: string | null = null,
  language: Language = "en",
): Promise<string | null> {
  const t = (source: string) => tFor(language, source);
  if (format !== "pdf" && format !== "csv")
    throw new Error("Unknown report format");
  const validated = analysisSchema.parse(analysis);
  const model = buildHandballReport(validated, ids);
  const name = (
    model.title.replace(/[\\/:*?"<>|\x00-\x1f]/g, " ").trim() ||
    "Handball analysis"
  ).slice(0, 100);
  const result = await dialog.showSaveDialog(owner, {
    title: format === "pdf" ? t("Save shooting report") : t("Export clip data"),
    defaultPath: `${name}.${format}`,
    filters: [
      {
        name: format === "pdf" ? t("PDF shooting report") : t("CSV clip data"),
        extensions: [format],
      },
    ],
  });
  if (result.canceled || !result.filePath) return null;
  const canonical = async (path: string) => {
    const actual = await realpath(path).catch(() => resolve(path));
    return process.platform === "win32" ? actual.toLowerCase() : actual;
  };
  const destination = await canonical(result.filePath);
  if (documentPath && destination === (await canonical(documentPath)))
    throw new Error("Cannot overwrite the Analysis with a report");
  for (const source of validated.source_videos) {
    const candidates = [source.location];
    if (documentPath && source.relative_path)
      candidates.push(
        resolve(
          dirname(documentPath),
          source.relative_path.replaceAll("\\", "/"),
        ),
      );
    for (const path of candidates)
      if (destination === (await canonical(path)))
        throw new Error("Cannot overwrite a Source video with a report");
  }
  const partial = join(
    dirname(result.filePath),
    `.${basename(result.filePath)}.${randomUUID()}.tmp`,
  );
  let content: Buffer;
  if (format === "csv")
    content = Buffer.from(reportCsv(model, language), "utf8");
  else {
    const view = new BrowserWindow({
      show: false,
      width: 800,
      height: 1000,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: false,
        webSecurity: true,
      },
    });
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("will-navigate", (event) => event.preventDefault());
    try {
      await view.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(reportHtml(model, language))}`,
      );
      content = await view.webContents.printToPDF({
        pageSize: "A4",
        printBackground: true,
        preferCSSPageSize: true,
      });
    } finally {
      view.destroy();
    }
  }
  try {
    const file = await open(partial, "wx");
    try {
      await file.writeFile(content);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(partial, result.filePath);
    return result.filePath;
  } finally {
    await unlink(partial).catch(() => {});
  }
}
