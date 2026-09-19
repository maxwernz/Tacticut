import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize,
  Film,
  Plus,
  Scissors,
  Settings2,
  Pencil,
  RotateCcw,
  RotateCw,
  CircleArrowRight,
  ScanLine,
  Square,
} from "lucide-react";
import type { Category, Clip, SourceVideo } from "./domain";
import { timecode } from "./domain";
import type { Media } from "./api";
import { Select } from "./Select";
import { AnnotationCanvas } from "./AnnotationCanvas";
import {
  useSequencePlayback,
  type SequenceRequest,
} from "./useSequencePlayback";
const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
export type PlayerHandle = {
  capturePosition(): { position: number; duration: number } | null;
  preview(start: number, end: number, loop: boolean): void;
  stopPreview(): void;
  position(): number;
  seek(ms: number): void;
  toggle(): void;
  pause(): void;
  step(delta: number): void;
  jump(delta: number): void;
  changeSpeed(direction: number): void;
};
type Props = {
  sequence: SequenceRequest | null;
  onSequenceEnd(token: number): void;
  onSequenceCancel(): void;
  source?: SourceVideo;
  documentPath: string | null;
  clips: Clip[];
  categories: Category[];
  selected: string | null;
  pending: number | null;
  navigation: { ms: number; revision: number };
  onSelect(id: string): void;
  onEdit(clip: Clip): void;
  onAnnotate(clip: Clip, time: number, media: Media): void;
  onReview(clip: Clip): void;
  onMark(): void;
  captureDisabled: boolean;
  onQuickTag(categoryId: string): void;
  onCaptureSettings(): void;
  onAdd(): void;
  onCancelPending(): void;
  onRelink(): void;
  onError(message: string): void;
};
export const Player = forwardRef<PlayerHandle, Props>(function Player(p, ref) {
  const video = useRef<HTMLVideoElement>(null),
    stage = useRef<HTMLDivElement>(null),
    timeline = useRef<HTMLDivElement>(null),
    head = useRef<HTMLDivElement>(null),
    clock = useRef<HTMLElement>(null),
    pendingRange = useRef<HTMLDivElement>(null);
  const [media, setMedia] = useState<Media | null>(null),
    [loading, setLoading] = useState(false),
    [failure, setFailure] = useState(""),
    [playing, setPlaying] = useState(false),
    [rate, setRate] = useState(1),
    [volume, setVolume] = useState(0.8),
    [muted, setMuted] = useState(false),
    [proxy, setProxy] = useState(false);
  const [videoSize, setVideoSize] = useState({ width: 16, height: 9 });
  const seekTarget = useRef(0),
    resume = useRef(false),
    scrubFrame = useRef(0),
    scrubTarget = useRef(0);
  const duration = media?.duration_ms || p.source?.duration_ms || 0;
  const loadedSource = useRef("");
  const previewRange = useRef<{
    start: number;
    end: number;
    loop: boolean;
  } | null>(null);
  const seek = (ms: number) => {
    if (p.sequence) p.onSequenceCancel();
    previewRange.current = null;
    seekTarget.current = Math.max(0, Math.min(duration, ms));
    if (video.current?.readyState)
      video.current.currentTime = seekTarget.current / 1000;
  };
  const toggle = () => {
    if (sequencePlayback.toggleHold()) return;
    const v = video.current;
    if (!v || !media || loading) return;
    if (v.paused) void v.play().catch((e) => p.onError(String(e)));
    else v.pause();
  };
  useImperativeHandle(ref, () => ({
    capturePosition: () =>
      media &&
      !loading &&
      !failure &&
      video.current &&
      !video.current.seeking &&
      video.current.readyState >= 2
        ? {
            position: Math.round(video.current.currentTime * 1000),
            duration: media.duration_ms,
          }
        : null,
    changeSpeed: (direction) =>
      setRate(
        (current) =>
          PLAYBACK_RATES[
            Math.max(
              0,
              Math.min(
                PLAYBACK_RATES.length - 1,
                PLAYBACK_RATES.indexOf(current) + direction,
              ),
            )
          ],
      ),
    preview: (start, end, loop) => {
      const v = video.current;
      if (!v || !media || loading) return;
      seek(start);
      previewRange.current = { start, end, loop };
      void v.play().catch((e) => p.onError(String(e)));
    },
    stopPreview: () => {
      if (previewRange.current) video.current?.pause();
      previewRange.current = null;
    },
    position: () => Math.round((video.current?.currentTime || 0) * 1000),
    seek,
    toggle,
    pause: () => video.current?.pause(),
    step: (delta) => {
      video.current?.pause();
      seek(
        (video.current?.currentTime || 0) * 1000 +
          (delta * 1000) / (media?.fps || 25),
      );
    },
    jump: (delta) => seek((video.current?.currentTime || 0) * 1000 + delta),
  }));
  useEffect(() => {
    setProxy(false);
    previewRange.current = null;
  }, [p.source?.id, p.source?.location]);
  useEffect(() => {
    let cancelled = false;
    setMedia(null);
    setFailure("");
    setPlaying(false);
    if (!p.source) return;
    setLoading(true);
    window.desktop
      .media(p.source, p.documentPath, proxy)
      .then((result) => {
        if (!cancelled) {
          loadedSource.current = `${p.source!.id}:${p.source!.location}`;
          setMedia(result);
        }
      })
      .catch((e) => {
        if (!cancelled) setFailure(String(e.message || e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [p.source?.id, p.source?.location, p.documentPath, proxy]);
  const sequencePlayback = useSequencePlayback(
    video,
    p.sequence,
    !!media &&
      !loading &&
      !failure &&
      (!p.sequence || p.sequence.clip.source_video_id === p.source?.id) &&
      loadedSource.current === `${p.source?.id}:${p.source?.location}`,
    duration,
    p.onSequenceEnd,
    (_token, message) => {
      p.onSequenceCancel();
      p.onError(message);
    },
  );
  useEffect(() => {
    if (failure && p.sequence) p.onSequenceCancel();
  }, [failure, p.sequence]);
  useEffect(() => {
    seekTarget.current = p.navigation.ms;
    if (video.current?.readyState) seek(p.navigation.ms);
  }, [p.navigation.revision]);
  useEffect(() => {
    if (video.current) {
      video.current.playbackRate = rate;
      video.current.volume = volume;
      video.current.muted = muted;
    }
  }, [rate, volume, muted, media]);
  useEffect(() => {
    let frame = 0;
    const v = video.current;
    const draw = () => {
      const range = previewRange.current;
      if (v && range && !v.seeking && v.currentTime * 1000 >= range.end) {
        if (range.loop) {
          const ended = v.ended;
          v.currentTime = range.start / 1000;
          if (ended) void v.play().catch((e) => p.onError(String(e)));
        } else {
          previewRange.current = null;
          v.pause();
          v.currentTime = range.end / 1000;
        }
      }
      const ms = (video.current?.currentTime || 0) * 1000;
      if (head.current)
        head.current.style.left = `${duration ? (ms / duration) * 100 : 0}%`;
      if (clock.current) clock.current.textContent = timecode(ms);
      if (pendingRange.current && p.pending != null) {
        pendingRange.current.style.left = `${(Math.min(ms, p.pending) / duration) * 100}%`;
        pendingRange.current.style.width = `${(Math.abs(ms - p.pending) / duration) * 100}%`;
      }
      if (v && !v.paused) frame = requestAnimationFrame(draw);
    };
    const update = () => {
      cancelAnimationFrame(frame);
      draw();
    };
    for (const event of [
      "timeupdate",
      "seeking",
      "seeked",
      "play",
      "pause",
      "loadedmetadata",
    ])
      v?.addEventListener(event, update);
    draw();
    return () => {
      cancelAnimationFrame(frame);
      for (const event of [
        "timeupdate",
        "seeking",
        "seeked",
        "play",
        "pause",
        "loadedmetadata",
      ])
        v?.removeEventListener(event, update);
    };
  }, [duration, p.pending, media]);
  useEffect(() => () => cancelAnimationFrame(scrubFrame.current), []);
  const scrub = (e: React.PointerEvent) => {
    const box = timeline.current!.getBoundingClientRect();
    scrubTarget.current = ((e.clientX - box.left) / box.width) * duration;
    if (!scrubFrame.current)
      scrubFrame.current = requestAnimationFrame(() => {
        scrubFrame.current = 0;
        seek(scrubTarget.current);
      });
  };
  const activeClip = p.clips.find((c) => c.id === p.selected);
  return (
    <section className="player-panel">
      <div className="stage" ref={stage}>
        {media && (
          <video
            ref={video}
            src={media.url}
            preload="auto"
            playsInline
            onClick={toggle}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onLoadedMetadata={() => {
              if (video.current)
                setVideoSize({
                  width: video.current.videoWidth || media.width,
                  height: video.current.videoHeight || media.height,
                });
              if (!p.sequence) seek(seekTarget.current);
            }}
            onError={() =>
              setFailure(
                "This codec cannot play directly. Create a compatible playback copy; the original stays available for export.",
              )
            }
          />
        )}
        {sequencePlayback.freeze && (
          <>
            <AnnotationCanvas
              shapes={sequencePlayback.freeze.shapes}
              videoWidth={videoSize.width}
              videoHeight={videoSize.height}
            />
            <div className="freeze-playback-label">
              <span>
                {sequencePlayback.holdPaused
                  ? "Coaching freeze · paused"
                  : "Coaching freeze"}
              </span>
              <button onClick={sequencePlayback.skipHold}>Continue now</button>
            </div>
          </>
        )}
        {!p.source && (
          <div className="empty-stage">
            <Film size={42} strokeWidth={1} />
            <h1>Add a Source video</h1>
            <p>Add a Source video to start your Analysis.</p>
            <button className="primary" onClick={p.onAdd}>
              <Plus size={15} /> Add Source video
            </button>
            <small>or drop videos anywhere in the window</small>
          </div>
        )}
        {loading && (
          <div className="stage-message">
            <span className="spinner" />
            <p>
              {proxy
                ? "Preparing compatible playback…"
                : "Opening Source video…"}
            </p>
            {proxy && (
              <small>This first conversion can take a few minutes.</small>
            )}
          </div>
        )}
        {failure && (
          <div className="stage-message error-stage">
            <Film size={32} />
            <p>{failure}</p>
            <div className="row">
              <button onClick={p.onRelink}>Relink video</button>
              {!proxy && (
                <button
                  onClick={() => {
                    setFailure("");
                    setProxy(true);
                  }}
                >
                  Create playback copy
                </button>
              )}
            </div>
          </div>
        )}
        {p.source && !loading && !failure && (
          <div className="source-caption">
            {p.source.display_name}
            {proxy && <span> · playback copy</span>}
          </div>
        )}
        {p.pending != null && (
          <button className="pending-badge" onClick={p.onCancelPending}>
            <span className="record-dot" /> Clip starts at {timecode(p.pending)}{" "}
            <span>· Esc to cancel</span>
          </button>
        )}
      </div>
      <div className="timeline-caption">
        <span>
          {activeClip
            ? activeClip.name
            : p.source
              ? "Source timeline"
              : "No Source video"}
        </span>
        <span>
          {activeClip
            ? `${timecode(activeClip.start_ms)} — ${timecode(activeClip.end_ms)}`
            : `${p.clips.length} Clips`}
        </span>
      </div>
      <div
        ref={timeline}
        className="timeline"
        role="slider"
        aria-label="Video timeline"
        aria-valuemin={0}
        aria-valuemax={duration}
        tabIndex={0}
        onPointerDown={(e) => {
          if (!duration) return;
          resume.current = !!video.current && !video.current.paused;
          video.current?.pause();
          e.currentTarget.setPointerCapture(e.pointerId);
          scrub(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) scrub(e);
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            cancelAnimationFrame(scrubFrame.current);
            scrubFrame.current = 0;
            seek(scrubTarget.current);
            e.currentTarget.releasePointerCapture(e.pointerId);
            if (resume.current) void video.current?.play().catch(() => {});
          }
        }}
      >
        <div className="ruler">
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} style={{ left: `${(i / 8) * 100}%` }}>
              {timecode((duration * i) / 8, false)}
            </span>
          ))}
        </div>
        <div className="ranges">
          {p.clips.map((c) => (
            <div
              key={c.id}
              title={`${c.name} · ${timecode(c.start_ms)}`}
              className={`clip-range ${p.selected === c.id ? "selected" : ""}`}
              style={{
                left: `${duration ? (c.start_ms / duration) * 100 : 0}%`,
                width: `${duration ? ((c.end_ms - c.start_ms) / duration) * 100 : 0}%`,
                backgroundColor:
                  p.categories.find((t) => t.id === c.category_id)?.color ||
                  "#808080",
              }}
              onPointerDown={() => p.onSelect(c.id)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                seek(c.start_ms);
              }}
            />
          ))}
          {p.pending != null && (
            <div className="pending-range" ref={pendingRange} />
          )}
        </div>
        <div className="playhead" ref={head} />
      </div>
      <div className="transport">
        <div className="time-display">
          <strong ref={clock}>{timecode(0)}</strong>
          <span>/ {timecode(duration, false)}</span>
        </div>
        <div className="play-controls">
          <button
            title="Back 5 seconds (Shift+Left)"
            disabled={!media}
            onClick={() =>
              seek((video.current?.currentTime || 0) * 1000 - 5000)
            }
          >
            <RotateCcw size={17} />
            <small>5</small>
          </button>
          <button
            title="Previous frame (Left)"
            disabled={!media}
            onClick={() => {
              video.current?.pause();
              seek(
                (video.current?.currentTime || 0) * 1000 -
                  1000 / (media?.fps || 25),
              );
            }}
          >
            <SkipBack size={17} />
          </button>
          <button
            className="play-button"
            title="Play / pause (Space)"
            disabled={!media}
            onClick={toggle}
          >
            {playing ||
            (sequencePlayback.freeze && !sequencePlayback.holdPaused) ? (
              <Pause size={21} fill="currentColor" />
            ) : (
              <Play size={21} fill="currentColor" />
            )}
          </button>
          <button
            title="Next frame (Right)"
            disabled={!media}
            onClick={() => {
              video.current?.pause();
              seek(
                (video.current?.currentTime || 0) * 1000 +
                  1000 / (media?.fps || 25),
              );
            }}
          >
            <SkipForward size={17} />
          </button>
          <button
            title="Forward 5 seconds (Shift+Right)"
            disabled={!media}
            onClick={() =>
              seek((video.current?.currentTime || 0) * 1000 + 5000)
            }
          >
            <RotateCw size={17} />
            <small>5</small>
          </button>
        </div>
        <div className="play-settings">
          {p.sequence && (
            <button title="Stop Clip review" onClick={p.onSequenceCancel}>
              <Square size={14} />
            </button>
          )}
          {activeClip && (
            <>
              <button
                title="Review Clip with freeze-frames"
                disabled={p.captureDisabled || !media}
                onClick={() => p.onReview(activeClip)}
              >
                <CircleArrowRight size={16} />
              </button>
              <button
                title="Annotate selected Clip"
                disabled={
                  p.captureDisabled ||
                  !media ||
                  loading ||
                  !!failure ||
                  p.pending !== null
                }
                onClick={() => {
                  if (!media || !video.current || video.current.seeking) return;
                  video.current.pause();
                  p.onAnnotate(
                    activeClip,
                    Math.round(video.current.currentTime * 1000),
                    media,
                  );
                }}
              >
                <ScanLine size={16} />
              </button>
            </>
          )}
          {activeClip && (
            <button
              title="Edit selected Clip"
              disabled={p.captureDisabled}
              onClick={() => p.onEdit(activeClip)}
            >
              <Pencil size={15} />
            </button>
          )}
          <button
            className={
              p.pending === null ? "capture-button" : "capture-button recording"
            }
            title={
              p.pending === null ? "Mark Clip start (M)" : "Mark Clip end (M)"
            }
            aria-label={
              p.pending === null ? "Mark Clip start" : "Mark Clip end"
            }
            disabled={!media || loading || !!failure || p.captureDisabled}
            onClick={p.onMark}
          >
            <Scissors size={16} />
          </button>
          <Select
            label="Quick tag"
            value=""
            display="Tag"
            disabled={
              !media ||
              loading ||
              !!failure ||
              p.captureDisabled ||
              !p.categories.length
            }
            options={p.categories.map((category, index) => ({
              value: category.id,
              label: `${index < 9 ? `${index + 1} · ` : ""}${category.name}`,
              color: category.color,
            }))}
            onChange={p.onQuickTag}
          />
          <button title="Quick capture settings" onClick={p.onCaptureSettings}>
            <Settings2 size={15} />
          </button>
          <Select
            label="Playback speed"
            value={String(rate)}
            onChange={(value) => setRate(Number(value))}
            options={PLAYBACK_RATES.map((r) => ({
              value: String(r),
              label: `${r}×`,
            }))}
          />
          <button title="Mute" onClick={() => setMuted(!muted)}>
            {muted || !volume ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </button>
          <input
            className="volume"
            aria-label="Volume"
            type="range"
            min="0"
            max="1"
            step=".01"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
          <button
            title="Fullscreen video"
            disabled={!media}
            onClick={() => void stage.current?.requestFullscreen()}
          >
            <Maximize size={16} />
          </button>
        </div>
      </div>
    </section>
  );
});
