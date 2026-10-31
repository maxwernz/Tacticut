// MCP server (stdio): finds match videos in the BWHV Phönix portal, syncs game clock
// with video time, and turns game-time moments into Tacticut Analyses or MP4 clips.
// Start: node --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON mcp/server.mts

import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildAnalysis, type AnalysisClip, type SourceFile } from "./analysis.mts";
import { concat, contactSheet, cut, download, fingerprint, frame, probe } from "./media.mts";
import { Phoenix, type PhoenixGame } from "./phoenix.mts";
import { gameStats, library, readState, safeName, statsDb, updateGame, type GameStats } from "./store.mts";
import {
  coverRanges,
  gameClock,
  parseClock,
  planClip,
  syncPoints,
  toVideo,
  videoClock,
  type ClipRequest,
  type PlannedClip,
  type Sync,
} from "./timeline.mts";

const phoenix = new Phoenix();
const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const failure = (err: unknown) => ({ ...text(`Fehler: ${(err as Error).message ?? err}`), isError: true });

type Extra = {
  _meta?: { progressToken?: string | number };
  sendNotification: (n: { method: "notifications/progress"; params: { progressToken: string | number; progress: number; total?: number; message?: string } }) => Promise<void>;
};
function reporter(extra: Extra) {
  return (progress: number, total: number, message: string) => {
    console.error(message);
    const token = extra._meta?.progressToken;
    if (token !== undefined)
      void extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress, total, message } }).catch(() => {});
  };
}

const games = new Map<string, PhoenixGame>();
async function gameInfo(gameNo: string) {
  if (!games.has(gameNo)) games.set(gameNo, await phoenix.game(gameNo));
  return games.get(gameNo)!;
}

/** Local download if there is one, else the portal's MP4 address. */
async function source(gameNo: string, fresh = false) {
  const state = (await readState()).games[gameNo];
  if (state?.file && existsSync(state.file)) return state.file;
  return phoenix.source(gameNo, fresh);
}

/** Runs FFmpeg work on a game's video; an expired portal link is renewed once. */
async function withSource<T>(gameNo: string, work: (src: string) => Promise<T>): Promise<T> {
  try {
    return await work(await source(gameNo));
  } catch (err) {
    if (!/\b(40[134]|410)\b|Server returned|Invalid data/i.test((err as Error).message)) throw err;
    return work(await source(gameNo, true));
  }
}

async function duration(gameNo: string) {
  const state = (await readState()).games[gameNo];
  if (state?.duration) return state.duration;
  const { duration } = await withSource(gameNo, probe);
  await updateGame(gameNo, (g) => (g.duration = duration));
  return duration;
}

const clipSchema = z.object({
  game_no: z.string().regex(/^\d+$/).describe("h4a-Spielnummer, z. B. '901216' (handball-bw: games.game_no)"),
  start: z.string().describe("Spielzeit MM:SS, z. B. '22:05' (2. Halbzeit: '47:20')"),
  end: z.string().optional().describe("Ende einer Phase in Spielzeit; weglassen bei Einzelereignissen"),
  half: z.union([z.literal(1), z.literal(2)]).optional().describe("Halbzeit, falls 30:00 gemeint ist (events.half)"),
  name: z.string().optional(),
  category: z.string().optional().describe("Kategorie in Tacticut, z. B. 'Unterzahl'"),
  notes: z.string().optional(),
  lead_seconds: z.number().min(0).max(300).optional(),
  tail_seconds: z.number().min(0).max(300).optional(),
});
const planOptions = {
  lead_seconds: z.number().min(0).max(300).default(20).describe("Vorlauf vor dem Start (Standard 20 s)"),
  tail_seconds: z.number().min(0).max(300).default(10).describe("Nachlauf nach dem Ende (Standard 10 s)"),
  timeout_seconds: z.number().min(0).max(300).default(70).describe("Videozeit, die eine Team-Auszeit kostet (Standard 70 s)"),
};

