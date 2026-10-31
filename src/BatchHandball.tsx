import { t, useLanguage } from "./i18n";
import { useState } from "react";
import { Modal } from "./Dialogs";
import { HandballTagBoard } from "./HandballTagBoard";
import { handballSchema, type HandballTag } from "./handball";
import type { Clip } from "./domain";
import type { Roster } from "./roster";

export function BatchHandball({
  clips,
  roster,
  onApply,
  onCancel,
}: {
  clips: Clip[];
  roster?: Roster;
  onApply(tag: HandballTag, clear: boolean): void;
  onCancel(): void;
}) {
  useLanguage();
  const [tag, setTag] = useState<HandballTag | undefined>();
  const [clear, setClear] = useState(false);
  return (
    <Modal
      title={t("Tag {count} selected Clips", { count: clips.length })}
      onClose={onCancel}
      wide
    >
      <div className="modal-body">
        <p>
          {t(
            "Fill only the fields you want to apply to all {count} Clips. Empty fields keep each Clip’s existing tags.",
            { count: clips.length },
          )}
        </p>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={clear}
            onChange={(e) => setClear(e.target.checked)}
          />
          {t("Remove all existing handball tags instead")}
        </label>
        {!clear && (
          <div className="tagging-batch-columns">
            {(["people", "play", "court"] as const).map((part) => (
              <HandballTagBoard
                key={part}
                part={part}
                roster={roster}
                clips={clips}
                value={tag}
                onChange={setTag}
              />
            ))}
          </div>
        )}
        <div className="row">
          <button onClick={onCancel}>{t("Cancel")}</button>
          <button
            className="primary"
            disabled={!clear && (!tag || !Object.keys(tag).length)}
            onClick={() => onApply(handballSchema.parse(tag || {}), clear)}
          >
            {t(clear ? "Remove tags" : "Apply tags")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
