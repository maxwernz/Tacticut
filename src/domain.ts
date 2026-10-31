import { z } from "zod";
import { handballSchema } from "./handball";
import { rosterSchema } from "./roster";

const id = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Invalid UUID",
  );
const ms = z.number().int().nonnegative().safe();
const nonblank = z
  .string()
  .refine((value) => value.trim().length > 0, "Must not be empty");
export const categorySchema = z.object({
  id,
  name: z.string().trim().min(1),
  color: nonblank,
  group: z.string().trim().min(1).max(80).optional(),
  shortcut: z.number().int().min(1).max(9).nullable().optional(),
});
export const sourceSchema = z.object({
  id,
  display_name: nonblank,
  location: nonblank,
  relative_path: z.string().nullable().default(null),
  duration_ms: ms.nullable().default(null),
  byte_size: ms.nullable().default(null),
  fingerprint: z.string().nullable().default(null),
});
export const clipSchema = z
  .object({
    id,
    source_video_id: id,
    name: nonblank,
    start_ms: ms,
    end_ms: ms,
    notes: z.string(),
    category_id: id.nullable(),
    category_ids: z.array(id).min(2).max(100).optional(),
    creation_order: ms,
    handball: handballSchema.optional(),
  })
  .superRefine((clip, ctx) => {
    if (!clip.category_ids) return;
    if (new Set(clip.category_ids).size !== clip.category_ids.length)
      ctx.addIssue({
        code: "custom",
        message: "Clip Categories must be unique",
      });
    if (clip.category_id !== clip.category_ids[0])
      ctx.addIssue({
        code: "custom",
        message: "The primary Category must be the first selected Category",
      });
  });
export const playlistSchema = z.object({
  id,
  name: z.string().trim().min(1).max(120),
  clip_ids: z.array(id),
});
const coordinate = z.number().finite().min(0).max(1);
export const drawingSchema = z
  .object({
    id,
    kind: z.enum(["arrow", "circle", "line", "text"]),
    text: z.string().trim().min(1).max(160).optional(),
    font_size: z.number().finite().min(0.02).max(0.12).optional(),
    x1: coordinate,
    y1: coordinate,
    x2: coordinate,
    y2: coordinate,
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    width: z.number().finite().min(0.002).max(0.02),
  })
  .refine(
    (s) =>
      s.kind === "text"
        ? !!s.text && s.font_size !== undefined && s.x2 > s.x1 && s.y2 > s.y1
        : s.kind === "circle"
          ? Math.abs(s.x2 - s.x1) >= 0.005 && Math.abs(s.y2 - s.y1) >= 0.005
          : Math.hypot(s.x2 - s.x1, s.y2 - s.y1) >= 0.005,
    "Drawing is too small",
  );
export const freezeFrameSchema = z.object({
  id,
  clip_id: id,
  time_ms: ms,
  hold_ms: z.number().int().min(500).max(15000),
  shapes: z.array(drawingSchema).min(1).max(100),
});
export const handballViewSchema = z.object({
  id,
  name: z.string().trim().min(1).max(80),
  filters: handballSchema,
  query: z.string().max(300),
  source_video_id: id.nullable(),
  category_ids: z
    .array(id)
    .max(100)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "Saved-view Categories must be unique",
    )
    .optional(),
});
export type HandballView = z.infer<typeof handballViewSchema>;

