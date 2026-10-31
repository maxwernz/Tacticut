import { tFor, type Language } from "./i18n";
import {
  type Analysis,
  type Clip,
  timecode,
  categoryLabel,
  clipCategoryIds,
} from "./domain";
import { fieldOptions, handballSummary, type HandballTag } from "./handball";

export type ReportSummary = ReturnType<typeof handballSummary>;
export type ReportGroup = {
  team: string;
  name: string;
  teamMissing: boolean;
  nameMissing: boolean;
  clips: number;
  summary: ReportSummary;
};
export type ReportSector = {
  value: string;
  label: string;
  summary: ReportSummary;
};
export type HandballReport = {
  title: string;
  titleMissing: boolean;
  clips: Clip[];
  sources: string[];
  sourceNames: Record<string, string>;
  categoryNames: Record<string, string>;
  summary: ReportSummary;
  players: ReportGroup[];
  goalkeepers: ReportGroup[];
  positions: ReportSector[];
  targets: ReportSector[];
};
const attemptOutcomes = new Set(["goal", "saved", "missed", "blocked"]);
export const isRecordedShot = (clip: Clip) =>
  attemptOutcomes.has(clip.handball?.outcome || "");

/** Keep the caller's filtered ordering; never silently substitute all clips. */
export function buildHandballReport(
  analysis: Analysis,
  ids: string[],
): HandballReport {
  if (!ids.length) throw new Error("Choose at least one Clip for the report");
  if (new Set(ids).size !== ids.length)
    throw new Error("Report list contains duplicate Clips");
  const byId = new Map(analysis.clips.map((clip) => [clip.id, clip]));
  const clips = ids.map((id) => {
    const clip = byId.get(id);
    if (!clip) throw new Error("A report Clip no longer exists");
    return clip;
  });
  function groups(
    rows: Clip[],
    identity: "player" | "goalkeeper",
  ): ReportGroup[] {
    const grouped = new Map<
      string,
      {
        team: string;
        name: string;
        teamMissing: boolean;
        nameMissing: boolean;
        clips: Clip[];
      }
    >();
    for (const clip of rows) {
      const team = clip.handball?.team || "Team not recorded";
      const name =
        clip.handball?.[identity] ||
        `${identity === "player" ? "Player" : "Goalkeeper"} not recorded`;
      const key = JSON.stringify([
        clip.handball?.team_id ?? clip.handball?.team ?? null,
        clip.handball?.[`${identity}_id`] ?? clip.handball?.[identity] ?? null,
      ]);
      const group = grouped.get(key) || {
        team,
        name,
        teamMissing: !clip.handball?.team,
        nameMissing: !clip.handball?.[identity],
        clips: [],
      };
      group.clips.push(clip);
      grouped.set(key, group);
    }
    return [...grouped.values()]
      .sort(
        (a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name),
      )
      .map((group) => ({
        team: group.team,
        name: group.name,
        teamMissing: group.teamMissing,
        nameMissing: group.nameMissing,
        clips: group.clips.length,
        summary: handballSummary(group.clips),
      }));
  }
  const shots = clips.filter(isRecordedShot);
  function sectors(field: "shot_position" | "goal_zone"): ReportSector[] {
    const result = fieldOptions[field].map((option) => ({
      ...option,
      summary: handballSummary(
        shots.filter((clip) => clip.handball?.[field] === option.value),
      ),
    }));
    result.push({
      value: "",
      label: "Not recorded",
      summary: handballSummary(shots.filter((clip) => !clip.handball?.[field])),
    });
    return result;
  }
  const sourceNames = Object.fromEntries(
    analysis.source_videos.map((source) => [source.id, source.display_name]),
  );
  const sourceIds = new Set(clips.map((clip) => clip.source_video_id));
  return {
    title: analysis.title.trim() || "Handball analysis",
    titleMissing: !analysis.title.trim(),
    clips,
    sources: analysis.source_videos
      .filter((source) => sourceIds.has(source.id))
      .map((source) => source.display_name),
    sourceNames,
    categoryNames: Object.fromEntries(
      analysis.categories.map((category) => [
        category.id,
        categoryLabel(category),
      ]),
    ),
    summary: handballSummary(clips),
    players: groups(clips, "player"),
    goalkeepers: groups(shots, "goalkeeper"),
    positions: sectors("shot_position"),
    targets: sectors("goal_zone"),
  };
}
export function handballLabel(
  field: keyof HandballTag,
  value: string | undefined,
): string {
  if (!value) return "";
  const options = fieldOptions[field as keyof typeof fieldOptions];
  return options?.find((option) => option.value === value)?.label || value;
}
export const escapeReportHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
const percent = (value: number | null, language: Language = "en") =>
  value == null
    ? "—"
    : `${language === "de" ? value.toFixed(1).replace(".", ",") : value.toFixed(1)}%`;