async function plan(
  requests: ClipRequest[],
  options: { lead_seconds: number; tail_seconds: number; timeout_seconds: number },
) {
  const state = await readState();
  const missing = [...new Set(requests.map((r) => r.game_no))].filter((no) => !state.games[no]?.sync);
  if (missing.length)
    throw new Error(
      `Für ${missing.join(", ")} sind die Anpfiffe noch nicht gesetzt. Erst mit contact_sheet suchen, dann set_sync.`,
    );
  const stats = new Map<string, GameStats>();
  const warnings: string[] = [];
  const clips: PlannedClip[] = [];
  for (const r of requests) {
    if (!stats.has(r.game_no)) {
      const s = gameStats(r.game_no);
      stats.set(r.game_no, s);
      if (!s) warnings.push(`Spiel ${r.game_no}: keine Auszeiten bekannt (Datenbank ${statsDb} fehlt oder kennt das Spiel nicht); Zeiten können sich später in der Halbzeit verschieben.`);
      else if (!s.has_report) warnings.push(`Spiel ${r.game_no}: kein Spielbericht, Auszeiten unbekannt.`);
    }
    const g = state.games[r.game_no];
    clips.push(...planClip(r, g.sync!, stats.get(r.game_no)?.timeouts ?? [], options, g.duration ?? (await duration(r.game_no))));
  }
  const unchecked = new Set<string>();
  for (const c of clips)
    if (syncPoints(state.games[c.game_no].sync!, c.half).length === 1 && c.game_end - (c.half === 1 ? 0 : 1800) > 600)
      unchecked.add(`${c.game_no}, ${c.half}. Halbzeit`);
  for (const u of unchecked)
    warnings.push(`${u}: nur der Anpfiff ist abgeglichen. Gegen Ende der Halbzeit können Clips Minuten zu früh liegen; Auszeiten oder Hallenanzeige als Punkte mit set_sync ergänzen.`);
  return { clips, stats, warnings };
}

const describeClip = (c: PlannedClip) =>
  `${c.game_no} · ${c.name} · Spielzeit ${gameClock(c.game_start)}${c.game_end !== c.game_start ? `–${gameClock(c.game_end)}` : ""}` +
  ` → Video ${videoClock(c.video_start)}–${videoClock(c.video_end)}` +
  (c.timeouts_before ? ` (${c.timeouts_before} Auszeit${c.timeouts_before > 1 ? "en" : ""} eingerechnet)` : "");

function gameTitle(no: string, stats: GameStats | undefined, info?: PhoenixGame) {
  const home = stats?.home ?? info?.home;
  const guest = stats?.guest ?? info?.guest;
  return home && guest ? `${no} ${home} – ${guest}` : no;
}

async function freeFile(dir: string, name: string, ext: string) {
  for (let i = 1; ; i++) {
    const path = join(dir, `${name}${i > 1 ? ` ${i}` : ""}${ext}`);
    if (!existsSync(path)) return path;
  }
}

const server = new McpServer(
  { name: "tacticut", version: "1.0.0" },
  {
    instructions:
      "Spielvideos der BWHV-Verbandsligen aus dem Phönix-Videoportal und Clips daraus für Tacticut. " +
      "Ablauf: Momente (Spielzeit + game_no) mit dem handball-bw-MCP finden → list_games prüft, ob es Videos gibt → " +
      "pro Spiel einmal die Anpfiffe beider Halbzeiten finden (contact_sheet, frame; am genauesten über die Hallenanzeige) und mit set_sync speichern → " +
      "plan_clips zur Kontrolle → " +
      "create_analysis (Tacticut-Datei) und/oder export_clips (MP4). Antworte auf Deutsch.",
  },
);