export const analysisSchema = z
  .object({
    id,
    title: z.string(),
    source_videos: z.array(sourceSchema),
    categories: z.array(categorySchema),
    clips: z.array(clipSchema),
    playlists: z.array(playlistSchema).default([]),
    freeze_frames: z.array(freezeFrameSchema).max(10000).default([]),
    handball_views: z.array(handballViewSchema).max(100).optional(),
    roster: rosterSchema.optional(),
  })
  .superRefine((a, ctx) => {
    const problem = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    for (const rows of [
      a.source_videos,
      a.categories,
      a.clips,
      a.playlists,
      a.freeze_frames,
      a.handball_views || [],
    ])
      if (new Set(rows.map((r) => r.id)).size !== rows.length)
        problem("Entity identities must be unique");
    if (new Set(a.categories.map(categoryKey)).size !== a.categories.length)
      problem("Category names must be unique");
    if (
      new Set(a.source_videos.map((s) => s.location)).size !==
      a.source_videos.length
    )
      problem("Source video has already been added");
    const fingerprints = a.source_videos
      .map((s) => s.fingerprint)
      .filter(Boolean);
    if (new Set(fingerprints).size !== fingerprints.length)
      problem("Source video has already been added");
    a.clips.forEach((c, i) => {
      const source = a.source_videos.find((s) => s.id === c.source_video_id);
      if (!source) problem("Clip refers to an unknown Source video");
      if (
        clipCategoryIds(c).some(
          (categoryId) => !a.categories.some((t) => t.id === categoryId),
        )
      )
        problem("Clip refers to an unknown Category");
      if (c.end_ms <= c.start_ms) problem("Clip end must be after its start");
      if (source?.duration_ms != null && c.end_ms > source.duration_ms)
        problem("Clip end exceeds Source video duration");
      if (c.creation_order !== i)
        problem("Clip creation order must be contiguous");
    });
    for (const view of a.handball_views || [])
      if (
        view.category_ids?.some((id) => !a.categories.some((c) => c.id === id))
      )
        problem("Saved view refers to an unknown Category");
    const shortcuts = a.categories
      .map((c) => c.shortcut)
      .filter((s) => s != null);
    if (new Set(shortcuts).size !== shortcuts.length)
      problem("Category shortcuts must be unique");
    for (const tag of [
      ...a.clips.map((c) => c.handball),
      ...(a.handball_views || []).map((v) => v.filters),
    ]) {
      if (!tag) continue;
      if (tag.team_id && !a.roster?.teams.some((t) => t.id === tag.team_id))
        problem("Handball tag refers to an unknown roster team");
      for (const role of ["player", "goalkeeper"] as const) {
        const ref = tag[`${role}_id`];
        const person = a.roster?.players.find((p) => p.id === ref);
        if (ref && !person)
          problem("Handball tag refers to an unknown roster player");
        if (
          role === "player" &&
          person &&
          tag.team_id &&
          person.team_id !== tag.team_id
        )
          problem("Attacking player belongs to another team");
      }
    }
    const clipIds = new Set(a.clips.map((c) => c.id));
    for (const playlist of a.playlists) {
      if (new Set(playlist.clip_ids).size !== playlist.clip_ids.length)
        problem("A playlist cannot contain the same Clip twice");
      if (playlist.clip_ids.some((id) => !clipIds.has(id)))
        problem("Playlist refers to an unknown Clip");
    }
    const moments = new Set<string>();
    for (const frame of a.freeze_frames) {
      const clip = a.clips.find((c) => c.id === frame.clip_id);
      if (!clip) problem("Freeze-frame refers to an unknown Clip");
      else if (frame.time_ms < clip.start_ms || frame.time_ms >= clip.end_ms)
        problem(
          "Clip boundaries exclude a saved freeze-frame. Remove or retime that freeze-frame first.",
        );
      const key = `${frame.clip_id}:${frame.time_ms}`;
      if (moments.has(key))
        problem("A Clip cannot have two freeze-frames at the same time");
      moments.add(key);
      if (new Set(frame.shapes.map((s) => s.id)).size !== frame.shapes.length)
        problem("Drawing identities must be unique");
    }
  });
