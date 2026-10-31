import { expect, it } from "vitest";
import { mergeHandballTag } from "../src/handball";
import {
  analysisSchema,
  categoryShortcut,
  decode,
  encode,
  newAnalysis,
} from "../src/domain";
import {
  applySetupTemplate,
  decodeSetupTemplate,
  encodeSetupTemplate,
  makeSetupTemplate,
} from "../src/setupTemplates";
import { withRoster, type Roster } from "../src/roster";

const id = () => crypto.randomUUID();
function fixture() {
  const a = newAnalysis();
  a.source_videos.push({
    id: id(),
    display_name: "Match",
    location: "/match.mp4",
    relative_path: null,
    duration_ms: 10000,
    byte_size: null,
    fingerprint: null,
  });
  const roster: Roster = {
    teams: [
      { id: id(), name: "Home" },
      { id: id(), name: "Away" },
    ],
    players: [],
  };
  roster.players.push({
    id: id(),
    team_id: roster.teams[0].id,
    name: "Alex",
    number: "7",
    goalkeeper: false,
  });
  roster.players.push({
    id: id(),
    team_id: roster.teams[1].id,
    name: "Keeper",
    goalkeeper: true,
  });
  a.roster = roster;
  a.clips.push({
    id: id(),
    source_video_id: a.source_videos[0].id,
    name: "Shot",
    start_ms: 0,
    end_ms: 1000,
    category_id: a.categories[0].id,
    creation_order: 0,
    notes: "",
    handball: {
      team_id: roster.teams[0].id,
      team: "Home",
      player_id: roster.players[0].id,
      player: "Alex",
      goalkeeper_id: roster.players[1].id,
      goalkeeper: "Keeper",
      outcome: "saved",
    },
  });
  return a;
}
it("round trips linked identities, groups and explicit keys in v6, keeping legacy v1", () => {
  const a = fixture();
  a.categories[0].group = "Defense";
  a.categories[0].shortcut = 8;
  expect(JSON.parse(encode(a)).schema_version).toBe(6);
  expect(decode(encode(a))).toEqual(a);
  const old = fixture();
  delete old.roster;
  old.clips[0].handball = undefined;
  expect(JSON.parse(encode(old)).schema_version).toBe(1);
});
it("rejects dangling identities, mismatched attacking teams and duplicate keys", () => {
  const a = fixture();
  a.clips[0].handball!.player_id = id();
  expect(() => analysisSchema.parse(a)).toThrow(/unknown roster player/);
  a.clips[0].handball!.player_id = a.roster!.players[0].id;
  a.clips[0].handball!.team_id = a.roster!.teams[1].id;
  expect(() => analysisSchema.parse(a)).toThrow(/another team/);
  a.clips[0].handball!.team_id = a.roster!.teams[0].id;
  a.categories[0].shortcut = 1;
  a.categories[1].shortcut = 1;
  expect(() => analysisSchema.parse(a)).toThrow(/shortcuts must be unique/);
});
it("renames linked labels and saved views without changing identities; deleted people retain historical labels", () => {
  const a = fixture();
  a.handball_views = [
    {
      id: id(),
      name: "Player review",
      filters: { ...a.clips[0].handball },
      query: "",
      source_video_id: null,
    },
  ];
  const roster = structuredClone(a.roster!);
  roster.teams[0].name = "First team";
  roster.players[0].name = "Alex Müller";
  const updated = withRoster(a, roster);
  expect(updated.clips[0].handball).toMatchObject({
    team: "First team",
    player: "Alex Müller",
    player_id: roster.players[0].id,
  });
  expect(updated.handball_views![0].filters.player).toBe("Alex Müller");
  expect(a.clips[0].handball!.player).toBe("Alex");
  roster.players.splice(0, 1);
  const removed = withRoster(updated, roster);
  expect(removed.clips[0].handball!.player).toBe("Alex Müller");
  expect(removed.clips[0].handball!.player_id).toBeUndefined();
  expect(() => analysisSchema.parse(removed)).not.toThrow();
});
it("keeps positional keys for legacy categories and prevents fallback collisions after configuration", () => {
  const categories = newAnalysis().categories;
  expect(categoryShortcut(categories, categories[1])).toBe(2);
  categories[0].shortcut = 2;
  expect(categoryShortcut(categories, categories[0])).toBe(2);
  expect(categoryShortcut(categories, categories[1])).toBeNull();
});
it("shares templates with stable roster IDs, adds categories without orphaning clips, and resolves occupied keys", () => {
  const a = fixture();
  const source = fixture();
  source.categories = [
    {
      id: id(),
      name: "Fast break",
      group: "Attack",
      color: "#ff0000",
      shortcut: 1,
    },
  ];
  const template = makeSetupTemplate(source, "Handball");
  const imported = decodeSetupTemplate(encodeSetupTemplate(template));
  const next = applySetupTemplate(a, imported);
  expect(next.clips).toEqual(a.clips);
  expect(next.categories.find((c) => c.name === "Fast break")).toMatchObject({
    group: "Attack",
    shortcut: null,
  });
  expect(
    next.roster!.players.some((p) => p.id === source.roster!.players[0].id),
  ).toBe(true);
  expect(next.roster!.players).toHaveLength(4);
  expect(() => analysisSchema.parse(next)).not.toThrow();
  expect(a.categories).toHaveLength(3);
});
it("rejects malformed imports rather than dropping unsupported data", () => {
  const template = makeSetupTemplate(fixture(), "Team");
  const text = encodeSetupTemplate(template).replace(
    '"version": 1',
    '"version": 2',
  );
  expect(() => decodeSetupTemplate(text)).toThrow();
});

it("batch tags clear stale identity links while preserving unrelated handball details", () => {
  const existing = fixture().clips[0].handball!;
  expect(mergeHandballTag(existing, { player: "Guest" })).toEqual({
    ...existing,
    player: "Guest",
    player_id: undefined,
  });
  const next = mergeHandballTag(existing, { team: "Visitors" });
  expect(next.team_id).toBeUndefined();
  expect(next.player_id).toBeUndefined();
  expect(next.player).toBeUndefined();
  expect(next.goalkeeper_id).toBe(existing.goalkeeper_id);
  expect(next.outcome).toBe("saved");
  expect(mergeHandballTag(existing, { outcome: "goal" }).player_id).toBe(
    existing.player_id,
  );
});
it("allows repeated category names in separate groups while rejecting duplicates within one group", () => {
  const a = fixture();
  a.categories = [
    { id: id(), name: "Shot", group: "Attack", color: "#ffffff" },
    { id: id(), name: "Shot", group: "Defense", color: "#ffffff" },
  ];
  a.clips[0].category_id = a.categories[0].id;
  expect(() => analysisSchema.parse(a)).not.toThrow();
  a.categories[1].group = "attack";
  expect(() => analysisSchema.parse(a)).toThrow(
    /Category names must be unique/,
  );
});
