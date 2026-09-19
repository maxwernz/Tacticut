import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FilePlus2,
  Film,
  FolderOpen,
  Link,
  Pencil,
  Plus,
  Save,
  Search,
  Settings2,
  Trash2,
  X,
  Scissors,
  ListPlus,
} from "lucide-react";
import {
  defaults,
  captureRange,
  exportOrder,
  playlistClips,
  mutate,
  newAnalysis,
  timecode,
  type Analysis,
  type Category,
  type Clip,
  type SourceVideo,
  type Playlist,
} from "./domain";
import type { ExportOptions, Loaded, Progress } from "./api";
import { Player, type PlayerHandle } from "./Player";
import { ClipEditor } from "./ClipEditor";
import { Select } from "./Select";
import { Playlists } from "./Playlists";
import { CategoryDialog, ExportDialog, Modal } from "./Dialogs";
type Confirm = {
  title: string;
  text: string;
  choices: string[];
  resolve(value: number): void;
};
export function App() {
  const [captureSettings, setCaptureSettings] = useState(false);
  const [captureWindow, setCaptureWindow] = useState(() => {
    try {
      const value = JSON.parse(
        localStorage.getItem("capture-window") || "null",
      );
      if (
        value &&
        [value.before, value.after].every(
          (n) =>
            typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 120,
        ) &&
        value.before + value.after > 0
      )
        return value as { before: number; after: number };
    } catch {}
    return { before: 8, after: 3 };
  });
  useEffect(() => {
    try {
      localStorage.setItem("capture-window", JSON.stringify(captureWindow));
    } catch {}
  }, [captureWindow]);
  const [analysis, setAnalysis] = useState(() => newAnalysis()),
    [file, setFile] = useState<string | null>(null),
    [stamp, setStamp] = useState<string | null>(null),
    [legacyPath, setLegacyPath] = useState<string | null>(null),
    [saved, setSaved] = useState("");
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [active, setActive] = useState<string | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [checked, setChecked] = useState<string[]>([]),
    [selecting, setSelecting] = useState(false),
    [pending, setPending] = useState<number | null>(null),
    [draft, setDraft] = useState<Clip | null>(null);
  const [tab, setTab] = useState<"clips" | "videos" | "playlists">("clips"),
    [query, setQuery] = useState(""),
    [scope, setScope] = useState("all"),
    [sort, setSort] = useState("category"),
    [collapsed, setCollapsed] = useState<string[]>([]);
  const [navigation, setNavigation] = useState({ ms: 0, revision: 0 }),
    [confirmation, setConfirmation] = useState<Confirm | null>(null),
    [categoryDialog, setCategoryDialog] = useState<{
      categories: Category[];
      template: boolean;
    } | null>(null),
    [exportClips, setExportClips] = useState<Clip[] | null>(null),
    [exporting, setExporting] = useState(false),
    [progress, setProgress] = useState<Progress>({ percent: 0, message: "" });
  const [rename, setRename] = useState<SourceVideo | null>(null);
  const player = useRef<PlayerHandle>(null);
  const [playlistId, setPlaylistId] = useState<string | null>(null);
  const [playlistModal, setPlaylistModal] = useState(false);
  type Queue = {
    playlistId: string;
    clips: Clip[];
    index: number;
    token: number;
  };
  const [queue, setQueue] = useState<Queue | null>(null);
  const queueRef = useRef(queue),
    queueToken = useRef(0);
  queueRef.current = queue;
  const sequence = useMemo(
    () =>
      queue ? { token: queue.token, clip: queue.clips[queue.index] } : null,
    [queue],
  );
  function stopPlaylist() {
    if (queueRef.current) player.current?.pause();
    queueRef.current = null;
    setQueue(null);
  }
  function playPlaylist(playlist: Playlist, index = 0) {
    if (draft || pending !== null || busy || !ready) {
      setNotice(
        "Finish or cancel the current Clip capture before playing a playlist.",
      );
      return;
    }
    const clips = playlistClips(analysis, playlist);
    if (!clips[index]) return;
    player.current?.stopPreview();
    const next = {
      playlistId: playlist.id,
      clips,
      index,
      token: ++queueToken.current,
    };
    queueRef.current = next;
    setQueue(next);
    setActive(clips[index].source_video_id);
    setSelected(clips[index].id);
  }
  function nextPlaylistClip(token: number) {
    const current = queueRef.current;
    if (!current || current.token !== token) return;
    const index = current.index + 1;
    if (index === current.clips.length) {
      stopPlaylist();
      setNotice("Playlist finished");
      return;
    }
    const next = { ...current, index, token: ++queueToken.current };
    queueRef.current = next;
    setQueue(next);
    setActive(next.clips[index].source_video_id);
    setSelected(next.clips[index].id);
  }
  const serialized = JSON.stringify(analysis),
    dirty = ready && serialized !== saved;
  const latest = useRef({
    analysis,
    file,
    stamp,
    legacyPath,
    serialized,
    dirty,
  });
  latest.current = { analysis, file, stamp, legacyPath, serialized, dirty };
  const startup = useRef(false),
    recoveryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const source = analysis.source_videos.find((s) => s.id === active);
  const document = (): Loaded => ({
    analysis: latest.current.analysis,
    path: latest.current.file,
    stamp: latest.current.stamp,
    legacyPath: latest.current.legacyPath,
  });
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  const confirm = (title: string, text: string, choices: string[]) =>
    new Promise<number>((resolve) =>
      setConfirmation({ title, text, choices, resolve }),
    );
  const change = (fn: (a: Analysis) => void) => {
    stopPlaylist();
    try {
      setAnalysis(mutate(latest.current.analysis, fn));
    } catch (e) {
      fail(e);
    }
  };
  const clearRecoveryTimer = () => {
    if (recoveryTimer.current) clearTimeout(recoveryTimer.current);
    recoveryTimer.current = null;
  };
  const replace = (data: Loaded, unsaved = false) => {
    stopPlaylist();
    setPlaylistId(null);
    clearRecoveryTimer();
    setAnalysis(data.analysis);
    setFile(data.path);
    setStamp(data.stamp);
    setLegacyPath(data.legacyPath || null);
    setSaved(unsaved || data.legacyPath ? "" : JSON.stringify(data.analysis));
    if (data.legacyPath)
      setNotice(
        "Legacy Analysis imported. Save to a new JSON Analysis file to complete conversion.",
      );
    setActive(data.analysis.source_videos[0]?.id || null);
    setSelected(null);
    setChecked([]);
    setSelecting(false);
    setDraft(null);
    setPending(null);
    setQuery("");
    setScope("all");
    setNavigation((n) => ({ ms: 0, revision: n.revision + 1 }));
  };
  useEffect(() => {
    if (startup.current) return;
    startup.current = true;
    void (async () => {
      try {
        const template = await window.desktop.template();
        const fresh = newAnalysis(template);
        setAnalysis(fresh);
        setSaved(JSON.stringify(fresh));
        const recovered = await window.desktop.restore();
        if (recovered) {
          const answer = await confirm(
            "Recover unsaved Analysis?",
            `Unsaved changes to “${recovered.analysis.title || "Untitled Analysis"}” were found from a previous session.`,
            ["Restore Analysis", "Discard snapshot"],
          );
          if (answer === 0) replace(recovered, true);
          else await window.desktop.recovery(null);
        }
      } catch (e) {
        fail(e);
      } finally {
        setReady(true);
      }
    })();
  }, []);
  useEffect(() => {
    if (!ready) return;
    window.desktop.setDirty(dirty);
    window.document.title = `${dirty ? "● " : ""}${analysis.title || "Untitled Analysis"} — Video Analyse`;
    clearRecoveryTimer();
    if (dirty)
      recoveryTimer.current = setTimeout(() => {
        void window.desktop.recovery(document()).catch(fail);
      }, 650);
    return clearRecoveryTimer;
  }, [serialized, dirty, ready, file, stamp]);
  useEffect(() => window.desktop.onProgress(setProgress), []);
  useEffect(() => {
    if (
      confirmation ||
      categoryDialog ||
      exportClips ||
      captureSettings ||
      playlistModal ||
      rename
    )
      stopPlaylist();
  }, [
    confirmation,
    categoryDialog,
    exportClips,
    captureSettings,
    playlistModal,
    rename,
  ]);
  useEffect(() => {
    setChecked((ids) =>
      ids.filter((id) => analysis.clips.some((c) => c.id === id)),
    );
  }, [analysis.clips]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 7000);
    return () => clearTimeout(timer);
  }, [notice]);
  async function save(as = false): Promise<boolean> {
    const before = latest.current.serialized;
    try {
      const result = await window.desktop.save(document(), as);
      if (!result) return false;
      setFile(result.path);
      setStamp(result.stamp);
      setLegacyPath(result.legacyPath || null);
      if (latest.current.serialized === before) {
        setAnalysis(result.analysis);
        setSaved(JSON.stringify(result.analysis));
        clearRecoveryTimer();
        await window.desktop.recovery(null);
      } else {
        setSaved(before);
        await window.desktop.recovery({
          ...document(),
          path: result.path,
          stamp: result.stamp,
          legacyPath: result.legacyPath || null,
        });
      }
      setNotice("Analysis saved");
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  }
  async function mayLeave(): Promise<boolean> {
    if (draft || pending != null) {
      const answer = await confirm(
        "Discard unfinished Clip?",
        "The current Clip draft or pending boundary has not been added to the Analysis.",
        ["Keep editing", "Discard unfinished Clip"],
      );
      if (answer !== 1) return false;
    }
    if (!latest.current.dirty) return true;
    const answer = await confirm(
      "Save Analysis changes?",
      "Save your changes before leaving this Analysis.",
      ["Save", "Discard changes", "Cancel"],
    );
    if (answer === 2) return false;
    return answer === 0 ? save() : true;
  }
  async function switchSource(id: string, ms = 0): Promise<boolean> {
    stopPlaylist();
    if ((draft || pending != null) && id !== active) {
      if (
        (await confirm(
          "Switch Source video?",
          "Switching discards the unfinished Clip on the active Source video.",
          ["Keep editing", "Switch video"],
        )) !== 1
      )
        return false;
      setDraft(null);
      setPending(null);
    }
    setActive(id);
    setNavigation((n) => ({ ms, revision: n.revision + 1 }));
    return true;
  }
  async function addSources(sources: SourceVideo[]) {
    let lastId: string | null = null;
    const result = mutate(latest.current.analysis, (a) => {
      for (const s of sources) {
        const match = a.source_videos.find(
          (t) =>
            t.fingerprint === s.fingerprint &&
            t.byte_size === s.byte_size &&
            t.duration_ms === s.duration_ms,
        );
        if (a.source_videos.some((t) => t.location === s.location))
          throw new Error(`“${s.display_name}” has already been added`);
        if (match) {
          match.location = s.location;
          match.relative_path = null;
          lastId = match.id;
        } else {
          a.source_videos.push(s);
          lastId = s.id;
        }
      }
    });
    setAnalysis(result);
    setTab("videos");
    if (lastId && !draft && pending == null) {
      setActive(lastId);
      setNavigation((n) => ({ ms: 0, revision: n.revision + 1 }));
    }
  }
  async function editClip(clip: Clip) {
    stopPlaylist();
    if (
      draft &&
      (await confirm(
        "Discard Clip draft?",
        "The edits in the current Clip draft have not been saved.",
        ["Keep editing", "Discard draft"],
      )) !== 1
    )
      return;
    setDraft(null);
    setPending(null);
    setActive(clip.source_video_id);
    setSelected(clip.id);
    setDraft({ ...clip });
    setNavigation((n) => ({ ms: clip.start_ms, revision: n.revision + 1 }));
    player.current?.pause();
  }
  function mark() {
    stopPlaylist();
    if (!source || draft) return;
    const now = player.current?.position() || 0;
    if (pending === null) setPending(now);
    else if (now <= pending)
      fail(
        new Error("Move the playhead after the Clip start to mark its end."),
      );
    else {
      player.current?.pause();
      setDraft({
        id: crypto.randomUUID(),
        source_video_id: source.id,
        name: `Clip ${analysis.clips.length + 1}`,
        start_ms: pending,
        end_ms: now,
        category_id: null,
        notes: "",
        creation_order: analysis.clips.length,
      });
      setPending(null);
    }
  }
  function quickTag(categoryId: string) {
    if (queueRef.current) return;
    if (!source || draft || busy || captureSettings) return;
    const category = analysis.categories.find((c) => c.id === categoryId);
    const capture = player.current?.capturePosition();
    if (!category || !capture) return;
    try {
      const clip: Clip = {
        id: crypto.randomUUID(),
        source_video_id: source.id,
        name: `${category.name} ${analysis.clips.length + 1}`,
        ...captureRange(
          capture.position,
          Math.min(capture.duration, source.duration_ms ?? capture.duration),
          captureWindow.before * 1000,
          captureWindow.after * 1000,
        ),
        category_id: category.id,
        notes: "",
        creation_order: analysis.clips.length,
      };
      change((a) => a.clips.push(clip));
      setTab("clips");
      setSelected(clip.id);
      setNotice(
        `Captured ${category.name} · ${timecode(clip.start_ms, false)}–${timecode(clip.end_ms, false)}`,
      );
    } catch (e) {
      fail(e);
    }
  }
  function showExport() {
    stopPlaylist();
    const ids = checked.length ? checked : analysis.clips.map((c) => c.id);
    if (!ids.length) {
      setNotice("Create a Clip before exporting");
      return;
    }
    setExportClips(exportOrder(analysis, ids));
  }
  const operation = useRef(false);
  async function run(action: () => Promise<unknown>) {
    if (operation.current) return;
    stopPlaylist();
    operation.current = true;
    setBusy(true);
    try {
      await action();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      operation.current = false;
    }
  }
  async function command(name: string) {
    if (
      !ready ||
      operation.current ||
      confirmation ||
      categoryDialog ||
      rename ||
      exportClips ||
      playlistModal ||
      captureSettings
    )
      return;
    if (name === "export") {
      showExport();
      return;
    }
    if (name === "categories") {
      setCategoryDialog({ categories: analysis.categories, template: false });
      return;
    }
    if (name === "template") {
      await run(async () =>
        setCategoryDialog({
          categories: await window.desktop.template(),
          template: true,
        }),
      );
      return;
    }
    await run(async () => {
      if (name === "save" || name === "save-as") await save(name === "save-as");
      else if (name === "add")
        await addSources(await window.desktop.addVideos());
      else if (["new", "open", "close"].includes(name)) {
        if (!(await mayLeave())) return;
        if (name === "open") {
          const data = await window.desktop.open();
          if (!data) return;
          clearRecoveryTimer();
          await window.desktop.recovery(null);
          replace(data);
        }
        if (name === "new") {
          const template = await window.desktop.template();
          clearRecoveryTimer();
          await window.desktop.recovery(null);
          replace({ analysis: newAnalysis(template), path: null, stamp: null });
        }
        if (name === "close") {
          clearRecoveryTimer();
          await window.desktop.recovery(null);
          window.desktop.close();
        }
      }
    });
  }
  const commandRef = useRef(command);
  commandRef.current = command;
  useEffect(
    () => window.desktop.onCommand((name) => void commandRef.current(name)),
    [],
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        busy ||
        !ready ||
        confirmation ||
        categoryDialog ||
        exportClips ||
        rename ||
        captureSettings ||
        playlistModal ||
        (e.target instanceof Element &&
          e.target.closest(
            "input,textarea,select,[role=dialog],[role=combobox],[data-popup],[contenteditable=true]",
          ))
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!e.shiftKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        if (!e.repeat) {
          const category = analysis.categories[Number(e.key) - 1];
          if (category) quickTag(category.id);
        }
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        player.current?.toggle();
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const d = e.key === "ArrowLeft" ? -1 : 1;
        e.shiftKey ? player.current?.jump(d * 5000) : player.current?.step(d);
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        player.current?.changeSpeed(e.key === "ArrowUp" ? 1 : -1);
      }
      if (e.key.toLowerCase() === "m") {
        e.preventDefault();
        if (!e.repeat) mark();
      }
      if (e.key === "Escape") {
        stopPlaylist();
        setSelecting(false);
        setChecked([]);
        setPending(null);
        setDraft(null);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const visible = useMemo(
    () =>
      analysis.clips.filter(
        (c) =>
          (scope === "all" || c.source_video_id === active) &&
          `${c.name} ${c.notes} ${analysis.categories.find((t) => t.id === c.category_id)?.name || ""} ${analysis.source_videos.find((s) => s.id === c.source_video_id)?.display_name}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [analysis, query, scope, active],
  );
  const groups = useMemo(
    () =>
      sort === "category"
        ? [
            ...analysis.categories.map((c) => ({
              id: c.id,
              name: c.name,
              color: c.color,
              clips: exportOrder(
                analysis,
                visible.filter((t) => t.category_id === c.id).map((t) => t.id),
              ),
            })),
            {
              id: "",
              name: "Ohne Kategorie",
              color: "#808080",
              clips: exportOrder(
                analysis,
                visible.filter((c) => !c.category_id).map((c) => c.id),
              ),
            },
          ]
        : [
            {
              id: "all",
              name: sort === "time" ? "By start time" : "Creation order",
              color: "#808080",
              clips: [...visible].sort((a, b) =>
                sort === "time"
                  ? a.start_ms - b.start_ms
                  : a.creation_order - b.creation_order,
              ),
            },
          ],
    [analysis, visible, sort],
  );
  async function removeSource(s: SourceVideo) {
    const count = analysis.clips.filter(
      (c) => c.source_video_id === s.id,
    ).length;
    if (
      (await confirm(
        "Remove Source video?",
        `Remove “${s.display_name}” and its ${count} Clips from the Analysis? The video file stays on disk.`,
        ["Cancel", "Remove"],
      )) !== 1
    )
      return;
    change((a) => {
      a.source_videos = a.source_videos.filter((t) => t.id !== s.id);
      a.clips = a.clips.filter((c) => c.source_video_id !== s.id);
    });
    if (active === s.id) {
      setActive(analysis.source_videos.find((t) => t.id !== s.id)?.id || null);
      setPending(null);
      setDraft(null);
    }
  }
  async function relink(s: SourceVideo) {
    const replacement = await window.desktop.relink(s);
    if (replacement)
      change((a) => {
        a.source_videos = a.source_videos.map((t) =>
          t.id === s.id ? replacement : t,
        );
      });
  }
  const moveSource = (i: number, by: number) =>
    change((a) => {
      [a.source_videos[i], a.source_videos[i + by]] = [
        a.source_videos[i + by],
        a.source_videos[i],
      ];
    });
  async function startExport(options: ExportOptions) {
    setExporting(true);
    setProgress({ percent: 0, message: "Preparing export" });
    try {
      const path = await window.desktop.export(document(), options);
      if (path) {
        setNotice(`Export saved: ${path}`);
        setExportClips(null);
      }
    } catch (e) {
      fail(e);
    } finally {
      setExporting(false);
    }
  }
  return (
    <div
      className={`app ${busy ? "busy" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (!busy && ready && !confirmation && !exportClips) {
          const paths = window.desktop.filePaths(
            Array.from(e.dataTransfer.files),
          );
          if (paths.length)
            void run(async () =>
              addSources(await window.desktop.importPaths(paths)),
            );
        }
      }}
    >
      <header className={`toolbar platform-${window.desktop.platform}`}>
        <input
          className="analysis-title"
          aria-label="Analysis title"
          placeholder="Untitled Analysis"
          value={analysis.title}
          disabled={!ready || busy}
          onChange={(e) =>
            change((a) => {
              a.title = e.target.value;
            })
          }
        />
        {dirty && <span className="dirty-dot" title="Unsaved changes" />}
        <span className="grow" />
        <button
          title="New Analysis"
          onClick={() => void command("new")}
          disabled={busy || !ready}
        >
          <FilePlus2 size={16} />
        </button>
        <button
          title="Open Analysis"
          onClick={() => void command("open")}
          disabled={busy || !ready}
        >
          <FolderOpen size={16} />
        </button>
        <button
          title="Save Analysis"
          onClick={() => void command("save")}
          disabled={busy || !analysis.source_videos.length}
        >
          <Save size={16} />
        </button>
        <span className="divider" />
        <button onClick={() => void command("add")} disabled={busy || !ready}>
          <Plus size={15} />
          Add video
        </button>
        <button
          className="export-button"
          onClick={showExport}
          disabled={!analysis.clips.length || busy}
        >
          <Download size={15} />
          Export{checked.length ? ` (${checked.length})` : ""}
        </button>
        <Select
          label="Analysis actions"
          value=""
          display="···"
          options={[
            { value: "save-as", label: "Save Analysis as…" },
            { value: "categories", label: "Manage Categories" },
            { value: "template", label: "Category template" },
          ]}
          onChange={(action) => void command(action)}
          disabled={busy || !ready}
        />
        {window.desktop.platform !== "darwin" && (
          <div className="window-controls">
            <button
              title="Minimize window"
              onClick={() => window.desktop.windowControl("minimize")}
            >
              −
            </button>
            <button
              title="Maximize or restore window"
              onClick={() => window.desktop.windowControl("maximize")}
            >
              □
            </button>
            <button
              title="Close window"
              onClick={() => window.desktop.windowControl("close")}
            >
              <X size={15} />
            </button>
          </div>
        )}
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <nav className="sidebar-tabs">
            <button
              className={tab === "clips" ? "active" : ""}
              onClick={() => setTab("clips")}
            >
              Clips <span>{analysis.clips.length}</span>
            </button>
            <button
              className={tab === "videos" ? "active" : ""}
              onClick={() => setTab("videos")}
            >
              Videos <span>{analysis.source_videos.length}</span>
            </button>
            <button
              title="Manage Categories"
              className="settings-button"
              onClick={() => void command("categories")}
            >
              <Settings2 size={15} />
            </button>
            <button
              className={tab === "playlists" ? "active" : ""}
              onClick={() => setTab("playlists")}
            >
              Playlists
            </button>
          </nav>
          {tab === "clips" ? (
            <>
              <div className="sidebar-filters">
                <div className="search">
                  <Search size={14} />
                  <input
                    aria-label="Search Clips"
                    placeholder="Search Clips and notes…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <button title="Clear search" onClick={() => setQuery("")}>
                      <X size={12} />
                    </button>
                  )}
                </div>
                <div className="row">
                  <Select
                    label="Clip scope"
                    value={scope}
                    onChange={setScope}
                    options={[
                      { value: "all", label: "All videos" },
                      { value: "active", label: "Active video" },
                    ]}
                  />
                  <Select
                    label="Clip sort"
                    value={sort}
                    onChange={setSort}
                    options={[
                      { value: "category", label: "By Category" },
                      { value: "time", label: "By start time" },
                      { value: "creation", label: "Creation order" },
                    ]}
                  />
                </div>
              </div>
              <div className="clip-list">
                {!analysis.clips.length && (
                  <div className="sidebar-empty">
                    <Scissors size={24} />
                    <p>No Clips yet</p>
                    <small>
                      Press <kbd>M</kbd> to mark a start,
                      <br />
                      then again to mark the end.
                    </small>
                  </div>
                )}
                {!!analysis.clips.length && !visible.length && (
                  <p className="sidebar-empty">No matching Clips</p>
                )}
                {groups.map(
                  (group) =>
                    !!group.clips.length && (
                      <section key={group.id}>
                        <button
                          className="category-heading"
                          onClick={() =>
                            setCollapsed(
                              collapsed.includes(group.id)
                                ? collapsed.filter((id) => id !== group.id)
                                : [...collapsed, group.id],
                            )
                          }
                        >
                          {collapsed.includes(group.id) ? (
                            <ChevronRight size={13} />
                          ) : (
                            <ChevronDown size={13} />
                          )}
                          <span
                            className="category-dot"
                            style={{ backgroundColor: group.color }}
                          />
                          {group.name}
                          <span className="count">{group.clips.length}</span>
                        </button>
                        {!collapsed.includes(group.id) &&
                          group.clips.map((c) => (
                            <div
                              key={c.id}
                              className={`clip-row ${selected === c.id ? "selected" : ""}`}
                              style={{
                                borderLeftColor:
                                  analysis.categories.find(
                                    (t) => t.id === c.category_id,
                                  )?.color || "#808080",
                              }}
                              onClick={() =>
                                void switchSource(
                                  c.source_video_id,
                                  c.start_ms,
                                ).then((ok) => {
                                  if (ok) setSelected(c.id);
                                })
                              }
                              onDoubleClick={() => void editClip(c)}
                            >
                              {selecting && (
                                <input
                                  type="checkbox"
                                  aria-label={`Select ${c.name} for export`}
                                  checked={checked.includes(c.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) =>
                                    setChecked(
                                      e.target.checked
                                        ? [...checked, c.id]
                                        : checked.filter((id) => id !== c.id),
                                    )
                                  }
                                />
                              )}
                              <div className="clip-info">
                                <strong title={c.name}>{c.name}</strong>
                                {analysis.source_videos.length > 1 && (
                                  <small>
                                    {
                                      analysis.source_videos.find(
                                        (s) => s.id === c.source_video_id,
                                      )?.display_name
                                    }
                                  </small>
                                )}
                              </div>
                              <span className="clip-time">
                                {timecode(c.start_ms, false)}
                              </span>
                              <button
                                title={`Edit ${c.name}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void editClip(c);
                                }}
                              >
                                <Pencil size={13} />
                              </button>
                            </div>
                          ))}
                      </section>
                    ),
                )}
              </div>
              <div className="sidebar-footer">
                {!selecting ? (
                  <>
                    <span className="muted">{visible.length} Clips</span>
                    <button
                      disabled={!analysis.clips.length}
                      onClick={() => setSelecting(true)}
                    >
                      Select clips
                    </button>
                  </>
                ) : (
                  <>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        aria-label="Select all visible Clips"
                        checked={
                          visible.length > 0 &&
                          visible.every((c) => checked.includes(c.id))
                        }
                        onChange={(e) =>
                          setChecked(
                            e.target.checked
                              ? [
                                  ...new Set([
                                    ...checked,
                                    ...visible.map((c) => c.id),
                                  ]),
                                ]
                              : checked.filter(
                                  (id) => !visible.some((c) => c.id === id),
                                ),
                          )
                        }
                      />
                      {checked.length
                        ? `${checked.length} selected`
                        : "Select all"}
                    </label>
                    <Select
                      label="Add selected Clips to playlist"
                      display={<ListPlus size={15} />}
                      value=""
                      disabled={!checked.length}
                      options={[
                        { value: "new", label: "New playlist from selection" },
                        ...analysis.playlists.map((p) => ({
                          value: p.id,
                          label: p.name,
                        })),
                      ]}
                      onChange={(id) => {
                        const target = id === "new" ? crypto.randomUUID() : id;
                        change((a) => {
                          if (id === "new")
                            a.playlists.push({
                              id: target,
                              name: `Playlist ${a.playlists.length + 1}`,
                              clip_ids: [...checked],
                            });
                          else {
                            const p = a.playlists.find((p) => p.id === id);
                            if (p)
                              p.clip_ids = [
                                ...new Set([...p.clip_ids, ...checked]),
                              ];
                          }
                        });
                        setPlaylistId(target);
                        setTab("playlists");
                        setChecked([]);
                        setSelecting(false);
                      }}
                    />
                    <button
                      title="Delete selected Clips"
                      disabled={!checked.length}
                      onClick={() =>
                        void run(async () => {
                          if (
                            (await confirm(
                              "Delete selected Clips?",
                              `Delete ${checked.length} Clips from the Analysis?`,
                              ["Cancel", "Delete Clips"],
                            )) === 1
                          ) {
                            change((a) => {
                              a.clips = a.clips.filter(
                                (c) => !checked.includes(c.id),
                              );
                            });
                            setChecked([]);
                            setSelected(null);
                            if (draft && checked.includes(draft.id))
                              setDraft(null);
                          }
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                    <button
                      onClick={() => {
                        setSelecting(false);
                        setChecked([]);
                      }}
                    >
                      Done
                    </button>
                  </>
                )}
              </div>
            </>
          ) : tab === "playlists" ? (
            <Playlists
              analysis={analysis}
              activeId={playlistId}
              onActive={setPlaylistId}
              change={change}
              onPlay={playPlaylist}
              onStop={stopPlaylist}
              onExport={(clips) => {
                stopPlaylist();
                setExportClips(clips);
              }}
              onModal={setPlaylistModal}
              playingId={queue?.playlistId || null}
              playingClipId={sequence?.clip.id || null}
              canPlay={!draft && pending === null}
            />
          ) : (
            <>
              <div className="source-list">
                {analysis.source_videos.map((s, i) => (
                  <div
                    key={s.id}
                    className={`source-row ${active === s.id ? "active" : ""}`}
                  >
                    <button
                      className="source-main"
                      onClick={() => void switchSource(s.id)}
                    >
                      <Film size={19} />
                      <span>
                        <strong>{s.display_name}</strong>
                        <small>
                          {s.duration_ms != null
                            ? timecode(s.duration_ms, false)
                            : "Duration unknown"}{" "}
                          ·{" "}
                          {
                            analysis.clips.filter(
                              (c) => c.source_video_id === s.id,
                            ).length
                          }{" "}
                          Clips
                        </small>
                      </span>
                      {active === s.id && <Check size={14} />}
                    </button>
                    <div className="source-actions">
                      <button
                        title="Rename Source video"
                        onClick={() => setRename({ ...s })}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        title="Relink Source video"
                        onClick={() => void run(() => relink(s))}
                      >
                        <Link size={13} />
                      </button>
                      <button
                        title="Move video earlier"
                        disabled={!i}
                        onClick={() => moveSource(i, -1)}
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        title="Move video later"
                        disabled={i === analysis.source_videos.length - 1}
                        onClick={() => moveSource(i, 1)}
                      >
                        <ArrowDown size={13} />
                      </button>
                      <button
                        title="Remove Source video"
                        onClick={() => void run(() => removeSource(s))}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
                {!analysis.source_videos.length && (
                  <p className="sidebar-empty">Source videos appear here.</p>
                )}
              </div>
              <div className="sidebar-footer">
                <button onClick={() => void command("add")}>
                  <Plus size={14} />
                  Add Source video
                </button>
              </div>
            </>
          )}
        </aside>
        <Player
          ref={player}
          sequence={sequence}
          onSequenceEnd={nextPlaylistClip}
          onSequenceCancel={stopPlaylist}
          source={source}
          documentPath={file}
          clips={analysis.clips.filter((c) => c.source_video_id === active)}
          categories={analysis.categories}
          selected={selected}
          pending={pending}
          navigation={navigation}
          onSelect={setSelected}
          onEdit={(c) => void editClip(c)}
          onMark={mark}
          captureDisabled={!!draft || !!queue}
          onQuickTag={quickTag}
          onCaptureSettings={() => setCaptureSettings(true)}
          onAdd={() => void command("add")}
          onCancelPending={() => setPending(null)}
          onRelink={() => {
            if (source) void run(() => relink(source));
          }}
          onError={setError}
        />
        {draft && (
          <ClipEditor
            key={draft.id}
            clip={draft}
            categories={analysis.categories}
            duration={
              analysis.source_videos.find((s) => s.id === draft.source_video_id)
                ?.duration_ms ?? null
            }
            current={() => player.current?.position() || 0}
            onPreview={(start, end, loop) =>
              player.current?.preview(start, end, loop)
            }
            onStopPreview={() => player.current?.stopPreview()}
            onSeek={(ms) => player.current?.seek(ms)}
            onCancel={() => setDraft(null)}
            onSave={(clip) => {
              try {
                const result = mutate(analysis, (a) => {
                  const index = a.clips.findIndex((c) => c.id === clip.id);
                  if (index >= 0) a.clips[index] = clip;
                  else a.clips.push(clip);
                });
                setAnalysis(result);
                setSelected(clip.id);
                setDraft(null);
                setTab("clips");
              } catch (e) {
                fail(e);
              }
            }}
          />
        )}
      </div>
      {(notice || busy) && (
        <div className="notice-toast" role="status">
          <span>{busy ? "Working…" : notice}</span>
          {!busy && (
            <button title="Dismiss notification" onClick={() => setNotice("")}>
              <X size={14} />
            </button>
          )}
        </div>
      )}
      {captureSettings && (
        <Modal title="Quick capture" onClose={() => setCaptureSettings(false)}>
          <div className="modal-body">
            <p>
              Press 1–9 to capture a Clip in the matching Category without
              pausing. Manual marking with M stays independent.
            </p>
            <div className="capture-window">
              <label>
                Seconds before
                <input
                  aria-label="Seconds before"
                  type="number"
                  min="0"
                  max="120"
                  step="1"
                  value={captureWindow.before}
                  onChange={(e) => {
                    const before = Number(e.target.value);
                    if (Number.isFinite(before) && before >= 0 && before <= 120)
                      setCaptureWindow({ ...captureWindow, before });
                  }}
                />
              </label>
              <label>
                Seconds after
                <input
                  aria-label="Seconds after"
                  type="number"
                  min="0"
                  max="120"
                  step="1"
                  value={captureWindow.after}
                  onChange={(e) => {
                    const after = Number(e.target.value);
                    if (Number.isFinite(after) && after >= 0 && after <= 120)
                      setCaptureWindow({ ...captureWindow, after });
                  }}
                />
              </label>
            </div>
            {captureWindow.before + captureWindow.after === 0 && (
              <p className="inline-error" role="alert">
                Choose at least one second of context.
              </p>
            )}
            <div className="capture-key-list">
              {analysis.categories.map((category, index) => (
                <div key={category.id}>
                  <span
                    className="color-dot"
                    style={{ background: category.color }}
                  />
                  <span>{category.name}</span>
                  <kbd>{index < 9 ? index + 1 : "Tag menu"}</kbd>
                </div>
              ))}
            </div>
            <p className="muted">
              Clips are trimmed at the video boundaries. Category order
              determines the shortcuts. Settings are remembered on this device.
            </p>
            <button
              disabled={captureWindow.before + captureWindow.after === 0}
              onClick={() => setCaptureSettings(false)}
            >
              Done
            </button>
          </div>
        </Modal>
      )}
      {error && (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          <button title="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {!ready && !confirmation && (
        <div className="loading-shade">
          <span className="spinner" />
          Opening Analysis…
        </div>
      )}
      {confirmation && (
        <Modal title={confirmation.title}>
          <div className="modal-body">
            <p>{confirmation.text}</p>
          </div>
          <div className="modal-footer">
            {confirmation.choices.map((choice, i) => (
              <button
                key={choice}
                autoFocus={i === 0}
                className={i === 0 ? "primary" : ""}
                onClick={() => {
                  confirmation.resolve(i);
                  setConfirmation(null);
                }}
              >
                {choice}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {categoryDialog && (
        <CategoryDialog
          initial={categoryDialog.categories}
          template={categoryDialog.template}
          onClose={() => setCategoryDialog(null)}
          onSave={async (categories) => {
            if (categoryDialog.template)
              await window.desktop.template(categories);
            else {
              setAnalysis(
                mutate(analysis, (a) => {
                  a.categories = categories;
                  a.clips.forEach((c) => {
                    if (!categories.some((t) => t.id === c.category_id))
                      c.category_id = null;
                  });
                }),
              );
              setDraft((current) =>
                current &&
                current.category_id &&
                !categories.some((c) => c.id === current.category_id)
                  ? { ...current, category_id: null }
                  : current,
              );
            }
            setCategoryDialog(null);
          }}
        />
      )}
      {exportClips && (
        <ExportDialog
          analysis={analysis}
          initial={exportClips}
          progress={progress}
          running={exporting}
          onExport={(options) => void startExport(options)}
          onCancel={() => void window.desktop.cancelExport()}
          onClose={() => setExportClips(null)}
        />
      )}
      {rename && (
        <Modal title="Rename Source video" onClose={() => setRename(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (rename.display_name.trim()) {
                change((a) => {
                  a.source_videos = a.source_videos.map((s) =>
                    s.id === rename.id ? rename : s,
                  );
                });
                setRename(null);
              }
            }}
          >
            <div className="modal-body">
              <label>
                Display name
                <input
                  autoFocus
                  required
                  value={rename.display_name}
                  onChange={(e) =>
                    setRename({ ...rename, display_name: e.target.value })
                  }
                />
              </label>
            </div>
            <div className="modal-footer">
              <button type="button" onClick={() => setRename(null)}>
                Cancel
              </button>
              <button className="primary">Rename</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
