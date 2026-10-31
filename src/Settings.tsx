import { useState } from "react";
import {
  Globe2,
  Palette,
  Keyboard,
  Scissors,
  RotateCcw,
  CircleHelp,
} from "lucide-react";
import { Modal } from "./Dialogs";
import { Select } from "./Select";
import { t, useLanguage, type Language } from "./i18n";
import type { ThemePreference } from "./theme";
export function Settings({
  theme,
  onTheme,
  capture,
  onCapture,
  jump,
  onJump,
  onTour,
  onClose,
}: {
  theme: ThemePreference;
  onTheme(theme: ThemePreference): void;
  capture: { before: number; after: number };
  onCapture(capture: { before: number; after: number }): void;
  jump: number;
  onJump(jump: number): void;
  onTour(): void;
  onClose(): void;
}) {
  const { language, setLanguage } = useLanguage();
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const [before, setBefore] = useState(String(capture.before)),
    [after, setAfter] = useState(String(capture.after)),
    [interval, setInterval] = useState(String(jump));
  const [captureError, setCaptureError] = useState("");
  const [jumpError, setJumpError] = useState("");
  function timing() {
    const b = Number(before),
      a = Number(after);
    if (
      !before.trim() ||
      !after.trim() ||
      ![b, a].every((n) => Number.isFinite(n) && n >= 0 && n <= 120) ||
      b + a <= 0
    ) {
      setCaptureError(
        "Choose a non-empty capture window between 0 and 120 seconds.",
      );
      return false;
    }
    onCapture({ before: b, after: a });
    setCaptureError("");
    return true;
  }
  function navigation() {
    const n = Number(interval);
    if (!interval.trim() || !Number.isFinite(n) || n < 1 || n > 120) {
      setJumpError("Choose a jump interval between 1 and 120 seconds.");
      return false;
    }
    onJump(n);
    setJumpError("");
    return true;
  }
  function done() {
    const captureValid = timing();
    const jumpValid = navigation();
    if (captureValid && jumpValid) onClose();
  }
  return (
    <Modal title={t("Settings")} wide onClose={pending ? undefined : onClose}>
      <div className="modal-body settings-page">
        <p className="settings-intro">
          {t(
            "Preferences for this device. Changes apply immediately and do not change your project.",
          )}
        </p>
        <section className="settings-section">
          <div className="settings-section-title">
            <Globe2 size={18} />
            <h3>{t("Language")}</h3>
          </div>
          <div className="settings-field">
            <div>
              <strong>{t("App language")}</strong>
              <p>
                {t(
                  "Menus, controls and help use this language. Your own names and notes stay as written.",
                )}
              </p>
            </div>
            <Select
              label={t("App language")}
              value={language}
              options={[
                { value: "de", label: "Deutsch" },
                { value: "en", label: "English" },
              ]}
              disabled={pending}
              onChange={(value) => {
                setPending(true);
                setError("");
                void setLanguage(value as Language)
                  .catch((e) => setError((e as Error).message))
                  .finally(() => setPending(false));
              }}
            />
          </div>
        </section>
        <section className="settings-section">
          <div className="settings-section-title">
            <Palette size={18} />
            <h3>{t("Appearance")}</h3>
          </div>
          <div className="settings-field">
            <div>
              <strong>{t("Theme")}</strong>
              <p>
                {t("Choose a light or dark workspace, or follow your system.")}
              </p>
            </div>
            <Select
              label={t("Theme")}
              value={theme}
              onChange={(v) => onTheme(v as ThemePreference)}
              options={[
                { value: "system", label: t("System appearance") },
                { value: "light", label: t("Light appearance") },
                { value: "dark", label: t("Dark appearance") },
              ]}
            />
          </div>
        </section>
        <section className="settings-section">
          <div className="settings-section-title">
            <Scissors size={18} />
            <h3>{t("Capture defaults")}</h3>
          </div>
          <p>
            {t(
              "Tag play and quick capture use the context before and after the playhead.",
            )}
          </p>
          <div className="settings-timing">
            <label>
              {t("Seconds before")}
              <input
                aria-label={t("Settings seconds before")}
                type="number"
                min={0}
                max={120}
                value={before}
                onChange={(e) => setBefore(e.target.value)}
                onBlur={timing}
              />
            </label>
            <label>
              {t("Seconds after")}
              <input
                aria-label={t("Settings seconds after")}
                type="number"
                min={0}
                max={120}
                value={after}
                onChange={(e) => setAfter(e.target.value)}
                onBlur={timing}
              />
            </label>
            <button
              onClick={() => {
                onCapture({ before: 8, after: 3 });
                setBefore("8");
                setAfter("3");
                setCaptureError("");
              }}
            >
              <RotateCcw size={14} />
              {t("Reset capture timing")}
            </button>
          </div>
        </section>
        <section className="settings-section">
          <div className="settings-section-title">
            <Keyboard size={18} />
            <h3>{t("Navigation")}</h3>
          </div>
          <div className="settings-field">
            <div>
              <strong>{t("Jump interval (seconds)")}</strong>
              <p>
                {t(
                  "Arrow scrubbing follows playback speed. Shift + arrow multiplies this interval by speed; the jump buttons use the interval directly.",
                )}
              </p>
            </div>
            <input
              aria-label={t("Settings jump interval")}
              type="number"
              min={1}
              max={120}
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
              onBlur={navigation}
            />
          </div>
        </section>
        <section className="settings-section settings-help">
          <div>
            <h3>{t("Categories and handball details")}</h3>
            <p>
              {t(
                "Categories are optional coaching labels you define, such as defensive mistakes or highlights. Handball details record player, outcome, phase and shot location for consistent filters and statistics.",
              )}
            </p>
          </div>
          <button disabled={pending} onClick={onTour}>
            <CircleHelp size={15} />
            {t("Welcome tour")}
          </button>
        </section>
        {(error || captureError || jumpError) && (
          <p className="inline-error" role="alert">
            {error || t(captureError) || t(jumpError)}
          </p>
        )}
      </div>
      <div className="modal-footer">
        <span className="muted">
          {t("Preferences are saved on this device.")}
        </span>
        <span className="grow" />
        <button disabled={pending} onClick={done}>
          {t("Done")}
        </button>
      </div>
    </Modal>
  );
}
