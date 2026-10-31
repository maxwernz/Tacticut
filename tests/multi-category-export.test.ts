import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { it, expect } from "vitest";
import { newAnalysis, withClipCategories } from "../src/domain";
import { renderExport } from "../electron/export";
import { ffmpeg, run, sourceFromPath, probe } from "../electron/media";
it("renders a new category card when additional tags change under the same primary", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tacticut-multi-category-export-"));
  try {
    const input = join(dir, "input.mp4"),
      output = join(dir, "output.mp4");
    await run(ffmpeg, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x203040:s=320x180:r=25",
      "-t",
      "2",
      "-c:v",
      "libx264",
      input,
    ]);
    const a = newAnalysis();
    a.source_videos.push(await sourceFromPath(input));
    for (const secondary of [1, 2])
      a.clips.push(
        withClipCategories(
          {
            id: crypto.randomUUID(),
            source_video_id: a.source_videos[0].id,
            name: "Shot",
            start_ms: 0,
            end_ms: 1000,
            notes: "",
            category_id: null,
            creation_order: a.clips.length,
          },
          [a.categories[0].id, a.categories[secondary].id],
        ),
      );
    await renderExport(
      { analysis: a, path: null, stamp: null },
      {
        ids: a.clips.map((c) => c.id),
        title: false,
        categories: true,
        notes: false,
        numbers: false,
        audio: false,
        encoder: "software",
        height: 720,
      },
      output,
      resolve("public/fonts/NotoSans.ttf"),
      new AbortController().signal,
      () => {},
    );
    const info = await probe(output);
    expect(info.duration_ms).toBeGreaterThanOrEqual(4900);
    expect(info.duration_ms).toBeLessThan(5200);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 60000);
