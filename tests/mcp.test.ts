import { describe, expect, it } from "vitest";
import { buildAnalysis } from "../mcp/analysis.mts";
import { leagueMatcher, parseGames } from "../mcp/phoenix.mts";
import { coverRanges, parseClock, planClip, toVideo, type Sync } from "../mcp/timeline.mts";
import { decode } from "../src/domain";

const sync: Sync = { first_half: 120, second_half: 2400 };
const options = { lead_seconds: 20, tail_seconds: 10, timeout_seconds: 60 };

describe("game clock to video time", () => {
  it("counts from the kickoff of each half", () => {
    expect(toVideo(0, 1, sync, [], 60)).toBe(120);
    expect(toVideo(600, 1, sync, [], 60)).toBe(720);
    expect(toVideo(1800, 2, sync, [], 60)).toBe(2400);
    expect(toVideo(2700, 2, sync, [], 60)).toBe(3300);
  });

  it("adds every earlier team time-out of the same half", () => {
    const timeouts = [
      { t: 300, half: 1 as const },
      { t: 900, half: 1 as const },
      { t: 2000, half: 2 as const },
    ];
    expect(toVideo(299, 1, sync, timeouts, 60)).toBe(419);
    expect(toVideo(600, 1, sync, timeouts, 60)).toBe(780);
    expect(toVideo(1200, 1, sync, timeouts, 60)).toBe(1440);
    // A goal in the same second as a time-out came before it.
    expect(toVideo(900, 1, sync, timeouts, 60)).toBe(1080);
    expect(toVideo(2100, 2, sync, timeouts, 60)).toBe(2760);
  });

  it("spreads what time-outs do not explain evenly between sync points", () => {
    // Without the point, 1000 would be at 120 + 1000 + 60 = 1180; the video says 1300.
    const withPoint: Sync = { ...sync, points: [{ game: 1000, video: 1300, half: 1 }] };
    const timeouts = [{ t: 300, half: 1 as const }, { t: 1100, half: 1 as const }];
    expect(toVideo(500, 1, withPoint, timeouts, 60)).toBe(120 + 500 + 60 + 60);
    expect(toVideo(1000, 1, withPoint, timeouts, 60)).toBe(1300);
    // After the last point the same rate (120 s per 1000 s) carries on.
    expect(toVideo(1200, 1, withPoint, timeouts, 60)).toBe(1300 + 200 + 60 + 24);
  });

  it("reads a sync point at a time-out as the restart after it", () => {
    const timeouts = [{ t: 600, half: 1 as const }];
    // Clock stopped at 10:00; play resumed at video 12:50, 10 s earlier than 2:00 + 10:00 + 60 s.
    const withPoint: Sync = { ...sync, points: [{ game: 600, video: 770, half: 1 }] };
    expect(toVideo(600, 1, withPoint, timeouts, 60)).toBe(770);
    expect(toVideo(300, 1, withPoint, timeouts, 60)).toBe(120 + 300 - 10 / 2);
    expect(toVideo(700, 1, withPoint, timeouts, 60)).toBeCloseTo(770 + 100 - (10 / 600) * 100);
  });

  it("ignores sync points of the other half", () => {
    const withPoint: Sync = { ...sync, points: [{ game: 2000, video: 3000, half: 2 }] };
    expect(toVideo(900, 1, withPoint, [], 60)).toBe(1020);
  });

  it("parses clock formats", () => {
    expect(parseClock("47:20")).toBe(2840);
    expect(parseClock("1:02:03")).toBe(3723);
    expect(parseClock("95")).toBe(95);
    expect(() => parseClock("ab:cd")).toThrow();
    expect(() => parseClock("")).toThrow();
  });
});

