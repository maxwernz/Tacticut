import { t, useLanguage } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { Crosshair, Minus, Plus, Check, Tags, X } from "lucide-react";
import {
  parseTimecode,
  timecode,
  categoryShortcut,
  categoryLabel,
  clipCategoryIds,
  withClipCategories,
  type Category,
  type Clip,
  type SourceVideo,
} from "./domain";
import { HandballTagBoard } from "./HandballTagBoard";
import { Modal } from "./Dialogs";
import type { Roster } from "./roster";

/** One scene, one draft: all coaching themes and handball details commit together. */
export function ClipEditor({
  clip,
  categories,
  duration,
  clips = [],
  roster,
  current,
  onSeek,
  onSave,
  onCancel,
  onPreview,
  onStopPreview,
  source,
  documentPath = null,
}: {
  source?: SourceVideo;
  documentPath?: string | null;
  clip: Clip;
  categories: Category[];
  clips?: Clip[];
  roster?: Roster;
  duration: number | null;
  current(): number;
  onSeek(ms: number): void;
  onSave(clip: Clip): void;
  onCancel(): void;
  onPreview(start: number, end: number, loop: boolean): void;
  onStopPreview(): void;
}) {
  useLanguage();
  const [draft, setDraft] = useState(clip),
    [start, setStart] = useState(timecode(clip.start_ms)),
    [end, setEnd] = useState(timecode(clip.end_ms)),
    [error, setError] = useState("");
  const [loop, setLoop] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const previewVideo = useRef<HTMLVideoElement>(null);
  const previewRange = useRef<{
    start: number;
    end: number;
    loop: boolean;
  } | null>(null);
  useEffect(() => {
    if (!source) return;
    let active = true;
    window.desktop
      .media(source, documentPath)
      .then((media) => {
        if (active) setPreviewUrl(media.url);
      })
      .catch(() => {
        if (active) setPreviewError(true);
      });
    return () => {
      active = false;
    };
  }, [source?.id, source?.location, documentPath]);
  const stop = () => {
    previewVideo.current?.pause();
    previewRange.current = null;
    onStopPreview();
  };
  const preview = (start: number, end: number, loop: boolean) => {
    const video = previewVideo.current;
    if (video?.readyState) {
      previewRange.current = { start, end, loop };
      video.currentTime = start / 1000;
      void video.play().catch(() => setPreviewError(true));
    } else if (!source) onPreview(start, end, loop);
  };
  const seek = (ms: number) => {
    stop();
    if (previewVideo.current?.readyState)
      previewVideo.current.currentTime = ms / 1000;
    onSeek(ms);
  };
  const form = useRef<HTMLFormElement>(null);
  const stopPreview = useRef(onStopPreview);
  stopPreview.current = onStopPreview;
  useEffect(() => {
    form.current?.focus();
    return () => stopPreview.current();
  }, []);
  useEffect(() => {
    stopPreview.current();
    previewVideo.current?.pause();
    previewRange.current = null;
  }, [start, end]);
  useEffect(() => {
    setDraft((d) => {
      const ids = clipCategoryIds(d).filter((id) =>
        categories.some((c) => c.id === id),
      );
      return ids.length === clipCategoryIds(d).length
        ? d
        : withClipCategories(d, ids);
    });
  }, [categories]);
  let interval: { start: number; end: number } | null = null;
  try {
    const s = parseTimecode(start),
      e = parseTimecode(end);
    if (e > s && (duration == null || e <= duration))
      interval = { start: s, end: e };
  } catch {}
  const selected = clipCategoryIds(draft);
  const categoryGroups = new Map<string, Category[]>();
  for (const category of categories) {
    const group = category.group || t("Coaching themes");
    categoryGroups.set(group, [...(categoryGroups.get(group) || []), category]);
  }
  const toggleCategory = (id: string) =>
    setDraft((d) => {
      const ids = clipCategoryIds(d);
      if (!ids.includes(id) && ids.length >= 100) return d;
      return withClipCategories(
        d,
        ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id],
      );
    });
  const save = () => {
    try {
      const start_ms = parseTimecode(start),
        end_ms = parseTimecode(end);
      if (!draft.name.trim()) throw new Error("Give the clip a name.");
      if (end_ms <= start_ms) throw new Error("End must be after start.");
      if (duration != null && end_ms > duration)
        throw new Error("End is beyond the source video.");
      onSave({ ...draft, name: draft.name.trim(), start_ms, end_ms });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const boundary = (which: "start" | "end", ms: number) => {
    const value = timecode(Math.max(0, ms));
    which === "start" ? setStart(value) : setEnd(value);
  };
  const tagProps = {
    value: draft.handball,
    onChange: (handball: Clip["handball"]) =>
      setDraft((d) => ({ ...d, handball })),
    clips,
    roster,
  };
  const count =
    selected.length +
    Object.keys(draft.handball || {}).filter((key) => !key.endsWith("_id"))
      .length;
  return (
    <Modal title={t("Tag play")} wide onClose={onCancel}>
      <form
        ref={form}
        tabIndex={-1}
        className="tagging-workspace"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            save();
            return;
          }
          if (
            e.metaKey ||
            e.ctrlKey ||
            e.altKey ||
            e.shiftKey ||
            (e.target as HTMLElement).closest(
              "input,textarea,select,[role=combobox]",
            )
          )
            return;
          if (/^[1-9]$/.test(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            const category = categories.find(
              (c) => categoryShortcut(categories, c) === Number(e.key),
            );
            if (category && !e.repeat) toggleCategory(category.id);
          }
        }}
      >
        <div className="tagging-topbar">
          <label>
            {t("NAME")}
            <input
              aria-label={t("NAME")}
              value={draft.name}
              onChange={(e) =>
                setDraft((d) => ({ ...d, name: e.target.value }))
              }
            />
          </label>
          <div className="tagging-range">
            <span className="mono">
              {interval
                ? `${timecode(interval.start, false)} — ${timecode(interval.end, false)}`
                : t("Set a valid range")}
            </span>
            <strong>
              {interval
                ? `${((interval.end - interval.start) / 1000).toFixed(2)} s`
                : t("Invalid range")}
            </strong>
          </div>
          <p>
            {t("Choose the tags for this play.")}
            <br />
            <span className="muted">
              {t("Save once to apply them together.")}
            </span>
          </p>
        </div>
        <div className="tagging-columns">
          <section
            className="tagging-people"
            aria-label={t("Teams and players")}
          >
            {previewUrl && !previewError && (
              <div className="tagging-preview-frame">
                <video
                  ref={previewVideo}
                  src={previewUrl}
                  muted
                  playsInline
                  preload="auto"
                  onLoadedMetadata={() => {
                    if (previewVideo.current)
                      previewVideo.current.currentTime = clip.start_ms / 1000;
                  }}
                  onLoadedData={() => setPreviewReady(true)}
                  onPlay={() => setPreviewPlaying(true)}
                  onPause={() => setPreviewPlaying(false)}
                  onError={() => setPreviewError(true)}
                  onTimeUpdate={() => {
                    const v = previewVideo.current,
                      range = previewRange.current;
                    if (
                      !v ||
                      !range ||
                      v.seeking ||
                      v.currentTime * 1000 < range.end
                    )
                      return;
                    if (range.loop) {
                      const ended = v.ended;
                      v.currentTime = range.start / 1000;
                      if (ended)
                        void v.play().catch(() => setPreviewError(true));
                    } else {
                      v.pause();
                      v.currentTime = range.end / 1000;
                      previewRange.current = null;
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={!previewReady}
                  onClick={() =>
                    previewPlaying
                      ? stop()
                      : interval && preview(interval.start, interval.end, loop)
                  }
                >
                  {!previewReady
                    ? t("Loading preview…")
                    : previewPlaying
                      ? t("Pause preview")
                      : t("Preview clip")}
                </button>
              </div>
            )}
            <HandballTagBoard {...tagProps} part="people" />
          </section>
          <section className="tagging-play" aria-label={t("Coaching tags")}>
            <div className="tagging-category-heading">
              <h3>
                <Tags size={15} />
                {t("Categories")}
              </h3>
              {!!selected.length && (
                <button
                  type="button"
                  className="tag-clear"
                  onClick={() => setDraft((d) => withClipCategories(d, []))}
                >
                  {t("Clear categories")}
                </button>
              )}
            </div>
            <p className="muted handball-help">
              {t(
                "Optional coaching themes, such as defensive mistakes or highlights. Handball details below describe what happened.",
              )}
            </p>
            {!categories.length && (
              <p className="muted">
                {t(
                  "Add coaching categories in Analysis actions → Manage Categories. Handball tags are ready to use below.",
                )}
              </p>
            )}
            {[...categoryGroups].map(([name, rows]) => (
              <fieldset
                className="tag-section tagging-category-group"
                key={name}
              >
                <legend>{name}</legend>
                <div className="tag-choice-grid">
                  {rows.map((c) => (
                    <button
                      type="button"
                      className="tag-choice category-choice"
                      aria-label={categoryLabel(c)}
                      key={c.id}
                      aria-pressed={selected.includes(c.id)}
                      disabled={
                        selected.length >= 100 && !selected.includes(c.id)
                      }
                      style={
                        { "--category-color": c.color } as React.CSSProperties
                      }
                      onClick={() => toggleCategory(c.id)}
                    >
                      <span
                        className="color-dot"
                        style={{ background: c.color }}
                      />
                      {c.name}
                      {categoryShortcut(categories, c) && (
                        <kbd>{categoryShortcut(categories, c)}</kbd>
                      )}
                      {selected.includes(c.id) && <Check size={14} />}
                    </button>
                  ))}
                </div>
              </fieldset>
            ))}
            <HandballTagBoard {...tagProps} part="play" />
            <label className="tagging-notes">
              {t("NOTES")}
              <textarea
                aria-label={t("NOTES")}
                rows={2}
                value={draft.notes}
                placeholder={t("What should the player or team notice?")}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, notes: e.target.value }))
                }
              />
            </label>
          </section>
          <section className="tagging-shot" aria-label={t("Shot location")}>
            <HandballTagBoard {...tagProps} part="court" />
          </section>
        </div>
        <details className="tagging-timing">
          <summary>
            {t("Clip timing & preview")}{" "}
            <span className="mono">
              {start} – {end}
            </span>
          </summary>
          <div className="tagging-boundaries">
            {(["start", "end"] as const).map((which) => (
              <label key={which}>
                {t(which === "start" ? "Start" : "End")}
                <div className="boundary">
                  <input
                    className="mono"
                    aria-label={t(
                      which === "start" ? "start timecode" : "end timecode",
                    )}
                    value={which === "start" ? start : end}
                    onChange={(e) =>
                      which === "start"
                        ? setStart(e.target.value)
                        : setEnd(e.target.value)
                    }
                  />
                  <button
                    type="button"
                    title={t("Subtract 100 ms from {boundary}", {
                      boundary: t(which),
                    })}
                    onClick={() => {
                      try {
                        boundary(
                          which,
                          parseTimecode(which === "start" ? start : end) - 100,
                        );
                      } catch {}
                    }}
                  >
                    <Minus size={13} />
                  </button>
                  <button
                    type="button"
                    title={t("Add 100 ms to {boundary}", {
                      boundary: t(which),
                    })}
                    onClick={() => {
                      try {
                        boundary(
                          which,
                          parseTimecode(which === "start" ? start : end) + 100,
                        );
                      } catch {}
                    }}
                  >
                    <Plus size={13} />
                  </button>
                  <button
                    type="button"
                    title={t("Use playhead for {boundary}", {
                      boundary: t(which),
                    })}
                    onClick={() => boundary(which, current())}
                  >
                    <Crosshair size={15} />
                  </button>
                </div>
              </label>
            ))}
            <div className="row tagging-preview-buttons">
              <button
                type="button"
                onClick={() => {
                  try {
                    seek(parseTimecode(start));
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {t("Go to start")}
              </button>
              <button
                type="button"
                disabled={!interval}
                onClick={() => interval && seek(interval.end)}
              >
                {t("Go to end")}
              </button>
              <button
                type="button"
                disabled={!interval}
                onClick={() =>
                  interval && preview(interval.start, interval.end, loop)
                }
              >
                {t("Preview sequence")}
              </button>
              <button
                type="button"
                aria-pressed={loop}
                onClick={() => {
                  stop();
                  setLoop(!loop);
                }}
              >
                {t("Loop")}
              </button>
              <button type="button" onClick={stop}>
                {t("Stop")}
              </button>
            </div>
          </div>
        </details>
        {error && (
          <p className="inline-error tagging-error" role="alert">
            {t(error)}
          </p>
        )}
        <div className="modal-footer tagging-footer">
          <span className="tagging-count" aria-live="polite">
            <Check size={15} />
            {t("{count} tags selected", { count })}
          </span>
          {!!count && (
            <button
              type="button"
              className="tag-clear"
              onClick={() =>
                setDraft((d) => ({
                  ...withClipCategories(d, []),
                  handball: undefined,
                }))
              }
            >
              {t("Clear all tags")}
            </button>
          )}
          <span className="muted tagging-save-tip">
            {t("⌘/Ctrl + Enter to save")}
          </span>
          <span className="grow" />
          <button
            type="button"
            title={t("Cancel Clip draft")}
            onClick={onCancel}
          >
            <X size={14} />
            {t("Cancel")}
          </button>
          <button type="submit" className="primary">
            {t("Save Clip")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
