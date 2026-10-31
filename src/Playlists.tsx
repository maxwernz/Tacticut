import { t, useLanguage } from "./i18n";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Download,
  Play,
  Plus,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  playlistClips,
  clipCategoryLabels,
  timecode,
  type Analysis,
  type Clip,
  type Playlist,
} from "./domain";
import { Select } from "./Select";
import { Modal } from "./Dialogs";

export function Playlists({
  analysis,
  activeId,
  onActive,
  change,
  onPlay,
  onStop,
  onExport,
  onModal,
  playingId,
  playingClipId,
  canPlay,
}: {
  analysis: Analysis;
  activeId: string | null;
  onActive(id: string): void;
  change(edit: (a: Analysis) => void): void;
  onPlay(playlist: Playlist, index?: number): void;
  onStop(): void;
  onExport(clips: Clip[]): void;
  onModal(open: boolean): void;
  playingId: string | null;
  playingClipId: string | null;
  canPlay: boolean;
}) {
  useLanguage();
  const playlist =
    analysis.playlists.find((p) => p.id === activeId) || analysis.playlists[0];
  const [name, setName] = useState(playlist?.name || "");
  const cancelRename = useRef(false);
  const [adding, setAdding] = useState(false),
    [deleting, setDeleting] = useState(false),
    [query, setQuery] = useState(""),
    [chosen, setChosen] = useState<string[]>([]);
  useEffect(
    () => setName(playlist?.name || ""),
    [playlist?.id, playlist?.name],
  );
  useEffect(() => {
    onModal(adding || deleting);
    return () => onModal(false);
  }, [adding, deleting, onModal]);
  const clips = playlist ? playlistClips(analysis, playlist) : [];
  const presentationDuration = (clip: Clip) =>
    clip.end_ms -
    clip.start_ms +
    analysis.freeze_frames
      .filter((f) => f.clip_id === clip.id)
      .reduce((n, f) => n + f.hold_ms, 0);
  const update = (edit: (p: Playlist) => void) => {
    if (playlist)
      change((a) => {
        const p = a.playlists.find((p) => p.id === playlist.id);
        if (p) edit(p);
      });
  };
  const rename = () => {
    if (cancelRename.current) {
      cancelRename.current = false;
      setName(playlist?.name || "");
      return;
    }
    const next = name.trim();
    if (next && next !== playlist?.name)
      update((p) => {
        p.name = next;
      });
    else setName(playlist?.name || "");
  };
  const create = () => {
    let index = analysis.playlists.length + 1;
    while (
      analysis.playlists.some(
        (p) => p.name === t("Playlist {number}", { number: index }),
      )
    )
      index++;
    const p = {
      id: crypto.randomUUID(),
      name: t("Playlist {number}", { number: index }),
      clip_ids: [],
    };
    change((a) => a.playlists.push(p));
    onActive(p.id);
  };
  const candidates = analysis.clips.filter(
    (c) =>
      !playlist?.clip_ids.includes(c.id) &&
      `${c.name} ${c.notes} ${clipCategoryLabels(c, analysis.categories).join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className="playlist-panel">
      <div className="playlist-picker">
        <Select
          label={t("Coaching playlist")}
          value={playlist?.id || ""}
          options={analysis.playlists.map((p) => ({
            value: p.id,
            label: p.name,
          }))}
          disabled={!playlist}
          onChange={(id) => {
            onStop();
            onActive(id);
          }}
        />
        <button title={t("New playlist")} onClick={create}>
          <Plus size={16} />
        </button>
      </div>
      {!playlist ? (
        <div className="sidebar-empty">
          <p>{t("No coaching playlists yet")}</p>
          <small>{t("Arrange existing Clips into a team review.")}</small>
          <button onClick={create}>{t("Create playlist")}</button>
        </div>
      ) : (
        <>
          <div className="playlist-heading">
            <input
              aria-label={t("Playlist name")}
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              onBlur={rename}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
                if (e.key === "Escape") {
                  cancelRename.current = true;
                  setName(playlist.name);
                  e.currentTarget.blur();
                }
              }}
            />
            <span className="muted">
              {clips.length} {t(" Clips ·")}{" "}
              {timecode(
                clips.reduce((sum, c) => sum + presentationDuration(c), 0),
                false,
              )}
            </span>
            <div className="playlist-actions">
              {playingId === playlist.id ? (
                <button onClick={onStop}>
                  <Square size={13} />
                  {t("Stop playlist")}
                </button>
              ) : (
                <button
                  disabled={!clips.length || !canPlay}
                  title={
                    canPlay
                      ? t("Play Clips in playlist order")
                      : t("Finish or cancel the current Clip capture first")
                  }
                  onClick={() => onPlay(playlist)}
                >
                  <Play size={14} />
                  {t("Play playlist")}
                </button>
              )}
              <button
                title={t("Export playlist")}
                disabled={!clips.length}
                onClick={() => onExport(clips)}
              >
                <Download size={15} />
              </button>
              <button
                title={t("Delete playlist")}
                onClick={() => setDeleting(true)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          <ol className="playlist-clips" aria-label={t("Playlist Clips")}>
            {clips.map((clip, index) => (
              <li
                key={clip.id}
                className={
                  playingId === playlist.id && playingClipId === clip.id
                    ? "playing"
                    : ""
                }
              >
                <button
                  className="playlist-clip-main"
                  disabled={!canPlay}
                  title={t("Play from {name}", { name: clip.name })}
                  aria-label={t("Play from {name}", { name: clip.name })}
                  onClick={() => onPlay(playlist, index)}
                >
                  <span className="mono muted">{index + 1}</span>
                  <span
                    className="color-dot"
                    style={{
                      background:
                        analysis.categories.find(
                          (c) => c.id === clip.category_id,
                        )?.color || "#808080",
                    }}
                  />
                  <span>
                    <strong>{clip.name}</strong>
                    <small>
                      {timecode(presentationDuration(clip), false)} ·{" "}
                      {
                        analysis.source_videos.find(
                          (s) => s.id === clip.source_video_id,
                        )?.display_name
                      }
                    </small>
                  </span>
                </button>
                <div className="playlist-row-actions">
                  <button
                    title={t("Move {name} earlier", { name: clip.name })}
                    disabled={index === 0}
                    onClick={() =>
                      update((p) => {
                        [p.clip_ids[index - 1], p.clip_ids[index]] = [
                          p.clip_ids[index],
                          p.clip_ids[index - 1],
                        ];
                      })
                    }
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    title={t("Move {name} later", { name: clip.name })}
                    disabled={index === clips.length - 1}
                    onClick={() =>
                      update((p) => {
                        [p.clip_ids[index + 1], p.clip_ids[index]] = [
                          p.clip_ids[index],
                          p.clip_ids[index + 1],
                        ];
                      })
                    }
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    title={t("Remove {name} from playlist", {
                      name: clip.name,
                    })}
                    onClick={() =>
                      update((p) => {
                        p.clip_ids = p.clip_ids.filter((id) => id !== clip.id);
                      })
                    }
                  >
                    <X size={13} />
                  </button>
                </div>
              </li>
            ))}
            {!clips.length && (
              <li className="sidebar-empty">
                {t("Add Clips, then arrange them in coaching order.")}
              </li>
            )}
          </ol>
          <div className="sidebar-footer">
            <button
              disabled={
                !analysis.clips.some((c) => !playlist.clip_ids.includes(c.id))
              }
              onClick={() => {
                setChosen([]);
                setQuery("");
                setAdding(true);
              }}
            >
              <Plus size={14} />
              {t("Add Clips")}
            </button>
          </div>
          <p className="playlist-format-note">
            {t(
              "Playlists require TS format v2; annotations require v3. Older Python versions cannot open these files.",
            )}
          </p>
        </>
      )}
      {adding && playlist && (
        <Modal
          title={t("Add Clips to playlist")}
          onClose={() => setAdding(false)}
        >
          <div className="modal-body">
            <input
              aria-label={t("Search Clips to add")}
              placeholder={t("Search Clips, Categories and notes…")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="playlist-add-list">
              {candidates.map((clip) => (
                <label key={clip.id} className="checkbox-label">
                  <input
                    type="checkbox"
                    aria-label={t("Add {name}", { name: clip.name })}
                    checked={chosen.includes(clip.id)}
                    onChange={(e) =>
                      setChosen((ids) =>
                        e.target.checked
                          ? [...ids, clip.id]
                          : ids.filter((id) => id !== clip.id),
                      )
                    }
                  />
                  <span>
                    {clip.name}
                    <small>
                      {
                        analysis.source_videos.find(
                          (s) => s.id === clip.source_video_id,
                        )?.display_name
                      }{" "}
                      · {timecode(clip.start_ms, false)}
                    </small>
                  </span>
                </label>
              ))}
              {!candidates.length && (
                <p className="muted">{t("No matching Clips to add.")}</p>
              )}
            </div>
          </div>
          <div className="modal-footer">
            <button onClick={() => setAdding(false)}>{t("Cancel")}</button>
            <button
              className="primary"
              disabled={!chosen.length}
              onClick={() => {
                update((p) => {
                  p.clip_ids = [...new Set([...p.clip_ids, ...chosen])];
                });
                setAdding(false);
              }}
            >
              {t("Add {count} Clips", { count: chosen.length || "" })}
            </button>
          </div>
        </Modal>
      )}
      {deleting && playlist && (
        <Modal title={t("Delete playlist?")} onClose={() => setDeleting(false)}>
          <div className="modal-body">
            {t("Delete “{name}”? All original Clips stay in the Analysis.", {
              name: playlist.name,
            })}
          </div>
          <div className="modal-footer">
            <button onClick={() => setDeleting(false)}>{t("Cancel")}</button>
            <button
              onClick={() => {
                change((a) => {
                  a.playlists = a.playlists.filter((p) => p.id !== playlist.id);
                });
                setDeleting(false);
              }}
            >
              {t("Delete playlist")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
