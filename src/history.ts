import type { Analysis } from "./domain";

type Edit = { document: Analysis; label: string };
export type EditHistory = { past: Edit[]; future: Edit[] };
export const emptyHistory = (): EditHistory => ({ past: [], future: [] });
const same = (a: Analysis, b: Analysis) =>
  JSON.stringify(a) === JSON.stringify(b);
export function editLabel(before: Analysis, after: Analysis): string {
  if (before.title !== after.title) return "project title";
  for (const [key, label] of [
    ["source_videos", "source videos"],
    ["categories", "categories"],
    ["clips", "clips"],
    ["playlists", "playlist"],
    ["freeze_frames", "freeze-frames"],
    ["handball_views", "saved view"],
  ] as const) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      return label;
  }
  return "project setup";
}
export function recordEdit(
  history: EditHistory,
  before: Analysis,
  after: Analysis,
  label = editLabel(before, after),
): EditHistory {
  if (same(before, after)) return history;
  return {
    past: [...history.past, { document: before, label }].slice(-100),
    future: [],
  };
}
export function travelHistory(
  history: EditHistory,
  current: Analysis,
  direction: "undo" | "redo",
) {
  const from = direction === "undo" ? history.past : history.future;
  const entry = from.at(-1);
  if (!entry) return null;
  const reverse = { document: current, label: entry.label };
  return {
    document: entry.document,
    label: entry.label,
    history:
      direction === "undo"
        ? { past: from.slice(0, -1), future: [...history.future, reverse] }
        : { past: [...history.past, reverse], future: from.slice(0, -1) },
  };
}
