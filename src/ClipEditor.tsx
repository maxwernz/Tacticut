import { useEffect, useRef, useState } from "react";
import { X, Crosshair, Minus, Plus } from "lucide-react";
import { parseTimecode, timecode, type Category, type Clip } from "./domain";
import { Select } from "./Select";
export function ClipEditor({
  clip,
  categories,
  duration,
  current,
  onSeek,
  onSave,
  onCancel,
  onPreview,
  onStopPreview,
}: {
  clip: Clip;
  categories: Category[];
  duration: number | null;
  current(): number;
  onSeek(ms: number): void;
  onSave(clip: Clip): void;
  onCancel(): void;
  onPreview(start: number, end: number, loop: boolean): void;
  onStopPreview(): void;
}) {
  const [draft, setDraft] = useState(clip),
    [start, setStart] = useState(timecode(clip.start_ms)),
    [end, setEnd] = useState(timecode(clip.end_ms)),
    [error, setError] = useState("");
  const [loop, setLoop] = useState(false);
  const stopPreview = useRef(onStopPreview);
  stopPreview.current = onStopPreview;
  useEffect(() => () => stopPreview.current(), []);
  useEffect(() => {
    stopPreview.current();
  }, [start, end]);
  useEffect(() => {
    if (
      draft.category_id &&
      !categories.some((c) => c.id === draft.category_id)
    )
      setDraft((d) => ({ ...d, category_id: null }));
  }, [categories, draft.category_id]);
  let interval: { start: number; end: number } | null = null;
  try {
    const s = parseTimecode(start),
      e = parseTimecode(end);
    if (e > s && (duration == null || e <= duration))
      interval = { start: s, end: e };
  } catch {}
  const addNote = (text: string) =>
    setDraft((d) => ({
      ...d,
      notes: [d.notes.trimEnd(), text].filter(Boolean).join("\n"),
    }));
  const boundary = (which: "start" | "end", ms: number) => {
    const value = timecode(Math.max(0, ms));
    which === "start" ? setStart(value) : setEnd(value);
  };
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const start_ms = parseTimecode(start),
        end_ms = parseTimecode(end);
      if (!draft.name.trim()) throw new Error("Give the Clip a name");
      if (end_ms <= start_ms) throw new Error("End must be after start");
      if (duration != null && end_ms > duration)
        throw new Error("End is beyond the Source video");
      onSave({ ...draft, name: draft.name.trim(), start_ms, end_ms });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <aside className="clip-editor">
      <div className="panel-heading">
        <h2>Edit Clip</h2>
        <button title="Cancel Clip draft" onClick={onCancel}>
          <X size={17} />
        </button>
      </div>
      <form onSubmit={save}>
        <label>
          NAME
          <input
            autoFocus
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <div className="editor-section">
          <h3>BOUNDARIES</h3>
          <div className="clip-duration">
            <span>Selected sequence</span>
            <strong className="mono">
              {interval
                ? `${((interval.end - interval.start) / 1000).toFixed(2)} s`
                : "Invalid range"}
            </strong>
          </div>
          {(["start", "end"] as const).map((which) => (
            <label key={which}>
              {which === "start" ? "Start" : "End"}
              <div className="boundary">
                <input
                  aria-label={`${which} timecode`}
                  className="mono"
                  value={which === "start" ? start : end}
                  onChange={(e) =>
                    which === "start"
                      ? setStart(e.target.value)
                      : setEnd(e.target.value)
                  }
                />
                <button
                  type="button"
                  title="Subtract 100 ms"
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
                  title="Add 100 ms"
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
                  title="Use playhead position"
                  onClick={() => boundary(which, current())}
                >
                  <Crosshair size={16} />
                </button>
              </div>
            </label>
          ))}
          <div className="boundary-navigation">
            <button
              type="button"
              onClick={() => {
                try {
                  onSeek(parseTimecode(start));
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Go to start
            </button>
            <button
              type="button"
              disabled={!interval}
              onClick={() => interval && onSeek(interval.end)}
            >
              Go to end
            </button>
          </div>
          <div className="row">
            <button
              type="button"
              disabled={!interval}
              onClick={() =>
                interval && onPreview(interval.start, interval.end, loop)
              }
            >
              Preview sequence
            </button>
            <button
              type="button"
              className={loop ? "active" : ""}
              aria-pressed={loop}
              onClick={() => {
                onStopPreview();
                setLoop(!loop);
              }}
            >
              Loop
            </button>
            <button type="button" onClick={onStopPreview}>
              Stop
            </button>
          </div>
        </div>
        <div className="category-field">
          <h3>CATEGORY</h3>
          <div className="category-chips" role="group" aria-label="CATEGORY">
            {[
              { id: "", name: "Ohne Kategorie", color: "#808080" },
              ...categories,
            ].map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={(draft.category_id || "") === c.id}
                style={{ "--category-color": c.color } as React.CSSProperties}
                onClick={() =>
                  setDraft({ ...draft, category_id: c.id || null })
                }
              >
                <span className="color-dot" style={{ background: c.color }} />
                {c.name}
              </button>
            ))}
          </div>
        </div>
        <label>
          NOTES
          <textarea
            rows={7}
            placeholder="What happened? What should the team notice?"
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </label>
        <details className="handball-notes">
          <summary>Handball coaching prompts</summary>
          <p className="muted">
            Add a prompt to your notes, then describe the play.
          </p>
          <Select
            label="Add tactical phase"
            value=""
            display="Tactical phase…"
            options={[
              "Fast break",
              "Second wave",
              "Positional attack",
              "6:0 defense",
              "5:1 defense",
              "7 vs 6",
              "Power play / short-handed",
            ].map((label) => ({ value: label, label }))}
            onChange={(value) => addNote(`Phase: ${value}`)}
          />
          <Select
            label="Add outcome"
            value=""
            display="Outcome…"
            options={[
              "Goal",
              "Saved shot",
              "Missed shot",
              "Turnover",
              "7 m penalty won",
              "Two-minute suspension",
            ].map((label) => ({ value: label, label }))}
            onChange={(value) => addNote(`Outcome: ${value}`)}
          />
          <button
            type="button"
            onClick={() => addNote("Situation: \nDecision: \nCoaching point: ")}
          >
            Add coaching structure
          </button>
        </details>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="editor-footer">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary" type="submit">
            Save Clip
          </button>
        </div>
      </form>
    </aside>
  );
}
