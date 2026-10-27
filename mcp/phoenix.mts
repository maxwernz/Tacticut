// Client for the BWHV "Phönix" video portal (bwhv.it4sport.de).
//
// Login → role "Vereinsbeobachtung" → video list. Every list row links to a page on
// vpo3.handball4all.de that embeds the match as a plain MP4 (byte ranges supported,
// link valid for 24 hours), so FFmpeg can read just the parts it needs.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
export const BASE = process.env.PHOENIX_URL ?? "https://bwhv.it4sport.de";
const VIDEO_PAGE = "/h4a/observer/video";
const ROLE = process.env.PHOENIX_ROLE ?? "Vereinsbeobachtung";
const KEYCHAIN = process.env.PHOENIX_KEYCHAIN_SERVICE ?? "tacticut-it4sport";
/** Phönix logs out after two hours. */
const SESSION_MS = 90 * 60_000;
const SOURCE_MS = 6 * 3600_000;

export type PhoenixGame = {
  game_no: string;
  /** h4a game id, the same as `games.id` in the handball-bw database. */
  h4a_id: string | null;
  league: string;
  date: string;
  time: string;
  home: string;
  guest: string;
  result: string;
  video_duration: string | null;
  link: string | null;
};

export async function credentials() {
  const { PHOENIX_USERNAME: user, PHOENIX_PASSWORD: pass } = process.env;
  if (user && pass) return { username: user, password: pass };
  if (process.platform !== "darwin")
    throw new Error("Set PHOENIX_USERNAME and PHOENIX_PASSWORD.");
  try {
    const { stdout: info } = await exec("security", [
      "find-generic-password",
      "-s",
      KEYCHAIN,
    ]);
    const username = /"acct"<blob>="([^"]*)"/.exec(info)?.[1];
    const { stdout: password } = await exec("security", [
      "find-generic-password",
      "-s",
      KEYCHAIN,
      "-w",
    ]);
    if (!username) throw new Error("no account name");
    return { username, password: password.replace(/\n$/, "") };
  } catch {
    throw new Error(
      `No Phönix login in the keychain. Add it once in a terminal:\n` +
        `security add-generic-password -s ${KEYCHAIN} -a <username> -w`,
    );
  }
}

const decode = (s: string) =>
  s
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&([a-z])uml;/gi, (_, c: string) =>
      ({ a: "ä", o: "ö", u: "ü", A: "Ä", O: "Ö", U: "Ü" })[c] ?? c,
    )
    .replace(/&szlig;/g, "ß")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();

export const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Parses the rows of the video list. Columns: select, –, league, no, date, time, home, guest, result, video. */
export function parseGames(html: string): PhoenixGame[] {
  const games: PhoenixGame[] = [];
  const rows = html.matchAll(
    /<tr class="(?:even|odd)listitem">([\s\S]*?)<\/tr>/g,
  );
  for (const [, row] of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length < 10) continue;
    const text = cells.map(decode);
    const no = text[3];
    if (!/^\d+$/.test(no)) continue;
    const [d, m, y] = text[4].split(".");
    const link = /href="(https:\/\/vpo\d*\.handball4all\.de\/[^"]+)"/.exec(cells[9])?.[1];
    games.push({
      game_no: no,
      h4a_id: null,
      league: text[2],
      date: y && m && d ? `${y}-${m}-${d}` : text[4],
      time: text[5],
      home: text[6].replace(/\s*\[[^\]]*\]$/, ""),
      guest: text[7].replace(/\s*\[[^\]]*\]$/, ""),
      result: text[8],
      video_duration: link ? text[9] || null : null,
      link: link ? link.replace(/&amp;/g, "&") : null,
    });
  }
  // The comment rows that follow each game carry its h4a id.
  const ids = [...html.matchAll(/PaarungNr&quot;:&quot;(\d+)&quot;[\s\S]*?SpielNr&quot;:&quot;(\d+)&quot;/g)];
  for (const [, id, no] of ids) {
    const game = games.find((g) => g.game_no === no);
    if (game && !game.h4a_id) game.h4a_id = id;
  }
  return games;
}

function options(html: string, name: string) {
  const select = new RegExp(`<select[^>]*name="${name}"[\\s\\S]*?</select>`).exec(html)?.[0] ?? "";
  return [...select.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)/g)].map(
    ([, value, label]) => ({ value, label: decode(label) }),
  );
}

type Response = { status: number; location: string | null; body: string };

export class Phoenix {
  private cookies = new Map<string, string>();
  private piisid: string | null = null;
  private since = 0;
  private leagues: { value: string; label: string }[] = [];
  private sources = new Map<string, { url: string; at: number }>();

