import { useEffect, useRef, type RefObject } from "react";
import type { Clip } from "./domain";
export type SequenceRequest = { token: number; clip: Clip };
/** Owns one bounded playback request; cleanup invalidates late events/promises. */
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
  useEffect(() => {
    const v = video.current;
    if (!request || !ready || !v) return;
    let cancelled = false,
      finished = false,
      started = false,
      frame = 0;
    const { start_ms: start, end_ms: end } = request.clip;
    const fail = (message: string) => {
      if (cancelled || finished) return;
      finished = true;
      v.pause();
      callbacks.current.onFailure(request.token, message);
    };
    if (start < 0 || end <= start || end > mediaDuration + 50) {
      fail(
        "This playlist Clip extends beyond its Source video. Edit its boundaries before playing.",
      );
      return;
    }
    const check = () => {
      cancelAnimationFrame(frame);
      if (cancelled || finished || !started) return;
      if (!v.seeking && (v.currentTime * 1000 >= end || v.ended)) {
        finished = true;
        v.pause();
        v.currentTime = Math.min(end, mediaDuration) / 1000;
        callbacks.current.onComplete(request.token);
      } else if (!v.paused) frame = requestAnimationFrame(check);
    };
    const startPlayback = () => {
      if (started || cancelled || finished || v.readyState < 1) return;
      started = true;
      v.pause();
      v.currentTime = start / 1000;
      void v
        .play()
        .then(() => {
          if (!cancelled) check();
        })
        .catch((error) =>
          fail(`Playlist playback failed: ${String(error.message || error)}`),
        );
    };
    const mediaError = () =>
      fail(
        "Playlist playback stopped because this Source video could not be played. Relink it or prepare a compatible playback copy.",
      );
    for (const event of ["loadedmetadata", "canplay"])
      v.addEventListener(event, startPlayback);
    for (const event of ["timeupdate", "play", "seeked", "ended"])
      v.addEventListener(event, check);
    v.addEventListener("error", mediaError);
    startPlayback();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      for (const event of ["loadedmetadata", "canplay"])
        v.removeEventListener(event, startPlayback);
      for (const event of ["timeupdate", "play", "seeked", "ended"])
        v.removeEventListener(event, check);
      v.removeEventListener("error", mediaError);
      if (started) v.pause();
    };
  }, [video, request, ready, mediaDuration]);
}
