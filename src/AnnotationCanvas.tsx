import { t, useLanguage } from "./i18n";
import { useEffect, useId, useRef, useState } from "react";
import {
  containRect,
  drawingBounds,
  drawingPath,
  drawingText,
  moveDrawing,
  relativePoint,
  resizeDrawing,
} from "./annotations";
import { drawingSchema, type Drawing } from "./domain";
export type DrawingTool = Drawing["kind"] | "select";
export function AnnotationCanvas({
  shapes,
  videoWidth,
  videoHeight,
  tool = "arrow",
  color = "#FACC15",
  width = 0.006,
  text = "",
  fontSize = 0.045,
  selected = null,
  onSelect,
  onChange,
  onDraw,
  disabled = false,
}: {
  shapes: Drawing[];
  videoWidth: number;
  videoHeight: number;
  tool?: DrawingTool;
  color?: string;
  width?: number;
  text?: string;
  fontSize?: number;
  selected?: string | null;
  onSelect?(id: string | null): void;
  onChange?(shape: Drawing): void;
  onDraw?(shape: Drawing): void;
  disabled?: boolean;
}) {
  useLanguage();
  type Drag = {
    shape: Drawing;
    pointer: number;
    start: { x: number; y: number };
    mode: "draw" | "move" | "start" | "end";
  };
  const root = useRef<HTMLDivElement>(null),
    drag = useRef<Drag | null>(null);
  const prefix = useId().replaceAll(":", "");
  const [size, setSize] = useState({ width: 0, height: 0 }),
    [pending, setPending] = useState<Drawing | null>(null);
  useEffect(() => {
    const element = root.current!;
    const update = () => {
      const box = element.getBoundingClientRect();
      setSize({ width: box.width, height: box.height });
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    drag.current = null;
    setPending(null);
  }, [disabled, tool, shapes]);
  const rect = containRect(size.width, size.height, videoWidth, videoHeight);
  const cancel = () => {
    drag.current = null;
    setPending(null);
  };
  const preview = (x: number, y: number) => {
    const current = drag.current!;
    if (current.mode === "move")
      return moveDrawing(
        current.shape,
        x - current.start.x,
        y - current.start.y,
      );
    if (current.mode !== "draw")
      return resizeDrawing(current.shape, current.mode, x, y);
    const shape = { ...current.shape, x2: x, y2: y };
    if (shape.kind === "text")
      return {
        ...shape,
        x1: Math.min(current.start.x, x),
        y1: Math.min(current.start.y, y),
        x2: Math.max(current.start.x, x),
        y2: Math.max(current.start.y, y),
      };
    return shape;
  };
  const visible = shapes.map((s) => (pending?.id === s.id ? pending : s));
  if (pending && !shapes.some((s) => s.id === pending.id))
    visible.push(pending);
  const selection = tool === "select" && visible.find((s) => s.id === selected);
  const box = selection ? drawingBounds(selection) : null;
  const unit = Math.min(videoWidth, videoHeight);
  return (
    <div
      ref={root}
      className={`annotation-layer ${onDraw && !disabled ? "editable" : ""}`}
    >
      <svg
        aria-label={t(
          onDraw ? "Draw on frozen video" : "Saved freeze-frame drawings",
        )}
        role="img"
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
          cursor: tool === "select" ? "default" : undefined,
        }}
        viewBox={`0 0 ${videoWidth} ${videoHeight}`}
        onPointerDown={(e) => {
          if (
            drag.current ||
            !onDraw ||
            disabled ||
            e.button !== 0 ||
            !e.currentTarget.getBoundingClientRect().width
          )
            return;
          e.preventDefault();
          const p = relativePoint(
            e.clientX,
            e.clientY,
            e.currentTarget.getBoundingClientRect(),
          );
          if (tool === "select") {
            const hit = (e.target as Element).closest("[data-shape-id]");
            const shape = shapes.find(
              (s) => s.id === hit?.getAttribute("data-shape-id"),
            );
            onSelect?.(shape?.id || null);
            if (!shape) return;
            const handle = hit?.getAttribute("data-handle");
            drag.current = {
              shape,
              pointer: e.pointerId,
              start: p,
              mode: handle === "start" || handle === "end" ? handle : "move",
            };
          } else {
            if (tool === "text" && !text.trim()) return;
            const shape: Drawing = {
              id: crypto.randomUUID(),
              kind: tool,
              x1: p.x,
              y1: p.y,
              x2: p.x,
              y2: p.y,
              color,
              width,
              ...(tool === "text"
                ? { text: text.trim(), font_size: fontSize }
                : {}),
            };
            drag.current = {
              shape,
              pointer: e.pointerId,
              start: p,
              mode: "draw",
            };
            setPending(shape);
          }
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current || drag.current.pointer !== e.pointerId) return;
          const p = relativePoint(
            e.clientX,
            e.clientY,
            e.currentTarget.getBoundingClientRect(),
          );
          setPending(preview(p.x, p.y));
        }}
        onPointerUp={(e) => {
          if (!drag.current || drag.current.pointer !== e.pointerId) return;
          const previous = drag.current;
          const p = relativePoint(
            e.clientX,
            e.clientY,
            e.currentTarget.getBoundingClientRect(),
          );
          const shape = preview(p.x, p.y);
          cancel();
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
          if (!drawingSchema.safeParse(shape).success) return;
          if (previous.mode === "draw") {
            onDraw?.(shape);
            onSelect?.(shape.id);
          } else if (JSON.stringify(shape) !== JSON.stringify(previous.shape))
            onChange?.(shape);
        }}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
      >
        {visible.map((s) => {
          const hit = onDraw && tool === "select" && !disabled;
          const clipId = `${prefix}-${s.id}`;
          const content =
            s.kind === "text" ? drawingText(s, videoWidth, videoHeight) : null;
          return (
            <g
              key={s.id}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              pointerEvents="none"
            >
              {content ? (
                <>
                  <defs>
                    <clipPath id={clipId}>
                      <rect
                        x={s.x1 * videoWidth}
                        y={s.y1 * videoHeight}
                        width={(s.x2 - s.x1) * videoWidth}
                        height={(s.y2 - s.y1) * videoHeight}
                      />
                    </clipPath>
                  </defs>
                  <text
                    clipPath={`url(#${clipId})`}
                    fontFamily="Noto Sans"
                    fontSize={content.fontSize}
                    fill={s.color}
                    stroke="#000"
                    strokeWidth={content.fontSize * 0.08}
                    paintOrder="stroke"
                  >
                    {content.lines.map((line, i) => (
                      <tspan
                        key={i}
                        x={s.x1 * videoWidth}
                        y={
                          s.y1 * videoHeight + content.fontSize * (1 + 1.2 * i)
                        }
                      >
                        {line}
                      </tspan>
                    ))}
                  </text>
                  {hit && (
                    <rect
                      data-shape-id={s.id}
                      x={s.x1 * videoWidth}
                      y={s.y1 * videoHeight}
                      width={(s.x2 - s.x1) * videoWidth}
                      height={(s.y2 - s.y1) * videoHeight}
                      fill="transparent"
                      pointerEvents="all"
                      style={{ cursor: "move" }}
                    />
                  )}
                </>
              ) : (
                <>
                  <path
                    d={drawingPath(s, videoWidth, videoHeight)}
                    stroke="#000"
                    strokeOpacity=".65"
                    strokeWidth={(s.width + 0.003) * unit}
                  />
                  <path
                    d={drawingPath(s, videoWidth, videoHeight)}
                    stroke={s.color}
                    strokeWidth={s.width * unit}
                  />
                  {hit && (
                    <path
                      data-shape-id={s.id}
                      d={drawingPath(s, videoWidth, videoHeight)}
                      stroke="transparent"
                      strokeWidth={Math.max(s.width * unit, unit * 0.035)}
                      fill={s.kind === "circle" ? "transparent" : "none"}
                      pointerEvents={s.kind === "circle" ? "all" : "stroke"}
                      style={{ cursor: "move" }}
                    />
                  )}
                </>
              )}
            </g>
          );
        })}
        {selection && box && (
          <>
            <rect
              x={box.left * videoWidth - 3}
              y={box.top * videoHeight - 3}
              width={(box.right - box.left) * videoWidth + 6}
              height={(box.bottom - box.top) * videoHeight + 6}
              fill="none"
              stroke="#fff"
              strokeWidth={unit * 0.002}
              strokeDasharray={`${unit * 0.01} ${unit * 0.006}`}
              pointerEvents="none"
            />
            {(["start", "end"] as const).map((handle) => (
              <circle
                key={handle}
                data-shape-id={selection.id}
                data-handle={handle}
                aria-label={t("Resize {handle} of selected drawing", {
                  handle: t(handle),
                })}
                cx={
                  (handle === "start" ? selection.x1 : selection.x2) *
                  videoWidth
                }
                cy={
                  (handle === "start" ? selection.y1 : selection.y2) *
                  videoHeight
                }
                r={unit * 0.012}
                fill="#fff"
                stroke="#111"
                strokeWidth={unit * 0.003}
                style={{ cursor: "nwse-resize" }}
              />
            ))}
          </>
        )}
      </svg>
    </div>
  );
}
