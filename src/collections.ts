import { withRoster } from "./roster";
import type { HandballTag } from "./handball";
import {
  analysisSchema,
  categoryShortcut,
  clipCategoryIds,
  withClipCategories,
  newAnalysis,
  normalizeName,
  type Analysis,
} from "./domain";

/** A collection is an independent snapshot; its source projects are never changed. */
export function combineProjects(projects: Analysis[], title: string): Analysis {
  if (projects.length < 2 || projects.length > 30)
    throw new Error("Choose between 2 and 30 projects for a collection.");
  const inputs = projects.map((project) => analysisSchema.parse(project));
  if (new Set(inputs.map((project) => project.id)).size !== inputs.length)
    throw new Error(
      "Two selected files are copies of the same project. Choose one version to avoid counting its clips twice.",
    );
  if (!title.trim() || title.trim().length > 120)
    throw new Error("Give the collection a name of up to 120 characters.");
  const result = newAnalysis([]);
  result.title = title.trim();
  const categoryKeys = new Map<string, string>();
  for (const project of inputs) {
    const sourceIds = new Map<string, string>();
    const categoryIds = new Map<string, string>();
    const clipIds = new Map<string, string>();
    const teamIds = new Map<string, string>();
    const playerIds = new Map<string, string>();
    if (project.roster) {
      const roster = (result.roster ??= { teams: [], players: [] });
      for (const team of project.roster.teams) {
        const existing = roster.teams.find(
          (candidate) => candidate.id === team.id,
        );
        const id = team.id;
        if (existing) Object.assign(existing, team);
        else roster.teams.push({ ...team });
        teamIds.set(team.id, id);
      }
      for (const person of project.roster.players) {
        const mapped = { ...person, team_id: teamIds.get(person.team_id)! };
        const existing = roster.players.find(
          (candidate) => candidate.id === person.id,
        );
        if (existing && existing.team_id !== mapped.team_id)
          throw new Error(
            `Player “${person.name}” has different team assignments across projects. Update the roster assignments before combining these projects.`,
          );
        const id = person.id;
        if (existing) Object.assign(existing, mapped);
        else roster.players.push(mapped);
        playerIds.set(person.id, id);
      }
    }
    const remapTag = (tag: HandballTag): HandballTag => ({
      ...tag,
      ...(tag.team_id ? { team_id: teamIds.get(tag.team_id)! } : {}),
      ...(tag.player_id ? { player_id: playerIds.get(tag.player_id)! } : {}),
      ...(tag.goalkeeper_id
        ? { goalkeeper_id: playerIds.get(tag.goalkeeper_id)! }
        : {}),
    });
    for (const source of project.source_videos) {
      const matches = result.source_videos.filter(
        (candidate) =>
          candidate.location === source.location ||
          (!!source.fingerprint &&
            candidate.fingerprint === source.fingerprint),
      );
      if (matches.length > 1)
        throw new Error(
          "Source video identities conflict between projects. Relink the affected videos before combining them.",
        );
      const existing = matches[0];
      if (existing) {
        if (
          (existing.fingerprint &&
            source.fingerprint &&
            existing.fingerprint !== source.fingerprint) ||
          (existing.duration_ms != null &&
            source.duration_ms != null &&
            existing.duration_ms !== source.duration_ms) ||
          (existing.byte_size != null &&
            source.byte_size != null &&
            existing.byte_size !== source.byte_size)
        )
          throw new Error(
            `Source video “${source.display_name}” differs between projects. Relink it before combining them.`,
          );
        existing.duration_ms ??= source.duration_ms;
        existing.byte_size ??= source.byte_size;
        existing.fingerprint ??= source.fingerprint;
        sourceIds.set(source.id, existing.id);
      } else {
        const id = crypto.randomUUID();
        result.source_videos.push({ ...source, id, relative_path: null });
        sourceIds.set(source.id, id);
      }
    }
    for (const category of project.categories) {
      const key = JSON.stringify([
        normalizeName(category.group || ""),
        normalizeName(category.name),
      ]);
      const existing = categoryKeys.get(key);
      if (existing) categoryIds.set(category.id, existing);
      else {
        const id = crypto.randomUUID();
        const name = category.name;
        const requested = categoryShortcut(project.categories, category);
        const shortcut =
          requested &&
          !result.categories.some(
            (candidate) => candidate.shortcut === requested,
          )
            ? requested
            : null;
        result.categories.push({ ...category, id, name, shortcut });
        categoryIds.set(category.id, id);
        categoryKeys.set(key, id);
      }
    }
    for (const clip of project.clips) {
      const id = crypto.randomUUID();
      clipIds.set(clip.id, id);
      result.clips.push(
        withClipCategories(
          {
            ...clip,
            id,
            source_video_id: sourceIds.get(clip.source_video_id)!,
            category_id: clip.category_id
              ? categoryIds.get(clip.category_id)!
              : null,
            creation_order: result.clips.length,
            ...(clip.handball ? { handball: remapTag(clip.handball) } : {}),
          },
          clipCategoryIds(clip).map((id) => categoryIds.get(id)!),
        ),
      );
    }
    for (const playlist of project.playlists)
      result.playlists.push({
        ...playlist,
        id: crypto.randomUUID(),
        name: `${project.title || "Project"} · ${playlist.name}`.slice(0, 120),
        clip_ids: playlist.clip_ids.map((id) => clipIds.get(id)!),
      });
    for (const frame of project.freeze_frames)
      result.freeze_frames.push({
        ...frame,
        id: crypto.randomUUID(),
        clip_id: clipIds.get(frame.clip_id)!,
        shapes: frame.shapes.map((shape) => ({
          ...shape,
          id: crypto.randomUUID(),
        })),
      });
    for (const view of project.handball_views || [])
      (result.handball_views ??= []).push({
        ...view,
        id: crypto.randomUUID(),
        name: `${project.title || "Project"} · ${view.name}`.slice(0, 80),
        filters: remapTag(view.filters),
        ...(view.category_ids
          ? {
              category_ids: view.category_ids.map((id) => categoryIds.get(id)!),
            }
          : {}),
        source_video_id: view.source_video_id
          ? (sourceIds.get(view.source_video_id) ?? null)
          : null,
      });
  }
  if ((result.handball_views?.length || 0) > 100)
    throw new Error(
      "These projects contain more than 100 saved views. Combine fewer projects or remove unused views first.",
    );
  return analysisSchema.parse(
    result.roster ? withRoster(result, result.roster) : result,
  );
}
