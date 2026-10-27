// FFmpeg work for the MCP server: probing, contact sheets, cutting and downloading.
// Sources can be local files or the portal's MP4 address; FFmpeg then fetches only
// the byte ranges it needs.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { videoClock } from "./timeline.mts";

const require = createRequire(import.meta.url);
export const ffmpeg: string = process.env.VIDEO_ANALYSE_FFMPEG || require("ffmpeg-static");
export const ffprobe: string =
  process.env.VIDEO_ANALYSE_FFPROBE || require("@ffprobe-installer/ffprobe").path;
const font = resolve(import.meta.dirname, "../public/fonts/NotoSans.ttf");

export function run(binary: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((done, fail) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], signal });
    let out = "";
    let err = "";
    child.stdout.on("data", (c: Buffer) => (out += c));
    child.stderr.on("data", (c: Buffer) => (err = (err + c).slice(-4000)));
    child.on("error", fail);
    child.on("close", (code) =>
      code === 0 ? done(out) : fail(new Error(err.trim() || `${binary} exited with ${code}`)),
    );
  });
}

export type Probe = { duration: number; width: number; height: number; audio: boolean };

export async function probe(source: string): Promise<Probe> {
  const json = JSON.parse(
    await run(ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", source]),
  ) as { format: { duration: string }; streams: { codec_type: string; width?: number; height?: number }[] };
  const video = json.streams.find((s) => s.codec_type === "video");
  if (!video) throw new Error("The source has no video stream");
  return {
    duration: Number(json.format.duration),
    width: video.width ?? 0,
    height: video.height ?? 0,
    audio: json.streams.some((s) => s.codec_type === "audio"),
  };
}

async function pool<T>(items: T[], size: number, work: (item: T, index: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await work(items[i], i);
      }
    }),
  );
}

const box = "fontcolor=yellow:box=1:boxcolor=black@0.65:boxborderw=4";
const fontFile = `fontfile='${font.replace(/'/g, "")}'`;
const label = (text: string, size: number) =>
  `drawtext=${fontFile}:text='${text.replace(/[':\\%]/g, (c) => `\\${c}`)}':expansion=none:x=6:y=6:fontsize=${size}:${box}`;
/** Labels each frame with its own timestamp (+ offset), so the label is what is shown. */
const timeLabel = (offset: number, size: number) =>
  `drawtext=${fontFile}:text='%{pts\\:hms\\:${offset}}':x=6:y=6:fontsize=${size}:${box}`;

/**
 * One JPEG with a thumbnail every `step` seconds from `from`, in a grid, each labelled
 * with its video time. Close steps are read in one pass (cheap over HTTP); wide steps
 * jump to the nearest keyframe for each tile, which is fast but only roughly on time.
 */
