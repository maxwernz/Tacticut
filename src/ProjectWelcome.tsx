import { t, useLanguage } from "./i18n";
import { tourSteps } from "./WelcomeTour";
import { Film, FolderOpen, CircleHelp } from "lucide-react";
export function ProjectWelcome({
  onAdd,
  onOpen,
  onTour,
  tourSeen,
}: {
  onAdd(): void;
  onOpen?(): void;
  onTour?(): void;
  tourSeen?: boolean;
}) {
  useLanguage();
  return (
    <div className="project-welcome">
      <div className="welcome-brand">
        <Film size={23} strokeWidth={1.5} />
        TACTICUT
      </div>
      <h1>{t("Start a project")}</h1>
      <p>
        {t("In Tacticut, a project is an ")}
        <strong>{t("Analysis")}</strong>
        {t(
          ". Keep match videos, clips, handball tags and coaching playlists in one saved workspace.",
        )}
      </p>
      <div className="welcome-actions">
        <button className="primary" onClick={onAdd}>
          {t("Add Source video")}
        </button>
        {onOpen && (
          <button onClick={onOpen}>
            <FolderOpen size={15} /> {t(" Open project")}
          </button>
        )}
      </div>
      <p className="welcome-file-note">
        {t("Save your work as a ")}
        <strong>.tcut</strong>{" "}
        {t(
          " file. Videos stay in their original folders. You can add several recordings to one project.",
        )}
      </p>
      <div className="welcome-workflow" aria-label={t("Coaching workflow")}>
        <span>
          <b>01</b> {t(" Tag clips")}
        </span>
        <span>
          <b>02</b> {t(" Analyze patterns")}
        </span>
        <span>
          <b>03</b> {t(" Present feedback")}
        </span>
      </div>
      {onTour && (
        <button className="welcome-tour-start" onClick={onTour}>
          <CircleHelp size={16} />{" "}
          {tourSeen ? t("Revisit welcome tour") : t("Start welcome tour")}{" "}
          <small>
            {tourSteps.length} {t(" short chapters · skip or revisit any time")}
          </small>
        </button>
      )}
      <small className="welcome-drop">
        {t("You can also drop video files onto the workspace.")}
      </small>
    </div>
  );
}
