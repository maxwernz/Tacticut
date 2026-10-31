import { it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { exportSchema, renderExport } from "../electron/export";
import { ffmpeg, run, sourceFromPath, probe } from "../electron/media";
import { newAnalysis } from "../src/domain";

it("exports original coaching holds once followed by bounded silent slow-motion replays", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tacticut-replay-test-"));
  try {
    const input = join(dir, "input.mp4");
    await run(ffmpeg, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x203040:s=320x180:r=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "3",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      input,
    ]);
    const a = newAnalysis();
    a.source_videos.push(await sourceFromPath(input));
    a.clips.push({
      id: crypto.randomUUID(),
      source_video_id: a.source_videos[0].id,
      name: "Wing shot",
      start_ms: 500,
      end_ms: 1500,
      notes: "",
      category_id: null,
      creation_order: 0,
      handball: {
        team: "Home",
        player: "7 Meyer",
        goalkeeper: "12 Keeper",
        phase: "fast-break",
        outcome: "saved",
      },
    });
    a.freeze_frames.push({
      id: crypto.randomUUID(),
      clip_id: a.clips[0].id,
      time_ms: 750,
      hold_ms: 500,
      shapes: [
        {
          id: crypto.randomUUID(),
          kind: "arrow",
          x1: 0.2,
          x2: 0.8,
          y1: 0.5,
          y2: 0.5,
          color: "#FACC15",
          width: 0.01,
        },
      ],
    });
    const data = { analysis: a, path: null, stamp: null };
    const options = {
      ids: [a.clips[0].id],
      title: false,
      categories: false,
      notes: false,
      numbers: false,
      audio: true,
      height: 720,
      encoder: "software" as const,
      replay: true,
    };
    const render = async (name: string, extra: object) => {
      const output = join(dir, name);
      await renderExport(
        data,
        { ...options, ...extra },
        output,
        resolve("public/fonts/NotoSans.ttf"),
        new AbortController().signal,
        () => {},
      );
      return output;
    };
    const half = await render("half.mp4", { replaySpeed: 0.5 });
    const halfInfo = await probe(half);
    expect(halfInfo.duration_ms).toBeGreaterThanOrEqual(3450);
    expect(halfInfo.duration_ms).toBeLessThan(3700);
    expect(halfInfo.audio).toBe(true);
    async function audioEnergy(output: string, time: number) {
      const pcm = join(dir, `${crypto.randomUUID()}.pcm`);
      await run(ffmpeg, [
        "-v",
        "error",
        "-ss",
        String(time),
        "-i",
        output,
        "-t",
        "0.15",
        "-map",
        "0:a:0",
        "-ac",
        "1",
        "-ar",
        "8000",
        "-f",
        "s16le",
        pcm,
      ]);
      const bytes = await readFile(pcm);
      expect(bytes.length).toBeGreaterThan(1000);
      let energy = 0;
      for (let i = 0; i < bytes.length; i += 2)
        energy += bytes.readInt16LE(i) ** 2;
      return Math.sqrt(energy / (bytes.length / 2));
    }
    expect(await audioEnergy(half, 0.05)).toBeGreaterThan(100);
    expect(await audioEnergy(half, 0.4)).toBeLessThan(20);
    expect(await audioEnergy(half, 1.85)).toBeLessThan(20);
    async function pixel(time: number) {
      const out = join(dir, `${crypto.randomUUID()}.rgb`);
      await run(ffmpeg, [
        "-v",
        "error",
        "-ss",
        String(time),
        "-i",
        half,
        "-vf",
        "crop=2:2:640:360,scale=1:1",
        "-frames:v",
        "1",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        out,
      ]);
      return readFile(out);
    }
    expect((await pixel(0.4))[0]).toBeGreaterThan(180); // Saved coaching arrow.
    expect((await pixel(2.0))[0]).toBeLessThan(100); // Raw replay without the hold/drawing.
    const quarter = await render("quarter.mp4", {
      replaySpeed: 0.25,
      annotations: false,
      audio: false,
    });
    expect((await probe(quarter)).duration_ms).toBeGreaterThanOrEqual(4950);
    expect((await probe(quarter)).duration_ms).toBeLessThan(5200);
    expect((await probe(quarter)).audio).toBe(false);
    // Handball information produces a coaching card even with notes disabled/blank.
    const card = await render("card.mp4", {
      replay: false,
      annotations: false,
      handball: true,
      audio: false,
    });
    expect((await probe(card)).duration_ms).toBeGreaterThanOrEqual(2950);
    expect((await probe(card)).duration_ms).toBeLessThan(3200);
    // Source videos without audio still get a consistent silent output stream.
    const silentInput = join(dir, "silent-input.mp4");
    await run(ffmpeg, [
      "-v",
      "error",
      "-i",
      input,
      "-an",
      "-c:v",
      "copy",
      silentInput,
    ]);
    a.source_videos.push(await sourceFromPath(silentInput));
    a.clips[0].source_video_id = a.source_videos[1].id;
    const silent = await render("silent-source.mp4", {
      annotations: false,
      replaySpeed: 0.5,
      audio: true,
    });
    expect((await probe(silent)).audio).toBe(true);
    expect((await probe(silent)).duration_ms).toBeGreaterThanOrEqual(2950);
    expect((await probe(silent)).duration_ms).toBeLessThan(3200);
    expect(await audioEnergy(silent, 0.1)).toBeLessThan(20);
    expect(await audioEnergy(silent, 1.4)).toBeLessThan(20);
    await run(ffmpeg, ["-v", "error", "-i", half, "-f", "null", "-"]);
    await run(ffmpeg, ["-v", "error", "-i", quarter, "-f", "null", "-"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 120000);

it("defaults to the original presentation and rejects unsupported replay speeds", () => {
  const options = {
    ids: ["clip"],
    title: false,
    categories: false,
    notes: false,
    numbers: false,
    audio: false,
    height: 720,
    encoder: "software",
  };
  expect(exportSchema.parse(options)).toMatchObject({
    replay: false,
    replaySpeed: 0.5,
    handball: false,
  });
  for (const replaySpeed of [0, -1, 0.1, 1, 8, Infinity])
    expect(exportSchema.safeParse({ ...options, replaySpeed }).success).toBe(
      false,
    );
});
