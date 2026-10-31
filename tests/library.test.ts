import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectLibraryStore } from "../electron/library";
import { encode, newAnalysis } from "../src/domain";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "tacticut-library-"));
  dirs.push(dir);
  const library = new ProjectLibraryStore(join(dir, "projects.json"));
  async function project(name: string) {
    const analysis = newAnalysis();
    analysis.title = name;
    analysis.source_videos = [
      {
        id: crypto.randomUUID(),
        display_name: name,
        location: `/missing/${name}.mp4`,
        relative_path: `${name}.mp4`,
        duration_ms: 10000,
        byte_size: 10,
        fingerprint: name,
      },
    ];
    const path = join(dir, `${name}.analysis`);
    await writeFile(path, encode(analysis));
    const data = { analysis, path, stamp: null };
    await library.remember(data);
    return data;
  }
  return { dir, library, project };
}
it("persists recent projects without duplicates, serializes concurrent changes and reports missing files", async () => {
  const { dir, library, project } = await setup();
  const a = await project("One"),
    b = await project("Two");
  await Promise.all([
    library.remember(a),
    library.remember(b),
    library.remember(a),
  ]);
  expect(await library.list()).toHaveLength(2);
  await library.remember(a);
  const reopened = new ProjectLibraryStore(join(dir, "projects.json"));
  expect((await reopened.list())[0].title).toBe("One");
  await rm(a.path);
  expect((await reopened.list())[0].missing).toBe(true);
  await expect(reopened.open(a.path)).rejects.toThrow(/moved or is missing/);
  await reopened.forget(a.path);
  expect(await readFile(b.path, "utf8")).toContain("Two");
  expect(await reopened.list()).toHaveLength(1);
});
it("builds an unsaved collection with rebased media paths and preserves original project bytes", async () => {
  const { dir, library, project } = await setup();
  const a = await project("One"),
    b = await project("Two");
  await writeFile(join(dir, "One.mp4"), "media");
  const before = await Promise.all(
    [a, b].map((data) => readFile(data.path, "utf8")),
  );
  const result = await library.collection([a.path, b.path], "Season");
  expect(result.path).toBeNull();
  expect(result.stamp).toBeNull();
  expect(
    result.analysis.source_videos.map((source) => source.location),
  ).toEqual([
    join(await realpath(dir), "One.mp4"),
    join(await realpath(dir), "Two.mp4"),
  ]);
  expect(
    result.analysis.source_videos.every(
      (source) => source.relative_path === null,
    ),
  ).toBe(true);
  expect(
    await Promise.all([a, b].map((data) => readFile(data.path, "utf8"))),
  ).toEqual(before);
  await expect(library.open(join(dir, "other.analysis"))).rejects.toThrow(
    /library/,
  );
  await expect(
    library.collection([a.path, a.path], "Duplicate"),
  ).rejects.toThrow(/only once/);
});
it("preserves a malformed index instead of overwriting it or changing projects", async () => {
  const { dir, library } = await setup();
  await writeFile(join(dir, "projects.json"), "broken index");
  await expect(library.list()).rejects.toThrow(/index could not be read/);
  expect(await readFile(join(dir, "projects.json"), "utf8")).toBe(
    "broken index",
  );
});
it("uses the available recording when another project references a missing copy of the same footage", async () => {
  const { dir, library, project } = await setup();
  const a = await project("One"),
    b = await project("Two");
  b.analysis.source_videos[0].fingerprint =
    a.analysis.source_videos[0].fingerprint;
  await writeFile(b.path, encode(b.analysis));
  await writeFile(join(dir, "Two.mp4"), "media");
  const merged = await library.collection([a.path, b.path], "Review");
  expect(merged.analysis.source_videos).toHaveLength(1);
  expect(merged.analysis.source_videos[0].location).toBe(
    join(await realpath(dir), "Two.mp4"),
  );
});
it("names untitled .tcut and .analysis projects after their file", async () => {
  const { dir, library } = await setup();
  for (const file of ["Match.tcut", "Old match.analysis"]) {
    const analysis = newAnalysis();
    analysis.title = "";
    const path = join(dir, file);
    await writeFile(path, "{}");
    await library.remember({ analysis, path, stamp: null });
  }
  expect((await library.list()).map((p) => p.title).sort()).toEqual([
    "Match",
    "Old match",
  ]);
});
