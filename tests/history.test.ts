import { expect, it } from "vitest";
import { emptyHistory, recordEdit, travelHistory } from "../src/history";
import { mutate, newAnalysis } from "../src/domain";
it("reverses atomic edits, supports redo and discards the redo branch only after a changed edit", () => {
  const a = newAnalysis();
  const b = mutate(a, (d) => {
    d.title = "Match";
  });
  const c = mutate(b, (d) => {
    d.categories = [];
  });
  let h = recordEdit(recordEdit(emptyHistory(), a, b), b, c);
  const undo = travelHistory(h, c, "undo")!;
  expect(undo.document).toEqual(b);
  expect(travelHistory(undo.history, b, "redo")!.document).toEqual(c);
  expect(recordEdit(undo.history, b, structuredClone(b))).toBe(undo.history);
  h = recordEdit(
    undo.history,
    b,
    mutate(b, (d) => {
      d.title = "New branch";
    }),
  );
  expect(h.future).toHaveLength(0);
  expect(travelHistory(h, b, "redo")).toBeNull();
});
it("bounds history at 100 complete edits", () => {
  let a = newAnalysis(),
    h = emptyHistory();
  for (let i = 0; i < 150; i++) {
    const b = mutate(a, (d) => {
      d.title = String(i);
    });
    h = recordEdit(h, a, b);
    a = b;
  }
  expect(h.past).toHaveLength(100);
  expect(h.past[0].document.title).toBe("49");
});
it("undoes clip deletion together with dependent playlist entries and freeze-frames", () => {
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
      name: "Goal",
      start_ms: 0,
      end_ms: 2000,
      category_id: null,
      notes: "",
      creation_order: 0,
    },
  ];
  a.playlists = [
    { id: crypto.randomUUID(), name: "Review", clip_ids: [a.clips[0].id] },
  ];
  a.freeze_frames = [
    {
      id: crypto.randomUUID(),
      clip_id: a.clips[0].id,
      time_ms: 1000,
      hold_ms: 1000,
      shapes: [
        {
          id: crypto.randomUUID(),
          kind: "arrow",
          x1: 0.1,
          y1: 0.1,
          x2: 0.5,
          y2: 0.5,
          color: "#ffffff",
          width: 0.005,
        },
      ],
    },
  ];
  const b = mutate(a, (d) => {
    d.clips = [];
  });
  expect(b.freeze_frames).toHaveLength(0);
  expect(b.playlists[0].clip_ids).toHaveLength(0);
  expect(
    travelHistory(recordEdit(emptyHistory(), a, b), b, "undo")!.document,
  ).toEqual(a);
});
