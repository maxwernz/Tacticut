import { describe, it, expect } from "vitest";
import {
  analysisSchema,
  captureRange,
  clipCategoryIds,
  clipCategoryLabels,
  withClipCategories,
  decode,
  encode,
  exportOrder,
  mutate,
  newAnalysis,
  parseTimecode,
  timecode,
  type Analysis,
} from "../src/domain";
function fixture(): Analysis {
  const a = newAnalysis();
  a.source_videos.push({
    id: crypto.randomUUID(),
    display_name: "Match",
    location: "/match.mp4",
    relative_path: "match.mp4",
    duration_ms: 90000,
    byte_size: 100,
    fingerprint: "abc",
  });
  a.clips.push({
    id: crypto.randomUUID(),
    source_video_id: a.source_videos[0].id,
    name: "Goal",
    start_ms: 1000,
    end_ms: 4000,
    notes: "Great pass",
    category_id: a.categories[2].id,
    creation_order: 0,
  });
  return a;
}
it("clamps quick capture context at both video boundaries", () => {
  expect(captureRange(10000, 60000, 8000, 3000)).toEqual({
    start_ms: 2000,
    end_ms: 13000,
  });
  expect(captureRange(2000, 60000, 8000, 3000)).toEqual({
    start_ms: 0,
    end_ms: 5000,
  });
  expect(captureRange(59000, 60000, 8000, 3000)).toEqual({
    start_ms: 51000,
    end_ms: 60000,
  });
  expect(() => captureRange(0, 60000, 0, 0)).toThrow();
  expect(() => captureRange(0, NaN, 8000, 3000)).toThrow();
});
describe("Python Analysis compatibility and invariants", () => {
  it("round trips every durable field in schema version 1", () => {
    const a = fixture();
    a.source_videos[0].display_name = "  Match title  ";
    a.clips[0].name = "  Original Clip title  ";
    expect(decode("\uFEFF" + encode(a))).toEqual(a);
  });
  it("rejects future schemas, unsafe pickle, and empty saved Analyses", () => {
    expect(() =>
      decode(
        encode(fixture()).replace('"schema_version": 1', '"schema_version": 8'),
      ),
    ).toThrow();
    expect(() => decode("\x80\x04pickle")).toThrow(/Python app/);
    expect(() => encode(newAnalysis())).toThrow(/Source video/);
  });
  it("does not mutate the original on a rejected edit", () => {
    const a = fixture(),
      before = structuredClone(a);
    expect(() =>
      mutate(a, (d) => {
        d.title = "Changed";
        d.clips[0].end_ms = 999999;
      }),
    ).toThrow();
    expect(a).toEqual(before);
  });
  it("rejects orphan clips, duplicate media, normalized Category collisions and invalid intervals", () => {
    for (const edit of [
      (a: Analysis) => {
        a.clips[0].source_video_id = crypto.randomUUID();
      },
      (a: Analysis) => {
        a.source_videos.push({
          ...a.source_videos[0],
          id: crypto.randomUUID(),
        });
      },
      (a: Analysis) => {
        a.categories[1].name = "  ABWEHR  ";
      },
      (a: Analysis) => {
        a.clips[0].end_ms = a.clips[0].start_ms;
      },
      (a: Analysis) => {
        a.clips[0].creation_order = 5;
      },
    ]) {
      const a = fixture();
      edit(a);
      expect(() => analysisSchema.parse(a)).toThrow();
    }
  });
  it("keeps export ordering separate and puts uncategorized clips last", () => {
    const a = fixture();
    a.clips.push(
      {
        ...a.clips[0],
        id: crypto.randomUUID(),
        category_id: a.categories[0].id,
        creation_order: 1,
      },
      {
        ...a.clips[0],
        id: crypto.randomUUID(),
        category_id: null,
        creation_order: 2,
      },
    );
    const before = JSON.stringify(a);
    expect(
      exportOrder(a, [
        ...a.clips.map((c) => c.id),
        a.clips[0].id,
        "missing",
      ]).map((c) => c.category_id),
    ).toEqual([a.categories[0].id, a.categories[2].id, null]);
    expect(JSON.stringify(a)).toBe(before);
    expect(analysisSchema.parse(a)).toEqual(a);
  });
  it("uses millisecond timecodes without losing hours", () => {
    expect(timecode(3723456)).toBe("01:02:03.456");
    expect(parseTimecode("01:02:03.456")).toBe(3723456);
    expect(parseTimecode("13.125")).toBe(13125);
    expect(() => parseTimecode("1:99")).toThrow();
  });
});

it("round trips multiple Categories in v7 while normalizing single/empty selections to legacy fields", () => {
  const a = fixture(),
    before = structuredClone(a.clips[0]);
  const selected = [a.categories[2].id, a.categories[0].id];
  a.clips[0] = withClipCategories(a.clips[0], selected);
  expect(clipCategoryIds(a.clips[0])).toEqual(selected);
  expect(clipCategoryLabels(a.clips[0], a.categories)).toEqual([
    "Tor",
    "Abwehr",
  ]);
  expect(JSON.parse(encode(a)).schema_version).toBe(7);
  expect(decode(encode(a))).toEqual(a);
  const ids = clipCategoryIds(a.clips[0]);
  ids.reverse();
  expect(a.clips[0].category_ids).toEqual(selected);
  a.clips[0] = withClipCategories(a.clips[0], [
    a.categories[2].id,
    a.categories[2].id,
  ]);
  expect(a.clips[0]).toEqual(before);
  expect(JSON.parse(encode(a)).schema_version).toBe(1);
  a.clips[0] = withClipCategories(a.clips[0], []);
  expect(a.clips[0].category_id).toBeNull();
  expect(a.clips[0].category_ids).toBeUndefined();
});
it("rejects duplicate, dangling, nonprimary-first and redundant category arrays", () => {
  const a = fixture(),
    primary = a.clips[0].category_id!;
  for (const ids of [
    [primary, primary],
    [primary, crypto.randomUUID()],
    [a.categories[0].id, primary],
    [],
    [primary],
    Array.from({ length: 101 }, () => crypto.randomUUID()),
  ]) {
    a.clips[0].category_ids = ids;
    expect(() => analysisSchema.parse(a)).toThrow();
  }
});
it("round trips category-filtered views in v7 and rejects orphan/duplicate saved filters", () => {
  const a = fixture();
  a.handball_views = [
    {
      id: crypto.randomUUID(),
      name: "Coaching theme",
      filters: { outcome: "goal" },
      query: "",
      source_video_id: null,
      category_ids: [a.categories[0].id],
    },
  ];
  expect(JSON.parse(encode(a)).schema_version).toBe(7);
  expect(decode(encode(a))).toEqual(a);
  a.handball_views[0].category_ids = [a.categories[0].id, a.categories[0].id];
  expect(() => analysisSchema.parse(a)).toThrow(/must be unique/);
  a.handball_views[0].category_ids = [crypto.randomUUID()];
  expect(() => analysisSchema.parse(a)).toThrow(/unknown Category/);
  delete a.handball_views[0].category_ids;
  expect(JSON.parse(encode(a)).schema_version).toBe(5);
});
