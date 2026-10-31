import { expect, it } from "vitest";
import {
  annotationSvg,
  clipPresentation,
  containRect,
  relativePoint,
} from "../src/annotations";
import {
  analysisSchema,
  decode,
  encode,
  mutate,
  newAnalysis,
  type Drawing,
  type FreezeFrame,
} from "../src/domain";
export function annotationFixture() {
  const a = newAnalysis();
  a.source_videos = [
    {
      id: crypto.randomUUID(),
      display_name: "Match",
      location: "/match.mp4",
      relative_path: null,
      duration_ms: 5000,
      byte_size: null,
      fingerprint: null,
    },
  ];
  a.clips = [
    {
      id: crypto.randomUUID(),
      source_video_id: a.source_videos[0].id,
      name: "Attack",
      start_ms: 500,
      end_ms: 4000,
      category_id: null,
      notes: "",
      creation_order: 0,
    },
  ];
  const shape: Drawing = {
    id: crypto.randomUUID(),
    kind: "arrow",
    x1: 0.2,
    y1: 0.5,
    x2: 0.8,
    y2: 0.5,
    color: "#FACC15",
    width: 0.006,
  };
  const frame: FreezeFrame = {
    id: crypto.randomUUID(),
    clip_id: a.clips[0].id,
    time_ms: 1000,
    hold_ms: 1000,
    shapes: [shape],
  };
  a.freeze_frames = [frame];
  return { a, frame, shape };
}
it("round trips annotations with v3 and retains v1/v2 compatibility without them", () => {
  const { a } = annotationFixture();
  expect(JSON.parse(encode(a)).schema_version).toBe(3);
  expect(decode(encode(a))).toEqual(a);
  a.freeze_frames = [];
  expect(JSON.parse(encode(a)).schema_version).toBe(1);
  expect(decode(encode(a)).freeze_frames).toEqual([]);
  a.playlists = [
    { id: crypto.randomUUID(), name: "Review", clip_ids: [a.clips[0].id] },
  ];
  expect(JSON.parse(encode(a)).schema_version).toBe(2);
  expect(JSON.parse(encode(a)).analysis.freeze_frames).toBeUndefined();
});
it("rejects unsafe primitives, orphan/duplicate frames and trimming across a coaching moment", () => {
  const { a } = annotationFixture();
  for (const edit of [
    (d: typeof a) => {
      d.freeze_frames[0].time_ms = d.clips[0].end_ms;
    },
    (d: typeof a) => {
      d.freeze_frames[0].clip_id = crypto.randomUUID();
    },
    (d: typeof a) => {
      d.freeze_frames[0].shapes[0].x1 = -1;
    },
    (d: typeof a) => {
      d.freeze_frames[0].shapes[0].width = Infinity;
    },
    (d: typeof a) => {
      d.freeze_frames[0].shapes[0].color = "url(https://invalid)";
    },
    (d: typeof a) => {
      d.freeze_frames[0].hold_ms = 0;
    },
    (d: typeof a) => {
      d.freeze_frames.push({ ...d.freeze_frames[0], id: crypto.randomUUID() });
    },
  ]) {
    const d = structuredClone(a);
    edit(d);
    expect(() => analysisSchema.parse(d)).toThrow();
  }
  expect(() =>
    mutate(a, (d) => {
      d.clips[0].start_ms = 1500;
    }),
  ).toThrow(/boundaries exclude/);
  expect(
    mutate(a, (d) => {
      d.clips = [];
    }).freeze_frames,
  ).toEqual([]);
});
it("inserts freeze holds without removing any original video time", () => {
  const { a, frame } = annotationFixture();
  const frames = [
    { ...frame, id: crypto.randomUUID(), time_ms: 3000, hold_ms: 2000 },
    frame,
  ];
  const parts = clipPresentation(a.clips[0], frames);
  expect(parts.map((p) => [p.start_ms, p.duration_ms, !!p.freeze])).toEqual([
    [500, 500, false],
    [1000, 1000, true],
    [1000, 2000, false],
    [3000, 2000, true],
    [3000, 1000, false],
  ]);
  expect(parts.reduce((n, p) => n + p.duration_ms, 0)).toBe(6500);
  expect(frames[0].time_ms).toBe(3000);
});
it("maps drawings to the actual picture, excluding letterbox bars, and generates inert SVG", () => {
  expect(containRect(1000, 1000, 1920, 1080)).toEqual({
    x: 0,
    y: 218.75,
    width: 1000,
    height: 562.5,
  });
  expect(
    relativePoint(500, 500, {
      left: 0,
      top: 218.75,
      width: 1000,
      height: 562.5,
    }),
  ).toEqual({ x: 0.5, y: 0.5 });
  expect(
    relativePoint(-10, 1100, { left: 0, top: 0, width: 1000, height: 1000 }),
  ).toEqual({ x: 0, y: 1 });
  const { shape } = annotationFixture();
  const svg = annotationSvg([shape], 1280, 720);
  expect(svg).toContain("M 256 360 L 1024 360");
  expect(svg).not.toMatch(/href|script|image/);
  expect(() =>
    annotationSvg([{ ...shape, color: '" onload="bad' }], 1280, 720),
  ).toThrow();
});

it("moves and resizes shapes without distorting at edges, and safely exports bounded text and lines", async () => {
  const { moveDrawing, resizeDrawing, drawingPath } = await import(
    "../src/annotations"
  );
  const { shape, a } = annotationFixture();
  const moved = moveDrawing(shape, 1, 1);
  expect(moved.x2).toBe(1);
  expect(moved.x2 - moved.x1).toBeCloseTo(shape.x2 - shape.x1);
  expect(moved.y2).toBe(1);
  expect(drawingPath({ ...shape, kind: "line" }, 640, 360)).toBe(
    "M 128 180 L 512 180",
  );
  const text: Drawing = {
    ...shape,
    kind: "text",
    text: '<script>alert("test")</script> & coach',
    font_size: 0.045,
    y1: 0.2,
    y2: 0.6,
  };
  const svg = annotationSvg([text], 640, 360);
  expect(svg).toContain("&lt;script&gt;");
  expect(svg).not.toContain("<script>");
  expect(resizeDrawing(text, "end", -0.2, -0.2).x2).toBeGreaterThan(text.x1);
  a.freeze_frames[0].shapes = [text];
  expect(JSON.parse(encode(a)).schema_version).toBe(6);
  expect(decode(encode(a)).freeze_frames[0].shapes[0]).toEqual(text);
});
it("renders annotation text with the bundled font for native video exports", async () => {
  const { Resvg } = await import("@resvg/resvg-js");
  const { resolve } = await import("node:path");
  const { shape } = annotationFixture();
  const svg = annotationSvg(
    [
      {
        ...shape,
        kind: "text",
        text: "Attack the space",
        font_size: 0.06,
        x1: 0.1,
        y1: 0.1,
        x2: 0.9,
        y2: 0.5,
      },
    ],
    640,
    360,
  );
  const png = new Resvg(svg, {
    font: {
      loadSystemFonts: false,
      fontFiles: [resolve("public/fonts/NotoSans.ttf")],
    },
  }).render();
  const pixels = png.pixels;
  let opaque = 0;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) opaque++;
  expect(opaque).toBeGreaterThan(250);
});
