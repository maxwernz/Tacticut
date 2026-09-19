import { it, expect } from "vitest";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { renderExport } from "../electron/export";
import { ffmpeg, run, sourceFromPath, probe } from "../electron/media";
import { newAnalysis, type Drawing } from "../src/domain";
it("exports aligned arrows/circles, adds a silent freeze, and can omit annotations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "va-annotation-export-"));
  try {
    const source = join(dir, "source.mp4");
    await run(ffmpeg, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x203040:s=320x240:r=25",
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
      source,
    ]);
    const a = newAnalysis();
    a.source_videos = [await sourceFromPath(source)];
    a.clips = [
      {
        id: crypto.randomUUID(),
        source_video_id: a.source_videos[0].id,
        name: "Coaching sequence",
        start_ms: 0,
        end_ms: 2000,
        notes: "",
        category_id: null,
        creation_order: 0,
      },
    ];
    const arrow: Drawing = {
      id: crypto.randomUUID(),
      kind: "arrow",
      x1: 0.2,
      y1: 0.5,
      x2: 0.8,
      y2: 0.5,
      color: "#FACC15",
      width: 0.01,
    };
    a.freeze_frames = [
      {
        id: crypto.randomUUID(),
        clip_id: a.clips[0].id,
        time_ms: 800,
        hold_ms: 1000,
        shapes: [
          arrow,
          {
            ...arrow,
            id: crypto.randomUUID(),
            kind: "circle",
            x1: 0.2,
            y1: 0.2,
            x2: 0.4,
            y2: 0.4,
          },
        ],
      },
    ];
    const options = {
      ids: [a.clips[0].id],
      title: false,
      categories: false,
      notes: false,
      numbers: false,
      audio: true,
      encoder: "software" as const,
      height: 720,
    };
    const output = join(dir, "annotated.mp4");
    await renderExport(
      { analysis: a, path: null, stamp: null },
      options,
      output,
      resolve("public/fonts/NotoSans.ttf"),
      new AbortController().signal,
      () => {},
    );
    const info = await probe(output);
    expect(info.duration_ms).toBeGreaterThanOrEqual(2950);
    expect(info.duration_ms).toBeLessThan(3250);
    expect(info.audio).toBe(true);
    const sample = async (path: string, time: number, x: number, y: number) => {
      const out = join(dir, `pixel-${crypto.randomUUID()}.rgb`);
      await run(ffmpeg, [
        "-v",
        "error",
        "-ss",
        String(time),
        "-i",
        path,
        "-vf",
        `crop=2:2:${x}:${y},scale=1:1`,
        "-frames:v",
        "1",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        out,
      ]);
      return readFile(out);
    };
    // 4:3 footage in a 16:9 export: the picture starts at x=160, not x=0.
    for (const [x, y] of [
      [640, 360],
      [448, 144],
    ]) {
      const pixel = await sample(output, 1.2, x, y);
      expect(pixel[0]).toBeGreaterThan(180);
      expect(pixel[1]).toBeGreaterThan(150);
      expect(pixel[2]).toBeLessThan(90);
    }
    const border = await sample(output, 1.2, 20, 360);
    expect(Math.max(...border)).toBeLessThan(20);
    const audio = join(dir, "hold.pcm");
    await run(ffmpeg, [
      "-v",
      "error",
      "-ss",
      "1.15",
      "-i",
      output,
      "-t",
      "0.2",
      "-map",
      "0:a:0",
      "-ac",
      "1",
      "-ar",
      "8000",
      "-f",
      "s16le",
      audio,
    ]);
    const bytes = await readFile(audio);
    let energy = 0;
    for (let i = 0; i < bytes.length; i += 2)
      energy += bytes.readInt16LE(i) ** 2;
    expect(Math.sqrt(energy / (bytes.length / 2))).toBeLessThan(20);
    const plain = join(dir, "plain.mp4");
    await renderExport(
      { analysis: a, path: null, stamp: null },
      { ...options, annotations: false },
      plain,
      resolve("public/fonts/NotoSans.ttf"),
      new AbortController().signal,
      () => {},
    );
    expect((await probe(plain)).duration_ms).toBeLessThan(2200);
    expect((await sample(plain, 1.2, 640, 360))[0]).toBeLessThan(100);
    if (process.env.ANNOTATION_VISUAL_CHECK) {
      await mkdir("test-results", { recursive: true });
      await run(ffmpeg, [
        "-v",
        "error",
        "-y",
        "-ss",
        "1.2",
        "-i",
        output,
        "-frames:v",
        "1",
        resolve("test-results/annotation-preview.png"),
      ]);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 120000);
