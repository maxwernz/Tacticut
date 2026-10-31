import { t, useLanguage } from "./i18n";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Circle,
  Plus,
  Redo2,
  Trash2,
  Undo2,
  MousePointer2,
  Minus,
  Type,
} from "lucide-react";
import { Modal } from "./Dialogs";
import { Select } from "./Select";
import { AnnotationCanvas, type DrawingTool } from "./AnnotationCanvas";
import { moveDrawing } from "./annotations";
import {
  freezeFrameSchema,
  timecode,
  type Clip,
  type Drawing,
  type FreezeFrame,
} from "./domain";
import type { Media } from "./api";
export function AnnotationEditor({
  clip,
  media,
  time,
  initial,
  onSave,
  onClose,
}: {
  clip: Clip;
  media: Media;
  time: number;
  initial: FreezeFrame[];
  onSave(frames: FreezeFrame[]): void;
  onClose(): void;
}) {
  useLanguage();
  const bound = (ms: number) =>
    Math.max(clip.start_ms, Math.min(clip.end_ms - 1, Math.round(ms)));
  const blank = (ms: number): FreezeFrame => ({
    id: crypto.randomUUID(),
    clip_id: clip.id,
    time_ms: bound(ms),
    hold_ms: 3000,
    shapes: [],
  });
  const [history, setHistory] = useState<FreezeFrame[][]>(() => [
      initial.length ? structuredClone(initial) : [blank(time)],
    ]),
    [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(
    () => initial.find((f) => Math.abs(f.time_ms - time) < 100)?.id || null,
  );
  const frames = history[index],
    current = frames.find((f) => f.id === selected) || frames[0];
  const [tool, setTool] = useState<DrawingTool>("arrow"),
    [color, setColor] = useState("#FACC15"),
    [width, setWidth] = useState(0.006);
  const [selectedShape, setSelectedShape] = useState<string | null>(null),
    [text, setText] = useState(""),
    [fontSize, setFontSize] = useState(0.045);
  const selectedDrawing =
    tool === "select"
      ? current.shapes.find((s) => s.id === selectedShape)
      : undefined;
  useEffect(() => {
    setSelectedShape(null);
  }, [current.id]);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [discard, setDiscard] = useState(false);
  const [dimensions, setDimensions] = useState({
    width: media.width,
    height: media.height,
  });
  const video = useRef<HTMLVideoElement>(null);
  const decodedTimes = useRef(
    new Map<string, { target: number; time: number }>(),
  );
  const persisted = frames
    .filter((f) => f.shapes.length)
    .sort((a, b) => a.time_ms - b.time_ms);
  const dirty =
    JSON.stringify(persisted) !==
    JSON.stringify([...initial].sort((a, b) => a.time_ms - b.time_ms));
  const commit = (next: FreezeFrame[]) => {
    if (JSON.stringify(next) === JSON.stringify(frames)) return;
    const previous = history.slice(0, index + 1);
    const stack = [...previous, next].slice(-50);
    setHistory(stack);
    setIndex(stack.length - 1);
    setError("");
  };
  const update = (patch: Partial<FreezeFrame>) =>
    commit(frames.map((f) => (f.id === current.id ? { ...f, ...patch } : f)));
  const changeShape = (shape: Drawing) =>
    update({
      shapes: current.shapes.map((s) => (s.id === shape.id ? shape : s)),
    });
  const deleteShape = () => {
    if (!selectedDrawing) return;
    update({
      shapes: current.shapes.filter((s) => s.id !== selectedDrawing.id),
    });
    setSelectedShape(null);
  };
  const historyCommand = (redo: boolean) =>
    setIndex((i) =>
      redo ? Math.min(history.length - 1, i + 1) : Math.max(0, i - 1),
    );
  const nativeCommand = useRef((name: string) => {});
  nativeCommand.current = (name) => {
    if (name !== "undo" && name !== "redo") return;
    if (
      (document.activeElement as HTMLElement | null)?.closest(
        "input:not([type=range]),textarea,[contenteditable=true]",
      )
    ) {
      document.execCommand?.(name);
      return;
    }
    historyCommand(name === "redo");
  };
  useEffect(
    () => window.desktop?.onCommand((name) => nativeCommand.current(name)),
    [],
  );
  const seek = () => {
    const v = video.current;
    if (!v || !current || v.readyState < 1) return;
    v.pause();
    v.currentTime = current.time_ms / 1000;
  };
  const settled = () => {
    const v = video.current;
    const decoded = decodedTimes.current.get(current.id);
    if (
      decoded?.target === current.time_ms &&
      (decoded.time < clip.start_ms || decoded.time >= clip.end_ms)
    )
      return;
    if (
      v &&
      !v.seeking &&
      v.readyState >= 2 &&
      Math.abs(v.currentTime * 1000 - current.time_ms) < 50
    )
      setReady(true);
  };
  useEffect(() => {
    setReady(false);
    const v = video.current;
    let callback: number | undefined,
      cancelled = false;
    const sample = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      if (cancelled || !v) return;
      const actual = Math.ceil(metadata.mediaTime * 1000 - 0.000001);
      if (
        v.seeking ||
        Math.abs(v.currentTime * 1000 - current.time_ms) > 50 ||
        Math.abs(actual - current.time_ms) > Math.max(100, 2000 / media.fps)
      ) {
        callback = v.requestVideoFrameCallback(sample);
        return;
      }
      decodedTimes.current.set(current.id, {
        target: current.time_ms,
        time: actual,
      });
      if (actual < clip.start_ms || actual >= clip.end_ms) {
        setReady(false);
        setError("Choose a frame further inside the Clip boundaries.");
        return;
      }
      settled();
    };
    callback = v?.requestVideoFrameCallback?.(sample);
    seek();
    settled();
    return () => {
      cancelled = true;
      if (callback !== undefined) v?.cancelVideoFrameCallback(callback);
    };
  }, [current.id, current.time_ms, media.url]);
  const close = () => (dirty ? setDiscard(true) : onClose());
  return (
    <Modal
      title={t("Freeze-frames · {name}", { name: clip.name })}
      wide
      onClose={close}
    >
      <div
        className="annotation-editor"
        onKeyDown={(e) => {
          if (
            (e.target as HTMLElement).closest(
              "input,textarea,[contenteditable=true]",
            )
          )
            return;
          const key = e.key.toLowerCase();
          if ((e.ctrlKey || e.metaKey) && (key === "z" || key === "y")) {
            e.preventDefault();
            e.stopPropagation();
            historyCommand(key === "y" || e.shiftKey);
          } else if (
            selectedDrawing &&
            (key === "delete" || key === "backspace")
          ) {
            e.preventDefault();
            e.stopPropagation();
            deleteShape();
          } else if (
            selectedDrawing &&
            ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
          ) {
            e.preventDefault();
            e.stopPropagation();
            const amount = e.shiftKey ? 0.02 : 0.005;
            changeShape(
              moveDrawing(
                selectedDrawing,
                e.key === "ArrowLeft"
                  ? -amount
                  : e.key === "ArrowRight"
                    ? amount
                    : 0,
                e.key === "ArrowUp"
                  ? -amount
                  : e.key === "ArrowDown"
                    ? amount
                    : 0,
              ),
            );
          }
        }}
      >
        <div className="annotation-topline">
          <Select
            label={t("Coaching moment")}
            value={current.id}
            options={frames.map((f, i) => ({
              value: f.id,
              label: `${i + 1} · ${timecode(f.time_ms)}${!f.shapes.length ? t(" · new") : ""}`,
            }))}
            onChange={setSelected}
          />
          <button
            onClick={() => {
              const frame = blank(bound(current.time_ms + 1000));
              commit([...frames, frame]);
              setSelected(frame.id);
            }}
          >
            <Plus size={14} />
            {t("New moment")}
          </button>
          <button
            title={t("Delete coaching moment")}
            onClick={() => {
              const remaining = frames.filter((f) => f.id !== current.id);
              const next = remaining.length
                ? remaining
                : [blank(current.time_ms)];
              commit(next);
              setSelected(next[0].id);
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
        <div
          className="annotation-tools"
          role="toolbar"
          aria-label={t("Drawing tools")}
        >
          <button
            aria-pressed={tool === "select"}
            onClick={() => setTool("select")}
          >
            <MousePointer2 size={16} />
            {t("Select")}
          </button>
          <button
            aria-pressed={tool === "arrow"}
            onClick={() => setTool("arrow")}
          >
            <ArrowUpRight size={16} />
            {t("Arrow")}
          </button>
          <button
            aria-pressed={tool === "circle"}
            onClick={() => setTool("circle")}
          >
            <Circle size={16} />
            {t("Circle")}
          </button>
          <button
            aria-pressed={tool === "line"}
            onClick={() => setTool("line")}
          >
            <Minus size={16} />
            {t("Line")}
          </button>
          <button
            aria-pressed={tool === "text"}
            onClick={() => setTool("text")}
          >
            <Type size={16} />
            {t("Text")}
          </button>
          {["#FACC15", "#FFFFFF", "#EF4444", "#38BDF8"].map((c) => (
            <button
              key={c}
              className="drawing-color"
              aria-label={t("Draw in {color}", { color: c })}
              aria-pressed={(selectedDrawing?.color || color) === c}
              onClick={() => {
                setColor(c);
                if (selectedDrawing)
                  changeShape({ ...selectedDrawing, color: c });
              }}
            >
              <span style={{ background: c }} />
            </button>
          ))}
          <Select
            label={t("Drawing thickness")}
            value={String(selectedDrawing?.width || width)}
            onChange={(v) => {
              setWidth(Number(v));
              if (selectedDrawing)
                changeShape({ ...selectedDrawing, width: Number(v) });
            }}
            options={[
              { value: "0.003", label: t("Thin") },
              { value: "0.006", label: t("Medium") },
              { value: "0.01", label: t("Thick") },
            ]}
          />
          <span className="grow" />
          <button
            title={t("Undo drawing edit")}
            disabled={!index}
            onClick={() => setIndex(index - 1)}
          >
            <Undo2 size={15} />
          </button>
          <button
            title={t("Redo drawing edit")}
            disabled={index === history.length - 1}
            onClick={() => setIndex(index + 1)}
          >
            <Redo2 size={15} />
          </button>
          <button
            disabled={!current.shapes.length}
            onClick={() => update({ shapes: [] })}
          >
            {t("Clear drawings")}
          </button>
        </div>
        {tool === "select" && (
          <div className="annotation-properties">
            <Select
              label={t("Selected drawing")}
              value={selectedDrawing?.id || ""}
              options={[
                { value: "", label: t("Choose a drawing") },
                ...current.shapes.map((s, i) => ({
                  value: s.id,
                  label: `${i + 1} · ${t(s.kind)}${s.text ? ` · ${s.text.slice(0, 30)}` : ""}`,
                })),
              ]}
              onChange={(id) => setSelectedShape(id || null)}
            />
            <button disabled={!selectedDrawing} onClick={deleteShape}>
              <Trash2 size={14} />
              {t("Delete selected")}
            </button>
            <span className="muted">
              {t("Drag to move · white handles resize · arrow keys nudge")}
            </span>
          </div>
        )}
        {(tool === "text" || selectedDrawing?.kind === "text") && (
          <div className="annotation-properties">
            <label>
              {t("Text")}{" "}
              {selectedDrawing?.kind === "text" ? (
                <TextDrawingInput
                  key={selectedDrawing.id}
                  value={selectedDrawing.text || ""}
                  onCommit={(value) =>
                    changeShape({ ...selectedDrawing, text: value })
                  }
                />
              ) : (
                <input
                  aria-label={t("Drawing text")}
                  maxLength={160}
                  value={text}
                  placeholder={t("e.g. Attack the space")}
                  onChange={(e) => setText(e.target.value)}
                />
              )}
            </label>
            <Select
              label={t("Text size")}
              value={String(selectedDrawing?.font_size || fontSize)}
              options={[
                { value: "0.03", label: t("Small") },
                { value: "0.045", label: t("Medium") },
                { value: "0.06", label: t("Large") },
                { value: "0.09", label: t("Extra large") },
              ]}
              onChange={(value) => {
                setFontSize(Number(value));
                if (selectedDrawing)
                  changeShape({ ...selectedDrawing, font_size: Number(value) });
              }}
            />
            <span className="muted">
              {tool === "text"
                ? t("Enter text, then drag a box on the video.")
                : t("Resize the box to show more text.")}
            </span>
          </div>
        )}
        <div className="annotation-stage">
          <video
            ref={video}
            src={media.url}
            preload="auto"
            muted
            playsInline
            onLoadedMetadata={() => {
              const v = video.current!;
              setDimensions({
                width: v.videoWidth || media.width,
                height: v.videoHeight || media.height,
              });
              seek();
              settled();
            }}
            onSeeked={settled}
            onLoadedData={settled}
            onCanPlay={settled}
            onError={() => {
              setReady(false);
              setError(
                "This frame could not be loaded. Close the editor and prepare compatible playback or relink the Source video.",
              );
            }}
          />
          <AnnotationCanvas
            shapes={ready ? current.shapes : []}
            videoWidth={dimensions.width}
            videoHeight={dimensions.height}
            tool={tool}
            color={color}
            width={width}
            text={text}
            fontSize={fontSize}
            selected={selectedShape}
            onSelect={setSelectedShape}
            onChange={changeShape}
            disabled={!ready}
            onDraw={(shape) => {
              if (current.shapes.length >= 100) {
                setError("A moment can contain at most 100 drawings.");
                return;
              }
              update({ shapes: [...current.shapes, shape] });
            }}
          />
          {!ready && (
            <span className="annotation-loading">
              {t(error ? "Frame unavailable" : "Loading frame…")}
            </span>
          )}
        </div>
        <div className="annotation-timing">
          <button
            title={t("Previous annotation frame")}
            onClick={() =>
              update({ time_ms: bound(current.time_ms - 1000 / media.fps) })
            }
          >
            {t("−1 frame")}
          </button>
          <span className="mono">{timecode(current.time_ms)}</span>
          <button
            title={t("Next annotation frame")}
            onClick={() =>
              update({ time_ms: bound(current.time_ms + 1000 / media.fps) })
            }
          >
            {t("+1 frame")}
          </button>
          <input
            type="range"
            aria-label={t("Freeze-frame time")}
            min={clip.start_ms}
            max={clip.end_ms - 1}
            step="1"
            value={current.time_ms}
            onChange={(e) => update({ time_ms: Number(e.target.value) })}
          />
          <label>
            {t("Hold (seconds)")}
            <input
              aria-label={t("Freeze duration in seconds")}
              type="number"
              min="0.5"
              max="15"
              step="0.5"
              value={current.hold_ms / 1000}
              onChange={(e) => {
                const hold = Number(e.target.value) * 1000;
                if (Number.isInteger(hold) && hold >= 500 && hold <= 15000)
                  update({ hold_ms: hold });
              }}
            />
          </label>
        </div>
        <p className="muted annotation-help">
          {t(
            "Drag to draw. Use Select to move, resize or delete a drawing. Changes stay in this editor until Save; saved moments appear in reviews and exports.",
          )}
        </p>
        {error && (
          <p className="inline-error" role="alert">
            {t(error)}
          </p>
        )}
        {discard && (
          <div className="annotation-discard" role="alert">
            {t("Discard unsaved freeze-frame changes?")}
            <button onClick={() => setDiscard(false)}>
              {t("Keep editing")}
            </button>
            <button onClick={onClose}>{t("Discard changes")}</button>
          </div>
        )}
      </div>
      <div className="modal-footer">
        <span className="muted">
          {t("{count} moments", { count: persisted.length })}
        </span>
        <span className="grow" />
        <button onClick={close}>{t("Cancel")}</button>
        <button
          className="primary"
          disabled={!dirty || (!ready && current.shapes.length > 0)}
          onClick={() => {
            try {
              const parsed = persisted.map((f) => {
                const decoded = decodedTimes.current.get(f.id);
                return freezeFrameSchema.parse({
                  ...f,
                  time_ms:
                    decoded?.target === f.time_ms ? decoded.time : f.time_ms,
                });
              });
              if (new Set(parsed.map((f) => f.time_ms)).size !== parsed.length)
                throw new Error(
                  "Move one of the moments: two freeze-frames cannot share the same time.",
                );
              onSave(parsed);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          {t("Save freeze-frames")}
        </button>
      </div>
    </Modal>
  );
}

function TextDrawingInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit(value: string): void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const save = () => {
    if (draft.trim()) onCommit(draft.trim());
    else setDraft(value);
  };
  return (
    <input
      aria-label={t("Drawing text")}
      maxLength={160}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          save();
        }
      }}
    />
  );
}
