import { z } from "zod";
import { tFor, type Language } from "./i18n";
import type { Clip } from "./domain";

const person = z.string().trim().min(1).max(80);
export const handballSchema = z.object({
  team_id: z.string().uuid().optional(),
  player_id: z.string().uuid().optional(),
  goalkeeper_id: z.string().uuid().optional(),
  team: person.optional(),
  player: person.optional(),
  goalkeeper: person.optional(),
  phase: z
    .enum(["fast-break", "second-wave", "positional", "seven-v-six"])
    .optional(),
  outcome: z
    .enum([
      "goal",
      "saved",
      "missed",
      "blocked",
      "turnover",
      "penalty-won",
      "suspension",
    ])
    .optional(),
  shot_position: z
    .enum([
      "left-wing",
      "left-back",
      "centre-back",
      "right-back",
      "right-wing",
      "pivot",
      "seven-metre",
    ])
    .optional(),
  goal_zone: z
    .enum([
      "top-left",
      "top-centre",
      "top-right",
      "middle-left",
      "middle-centre",
      "middle-right",
      "bottom-left",
      "bottom-centre",
      "bottom-right",
    ])
    .optional(),
  defense: z
    .enum(["six-zero", "five-one", "three-two-one", "other"])
    .optional(),
  strength: z.enum(["equal", "advantage", "disadvantage"]).optional(),
});
export type HandballTag = z.infer<typeof handballSchema>;

export const fieldOptions = {
  phase: [
    { value: "fast-break", label: "Fast break" },
    { value: "second-wave", label: "Second wave" },
    { value: "positional", label: "Positional attack" },
    { value: "seven-v-six", label: "7 vs 6" },
  ],
  outcome: [
    { value: "goal", label: "Goal" },
    { value: "saved", label: "Saved shot" },
    { value: "missed", label: "Missed shot" },
    { value: "blocked", label: "Blocked shot" },
    { value: "turnover", label: "Turnover" },
    { value: "penalty-won", label: "7 m penalty won" },
    { value: "suspension", label: "Two-minute suspension" },
  ],
  shot_position: [
    { value: "left-wing", label: "Left wing" },
    { value: "left-back", label: "Left back" },
    { value: "centre-back", label: "Centre back" },
    { value: "right-back", label: "Right back" },
    { value: "right-wing", label: "Right wing" },
    { value: "pivot", label: "Pivot / 6 m" },
    { value: "seven-metre", label: "7 m" },
  ],
  goal_zone: [
    { value: "top-left", label: "Top left" },
    { value: "top-centre", label: "Top centre" },
    { value: "top-right", label: "Top right" },
    { value: "middle-left", label: "Middle left" },
    { value: "middle-centre", label: "Middle centre" },
    { value: "middle-right", label: "Middle right" },
    { value: "bottom-left", label: "Bottom left" },
    { value: "bottom-centre", label: "Bottom centre" },
    { value: "bottom-right", label: "Bottom right" },
  ],
  defense: [
    { value: "six-zero", label: "6:0 defense" },
    { value: "five-one", label: "5:1 defense" },
    { value: "three-two-one", label: "3:2:1 defense" },
    { value: "other", label: "Other defense" },
  ],
  strength: [
    { value: "equal", label: "Equal strength" },
    { value: "advantage", label: "Numerical advantage" },
    { value: "disadvantage", label: "Short-handed" },
  ],
};

export function matchesHandball(
  clip: Clip,
  filters: Partial<Record<keyof HandballTag, string>>,
): boolean {
  return Object.entries(filters).every(
    ([field, value]) =>
      !value || clip.handball?.[field as keyof HandballTag] === value,
  );
}

export function handballSearchText(
  clip: Clip,
  language: Language = "en",
): string {
  if (!clip.handball) return "";
  return Object.entries(clip.handball)
    .flatMap(([field, value]) => {
      const options = fieldOptions[field as keyof typeof fieldOptions];
      return [
        value,
        options?.find((option) => option.value === value)?.label || "",
        tFor(
          language,
          options?.find((option) => option.value === value)?.label || "",
        ),
      ];
    })
    .join(" ");
}

/** Counts explicitly tagged clips, not possessions or deduplicated match events. */
export function handballSummary(clips: Clip[]) {
  let tagged = 0,
    goals = 0,
    saved = 0,
    missed = 0,
    blocked = 0,
    turnovers = 0;
  for (const clip of clips) {
    if (clip.handball && Object.values(clip.handball).some(Boolean)) tagged++;
    switch (clip.handball?.outcome) {
      case "goal":
        goals++;
        break;
      case "saved":
        saved++;
        break;
      case "missed":
        missed++;
        break;
      case "blocked":
        blocked++;
        break;
      case "turnover":
        turnovers++;
        break;
    }
  }
  const attempts = goals + saved + missed + blocked;
  return {
    tagged,
    attempts,
    goals,
    saved,
    missed,
    blocked,
    turnovers,
    conversion: attempts ? (goals / attempts) * 100 : null,
    savePercentage: goals + saved ? (saved / (goals + saved)) * 100 : null,
  };
}

/** Partition the current result once: the same shirt/name on different teams stays separate. */
export function playerReviewGroups(
  clips: Clip[],
  role: "player" | "goalkeeper" = "player",
  language: Language = "en",
) {
  const groups = new Map<string, { name: string; clips: Clip[] }>();
  for (const clip of clips) {
    const name = clip.handball?.[role];
    if (!name) continue;
    // Attacking team identifies a shooter, but is the opponent of the defending keeper.
    const team =
      role === "player"
        ? clip.handball?.team || tFor(language, "Team unspecified")
        : tFor(language, "Goalkeeper");
    const identity = clip.handball?.[`${role}_id`];
    const key =
      identity || JSON.stringify([clip.handball?.team_id || team, name]);
    if (!groups.has(key))
      groups.set(key, { name: `${team} · ${name}`.slice(0, 120), clips: [] });
    groups.get(key)!.clips.push(clip);
  }
  return [...groups.values()];
}

/** Merge filled batch fields without leaving identities attached to a different name/team. */
export function mergeHandballTag(
  existing: HandballTag | undefined,
  patch: HandballTag,
): HandballTag {
  const next = { ...existing, ...patch };
  for (const field of ["team", "player", "goalkeeper"] as const) {
    const key = `${field}_id` as const;
    if (patch[field] !== undefined && patch[key] === undefined)
      delete next[key];
  }
  const changedTeam =
    (patch.team_id !== undefined && patch.team_id !== existing?.team_id) ||
    (patch.team !== undefined && patch.team !== existing?.team);
  if (changedTeam && existing?.player_id && patch.player_id === undefined) {
    delete next.player_id;
    if (patch.player === undefined) delete next.player;
  }
  return next;
}
