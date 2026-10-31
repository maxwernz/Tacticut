import { t, useLanguage } from "./i18n";
import { useState } from "react";
import { Modal } from "./Dialogs";
import { Select } from "./Select";
import { playerReviewGroups } from "./handball";
import type { Clip } from "./domain";
import type { ExportOptions, Progress } from "./api";
export function PlayerExports({
  clips,
  running,
  progress,
  onExport,
  onCancel,
  onClose,
}: {
  clips: Clip[];
  running: boolean;
  progress: Progress;
  onExport(options: ExportOptions): void;
  onCancel(): void;
  onClose(): void;
}) {
  const { language } = useLanguage();
  const [audio, setAudio] = useState(true),
    [replay, setReplay] = useState(false),
    [notes, setNotes] = useState(false),
    [height, setHeight] = useState(720);
  const groups = playerReviewGroups(clips, "player", language);
  return (
    <Modal
      title={t("Export player videos")}
      onClose={running ? undefined : onClose}
    >
      <div className="modal-body">
        <p>
          {t(
            "One MP4 per attacking player from the current filtered selection. Choose a destination folder when you start.",
          )}
        </p>
        <ul className="player-review-preview">
          {groups.map((g, i) => (
            <li key={i}>
              {g.name}{" "}
              <span>
                {g.clips.length} {t(" clips")}
              </span>
            </li>
          ))}
        </ul>
        <p className="muted">
          {t(
            "Each run creates a new folder. Completed videos are kept if you cancel. Clips without a player are excluded.",
          )}
        </p>
        <fieldset disabled={running} className="player-export-options">
          <Select
            label={t("Player video resolution")}
            value={String(height)}
            options={[
              { value: "720", label: t("720p") },
              { value: "1080", label: t("1080p") },
            ]}
            onChange={(v) => setHeight(Number(v))}
          />
          <label>
            <input
              type="checkbox"
              checked={audio}
              onChange={(e) => setAudio(e.target.checked)}
            />{" "}
            {t("Original audio")}
          </label>
          <label>
            <input
              type="checkbox"
              checked={replay}
              onChange={(e) => setReplay(e.target.checked)}
            />{" "}
            {t("Add silent half-speed replay")}
          </label>
          <label>
            <input
              type="checkbox"
              checked={notes}
              onChange={(e) => setNotes(e.target.checked)}
            />{" "}
            {t("Include coaching notes")}
          </label>
        </fieldset>
        {running && (
          <div role="status">
            <progress value={progress.percent} max={100} />
            <p>{progress.message}</p>
          </div>
        )}
      </div>
      <div className="modal-footer">
        {running ? (
          <button onClick={onCancel}>{t("Cancel export queue")}</button>
        ) : (
          <>
            <button onClick={onClose}>{t("Close")}</button>
            <button
              className="primary"
              disabled={!groups.length}
              onClick={() =>
                onExport({
                  ids: clips.map((c) => c.id),
                  title: true,
                  categories: false,
                  notes,
                  numbers: false,
                  audio,
                  encoder: "auto",
                  height,
                  annotations: true,
                  replay,
                  replaySpeed: 0.5,
                  handball: true,
                })
              }
            >
              {groups.length === 1
                ? t("Export {count} player video", { count: groups.length })
                : t("Export {count} player videos", { count: groups.length })}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