  private async request(
    url: string,
    init: { form?: Record<string, string>; referer?: string } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "user-agent": "Tacticut-MCP/1.0",
      cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    };
    if (init.referer) headers.referer = init.referer;
    let body: string | undefined;
    if (init.form) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(init.form).toString();
    }
    const response = await fetch(url, {
      method: init.form ? "POST" : "GET",
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const at = pair.indexOf("=");
      if (at > 0) this.cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
    return {
      status: response.status,
      location: response.headers.get("location"),
      body: await response.text(),
    };
  }

  private url(path: string, params: Record<string, string> = {}) {
    const url = new URL(path, BASE);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (this.piisid) url.searchParams.set("piisid", this.piisid);
    return url.toString();
  }

  async login() {
    this.cookies.clear();
    this.piisid = null;
    const { username, password } = await credentials();
    const page = await this.request(`${BASE}/auth/login`);
    const token = /name="_token" value="([^"]+)"/.exec(page.body)?.[1];
    if (!token) throw new Error("Phönix login page has changed (no form token).");
    const posted = await this.request(`${BASE}/auth/login`, {
      form: { _token: token, username, password },
      referer: `${BASE}/auth/login`,
    });
    const piisid = /[?&]piisid=([^&]+)/.exec(posted.location ?? "")?.[1];
    if (!piisid) throw new Error("Phönix login failed. Check username and password in the keychain.");
    this.piisid = piisid;
    const dashboard = await this.request(this.url("/dashboard"));
    const role = new RegExp(
      `name="role" value="(\\d+)"[^>]*>\\s*${ROLE}\\s*<`,
    ).exec(dashboard.body)?.[1];
    if (!role) throw new Error(`This Phönix account has no role "${ROLE}".`);
    const form = /<form[^>]*id="changeRoleForm"[\s\S]*?name="_token" value="([^"]+)"/.exec(dashboard.body);
    if (!form) throw new Error("Phönix dashboard has changed (no role switch).");
    await this.request(this.url("/change-role"), {
      form: { _token: form[1], role },
      referer: this.url("/dashboard"),
    });
    this.since = Date.now();
  }

  private async videoPage(params: Record<string, string>) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.piisid || Date.now() - this.since > SESSION_MS) await this.login();
      const page = await this.request(this.url(VIDEO_PAGE, params));
      if (page.status === 200 && page.body.includes("searchListTable")) {
        if (!this.leagues.length) this.leagues = options(page.body, "selectStaffel").filter((o) => o.value !== "0");
        return page.body;
      }
      this.piisid = null;
    }
    throw new Error("Phönix video list is not reachable with this account.");
  }

  async leagueNames() {
    if (!this.leagues.length) await this.videoPage({ limit: "1" });
    return this.leagues.map((l) => l.label);
  }

  /** League filter matches the name ("Männer-Verbandsliga Staffel 4") or a short form ("M-VL-4"). */
  async games(filter: {
    league?: string;
    team?: string;
    season?: string;
    withVideo?: boolean;
    limit?: number;
  }): Promise<PhoenixGame[]> {
    if (!this.leagues.length) await this.videoPage({ limit: "1" });
    let staffeln = ["0"];
    if (filter.league) {
      const wanted = leagueMatcher(filter.league);
      const found = this.leagues.filter((l) => wanted(l.label));
      if (!found.length)
        throw new Error(
          `No league matches "${filter.league}". Available: ${this.leagues.map((l) => l.label).join(", ")}`,
        );
      staffeln = found.map((l) => l.value);
    }
    const games: PhoenixGame[] = [];
    for (const staffel of staffeln) {
      const params: Record<string, string> = {
        club: "0",
        selectStaffel: staffel,
        onlyWithVid: filter.withVideo === false ? "0" : "1",
        limit: "500",
        page: "1",
      };
      if (filter.season) params.selectSaison = filter.season;
      for (let page = 1; page <= 10; page++) {
        params.page = String(page);
        const rows = parseGames(await this.videoPage(params));
        games.push(...rows);
        if (rows.length < 500) break;
      }
    }
    const team = filter.team ? normalize(filter.team) : null;
    return games
      .filter((g) => !team || normalize(`${g.home} ${g.guest}`).includes(team))
      .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
      .slice(0, filter.limit ?? 1000);
  }

  async game(gameNo: string): Promise<PhoenixGame> {
    const rows = parseGames(
      await this.videoPage({ club: "0", selectStaffel: "0", onlyWithVid: "0", searchSpielNr: gameNo, limit: "25" }),
    );
    const game = rows.find((g) => g.game_no === gameNo);
    if (!game) throw new Error(`Game ${gameNo} is not in the Phönix video list.`);
    return game;
  }

  /** Direct MP4 address of a game's video; valid for 24 hours. */
  async source(gameNo: string, fresh = false): Promise<string> {
    const cached = this.sources.get(gameNo);
    if (!fresh && cached && Date.now() - cached.at < SOURCE_MS) return cached.url;
    const game = await this.game(gameNo);
    if (!game.link) throw new Error(`Game ${gameNo} has no video yet.`);
    const player = await fetch(game.link, { signal: AbortSignal.timeout(60_000) }).then((r) => r.text());
    const src = /<source src="([^"]+)"/.exec(player)?.[1];
    if (!src) throw new Error(`The video page of game ${gameNo} has no video source.`);
    const url = new URL(src.replace(/&amp;/g, "&"), game.link).toString();
    this.sources.set(gameNo, { url, at: Date.now() });
    return url;
  }
}

/** "M-VL-4", "Männer VL 4", "Männer-Verbandsliga Staffel 4" → matcher on the Phönix label. */
export function leagueMatcher(query: string) {
  const short = /^\s*([MFW])\s*-?\s*VL\s*-?\s*(\d)\s*$/i.exec(query);
  if (short) {
    const gender = short[1].toUpperCase() === "M" ? "manner" : "frauen";
    return (label: string) => {
      const n = normalize(label);
      return n.startsWith(gender) && n.endsWith(`staffel ${short[2]}`);
    };
  }
  const words = normalize(query)
    .replace(/\bvl\b/g, "verbandsliga")
    .replace(/\bmaenner\b/g, "manner")
    .split(" ");
  return (label: string) => {
    const n = normalize(label);
    return words.every((w) => n.split(" ").some((part) => part.startsWith(w)));
  };
}
