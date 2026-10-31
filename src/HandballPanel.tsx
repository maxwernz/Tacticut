import { t, useLanguage } from "./i18n";
import { useEffect, useMemo, useState } from "react";
import { Download, ListPlus, RotateCcw } from "lucide-react";
import {
  timecode,
  clipCategoryIds,
  clipCategoryLabels,
  categoryLabel,
  type Analysis,
  type Clip,
  type HandballView,
} from "./domain";
import {
  fieldOptions,
  handballSearchText,
  handballSummary,
  matchesHandball,
  playerReviewGroups,
  type HandballTag,
} from "./handball";
import { Select } from "./Select";

type Filters = Partial<Record<keyof HandballTag, string>>;
const filterLabels: Record<keyof HandballTag, string> = {
  team_id: "Team",
  player_id: "Shooter / player",
  goalkeeper_id: "Goalkeeper",
  team: "Team",
  player: "Shooter / player",
  goalkeeper: "Goalkeeper",
  phase: "Phase",
  outcome: "Outcome",
  shot_position: "Shot position",
  goal_zone: "Goal target",
  defense: "Defense faced",
  strength: "Numerical situation",
};
const contextFields = ["phase", "outcome", "defense", "strength"] as const;
const identityFields = ["team", "player", "goalkeeper"] as const;
const percentage = (value: number | null) =>
  value == null ? "—" : `${value.toFixed(0)}%`;
const isAttempt = (clip: Clip) =>
  ["goal", "saved", "missed", "blocked"].includes(clip.handball?.outcome || "");

