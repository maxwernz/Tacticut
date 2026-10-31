import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { analysisSchema } from "../src/domain";
import { playerReviewGroups } from "../src/handball";
import type { Loaded, ExportOptions, Progress } from "../src/api";
import { exportSchema, renderExport } from "./export";
export type PlayerExportResult = {
  directory: string;
  completed: number;
  total: number;
  cancelled: boolean;
};
export function playerExportName(name: string, index: number) {
  const safe =
    name
      .normalize("NFKC")
      .replace(/[\x00-\x1f/\\:*?"<>|]/g, "_")
      .replace(/[. ]+$/g, "")
      .slice(0, 100) || "Player";
  return `${String(index + 1).padStart(3, "0")} - ${safe}.mp4`;
}
/** Each run gets a new folder; finished videos survive cancellation of a later job. */
export async function renderPlayerExports(
  data: Loaded,
  raw: ExportOptions,
  parent: string,
  font: string,
  signal: AbortSignal,
  progress: (p: Progress) => void,
  render: typeof renderExport = renderExport,
): Promise<PlayerExportResult> {
  const analysis = analysisSchema.parse(data.analysis),
    options = exportSchema.parse(raw);
  const selected = new Set(options.ids);
  if (
    selected.size !== options.ids.length ||
    options.ids.some((id) => !analysis.clips.some((c) => c.id === id))
  )
    throw new Error("The player export contains missing or duplicate clips.");
  const groups = playerReviewGroups(
    options.ids.map((id) => analysis.clips.find((c) => c.id === id)!),
    "player",
    options.language,
  );
  if (!groups.length)
    throw new Error("Tag an attacking player on at least one selected clip.");
  if (signal.aborted) throw new Error("Export cancelled");
  const directory = await mkdtemp(join(parent, "Tacticut-player-reviews-"));
  const completed: { file: string; player: string; clip_ids: string[] }[] = [];
  const manifest = async (status: string) =>
    writeFile(
      join(directory, "review-index.json"),
      JSON.stringify(
        { project: analysis.title, status, total: groups.length, completed },
        null,
        2,
      ),
    );
  try {
    for (const [index, group] of groups.entries()) {
      if (signal.aborted) break;
      const file = playerExportName(group.name, index);
      await render(
        { ...data, analysis: { ...analysis, title: group.name } },
        { ...options, ids: group.clips.map((c) => c.id) },
        join(directory, file),
        font,
        signal,
        (p) =>
          progress({
            percent: ((index + p.percent / 100) / groups.length) * 100,
            message: `${index + 1}/${groups.length} · ${group.name} · ${p.message}`,
          }),
      );
      completed.push({
        file,
        player: group.name,
        clip_ids: group.clips.map((c) => c.id),
      });
      await manifest("in-progress");
    }
  } catch (error) {
    await manifest(signal.aborted ? "cancelled" : "failed");
    if (!signal.aborted)
      throw new Error(
        `${(error as Error).message}. ${completed.length} completed player videos are in ${directory}`,
      );
  }
  await manifest(signal.aborted ? "cancelled" : "complete");
  return {
    directory,
    completed: completed.length,
    total: groups.length,
    cancelled: signal.aborted,
  };
}