server.registerTool(
  "list_games",
  {
    title: "Spiele mit Video",
    description:
      "Listet Spiele aus dem Phönix-Videoportal (BWHV-Verbandsligen): game_no, Datum, Teams, Ergebnis, Videolänge, " +
      "ob die Anpfiffe schon gesetzt sind (synced) und ob das Video lokal liegt.",
    inputSchema: {
      league: z.string().optional().describe("z. B. 'M-VL-4' oder 'Männer-Verbandsliga Staffel 4'"),
      team: z.string().optional().describe("Teil eines Teamnamens, z. B. 'Bönnigheim'"),
      season: z.string().optional().describe("Startjahr der Saison, z. B. '2025' für 2025/26; Standard aktuelle"),
      with_video: z.boolean().default(true),
      limit: z.number().int().min(1).max(500).default(40),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ league, team, season, with_video, limit }) => {
    try {
      const rows = await phoenix.games({ league, team, season, withVideo: with_video, limit });
      const state = await readState();
      for (const r of rows) games.set(r.game_no, r);
      return text(
        JSON.stringify(
          rows.map(({ link: _link, ...r }) => ({
            ...r,
            synced: !!state.games[r.game_no]?.sync,
            downloaded: !!state.games[r.game_no]?.file,
          })),
        ),
      );
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "contact_sheet",
  {
    title: "Bildleiste aus dem Video",
    description:
      "Gibt ein Bild mit Standbildern in festen Abständen zurück, jedes mit seiner Videozeit beschriftet (zeilenweise von links nach rechts). " +
      "Abstände bis 20 s werden in einem Durchgang gelesen (≈ 20 s für 3 Minuten Video); größere Abstände springen zum nächsten Schlüsselbild " +
      "(alle paar Sekunden), die Beschriftung zeigt dann die tatsächliche Zeit. Vorgehen für die Anpfiffe: " +
      "1) Übersicht über das ganze Video mit every_seconds 150–180: die Halbzeitpause zeigt ein leeres Feld oder Spieler an den Bänken, " +
      "oder sie ist herausgeschnitten (Bildsprung). Die 2. Halbzeit beginnt frühestens 30 Minuten plus etwa 1 Minute je Auszeit der 1. Halbzeit nach dem ersten Anpfiff. " +
      "Viele Videos beginnen mit Einlaufen und Begrüßung. " +
      "2) Um die Kandidaten every_seconds 5: Anwurf = beide Teams in ihren Hälften, ein Spieler mit Ball an der Mittellinie, danach läuft das Spiel. " +
      "3) every_seconds 1 für die genaue Sekunde. Höchstens 40 Bilder pro Aufruf. Bei Unsicherheit den Nutzer fragen, " +
      "er kann die Zeiten auch direkt im Browser ablesen.",
    inputSchema: {
      game_no: z.string().regex(/^\d+$/),
      from: z.string().default("0:00").describe("Videozeit H:MM:SS oder MM:SS"),
      to: z.string().optional().describe("Videozeit; Standard: so weit, wie 40 Bilder reichen"),
      every_seconds: z.number().min(0.5).max(600).default(60),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ game_no, from, to, every_seconds }) => {
    try {
      const total = await duration(game_no);
      const start = parseClock(from);
      const end = Math.min(total - 0.5, to ? parseClock(to) : start + every_seconds * 39);
      if (start >= total) throw new Error(`Das Video ist nur ${videoClock(total)} lang.`);
      const count = Math.floor((end - start) / every_seconds + 1e-6) + 1;
      if (count > 40) throw new Error("Höchstens 40 Bilder: größeren Abstand oder kürzeren Bereich wählen.");
      const image = await withSource(game_no, (src) => contactSheet(src, start, every_seconds, count));
      return {
        content: [
          { type: "image" as const, data: image.toString("base64"), mimeType: "image/jpeg" },
          { type: "text" as const, text: `Spiel ${game_no}: ${count} Bilder ab ${videoClock(start)}, alle ${every_seconds} s. Videolänge ${videoClock(total)}.` },
        ],
      };
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "frame",
  {
    title: "Einzelbild",
    description:
      "Ein Bild in voller Auflösung, optional ein vergrößerter Ausschnitt (Anteile des Bildes, 0–1). Gut, um die Hallenanzeige " +
      "(Spielzeit, Spielstand) abzulesen, wenn sie im Bild ist: Spielzeit X bei Videozeit V ergibt einen genauen Synchronpunkt " +
      "(Anpfiff der Halbzeit = V − (X − Halbzeitbeginn), solange dazwischen keine Auszeit lag). Erst ganzes Bild, dann auf die Anzeige zoomen.",
    inputSchema: {
      game_no: z.string().regex(/^\d+$/),
      time: z.string().describe("Videozeit H:MM:SS oder MM:SS (auch mit Sekundenbruchteilen in Sekunden)"),
      crop: z
        .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.02).max(1), h: z.number().min(0.02).max(1) })
        .optional()
        .describe("Ausschnitt: linke obere Ecke x,y und Breite w, Höhe h als Anteil des Bildes"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ game_no, time, crop }) => {
    try {
      const t = parseClock(time);
      const image = await withSource(game_no, (src) => frame(src, t, crop));
      return {
        content: [
          { type: "image" as const, data: image.toString("base64"), mimeType: "image/jpeg" },
          { type: "text" as const, text: `Spiel ${game_no}, Videozeit ${videoClock(t)}${crop ? " (Ausschnitt)" : ""}.` },
        ],
      };
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "set_sync",
  {
    title: "Spiel und Video abgleichen",
    description:
      "Speichert, wann im Video die Halbzeiten angepfiffen werden, und weitere Abgleichpunkte (Spielzeit ↔ Videozeit). " +
      "Erst beide Anpfiffe setzen, dann Punkte ergänzen – bereits gespeicherte bleiben erhalten (gleiche Spielzeit wird ersetzt). " +
      "Die Antwort nennt für jede Team-Auszeit die erwartete Videozeit: Auszeiten sind im Bild gut zu erkennen (Team im Kreis, Spiel ruht) " +
      "und die zuverlässigsten Punkte. Für eine Auszeit game_time = Zeit der Auszeit und video_time = Wiederanpfiff danach. " +
      "Ebenso gut: eine abgelesene Hallenanzeige (game_time = angezeigte Zeit). Zwischen Punkten wird die Abweichung gleichmäßig verteilt; " +
      "Videos laufen oft mehrere Minuten pro Halbzeit länger als Spielzeit plus Auszeiten.",
    inputSchema: {
      game_no: z.string().regex(/^\d+$/),
      first_half_kickoff: z.string().optional().describe("Videozeit des Anpfiffs der 1. Halbzeit"),
      second_half_kickoff: z.string().optional().describe("Videozeit des Anpfiffs der 2. Halbzeit"),
      points: z
        .array(z.object({ game_time: z.string(), video_time: z.string(), half: z.union([z.literal(1), z.literal(2)]).optional() }))
        .optional(),
      remove_points: z.array(z.string()).optional().describe("Spielzeiten von Punkten, die entfernt werden sollen"),
    },
  },
  async ({ game_no, first_half_kickoff, second_half_kickoff, points, remove_points }) => {
    try {
      const old = (await readState()).games[game_no]?.sync;
      const first = first_half_kickoff ? parseClock(first_half_kickoff) : old?.first_half;
      const second = second_half_kickoff ? parseClock(second_half_kickoff) : old?.second_half;
      if (first === undefined || second === undefined)
        throw new Error("Beim ersten Mal beide Anpfiffe angeben.");
      if (second <= first + 25 * 60)
        throw new Error("Der Anpfiff der 2. Halbzeit muss mindestens 25 Minuten nach dem der 1. liegen.");
      const removed = new Set((remove_points ?? []).map((t) => parseClock(t)));
      const merged = new Map((old?.points ?? []).filter((p) => !removed.has(p.game)).map((p) => [`${p.half}:${p.game}`, p]));
      for (const p of points ?? []) {
        const game = parseClock(p.game_time);
        const half = p.half ?? (game <= 1800 ? 1 : 2);
        merged.set(`${half}:${game}`, { game, video: parseClock(p.video_time), half });
      }
      const sync: Sync = { first_half: first, second_half: second, points: [...merged.values()].sort((x, y) => x.half - y.half || x.game - y.game) };
      await updateGame(game_no, (g) => (g.sync = sync));
      const stats = gameStats(game_no);
      const lines = [
        `Gespeichert für ${game_no}: 1. HZ ${videoClock(sync.first_half)}, 2. HZ ${videoClock(sync.second_half)}` +
          (sync.points!.length ? `; Punkte: ${sync.points!.map((p) => `${gameClock(p.game)} → ${videoClock(p.video)}`).join(", ")}` : ""),
      ];
      if (stats?.timeouts.length) {
        lines.push("Auszeiten laut Bericht (erwartete Videozeit des Wiederanpfiffs mit dem jetzigen Stand; oft später):");
        for (const x of stats.timeouts) {
          const point = sync.points!.find((p) => p.game === x.t && p.half === x.half);
          const expected = toVideo(x.t, x.half, sync, stats.timeouts, 70) + 70;
          lines.push(`  ${gameClock(x.t)} ${x.team ?? ""} → ${point ? `gesetzt ${videoClock(point.video)}` : `~${videoClock(expected)}`}`);
        }
      } else if (!stats) lines.push("Auszeiten unbekannt (kein Spiel in der handball-bw-Datenbank).");
      return text(lines.join("\n"));
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "plan_clips",
  {
    title: "Clips berechnen",
    description: "Rechnet Spielzeiten in Videozeiten um (mit Auszeiten aus handball-bw), ohne etwas zu erzeugen. Zum Prüfen vor create_analysis/export_clips.",
    inputSchema: { clips: z.array(clipSchema).min(1).max(200), ...planOptions },
    annotations: { readOnlyHint: true },
  },
  async ({ clips, ...options }) => {
    try {
      const { clips: planned, warnings } = await plan(clips, options);
      return text([...planned.map(describeClip), ...warnings.map((w) => `Hinweis: ${w}`)].join("\n"));
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "create_analysis",
  {
    title: "Tacticut-Analyse erstellen",
    description:
      "Erstellt eine .tcut-Datei für Tacticut mit den Clips (Kategorien aus 'category', dazu eine Playlist). " +
      "media 'excerpts' (Standard) lädt nur die benötigten Abschnitte mit etwas Puffer und fügt sie pro Spiel zu einer Datei zusammen; " +
      "'full' lädt das ganze Spielvideo (1–4 GB) und behält es für spätere Analysen. In Tacticut über Datei → Öffnen laden.",
    inputSchema: {
      title: z.string().min(1).max(120),
      clips: z.array(clipSchema).min(1).max(200),
      media: z.enum(["excerpts", "full"]).default("excerpts"),
      padding_seconds: z.number().min(0).max(600).default(45).describe("Puffer um jeden Clip bei 'excerpts', damit sich Grenzen in Tacticut noch verschieben lassen"),
      playlist: z.boolean().default(true),
      output_dir: z.string().optional().describe(`Zielordner; Standard ${library}/<Titel>`),
      ...planOptions,
    },
  },
  async ({ title, clips: requests, media, padding_seconds, playlist, output_dir, ...options }, extra) => {
    const report = reporter(extra as Extra);
    try {
      const { clips, stats, warnings } = await plan(requests, options);
      const folder = output_dir ?? join(library, safeName(title));
      await mkdir(folder, { recursive: true });
      const sources: SourceFile[] = [];
      const analysisClips: (AnalysisClip & { order: number })[] = [];
      const gameNos = [...new Set(clips.map((c) => c.game_no))];
      for (const [gi, no] of gameNos.entries()) {
        const info = await gameInfo(no).catch(() => undefined);
        const name = gameTitle(no, stats.get(no), info);
        const own = clips.filter((c) => c.game_no === no);
        const order = (c: PlannedClip) => clips.indexOf(c);
        let path: string;
        let offset = (t: number) => t;
        if (media === "full") {
          const state = (await readState()).games[no];
          path = state?.file && existsSync(state.file) ? state.file : join(library, "Spiele", `${safeName(name)}.mp4`);
          if (!existsSync(path)) {
            await download(await phoenix.source(no, true), path, (done, total) =>
              report(gi + done / (total || 1), gameNos.length, `${name}: ${(done / 1e9).toFixed(2)} von ${(total / 1e9).toFixed(2)} GB`),
            );
            await updateGame(no, (g) => (g.file = path));
          }
        } else {
          const total = await duration(no);
          const ranges = coverRanges(own, padding_seconds, total);
          const parts = join(folder, `.parts-${no}`);
          await mkdir(parts, { recursive: true });
          const { audio } = await withSource(no, probe);
          const starts: number[] = [];
          let at = 0;
          for (const [ri, r] of ranges.entries()) {
            report(gi + ri / ranges.length, gameNos.length, `${name}: Abschnitt ${ri + 1} von ${ranges.length} (${videoClock(r.start)}–${videoClock(r.end)})`);
            const file = join(parts, `${String(ri).padStart(3, "0")}.mp4`);
            await withSource(no, (src) => cut(src, r.start, r.end - r.start, file, { audio }));
            starts.push(at);
            at += (await probe(file)).duration;
          }
          path = await freeFile(folder, safeName(`${name} (Ausschnitte)`), ".mp4");
          await concat((await readdir(parts)).sort().map((f) => join(parts, f)), path);
          await rm(parts, { recursive: true, force: true });
          offset = (t: number) => {
            const i = ranges.findIndex((r) => t >= r.start - 0.01 && t <= r.end + 0.01);
            return starts[i] + (t - ranges[i].start);
          };
        }
        const probed = await probe(path);
        sources.push({ key: no, path, display_name: media === "full" ? name : `${name} (Ausschnitte)`, duration: probed.duration, ...(await fingerprint(path)) });
        for (const c of own)
          analysisClips.push({
            order: order(c),
            source: no,
            name: c.name,
            category: c.category,
            start: offset(c.video_start),
            end: offset(c.video_end),
            notes: [`${name} · Spielzeit ${gameClock(c.game_start)}${c.game_end !== c.game_start ? `–${gameClock(c.game_end)}` : ""}`, c.notes]
              .filter(Boolean)
              .join("\n"),
          });
      }
      // Keep the requested order across games.
      analysisClips.sort((a, b) => a.order - b.order);
      const file = await freeFile(folder, safeName(title), ".tcut");
      await writeFile(file, buildAnalysis({ title, file, sources, clips: analysisClips, playlist }));
      return text(
        [`Analyse erstellt: ${file}`, `${analysisClips.length} Clips aus ${sources.length} Spiel(en). In Tacticut über Datei → Öffnen laden.`, ...sources.map((s) => `Video: ${s.path}`), ...warnings.map((w) => `Hinweis: ${w}`)].join("\n"),
      );
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "export_clips",
  {
    title: "Clips als MP4 exportieren",
    description:
      "Schneidet die Clips direkt aus den Spielvideos (ohne Komplett-Download) und speichert sie als MP4: " +
      "ein zusammengefügtes Video und/oder einzelne Dateien. Der Clipname wird die ersten Sekunden eingeblendet.",
    inputSchema: {
      title: z.string().min(1).max(120),
      clips: z.array(clipSchema).min(1).max(200),
      combined: z.boolean().default(true),
      separate: z.boolean().default(false),
      label: z.boolean().default(true),
      height: z.union([z.literal(720), z.literal(1080)]).default(720),
      output_dir: z.string().optional().describe(`Zielordner; Standard ${library}/<Titel>`),
      ...planOptions,
    },
  },
  async ({ title, clips: requests, combined, separate, label, height, output_dir, ...options }, extra) => {
    const report = reporter(extra as Extra);
    try {
      if (!combined && !separate) throw new Error("combined oder separate muss gesetzt sein.");
      const { clips, warnings } = await plan(requests, options);
      const folder = output_dir ?? join(library, safeName(title));
      const parts = join(folder, separate ? safeName(title) : `.parts-${Date.now()}`);
      await mkdir(parts, { recursive: true });
      const audio = new Map<string, boolean>();
      const files: string[] = [];
      for (const [i, c] of clips.entries()) {
        report(i, clips.length, `Clip ${i + 1} von ${clips.length}: ${c.name}`);
        if (!audio.has(c.game_no)) audio.set(c.game_no, (await withSource(c.game_no, probe)).audio);
        const file = join(parts, `${String(i + 1).padStart(2, "0")} ${safeName(c.name)}.mp4`);
        await withSource(c.game_no, (src) =>
          cut(src, c.video_start, c.video_end - c.video_start, file, { height, audio: audio.get(c.game_no)!, text: label ? c.name : undefined }),
        );
        files.push(file);
      }
      const out: string[] = [];
      if (combined) {
        const file = await freeFile(folder, safeName(title), ".mp4");
        await concat(files, file);
        out.push(file);
      }
      if (separate) out.push(`${files.length} einzelne Clips in ${parts}`);
      else await rm(parts, { recursive: true, force: true });
      return text([...out, ...warnings.map((w) => `Hinweis: ${w}`)].join("\n"));
    } catch (err) {
      return failure(err);
    }
  },
);

if (import.meta.main) await server.connect(new StdioServerTransport());
