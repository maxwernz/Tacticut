import { expect, it } from "vitest";
import {
  analysisSchema,
  decode,
  encode,
  mutate,
  newAnalysis,
  playlistClips,
} from "../src/domain";
function fixture() {
  const a = newAnalysis();
  a.source_videos.push({
    id: crypto.randomUUID(),
    display_name: "Match",
    location: "/match.mp4",
    relative_path: null,
    duration_ms: 10000,
    byte_size: null,
    fingerprint: null,
  });
  a.clips = Array.from({ length: 3 }, (_, i) => ({
    id: crypto.randomUUID(),
    source_video_id: a.source_videos[0].id,
    name: `Clip ${i}`,
    start_ms: i * 2000,
    end_ms: i * 2000 + 1000,
    notes: "",
    category_id: null,
    creation_order: i,
  }));
  a.playlists = [
    {
      id: crypto.randomUUID(),
      name: "Coaching review",
      clip_ids: [a.clips[2].id, a.clips[0].id],
    },
  ];
  return a;
}
it("saves ordered references using v2 and keeps playlist-free files Python-compatible", () => {
  const a = fixture();
  expect(JSON.parse(encode(a)).schema_version).toBe(2);
  expect(decode(encode(a))).toEqual(a);
  expect(playlistClips(a, a.playlists[0])).toEqual([a.clips[2], a.clips[0]]);
  a.playlists = [];
  const payload = JSON.parse(encode(a));
  expect(payload.schema_version).toBe(1);
  expect(payload.analysis.playlists).toBeUndefined();
  expect(decode(JSON.stringify(payload)).playlists).toEqual([]);
});
it("shares Clip edits across playlists, removes deleted references, and leaves original Clips intact when removing a playlist", () => {
  const a = fixture();
  a.playlists.push({
    ...a.playlists[0],
    id: crypto.randomUUID(),
    name: "Second review",
  });
  const edited = mutate(a, (d) => {
    d.clips[2].notes = "Watch the pivot";
  });
  for (const p of edited.playlists)
    expect(playlistClips(edited, p)[0].notes).toBe("Watch the pivot");
  const deleted = mutate(edited, (d) => {
    d.clips = d.clips.filter((c) => c.id !== a.clips[2].id);
  });
  for (const p of deleted.playlists)
    expect(p.clip_ids).toEqual([a.clips[0].id]);
  expect(a.clips).toHaveLength(3);
  expect(
    mutate(a, (d) => {
      d.playlists = [];
    }).clips,
  ).toEqual(a.clips);
  expect(
    mutate(a, (d) => {
      d.source_videos = [];
      d.clips = [];
    }).playlists.every((p) => !p.clip_ids.length),
  ).toBe(true);
});
it("rejects dangling or duplicate references and invalid playlist identities", () => {
  for (const edit of [
    (a: ReturnType<typeof fixture>) =>
      a.playlists[0].clip_ids.push(crypto.randomUUID()),
    (a: ReturnType<typeof fixture>) =>
      a.playlists[0].clip_ids.push(a.playlists[0].clip_ids[0]),
    (a: ReturnType<typeof fixture>) => a.playlists.push({ ...a.playlists[0] }),
    (a: ReturnType<typeof fixture>) => {
      a.playlists[0].name = " ";
    },
  ]) {
    const a = fixture();
    edit(a);
    expect(() => analysisSchema.parse(a)).toThrow();
  }
  expect(() =>
    mutate(fixture(), (a) => a.playlists[0].clip_ids.push(crypto.randomUUID())),
  ).toThrow();
});
