import { useEffect, useState } from "react";
import type { UpdateState, UpdatesApi } from "./updates";

/**
 * The corner card saying a newer Tacticut is out. "Later" hides it until the
 * next check. `onRestart` must let the user save before the app quits.
 */
export function UpdateNotice({
  updates,
  onRestart,
}: {
  updates: UpdatesApi | undefined;
  onRestart: () => Promise<void>;
}) {
  const [state, setState] = useState<UpdateState>({ status: "none" });
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!updates) return;
    void updates.state().then(setState, () => {});
    return updates.onChange((next) => {
      setState(next);
      setHidden(false);
    });
  }, [updates]);

  if (!updates || state.status === "none" || hidden) return null;
  const later = (
    <button type="button" onClick={() => setHidden(true)}>
      Later
    </button>
  );

  return (
    <div className="update-notice" role="status" aria-live="polite">
      {state.status === "available" && (
        <>
          <strong>Tacticut {state.version} is available</strong>
          {state.notes.trim() !== "" && (
            <div className="update-notes">{state.notes.trim()}</div>
          )}
          {!state.canInstall && (
            <div className="update-hint">
              This copy can't update itself. Download the new version and{" "}
              {navigator.userAgent.includes("Mac")
                ? "move it to Applications"
                : "install it"}
              .
            </div>
          )}
          <div className="update-actions">
            {later}
            {state.canInstall ? (
              <button
                type="button"
                className="primary"
                onClick={async () => {
                  if (await updates.install()) await onRestart();
                }}
              >
                Install and restart
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                onClick={() => void updates.openPage()}
              >
                Download
              </button>
            )}
          </div>
        </>
      )}
      {state.status === "downloading" && (
        <>
          <strong>Downloading Tacticut {state.version}…</strong>
          <div className="update-bar">
            <span style={{ width: `${Math.round(state.progress * 100)}%` }} />
          </div>
        </>
      )}
      {state.status === "ready" && (
        <>
          <strong>Tacticut {state.version} is ready</strong>
          <div className="update-notes">It installs when you quit Tacticut.</div>
          <div className="update-actions">
            {later}
            <button
              type="button"
              className="primary"
              onClick={() => void onRestart()}
            >
              Restart now
            </button>
          </div>
        </>
      )}
      {state.status === "failed" && (
        <>
          <strong>Tacticut {state.version} could not be installed</strong>
          <div className="update-notes">{state.message}</div>
          <div className="update-actions">
            <button type="button" onClick={() => setHidden(true)}>
              Close
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => void updates.openPage()}
            >
              Download instead
            </button>
          </div>
        </>
      )}
    </div>
  );
}
