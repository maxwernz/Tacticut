import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { newAnalysis } from "../src/domain";
import {
  playerExportName,
  renderPlayerExports,
} from "../electron/playerExports";
import type { ExportOptions } from "../src/api";
const options: ExportOptions = {
  ids: [],
  title: true,
  categories: false,
  notes: false,
  numbers: false,
  audio: true,
  encoder: "software",
  height: 720,
};
it("queues exact player clips in unique folders and preserves completed jobs on cancellation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tacticut-player-test-"));
  try {
    const a = newAnalysis();
    a.source_videos = [
      {
        id: crypto.randomUUID(),
        display_name: "Match",
        location: "/match.mp4",
        relative_path: null,
        duration_ms: 10000,
        byte_size: null,
        fingerprint: null,
      },
    ];
    for (const player of ["Alex", "Bea", undefined])
      a.clips.push({
        id: crypto.randomUUID(),
        source_video_id: a.source_videos[0].id,
        name: "Shot",
        start_ms: 0,
        end_ms: 1000,
        notes: "",
        category_id: null,
        creation_order: a.clips.length,
        handball: player ? { team: "Home", player } : undefined,
      });
    const controller = new AbortController();
    const render = vi.fn(async (_data, settings) => {
      expect(settings.ids).toEqual([a.clips[0].id]);
      controller.abort();
    });
    const result = await renderPlayerExports(
      { analysis: a, path: null, stamp: null },
      { ...options, ids: a.clips.map((c) => c.id) },
      dir,
      "font",
      controller.signal,
      () => {},
      render,
    );
    expect(result).toMatchObject({ completed: 1, total: 2, cancelled: true });
    expect(
      JSON.parse(
        await readFile(join(result.directory, "review-index.json"), "utf8"),
      ),
    ).toMatchObject({
      status: "cancelled",
      completed: [{ clip_ids: [a.clips[0].id] }],
    });
    const next = await renderPlayerExports(
      { analysis: a, path: null, stamp: null },
      { ...options, ids: [a.clips[1].id] },
      dir,
      "font",
      new AbortController().signal,
      () => {},
      vi.fn(async () => {}),
    );
    expect(next.directory).not.toBe(result.directory);
    expect(await readdir(dir)).toHaveLength(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("uses bounded numbered filenames without path separators or collisions", () => {
  expect(playerExportName("../../bad:/name", 0)).toMatch(
    /^001 - [^/\\]+\.mp4$/,
  );
  expect(playerExportName("a", 1)).not.toBe(playerExportName("a", 0));
});
