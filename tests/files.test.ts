import { it, expect, afterEach } from "vitest";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  atomicWrite,
  fingerprint,
  load,
  resolveSource,
  saveDocument,
  recoveryPayload,
} from "../electron/files";
import { newAnalysis } from "../src/domain";
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "va-files-test-"));
  dirs.push(dir);
  const media = join(dir, "match.mp4");
  await writeFile(media, Buffer.from("sample recording"));
  const a = newAnalysis();
  a.source_videos.push({
    id: crypto.randomUUID(),
    display_name: "Match",
    location: media,
    relative_path: null,
    duration_ms: 1000,
    ...(await fingerprint(media)),
  });
  return { dir, a, media };
}
it("saves compatible files atomically and refuses external changes", async () => {
  const { dir, a } = await setup();
  const path = join(dir, "match.analysis");
  const saved = await saveDocument(
    { analysis: a, path: null, stamp: null },
    path,
  );
  expect(saved.analysis.source_videos[0].relative_path).toBe("match.mp4");
  expect((await load(path)).analysis).toEqual(saved.analysis);
  await writeFile(path, "external edit");
  await expect(saveDocument(saved, path)).rejects.toThrow(/changed outside/);
  expect(await readFile(path, "utf8")).toBe("external edit");
});
it("resolves media moved alongside an Analysis and rebases Save As paths", async () => {
  const { dir, a } = await setup();
  a.source_videos[0].location = "/nonexistent/old/match.mp4";
  a.source_videos[0].relative_path = "match.mp4";
  expect(
    await resolveSource(a.source_videos[0], join(dir, "match.analysis")),
  ).toBe(join(dir, "match.mp4"));
  const saved = await saveDocument(
    { analysis: a, path: join(dir, "match.analysis"), stamp: null },
    join(dir, "sub", "copy.analysis"),
  );
  expect(saved.analysis.source_videos[0].relative_path).toBe("../match.mp4");
});
it("matches the Python sampled fingerprint algorithm", async () => {
  const { media } = await setup();
  const { createHash } = await import("node:crypto");
  const bytes = await readFile(media);
  expect((await fingerprint(media)).fingerprint).toBe(
    createHash("sha256")
      .update(String(bytes.length))
      .update(bytes)
      .update(bytes)
      .update(bytes)
      .digest("hex"),
  );
});
it("atomic writes create parent directories and replace complete contents", async () => {
  const { dir } = await setup();
  const path = join(dir, "nested", "snapshot");
  await atomicWrite(path, "first");
  await atomicWrite(path, "second");
  expect(await readFile(path, "utf8")).toBe("second");
});
it("preserves coaching playlists through atomic save, load and crash recovery", async () => {
  const { dir, a } = await setup();
  a.clips = [
    {
      id: crypto.randomUUID(),
      source_video_id: a.source_videos[0].id,
      name: "Review",
      start_ms: 0,
      end_ms: 1000,
      notes: "",
      category_id: null,
      creation_order: 0,
    },
  ];
  a.playlists = [
    {
      id: crypto.randomUUID(),
      name: "Team meeting",
      clip_ids: [a.clips[0].id],
    },
  ];
  const saved = await saveDocument(
    { analysis: a, path: null, stamp: null },
    join(dir, "playlists.analysis"),
  );
  expect(JSON.parse(await readFile(saved.path!, "utf8")).schema_version).toBe(
    2,
  );
  expect((await load(saved.path!)).analysis.playlists).toEqual(a.playlists);
  expect(
    recoveryPayload(JSON.parse(JSON.stringify(saved))).analysis.playlists,
  ).toEqual(a.playlists);
});
it("preserves freeze-frame drawings in files and recovery snapshots", async () => {
  const { dir, a } = await setup();
  a.clips = [
    {
      id: crypto.randomUUID(),
      source_video_id: a.source_videos[0].id,
      name: "Moment",
      start_ms: 0,
      end_ms: 1000,
      category_id: null,
      notes: "",
      creation_order: 0,
    },
  ];
  a.freeze_frames = [
    {
      id: crypto.randomUUID(),
      clip_id: a.clips[0].id,
      time_ms: 500,
      hold_ms: 2000,
      shapes: [
        {
          id: crypto.randomUUID(),
          kind: "circle",
          x1: 0.2,
          y1: 0.2,
          x2: 0.4,
          y2: 0.4,
          color: "#FFFFFF",
          width: 0.006,
        },
      ],
    },
  ];
  const saved = await saveDocument(
    { analysis: a, path: null, stamp: null },
    join(dir, "annotated.analysis"),
  );
  expect((await load(saved.path!)).analysis.freeze_frames).toEqual(
    a.freeze_frames,
  );
  expect(
    recoveryPayload(JSON.parse(JSON.stringify(saved))).analysis.freeze_frames,
  ).toEqual(a.freeze_frames);
});
