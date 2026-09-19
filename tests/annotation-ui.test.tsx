// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { AnnotationEditor } from "../src/AnnotationEditor";
import {
  useSequencePlayback,
  type SequenceRequest,
} from "../src/useSequencePlayback";
import { type Drawing, type FreezeFrame } from "../src/domain";
const clip = {
  id: crypto.randomUUID(),
  source_video_id: crypto.randomUUID(),
  name: "Attack",
  start_ms: 0,
  end_ms: 3000,
  notes: "",
  category_id: null,
  creation_order: 0,
};
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
  clip_id: clip.id,
  time_ms: 1000,
  hold_ms: 1000,
  shapes: [shape],
};
beforeEach(() => {
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
    configurable: true,
    get: () => 4,
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.stubGlobal("PointerEvent", MouseEvent);
  SVGElement.prototype.setPointerCapture = vi.fn();
  SVGElement.prototype.hasPointerCapture = () => false;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    x: 0,
    y: 0,
    width: 640,
    height: 360,
    right: 640,
    bottom: 360,
    toJSON: () => ({}),
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("draws, undoes/redoes and saves normalized arrows and circles, with cancellable edits", async () => {
  const save = vi.fn(),
    close = vi.fn();
  render(
    <AnnotationEditor
      clip={clip}
      media={{
        url: "media://test",
        path: "/test.mp4",
        width: 640,
        height: 360,
        duration_ms: 3000,
        fps: 25,
      }}
      time={1000}
      initial={[]}
      onSave={save}
      onClose={close}
    />,
  );
  const svg = screen.getByRole("img", { name: "Draw on frozen video" });
  fireEvent.pointerDown(svg, { button: 0, clientX: 128, clientY: 180 });
  fireEvent.pointerMove(svg, { clientX: 512, clientY: 180 });
  fireEvent.pointerUp(svg, { clientX: 512, clientY: 180 });
  fireEvent.click(screen.getByRole("button", { name: "Circle" }));
  fireEvent.pointerDown(svg, { button: 0, clientX: 64, clientY: 36 });
  fireEvent.pointerUp(svg, { clientX: 192, clientY: 108 });
  expect(svg.querySelectorAll("g")).toHaveLength(2);
  fireEvent.click(screen.getByTitle("Undo drawing edit"));
  expect(svg.querySelectorAll("g")).toHaveLength(1);
  fireEvent.click(screen.getByTitle("Redo drawing edit"));
  expect(svg.querySelectorAll("g")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  fireEvent.click(screen.getByRole("button", { name: "Save freeze-frames" }));
  expect(save).toHaveBeenCalledWith([
    expect.objectContaining({
      time_ms: 1000,
      hold_ms: 3000,
      shapes: [
        expect.objectContaining({
          kind: "arrow",
          x1: 0.2,
          y1: 0.5,
          x2: 0.8,
          y2: 0.5,
        }),
        expect.objectContaining({
          kind: "circle",
          x1: 0.1,
          y1: 0.1,
          x2: 0.3,
          y2: 0.3,
        }),
      ],
    }),
  ]);
});
it("holds once, supports pausing the hold and cancels all delayed resume on stop", async () => {
  vi.useFakeTimers();
  const video = document.createElement("video"),
    ref = { current: video },
    done = vi.fn(),
    fail = vi.fn();
  const request: SequenceRequest = { token: 1, clip, freezeFrames: [frame] };
  const hook = renderHook(
    ({ request }: { request: SequenceRequest | null }) =>
      useSequencePlayback(ref, request, true, 3000, done, fail),
    { initialProps: { request: request as SequenceRequest | null } },
  );
  await act(async () => {});
  act(() => {
    video.currentTime = 1.1;
    fireEvent.timeUpdate(video);
  });
  expect(hook.result.current.freeze?.id).toBe(frame.id);
  expect(video.currentTime).toBe(1);
  const calls = vi.mocked(video.play).mock.calls.length;
  act(() => {
    hook.result.current.toggleHold();
  });
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(vi.mocked(video.play).mock.calls.length).toBe(calls);
  act(() => {
    hook.result.current.toggleHold();
  });
  await act(async () => vi.advanceTimersByTimeAsync(1001));
  expect(hook.result.current.freeze).toBeNull();
  expect(vi.mocked(video.play).mock.calls.length).toBe(calls + 1);
  act(() => fireEvent.timeUpdate(video));
  expect(hook.result.current.freeze).toBeNull();
  hook.rerender({ request: { ...request, token: 2 } });
  await act(async () => {});
  act(() => {
    video.currentTime = 1.1;
    fireEvent.timeUpdate(video);
  });
  expect(hook.result.current.freeze).not.toBeNull();
  hook.rerender({ request: null });
  const stopped = vi.mocked(video.play).mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(vi.mocked(video.play).mock.calls.length).toBe(stopped);
  expect(done).not.toHaveBeenCalled();
  expect(fail).not.toHaveBeenCalled();
});
it("can remove a saved moment without changing the original until Save", () => {
  const save = vi.fn();
  render(
    <AnnotationEditor
      clip={clip}
      media={{
        url: "media://test",
        path: "/test.mp4",
        width: 640,
        height: 360,
        duration_ms: 3000,
        fps: 25,
      }}
      time={1000}
      initial={[frame]}
      onSave={save}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByTitle("Delete coaching moment"));
  fireEvent.click(screen.getByRole("button", { name: "Save freeze-frames" }));
  expect(save).toHaveBeenCalledWith([]);
  expect(frame.shapes).toHaveLength(1);
});
