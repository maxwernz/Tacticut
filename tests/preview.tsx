// Development-only visual harness. Not included in the desktop build.
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "../src/App";
import { newAnalysis } from "../src/domain";
import "../src/style.css";
const a = newAnalysis();
a.title = "Opponent preparation · Match review";
const source = {
  id: crypto.randomUUID(),
  display_name: "Match recording.mp4",
  location: "/preview.mp4",
  relative_path: null,
  duration_ms: 6000,
  byte_size: null,
  fingerprint: null,
};
a.source_videos = [source];
a.clips = [
  "Fast break down the right wing",
  "Defensive transition",
  "Pivot creates space",
].map((name, i) => ({
  id: crypto.randomUUID(),
  source_video_id: source.id,
  name,
  start_ms: i * 1400 + 200,
  end_ms: i * 1400 + 1200,
  notes: i === 1 ? "Watch the passing lane and recovery run." : "",
  category_id: a.categories[i].id,
  creation_order: i,
}));
let saved = { analysis: a, path: null, stamp: null };
if (new URLSearchParams(location.search).has("annotations"))
  a.freeze_frames = [
    {
      id: crypto.randomUUID(),
      clip_id: a.clips[0].id,
      time_ms: 600,
      hold_ms: 3000,
      shapes: [
        {
          id: crypto.randomUUID(),
          kind: "arrow",
          x1: 0.2,
          y1: 0.5,
          x2: 0.8,
          y2: 0.5,
          color: "#FACC15",
          width: 0.006,
        },
        {
          id: crypto.randomUUID(),
          kind: "circle",
          x1: 0.3,
          y1: 0.2,
          x2: 0.5,
          y2: 0.4,
          color: "#FFFFFF",
          width: 0.006,
        },
      ],
    },
  ];
if (new URLSearchParams(location.search).has("playlists"))
  a.playlists = [
    {
      id: crypto.randomUUID(),
      name: "Defensive transition review",
      clip_ids: [a.clips[1].id, a.clips[0].id],
    },
  ];
window.desktop = {
  platform: "darwin",
  windowControl: () => {},
  open: async () => saved,
  save: async (data) => {
    saved = data as typeof saved;
    return data;
  },
  addVideos: async () => [],
  importPaths: async () => [],
  filePaths: () => [],
  media: async () => ({
    url: "/.cache/ui-preview.mp4",
    path: source.location,
    duration_ms: 6000,
    fps: 25,
    width: 640,
    height: 360,
  }),
  relink: async () => null,
  recovery: async () => {},
  restore: async () =>
    new URLSearchParams(location.search).has("empty") ? null : saved,
  template: async (categories) => categories || a.categories,
  export: async () => {
    throw new Error(
      "Exports require the Electron desktop app. This is a visual test harness.",
    );
  },
  cancelExport: async () => {},
  onProgress: () => () => {},
  onCommand: () => () => {},
  setDirty: () => {},
  close: () => {},
};
createRoot(document.getElementById("root")!).render(<App />);
