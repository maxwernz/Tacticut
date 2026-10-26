import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  accessSync,
  constants,
  createWriteStream,
  existsSync,
  readdirSync,
} from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { BrowserWindow, app, shell } from "electron";
import { UPDATE_CHANNELS, type UpdateState } from "../../src/updates";
import { type Release, feedUrl, isNewer, readRelease } from "./feed";
import {
  SWAP,
  installable,
  installerArgs,
  stagingDir,
  stagingPrefix,
} from "./install";
import { PUBLISHER_KEY, verifyArchive } from "./signature";

const run = promisify(execFile);
const EVERY = 6 * 60 * 60 * 1000;

export interface UpdaterOptions {
  /** The GitHub repository releases are published to, as `owner/name`. */
  repo: string;
  /** Another URL to read the release from, for trying an update before it is published. */
  feed?: string;
  /** Registers an IPC handler that only answers the app's own window. */
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => void;
  /** Quit without asking again: the window has already let the user save. */
  quit: () => void;
}

/** What is put in place when the app quits. */
type Pending =
  | { kind: "bundle"; bundle: string; staged: string }
  | { kind: "installer"; installer: string };

/**
 * Keep Tacticut up to date: check now and then whether a newer build was
 * published, tell the window, and on request download it and check its
 * signature. The new build goes in when the app quits; `restart` quits and
 * reopens it. A development run never checks unless it is given a `feed`.
 */
export function startUpdater(options: UpdaterOptions): {
  /** Check now, for the menu item. What was found, or null when it could not tell. */
  checkNow: () => Promise<"available" | "current" | null>;
} {
  let state: UpdateState = { status: "none" };
  let found: Release | null = null;
  let pending: Pending | null = null;
  let relaunch = false;

  const here = () =>
    installable({
      platform: process.platform,
      isPackaged: app.isPackaged,
      exePath: app.getPath("exe"),
      writable: (dir) => {
        try {
          accessSync(dir, constants.W_OK);
          return true;
        } catch {
          return false;
        }
      },
    });

  const set = (next: UpdateState) => {
    state = next;
    for (const w of BrowserWindow.getAllWindows())
      w.webContents.send(UPDATE_CHANNELS.changed, state);
  };
  const busy = () =>
    state.status === "downloading" || state.status === "ready";

  const check = async (): Promise<"available" | "current" | null> => {
    if (busy()) return "available";
    try {
      const res = await fetch(options.feed ?? feedUrl(options.repo), {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": app.getName(),
        },
      });
      if (res.status === 404) return "current"; // nothing published yet
      if (!res.ok) return null; // rate-limited or down: try again later
      const release = readRelease(
        await res.json(),
        process.arch,
        process.platform,
      );
      if (!release || !isNewer(release.version, app.getVersion()))
        return "current";
      if (busy()) return "available";
      found = release;
      set({
        status: "available",
        version: release.version,
        notes: release.notes,
        page: release.page,
        canInstall: release.archive !== null && here().ok,
      });
      return "available";
    } catch {
      return null; // offline is not worth a word
    }
  };

  const install = async (): Promise<boolean> => {
    if (state.status === "ready") return true;
    const release = found;
    const target = here();
    if (!release?.archive || !target.ok || busy()) return false;
    const id = randomBytes(4).toString("hex");
    const stage =
      target.kind === "bundle"
        ? stagingDir(target.bundle, id)
        : join(app.getPath("temp"), `${app.getName()}-update-${id}`);
    try {
      set({ status: "downloading", version: release.version, progress: 0 });
      await mkdir(stage, { recursive: true });
      const archive = join(
        stage,
        target.kind === "bundle"
          ? "update.zip"
          : `${app.getName()} Setup ${release.version}.exe`,
      );
      await download(release.archive.url, archive, (progress) =>
        set({ status: "downloading", version: release.version, progress }),
      );
      const sig = await fetch(release.archive.signatureUrl);
      if (!sig.ok || !(await verifyArchive(archive, await sig.text())))
        throw new Error(
          "The download does not match the published build, so it was not installed.",
        );

      if (target.kind === "installer") {
        pending = { kind: "installer", installer: archive };
      } else {
        await run("/usr/bin/ditto", ["-x", "-k", archive, stage]);
        await rm(archive);
        const staged = join(stage, basename(target.bundle));
        if (!existsSync(staged))
          throw new Error(
            `The download holds ${readdirSync(stage).join(", ") || "nothing"}, not ${basename(target.bundle)}.`,
          );
        pending = { kind: "bundle", bundle: target.bundle, staged };
      }
      set({ status: "ready", version: release.version });
      return true;
    } catch (e) {
      await rm(stage, { recursive: true, force: true });
      set({
        status: "failed",
        version: release.version,
        message: (e as Error).message,
        page: release.page,
      });
      return false;
    }
  };

  // Put the new build in place as the app goes, however it was asked to quit.
  app.on("will-quit", () => {
    if (!pending) return;
    if (pending.kind === "installer")
      spawn(pending.installer, installerArgs(relaunch), {
        detached: true,
        stdio: "ignore",
      }).unref();
    else
      spawn(
        "/bin/sh",
        [
          "-c",
          SWAP,
          "sh",
          String(process.pid),
          pending.bundle,
          pending.staged,
          relaunch ? "1" : "0",
        ],
        { detached: true, stdio: "ignore" },
      ).unref();
    pending = null;
  });

  options.handle(UPDATE_CHANNELS.state, () => state);
  options.handle(UPDATE_CHANNELS.install, () => install());
  options.handle(UPDATE_CHANNELS.restart, () => {
    if (!pending) return;
    relaunch = true;
    options.quit();
  });
  options.handle(UPDATE_CHANNELS.openPage, async () => {
    const page =
      state.status === "available" || state.status === "failed"
        ? state.page
        : "";
    if (page.startsWith("https://")) await shell.openExternal(page);
  });

  if (app.isPackaged || options.feed) {
    void removeLeftovers(here());
    setTimeout(() => void check(), 4000);
    setInterval(() => void check(), EVERY);
  }
  return { checkNow: check };
}

/** Staging folders from an update that never finished, for example after a crash. */
async function removeLeftovers(target: ReturnType<typeof installable>) {
  if (!target.ok || target.kind !== "bundle") return;
  const prefix = stagingPrefix(target.bundle);
  try {
    for (const name of readdirSync(dirname(target.bundle)))
      if (name.startsWith(prefix))
        await rm(join(dirname(target.bundle), name), {
          recursive: true,
          force: true,
        });
  } catch {
    /* cleaning up is best effort */
  }
}

async function download(
  url: string,
  to: string,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body)
    throw new Error(`The update could not be downloaded (${res.status}).`);
  const total = Number(res.headers.get("content-length") ?? 0);
  const out = createWriteStream(to);
  let got = 0;
  let told = 0;
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      if (!out.write(chunk))
        await new Promise<void>((r) => out.once("drain", () => r()));
      got += chunk.length;
      if (total > 0 && got / total - told >= 0.02)
        onProgress((told = got / total));
    }
  } finally {
    await new Promise<void>((r) => out.end(() => r()));
  }
}
