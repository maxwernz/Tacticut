import { t, useLanguage } from "./i18n";
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
  useLanguage();
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
      {t("Later")}
    </button>
  );

  return (
    <div className="update-notice" role="status" aria-live="polite">
      {state.status === "available" && (
        <>
          <strong>
            {t("Tacticut {version} is available", { version: state.version })}
          </strong>
          {state.notes.trim() !== "" && (
            <div className="update-notes">{state.notes.trim()}</div>
          )}
          {!state.canInstall && (
            <div className="update-hint">
              {t("This copy can't update itself. Download the new version and")}{" "}
              {navigator.userAgent.includes("Mac")
                ? t("move it to Applications")
                : t("install it")}
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
                {t("Install and restart")}
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                onClick={() => void updates.openPage()}
              >
                {t("Download")}
              </button>
            )}
          </div>
        </>
      )}
      {state.status === "downloading" && (
        <>
          <strong>
            {t("Downloading Tacticut {version}…", { version: state.version })}
          </strong>
          <div className="update-bar">
            <span style={{ width: `${Math.round(state.progress * 100)}%` }} />
          </div>
        </>
      )}
      {state.status === "ready" && (
        <>
          <strong>
            {t("Tacticut {version} is ready", { version: state.version })}
          </strong>
          <div className="update-notes">
            {t("It installs when you quit Tacticut.")}
          </div>
          <div className="update-actions">
            {later}
            <button
              type="button"
              className="primary"
              onClick={() => void onRestart()}
            >
              {t("Restart now")}
            </button>
          </div>
        </>
      )}
      {state.status === "failed" && (
        <>
          <strong>
            {t("Tacticut {version} could not be installed", {
              version: state.version,
            })}
          </strong>
          <div className="update-notes">{state.message}</div>
          <div className="update-actions">
            <button type="button" onClick={() => setHidden(true)}>
              {t("Close")}
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => void updates.openPage()}
            >
              {t("Download instead")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