describe("planning clips", () => {
  it("adds lead and tail and clamps to the video", () => {
    const [clip] = planClip({ game_no: "1", start: "00:05" }, { first_half: 3, second_half: 2400 }, [], options, 4000);
    expect(clip.video_start).toBe(0);
    expect(clip.video_end).toBe(18);
    expect(clip.name).toBe("00:05");
  });

  it("splits a phase across half-time so the break is left out", () => {
    const clips = planClip({ game_no: "1", start: "29:00", end: "31:00", name: "Unterzahl" }, sync, [], options, null);
    expect(clips.map((c) => [c.name, c.half, c.video_start, c.video_end])).toEqual([
      ["Unterzahl (1. HZ)", 1, 120 + 1740 - 20, 120 + 1800 + 10],
      ["Unterzahl (2. HZ)", 2, 2400 - 20, 2460 + 10],
    ]);
  });

  it("treats 30:00 as the end of the first half unless told otherwise", () => {
    expect(planClip({ game_no: "1", start: "30:00" }, sync, [], options, null)[0].half).toBe(1);
    expect(planClip({ game_no: "1", start: "30:00", half: 2 }, sync, [], options, null)[0].half).toBe(2);
  });

  it("rejects a phase that ends before it starts", () => {
    expect(() => planClip({ game_no: "1", start: "12:00", end: "11:00" }, sync, [], options, null)).toThrow();
  });

  it("merges padded ranges that touch", () => {
    expect(
      coverRanges(
        [
          { video_start: 100, video_end: 150 },
          { video_start: 200, video_end: 230 },
          { video_start: 1000, video_end: 1100 },
        ],
        20,
        1110,
      ),
    ).toEqual([
      { start: 80, end: 250 },
      { start: 980, end: 1110 },
    ]);
  });
});

describe("Phönix video list", () => {
  const row = (no: string, video: string) => `
    <tr class="evenlistitem">
      <td><label><input type="radio" name="select" value="X"></label></td><td></td>
      <td>M&auml;nner-Verbandsliga Staffel 4</td><td>${no}</td><td>25.10.2026</td><td>17:00</td>
      <td>TSV B&ouml;nnigheim [mV]</td><td>TSV Knittling. [mV]</td><td>32:33</td>
      <td>${video}</td>
      <td><a class="toggleLink">x</a></td>
    </tr>
    <tr is="video-comment-list" class="evenlistitem" style="display: none;" :paarung="{&quot;PaarungNr&quot;:&quot;9389481&quot;,&quot;PaarSpielNr&quot;:&quot;${no}&quot;}"></tr>`;

  it("reads games, team names without suffix, video links and the h4a id", () => {
    const html = `<table>${row("901216", '<a href="https://vpo3.handball4all.de/vpo_download.php?token=abc%3D&amp;x=1"><span></span>1:19:44</a>')}${row("901217", "-")}</table>`;
    expect(parseGames(html)).toEqual([
      {
        game_no: "901216",
        h4a_id: "9389481",
        league: "Männer-Verbandsliga Staffel 4",
        date: "2026-10-25",
        time: "17:00",
        home: "TSV Bönnigheim",
        guest: "TSV Knittling.",
        result: "32:33",
        video_duration: "1:19:44",
        link: "https://vpo3.handball4all.de/vpo_download.php?token=abc%3D&x=1",
      },
      expect.objectContaining({ game_no: "901217", video_duration: null, link: null }),
    ]);
  });

  it("matches leagues by short or long name", () => {
    const labels = ["Männer-Verbandsliga Staffel 4", "Frauen-Verbandsliga Staffel 4", "Männer-Verbandsliga Staffel 1"];
    const pick = (q: string) => labels.filter(leagueMatcher(q));
    expect(pick("M-VL-4")).toEqual(["Männer-Verbandsliga Staffel 4"]);
    expect(pick("Männer VL 4")).toEqual(["Männer-Verbandsliga Staffel 4"]);
    expect(pick("Frauen")).toEqual(["Frauen-Verbandsliga Staffel 4"]);
    expect(pick("Männer-Verbandsliga")).toHaveLength(2);
  });
});

describe("analysis file", () => {
  it("is a valid Tacticut Analysis with categories, notes and a playlist", () => {
    const text = buildAnalysis({
      title: "Unterzahl Bönnigheim",
      file: "/tmp/x/Unterzahl.analysis",
      sources: [{ key: "901216", path: "/tmp/x/901216.mp4", display_name: "901216", duration: 300.5, byte_size: 10, fingerprint: "f" }],
      clips: [
        { source: "901216", name: "A", category: "Unterzahl", notes: "n", start: 10, end: 40 },
        { source: "901216", name: "B", category: "unterzahl", notes: "", start: 250, end: 400 },
      ],
      playlist: true,
    });
    const a = decode(text);
    expect(a.categories.map((c) => c.name)).toEqual(["Unterzahl"]);
    expect(a.clips.map((c) => [c.start_ms, c.end_ms])).toEqual([[10000, 40000], [250000, 300500]]);
    expect(a.source_videos[0].relative_path).toBe("901216.mp4");
    expect(a.playlists[0].clip_ids).toEqual(a.clips.map((c) => c.id));
  });
});
