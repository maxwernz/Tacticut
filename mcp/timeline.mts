// Game clock → position in a match video.
//
// The game clock stops for team time-outs (and referee time-outs), the video keeps
// running. A position is therefore measured from the closest earlier sync point of the
// same half, plus a fixed amount for every team time-out in between.

export const HALF = 1800;

export type SyncPoint = { game: number; video: number; half: 1 | 2 };
export type Sync = {
  first_half: number;
  second_half: number;
  /** Extra checked moments, e.g. a goal seen in the video. */
  points?: SyncPoint[];
};
export type Timeout = { t: number; half: 1 | 2; team?: string };

/** "MM:SS", "H:MM:SS" or plain seconds. */
export function parseClock(value: string | number): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0)
      throw new Error(`Invalid time: ${value}`);
    return value;
  }
  const parts = value.trim().split(":");
  const numbers = parts.map(Number);
  if (
    !value.trim() ||
    parts.length > 3 ||
    numbers.some((n) => !Number.isFinite(n) || n < 0)
  )
    throw new Error(`Invalid time: "${value}"`);
  return numbers.reduce((total, n) => total * 60 + n, 0);
}

/** Game clock, always MM:SS (minutes may exceed 59). */
export const gameClock = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** Video position, H:MM:SS or MM:SS. */
export function videoClock(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 30:00 belongs to the end of the first half unless stated otherwise. */
export const halfOf = (t: number): 1 | 2 => (t <= HALF ? 1 : 2);

/**
 * Video time of game time `t`. Between two sync points, whatever the time-outs do
 * not explain (referee stops, replays in edited videos) is spread evenly; after the
 * last point the rate seen so far in that half carries on.
 *
 * A sync point at a time-out's game time means the restart after it. An event at the
 * same second as a time-out happened before it.
 */
export function toVideo(
  t: number,
  half: 1 | 2,
  sync: Sync,
  timeouts: Timeout[],
  timeoutSeconds: number,
): number {
  const anchors = syncPoints(sync, half);
  // Time-outs strictly after `from`, and before `to` (or at `to` for a sync point).
  const stops = (from: number, to: number, inclusive: boolean) =>
    timeouts.filter((x) => x.half === half && x.t > from && (inclusive ? x.t <= to : x.t < to)).length * timeoutSeconds;
  let at = -1;
  anchors.forEach((p, i) => p.game <= t && (at = i));
  const a = anchors[Math.max(at, 0)];
  const base = a.video + (t - a.game) + stops(a.game, t, false);
  const residual = (p: SyncPoint, q: SyncPoint) => q.video - (p.video + (q.game - p.game) + stops(p.game, q.game, true));
  const next = anchors[at + 1];
  if (at >= 0 && next) return base + (residual(a, next) * (t - a.game)) / (next.game - a.game);
  if (at >= 1) {
    const first = anchors[0];
    const rate = residual(first, a) / Math.max(1, a.game - first.game);
    return base + rate * (t - a.game);
  }
  return base;
}

export function syncPoints(sync: Sync, half: 1 | 2): SyncPoint[] {
  const start = half === 1 ? 0 : HALF;
  return [
    { game: start, video: half === 1 ? sync.first_half : sync.second_half, half },
    ...(sync.points ?? []).filter((p) => p.half === half && p.game > start),
  ].sort((x, y) => x.game - y.game);
}

export type ClipRequest = {
  game_no: string;
  start: string;
  end?: string;
  half?: 1 | 2;
  name?: string;
  category?: string;
  notes?: string;
  lead_seconds?: number;
  tail_seconds?: number;
};
export type PlanOptions = {
  lead_seconds: number;
  tail_seconds: number;
  timeout_seconds: number;
};
export type PlannedClip = {
  game_no: string;
  name: string;
  category: string | null;
  notes: string;
  half: 1 | 2;
  game_start: number;
  game_end: number;
  video_start: number;
  video_end: number;
  timeouts_before: number;
};

/**
 * Turns a request in game time into video ranges. A range across half-time becomes
 * two clips, so the break is never part of one.
 */
export function planClip(
  request: ClipRequest,
  sync: Sync,
  timeouts: Timeout[],
  options: PlanOptions,
  videoDuration: number | null,
): PlannedClip[] {
  const start = parseClock(request.start);
  const end = request.end === undefined ? start : parseClock(request.end);
  if (end < start)
    throw new Error(`Clip ends before it starts: ${request.start}–${request.end}`);
  const startHalf = request.half ?? halfOf(start);
  const endHalf =
    request.end === undefined ? startHalf : Math.max(startHalf, halfOf(end)) as 1 | 2;
  const lead = request.lead_seconds ?? options.lead_seconds;
  const tail = request.tail_seconds ?? options.tail_seconds;
  const pieces: [number, number, 1 | 2][] =
    startHalf === endHalf
      ? [[start, end, startHalf]]
      : [
          [start, HALF, 1],
          [HALF, end, 2],
        ];
  const baseName =
    request.name?.trim() ||
    (request.end === undefined
      ? gameClock(start)
      : `${gameClock(start)}–${gameClock(end)}`);
  return pieces.map(([from, to, half]) => {
    const clamp = (v: number) =>
      Math.max(0, videoDuration === null ? v : Math.min(v, videoDuration));
    const video_start = clamp(
      toVideo(from, half, sync, timeouts, options.timeout_seconds) - lead,
    );
    const video_end = clamp(
      toVideo(to, half, sync, timeouts, options.timeout_seconds) + tail,
    );
    if (video_end - video_start < 1)
      throw new Error(`“${baseName}” lies outside the video`);
    return {
      game_no: request.game_no,
      name: pieces.length > 1 ? `${baseName} (${half}. HZ)` : baseName,
      category: request.category?.trim() || null,
      notes: request.notes ?? "",
      half,
      game_start: from,
      game_end: to,
      video_start,
      video_end,
      timeouts_before: timeouts.filter((x) => x.half === half && x.t < to).length,
    };
  });
}

/**
 * Video ranges that cover all clips with some padding, merged where they touch,
 * so an excerpt file keeps a little context around every clip.
 */
export function coverRanges(
  clips: { video_start: number; video_end: number }[],
  padding: number,
  videoDuration: number | null,
  mergeGap = 30,
): { start: number; end: number }[] {
  const ranges = clips
    .map((c) => ({
      start: Math.max(0, c.video_start - padding),
      end:
        videoDuration === null
          ? c.video_end + padding
          : Math.min(videoDuration, c.video_end + padding),
    }))
    .sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r.start <= last.end + mergeGap) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}
