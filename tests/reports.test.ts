import { describe, expect, it } from "vitest";
import { newAnalysis, withClipCategories, type Clip } from "../src/domain";
import {
  buildHandballReport,
  reportCsv,
  reportCsvCell,
  reportHtml,
} from "../src/reports";
import type { HandballTag } from "../src/handball";

function fixture() {
  const analysis = newAnalysis();
  analysis.title = 'Match <review> & "team"';
  const sourceId = crypto.randomUUID();
  analysis.source_videos.push({
    id: sourceId,
    display_name: "Opponent <video>.mp4",
    location: "/match.mp4",
    relative_path: null,
    duration_ms: 10000,
    fingerprint: null,
    byte_size: null,
  });
  function add(name: string, handball?: HandballTag) {
    const clip: Clip = {
      id: crypto.randomUUID(),
      source_video_id: sourceId,
      name,
      start_ms: 1000,
      end_ms: 2000,
      notes: "",
      category_id: analysis.categories[0].id,
      creation_order: analysis.clips.length,
      handball,
    };
    analysis.clips.push(clip);
    return clip;
  }
  const base: HandballTag = {
    team: "Home",
    player: "7",
    goalkeeper: "12",
    shot_position: "left-wing",
    goal_zone: "top-left",
  };
  const goal = add("Goal", { ...base, outcome: "goal" });
  const save = add("Saved", { ...base, outcome: "saved" });
  const miss = add("Miss", {
    ...base,
    outcome: "missed",
    goal_zone: undefined,
  });
  const turnover = add("Turnover", {
    team: "Home",
    player: "7",
    outcome: "turnover",
    goal_zone: "top-left",
  });
  const unclassified = add("Unclassified");
  const other = add("Other team", {
    team: "Away",
    player: "7",
    outcome: "blocked",
  });
  return { analysis, goal, save, miss, turnover, unclassified, other };
}

