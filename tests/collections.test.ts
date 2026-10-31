import { expect, it } from "vitest";
import { combineProjects } from "../src/collections";
import {
  analysisSchema,
  newAnalysis,
  clipCategoryIds,
  withClipCategories,
} from "../src/domain";
function project(name: string, fingerprint = name) {
  const a = newAnalysis();
  a.title = name;
  a.source_videos = [
    {
      id: crypto.randomUUID(),
      display_name: name,
      location: `/matches/${name}.mp4`,
      relative_path: "match.mp4",
      duration_ms: 60000,
      byte_size: 100,
      fingerprint,
    },
  ];
  a.clips = [
    {
      id: crypto.randomUUID(),
      name: "Goal",
      source_video_id: a.source_videos[0].id,
      start_ms: 1000,
      end_ms: 4000,
      category_id: a.categories[2].id,
      notes: "Coaching note",
      creation_order: 0,
      handball: { outcome: "goal", team: "Home", player: "Alex" },
    },
  ];
  a.playlists = [
    { id: crypto.randomUUID(), name: "Team review", clip_ids: [a.clips[0].id] },
  ];
  a.freeze_frames = [
    {
      id: crypto.randomUUID(),
      clip_id: a.clips[0].id,
      time_ms: 2000,
      hold_ms: 1000,
      shapes: [
        {
          id: crypto.randomUUID(),
          kind: "arrow",
          x1: 0.1,
          y1: 0.2,
          x2: 0.8,
          y2: 0.7,
          color: "#ffffff",
          width: 0.005,
        },
      ],
    },
  ];
  a.handball_views = [
    {
      id: crypto.randomUUID(),
      name: "Goals",
      filters: { outcome: "goal" },
      query: "",
      source_video_id: a.source_videos[0].id,
    },
  ];
  return a;
}
it("creates an independent collection with all linked references remapped and source projects untouched", () => {
  const a = project("Match 1"),
    b = project("Match 2");
  const before = JSON.stringify([a, b]);
  const merged = combineProjects([a, b], " Season ");
  expect(merged.title).toBe("Season");
  expect(merged.id).not.toBe(a.id);
  expect(merged.categories).toHaveLength(3);
  expect(merged.clips).toHaveLength(2);
  expect(merged.clips.map((clip) => clip.creation_order)).toEqual([0, 1]);
  expect(merged.playlists[1].clip_ids).toEqual([merged.clips[1].id]);
  expect(merged.freeze_frames[1].clip_id).toBe(merged.clips[1].id);
  expect(merged.freeze_frames[1].shapes[0].id).not.toBe(
    b.freeze_frames[0].shapes[0].id,
  );
  expect(merged.handball_views![1].source_video_id).toBe(
    merged.source_videos[1].id,
  );
  expect(merged.clips[1].handball).toEqual(b.clips[0].handball);
  expect(
    merged.source_videos.every((source) => source.relative_path === null),
  ).toBe(true);
  expect(analysisSchema.parse(merged)).toEqual(merged);
  expect(JSON.stringify([a, b])).toBe(before);
});
it("deduplicates the same recording while preserving separately coded clips", () => {
  const merged = combineProjects(
    [project("First", "same"), project("Second", "same")],
    "Review",
  );
  expect(merged.source_videos).toHaveLength(1);
  expect(merged.clips).toHaveLength(2);
  expect(merged.clips[0].source_video_id).toBe(merged.clips[1].source_video_id);
});
it("rejects copies of a project and incompatible media identities rather than double counting or attaching wrong footage", () => {
  const a = project("Match"),
    b = structuredClone(a);
  expect(() => combineProjects([a, b], "Review")).toThrow(/same project/);
  b.id = crypto.randomUUID();
  b.source_videos[0].fingerprint = "changed";
  expect(() => combineProjects([a, b], "Review")).toThrow(/differs/);
  b.source_videos[0].fingerprint = a.source_videos[0].fingerprint;
  b.source_videos[0].duration_ms = 70000;
  expect(() => combineProjects([a, b], "Review")).toThrow(/differs/);
});
it("preserves shared roster identities across renames and keeps same-name people distinct", () => {
  const a = project("One"),
    b = project("Two"),
    c = project("Three");
  const team = { id: crypto.randomUUID(), name: "Home" };
  const person = {
    id: crypto.randomUUID(),
    team_id: team.id,
    name: "Alex",
    goalkeeper: true,
  };
  for (const p of [a, b, c]) {
    p.roster = { teams: [{ ...team }], players: [{ ...person }] };
    p.clips[0].handball = {
      team_id: team.id,
      player_id: person.id,
      goalkeeper_id: person.id,
      team: "Home",
      player: "Alex",
      goalkeeper: "Alex",
    };
    p.handball_views![0].filters = { player_id: person.id };
  }
  c.roster!.players[0].name = "Alex renamed";
  c.roster!.players.push({ ...person, id: crypto.randomUUID() });
  const merged = combineProjects([a, b, c], "Roster review");
  expect(merged.roster!.teams).toHaveLength(1);
  expect(merged.roster!.players).toHaveLength(2);
  expect(merged.clips[0].handball!.player_id).toBe(
    merged.clips[1].handball!.player_id,
  );
  expect(merged.clips[2].handball!.player_id).toBe(person.id);
  expect(merged.clips[0].handball!.player).toBe("Alex renamed");
  expect(merged.handball_views![2].filters.player_id).toBe(
    merged.clips[2].handball!.player_id,
  );
  expect(analysisSchema.parse(merged)).toEqual(merged);
});
it("keeps distinct category groups and resolves shortcut collisions predictably", () => {
  const a = project("One"),
    b = project("Two");
  a.categories[2].group = "Attack";
  b.categories[2].group = "Defence";
  const merged = combineProjects([a, b], "Tactics");
  expect(merged.categories).toHaveLength(4);
  expect(merged.clips[0].category_id).not.toBe(merged.clips[1].category_id);
  const second = merged.categories.find(
    (category) => category.id === merged.clips[1].category_id,
  )!;
  expect(second.name).toBe("Tor");
  expect(second.group).toBe("Defence");
  expect(second.shortcut).toBeNull();
});
it("remaps every Category on multi-tagged clips while preserving the primary and selection order", () => {
  const a = project("One"),
    b = project("Two");
  a.clips[0] = withClipCategories(a.clips[0], [
    a.categories[2].id,
    a.categories[0].id,
  ]);
  b.clips[0] = withClipCategories(b.clips[0], [
    b.categories[0].id,
    b.categories[1].id,
  ]);
  const merged = combineProjects([a, b], "Multi-tag review");
  for (const [i, source] of [a, b].entries()) {
    const sourceNames = clipCategoryIds(source.clips[0]).map(
      (id) => source.categories.find((c) => c.id === id)!.name,
    );
    const mergedNames = clipCategoryIds(merged.clips[i]).map(
      (id) => merged.categories.find((c) => c.id === id)!.name,
    );
    expect(mergedNames).toEqual(sourceNames);
    expect(merged.clips[i].category_id).toBe(merged.clips[i].category_ids![0]);
  }
  expect(merged.clips[0].category_ids).not.toContain(a.categories[0].id);
  expect(analysisSchema.parse(merged)).toEqual(merged);
});
it("remaps saved coaching-theme filters to the combined category identities", () => {
  const a = project("One"),
    b = project("Two");
  a.handball_views![0].category_ids = [a.categories[0].id, a.categories[1].id];
  const merged = combineProjects([a, b], "Saved theme review");
  const selected = merged.handball_views![0].category_ids!;
  expect(
    selected.map((id) => merged.categories.find((c) => c.id === id)!.name),
  ).toEqual(["Abwehr", "Angriff"]);
  expect(selected).not.toContain(a.categories[0].id);
  expect(analysisSchema.parse(merged)).toEqual(merged);
});
