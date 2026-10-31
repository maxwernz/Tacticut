import { t, useLanguage } from "./i18n";
import { useId } from "react";
import type { Clip } from "./domain";
import { fieldOptions, type HandballTag } from "./handball";
import { Select } from "./Select";
import type { Roster } from "./roster";

export function HandballFields({
  value = {},
  onChange,
  clips = [],
  contextOnly = false,
  roster,
}: {
  value?: HandballTag;
  onChange(value: HandballTag | undefined): void;
  clips?: Clip[];
  contextOnly?: boolean;
  roster?: Roster;
}) {
  useLanguage();
  const id = useId();
  function update(key: keyof HandballTag, next: string) {
    const tag = { ...value };
    if (key === "team" || key === "player" || key === "goalkeeper") {
      delete tag[`${key}_id`];
      if (key === "team" && tag.player_id) {
        delete tag.player_id;
        delete tag.player;
      }
    }
    if (next.trim()) Object.assign(tag, { [key]: next });
    else delete tag[key];
    onChange(Object.keys(tag).length ? tag : undefined);
  }
  const choices = (key: "team" | "player" | "goalkeeper") =>
    [
      ...new Set(
        clips
          .filter(
            (c) =>
              key === "team" || !value.team || c.handball?.team === value.team,
          )
          .map((c) => c.handball?.[key])
          .filter((v): v is string => !!v),
      ),
    ].sort();
  const fields = contextOnly
    ? (["phase", "defense", "strength"] as const)
    : (["phase", "outcome", "shot_position", "defense", "strength"] as const);
  const labels = {
    phase: "Tactical phase",
    outcome: "Recorded outcome",
    shot_position: "Shot origin",
    defense: "Defense faced",
    strength: "Attacking strength",
  };
  return (
    <div className="handball-fields">
      <p className="muted">
        {t(
          "Team and player describe the attacking side. Goalkeeper describes the defending keeper.",
        )}
      </p>
      <div className="handball-field-grid">
        {(["team", "player", "goalkeeper"] as const).map((key) => (
          <label key={key}>
            {t(
              key === "team"
                ? "Attacking team"
                : key === "player"
                  ? "Attacking player"
                  : "Defending goalkeeper",
            )}
            <input
              aria-label={t(
                key === "team"
                  ? "Attacking team"
                  : key === "player"
                    ? "Attacking player"
                    : "Defending goalkeeper",
              )}
              maxLength={80}
              list={`${id}-${key}`}
              value={value[key] || ""}
              onChange={(e) => update(key, e.target.value)}
            />
            <datalist id={`${id}-${key}`}>
              {choices(key).map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            {!!roster?.teams.length && (
              <Select
                label={t("Choose {role} from roster", { role: t(key) })}
                value={value[`${key}_id`] || ""}
                display={
                  value[`${key}_id`]
                    ? t("Linked to roster")
                    : t("Choose from roster…")
                }
                options={[
                  { value: "", label: t("Use typed name") },
                  ...(key === "team"
                    ? roster.teams.map((t) => ({ value: t.id, label: t.name }))
                    : roster.players
                        .filter((p) =>
                          key === "goalkeeper"
                            ? p.goalkeeper
                            : !value.team_id || p.team_id === value.team_id,
                        )
                        .map((p) => ({
                          value: p.id,
                          label: [
                            p.number ? `#${p.number}` : "",
                            p.name,
                            roster.teams.find((t) => t.id === p.team_id)?.name,
                          ]
                            .filter(Boolean)
                            .join(" · "),
                        }))),
                ]}
                onChange={(ref) => {
                  const tag = { ...value };
                  delete tag[`${key}_id`];
                  if (!ref) {
                    onChange(tag);
                    return;
                  }
                  if (key === "team") {
                    const team = roster.teams.find((t) => t.id === ref)!;
                    tag.team_id = team.id;
                    tag.team = team.name;
                    if (
                      tag.player_id &&
                      !roster.players.some(
                        (p) => p.id === tag.player_id && p.team_id === team.id,
                      )
                    ) {
                      delete tag.player_id;
                      delete tag.player;
                    }
                  } else {
                    const person = roster.players.find((p) => p.id === ref)!;
                    tag[`${key}_id`] = person.id;
                    tag[key] = person.name;
                    if (key === "player") {
                      tag.team_id = person.team_id;
                      tag.team = roster.teams.find(
                        (t) => t.id === person.team_id,
                      )!.name;
                    }
                  }
                  onChange(tag);
                }}
              />
            )}
          </label>
        ))}
        {fields.map((key) => (
          <label key={key}>
            {t(labels[key])}
            <Select
              label={t(labels[key])}
              value={value[key] || ""}
              onChange={(v) => update(key, v)}
              options={[
                { value: "", label: t("Not recorded") },
                ...fieldOptions[key].map((option) => ({
                  ...option,
                  label: t(option.label),
                })),
              ]}
            />
          </label>
        ))}
      </div>
      {!contextOnly && (
        <fieldset className="handball-goal-picker">
          <legend>{t("Goal target · shooter’s perspective")}</legend>
          <p className="muted">
            {t("Record where the shot was aimed, including saves and misses.")}
          </p>
          <div className="handball-goal-grid">
            {fieldOptions.goal_zone.map((zone) => (
              <button
                type="button"
                key={zone.value}
                aria-label={t("Target {zone}", { zone: t(zone.label) })}
                aria-pressed={value.goal_zone === zone.value}
                onClick={() =>
                  update(
                    "goal_zone",
                    value.goal_zone === zone.value ? "" : zone.value,
                  )
                }
              >
                {t(zone.label)}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {!!Object.keys(value).length && (
        <button type="button" onClick={() => onChange(undefined)}>
          {t("Clear handball tags")}
        </button>
      )}
    </div>
  );
}