describe("filtered handball reports", () => {
  it("uses exact selected clip order and rejects empty, duplicate or missing IDs", () => {
    const { analysis, goal, save } = fixture();
    const report = buildHandballReport(analysis, [save.id, goal.id]);
    expect(report.clips.map((clip) => clip.id)).toEqual([save.id, goal.id]);
    expect(report.summary).toMatchObject({
      attempts: 2,
      goals: 1,
      saved: 1,
      conversion: 50,
      savePercentage: 50,
    });
    expect(() => buildHandballReport(analysis, [])).toThrow("at least one");
    expect(() => buildHandballReport(analysis, [goal.id, goal.id])).toThrow(
      "duplicate",
    );
    expect(() => buildHandballReport(analysis, [crypto.randomUUID()])).toThrow(
      "no longer exists",
    );
  });

  it("preserves missing identities and shot targets without treating contextual tags as attempts", () => {
    const { analysis } = fixture();
    const report = buildHandballReport(
      analysis,
      analysis.clips.map((clip) => clip.id),
    );
    expect(report.summary).toMatchObject({
      tagged: 5,
      attempts: 4,
      goals: 1,
      saved: 1,
      missed: 1,
      blocked: 1,
      turnovers: 1,
      conversion: 25,
      savePercentage: 50,
    });
    expect(
      report.players.find(
        (group) => group.team === "Home" && group.name === "7",
      )?.summary,
    ).toMatchObject({ attempts: 3, turnovers: 1 });
    expect(
      report.players.find(
        (group) => group.team === "Away" && group.name === "7",
      )?.summary.blocked,
    ).toBe(1);
    expect(
      report.players.find((group) => group.name === "Player not recorded")
        ?.clips,
    ).toBe(1);
    expect(
      report.goalkeepers.find((group) => group.name === "12")?.summary.attempts,
    ).toBe(3);
    expect(
      report.goalkeepers.find(
        (group) => group.name === "Goalkeeper not recorded",
      )?.summary.attempts,
    ).toBe(1);
    expect(
      report.positions.reduce(
        (sum, sector) => sum + sector.summary.attempts,
        0,
      ),
    ).toBe(4);
    expect(
      report.targets.find((sector) => sector.value === "top-left")?.summary
        .attempts,
    ).toBe(2);
    expect(
      report.targets.find((sector) => sector.value === "")?.summary.attempts,
    ).toBe(2);
    expect(
      report.targets.reduce((sum, sector) => sum + sector.summary.attempts, 0),
    ).toBe(4);
  });

  it("escapes every user field in self-contained printable HTML", () => {
    const { analysis, goal } = fixture();
    goal.handball = {
      team: '<img src="https://bad.test/x">',
      player: "<script>alert(1)</script>",
      outcome: "goal",
    };
    const html = reportHtml(buildHandballReport(analysis, [goal.id]));
    expect(html).toContain("Match &lt;review&gt; &amp; &quot;team&quot;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=&quot;https://bad.test/x&quot;&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img ");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("Shooter’s perspective");
    expect(html).toContain("break-inside: avoid");
    expect(html).toContain("Target not recorded: 1 shots");
  });

  it("emits RFC-quoted clip data with formula-defense and readable tag labels", () => {
    const { analysis, goal } = fixture();
    goal.name = '=HYPERLINK("https://bad.test")';
    goal.notes = 'He said "watch", then\nmove';
    goal.handball = {
      team: " @danger",
      player: "+command",
      goalkeeper: "\tdata",
      phase: "fast-break",
      outcome: "goal",
    };
    const csv = reportCsv(buildHandballReport(analysis, [goal.id]));
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"\'=HYPERLINK(""https://bad.test"")"');
    expect(csv).toContain('"\' @danger"');
    expect(csv).toContain('"\'+command"');
    expect(csv).toContain('"\'\tdata"');
    expect(csv).toContain('"He said ""watch"", then\nmove"');
    expect(csv).toContain('"Fast break","Goal"');
    expect(csv).toContain(",1000,2000,1000,");
    expect(csv.endsWith("\r\n")).toBe(true);
    for (const dangerous of [
      "=1+1",
      "-2+3",
      "+4",
      "@sum",
      "\ttext",
      "\rtext",
      "\ntext",
      "   =sum",
    ])
      expect(reportCsvCell(dangerous)).toBe(`"'${dangerous}"`);
    expect(reportCsvCell("7 Meyer")).toBe('"7 Meyer"');
  });
});
it("includes every selected Category in the clip CSV without duplicating the observation", () => {
  const { analysis, goal } = fixture();
  analysis.clips[0] = withClipCategories(goal, [
    analysis.categories[0].id,
    analysis.categories[1].id,
  ]);
  const report = buildHandballReport(analysis, [goal.id]);
  expect(reportCsv(report)).toContain('"Abwehr · Angriff"');
  expect(report.clips).toHaveLength(1);
  expect(report.summary.attempts).toBe(1);
});

it("localizes German report headings and fixed tags while preserving user names, categories and notes", () => {
  const { analysis, goal } = fixture();
  analysis.title = "Shooting report";
  analysis.categories[0].name = "Goal";
  goal.handball = {
    team: "Start",
    player: "Player not recorded",
    outcome: "saved",
    shot_position: "left-wing",
  };
  goal.notes = "Saved shot";
  const before = JSON.stringify(analysis);
  const report = buildHandballReport(analysis, [goal.id]);
  const html = reportHtml(report, "de");
  expect(html).toContain('<html lang="de">');
  expect(html).toContain("<h1>Shooting report</h1>");
  expect(html).toContain(">Player not recorded</td>");
  expect(html).toContain(">Torquote</th>");
  expect(html).toContain("<th>Spieler</th>");
  expect(html).toContain("100,0%");
  expect(html).toContain(">Linksaußen</td>");
  expect(html).toContain("Torhüter nicht erfasst");
  const csv = reportCsv(report, "de");
  expect(csv).toContain('"Goal","Start","Player not recorded"');
  expect(csv).toContain('"Gehaltener Wurf","Linksaußen"');
  expect(csv).toContain('"Saved shot"');
  expect(JSON.stringify(analysis)).toBe(before);
});
