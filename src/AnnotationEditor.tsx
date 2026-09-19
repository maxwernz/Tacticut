import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Circle, Plus, Redo2, Trash2, Undo2 } from "lucide-react";
import { Modal } from "./Dialogs";
import { Select } from "./Select";
import { AnnotationCanvas } from "./AnnotationCanvas";
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
  const [tool, setTool] = useState<Drawing["kind"]>("arrow"),
    [color, setColor] = useState("#FACC15"),
    [width, setWidth] = useState(0.006);
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
    const previous = history.slice(0, index + 1);
    const stack = [...previous, next].slice(-50);
    setHistory(stack);
    setIndex(stack.length - 1);
    setError("");
  };
  const update = (patch: Partial<FreezeFrame>) =>
    commit(frames.map((f) => (f.id === current.id ? { ...f, ...patch } : f)));
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
    <Modal title={`Freeze-frames · ${clip.name}`} wide onClose={close}>
      <div
        className="annotation-editor"
        onKeyDown={(e) => {
          if (
            (e.ctrlKey || e.metaKey) &&
            e.key.toLowerCase() === "z" &&
            !(e.target as HTMLElement).closest("input,textarea")
          ) {
            e.preventDefault();
            e.stopPropagation();
            setIndex((i) =>
              e.shiftKey
                ? Math.min(history.length - 1, i + 1)
                : Math.max(0, i - 1),
            );
          }
        }}
      >
        <div className="annotation-topline">
          <Select
            label="Coaching moment"
            value={current.id}
            options={frames.map((f, i) => ({
              value: f.id,
              label: `${i + 1} · ${timecode(f.time_ms)}${!f.shapes.length ? " · new" : ""}`,
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
            New moment
          </button>
          <button
            title="Delete coaching moment"
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
          aria-label="Drawing tools"
        >
          <button
            aria-pressed={tool === "arrow"}
            onClick={() => setTool("arrow")}
          >
            <ArrowUpRight size={16} />
            Arrow
          </button>
          <button
            aria-pressed={tool === "circle"}
            onClick={() => setTool("circle")}
          >
            <Circle size={16} />
            Circle
          </button>
          {["#FACC15", "#FFFFFF", "#EF4444", "#38BDF8"].map((c) => (
            <button
              key={c}
              className="drawing-color"
              aria-label={`Draw in ${c}`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
            >
              <span style={{ background: c }} />
            </button>
          ))}
          <Select
            label="Drawing thickness"
            value={String(width)}
            onChange={(v) => setWidth(Number(v))}
            options={[
              { value: "0.003", label: "Thin" },
              { value: "0.006", label: "Medium" },
              { value: "0.01", label: "Thick" },
            ]}
          />
          <span className="grow" />
          <button
            title="Undo drawing edit"
            disabled={!index}
            onClick={() => setIndex(index - 1)}
          >
            <Undo2 size={15} />
          </button>
          <button
            title="Redo drawing edit"
            disabled={index === history.length - 1}
            onClick={() => setIndex(index + 1)}
          >
            <Redo2 size={15} />
          </button>
          <button
            disabled={!current.shapes.length}
            onClick={() => update({ shapes: [] })}
          >
            Clear drawings
          </button>
        </div>
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
              {error ? "Frame unavailable" : "Loading frame…"}
            </span>
          )}
        </div>
        <div className="annotation-timing">
          <button
            title="Previous annotation frame"
            onClick={() =>
              update({ time_ms: bound(current.time_ms - 1000 / media.fps) })
            }
          >
            −1 frame
          </button>
          <span className="mono">{timecode(current.time_ms)}</span>
          <button
            title="Next annotation frame"
            onClick={() =>
              update({ time_ms: bound(current.time_ms + 1000 / media.fps) })
            }
          >
            +1 frame
          </button>
          <input
            type="range"
            aria-label="Freeze-frame time"
            min={clip.start_ms}
            max={clip.end_ms - 1}
            step="1"
            value={current.time_ms}
            onChange={(e) => update({ time_ms: Number(e.target.value) })}
          />
          <label>
            Hold (seconds)
            <input
              aria-label="Freeze duration in seconds"
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
          Drag over the video to draw. Saved moments appear in Clip review,
          playlists and exports; normal Source playback stays unchanged.
        </p>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {discard && (
          <div className="annotation-discard" role="alert">
            Discard unsaved freeze-frame changes?
            <button onClick={() => setDiscard(false)}>Keep editing</button>
            <button onClick={onClose}>Discard changes</button>
          </div>
        )}
      </div>
      <div className="modal-footer">
        <span className="muted">
          {persisted.length} moments · file format v3
        </span>
        <span className="grow" />
        <button onClick={close}>Cancel</button>
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
          Save freeze-frames
        </button>
      </div>
    </Modal>
  );
}
