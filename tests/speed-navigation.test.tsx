// @vitest-environment jsdom
import React, { createRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Player, type PlayerHandle } from "../src/Player";
import type { DesktopAPI } from "../src/api";

beforeEach(() => {
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
    configurable: true,
    get: () => 4,
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  window.desktop = {
    media: vi.fn(async () => ({
      url: "media://video/test",
      path: "/match.mp4",
      duration_ms: 60000,
      fps: 25,
      width: 640,
      height: 360,
    })),
  } as unknown as DesktopAPI;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function boot() {
  const ref = createRef<PlayerHandle>();
  const cancel = vi.fn();
  render(
    <Player
      ref={ref}
      source={{
        id: crypto.randomUUID(),
        display_name: "Match",
        location: "/match.mp4",
        relative_path: null,
        duration_ms: 60000,
        byte_size: null,
        fingerprint: null,
      }}
      documentPath={null}
      clips={[]}
      categories={[]}
      selected={null}
      pending={null}
      navigation={{ ms: 0, revision: 0 }}
      jumpSeconds={3}
      sequence={null}
      onSequenceEnd={vi.fn()}
      onSequenceCancel={cancel}
      onSelect={vi.fn()}
      onEdit={vi.fn()}
      onAnnotate={vi.fn()}
      onReview={vi.fn()}
      onMark={vi.fn()}
      captureDisabled={false}
      onQuickTag={vi.fn()}
      onCaptureSettings={vi.fn()}
      onAdd={vi.fn()}
      onCancelPending={vi.fn()}
      onRelink={vi.fn()}
      onError={vi.fn()}
    />,
  );
  await waitFor(() =>
    expect(screen.getByTitle("Next frame")).toHaveProperty("disabled", false),
  );
  return { player: ref, video: document.querySelector("video")!, cancel };
}
function speed(value: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Playback speed" }));
  fireEvent.click(screen.getByRole("option", { name: `${value}×` }));
}
it("scales keyboard scrubbing in both directions while frame controls stay precise", async () => {
  const { player, video } = await boot();
  video.currentTime = 5;
  act(() => player.current!.scrub(1));
  expect(video.currentTime).toBeCloseTo(5.04);
  speed("0.5");
  act(() => player.current!.scrub(1));
  expect(video.currentTime).toBeCloseTo(5.06);
  speed("8");
  act(() => player.current!.scrub(1));
  expect(video.currentTime).toBeCloseTo(5.38);
  act(() => player.current!.scrub(-1));
  expect(video.currentTime).toBeCloseTo(5.06);
  fireEvent.click(screen.getByTitle("Next frame"));
  expect(video.currentTime).toBeCloseTo(5.1);
  fireEvent.click(screen.getByTitle("Previous frame"));
  expect(video.currentTime).toBeCloseTo(5.06);
  act(() => player.current!.scrub(1, true));
  expect(video.currentTime).toBeCloseTo(29.06);
  act(() => player.current!.scrub(-1, true));
  expect(video.currentTime).toBeCloseTo(5.06);
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
});
it("accumulates repeated key seeks before decoding catches up, respects new absolute seeks and clamps at either boundary", async () => {
  const { player, video } = await boot();
  speed("8");
  let requested = 5;
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    get: () => 5,
    set: (value: number) => {
      requested = value;
    },
  });
  Object.defineProperty(video, "seeking", {
    configurable: true,
    get: () => true,
  });
  act(() => {
    player.current!.scrub(1);
    player.current!.scrub(1);
    player.current!.scrub(1);
  });
  expect(requested).toBeCloseTo(5.96);
  act(() => {
    player.current!.seek(10000);
    player.current!.scrub(1);
  });
  expect(requested).toBeCloseTo(10.32);
  act(() => {
    player.current!.seek(59990);
    player.current!.scrub(1);
  });
  expect(requested).toBe(60);
  act(() => {
    player.current!.seek(10);
    player.current!.scrub(-1);
  });
  expect(requested).toBe(0);
});
it("manual navigation cancels a looping draft preview before the old interval can restart", async () => {
  const { player, video } = await boot();
  act(() => player.current!.preview(1000, 2000, true));
  act(() => player.current!.scrub(1));
  const plays = vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length;
  video.currentTime = 2.1;
  fireEvent.timeUpdate(video);
  expect(video.currentTime).toBe(2.1);
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(plays);
});
