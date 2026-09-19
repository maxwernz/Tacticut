import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { stat, rename, unlink, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fingerprint } from "./files";
import type { SourceVideo } from "../src/domain";
const requireNative = createRequire(__filename);
export const ffmpeg: string = (
  process.env.VIDEO_ANALYSE_FFMPEG || requireNative("ffmpeg-static")
)
  .replace("app.asar/", "app.asar.unpacked/")
  .replace("app.asar\\", "app.asar.unpacked\\");
export const ffprobe: string = (
  process.env.VIDEO_ANALYSE_FFPROBE || requireNative("ffprobe-static").path
)
  .replace("app.asar/", "app.asar.unpacked/")
  .replace("app.asar\\", "app.asar.unpacked\\");
export const children = new Set<ChildProcess>();
export function run(
  binary: string,
  args: string[],
  options: {
    signal?: AbortSignal;
    progress?: (seconds: number) => void;
    cwd?: string;
  } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      signal: options.signal,
      cwd: options.cwd,
    });
    children.add(child);
    let stdout = "",
      stderr = "",
      pending = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk).slice(-4_000_000);
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines)
        if (line.startsWith("out_time_us="))
          options.progress?.(Number(line.split("=")[1]) / 1e6);
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk).slice(-6000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      children.delete(child);
      code === 0
        ? resolve(stdout)
        : reject(
            new Error(
              options.signal?.aborted
                ? "Export cancelled"
                : stderr || `Media process exited with code ${code}`,
            ),
          );
    });
  });
}
export async function probe(path: string) {
  const data = JSON.parse(
    await run(ffprobe, [
      "-v",
      "error",
      "-show_format",
      "-show_streams",
      "-of",
      "json",
      path,
    ]),
  );
  const video = data.streams.find(
    (s: { codec_type: string }) => s.codec_type === "video",
  );
  if (!video) throw new Error("This file does not contain a video stream");
  const [n, d] = String(video.avg_frame_rate || "25/1")
    .split("/")
    .map(Number);
  const duration_ms = Math.floor(
    Number(data.format.duration || video.duration) * 1000,
  );
  if (!Number.isFinite(duration_ms) || duration_ms <= 0)
    throw new Error("Cannot determine the video duration");
  return {
    duration_ms,
    fps: n / d || 25,
    width: video.width as number,
    height: video.height as number,
    audio: data.streams.some(
      (s: { codec_type: string }) => s.codec_type === "audio",
    ),
  };
}
export async function sourceFromPath(path: string): Promise<SourceVideo> {
  const [identity, info] = await Promise.all([fingerprint(path), probe(path)]);
  return {
    id: randomUUID(),
    display_name: basename(path),
    location: path,
    relative_path: null,
    ...identity,
    duration_ms: info.duration_ms,
  };
}
const proxyJobs = new Map<string, Promise<string>>();
export async function playbackProxy(
  path: string,
  cache: string,
): Promise<string> {
  const identity = await fingerprint(path);
  const output = join(cache, `${identity.fingerprint}.mp4`);
  if (
    await stat(output)
      .then((s) => s.size > 0)
      .catch(() => false)
  )
    return output;
  if (proxyJobs.has(output)) return proxyJobs.get(output)!;
  const job = (async () => {
    await mkdir(cache, { recursive: true });
    const temporary = `${output}.${randomUUID()}.mp4`;
    try {
      await run(ffmpeg, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        path,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-vf",
        "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "22",
        "-g",
        "25",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        temporary,
      ]);
      await rename(temporary, output);
      return output;
    } finally {
      proxyJobs.delete(output);
      await unlink(temporary).catch(() => {});
    }
  })();
  proxyJobs.set(output, job);
  return job;
}
