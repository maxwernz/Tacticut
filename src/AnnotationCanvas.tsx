import { useEffect, useRef, useState } from "react";
import { containRect, drawingPath, relativePoint } from "./annotations";
import { drawingSchema, type Drawing } from "./domain";
export function AnnotationCanvas({
  shapes,
  videoWidth,
  videoHeight,
  tool = "arrow",
  color = "#FACC15",
  width = 0.006,
  onDraw,
  disabled = false,
}: {
  shapes: Drawing[];
  videoWidth: number;
  videoHeight: number;
  tool?: Drawing["kind"];
  color?: string;
  width?: number;
  onDraw?(shape: Drawing): void;
  disabled?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null),
    drag = useRef<{ shape: Drawing; pointer: number } | null>(null);
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
  return (
    <div
      ref={root}
      className={`annotation-layer ${onDraw && !disabled ? "editable" : ""}`}
    >
      <svg
        aria-label={
          onDraw ? "Draw on frozen video" : "Saved freeze-frame drawings"
        }
        role="img"
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
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
          const shape: Drawing = {
            id: crypto.randomUUID(),
            kind: tool,
            x1: p.x,
            y1: p.y,
            x2: p.x,
            y2: p.y,
            color,
            width,
          };
          drag.current = { shape, pointer: e.pointerId };
          setPending(shape);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current || drag.current.pointer !== e.pointerId) return;
          const p = relativePoint(
            e.clientX,
            e.clientY,
            e.currentTarget.getBoundingClientRect(),
          );
          const shape = { ...drag.current.shape, x2: p.x, y2: p.y };
          drag.current.shape = shape;
          setPending(shape);
        }}
        onPointerUp={(e) => {
          if (!drag.current || drag.current.pointer !== e.pointerId) return;
          const p = relativePoint(
            e.clientX,
            e.clientY,
            e.currentTarget.getBoundingClientRect(),
          );
          const shape = { ...drag.current.shape, x2: p.x, y2: p.y };
          cancel();
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
          if (drawingSchema.safeParse(shape).success) onDraw?.(shape);
        }}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
      >
        {[...shapes, ...(pending ? [pending] : [])].map((s) => (
          <g
            key={s.id}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            pointerEvents="none"
          >
            <path
              d={drawingPath(s, videoWidth, videoHeight)}
              stroke="#000"
              strokeOpacity=".65"
              strokeWidth={
                (s.width + 0.003) * Math.min(videoWidth, videoHeight)
              }
            />
            <path
              d={drawingPath(s, videoWidth, videoHeight)}
              stroke={s.color}
              strokeWidth={s.width * Math.min(videoWidth, videoHeight)}
            />
          </g>
        ))}
      </svg>
    </div>
  );
}
