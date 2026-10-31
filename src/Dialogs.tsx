import { t, useLanguage } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import {
  categorySchema,
  clipCategoryLabels,
  categoryKey,
  categoryShortcut,
  defaults,
  normalizeName,
  timecode,
  type Analysis,
  type Category,
  type Clip,
} from "./domain";
import type { ExportOptions, Progress } from "./api";
import { Select } from "./Select";
import { ColorPicker } from "./ColorPicker";
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose?: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useLanguage();
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const ownBackdrop = panel.current?.closest(".modal-backdrop");
    const covered = [
      ...document.querySelectorAll<HTMLElement>(".modal-backdrop"),
    ]
      .filter((element) => element !== ownBackdrop)
      .map((element) => ({
        element,
        inert: element.inert,
        hidden: element.getAttribute("aria-hidden"),
      }));
    covered.forEach(({ element }) => {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    });
    if (!panel.current?.contains(document.activeElement))
      panel.current
        ?.querySelector<HTMLElement>(
          "input:not(:disabled),button:not(:disabled),select:not(:disabled),textarea:not(:disabled)",
        )
        ?.focus();
    return () => {
      covered.forEach(({ element, inert, hidden }) => {
        element.inert = inert;
        if (hidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", hidden);
      });
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onKeyDown={(e) => {
        if (e.key === "Escape" && onClose) {
          e.stopPropagation();
          onClose();
        }
        if (e.key === "Tab") {
          const controls = Array.from(
            panel.current!.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
            ),
          );
          const first = controls[0],
            last = controls.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <section
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? "wide" : ""}`}
      >
        <div className="panel-heading">
          <h2>{title}</h2>
          {onClose && (
            <button aria-label={t("Close dialog")} onClick={onClose}>
              <X size={18} />
            </button>
          )}
        </div>
        {children}
      </section>
    </div>
  );
}
export function CategoryDialog({
  initial,
  template,
  onSave,
  onClose,
}: {
  initial: Category[];
  template: boolean;
  onSave(categories: Category[]): Promise<void>;
  onClose(): void;
}) {
  useLanguage();
  const [rows, setRows] = useState(structuredClone(initial)),
    [error, setError] = useState("");
  const update = (id: string, patch: Partial<Category>) =>
    setRows(rows.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const move = (i: number, by: number) => {
    const next = [...rows];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    setRows(next);
  };
  return (
    <Modal
      title={template ? t("Category template") : t("Analysis Categories")}
      wide
      onClose={onClose}
    >
      <div className="modal-body">
        <p className="muted">
          {template
            ? t(
                "Copied into new Analyses. Existing Analyses keep their Categories.",
              )
            : t(
                "Categories are shared by all Source videos. Removing one keeps its Clips uncategorized.",
              )}
        </p>
        <p className="muted">
          {t(
            "Use an optional group for a two-level tagging system. Assign keys 1–9 to the categories you capture most often; unused categories remain available by clicking.",
          )}
        </p>
        <div className="category-list">
          {rows.map((c, i) => (
            <div className="category-edit" key={c.id}>
              <ColorPicker
                label={t("Color for {name}", { name: c.name })}
                value={/^#[0-9a-f]{6}$/i.test(c.color) ? c.color : "#808080"}
                onChange={(color) => update(c.id, { color })}
              />
              <input
                aria-label={t("Category name")}
                value={c.name}
                onChange={(e) => update(c.id, { name: e.target.value })}
              />
              <input
                aria-label={t("Group for {name}", { name: c.name })}
                placeholder={t("Group (optional)")}
                value={c.group || ""}
                maxLength={80}
                onChange={(e) =>
                  update(c.id, { group: e.target.value || undefined })
                }
              />
              <Select
                label={t("Shortcut for {name}", { name: c.name })}
                value={String(categoryShortcut(rows, c) || "")}
                options={[
                  { value: "", label: t("No key") },
                  ...Array.from({ length: 9 }, (_, n) => ({
                    value: String(n + 1),
                    label: t("Key {number}", { number: n + 1 }),
                  })),
                ]}
                onChange={(value) =>
                  setRows(
                    rows.map((row) => ({
                      ...row,
                      shortcut:
                        row.id === c.id
                          ? value
                            ? Number(value)
                            : null
                          : categoryShortcut(rows, row),
                    })),
                  )
                }
              />
              <button
                title={t("Move earlier")}
                disabled={!i}
                onClick={() => move(i, -1)}
              >
                <ArrowUp size={14} />
              </button>
              <button
                title={t("Move later")}
                disabled={i === rows.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown size={14} />
              </button>
              <button
                title={t("Remove Category")}
                onClick={() => setRows(rows.filter((t) => t.id !== c.id))}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="row">
          <button
            onClick={() =>
              setRows([
                ...rows,
                { id: crypto.randomUUID(), name: "", color: "#A78BFA" },
              ])
            }
          >
            <Plus size={14} />
            {t("Add Category")}
          </button>
          {template && (
            <button
              onClick={() =>
                setRows(
                  defaults.map((c) => ({ ...c, id: crypto.randomUUID() })),
                )
              }
            >
              {t("Restore defaults")}
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
      </div>
      <div className="modal-footer">
        <button onClick={onClose}>{t("Cancel")}</button>
        <button
          className="primary"
          onClick={async () => {
            try {
              const parsed = rows.map((c) => categorySchema.parse(c));
              if (new Set(parsed.map(categoryKey)).size !== parsed.length)
                throw new Error(t("Category names must be unique"));
              const shortcuts = parsed
                .map((c) => c.shortcut)
                .filter((s) => s != null);
              if (new Set(shortcuts).size !== shortcuts.length)
                throw new Error(t("Choose a different key for each Category."));
              await onSave(parsed);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          {t("Save Categories")}
        </button>
      </div>
    </Modal>
  );
}
export function ExportDialog({
  analysis,
  initial,
  progress,
  running,
  onExport,
  onCancel,
  onClose,
}: {
  analysis: Analysis;
  initial: Clip[];
  progress: Progress;
  running: boolean;
  onExport(options: ExportOptions): void;
  onCancel(): void;
  onClose(): void;
}) {
  useLanguage();
  const [clips, setClips] = useState(initial);
  const [options, setOptions] = useState<Omit<ExportOptions, "ids">>({
    title: true,
    categories: true,
    notes: true,
    numbers: true,
    audio: false,
    annotations: true,
    replay: false,
    replaySpeed: 0.5,
    handball: false,
    encoder: "auto",
    height: 1080,
  });
  const move = (i: number, by: number) => {
    const next = [...clips];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    setClips(next);
  };
  return (
    <Modal
      title={t("Combined export")}
      wide
      onClose={running ? undefined : onClose}
    >
      <div className="modal-body">
        <p className="muted">
          {t("Reorder the Export list independently of your Analysis.")}
        </p>
        <fieldset disabled={running}>
          <div className="export-list">
            {clips.map((c, i) => (
              <div className="export-row" key={c.id}>
                <span className="mono muted">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="grow">
                  <strong>{c.name}</strong>
                  <small>
                    {clipCategoryLabels(c, analysis.categories).join(" · ") ||
                      t("Ohne Kategorie")}{" "}
                    ·{" "}
                    {
                      analysis.source_videos.find(
                        (s) => s.id === c.source_video_id,
                      )?.display_name
                    }
                  </small>
                </div>
                <span className="mono">
                  {timecode(
                    c.end_ms -
                      c.start_ms +
                      (options.annotations
                        ? analysis.freeze_frames
                            .filter((f) => f.clip_id === c.id)
                            .reduce((n, f) => n + f.hold_ms, 0)
                        : 0) +
                      (options.replay
                        ? (c.end_ms - c.start_ms) / (options.replaySpeed || 0.5)
                        : 0),
                    false,
                  )}
                </span>
                <button
                  title={t("Move earlier")}
                  disabled={!i}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  title={t("Move later")}
                  disabled={i === clips.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  title={t("Remove from export")}
                  onClick={() => setClips(clips.filter((t) => t.id !== c.id))}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="export-settings">
            {(
              [
                ["title", "Analysis title card"],
                ["categories", "Category title cards"],
                ["notes", "Notes cards"],
                ["numbers", "Clip numbers"],
                ["audio", "Include source audio"],
                ["annotations", "Include annotated freeze-frames"],
              ] as const
            ).map(([key, label]) => (
              <label className="checkbox-label" key={key}>
                <input
                  type="checkbox"
                  checked={options[key]}
                  onChange={(e) =>
                    setOptions({ ...options, [key]: e.target.checked })
                  }
                />
                {t(label)}
              </label>
            ))}
            <label>
              {t("Resolution")}
              <Select
                label={t("Resolution")}
                value={String(options.height)}
                onChange={(value) =>
                  setOptions({ ...options, height: Number(value) })
                }
                options={[
                  { value: "1080", label: t("1080p") },
                  { value: "720", label: t("720p") },
                ]}
              />
            </label>
            <label>
              {t("Encoder")}
              <Select
                label={t("Encoder")}
                value={options.encoder}
                onChange={(value) =>
                  setOptions({
                    ...options,
                    encoder: value as "auto" | "software",
                  })
                }
                options={[
                  { value: "auto", label: t("Automatic") },
                  { value: "software", label: t("Software (H.264)") },
                ]}
              />
            </label>
          </div>
          <details className="handball-tags">
            <summary>{t("Presentation")}</summary>
            <div className="export-settings">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={options.replay}
                  onChange={(e) =>
                    setOptions({ ...options, replay: e.target.checked })
                  }
                />
                {t("Add a slow-motion replay after each Clip")}
              </label>
              <label>
                {t("Replay speed")}
                <Select
                  label={t("Replay speed")}
                  value={String(options.replaySpeed || 0.5)}
                  disabled={!options.replay}
                  onChange={(value) =>
                    setOptions({
                      ...options,
                      replaySpeed: Number(value) as 0.25 | 0.5,
                    })
                  }
                  options={[
                    { value: "0.5", label: t("Half speed (0.5×)") },
                    { value: "0.25", label: t("Quarter speed (0.25×)") },
                  ]}
                />
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={options.handball}
                  onChange={(e) =>
                    setOptions({ ...options, handball: e.target.checked })
                  }
                />
                {t("Include handball details on coaching cards")}
              </label>
            </div>
            <p className="muted">
              {t(
                "Each original plays first with its saved freeze-frames. The replay follows without holds and with silent audio. Coaching cards show team, player, goalkeeper, phase and outcome when recorded.",
              )}
            </p>
          </details>
        </fieldset>
        {running && (
          <div className="export-progress">
            <progress max="100" value={progress.percent} />
            <span>
              {progress.message} · {Math.floor(progress.percent)}%
            </span>
          </div>
        )}
      </div>
      <div className="modal-footer">
        <span className="muted grow">
          {clips.length} {t(" Clips · MP4 / H.264")}
        </span>
        {running ? (
          <button onClick={onCancel}>{t("Cancel export")}</button>
        ) : (
          <>
            <button onClick={onClose}>{t("Cancel")}</button>
            <button
              className="primary"
              disabled={!clips.length}
              onClick={() =>
                onExport({ ...options, ids: clips.map((c) => c.id) })
              }
            >
              {t("Export video…")}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
