import { t, useLanguage } from "./i18n";
import { useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Modal } from "./Dialogs";
import { analysisSchema, type Analysis } from "./domain";
import { emptyRoster, withRoster, type Roster } from "./roster";
import {
  applySetupTemplate,
  decodeSetupTemplate,
  encodeSetupTemplate,
  makeSetupTemplate,
  readSetupTemplates,
  writeSetupTemplates,
  type SetupTemplate,
} from "./setupTemplates";

export function ProjectSetup({
  analysis,
  onSave,
  onClose,
}: {
  analysis: Analysis;
  onSave(next: Analysis): void;
  onClose(): void;
}) {
  useLanguage();
  const [draft, setDraft] = useState(() => structuredClone(analysis));
  const [section, setSection] = useState("roster");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [templates, setTemplates] = useState<SetupTemplate[]>(() => {
    try {
      return readSetupTemplates();
    } catch {
      return [];
    }
  });
  const [teamId, setTeamId] = useState(analysis.roster?.teams[0]?.id || "");
  const upload = useRef<HTMLInputElement>(null);
  const roster = draft.roster || emptyRoster();
  const team = roster.teams.find((entry) => entry.id === teamId);
  const update = (change: (next: Roster) => void) => {
    const next = structuredClone(roster);
    change(next);
    // Invalid intermediate names stay local until Apply; IDs remain stable.
    setDraft({ ...draft, roster: next });
  };
  const validated = () => analysisSchema.parse(withRoster(draft, roster));
  const action = (work: () => void) => {
    try {
      setError("");
      work();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const store = (next: SetupTemplate[]) => {
    writeSetupTemplates(next);
    setTemplates(next);
  };
  return (
    <Modal title={t("Project setup")} wide onClose={onClose}>
      <div className="modal-body project-setup">
        <div
          className="row"
          role="tablist"
          aria-label={t("Project setup sections")}
        >
          <button
            role="tab"
            aria-selected={section === "roster"}
            onClick={() => setSection("roster")}
          >
            {t("Teams & players")}
          </button>
          <button
            role="tab"
            aria-selected={section === "templates"}
            onClick={() => setSection("templates")}
          >
            {t("Reusable templates")}
          </button>
        </div>
        {section === "roster" ? (
          <div role="tabpanel" aria-label={t("Teams and players")}>
            <p className="muted">
              {t(
                "Set up both teams once, then pick players while tagging. Names stay linked when you rename them. Removing a player keeps their existing clip labels.",
              )}
            </p>
            <div className="setup-team-list">
              {roster.teams.map((entry) => (
                <div className="row" key={entry.id}>
                  <button
                    aria-pressed={teamId === entry.id}
                    onClick={() => setTeamId(entry.id)}
                  >
                    {t("Edit players")}
                  </button>
                  <input
                    aria-label={t("Team name")}
                    value={entry.name}
                    maxLength={80}
                    onChange={(e) =>
                      update((r) => {
                        r.teams.find((v) => v.id === entry.id)!.name =
                          e.target.value;
                      })
                    }
                  />
                  <span className="muted">
                    {
                      roster.players.filter((p) => p.team_id === entry.id)
                        .length
                    }{" "}
                    {t("players")}
                  </span>
                  <button
                    aria-label={t("Remove team {name}", { name: entry.name })}
                    onClick={() =>
                      update((r) => {
                        r.teams = r.teams.filter((v) => v.id !== entry.id);
                        r.players = r.players.filter(
                          (p) => p.team_id !== entry.id,
                        );
                        if (teamId === entry.id)
                          setTeamId(r.teams[0]?.id || "");
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => {
                  const id = crypto.randomUUID();
                  update((r) => r.teams.push({ id, name: t("New team") }));
                  setTeamId(id);
                }}
              >
                <Plus size={14} /> {t(" Add team")}
              </button>
            </div>
            {team && (
              <section
                className="setup-players"
                aria-label={t("Players for {name}", { name: team.name })}
              >
                <h3>
                  {team.name || t("Team")} {t(" · players")}
                </h3>
                {roster.players
                  .filter((p) => p.team_id === teamId)
                  .map((p) => (
                    <div className="row setup-player-row" key={p.id}>
                      <input
                        aria-label={t("Shirt number")}
                        placeholder={t("No.")}
                        value={p.number || ""}
                        maxLength={10}
                        onChange={(e) =>
                          update((r) => {
                            r.players.find((v) => v.id === p.id)!.number =
                              e.target.value;
                          })
                        }
                      />
                      <input
                        aria-label={t("Player name")}
                        placeholder={t("Player name")}
                        value={p.name}
                        maxLength={80}
                        onChange={(e) =>
                          update((r) => {
                            r.players.find((v) => v.id === p.id)!.name =
                              e.target.value;
                          })
                        }
                      />
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={p.goalkeeper}
                          onChange={(e) =>
                            update((r) => {
                              r.players.find((v) => v.id === p.id)!.goalkeeper =
                                e.target.checked;
                            })
                          }
                        />{" "}
                        {t("Goalkeeper")}
                      </label>
                      <button
                        aria-label={t("Remove player {name}", { name: p.name })}
                        onClick={() =>
                          update((r) => {
                            r.players = r.players.filter((v) => v.id !== p.id);
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                <button
                  onClick={() =>
                    update((r) =>
                      r.players.push({
                        id: crypto.randomUUID(),
                        team_id: teamId,
                        name: t("New player"),
                        goalkeeper: false,
                      }),
                    )
                  }
                >
                  <Plus size={14} /> {t(" Add player")}
                </button>
              </section>
            )}
          </div>
        ) : (
          <div role="tabpanel" aria-label={t("Reusable templates")}>
            <p className="muted">
              {t(
                "Reuse categories, groups, shortcut keys, teams and players. Applying a template adds its setup to this project and keeps existing clips. Saved templates stay on this device; export one to share it.",
              )}
            </p>
            <label>
              {t("Template name")}
              <input
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("e.g. First team · season 2026")}
              />
            </label>
            <div className="row">
              <button
                disabled={!name.trim()}
                onClick={() =>
                  action(() => {
                    const template = makeSetupTemplate(validated(), name);
                    if (
                      templates.some(
                        (entry) =>
                          entry.name.toLocaleLowerCase() ===
                          template.name.toLocaleLowerCase(),
                      )
                    )
                      throw new Error(t("Choose a different template name."));
                    store([...templates, template]);
                    setName("");
                    setNotice(t("Template saved on this device."));
                  })
                }
              >
                {t("Save current setup as template")}
              </button>
              <button onClick={() => upload.current?.click()}>
                {t("Import template…")}
              </button>
              <input
                ref={upload}
                hidden
                type="file"
                accept=".json,application/json"
                aria-label={t("Import setup template")}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  try {
                    if (file.size > 2_000_000)
                      throw new Error(t("Template file is too large."));
                    const imported = decodeSetupTemplate(await file.text());
                    if (templates.some((entry) => entry.id === imported.id))
                      throw new Error(
                        t("This template is already in your library."),
                      );
                    store([...templates, imported]);
                    setNotice(
                      t("Template imported. Apply it to use its setup."),
                    );
                    setError("");
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              />
            </div>
            {!templates.length && (
              <p className="muted">{t("No saved templates yet.")}</p>
            )}
            {templates.map((entry) => (
              <div className="setup-template-row" key={entry.id}>
                <div>
                  <strong>{entry.name}</strong>
                  <p className="muted">
                    {entry.categories.length} {t(" categories · ")}
                    {entry.roster.teams.length} {t("teams · ")}
                    {entry.roster.players.length} {t(" players")}
                  </p>
                </div>
                <div className="row">
                  <button
                    aria-label={t("Apply template {name}", {
                      name: entry.name,
                    })}
                    onClick={() =>
                      action(() => {
                        const next = applySetupTemplate(validated(), entry);
                        setDraft(next);
                        setTeamId(next.roster?.teams[0]?.id || "");
                        setNotice(
                          t(
                            "Template added to setup. Apply setup to keep it in this project.",
                          ),
                        );
                      })
                    }
                  >
                    {t("Use template")}
                  </button>
                  <button
                    aria-label={t("Export template {name}", {
                      name: entry.name,
                    })}
                    onClick={() =>
                      action(() => {
                        const url = URL.createObjectURL(
                          new Blob([encodeSetupTemplate(entry)], {
                            type: "application/json",
                          }),
                        );
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `${entry.name.replace(/[^a-z0-9_-]/gi, "_")}.tacticut-setup.json`;
                        a.click();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                      })
                    }
                  >
                    {t("Export")}
                  </button>
                  <button
                    aria-label={t("Remove template {name}", {
                      name: entry.name,
                    })}
                    onClick={() =>
                      action(() =>
                        store(templates.filter((v) => v.id !== entry.id)),
                      )
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="modal-footer">
        <button onClick={onClose}>{t("Cancel")}</button>
        <button
          className="primary"
          onClick={() => action(() => onSave(validated()))}
        >
          {t("Apply setup")}
        </button>
      </div>
    </Modal>
  );
}