const summaryCells = (summary: ReportSummary, language: Language) =>
  `<td>${summary.attempts}</td><td>${summary.goals}</td><td>${summary.saved}</td><td>${summary.missed}</td><td>${summary.blocked}</td><td>${summary.turnovers}</td><td>${percent(summary.conversion, language)}</td><td>${percent(summary.savePercentage, language)}</td>`;

/** Fully self-contained HTML: no scripts, images, remote fonts, or external URLs. */
export function reportHtml(
  report: HandballReport,
  language: Language = "en",
): string {
  const e = escapeReportHtml;
  const t = (source: string, params?: Record<string, string | number>) =>
    e(tFor(language, source, params));
  const title = report.titleMissing ? t("Handball analysis") : e(report.title);
  const statsHead = [
    "Shots",
    "Goals",
    "Saves",
    "Misses",
    "Blocks",
    "TO",
    "Goal %",
    "Save %",
  ]
    .map((label) => `<th>${t(label)}</th>`)
    .join("");
  const groupsTable = (
    groups: ReportGroup[],
    heading: string,
    identity: string,
  ) =>
    `<section><h2>${t(heading)}</h2><table><thead><tr><th>${t("Attacking team")}</th><th>${t(identity)}</th>${statsHead}</tr></thead><tbody>${groups.length ? groups.map((group) => `<tr><td class="identity">${group.teamMissing ? t("Team not recorded") : e(group.team)}</td><td class="identity">${group.nameMissing ? t(group.name) : e(group.name)}</td>${summaryCells(group.summary, language)}</tr>`).join("") : `<tr><td colspan="10">${t("No recorded shots in this selection.")}</td></tr>`}</tbody></table></section>`;
  const sectorsTable = (rows: ReportSector[]) =>
    `<table><thead><tr><th>${t("Position")}</th><th>${t("Shots")}</th><th>${t("Goals")}</th><th>${t("Goal %")}</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${t(row.label)}</td><td>${row.summary.attempts}</td><td>${row.summary.goals}</td><td>${percent(row.summary.conversion, language)}</td></tr>`).join("")}</tbody></table>`;
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><title>${title} · ${t("Shooting report")}</title><style>
@page { size: A4; margin: 14mm; }
* { box-sizing: border-box; } body { margin: 0; font: 10px/1.5 Arial, sans-serif; color: #18242c; }
h1 { font-size: 25px; line-height: 1.15; margin: 5px 0 8px; overflow-wrap: anywhere; }
h2 { font-size: 14px; margin: 22px 0 8px; } p { margin: 5px 0; } .brand { color: #b82155; font-size: 10px; font-weight: bold; letter-spacing: 2px; }
.subtitle, .conventions { color: #52616b; } .subtitle { overflow-wrap: anywhere; } .conventions { border-top: 1px solid #cbd4da; margin-top: 18px; padding-top: 8px; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; } th, td { padding: 6px 4px; border-bottom: 1px solid #dce1e5; text-align: right; vertical-align: top; } th { color: #52616b; font-size: 8px; background: #f2f5f7; } td:first-child, th:first-child, .identity { text-align: left; } .identity { max-width: 115px; overflow-wrap: anywhere; }
thead { display: table-header-group; } tr { break-inside: avoid; } h2 { break-after: avoid; }
.metrics { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-top: 18px; } .metric { border-top: 3px solid #b82155; padding-top: 6px; } .metric strong { display: block; font-size: 21px; } .metric span { font-size: 9px; color: #52616b; }
.sectors { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; break-inside: avoid; } .goal { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px; border: 2px solid #52616b; border-bottom: 0; padding: 4px; } .zone { padding: 7px 2px; background: #f2f5f7; text-align: center; } .zone strong { display: block; font-size: 16px; } .zone span { font-size: 8px; }
</style></head><body><div class="brand">TACTICUT · ${t("SHOOTING REPORT")}</div><h1>${title}</h1><p class="subtitle">${t("{clips} selected clips · {tagged} with handball tags · {sources} source videos", { clips: report.clips.length, tagged: report.summary.tagged, sources: report.sources.length })}</p><p class="subtitle">${report.sources.map(e).join(" · ")}</p>
<div class="metrics">${[
    [report.summary.attempts, "Recorded shots"],
    [report.summary.goals, "Goals"],
    [percent(report.summary.conversion, language), "Conversion"],
    [report.summary.saved, "Saves"],
    [percent(report.summary.savePercentage, language), "On-target save %"],
    [report.summary.turnovers, "Turnovers"],
  ]
    .map(
      ([value, label]) =>
        `<div class="metric"><strong>${value}</strong><span>${t(String(label))}</span></div>`,
    )
    .join("")}</div>
${groupsTable(report.players, "Attacking players", "Player")}
${groupsTable(report.goalkeepers, "Defending goalkeepers", "Goalkeeper")}
<p class="subtitle">${t("Goalkeeper rows are grouped by the attacking team they faced. A goalkeeper’s own team is not inferred.")}</p>
<div class="sectors"><section><h2>${t("Shot origins")}</h2>${sectorsTable(report.positions)}</section><section><h2>${t("Goal targets")}</h2><p class="subtitle">${t("Shooter’s perspective · goals / shots")}</p><div class="goal">${report.targets
    .slice(0, 9)
    .map(
      (row) =>
        `<div class="zone"><span>${t(row.label)}</span><strong>${row.summary.goals} / ${row.summary.attempts}</strong></div>`,
    )
    .join(
      "",
    )}</div><p class="subtitle">${t("Target not recorded: {count} shots", { count: report.targets[9].summary.attempts })}</p></section></div>
<div class="conventions"><strong>${t("How to read this report")}</strong><p>${t("Counts describe the selected tagged clips, not official match totals. Each clip is one observation; duplicate clips of one event count separately. A shot requires an explicit Goal, Saved shot, Missed shot or Blocked shot outcome. Position or target tags alone do not create attempts.")}</p><p>${t("Goal % = goals ÷ all recorded shots. On-target Save % = saves ÷ (goals + saves); misses and blocks are excluded. TO = turnovers. A dash means there is no denominator. Missing player, goalkeeper and position tags remain visible as “not recorded”.")}</p></div></body></html>`;
}

