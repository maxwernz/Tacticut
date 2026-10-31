import { t, useLanguage } from "./i18n";
import { useEffect, useState } from "react";
import { FolderOpen, Trash2 } from "lucide-react";
import type { ProjectEntry } from "./api";
import { Modal } from "./Dialogs";

export function ProjectLibrary({
  onOpen,
  onCollection,
  onClose,
}: {
  onOpen(path: string): Promise<boolean | void>;
  onCollection(paths: string[], title: string): Promise<boolean | void>;
  onClose(): void;
}) {
  const { language } = useLanguage();
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState(() => t("Season review"));
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const fail = (error: unknown) =>
    setError(error instanceof Error ? error.message : String(error));
  useEffect(() => {
    let cancelled = false;
    window.desktop
      .projects?.()
      .then((rows) => {
        if (!cancelled) setProjects(rows);
      })
      .catch((error) => {
        if (!cancelled) fail(error);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    if (!window.desktop.projects) setBusy(false);
    return () => {
      cancelled = true;
    };
  }, []);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };
  const filtered = projects.filter((project) =>
    `${project.title} ${project.path}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <Modal title={t("Projects")} onClose={busy ? undefined : onClose} wide>
      <div className="modal-body project-library">
        <p className="muted">
          {t(
            "Open a match, or select projects to review a season together. Each .tcut file is one project.",
          )}
        </p>
        <div className="row project-library-tools">
          <input
            aria-label={t("Search projects")}
            placeholder={t("Find a project…")}
            value={query}
            disabled={busy}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            disabled={busy || !window.desktop.browseProjects}
            onClick={() =>
              void run(async () => {
                setProjects(await window.desktop.browseProjects!());
              })
            }
          >
            <FolderOpen size={16} /> {t(" Browse projects")}
          </button>
        </div>
        <div
          className="project-library-list"
          aria-label={t("Recent projects")}
          aria-busy={busy}
        >
          {!projects.length && (
            <p className="muted">
              {busy
                ? t("Loading projects…")
                : t(
                    "Saved and opened projects appear here. Browse to add existing projects.",
                  )}
            </p>
          )}
          {!!projects.length && !filtered.length && (
            <p className="muted">{t("No projects match your search.")}</p>
          )}
          {filtered.map((project) => (
            <div className="project-library-entry" key={project.path}>
              <input
                type="checkbox"
                aria-label={t("Select {title}", { title: project.title })}
                checked={selected.includes(project.path)}
                disabled={busy || project.missing}
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? [...selected, project.path]
                      : selected.filter((path) => path !== project.path),
                  )
                }
              />
              <div className="project-library-description">
                <strong>{project.title}</strong>
                <small title={project.path}>{project.path}</small>
                <span className="muted">
                  {project.missing
                    ? t("File missing · browse to find its new location")
                    : t(
                        "{clips} clips · {videos} videos · last opened {date}",
                        {
                          clips: project.clips,
                          videos: project.videos,
                          date: new Date(project.lastOpened).toLocaleDateString(
                            language === "de" ? "de-DE" : "en-US",
                          ),
                        },
                      )}
                </span>
              </div>
              <button
                disabled={busy || project.missing}
                aria-label={t("Open {title}", { title: project.title })}
                onClick={() =>
                  void run(async () => {
                    if ((await onOpen(project.path)) !== false) onClose();
                  })
                }
              >
                {t("Open")}
              </button>
              <button
                disabled={busy}
                aria-label={t("Remove {title} from recent projects", {
                  title: project.title,
                })}
                title={t("Remove from this list; keep the file")}
                onClick={() =>
                  void run(async () => {
                    await window.desktop.forgetProject?.(project.path);
                    setProjects(
                      projects.filter((item) => item.path !== project.path),
                    );
                    setSelected(
                      selected.filter((path) => path !== project.path),
                    );
                  })
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <div className="project-library-collection">
          <div className="panel-heading">
            <h3>{t("Cross-project collection")}</h3>
            <span className="muted">
              {selected.length} {t(" selected")}
            </span>
          </div>
          <p className="muted">
            {t(
              "Combines saved clips, playlists and drawings in a separate project. Filter and report across matches, then save the collection. Changes in the original projects are not synced. Separately coded clips count separately.",
            )}
          </p>
          <div className="row">
            <label className="project-collection-name">
              {t("Collection name")}
              <input
                aria-label={t("Collection name")}
                value={title}
                maxLength={120}
                disabled={busy}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <button
              className="primary"
              disabled={
                busy ||
                selected.length < 2 ||
                selected.length > 30 ||
                !title.trim()
              }
              onClick={() =>
                void run(async () => {
                  if ((await onCollection(selected, title.trim())) !== false)
                    onClose();
                })
              }
            >
              {t("Create collection")}
            </button>
          </div>
          {selected.length > 30 && (
            <p role="alert">{t("Choose up to 30 projects at a time.")}</p>
          )}
          {!!selected.length && (
            <button disabled={busy} onClick={() => setSelected([])}>
              {t("Clear selection")}
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
      <div className="modal-actions">
        <button disabled={busy} onClick={onClose}>
          {t("Close")}
        </button>
      </div>
    </Modal>
  );
}