export async function contactSheet(
  source: string,
  from: number,
  step: number,
  count: number,
  columns = 5,
  width = 288,
): Promise<Buffer> {
  const work = await mkdtemp(join(tmpdir(), "tacticut-sheet-"));
  const height = Math.round((width * 9) / 16 / 2) * 2;
  const fit = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
  const rows = Math.ceil(count / columns);
  const tile = `tile=${columns}x${rows}:padding=2:color=white`;
  const sheet = join(work, "sheet.jpg");
  try {
    if (step <= 20) {
      const args = ["-v", "error", "-ss", String(from), "-i", source, "-t", String(step * (count - 1) + 0.5), "-an",
        "-vf", `fps=1/${step}:round=near,${fit},${timeLabel(from, 16)},${tile}`, "-frames:v", "1", "-q:v", "5", "-y", sheet];
      if (process.platform === "darwin")
        await run(ffmpeg, ["-hwaccel", "videotoolbox", ...args]).catch(() => run(ffmpeg, args));
      else await run(ffmpeg, args);
      return await readFile(sheet);
    }
    const times = Array.from({ length: count }, (_, i) => from + i * step);
    await pool(times, 6, async (t, i) => {
      const out = join(work, `${String(i).padStart(3, "0")}.jpg`);
      const grab = () => run(ffmpeg, ["-v", "error", "-noaccurate_seek", "-ss", String(t), "-copyts", "-i", source, "-frames:v", "1", "-vf", `${fit},${timeLabel(0, 16)}`, "-q:v", "4", "-y", out]);
      try {
        // The portal drops the odd request under load; one retry fixes most.
        await grab().catch(grab);
      } catch {
        // Beyond the end or unreadable: keep the grid aligned with a black tile.
        await run(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", `color=black:s=${width}x${height}`, "-frames:v", "1", "-vf", label(`${videoClock(t)} –`, 16), "-y", out]);
      }
    });
    await run(ffmpeg, ["-v", "error", "-framerate", "1", "-i", join(work, "%03d.jpg"), "-vf", tile, "-frames:v", "1", "-q:v", "5", "-y", sheet]);
    return await readFile(sheet);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** One frame at full size, or a zoomed part of it (fractions of the picture). */
export async function frame(
  source: string,
  t: number,
  crop?: { x: number; y: number; w: number; h: number },
): Promise<Buffer> {
  const work = await mkdtemp(join(tmpdir(), "tacticut-frame-"));
  try {
    const out = join(work, "frame.jpg");
    const filters = crop
      ? [`crop=trunc(iw*${crop.w}):trunc(ih*${crop.h}):trunc(iw*${crop.x}):trunc(ih*${crop.y})`, "scale=1280:-2:flags=lanczos"]
      : ["scale='min(1280,iw)':-2"];
    filters.push(label(videoClock(t), 22));
    await run(ffmpeg, ["-v", "error", "-ss", String(t), "-i", source, "-frames:v", "1", "-vf", filters.join(","), "-q:v", "3", "-y", out]);
    return await readFile(out);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

const hardware = process.platform === "darwin" && process.env.TACTICUT_ENCODER !== "software";

/**
 * Re-encodes [start, start+duration) of a source. All outputs share codec settings,
 * so they can be joined without another encode.
 */
export async function cut(
  source: string,
  start: number,
  duration: number,
  output: string,
  opts: { height?: number; audio: boolean; text?: string; signal?: AbortSignal },
) {
  const filters = [
    opts.height ? `scale=-2:${opts.height}` : "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "setsar=1",
    "fps=30",
  ];
  if (opts.text) filters.push(`${label(opts.text, Math.round((opts.height ?? 720) * 0.04))}:enable='lt(t,4)'`);
  const input = ["-v", "error", "-nostdin", "-y", "-ss", String(start), "-i", source];
  if (!opts.audio) input.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
  const rest = [
    "-t", String(duration),
    "-map", "0:v:0",
    "-map", opts.audio ? "0:a:0" : "1:a:0",
    "-vf", filters.join(","),
    "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "128k",
    "-pix_fmt", "yuv420p", "-video_track_timescale", "15360", "-movflags", "+faststart",
  ];
  // Excerpts keep the source size and get a little headroom for later exports.
  const bitrate = opts.height === 1080 ? "8M" : opts.height ? "4M" : "5M";
  const encode = (hw: boolean) =>
    run(ffmpeg, [...input, ...rest, ...(hw ? ["-c:v", "h264_videotoolbox", "-b:v", bitrate] : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21"]), output], opts.signal);
  try {
    await encode(hardware);
  } catch (err) {
    if (!hardware || opts.signal?.aborted) throw err;
    await encode(false);
  }
}

/** Joins outputs of `cut` without re-encoding. */
export async function concat(parts: string[], output: string) {
  const list = join(dirname(output), `.${Date.now()}-concat.txt`);
  await writeFile(list, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
  try {
    await run(ffmpeg, ["-v", "error", "-nostdin", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", output]);
  } finally {
    await rm(list, { force: true });
  }
}

/** Resumable download; `progress` gets bytes done and total. */
export async function download(
  url: string,
  output: string,
  progress: (done: number, total: number) => void,
) {
  await mkdir(dirname(output), { recursive: true });
  const partial = `${output}.part`;
  const have = await stat(partial).then((s) => s.size, () => 0);
  const response = await fetch(url, { headers: have ? { range: `bytes=${have}-` } : {} });
  if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
  const resumed = response.status === 206;
  const total = Number(response.headers.get("content-length") ?? 0) + (resumed ? have : 0);
  let done = resumed ? have : 0;
  const file = createWriteStream(partial, { flags: resumed ? "a" : "w" });
  let last = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    if (!file.write(chunk)) await new Promise<void>((r) => file.once("drain", () => r()));
    done += chunk.length;
    if (Date.now() - last > 1000) {
      last = Date.now();
      progress(done, total);
    }
  }
  await new Promise<void>((ok, fail) => file.end((err?: Error | null) => (err ? fail(err) : ok())));
  if (total && done !== total) throw new Error("Download incomplete; run it again to resume.");
  await rename(partial, output);
}

/** Same identity Tacticut computes for a Source video (electron/files.ts). */
export async function fingerprint(path: string) {
  const byte_size = (await stat(path)).size;
  const hash = createHash("sha256").update(String(byte_size));
  const file = await open(path, "r");
  try {
    for (const fraction of [0, 0.5, 1]) {
      const buffer = Buffer.alloc(65536);
      const offset = Math.min(Math.floor(byte_size * fraction), Math.max(byte_size - 65536, 0));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await file.close();
  }
  return { byte_size, fingerprint: hash.digest("hex") };
}
