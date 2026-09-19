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
/** Generated from validated primitives only: no imported SVG, text, URLs or fonts. */
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
