import { z } from "zod";
import type { Analysis } from "./domain";
import type { HandballTag } from "./handball";

const id = z.string().uuid();
export const rosterSchema = z
  .object({
    teams: z
      .array(z.object({ id, name: z.string().trim().min(1).max(80) }))
      .max(200),
    players: z
      .array(
        z.object({
          id,
          team_id: id,
          name: z.string().trim().min(1).max(80),
          number: z.string().trim().max(10).optional(),
          goalkeeper: z.boolean().default(false),
        }),
      )
      .max(5000),
  })
  .superRefine((roster, ctx) => {
    const problem = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    for (const rows of [roster.teams, roster.players])
      if (new Set(rows.map((r) => r.id)).size !== rows.length)
        problem("Roster identities must be unique");
    for (const player of roster.players)
      if (!roster.teams.some((t) => t.id === player.team_id))
        problem("Player refers to an unknown team");
  });
export type Roster = z.infer<typeof rosterSchema>;
export const emptyRoster = (): Roster => ({ teams: [], players: [] });

/** Keep readable snapshots portable; removed identities become ordinary text tags. */
export function syncRosterTag(
  tag: HandballTag | undefined,
  roster: Roster,
): HandballTag | undefined {
  if (!tag) return undefined;
  const next = { ...tag };
  const team = roster.teams.find((t) => t.id === next.team_id);
  if (next.team_id) {
    if (team) next.team = team.name;
    else delete next.team_id;
  }
  for (const role of ["player", "goalkeeper"] as const) {
    const key = `${role}_id` as const;
    const person = roster.players.find((p) => p.id === next[key]);
    if (!next[key]) continue;
    if (!person) delete next[key];
    else {
      next[role] = person.name;
      if (role === "player") {
        next.team_id = person.team_id;
        next.team = roster.teams.find((t) => t.id === person.team_id)!.name;
      }
    }
  }
  return next;
}
export function withRoster(analysis: Analysis, roster: Roster): Analysis {
  const validated = rosterSchema.parse(roster);
  return {
    ...analysis,
    roster: validated,
    clips: analysis.clips.map((c) =>
      c.handball ? { ...c, handball: syncRosterTag(c.handball, validated) } : c,
    ),
    ...(analysis.handball_views
      ? {
          handball_views: analysis.handball_views.map((v) => ({
            ...v,
            filters: syncRosterTag(v.filters, validated)!,
          })),
        }
      : {}),
  };
}
