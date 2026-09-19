import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import {
  categorySchema,
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
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (!panel.current?.contains(document.activeElement))
      panel.current
        ?.querySelector<HTMLElement>(
          "input:not(:disabled),button:not(:disabled),select:not(:disabled),textarea:not(:disabled)",
        )
        ?.focus();
    return () => previous?.focus();
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
            <button aria-label="Close dialog" onClick={onClose}>
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
      title={template ? "Category template" : "Analysis Categories"}
      onClose={onClose}
    >
      <div className="modal-body">
        <p className="muted">
          {template
            ? "Copied into new Analyses. Existing Analyses keep their Categories."
            : "Categories are shared by all Source videos. Removing one keeps its Clips uncategorized."}
        </p>
        <div className="category-list">
          {rows.map((c, i) => (
            <div className="category-edit" key={c.id}>
              <ColorPicker
                label={`Color for ${c.name}`}
                value={/^#[0-9a-f]{6}$/i.test(c.color) ? c.color : "#808080"}
                onChange={(color) => update(c.id, { color })}
              />
              <input
                aria-label="Category name"
                value={c.name}
                onChange={(e) => update(c.id, { name: e.target.value })}
              />
              <button
                title="Move earlier"
                disabled={!i}
                onClick={() => move(i, -1)}
              >
                <ArrowUp size={14} />
              </button>
              <button
                title="Move later"
                disabled={i === rows.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown size={14} />
              </button>
              <button
                title="Remove Category"
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
            Add Category
          </button>
          {template && (
            <button
              onClick={() =>
                setRows(
                  defaults.map((c) => ({ ...c, id: crypto.randomUUID() })),
                )
              }
            >
              Restore defaults
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
        <button onClick={onClose}>Cancel</button>
        <button
          className="primary"
          onClick={async () => {
            try {
              const parsed = rows.map((c) => categorySchema.parse(c));
              if (
                new Set(parsed.map((c) => normalizeName(c.name))).size !==
                parsed.length
              )
                throw new Error("Category names must be unique");
              await onSave(parsed);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Save Categories
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
  const [clips, setClips] = useState(initial);
  const [options, setOptions] = useState<Omit<ExportOptions, "ids">>({
    title: true,
    categories: true,
    notes: true,
    numbers: true,
    audio: false,
    annotations: true,
    encoder: "auto",
    height: 1080,
  });
  const move = (i: number, by: number) => {
    const next = [...clips];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    setClips(next);
  };
  return (
    <Modal title="Combined export" wide onClose={running ? undefined : onClose}>
      <div className="modal-body">
        <p className="muted">
          Reorder the Export list independently of your Analysis.
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
                    {analysis.categories.find((t) => t.id === c.category_id)
                      ?.name || "Ohne Kategorie"}{" "}
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
                        : 0),
                    false,
                  )}
                </span>
                <button
                  title="Move earlier"
                  disabled={!i}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  title="Move later"
                  disabled={i === clips.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  title="Remove from export"
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
                {label}
              </label>
            ))}
            <label>
              Resolution
              <Select
                label="Resolution"
                value={String(options.height)}
                onChange={(value) =>
                  setOptions({ ...options, height: Number(value) })
                }
                options={[
                  { value: "1080", label: "1080p" },
                  { value: "720", label: "720p" },
                ]}
              />
            </label>
            <label>
              Encoder
              <Select
                label="Encoder"
                value={options.encoder}
                onChange={(value) =>
                  setOptions({
                    ...options,
                    encoder: value as "auto" | "software",
                  })
                }
                options={[
                  { value: "auto", label: "Automatic" },
                  { value: "software", label: "Software (H.264)" },
                ]}
              />
            </label>
          </div>
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
        <span className="muted grow">{clips.length} Clips · MP4 / H.264</span>
        {running ? (
          <button onClick={onCancel}>Cancel export</button>
        ) : (
          <>
            <button onClick={onClose}>Cancel</button>
            <button
              className="primary"
              disabled={!clips.length}
              onClick={() =>
                onExport({ ...options, ids: clips.map((c) => c.id) })
              }
            >
              Export video…
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
