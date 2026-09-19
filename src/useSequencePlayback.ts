import { useEffect, useRef, useState, type RefObject } from "react";
import type { Clip, FreezeFrame } from "./domain";
export type SequenceRequest = {
  token: number;
  clip: Clip;
  freezeFrames?: FreezeFrame[];
};
/** One cancellable Clip presentation, including silent, pauseable coaching holds. */
export function useSequencePlayback(
  video: RefObject<HTMLVideoElement | null>,
  request: SequenceRequest | null,
  ready: boolean,
  mediaDuration: number,
  onComplete: (token: number) => void,
  onFailure: (token: number, message: string) => void,
) {
  const callbacks = useRef({ onComplete, onFailure });
  callbacks.current = { onComplete, onFailure };
  const [freeze, setFreeze] = useState<FreezeFrame | null>(null),
    [holdPaused, setHoldPaused] = useState(false);
  const control = useRef<{ toggle(): boolean; skip(): void }>({
    toggle: () => false,
    skip: () => {},
  });
  useEffect(() => {
    const v = video.current;
    setFreeze(null);
    setHoldPaused(false);
    if (!request || !ready || !v) return;
    let cancelled = false,
      finished = false,
      started = false,
      frame = 0,
      timer: ReturnType<typeof setTimeout> | undefined;
    let hold: {
      frame: FreezeFrame;
      remaining: number;
      start: number;
      armed: boolean;
      paused: boolean;
    } | null = null;
    const moments = (request.freezeFrames || [])
      .filter((f) => f.clip_id === request.clip.id)
      .sort((a, b) => a.time_ms - b.time_ms);
    let momentIndex = 0;
    const { start_ms: start, end_ms: end } = request.clip;
    const fail = (message: string) => {
      if (cancelled || finished) return;
      finished = true;
      clearTimeout(timer);
      hold = null;
      setFreeze(null);
      v.pause();
      callbacks.current.onFailure(request.token, message);
    };
    if (
      start < 0 ||
      end <= start ||
      end > mediaDuration + 50 ||
      moments.some((f) => f.time_ms < start || f.time_ms >= end)
    ) {
      fail(
        "This Clip or one of its freeze-frames extends beyond the playable interval. Edit its boundaries before playing.",
      );
      return;
    }
    const play = () =>
      void v
        .play()
        .then(() => {
          if (!cancelled) check();
        })
        .catch((error) =>
          fail("Playlist playback failed: " + String(error.message || error)),
        );
    const finishHold = () => {
      clearTimeout(timer);
      if (cancelled || finished || !hold) return;
      hold = null;
      setFreeze(null);
      setHoldPaused(false);
      play();
    };
    const armHold = () => {
      if (!hold || hold.armed || hold.paused || v.seeking || v.readyState < 2)
        return;
      hold.armed = true;
      hold.start = performance.now();
      timer = setTimeout(finishHold, hold.remaining);
    };
    const check = () => {
      cancelAnimationFrame(frame);
      if (cancelled || finished || !started) return;
      if (hold) {
        armHold();
        return;
      }
      if (!v.seeking) {
        const moment = moments[momentIndex];
        if (moment && v.currentTime * 1000 >= moment.time_ms) {
          momentIndex++;
          hold = {
            frame: moment,
            remaining: moment.hold_ms,
            start: 0,
            armed: false,
            paused: false,
          };
          v.pause();
          v.currentTime = moment.time_ms / 1000;
          setFreeze(moment);
          setHoldPaused(false);
          armHold();
          return;
        }
        if (v.currentTime * 1000 >= end || v.ended) {
          finished = true;
          v.pause();
          v.currentTime = Math.min(end, mediaDuration) / 1000;
          callbacks.current.onComplete(request.token);
          return;
        }
      }
      if (!v.paused) frame = requestAnimationFrame(check);
    };
    control.current = {
      toggle: () => {
        if (!hold) return false;
        if (hold.paused) {
          hold.paused = false;
          setHoldPaused(false);
          armHold();
        } else {
          if (hold.armed)
            hold.remaining = Math.max(
              0,
              hold.remaining - (performance.now() - hold.start),
            );
          clearTimeout(timer);
          hold.armed = false;
          hold.paused = true;
          setHoldPaused(true);
        }
        return true;
      },
      skip: finishHold,
    };
    const startPlayback = () => {
      if (started || cancelled || finished || v.readyState < 1) return;
      started = true;
      v.pause();
      v.currentTime = start / 1000;
      check();
      if (!hold && !finished) play();
    };
    const mediaError = () =>
      fail(
        "Playback stopped because this Source video could not be played. Relink it or prepare a compatible playback copy.",
      );
    for (const event of ["loadedmetadata", "canplay"])
      v.addEventListener(event, startPlayback);
    for (const event of ["timeupdate", "play", "seeked", "ended", "loadeddata"])
      v.addEventListener(event, check);
    v.addEventListener("error", mediaError);
    startPlayback();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      control.current = { toggle: () => false, skip: () => {} };
      for (const event of ["loadedmetadata", "canplay"])
        v.removeEventListener(event, startPlayback);
      for (const event of [
        "timeupdate",
        "play",
        "seeked",
        "ended",
        "loadeddata",
      ])
        v.removeEventListener(event, check);
      v.removeEventListener("error", mediaError);
      if (started) v.pause();
    };
  }, [video, request, ready, mediaDuration]);
  return {
    freeze,
    holdPaused,
    toggleHold: () => control.current.toggle(),
    skipHold: () => control.current.skip(),
  };
}