export type Analysis = z.infer<typeof analysisSchema>;
export type SourceVideo = z.infer<typeof sourceSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Clip = z.infer<typeof clipSchema>;
export type Playlist = z.infer<typeof playlistSchema>;
export type Drawing = z.infer<typeof drawingSchema>;
export type FreezeFrame = z.infer<typeof freezeFrameSchema>;
export const defaults = [
  { name: "Abwehr", color: "#3B82F6" },
  { name: "Angriff", color: "#EF4444" },
  { name: "Tor", color: "#22C55E" },
];
export const normalizeName = (name: string) =>
  name.trim().toLowerCase().replaceAll("ß", "ss").replaceAll("ς", "σ");
export const categoryKey = (category: Pick<Category, "name" | "group">) =>
  JSON.stringify([
    normalizeName(category.group || ""),
    normalizeName(category.name),
  ]);
export function newAnalysis(template = defaults): Analysis {
  return {
    id: crypto.randomUUID(),
    title: "",
    source_videos: [],
    clips: [],
    playlists: [],
    freeze_frames: [],
    categories: template.map((c) => ({ ...c, id: crypto.randomUUID() })),
  };
}
export function decode(text: string): Analysis {
  if (
    !text
      .replace(/^\uFEFF/, "")
      .trimStart()
      .startsWith("{")
  )
    throw new Error(
      "Legacy pickle Analysis: open it in the Python app and Save As to convert to JSON first.",
    );
  const envelope = z
    .object({
      schema_version: z.union([
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
        z.literal(5),
        z.literal(6),
        z.literal(7),
      ]),
      analysis: analysisSchema,
    })
    .parse(JSON.parse(text.replace(/^\uFEFF/, "")));
  if (!envelope.analysis.source_videos.length)
    throw new Error("An Analysis file must contain at least one Source video");
  return envelope.analysis;
}
export function encode(a: Analysis): string {
  const validated = analysisSchema.parse(a);
  if (!validated.source_videos.length)
    throw new Error("Add a Source video before saving");
  const { playlists, freeze_frames, ...base } = validated;
  // Old Python versions reject v2 instead of silently dropping playlists on save.
  return (
    JSON.stringify(
      validated.clips.some((clip) => clip.category_ids !== undefined) ||
        validated.handball_views?.some((view) => view.category_ids?.length)
        ? { schema_version: 7, analysis: validated }
        : validated.roster ||
            validated.categories.some(
              (c) => c.group || c.shortcut !== undefined,
            ) ||
            validated.freeze_frames.some((f) =>
              f.shapes.some((s) => s.kind === "text" || s.kind === "line"),
            )
          ? { schema_version: 6, analysis: validated }
          : validated.handball_views?.length
            ? { schema_version: 5, analysis: validated }
            : validated.clips.some(
                  (clip) =>
                    clip.handball && Object.values(clip.handball).some(Boolean),
                )
              ? { schema_version: 4, analysis: validated }
              : freeze_frames.length
                ? { schema_version: 3, analysis: validated }
                : playlists.length
                  ? { schema_version: 2, analysis: { ...base, playlists } }
                  : { schema_version: 1, analysis: base },
      null,
      2,
    ) + "\n"
  );
}
export function mutate(
  a: Analysis,
  change: (draft: Analysis) => void,
): Analysis {
  const draft = structuredClone(a);
  change(draft);
  draft.clips.forEach((c, i) => (c.creation_order = i));
  const clipIds = new Set(draft.clips.map((c) => c.id));
  const deletedIds = new Set(
    a.clips.filter((c) => !clipIds.has(c.id)).map((c) => c.id),
  );
  draft.playlists.forEach((p) => {
    p.clip_ids = p.clip_ids.filter((id) => !deletedIds.has(id));
  });
  draft.freeze_frames = draft.freeze_frames.filter(
    (f) => !deletedIds.has(f.clip_id),
  );
  return analysisSchema.parse(draft);
}
/** The first Category stays the primary grouping/color for legacy workflows. */
export function clipCategoryIds(
  clip: Pick<Clip, "category_id" | "category_ids">,
): string[] {
  return clip.category_ids
    ? [...clip.category_ids]
    : clip.category_id
      ? [clip.category_id]
      : [];
}
/** Normalize UI selections without persisting redundant singleton arrays. */
export function withClipCategories(clip: Clip, ids: string[]): Clip {
  const categories = [...new Set(ids)];
  const { category_ids: _oldCategories, ...base } = clip;
  return {
    ...base,
    category_id: categories[0] || null,
    ...(categories.length > 1 ? { category_ids: categories } : {}),
  };
}
export function clipCategoryLabels(
  clip: Pick<Clip, "category_id" | "category_ids">,
  categories: Category[],
): string[] {
  return clipCategoryIds(clip).flatMap((id) => {
    const category = categories.find((c) => c.id === id);
    return category ? [categoryLabel(category)] : [];
  });
}
export function playlistClips(a: Analysis, playlist: Playlist): Clip[] {
  const clips = new Map(a.clips.map((c) => [c.id, c]));
  return playlist.clip_ids
    .map((id) => clips.get(id))
    .filter((c): c is Clip => !!c);
}
export function exportOrder(a: Analysis, ids: string[]): Clip[] {
  const selected = new Set(ids);
  const categoryRank = (c: Clip) =>
    c.category_id
      ? a.categories.findIndex((t) => t.id === c.category_id)
      : a.categories.length;
  return a.clips
    .filter((c) => selected.has(c.id))
    .sort(
      (x, y) =>
        categoryRank(x) - categoryRank(y) ||
        a.source_videos.findIndex((s) => s.id === x.source_video_id) -
          a.source_videos.findIndex((s) => s.id === y.source_video_id) ||
        x.start_ms - y.start_ms,
    );
}
export function timecode(value: number, precise = true): string {
  const n = Math.max(0, Math.round(value));
  return `${Math.floor(n / 3600000)
    .toString()
    .padStart(2, "0")}:${Math.floor((n / 60000) % 60)
    .toString()
    .padStart(2, "0")}:${Math.floor((n / 1000) % 60)
    .toString()
    .padStart(
      2,
      "0",
    )}${precise ? "." + (n % 1000).toString().padStart(3, "0") : ""}`;
}
/** A quick capture keeps the requested context but never exceeds the media. */
export function captureRange(
  position: number,
  duration: number,
  before: number,
  after: number,
) {
  if (
    ![position, duration, before, after].every(Number.isFinite) ||
    duration <= 0 ||
    before < 0 ||
    after < 0 ||
    before + after <= 0
  )
    throw new Error("Choose a non-empty capture window.");
  const now = Math.max(0, Math.min(duration, position));
  const start_ms = Math.max(0, Math.round(now - before));
  const end_ms = Math.min(Math.floor(duration), Math.round(now + after));
  if (end_ms <= start_ms)
    throw new Error("There is no video inside this capture window.");
  return { start_ms, end_ms };
}
export function parseTimecode(text: string): number {
  const parts = text.trim().split(":");
  if (parts.length > 3 || !parts.every((p) => /^\d+(\.\d{1,3})?$/.test(p)))
    throw new Error("Use HH:MM:SS.mmm or seconds");
  if (parts.slice(1).some((p) => Number(p) >= 60))
    throw new Error("Minutes and seconds must be below 60");
  return Math.round(parts.reduce((v, p) => v * 60 + Number(p), 0) * 1000);
}

/** Explicit shortcuts disable positional fallback for the whole template. */
export function categoryShortcut(
  categories: Category[],
  category: Category,
): number | null {
  if (categories.some((c) => c.shortcut !== undefined))
    return category.shortcut ?? null;
  const index = categories.findIndex((c) => c.id === category.id);
  return index >= 0 && index < 9 ? index + 1 : null;
}
export function categoryLabel(category: Category): string {
  return category.group
    ? `${category.group} / ${category.name}`
    : category.name;
}