/** RFC 4180 quoting with spreadsheet-formula protection for user-provided strings. */
export function reportCsvCell(value: string): string {
  const protectedValue = /^[\t\r\n]|^\s*[=+\-@]/u.test(value)
    ? `'${value}`
    : value;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}
export function reportCsv(
  report: HandballReport,
  language: Language = "en",
): string {
  const t = (source: string) => tFor(language, source);
  const header = [
    "Clip",
    "Source video",
    "Start",
    "End",
    "Start ms",
    "End ms",
    "Duration ms",
    "Category",
    "Attacking team",
    "Attacking player",
    "Defending goalkeeper",
    "Tactical phase",
    "Outcome",
    "Shot origin",
    "Goal target (shooter view)",
    "Defense faced",
    "Attacking strength",
    "Notes",
  ];
  const rows = report.clips.map((clip) => {
    const h = clip.handball || {};
    return [
      reportCsvCell(clip.name),
      reportCsvCell(report.sourceNames[clip.source_video_id] || ""),
      reportCsvCell(timecode(clip.start_ms)),
      reportCsvCell(timecode(clip.end_ms)),
      String(clip.start_ms),
      String(clip.end_ms),
      String(clip.end_ms - clip.start_ms),
      reportCsvCell(
        clipCategoryIds(clip)
          .map((id) => report.categoryNames[id] || "")
          .filter(Boolean)
          .join(" · "),
      ),
      ...(
        [
          "team",
          "player",
          "goalkeeper",
          "phase",
          "outcome",
          "shot_position",
          "goal_zone",
          "defense",
          "strength",
        ] as const
      ).map((field) =>
        reportCsvCell(
          fieldOptions[field as keyof typeof fieldOptions]
            ? t(handballLabel(field, h[field]))
            : h[field] || "",
        ),
      ),
      reportCsvCell(clip.notes),
    ].join(",");
  });
  return (
    "\uFEFF" +
    [header.map(t).map(reportCsvCell).join(","), ...rows].join("\r\n") +
    "\r\n"
  );
}
