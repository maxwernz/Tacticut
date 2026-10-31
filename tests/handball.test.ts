import { describe, expect, it } from "vitest";
import { decode, encode, newAnalysis, type Clip } from "../src/domain";
import {
  fieldOptions,
  handballSchema,
  handballSearchText,
  handballSummary,
  matchesHandball,
  type HandballTag,
} from "../src/handball";

function clip(handball?: HandballTag): Clip {
  return {
    id: crypto.randomUUID(),
    source_video_id: crypto.randomUUID(),
    name: "Play",
    start_ms: 0,
    end_ms: 1000,
    notes: "",
    category_id: null,
    creation_order: 0,
    ...(handball ? { handball } : {}),
  };
}

describe("handball coding", () => {
  it("validates controlled values and trims bounded names", () => {
    expect(
      handballSchema.parse({ team: " Home ", player: " 7 Meyer " }),
    ).toEqual({ team: "Home", player: "7 Meyer" });
    for (const invalid of [
      { team: " " },
      { goalkeeper: "x".repeat(81) },
      { outcome: "win" },
      { goal_zone: "outside" },
    ])
      expect(handballSchema.safeParse(invalid).success).toBe(false);
    for (const [field, options] of Object.entries(fieldOptions))
      for (const option of options)
        expect(
          handballSchema.safeParse({ [field]: option.value }).success,
        ).toBe(true);
  });

  it("preserves all tags in schema 4 and returns to legacy version when removed", () => {
    const analysis = newAnalysis();
    const sourceId = crypto.randomUUID();
    analysis.source_videos.push({
      id: sourceId,
      display_name: "Match",
      location: "/match.mp4",
      relative_path: null,
      duration_ms: 5000,
      byte_size: null,
      fingerprint: null,
    });
    const tagged = clip({
      team: "Home",
      player: "7",
      goalkeeper: "12",
      phase: "fast-break",
      outcome: "saved",
      shot_position: "pivot",
      goal_zone: "top-left",
      defense: "six-zero",
      strength: "equal",
    });
    tagged.source_video_id = sourceId;
    analysis.clips.push(tagged);
    expect(JSON.parse(encode(analysis)).schema_version).toBe(4);
    expect(decode(encode(analysis))).toEqual(analysis);
    delete analysis.clips[0].handball;
    expect(JSON.parse(encode(analysis)).schema_version).toBe(1);
    expect(decode(encode(analysis))).toEqual(analysis);
  });

  it("combines filters exactly and searches human-readable labels", () => {
    const tagged = clip({
      team: "Home",
      player: "7",
      phase: "fast-break",
      outcome: "goal",
    });
    expect(matchesHandball(tagged, { team: "Home", outcome: "goal" })).toBe(
      true,
    );
    expect(matchesHandball(tagged, { team: "Home", outcome: "saved" })).toBe(
      false,
    );
    expect(matchesHandball(clip(), { outcome: "goal" })).toBe(false);
    expect(matchesHandball(clip(), { outcome: "" })).toBe(true);
    expect(handballSearchText(tagged)).toContain("Fast break");
    expect(handballSearchText(tagged)).toContain("Home");
    expect(handballSearchText(clip())).toBe("");
  });

  it("uses explicit shot outcomes and excludes misses/blocks from on-target save rate", () => {
    const summary = handballSummary([
      clip({ outcome: "goal" }),
      clip({ outcome: "goal" }),
      clip({ outcome: "saved" }),
      clip({ outcome: "missed" }),
      clip({ outcome: "blocked" }),
      clip({ outcome: "turnover" }),
      clip({ outcome: "penalty-won" }),
      clip({ outcome: "suspension" }),
      clip({ phase: "positional" }),
      clip(),
      clip({}),
    ]);
    expect(summary).toMatchObject({
      tagged: 9,
      attempts: 5,
      goals: 2,
      saved: 1,
      missed: 1,
      blocked: 1,
      turnovers: 1,
      conversion: 40,
    });
    expect(summary.savePercentage).toBeCloseTo(100 / 3);
    expect(
      handballSummary([clip(), clip({ outcome: "turnover" })]),
    ).toMatchObject({ attempts: 0, conversion: null, savePercentage: null });
    expect(handballSummary([clip({ outcome: "missed" })])).toMatchObject({
      conversion: 0,
      savePercentage: null,
    });
  });
});
