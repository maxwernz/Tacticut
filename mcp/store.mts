// Where the MCP keeps videos, analyses and per-game sync points, and the link to the
// handball-bw statistics database for team time-outs.

import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Sync, Timeout } from "./timeline.mts";

export const library = process.env.TACTICUT_LIBRARY ?? join(homedir(), "Movies", "Tacticut");
const stateFile = join(library, ".tacticut-mcp.json");
export const statsDb =
  process.env.HANDBALL_DB ?? join(homedir(), "development", "HandballResults", "analysis", "handball.db");

export type GameState = {
  sync?: Sync;
  /** Fully downloaded video. */
  file?: string;
  duration?: number;
  title?: string;
};
type State = { games: Record<string, GameState> };

export async function readState(): Promise<State> {
  try {
    return JSON.parse(await readFile(stateFile, "utf8")) as State;
  } catch {
    return { games: {} };
  }
}

export async function updateGame(gameNo: string, change: (g: GameState) => void) {
  const state = await readState();
  const game = (state.games[gameNo] ??= {});
  change(game);
  await mkdir(library, { recursive: true });
  const temp = `${stateFile}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(state, null, 2));
  await rename(temp, stateFile);
  return game;
}

export type GameStats = {
  timeouts: Timeout[];
  home: string;
  guest: string;
  has_report: boolean;
} | null;

/** Team time-outs from the handball-bw database, or null when it is not available. */
export function gameStats(gameNo: string): GameStats {
  if (!existsSync(statsDb)) return null;
  const db = new DatabaseSync(statsDb, { readOnly: true });
  try {
    const game = db
      .prepare("SELECT id, home, guest, has_report FROM games WHERE game_no = ?")
      .get(gameNo) as { id: number; home: string; guest: string; has_report: number } | undefined;
    if (!game) return null;
    const timeouts = (
      db.prepare("SELECT t, half, side FROM events WHERE game_id = ? AND type = 'timeout' ORDER BY seq").all(game.id) as {
        t: number;
        half: number;
        side: string | null;
      }[]
    ).map((r) => ({
      t: r.t,
      half: (r.half === 2 ? 2 : 1) as 1 | 2,
      team: r.side === "home" ? game.home : r.side === "guest" ? game.guest : undefined,
    }));
    return { timeouts, home: game.home, guest: game.guest, has_report: !!game.has_report };
  } catch {
    // An older database without game_no: `npm run analyse:update` in HandballResults.
    return null;
  } finally {
    db.close();
  }
}

export const safeName = (s: string) =>
  s.replace(/[/\\:*?"<>|\x00-\x1f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 100) || "Analyse";
