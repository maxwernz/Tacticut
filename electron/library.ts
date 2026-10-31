import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { z } from "zod";
import type { Loaded, ProjectEntry } from "../src/api";
import { combineProjects } from "../src/collections";
import { atomicWrite, load, resolveSource } from "./files";

const entrySchema = z.object({
  path: z.string().min(1),
  title: z.string(),
  clips: z.number().int().nonnegative(),
  videos: z.number().int().nonnegative(),
  lastOpened: z.string(),
});
const entriesSchema = z.array(entrySchema).max(100);

/** Device-local index only. All project content stays in its original project file. */
export class ProjectLibraryStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly indexPath: string) {}
  private async read() {
    try {
      return entriesSchema.parse(
        JSON.parse(await readFile(this.indexPath, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error(
        "The recent-project index could not be read. Your project files have not been changed.",
      );
    }
  }
  private async canonical(path: string) {
    const actual = await realpath(path).catch(async () =>
      resolve(
        await realpath(dirname(path)).catch(() => dirname(resolve(path))),
        basename(path),
      ),
    );
    return actual;
  }
  /** Windows paths are case-insensitive: compare them that way, but keep the real spelling. */
  private same(a: string, b: string) {
    return process.platform === "win32"
      ? a.toLowerCase() === b.toLowerCase()
      : a === b;
  }
  private update(
    change: (
      entries: z.infer<typeof entrySchema>[],
    ) => z.infer<typeof entrySchema>[],
  ) {
    const job = this.queue
      .catch(() => {})
      .then(async () => {
        const entries = change(await this.read());
        await atomicWrite(this.indexPath, JSON.stringify(entries));
      });
    this.queue = job;
    return job;
  }
  async remember(data: Loaded) {
    if (!data.path) return;
    const path = await this.canonical(data.path);
    const entry = {
      path,
      title: data.analysis.title || basename(path).replace(/\.(tcut|analysis)$/i, ""),
      clips: data.analysis.clips.length,
      videos: data.analysis.source_videos.length,
      lastOpened: new Date().toISOString(),
    };
    await this.update((entries) =>
      [entry, ...entries.filter((item) => !this.same(item.path, path))].slice(
        0,
        100,
      ),
    );
  }
  async list(): Promise<ProjectEntry[]> {
    await this.queue.catch(() => {});
    return Promise.all(
      (await this.read()).map(async (entry) => ({
        ...entry,
        missing: !(await stat(entry.path)
          .then((info) => info.isFile())
          .catch(() => false)),
      })),
    );
  }
  async forget(path: string) {
    const canonical = await this.canonical(path);
    await this.update((entries) =>
      entries.filter((item) => !this.same(item.path, canonical)),
    );
  }
  private async knownPath(path: string) {
    const canonical = await this.canonical(path);
    if (!(await this.read()).some((entry) => this.same(entry.path, canonical)))
      throw new Error(
        "Choose a project from the library, or add it with Browse projects.",
      );
    return canonical;
  }
  async open(path: string): Promise<Loaded> {
    const known = await this.knownPath(path);
    let data: Loaded;
    try {
      data = await load(known);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new Error(
          "This project has moved or is missing. Use Browse projects to find it again.",
        );
      throw error;
    }
    await this.remember(data);
    return data;
  }
  async collection(paths: string[], title: string): Promise<Loaded> {
    const selected = z.array(z.string().min(1)).min(2).max(30).parse(paths);
    const canonical = await Promise.all(
      selected.map((path) => this.knownPath(path)),
    );
    const keys = canonical.map((path) =>
      process.platform === "win32" ? path.toLowerCase() : path,
    );
    if (new Set(keys).size !== keys.length)
      throw new Error("Choose each project only once.");
    const documents = await Promise.all(canonical.map((path) => load(path)));
    const availableRecordings = new Map<string, string>();
    for (const document of documents) {
      // Collections have no file yet; make every source independently resolvable.
      for (const source of document.analysis.source_videos) {
        const available = await resolveSource(source, document.path).catch(
          () => null,
        );
        if (available && source.fingerprint)
          availableRecordings.set(source.fingerprint, available);
        source.location =
          available ||
          (source.relative_path
            ? resolve(
                dirname(document.path!),
                source.relative_path.replaceAll("\\", "/"),
              )
            : source.location);
        source.relative_path = null;
      }
    }
    const combined = combineProjects(
      documents.map((document) => document.analysis),
      title,
    );
    for (const source of combined.source_videos) {
      const available =
        source.fingerprint && availableRecordings.get(source.fingerprint);
      if (available) source.location = available;
    }
    return {
      analysis: combined,
      path: null,
      stamp: null,
    };
  }
}
