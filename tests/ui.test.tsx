// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { App } from "../src/App";
import { newAnalysis, type Analysis, type SourceVideo } from "../src/domain";
import type { DesktopAPI, Loaded } from "../src/api";
let saved: Loaded | null;
let command: (name: string) => void;
let source: SourceVideo;
let initial: Analysis;
beforeEach(() => {
  localStorage.clear();
  initial = newAnalysis();
  source = {
    id: crypto.randomUUID(),
    display_name: "Match.mp4",
    location: "/match.mp4",
    relative_path: null,
    duration_ms: 10000,
    byte_size: 20,
    fingerprint: "fingerprint",
  };
  saved = null;
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
    configurable: true,
    get: () => 4,
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const api: DesktopAPI = {
    platform: "darwin",
    windowControl: vi.fn(),
    open: vi.fn(async () => saved),
    save: vi.fn(async (data) => {
      saved = structuredClone({
        ...data,
        path: "/match.analysis",
        stamp: "saved",
      });
      return saved;
    }),
    addVideos: vi.fn(async () => [source]),
    importPaths: vi.fn(async () => [source]),
    filePaths: () => [],
    media: vi.fn(async (s) => ({
      url: "media://video/test",
      path: s.location,
      duration_ms: 10000,
      fps: 25,
      width: 640,
      height: 360,
    })),
    relink: vi.fn(async () => null),
    recovery: vi.fn(async () => {}),
    restore: vi.fn(async () => null),
    template: vi.fn(async (categories) => categories || initial.categories),
    export: vi.fn(async () => "/out.mp4"),
    cancelExport: vi.fn(async () => {}),
    onProgress: () => () => {},
    onCommand: (fn) => {
      command = fn;
      return () => {};
    },
    setDirty: vi.fn(),
    close: vi.fn(),
  };
  window.desktop = api;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function boot() {
  const ui = render(<App />);
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Add Source video",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  return ui;
}
async function add() {
  fireEvent.click(screen.getByRole("button", { name: "Add Source video" }));
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: /Mark Clip start/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
}
async function mark() {
  const v = document.querySelector("video")!;
  v.currentTime = 1;
  fireEvent.click(screen.getByRole("button", { name: /Mark Clip start/ }));
  v.currentTime = 3;
  fireEvent.click(screen.getByRole("button", { name: /Mark Clip end/ }));
  await screen.findByRole("heading", { name: "Edit Clip" });
  fireEvent.change(screen.getByLabelText("NAME", { exact: true }), {
    target: { value: "Fast break" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Angriff" }));
  fireEvent.change(screen.getByLabelText("NOTES", { exact: true }), {
    target: { value: "Passing lane" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save Clip" }));
  await waitFor(() =>
    expect(document.querySelector(".clip-info strong")?.textContent).toBe(
      "Fast break",
    ),
  );
}
async function openPlaylistFixture(withPlaylist = true) {
  const a = newAnalysis();
  const second = {
    ...source,
    id: crypto.randomUUID(),
    location: "/second.mp4",
    display_name: "Second.mp4",
    fingerprint: "second-fingerprint",
  };
  a.source_videos = [source, second];
  a.clips = [
    {
      id: crypto.randomUUID(),
      source_video_id: source.id,
      name: "Attack",
      start_ms: 1000,
      end_ms: 2000,
      notes: "",
      category_id: a.categories[0].id,
      creation_order: 0,
    },
    {
      id: crypto.randomUUID(),
      source_video_id: second.id,
      name: "Defense",
      start_ms: 3000,
      end_ms: 4500,
      notes: "",
      category_id: a.categories[1].id,
      creation_order: 1,
    },
    {
      id: crypto.randomUUID(),
      source_video_id: second.id,
      name: "Fast break",
      start_ms: 5000,
      end_ms: 6000,
      notes: "",
      category_id: a.categories[2].id,
      creation_order: 2,
    },
  ];
  if (withPlaylist)
    a.playlists = [
      {
        id: crypto.randomUUID(),
        name: "Team review",
        clip_ids: [a.clips[0].id, a.clips[1].id, a.clips[2].id],
      },
    ];
  window.desktop.open = vi.fn(async () => ({
    analysis: a,
    path: "/review.analysis",
    stamp: "fixture",
  }));
  await boot();
  fireEvent.click(screen.getByTitle("Open Analysis"));
  await waitFor(() =>
    expect(document.querySelectorAll(".clip-row")).toHaveLength(3),
  );
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  return a;
}
it("creates, renames, orders, exports, removes and reloads playlists without duplicating Clips", async () => {
  const a = await openPlaylistFixture(false);
  fireEvent.click(screen.getByRole("button", { name: "Create playlist" }));
  const name = screen.getByLabelText("Playlist name");
  fireEvent.change(name, { target: { value: "Transitions" } });
  fireEvent.blur(name);
  fireEvent.click(screen.getByRole("button", { name: "Add Clips" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Add Fast break" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Add Attack" }));
  fireEvent.click(screen.getByRole("button", { name: "Add 2 Clips" }));
  expect(
    document.querySelectorAll(".playlist-clips strong")[0].textContent,
  ).toBe("Fast break");
  fireEvent.click(screen.getByTitle("Move Attack earlier"));
  fireEvent.click(screen.getByTitle("Save Analysis"));
  await waitFor(() =>
    expect(saved?.analysis.playlists[0]?.name).toBe("Transitions"),
  );
  expect(saved!.analysis.playlists[0].clip_ids).toEqual([
    a.clips[0].id,
    a.clips[2].id,
  ]);
  expect(saved!.analysis.clips).toHaveLength(3);
  fireEvent.click(screen.getByTitle("Export playlist"));
  expect(document.querySelectorAll(".export-row strong")[0].textContent).toBe(
    "Attack",
  );
  expect(document.querySelectorAll(".export-row strong")[1].textContent).toBe(
    "Fast break",
  );
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  fireEvent.click(screen.getByTitle("Remove Attack from playlist"));
  fireEvent.click(screen.getByTitle("Save Analysis"));
  await waitFor(() =>
    expect(saved?.analysis.playlists[0].clip_ids).toEqual([a.clips[2].id]),
  );
  window.desktop.open = vi.fn(async () => saved);
  fireEvent.click(screen.getByTitle("Open Analysis"));
  await waitFor(() =>
    expect(screen.getByLabelText("Playlist name")).toHaveProperty(
      "value",
      "Transitions",
    ),
  );
  expect(document.querySelectorAll(".playlist-clips strong")).toHaveLength(1);
  fireEvent.click(screen.getByTitle("Delete playlist"));
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Delete playlist?" })).getByRole(
      "button",
      { name: "Delete playlist" },
    ),
  );
  fireEvent.click(screen.getByTitle("Save Analysis"));
  await waitFor(() => expect(saved?.analysis.playlists).toEqual([]));
  expect(saved!.analysis.clips).toHaveLength(3);
});
it("plays across different and same-source clips, finishes once, and ignores stale media events", async () => {
  await openPlaylistFixture();
  fireEvent.click(screen.getByRole("button", { name: "Play playlist" }));
  await waitFor(() =>
    expect(document.querySelector("video")?.currentTime).toBe(1),
  );
  const first = document.querySelector("video")!;
  first.currentTime = 2.1;
  fireEvent.timeUpdate(first);
  await waitFor(() =>
    expect(document.querySelector("video")?.currentTime).toBe(3),
  );
  const second = document.querySelector("video")!;
  fireEvent.ended(first);
  expect(second.currentTime).toBe(3);
  second.currentTime = 4.6;
  fireEvent.timeUpdate(second);
  await waitFor(() =>
    expect(document.querySelector("video")?.currentTime).toBe(5),
  );
  const third = document.querySelector("video")!;
  third.currentTime = 6.1;
  fireEvent.timeUpdate(third);
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Stop playlist" })).toBeNull(),
  );
  expect(third.currentTime).toBe(6);
  expect(screen.getByRole("status").textContent).toContain("Playlist finished");
  fireEvent.ended(third);
  expect(third.currentTime).toBe(6);
});
it("does not restart after stopping during a source load", async () => {
  await openPlaylistFixture();
  let resolveMedia!: (value: Awaited<ReturnType<DesktopAPI["media"]>>) => void;
  window.desktop.media = vi.fn(
    () =>
      new Promise<Awaited<ReturnType<DesktopAPI["media"]>>>((resolve) => {
        resolveMedia = resolve;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Play from Defense" }));
  await waitFor(() => expect(resolveMedia).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Stop playlist" }));
  const calls = vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length;
  resolveMedia({
    url: "media://second",
    path: "/second.mp4",
    duration_ms: 10000,
    fps: 25,
    width: 640,
    height: 360,
  });
  await waitFor(() =>
    expect(document.querySelector("video")?.getAttribute("src")).toBe(
      "media://second",
    ),
  );
  fireEvent.loadedMetadata(document.querySelector("video")!);
  expect(vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length).toBe(
    calls,
  );
  expect(screen.queryByRole("button", { name: "Stop playlist" })).toBeNull();
});
it("adds the batch selection to a new playlist without duplicating clips", async () => {
  const a = await openPlaylistFixture(false);
  fireEvent.click(screen.getByRole("button", { name: "Clips 3" }));
  fireEvent.click(screen.getByRole("button", { name: "Select clips" }));
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Select Defense for export" }),
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Select Attack for export" }),
  );
  fireEvent.click(
    screen.getByRole("combobox", { name: "Add selected Clips to playlist" }),
  );
  fireEvent.click(
    screen.getByRole("option", { name: "New playlist from selection" }),
  );
  fireEvent.click(screen.getByTitle("Save Analysis"));
  await waitFor(() => expect(saved?.analysis.playlists).toHaveLength(1));
  expect(saved!.analysis.playlists[0].clip_ids).toEqual([
    a.clips[1].id,
    a.clips[0].id,
  ]);
  expect(saved!.analysis.clips).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Add Clips" }));
  expect(screen.queryByRole("checkbox", { name: "Add Attack" })).toBeNull();
  expect(screen.getByRole("checkbox", { name: "Add Fast break" })).toBeTruthy();
});
it("stops on missing media and cancels playlist playback when seeking manually", async () => {
  await openPlaylistFixture();
  fireEvent.click(screen.getByRole("button", { name: "Play playlist" }));
  await waitFor(() =>
    expect(document.querySelector("video")?.currentTime).toBe(1),
  );
  fireEvent.keyDown(document.body, { key: "ArrowRight" });
  expect(screen.queryByRole("button", { name: "Stop playlist" })).toBeNull();
  window.desktop.media = vi.fn(async () => {
    throw new Error("Source video is missing");
  });
  fireEvent.click(screen.getByRole("button", { name: "Play from Defense" }));
  await screen.findByText("Source video is missing");
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Stop playlist" })).toBeNull(),
  );
  expect(document.querySelector("video")).toBeNull();
});
it("stops sequence preview at its end and loops only the draft interval", async () => {
  await boot();
  await add();
  const video = document.querySelector("video")!;
  video.currentTime = 1;
  fireEvent.click(screen.getByRole("button", { name: /Mark Clip start/ }));
  video.currentTime = 3;
  fireEvent.click(screen.getByRole("button", { name: /Mark Clip end/ }));
  await screen.findByRole("heading", { name: "Edit Clip" });
  fireEvent.click(screen.getByRole("button", { name: "Preview sequence" }));
  expect(video.currentTime).toBe(1);
  video.currentTime = 3.1;
  fireEvent.timeUpdate(video);
  expect(video.currentTime).toBe(3);
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Loop" }));
  fireEvent.click(screen.getByRole("button", { name: "Preview sequence" }));
  video.currentTime = 3.1;
  fireEvent.timeUpdate(video);
  expect(video.currentTime).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  video.currentTime = 3.1;
  fireEvent.timeUpdate(video);
  expect(video.currentTime).toBe(3.1);
});
describe("editing workflow through the actual React interface", () => {
  it("quick tags while preserving manual capture, ignores repeats and typing, and persists a valid Clip", async () => {
    await boot();
    await add();
    const video = document.querySelector("video")!;
    video.currentTime = 1;
    fireEvent.click(screen.getByRole("button", { name: "Mark Clip start" }));
    video.currentTime = 9;
    const pauses = vi.mocked(HTMLMediaElement.prototype.pause).mock.calls
      .length;
    fireEvent.keyDown(document.body, { key: "2" });
    expect(document.querySelectorAll(".clip-row")).toHaveLength(1);
    expect(vi.mocked(HTMLMediaElement.prototype.pause).mock.calls.length).toBe(
      pauses,
    );
    expect(screen.getByRole("button", { name: "Mark Clip end" })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "2", repeat: true });
    fireEvent.keyDown(screen.getByLabelText("Search Clips"), { key: "3" });
    expect(document.querySelectorAll(".clip-row")).toHaveLength(1);
    fireEvent.click(screen.getByTitle("Save Analysis"));
    await waitFor(() => expect(saved?.analysis.clips).toHaveLength(1));
    expect(saved!.analysis.clips[0]).toMatchObject({
      start_ms: 1000,
      end_ms: 10000,
      category_id: saved!.analysis.categories[1].id,
    });
    fireEvent.click(screen.getByRole("button", { name: "Mark Clip end" }));
    expect(screen.getByLabelText("start timecode")).toHaveProperty(
      "value",
      "00:00:01.000",
    );
    fireEvent.keyDown(document.body, { key: "1" });
    expect(document.querySelectorAll(".clip-row")).toHaveLength(1);
  });
  it("uses configured quick capture timing from the custom Tag menu", async () => {
    await boot();
    await add();
    fireEvent.click(screen.getByTitle("Quick capture settings"));
    fireEvent.change(screen.getByLabelText("Seconds before"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Seconds after"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const video = document.querySelector("video")!;
    video.currentTime = 5;
    fireEvent.click(screen.getByRole("combobox", { name: "Quick tag" }));
    fireEvent.click(screen.getByRole("option", { name: "1 · Abwehr" }));
    fireEvent.click(screen.getByTitle("Save Analysis"));
    await waitFor(() => expect(saved?.analysis.clips).toHaveLength(1));
    expect(saved!.analysis.clips[0]).toMatchObject({
      start_ms: 3000,
      end_ms: 6000,
    });
    expect(JSON.parse(localStorage.getItem("capture-window")!)).toEqual({
      before: 2,
      after: 1,
    });
    expect(document.querySelector(".mark-bar")).toBeNull();
    expect(document.querySelector(".statusbar")).toBeNull();
  });
  it("changes speed with Up/Down, clamps it, and leaves form controls alone", async () => {
    await boot();
    await add();
    const speed = screen.getByRole("combobox", { name: "Playback speed" });
    fireEvent.click(screen.getByRole("button", { name: /^Clips 0$/ }));
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(speed.textContent).toContain("1.25×");
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(speed.textContent).toContain("1×");
    for (let i = 0; i < 12; i++)
      fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(speed.textContent).toContain("0.25×");
    fireEvent.keyDown(screen.getByLabelText("Search Clips"), {
      key: "ArrowUp",
    });
    expect(speed.textContent).toContain("0.25×");
    for (let i = 0; i < 12; i++) fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(speed.textContent).toContain("2×");
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Clip sort" }), {
      key: "ArrowDown",
    });
    expect(speed.textContent).toContain("2×");
  });
  it("shows batch checkboxes only in selection mode and clears hidden selections", async () => {
    await boot();
    await add();
    await mark();
    expect(
      screen.queryByRole("checkbox", { name: "Select Fast break for export" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Select clips" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select Fast break for export" }),
    );
    expect(screen.getByRole("button", { name: "Export (1)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(
      screen.queryByRole("checkbox", { name: "Select Fast break for export" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Export" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Select clips" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.queryByRole("checkbox", { name: "Select Fast break for export" }),
    ).toBeNull();
  });
  it("imports, marks a Clip, cancels a draft, filters, and saves all content", async () => {
    await boot();
    await add();
    await mark();
    fireEvent.click(screen.getByTitle("Edit Fast break"));
    fireEvent.change(screen.getByLabelText("NAME", { exact: true }), {
      target: { value: "Do not keep" },
    });
    fireEvent.click(
      within(document.querySelector(".clip-editor") as HTMLElement).getByRole(
        "button",
        { name: "Cancel" },
      ),
    );
    expect(document.querySelector(".clip-info strong")?.textContent).toBe(
      "Fast break",
    );
    fireEvent.change(screen.getByLabelText("Search Clips"), {
      target: { value: "not found" },
    });
    expect(screen.getByText("No matching Clips")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search Clips"), {
      target: { value: "Passing lane" },
    });
    expect(document.querySelector(".clip-info strong")?.textContent).toBe(
      "Fast break",
    );
    fireEvent.click(screen.getByTitle("Save Analysis"));
    await waitFor(() =>
      expect(saved?.analysis.clips[0].name).toBe("Fast break"),
    );
    expect(saved?.analysis.clips[0]).toMatchObject({
      start_ms: 1000,
      end_ms: 3000,
      notes: "Passing lane",
      category_id: saved?.analysis.categories.find((c) => c.name === "Angriff")
        ?.id,
    });
  });
  it("removing a Category retains its Clips as uncategorized", async () => {
    await boot();
    await add();
    await mark();
    expect(document.querySelector(".category-heading")?.textContent).toContain(
      "Angriff",
    );
    fireEvent.click(screen.getByTitle("Manage Categories"));
    fireEvent.click(screen.getAllByTitle("Remove Category")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Save Categories" }));
    expect(document.querySelector(".category-heading")?.textContent).toContain(
      "Ohne Kategorie",
    );
    fireEvent.click(screen.getByTitle("Save Analysis"));
    await waitFor(() =>
      expect(saved?.analysis.clips[0].category_id).toBe(null),
    );
  });
  it("cancelled New preserves unsaved work and Save then New clears it", async () => {
    await boot();
    await add();
    await mark();
    fireEvent.click(screen.getByTitle("New Analysis"));
    await screen.findByRole("dialog", { name: "Save Analysis changes?" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        (screen.getByTitle("New Analysis") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(document.querySelector(".clip-info strong")?.textContent).toBe(
      "Fast break",
    );
    fireEvent.click(screen.getByTitle("New Analysis"));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(document.querySelectorAll(".clip-row").length).toBe(0),
    );
    expect(saved?.analysis.clips).toHaveLength(1);
  });
  it("recovery restores unsaved data and close awaits snapshot removal", async () => {
    initial.source_videos.push(source);
    initial.title = "Recovered Analysis";
    window.desktop.restore = vi.fn(async () => ({
      analysis: initial,
      path: "/original.analysis",
      stamp: "old",
    }));
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Restore Analysis" }),
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Analysis title") as HTMLInputElement).value,
      ).toBe("Recovered Analysis"),
    );
    await waitFor(() =>
      expect(window.desktop.setDirty).toHaveBeenLastCalledWith(true),
    );
    command("close");
    fireEvent.click(
      await screen.findByRole("button", { name: "Discard changes" }),
    );
    await waitFor(() => expect(window.desktop.close).toHaveBeenCalled());
    expect(window.desktop.recovery).toHaveBeenCalledWith(null);
  });
  it("export selections and presentation settings do not mutate the Analysis", async () => {
    await boot();
    await add();
    await mark();
    fireEvent.click(screen.getByTitle("Save Analysis"));
    await waitFor(() => expect(saved).not.toBe(null));
    const before = JSON.stringify(saved?.analysis);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(screen.getByLabelText("Include source audio"));
    fireEvent.click(screen.getByRole("button", { name: "Export video…" }));
    await waitFor(() => expect(window.desktop.export).toHaveBeenCalled());
    expect(JSON.stringify(saved?.analysis)).toBe(before);
  });
});
