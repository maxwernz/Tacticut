import { it, expect } from "vitest";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { renderExport } from "../electron/export";
import { ffmpeg, run, sourceFromPath, probe } from "../electron/media";
import { newAnalysis, playlistClips } from "../src/domain";
it("renders real mixed-source video, notes, Category cards, numbers, and optional audio", async () => {
  const dir = await mkdtemp(join(tmpdir(), "va-render-test-"));
  try {
    const one = join(dir, "one.mp4"),
      two = join(dir, "two.mp4");
    await run(ffmpeg, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=320x180:r=25",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "2",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      one,
    ]);
    await run(ffmpeg, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=240x180:r=30",
      "-t",
      "2",
      "-c:v",
      "libx264",
      two,
    ]);
    const a = newAnalysis();
    a.title = "Test: 100% team’s match";
    a.source_videos = [await sourceFromPath(one), await sourceFromPath(two)];
    a.clips = a.source_videos.map((s, i) => ({
      id: crypto.randomUUID(),
      source_video_id: s.id,
      name: `Clip ${i}`,
      start_ms: 200,
      end_ms: 1200,
      notes: i ? "" : "A note: quotes ' and 100% ünicode",
      category_id: a.categories[i].id,
      creation_order: i,
    }));
    const output = join(dir, "out.mp4");
    const updates: number[] = [];
    await renderExport(
      { analysis: a, path: null, stamp: null },
      {
        ids: a.clips.map((c) => c.id),
        title: true,
        categories: true,
        notes: true,
        numbers: true,
        audio: true,
        encoder: "software",
        height: 720,
      },
      output,
      resolve("public/fonts/NotoSans.ttf"),
      new AbortController().signal,
      (p) => updates.push(p.percent),
    );
    const info = await probe(output);
    expect(info.duration_ms).toBeGreaterThanOrEqual(8400);
    expect(info.duration_ms).toBeLessThan(9000);
    expect(info.width).toBe(1280);
    expect(info.height).toBe(720);
    expect(info.audio).toBe(true);
    expect(updates.at(-1)).toBe(100);
    expect((await stat(output)).size).toBeGreaterThan(5000);
    await run(ffmpeg, ["-v", "error", "-i", output, "-f", "null", "-"]);
    const original = await readFile(output);
    // A coaching playlist deliberately reverses category/source order.
    a.playlists = [
      {
        id: crypto.randomUUID(),
        name: "Blue then red",
        clip_ids: [a.clips[1].id, a.clips[0].id],
      },
    ];
    const playlistOutput = join(dir, "playlist.mp4");
    await renderExport(
      { analysis: a, path: null, stamp: null },
      {
        ids: playlistClips(a, a.playlists[0]).map((c) => c.id),
        title: false,
        categories: false,
        notes: false,
        numbers: false,
        audio: false,
        encoder: "software",
        height: 720,
      },
      playlistOutput,
      resolve("public/fonts/NotoSans.ttf"),
      new AbortController().signal,
      () => {},
    );
    for (const [time, dominant] of [
      [0.3, 2],
      [1.3, 0],
    ] as const) {
      const pixel = join(dir, `pixel-${time}.rgb`);
      await run(ffmpeg, [
        "-v",
        "error",
        "-ss",
        String(time),
        "-i",
        playlistOutput,
        "-vf",
        "crop=2:2:640:360,scale=1:1",
        "-frames:v",
        "1",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        pixel,
      ]);
      const bytes = await readFile(pixel);
      expect(bytes[dominant]).toBeGreaterThan(180);
      expect(bytes[dominant === 0 ? 2 : 0]).toBeLessThan(70);
    }
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      renderExport(
        { analysis: a, path: null, stamp: null },
        {
          ids: a.clips.map((c) => c.id),
          title: false,
          categories: false,
          notes: false,
          numbers: false,
          audio: false,
          encoder: "software",
          height: 720,
        },
        output,
        resolve("public/fonts/NotoSans.ttf"),
        cancelled.signal,
        () => {},
      ),
    ).rejects.toThrow(/cancel/i);
    expect(await readFile(output)).toEqual(original);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 120000);
