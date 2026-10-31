import { t, useLanguage } from "./i18n";
import { useId, useState } from "react";
import type { Clip } from "./domain";
import { fieldOptions, mergeHandballTag, type HandballTag } from "./handball";
import type { Roster } from "./roster";

type PersonField = "team" | "player" | "goalkeeper";
type PlayField = "outcome" | "phase" | "defense" | "strength";
type BoardProps = {
  value?: HandballTag;
  onChange(value: HandballTag | undefined): void;
  roster?: Roster;
  clips?: Clip[];
  part: "people" | "play" | "court";
  contextOnly?: boolean;
};
const personLabels: Record<PersonField, string> = {
  team: "Attacking team",
  player: "Attacking player",
  goalkeeper: "Defending goalkeeper",
};
const playLabels: Record<PlayField, string> = {
  outcome: "Recorded outcome",
  phase: "Tactical phase",
  defense: "Defense faced",
  strength: "Attacking strength",
};

/** Direct, reversible selections for one scene. The containing editor owns persistence. */
export function HandballTagBoard({
  value = {},
  onChange,
  roster,
  clips = [],
  part,
  contextOnly = false,
}: BoardProps) {
  const { language } = useLanguage();
  const fieldLabel = (source: string) =>
    language === "en" ? source.toLowerCase() : t(source);
  const id = useId();
  const [search, setSearch] = useState("");
  const emit = (next: HandballTag) =>
    onChange(Object.keys(next).length ? next : undefined);
  const clear = (...fields: (keyof HandballTag)[]) => {
    const next = { ...value };
    for (const field of fields) delete next[field];
    emit(next);
  };
  const toggle = <K extends PlayField | "shot_position" | "goal_zone">(
    field: K,
    selected: string,
  ) => {
    if (value[field] === selected) clear(field);
    else emit({ ...value, [field]: selected });
  };
  const clearPerson = (field: PersonField) => {
    if (field === "team" && value.player_id)
      clear("team", "team_id", "player", "player_id");
    else clear(field, `${field}_id`);
  };
  const typePerson = (field: PersonField, text: string) => {
    if (!text.trim()) {
      clearPerson(field);
      return;
    }
    emit(mergeHandballTag(value, { [field]: text }));
  };
  const chooseTeam = (team: NonNullable<Roster>["teams"][number]) => {
    if (value.team_id === team.id) {
      clearPerson("team");
      return;
    }
    emit(mergeHandballTag(value, { team_id: team.id, team: team.name }));
  };
  const choosePerson = (
    field: "player" | "goalkeeper",
    person: NonNullable<Roster>["players"][number],
  ) => {
    if (value[`${field}_id`] === person.id) {
      clearPerson(field);
      return;
    }
    const team = roster?.teams.find((team) => team.id === person.team_id);
    if (!team) return;
    emit(
      mergeHandballTag(value, {
        [field]: person.name,
        [`${field}_id`]: person.id,
        ...(field === "player" ? { team_id: team.id, team: team.name } : {}),
      }),
    );
  };
  const suggestions = (field: PersonField) =>
    [
      ...new Set(
        clips
          .filter(
            (clip) =>
              field !== "player" ||
              !value.team ||
              clip.handball?.team === value.team,
          )
          .map((clip) => clip.handball?.[field])
          .filter((name): name is string => !!name),
      ),
    ].sort((a, b) => a.localeCompare(b));
  const matchesSearch = (text: string) =>
    text.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  const people = (field: "player" | "goalkeeper") =>
    (roster?.players || []).filter(
      (person) =>
        (field === "goalkeeper"
          ? person.goalkeeper
          : !value.team_id || person.team_id === value.team_id) &&
        matchesSearch(
          [
            person.name,
            person.number,
            roster?.teams.find((team) => team.id === person.team_id)?.name,
          ]
            .filter(Boolean)
            .join(" "),
        ),
    );
  const showSearch =
    (roster?.players.length || 0) > 12 || (roster?.teams.length || 0) > 8;

  if (part === "people")
    return (
      <div className="handball-tag-board part-people">
        <p className="muted tag-board-help">
          {t(
            "Choose the attacking side and the defending keeper. You can also type a name.",
          )}
        </p>
        {showSearch && (
          <input
            className="tag-roster-search"
            aria-label={t("Search roster")}
            placeholder={t("Find a team, player or shirt number…")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        )}
        {(["team", "player", "goalkeeper"] as const).map((field) => {
          const names = suggestions(field);
          const rows =
            field === "team"
              ? roster?.teams.filter((team) => matchesSearch(team.name)) || []
              : people(field);
          return (
            <section className="tag-section tag-people-section" key={field}>
              <div className="tag-section-heading">
                <h3>{t(personLabels[field])}</h3>
                <button
                  className="tag-clear"
                  type="button"
                  aria-label={t("Clear {field}", {
                    field: fieldLabel(personLabels[field]),
                  })}
                  disabled={!value[field] && !value[`${field}_id`]}
                  onClick={() => clearPerson(field)}
                >
                  {t("Clear")}
                </button>
              </div>
              {!!rows.length && (
                <div
                  className="tag-roster-list"
                  role="group"
                  aria-label={t("{role} choices", {
                    role: t(personLabels[field]),
                  })}
                >
                  {field === "team"
                    ? (rows as Roster["teams"]).map((team) => (
                        <button
                          className="tag-choice tag-person-choice"
                          type="button"
                          key={team.id}
                          aria-label={t("Team {name}", { name: team.name })}
                          aria-pressed={value.team_id === team.id}
                          onClick={() => chooseTeam(team)}
                        >
                          {team.name}
                        </button>
                      ))
                    : (rows as Roster["players"]).map((person) => {
                        const team = roster?.teams.find(
                          (team) => team.id === person.team_id,
                        );
                        const label = [
                          person.number ? `#${person.number}` : "",
                          person.name,
                          team?.name,
                        ]
                          .filter(Boolean)
                          .join(" · ");
                        return (
                          <button
                            className="tag-choice tag-person-choice"
                            type="button"
                            key={person.id}
                            aria-label={t(
                              field === "player"
                                ? "Player {name}"
                                : "Goalkeeper {name}",
                              { name: label },
                            )}
                            aria-pressed={value[`${field}_id`] === person.id}
                            onClick={() => choosePerson(field, person)}
                          >
                            {person.number && (
                              <span className="tag-shirt-number">
                                {person.number}
                              </span>
                            )}
                            <span className="tag-person-name">
                              {person.name}
                              {team && <small>{team.name}</small>}
                            </span>
                          </button>
                        );
                      })}
                </div>
              )}
              {showSearch && !!search.trim() && !rows.length && (
                <p className="muted tag-search-empty">
                  {t("No matching roster entries.")}
                </p>
              )}
              <input
                className="tag-person-input"
                aria-label={t(personLabels[field])}
                placeholder={
                  value[`${field}_id`]
                    ? t("Linked to roster")
                    : t(
                        field === "team"
                          ? "Type team name…"
                          : field === "player"
                            ? "Type player name…"
                            : "Type keeper name…",
                      )
                }
                value={value[field] || ""}
                maxLength={80}
                list={`${id}-${field}-names`}
                onChange={(event) => typePerson(field, event.target.value)}
              />
              <datalist id={`${id}-${field}-names`}>
                {names.map((name) => (
                  <option value={name} key={name} />
                ))}
              </datalist>
              {!rows.length && !search.trim() && !!names.length && (
                <div
                  className="tag-choice-grid tag-name-suggestions"
                  role="group"
                  aria-label={t("Recent {field} names", {
                    field: fieldLabel(personLabels[field]),
                  })}
                >
                  {names.slice(0, 8).map((name) => (
                    <button
                      className="tag-choice"
                      type="button"
                      key={name}
                      aria-pressed={
                        !value[`${field}_id`] && value[field] === name
                      }
                      onClick={() =>
                        value[field] === name && !value[`${field}_id`]
                          ? clearPerson(field)
                          : typePerson(field, name)
                      }
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    );

  if (part === "play") {
    const fields: PlayField[] = contextOnly
      ? ["phase", "defense", "strength"]
      : ["outcome", "phase", "defense", "strength"];
    return (
      <div className="handball-tag-board part-play">
        {fields.map((field) => (
          <section className={`tag-section tag-${field}-section`} key={field}>
            <div className="tag-section-heading">
              <h3>{t(playLabels[field])}</h3>
              <button
                className="tag-clear"
                type="button"
                aria-label={t("Clear {field}", {
                  field: fieldLabel(playLabels[field]),
                })}
                disabled={!value[field]}
                onClick={() => clear(field)}
              >
                {t("Clear")}
              </button>
            </div>
            <div
              className={`tag-choice-grid tag-${field}-grid`}
              role="group"
              aria-label={t(playLabels[field])}
            >
              {fieldOptions[field].map((option) => (
                <button
                  className={`tag-choice ${field === "outcome" ? `tag-outcome tag-outcome-${option.value}` : ""}`}
                  type="button"
                  key={option.value}
                  aria-label={
                    field === "outcome"
                      ? t("Outcome {outcome}", { outcome: t(option.label) })
                      : t(option.label)
                  }
                  aria-pressed={value[field] === option.value}
                  onClick={() => toggle(field, option.value)}
                >
                  {t(option.label)}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  if (contextOnly) return null;
  return (
    <div className="handball-tag-board part-court">
      <section className="tag-section">
        <div className="tag-section-heading">
          <h3>{t("Shot origin")}</h3>
          <button
            className="tag-clear"
            type="button"
            aria-label={t("Clear shot origin")}
            disabled={!value.shot_position}
            onClick={() => clear("shot_position")}
          >
            {t("Clear")}
          </button>
        </div>
        <div className="tag-court">
          <svg
            className="tag-court-map"
            viewBox="0 0 360 236"
            aria-hidden="true"
            focusable="false"
          >
            <rect
              x="4"
              y="4"
              width="352"
              height="228"
              rx="4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="M 150 4 V 17 H 210 V 4 M 80 4 V 25 C 80 126 280 126 280 25 V 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="M 39 4 V 28 C 39 178 321 178 321 28 V 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeDasharray="6 7"
            />
            <path
              d="M 169 87 H 191 M 4 232 H 356"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
          <div
            className="tag-origin-grid"
            role="group"
            aria-label={t("Shot origin")}
          >
            {fieldOptions.shot_position.map((option) => (
              <button
                className={`tag-choice tag-origin-${option.value}`}
                type="button"
                key={option.value}
                aria-label={t("Shot origin {position}", {
                  position: t(option.label),
                })}
                aria-pressed={value.shot_position === option.value}
                onClick={() => toggle("shot_position", option.value)}
              >
                {t(option.label)}
              </button>
            ))}
          </div>
        </div>
      </section>
      <section className="tag-section">
        <div className="tag-section-heading">
          <h3>{t("Goal target")}</h3>
          <button
            className="tag-clear"
            type="button"
            aria-label={t("Clear goal target")}
            disabled={!value.goal_zone}
            onClick={() => clear("goal_zone")}
          >
            {t("Clear")}
          </button>
        </div>
        <p className="muted tag-board-help">
          {t(
            "From the shooter’s perspective. Record the target for saves and misses too.",
          )}
        </p>
        <div
          className="tag-goal-grid"
          role="group"
          aria-label={t("Goal target")}
        >
          {fieldOptions.goal_zone.map((option) => (
            <button
              className="tag-choice"
              type="button"
              key={option.value}
              aria-label={t("Target {zone}", { zone: t(option.label) })}
              aria-pressed={value.goal_zone === option.value}
              onClick={() => toggle("goal_zone", option.value)}
            >
              {t(option.label)}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
