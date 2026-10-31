// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ClipEditor } from "../src/ClipEditor";
import { newAnalysis, type Clip } from "../src/domain";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function setup() {
  const a = newAnalysis();
  const clip: Clip = {
    id: crypto.randomUUID(),
    source_video_id: crypto.randomUUID(),
    name: "Scene",
    start_ms: 1000,
    end_ms: 3000,
    category_id: null,
    notes: "",
    creation_order: 0,
  };
  const save = vi.fn(),
    cancel = vi.fn();
  render(
    <ClipEditor
      clip={clip}
      categories={a.categories}
      duration={10000}
      current={() => 2000}
      onSeek={vi.fn()}
      onSave={save}
      onCancel={cancel}
      onPreview={vi.fn()}
      onStopPreview={vi.fn()}
    />,
  );
  return { a, clip, save, cancel };
}
it("commits multiple themes and handball selections as exactly one scene", () => {
  const { a, clip, save } = setup();
  fireEvent.click(screen.getByRole("button", { name: /Angriff/ }));
  fireEvent.click(screen.getByRole("button", { name: /Tor/ }));
  fireEvent.click(screen.getByRole("button", { name: "Outcome Goal" }));
  fireEvent.click(screen.getByRole("button", { name: "Fast break" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Shot origin Left wing" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Target Top left" }));
  expect(save).not.toHaveBeenCalled();
  expect(clip.category_id).toBeNull();
  fireEvent.keyDown(document.querySelector(".tagging-workspace")!, {
    key: "Enter",
    ctrlKey: true,
  });
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0][0]).toMatchObject({
    category_id: a.categories[1].id,
    category_ids: [a.categories[1].id, a.categories[2].id],
    handball: {
      outcome: "goal",
      phase: "fast-break",
      shot_position: "left-wing",
      goal_zone: "top-left",
    },
  });
});
it("uses category shortcuts in the panel, toggles independently and cancels without applying", () => {
  const { save, cancel, clip } = setup();
  const form = document.querySelector(".tagging-workspace")!;
  fireEvent.keyDown(form, { key: "1" });
  fireEvent.keyDown(form, { key: "2" });
  fireEvent.keyDown(form, { key: "1", repeat: true });
  expect(
    screen.getByRole("button", { name: /Abwehr/ }).getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.keyDown(screen.getByLabelText("NAME"), { key: "3" });
  expect(
    screen.getByRole("button", { name: /Tor/ }).getAttribute("aria-pressed"),
  ).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(cancel).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
  expect(clip.handball).toBeUndefined();
});
it("restarts a bounded preview loop when its end is also the source end", async () => {
  const previous = window.desktop;
  window.desktop = {
    media: vi.fn(async () => ({
      url: "media://test",
      path: "/test.mp4",
      duration_ms: 1000,
      fps: 25,
      width: 640,
      height: 360,
    })),
  } as unknown as typeof window.desktop;
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(4);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  try {
    const a = newAnalysis();
    const source = {
      id: crypto.randomUUID(),
      display_name: "Match",
      location: "/test.mp4",
      relative_path: null,
      duration_ms: 1000,
      byte_size: null,
      fingerprint: null,
    };
    render(
      <ClipEditor
        clip={{
          id: crypto.randomUUID(),
          source_video_id: source.id,
          name: "Full source",
          start_ms: 0,
          end_ms: 1000,
          category_id: null,
          notes: "",
          creation_order: 0,
        }}
        categories={a.categories}
        source={source}
        duration={1000}
        current={() => 0}
        onSeek={vi.fn()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        onPreview={vi.fn()}
        onStopPreview={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(
        document.querySelector(".tagging-preview-frame video"),
      ).toBeTruthy(),
    );
    const video = document.querySelector<HTMLVideoElement>(
      ".tagging-preview-frame video",
    )!;
    fireEvent.loadedData(video);
    fireEvent.click(screen.getByText(/Clip timing & preview/));
    fireEvent.click(screen.getByRole("button", { name: "Loop" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview sequence" }));
    expect(play).toHaveBeenCalledOnce();
    vi.spyOn(HTMLMediaElement.prototype, "ended", "get").mockReturnValue(true);
    video.currentTime = 1;
    fireEvent.timeUpdate(video);
    expect(video.currentTime).toBe(0);
    expect(play).toHaveBeenCalledTimes(2);
  } finally {
    window.desktop = previous;
  }
});
it("updates the displayed range and committed clip when timing is adjusted", () => {
  const { save } = setup();
  fireEvent.click(screen.getByText(/Clip timing & preview/));
  fireEvent.change(screen.getByLabelText("start timecode"), {
    target: { value: "00:00:02.000" },
  });
  expect(document.querySelector(".tagging-range")?.textContent).toContain(
    "00:00:02 — 00:00:03",
  );
  fireEvent.click(screen.getByRole("button", { name: "Save Clip" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ start_ms: 2000, end_ms: 3000 }),
  );
});