/** A filtered coaching workbench. Every action uses the same visible clip set. */
export function HandballPanel({
  analysis,
  onPlaylist,
  onExport,
  onSelect,
  canReview,
  onReport,
  onPlayerReviews,
  onPlayerExports,
  onViews,
  onReview,
}: {
  analysis: Analysis;
  onPlaylist(name: string, clips: Clip[]): void;
  onExport(clips: Clip[]): void;
  onSelect(clip: Clip): void;
  canReview: boolean;
  onReport?(clips: Clip[], format: "pdf" | "csv"): void;
  onPlayerReviews?(groups: { name: string; clips: Clip[] }[]): void;
  onPlayerExports?(clips: Clip[]): void;
  onViews?(views: HandballView[]): void;
  onReview?(clips: Clip[]): void;
}) {
  const { language } = useLanguage();
  const [filters, setFilters] = useState<Filters>({});
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  useEffect(() => {
    const retained = categoryIds.filter((id) =>
      analysis.categories.some((c) => c.id === id),
    );
    if (retained.length !== categoryIds.length) {
      setCategoryIds(retained);
      setViewId("");
    }
  }, [analysis.categories, categoryIds]);
  const [viewName, setViewName] = useState("");
  const [namingView, setNamingView] = useState(false);
  const [viewId, setViewId] = useState("");
  const views = analysis.handball_views || [];
  const [source, setSource] = useState("");
  const [query, setQuery] = useState("");
  const setFilter = (field: keyof HandballTag, value: string) => {
    setViewId("");
    setFilters((current) => ({ ...current, [field]: value }));
  };
  const reset = () => {
    setViewId("");
    setFilters({});
    setCategoryIds([]);
    setSource("");
    setQuery("");
  };
  const visible = useMemo(
    () =>
      analysis.clips
        .filter(
          (clip) =>
            (!source || clip.source_video_id === source) &&
            matchesHandball(clip, filters) &&
            categoryIds.every((id) => clipCategoryIds(clip).includes(id)) &&
            `${clip.name} ${clip.notes} ${handballSearchText(clip, language)} ${clipCategoryLabels(clip, analysis.categories).join(" ")}`
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
        )
        .sort(
          (a, b) =>
            analysis.source_videos.findIndex(
              (s) => s.id === a.source_video_id,
            ) -
              analysis.source_videos.findIndex(
                (s) => s.id === b.source_video_id,
              ) ||
            a.start_ms - b.start_ms ||
            a.creation_order - b.creation_order,
        ),
    [analysis, filters, query, source, categoryIds, language],
  );
  const playerGroups = playerReviewGroups(visible, "player", language);
  const stats = handballSummary(visible);
  const attempts = visible.filter(isAttempt);
  const activeFilters = Object.entries(filters).filter(([, value]) => value);
  const hasFilters = !!(
    activeFilters.length ||
    source ||
    query ||
    categoryIds.length
  );
  const playlistParts = [
    ...activeFilters.map(([field, value]) => {
      const options = fieldOptions[field as keyof typeof fieldOptions];
      return (
        (options?.find((option) => option.value === value)?.label
          ? t(options.find((option) => option.value === value)!.label)
          : undefined) ||
        (field === "team_id"
          ? analysis.roster?.teams.find((t) => t.id === value)?.name
          : field.endsWith("_id")
            ? analysis.roster?.players.find((p) => p.id === value)?.name
            : undefined) ||
        value
      );
    }),
    ...categoryIds.flatMap((id) => {
      const category = analysis.categories.find((c) => c.id === id);
      return category ? [categoryLabel(category)] : [];
    }),
  ];
  const playlistName = (
    playlistParts.length ? playlistParts.join(" · ") : t("Handball review")
  ).slice(0, 120);
  const categoryGroups = new Map<string, Analysis["categories"]>();
  for (const category of analysis.categories) {
    const group = category.group || t("Categories");
    categoryGroups.set(group, [...(categoryGroups.get(group) || []), category]);
  }
  const toggleCategory = (id: string) => {
    setViewId("");
    setCategoryIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  };
  const identityOptions = (field: (typeof identityFields)[number]) => {
    const options = new Map<string, string>();
    for (const clip of analysis.clips) {
      const tag = clip.handball;
      if (!tag?.[field]) continue;
      const id = tag[`${field}_id`];
      const person =
        field === "team"
          ? undefined
          : analysis.roster?.players.find((p) => p.id === id);
      const team = analysis.roster?.teams.find((t) => t.id === person?.team_id);
      options.set(
        id ? `id:${id}` : tag[field]!,
        person
          ? `${person.number ? `${person.number} · ` : ""}${person.name}${team ? ` · ${team.name}` : ""}`
          : tag[field]!,
      );
    }
    return [...options]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  };
  const setIdentityFilter = (
    field: (typeof identityFields)[number],
    value: string,
  ) => {
    setViewId("");
    setFilters((old) => {
      const next = { ...old };
      delete next[field];
      delete next[`${field}_id`];
      if (value.startsWith("id:")) next[`${field}_id`] = value.slice(3);
      else if (value) next[field] = value;
      return next;
    });
  };
  const toggle = (field: "shot_position" | "goal_zone", value: string) =>
    setFilter(field, filters[field] === value ? "" : value);

  return (
    <div className="handball-panel">
      <div className="panel-heading">
        <h2>{t("Handball analysis")}</h2>
        <button
          title={t("Reset handball filters")}
          disabled={!hasFilters}
          onClick={reset}
        >
          <RotateCcw size={15} />
        </button>
      </div>
      <p className="muted handball-help">
        {t(
          "Combine coaching themes and handball details to prepare player, goalkeeper, or tactical reviews.",
        )}
      </p>
      <div className="handball-filters" data-tour="handball-filters">
        {onViews && (
          <div className="saved-views">
            <div className="row">
              <Select
                label={t("Saved handball views")}
                value={viewId}
                options={[
                  { value: "", label: t("Saved views…") },
                  ...views.map((v) => ({ value: v.id, label: v.name })),
                ]}
                onChange={(id) => {
                  setViewId(id);
                  const view = views.find((v) => v.id === id);
                  if (view) {
                    setFilters(view.filters);
                    setCategoryIds(view.category_ids || []);
                    setQuery(view.query);
                    setSource(view.source_video_id || "");
                  }
                }}
              />
              <button
                title={t("Save current handball view")}
                disabled={views.length >= 100}
                onClick={() => setNamingView(!namingView)}
              >
                {t("Save view")}
              </button>
              {viewId && (
                <button
                  title={t("Delete saved handball view")}
                  onClick={() => {
                    onViews(views.filter((v) => v.id !== viewId));
                    setViewId("");
                  }}
                >
                  ×
                </button>
              )}
            </div>
            {namingView && (
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!viewName.trim()) return;
                  const view = {
                    id: crypto.randomUUID(),
                    name: viewName.trim(),
                    filters: Object.fromEntries(
                      Object.entries(filters).filter(([, v]) => !!v),
                    ),
                    query,
                    source_video_id: source || null,
                    ...(categoryIds.length
                      ? { category_ids: [...categoryIds] }
                      : {}),
                  } as HandballView;
                  onViews([...views, view]);
                  setViewId(view.id);
                  setViewName("");
                  setNamingView(false);
                }}
              >
                <input
                  aria-label={t("View name")}
                  placeholder={t("e.g. Wing shots vs 6:0")}
                  maxLength={80}
                  value={viewName}
                  onChange={(e) => setViewName(e.target.value)}
                />
                <button disabled={!viewName.trim()} type="submit">
                  {t("Save")}
                </button>
              </form>
            )}
          </div>
        )}

        <input
          aria-label={t("Search handball clips")}
          placeholder={t("Search names, notes, players…")}
          value={query}
          maxLength={300}
          onChange={(event) => {
            setViewId("");
            setQuery(event.target.value);
          }}
        />
        <Select
          label={t("Handball source video")}
          value={source}
          onChange={(v) => {
            setViewId("");
            setSource(v);
          }}
          options={[
            { value: "", label: t("All videos") },
            ...(source && !analysis.source_videos.some((s) => s.id === source)
              ? [{ value: source, label: t("Source unavailable") }]
              : []),
            ...analysis.source_videos.map((video) => ({
              value: video.id,
              label: video.display_name,
            })),
          ]}
        />
        <div className="handball-filter-grid">
          {identityFields.map((field) => (
            <Select
              key={field}
              label={t("Filter {field}", { field: t(filterLabels[field]) })}
              value={
                filters[`${field}_id`]
                  ? `id:${filters[`${field}_id`]}`
                  : filters[field] || ""
              }
              options={[
                {
                  value: "",
                  label: t(
                    field === "team"
                      ? "All teams"
                      : field === "player"
                        ? "All players"
                        : "All goalkeepers",
                  ),
                },
                ...identityOptions(field),
              ]}
              onChange={(value) => setIdentityFilter(field, value)}
            />
          ))}
          {contextFields.map((field) => (
            <Select
              key={field}
              label={t("Filter {field}", { field: t(filterLabels[field]) })}
              value={filters[field] || ""}
              options={[
                {
                  value: "",
                  label: t("{field}: all", { field: t(filterLabels[field]) }),
                },
                ...fieldOptions[field].map((option) => ({
                  ...option,
                  label: t(option.label),
                })),
              ]}
              onChange={(value) => setFilter(field, value)}
            />
          ))}
        </div>
        {!!analysis.categories.length && (
          <details className="handball-category-filters">
            <summary>
              {t("Coaching themes")}
              {categoryIds.length
                ? ` · ${t("{count} selected", { count: categoryIds.length })}`
                : ""}
            </summary>
            <p className="muted handball-help">
              {t("Match every selected theme together with the filters above.")}
            </p>
            {[...categoryGroups].map(([group, categories]) => (
              <section
                className="handball-theme-group"
                aria-label={t("Theme group {name}", { name: group })}
                key={group}
              >
                <h3>{group}</h3>
                <div className="handball-theme-options">
                  {categories.map((category) => (
                    <button
                      type="button"
                      key={category.id}
                      aria-label={t("Filter theme {name}", {
                        name: categoryLabel(category),
                      })}
                      aria-pressed={categoryIds.includes(category.id)}
                      disabled={
                        categoryIds.length >= 100 &&
                        !categoryIds.includes(category.id)
                      }
                      onClick={() => toggleCategory(category.id)}
                    >
                      <span
                        className="color-dot"
                        style={{ background: category.color }}
                      />
                      {category.name}
                    </button>
                  ))}
                </div>
              </section>
            ))}
            {!!categoryIds.length && (
              <button
                onClick={() => {
                  setCategoryIds([]);
                  setViewId("");
                }}
              >
                {t("Clear themes")}
              </button>
            )}
          </details>
        )}
      </div>
      <section
        className="handball-summary"
        aria-label={t("Tagged handball statistics")}
      >
        <div className="handball-stat-grid">
          <div>
            <strong>{stats.attempts}</strong>
            <span>{t("Shots")}</span>
          </div>
          <div>
            <strong>{stats.goals}</strong>
            <span>{t("Goals")}</span>
          </div>
          <div>
            <strong>{percentage(stats.conversion)}</strong>
            <span>{t("Conversion")}</span>
          </div>
          <div>
            <strong>{stats.saved}</strong>
            <span>{t("Saves")}</span>
          </div>
          <div>
            <strong>{percentage(stats.savePercentage)}</strong>
            <span>{t("On-target save %")}</span>
          </div>
          <div>
            <strong>{stats.turnovers}</strong>
            <span>{t("Turnovers")}</span>
          </div>
        </div>
        <p className="muted handball-help">
          {t(
            "{tagged} tagged of {count} matching clips. Shots count only explicit goal, saved, missed, or blocked outcomes. Save % = saves ÷ (goals + saves). These are tagged clips, not complete match totals.",
            { tagged: stats.tagged, count: visible.length },
          )}
        </p>
      </section>
      <div className="row handball-actions">
        {onReview && (
          <button
            disabled={!visible.length || !canReview}
            onClick={() => onReview(visible)}
          >
            {t("Play matching")}
          </button>
        )}

        <button
          disabled={!visible.length || !canReview}
          onClick={() => onPlaylist(playlistName, visible)}
        >
          <ListPlus size={14} />
          {t("Create review playlist")}
        </button>
        <button
          disabled={!visible.length || !canReview}
          onClick={() => onExport(visible)}
        >
          <Download size={14} />
          {t("Export matching")}
        </button>
      </div>
      {(onReport || onPlayerReviews) && (
        <details className="handball-extra" data-tour="reports">
          <summary>{t("Reports & player reviews")}</summary>
          {onReport && (
            <div className="row handball-actions">
              <button
                disabled={!visible.length || !canReview}
                onClick={() => onReport(visible, "pdf")}
              >
                {t("Shooting report (PDF)")}
              </button>
              <button
                disabled={!visible.length || !canReview}
                onClick={() => onReport(visible, "csv")}
              >
                {t("Clip data (CSV)")}
              </button>
            </div>
          )}
          {onPlayerReviews && (
            <>
              <p className="muted handball-help">
                {t(
                  "Create {count} player playlists from these results. Clips without a player stay outside the player reviews.",
                  { count: playerGroups.length },
                )}
              </p>
              <ul className="player-review-preview">
                {playerGroups.map((g, i) => (
                  <li key={i}>
                    {g.name}{" "}
                    <span>{t("{count} Clips", { count: g.clips.length })}</span>
                  </li>
                ))}
              </ul>
              <div className="handball-actions">
                <button
                  disabled={!playerGroups.length || !canReview}
                  onClick={() => onPlayerReviews(playerGroups)}
                >
                  {t("Create {count} player playlists", {
                    count: playerGroups.length,
                  })}
                </button>
                {onPlayerExports && (
                  <button
                    disabled={!playerGroups.length || !canReview}
                    onClick={() => onPlayerExports(visible)}
                  >
                    {t("Export player videos…")}
                  </button>
                )}
              </div>
            </>
          )}
        </details>
      )}
      {!canReview && (
        <p className="muted handball-help">
          {t("Finish the current edit before reviewing clips.")}
        </p>
      )}

      <details className="handball-charts" data-tour="shot-maps">
        <summary>
          {t("Shot maps")}
          {filters.shot_position || filters.goal_zone ? t(" · filtered") : ""}
        </summary>
        <section className="handball-sectors" aria-label={t("Shot positions")}>
          <div className="panel-heading">
            <h3>{t("Shot positions")}</h3>
            {filters.shot_position && (
              <button onClick={() => setFilter("shot_position", "")}>
                {t("Clear position")}
              </button>
            )}
          </div>
          <p className="muted handball-help">
            {t("Goals / shots · click a position to filter")}
          </p>
          <div className="handball-position-grid">
            {fieldOptions.shot_position.map((option) => {
              const clips = attempts.filter(
                (clip) => clip.handball?.shot_position === option.value,
              );
              return (
                <button
                  key={option.value}
                  aria-pressed={filters.shot_position === option.value}
                  aria-label={t("Shot position {position}", {
                    position: t(option.label),
                  })}
                  onClick={() => toggle("shot_position", option.value)}
                >
                  <span>{t(option.label)}</span>
                  <strong>
                    {
                      clips.filter((clip) => clip.handball?.outcome === "goal")
                        .length
                    }{" "}
                    / {clips.length}
                  </strong>
                </button>
              );
            })}
          </div>
        </section>
        <section className="handball-goal" aria-label={t("Goal target zones")}>
          <div className="panel-heading">
            <h3>{t("Goal targets")}</h3>
            {filters.goal_zone && (
              <button onClick={() => setFilter("goal_zone", "")}>
                {t("Clear target")}
              </button>
            )}
          </div>
          <p className="muted handball-help">
            {t("Shooter’s view · goals / shots")}
          </p>
          <div className="handball-goal-grid">
            {fieldOptions.goal_zone.map((option) => {
              const clips = attempts.filter(
                (clip) => clip.handball?.goal_zone === option.value,
              );
              return (
                <button
                  key={option.value}
                  aria-label={t("Goal target {zone}", {
                    zone: t(option.label),
                  })}
                  aria-pressed={filters.goal_zone === option.value}
                  onClick={() => toggle("goal_zone", option.value)}
                >
                  <span>{t(option.label)}</span>
                  <strong>
                    {
                      clips.filter((clip) => clip.handball?.outcome === "goal")
                        .length
                    }{" "}
                    / {clips.length}
                  </strong>
                </button>
              );
            })}
          </div>
        </section>
      </details>
      <section
        className="handball-results"
        aria-label={t("Matching handball clips")}
      >
        <div className="panel-heading">
          <h3>{t("{count} matching clips", { count: visible.length })}</h3>
        </div>
        {!analysis.clips.length ? (
          <p className="sidebar-empty">
            {t("Capture a Clip, then add its handball details in Edit Clip.")}
          </p>
        ) : !visible.length ? (
          <p className="sidebar-empty">
            {t("No matching clips. Reset or broaden the filters.")}
          </p>
        ) : (
          <div className="handball-result-list">
            {visible.map((clip) => (
              <button
                className="handball-result"
                key={clip.id}
                disabled={!canReview}
                onClick={() => onSelect(clip)}
              >
                <span>{clip.name}</span>
                <small className="muted">
                  {[clip.handball?.player, timecode(clip.start_ms, false)]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
