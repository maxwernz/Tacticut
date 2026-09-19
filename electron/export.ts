import {
  mkdtemp,
  writeFile,
  copyFile,
  rm,
  rename,
  unlink,
  realpath,
} from "node:fs/promises";
import { join, dirname, basename, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { analysisSchema, type FreezeFrame } from "../src/domain";
import { clipPresentation } from "../src/annotations";
import { renderFreezeFrame } from "./annotations";
import type { Loaded, ExportOptions, Progress } from "../src/api";
import { resolveSource } from "./files";
import { ffmpeg, run, probe } from "./media";
export const exportSchema = z.object({
  ids: z.array(z.string()).min(1),
  title: z.boolean(),
  categories: z.boolean(),
  notes: z.boolean(),
  numbers: z.boolean(),
  audio: z.boolean(),
  encoder: z.enum(["auto", "software"]),
  height: z.union([z.literal(720), z.literal(1080)]),
  annotations: z.boolean().default(true),
});
export async function renderExport(
  data: Loaded,
  rawOptions: ExportOptions,
  output: string,
  font: string,
  signal: AbortSignal,
  progress: (p: Progress) => void,
) {
  const a = analysisSchema.parse(data.analysis),
    options = exportSchema.parse(rawOptions);
  if (new Set(options.ids).size !== options.ids.length)
    throw new Error("Export list contains duplicates");
  const clips = options.ids.map((id) => {
    const c = a.clips.find((c) => c.id === id);
    if (!c) throw new Error("An export Clip no longer exists");
    return c;
  });
  const canonical = async (path: string) => {
    const value = await realpath(path).catch(() => resolve(path));
    return process.platform === "win32" ? value.toLowerCase() : value;
  };
  const destination = await canonical(output);
  for (const source of a.source_videos) {
    const path = await resolveSource(source, data.path).catch(() => null);
    if (path && (await canonical(path)) === destination)
      throw new Error("Cannot overwrite a Source video");
  }
  const paths = new Map<string, string>();
  const metadata = new Map<string, Awaited<ReturnType<typeof probe>>>();
  for (const id of new Set(clips.map((c) => c.source_video_id))) {
    const path = await resolveSource(
      a.source_videos.find((s) => s.id === id)!,
      data.path,
    );
    if (path === output) throw new Error("Cannot overwrite a Source video");
    paths.set(id, path);
    metadata.set(id, await probe(path));
  }
  for (const c of clips)
    if (c.end_ms > metadata.get(c.source_video_id)!.duration_ms + 50)
      throw new Error(
        `“${c.name}” extends beyond its Source video. Edit its boundaries before exporting.`,
      );
  const work = await mkdtemp(join(tmpdir(), "video-analyse-export-"));
  const partial = join(
    dirname(output),
    `.${basename(output)}.${randomUUID()}.mp4`,
  );
  const h = options.height,
    w = Math.round((h * 16) / 9 / 2) * 2;
  type Segment = {
    duration: number;
    text?: string;
    path?: string;
    start?: number;
    number?: string;
    audio?: boolean;
    freeze?: FreezeFrame;
  };
  const segments: Segment[] = [];
  if (options.title)
    segments.push({ duration: 1.5, text: a.title || "Analysis" });
  let lastCategory: string | null | undefined;
  clips.forEach((clip, i) => {
    if (options.categories && clip.category_id !== lastCategory)
      segments.push({
        duration: 1.5,
        text:
          a.categories.find((c) => c.id === clip.category_id)?.name ||
          "Ohne Kategorie",
      });
    lastCategory = clip.category_id;
    if (options.notes && clip.notes.trim())
      segments.push({ duration: 2, text: clip.notes });
    for (const part of clipPresentation(
      clip,
      options.annotations ? a.freeze_frames : [],
    ))
      segments.push({
        path: paths.get(clip.source_video_id),
        start: part.start_ms / 1000,
        duration: part.duration_ms / 1000,
        number: options.numbers ? String(i + 1) : undefined,
        audio: !part.freeze && metadata.get(clip.source_video_id)!.audio,
        freeze: part.freeze,
      });
  });
  const total = segments.reduce((n, s) => n + s.duration, 0);
  let done = 0;
  let hardware = options.encoder === "auto" && process.platform === "darwin";
  try {
    await copyFile(font, join(work, "font.ttf"));
    for (let i = 0; i < segments.length; i++) {
      if (signal.aborted) throw new Error("Export cancelled");
      const s = segments[i];
      const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"];
      if (s.freeze) {
        progress({
          percent: Math.min(98, (done / total) * 98),
          message: `Drawing freeze-frame ${i + 1} of ${segments.length}`,
        });
        const still = await renderFreezeFrame(
          s.path!,
          s.freeze,
          work,
          i,
          w,
          h,
          signal,
        );
        args.push("-loop", "1", "-framerate", "30", "-i", still);
      } else if (s.path) args.push("-ss", String(s.start), "-i", s.path);
      else args.push("-f", "lavfi", "-i", `color=c=0x353333:s=${w}x${h}:r=30`);
      if (options.audio && (!s.path || !s.audio))
        args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
      const filters = [
        `scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
        `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`,
        "setsar=1",
        "fps=30",
      ];
      if (s.text !== undefined || s.number) {
        const text = s.text === undefined ? s.number! : wrap(s.text, 44);
        await writeFile(join(work, `text-${i}.txt`), text);
        filters.push(
          `drawtext=fontfile=font.ttf:textfile=text-${i}.txt:expansion=none:fontcolor=white:fontsize=${s.number ? Math.round(h * 0.065) : Math.round(h * 0.047)}:x=${s.number ? 30 : "(w-text_w)/2"}:y=${s.number ? 30 : "(h-text_h)/2"}:line_spacing=12`,
        );
      }
      args.push(
        "-t",
        String(s.duration),
        "-map",
        "0:v:0",
        "-vf",
        filters.join(","),
      );
      if (options.audio)
        args.push(
          "-map",
          s.path && s.audio ? "0:a:0" : "1:a:0",
          "-af",
          "apad",
          "-c:a",
          "aac",
          "-ar",
          "48000",
          "-ac",
          "2",
          "-b:a",
          "160k",
        );
      else args.push("-an");
      const execute = () =>
        run(
          ffmpeg,
          [
            ...args,
            ...(hardware
              ? ["-c:v", "h264_videotoolbox", "-b:v", "8M"]
              : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"]),
            "-pix_fmt",
            "yuv420p",
            "-video_track_timescale",
            "15360",
            "-progress",
            "pipe:1",
            join(work, `segment-${i}.mp4`),
          ],
          {
            cwd: work,
            signal,
            progress: (seconds) =>
              progress({
                percent: Math.min(
                  98,
                  ((done + Math.min(seconds, s.duration)) / total) * 98,
                ),
                message: `Rendering ${i + 1} of ${segments.length}`,
              }),
          },
        );
      try {
        await execute();
      } catch (error) {
        if (!hardware || signal.aborted) throw error;
        hardware = false;
        await execute();
      }
      done += s.duration;
    }
    await writeFile(
      join(work, "list.txt"),
      segments.map((_, i) => `file 'segment-${i}.mp4'`).join("\n"),
    );
    progress({ percent: 99, message: "Finalizing presentation video" });
    await run(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        join(work, "list.txt"),
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        partial,
      ],
      { signal },
    );
    if (signal.aborted) throw new Error("Export cancelled");
    await rename(partial, output);
    progress({ percent: 100, message: "Export complete" });
  } finally {
    await rm(work, { recursive: true, force: true });
    await unlink(partial).catch(() => {});
  }
}
function wrap(text: string, width: number): string {
  return text
    .split("\n")
    .flatMap((line) => {
      const lines: string[] = [];
      let current = "";
      for (const word of line.split(/\s+/)) {
        if ((current + " " + word).length > width && current) {
          lines.push(current);
          current = "";
        }
        current += (current ? " " : "") + word;
      }
      lines.push(current);
      return lines;
    })
    .join("\n");
}
