import {
  drawingSchema,
  type Drawing,
  type FreezeFrame,
  type Clip,
} from "./domain";
export function containRect(
  width: number,
  height: number,
  videoWidth: number,
  videoHeight: number,
) {
  const scale = Math.min(width / videoWidth, height / videoHeight);
  const w = Math.min(width, videoWidth * scale),
    h = Math.min(height, videoHeight * scale);
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}
export function relativePoint(
  x: number,
  y: number,
  rect: { left: number; top: number; width: number; height: number },
) {
  return {
    x: Math.max(0, Math.min(1, (x - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (y - rect.top) / rect.height)),
  };
}
export function drawingPath(shape: Drawing, width: number, height: number) {
  const x1 = shape.x1 * width,
    y1 = shape.y1 * height,
    x2 = shape.x2 * width,
    y2 = shape.y2 * height;
  if (shape.kind === "line") return `M ${x1} ${y1} L ${x2} ${y2}`;
  if (shape.kind === "text") return "";
  if (shape.kind === "circle") {
    const rx = Math.abs(x2 - x1) / 2,
      ry = Math.abs(y2 - y1) / 2,
      cx = (x1 + x2) / 2,
      cy = (y1 + y2) / 2;
    return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${2 * rx} 0 a ${rx} ${ry} 0 1 0 ${-2 * rx} 0`;
  }
  const angle = Math.atan2(y2 - y1, x2 - x1),
    head = Math.min(
      Math.hypot(x2 - x1, y2 - y1) * 0.4,
      Math.min(width, height) * 0.035,
    );
  return `M ${x1} ${y1} L ${x2} ${y2} M ${x2 - head * Math.cos(angle - 0.5)} ${y2 - head * Math.sin(angle - 0.5)} L ${x2} ${y2} L ${x2 - head * Math.cos(angle + 0.5)} ${y2 - head * Math.sin(angle + 0.5)}`;
}
export function drawingBounds(shape: Drawing) {
  return {
    left: Math.min(shape.x1, shape.x2),
    top: Math.min(shape.y1, shape.y2),
    right: Math.max(shape.x1, shape.x2),
    bottom: Math.max(shape.y1, shape.y2),
  };
}
/** Clamp the translation as a whole so moving against an edge never distorts a shape. */
export function moveDrawing(shape: Drawing, dx: number, dy: number): Drawing {
  const box = drawingBounds(shape);
  dx = Math.max(-box.left, Math.min(1 - box.right, dx));
  dy = Math.max(-box.top, Math.min(1 - box.bottom, dy));
  return {
    ...shape,
    x1: shape.x1 + dx,
    x2: shape.x2 + dx,
    y1: shape.y1 + dy,
    y2: shape.y2 + dy,
  };
}
export function resizeDrawing(
  shape: Drawing,
  handle: "start" | "end",
  x: number,
  y: number,
): Drawing {
  x = Math.max(0, Math.min(1, x));
  y = Math.max(0, Math.min(1, y));
  const next =
    handle === "start"
      ? { ...shape, x1: x, y1: y }
      : { ...shape, x2: x, y2: y };
  if (shape.kind === "text") {
    if (handle === "start") {
      next.x1 = Math.min(next.x1, next.x2 - 0.01);
      next.y1 = Math.min(next.y1, next.y2 - 0.01);
    } else {
      next.x2 = Math.max(next.x2, next.x1 + 0.01);
      next.y2 = Math.max(next.y2, next.y1 + 0.01);
    }
  }
  return next;
}
/** Shared wrapping keeps the preview and native export on the same lines. */
export function drawingText(shape: Drawing, width: number, height: number) {
  const fontSize = (shape.font_size || 0.045) * Math.min(width, height);
  const columns = Math.max(
    1,
    Math.floor(((shape.x2 - shape.x1) * width) / (fontSize * 0.62)),
  );
  const lines: string[] = [];
  for (const paragraph of (shape.text || "").split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && Array.from(line + " " + word).length > columns) {
        lines.push(line);
        line = "";
      }
      const chars = Array.from(word);
      while (chars.length > columns) {
        lines.push(chars.splice(0, columns).join(""));
      }
      if (chars.length) line += (line ? " " : "") + chars.join("");
    }
    lines.push(line);
  }
  return {
    fontSize,
    lines: lines.slice(
      0,
      Math.max(
        1,
        Math.floor(((shape.y2 - shape.y1) * height) / (fontSize * 1.2)),
      ),
    ),
  };
}
const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
/** Generated from validated primitives and escaped text only; no imported SVG or URLs. */
export function annotationSvg(
  shapes: Drawing[],
  width: number,
  height: number,
) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 4096 ||
    height > 4096
  )
    throw new Error("Invalid annotation canvas size");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${shapes
    .map((raw) => {
      const s = drawingSchema.parse(raw),
        d = drawingPath(s, width, height),
        stroke = s.width * Math.min(width, height);
      if (s.kind === "text") {
        const { fontSize, lines } = drawingText(s, width, height);
        const clip = `text-${s.id}`;
        return `<defs><clipPath id="${clip}"><rect x="${s.x1 * width}" y="${s.y1 * height}" width="${(s.x2 - s.x1) * width}" height="${(s.y2 - s.y1) * height}"/></clipPath></defs><text clip-path="url(#${clip})" font-family="Noto Sans" font-size="${fontSize}" fill="${s.color}" stroke="#000000" stroke-width="${fontSize * 0.08}" paint-order="stroke" stroke-linejoin="round">${lines.map((line, i) => `<tspan x="${s.x1 * width}" y="${s.y1 * height + fontSize * (1 + 1.2 * i)}">${escapeXml(line)}</tspan>`).join("")}</text>`;
      }
      return `<g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="${d}" stroke="#000000" stroke-opacity="0.65" stroke-width="${stroke + Math.min(width, height) * 0.003}"/><path d="${d}" stroke="${s.color}" stroke-width="${stroke}"/></g>`;
    })
    .join("")}</svg>`;
}
export function clipPresentation(clip: Clip, frames: FreezeFrame[]) {
  const parts: Array<{
    start_ms: number;
    duration_ms: number;
    freeze?: FreezeFrame;
  }> = [];
  let cursor = clip.start_ms;
  for (const frame of frames
    .filter((f) => f.clip_id === clip.id)
    .sort((a, b) => a.time_ms - b.time_ms)) {
    if (frame.time_ms < clip.start_ms || frame.time_ms >= clip.end_ms)
      throw new Error("Freeze-frame is outside its Clip");
    if (frame.time_ms > cursor)
      parts.push({ start_ms: cursor, duration_ms: frame.time_ms - cursor });
    parts.push({
      start_ms: frame.time_ms,
      duration_ms: frame.hold_ms,
      freeze: frame,
    });
    cursor = frame.time_ms;
  }
  if (cursor < clip.end_ms)
    parts.push({ start_ms: cursor, duration_ms: clip.end_ms - cursor });
  return parts;
}
