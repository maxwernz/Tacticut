import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { annotationSvg } from "../src/annotations";
import type { FreezeFrame } from "../src/domain";
import { ffmpeg, run } from "./media";
/** Render only app-generated vector primitives over a decoded, square-pixel still. */
export async function renderFreezeFrame(
  source: string,
  frame: FreezeFrame,
  work: string,
  index: number,
  width: number,
  height: number,
  signal: AbortSignal,
) {
  const still = join(work, `freeze-${index}-source.png`),
    overlay = join(work, `freeze-${index}-overlay.png`),
    output = join(work, `freeze-${index}.png`);
  await run(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-ss",
      // Saved display-frame timestamps are rounded up to milliseconds.
      String(Math.max(0, frame.time_ms - 1) / 1000),
      "-i",
      source,
      "-frames:v",
      "1",
      "-an",
      "-vf",
      `scale=trunc(iw*sar/2)*2:ih,setsar=1,scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
      still,
    ],
    { signal },
  );
  const png = await readFile(still);
  const w = png.readUInt32BE(16),
    h = png.readUInt32BE(20);
  if (signal.aborted) throw new Error("Export cancelled");
  const renderer = new Resvg(annotationSvg(frame.shapes, w, h));
  await writeFile(overlay, renderer.render().asPng());
  await run(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-i",
      still,
      "-i",
      overlay,
      "-filter_complex",
      "[0:v][1:v]overlay=0:0:format=auto[v]",
      "-map",
      "[v]",
      "-frames:v",
      "1",
      output,
    ],
    { signal },
  );
  return output;
}
