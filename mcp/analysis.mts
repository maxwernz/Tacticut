// Builds a Tacticut Analysis file from planned clips.

import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, relative } from "node:path";
import { encode, normalizeName, type Analysis } from "../src/domain.ts";

const COLORS = ["#EF4444", "#3B82F6", "#22C55E", "#F59E0B", "#A855F7", "#14B8A6", "#EC4899", "#64748B"];

export type SourceFile = {
  key: string;
  path: string;
  display_name: string;
  duration: number;
  byte_size: number;
  fingerprint: string;
};
export type AnalysisClip = {
  source: string;
  name: string;
  category: string | null;
  notes: string;
  start: number;
  end: number;
};

export function buildAnalysis(input: {
  title: string;
  file: string;
  sources: SourceFile[];
  clips: AnalysisClip[];
  playlist: boolean;
}): string {
  const sources = input.sources.map((s) => {
    const rel = relative(dirname(input.file), s.path);
    return {
      key: s.key,
      row: {
        id: randomUUID(),
        display_name: s.display_name,
        location: s.path,
        relative_path: isAbsolute(rel) ? null : rel.replaceAll("\\", "/"),
        duration_ms: Math.floor(s.duration * 1000),
        byte_size: s.byte_size,
        fingerprint: s.fingerprint,
      },
    };
  });
  const categories: Analysis["categories"] = [];
  for (const c of input.clips)
    if (c.category && !categories.some((x) => normalizeName(x.name) === normalizeName(c.category!)))
      categories.push({ id: randomUUID(), name: c.category, color: COLORS[categories.length % COLORS.length] });
  const clips: Analysis["clips"] = input.clips.map((c, i) => {
    const source = sources.find((s) => s.key === c.source);
    if (!source) throw new Error(`Unknown source ${c.source}`);
    const limit = source.row.duration_ms;
    const start_ms = Math.max(0, Math.round(c.start * 1000));
    const end_ms = Math.min(limit, Math.round(c.end * 1000));
    return {
      id: randomUUID(),
      source_video_id: source.row.id,
      name: c.name,
      start_ms,
      end_ms,
      notes: c.notes,
      category_id: c.category
        ? categories.find((x) => normalizeName(x.name) === normalizeName(c.category!))!.id
        : null,
      creation_order: i,
    };
  });
  const analysis: Analysis = {
    id: randomUUID(),
    title: input.title,
    source_videos: sources.map((s) => s.row),
    categories,
    clips,
    playlists: input.playlist && clips.length
      ? [{ id: randomUUID(), name: input.title.slice(0, 120) || "Clips", clip_ids: clips.map((c) => c.id) }]
      : [],
    freeze_frames: [],
  };
  return encode(analysis);
}
