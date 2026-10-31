import { handballLabel } from "./reports";
import { t, useLanguage } from "./i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { Settings } from "./Settings";
import { emptyHistory, recordEdit, travelHistory } from "./history";
import { PlayerExports } from "./PlayerExports";
import { syncRosterTag } from "./roster";
import { ProjectLibrary } from "./ProjectLibrary";
import { ProjectSetup } from "./ProjectSetup";
import { UpdateNotice } from "./UpdateNotice";
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
  CircleHelp,
  Sun,
  Moon,
  Monitor,
  Undo2,
  Redo2,
} from "lucide-react";
import {
  defaults,
  categoryShortcut,
  categoryLabel,
  clipCategoryIds,
  clipCategoryLabels,
  withClipCategories,
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
  type FreezeFrame,
} from "./domain";
import type { ExportOptions, Loaded, Progress, Media } from "./api";
import { AnnotationEditor } from "./AnnotationEditor";
import { Player, type PlayerHandle } from "./Player";
import { ClipEditor } from "./ClipEditor";
import { Select } from "./Select";
import { Playlists } from "./Playlists";
import { HandballPanel } from "./HandballPanel";
import { HandballFields } from "./HandballFields";
import { BatchHandball } from "./BatchHandball";
import { WelcomeTour, type WorkspaceTab } from "./WelcomeTour";
import { useTheme } from "./theme";
import {
  handballSearchText,
  mergeHandballTag,
  type HandballTag,
} from "./handball";
import { CategoryDialog, ExportDialog, Modal } from "./Dialogs";
type Confirm = {
  title: string;
  text: string;
  choices: string[];
  resolve(value: number): void;
};
export function App() {
  const { language } = useLanguage();
  const [theme, setTheme] = useTheme();
  const history = useRef(emptyHistory());
  const [playerExportClips, setPlayerExportClips] = useState<Clip[] | null>(
    null,
  );
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tourSeen, setTourSeen] = useState(() => {
    try {
      return localStorage.getItem("tacticut-tour-seen") === "yes";
    } catch {
      return false;
    }
  });
  const [tourFrom, setTourFrom] = useState<WorkspaceTab | null>(null);
  const [annotationSession, setAnnotationSession] = useState<{
    clip: Clip;
    time: number;
    media: Media;
  } | null>(null);
  const [captureSettings, setCaptureSettings] = useState(false);
  const [batchTags, setBatchTags] = useState(false);
  const [captureContext, setCaptureContext] = useState<
    HandballTag | undefined
  >();
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
  const [jumpSeconds, setJumpSeconds] = useState(() => {
    try {
      const n = Number(localStorage.getItem("navigation-jump"));
      if (Number.isFinite(n) && n >= 1 && n <= 120) return n;
    } catch {}
    return 5;
  });
  useEffect(() => {
    try {
      localStorage.setItem("navigation-jump", String(jumpSeconds));
    } catch {}
  }, [jumpSeconds]);
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
  const [tab, setTab] = useState<"clips" | "videos" | "playlists" | "handball">(
      "clips",
    ),
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
    freezeFrames: FreezeFrame[];
  };
  const [queue, setQueue] = useState<Queue | null>(null);
  const queueRef = useRef(queue),
    queueToken = useRef(0);
  queueRef.current = queue;
  const sequence = useMemo(
    () =>
      queue
        ? {
            token: queue.token,
            clip: queue.clips[queue.index],
            freezeFrames: queue.freezeFrames,
          }
        : null,
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
        t(
          "Finish or cancel the current Clip capture before playing a playlist.",
        ),
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
      freezeFrames: analysis.freeze_frames,
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
      setNotice(
        current.playlistId === "clip-review"
          ? t("Clip review finished")
          : t("Playlist finished"),
      );
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
    setError(t(e instanceof Error ? e.message : String(e)));
  const confirm = (title: string, text: string, choices: string[]) =>
    new Promise<number>((resolve) =>
      setConfirmation({ title, text, choices, resolve }),
    );
  function commitAnalysis(next: Analysis, label?: string) {
    history.current = recordEdit(
      history.current,
      latest.current.analysis,
      next,
      label,
    );
    latest.current = {
      ...latest.current,
      analysis: next,
      serialized: JSON.stringify(next),
      dirty: true,
    };
    setAnalysis(next);
  }
  function travel(direction: "undo" | "redo") {
    if (draft || pending !== null || busy) return;
    const result = travelHistory(
      history.current,
      latest.current.analysis,
      direction,
    );
    if (!result) return;
    stopPlaylist();
    player.current?.stopPreview();
    player.current?.pause();
    history.current = result.history;
    const next = result.document;
    latest.current = {
      ...latest.current,
      analysis: next,
      serialized: JSON.stringify(next),
    };
    setAnalysis(next);
    setActive((id) =>
      next.source_videos.some((s) => s.id === id)
        ? id
        : next.source_videos[0]?.id || null,
    );
    setSelected((id) => (next.clips.some((c) => c.id === id) ? id : null));
    setPlaylistId((id) =>
      next.playlists.some((p) => p.id === id) ? id : null,
    );
    setNotice(
      t(direction === "undo" ? "Undid {edit}" : "Redid {edit}", {
        edit: t(result.label),
      }),
    );
  }
  const change = (fn: (a: Analysis) => void) => {
    stopPlaylist();
    try {
      commitAnalysis(mutate(latest.current.analysis, fn));
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
    history.current = emptyHistory();
    setAnalysis(data.analysis);
    setFile(data.path);
    setStamp(data.stamp);
    setLegacyPath(data.legacyPath || null);
    setSaved(unsaved || data.legacyPath ? "" : JSON.stringify(data.analysis));
    if (data.legacyPath)
      setNotice(
        t(
          "Legacy Analysis imported. Save to a new JSON Analysis file to complete conversion.",
        ),
      );
    setActive(data.analysis.source_videos[0]?.id || null);
    setSelected(null);
    setChecked([]);
    setSelecting(false);
    setDraft(null);
    setBatchTags(false);
    setPending(null);
    setQuery("");
    setScope("all");
    setCaptureContext(undefined);
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
            t("Recover unsaved Analysis?"),
            t(
              "Unsaved changes to “{title}” were found from a previous session.",
              { title: recovered.analysis.title || t("Untitled Analysis") },
            ),
            [t("Restore Analysis"), t("Discard snapshot")],
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
    window.document.title = `${dirty ? "● " : ""}${analysis.title || t("Untitled Analysis")} — Tacticut`;
    clearRecoveryTimer();
    if (dirty)
      recoveryTimer.current = setTimeout(() => {
        void window.desktop.recovery(document()).catch(fail);
      }, 650);
    return clearRecoveryTimer;
  }, [serialized, dirty, ready, file, stamp, language]);
  useEffect(() => window.desktop.onProgress(setProgress), []);
  useEffect(() => {
    if (
      tourFrom !== null ||
      playerExportClips ||
      projectsOpen ||
      settingsOpen ||
      setupOpen ||
      confirmation ||
      categoryDialog ||
      exportClips ||
      batchTags ||
      captureSettings ||
      playlistModal ||
      annotationSession ||
      rename
    )
      stopPlaylist();
  }, [
    tourFrom,
    playerExportClips,
    projectsOpen,
    settingsOpen,
    setupOpen,
    confirmation,
    categoryDialog,
    exportClips,
    captureSettings,
    batchTags,
    playlistModal,
    annotationSession,
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
      setNotice(t("Analysis saved"));
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  }
  async function mayLeave(): Promise<boolean> {
    if (draft || pending != null) {
      const answer = await confirm(
        t("Discard unfinished Clip?"),
        t(
          "The current Clip draft or pending boundary has not been added to the Analysis.",
        ),
        [t("Keep editing"), t("Discard unfinished Clip")],
      );
      if (answer !== 1) return false;
    }
    if (!latest.current.dirty) return true;
    const answer = await confirm(
      t("Save Analysis changes?"),
      t("Save your changes before leaving this Analysis."),
      [t("Save"), t("Discard changes"), t("Cancel")],
    );
    if (answer === 2) return false;
    return answer === 0 ? save() : true;
  }
  async function switchSource(id: string, ms = 0): Promise<boolean> {
    stopPlaylist();
    if ((draft || pending != null) && id !== active) {
      if (
        (await confirm(
          t("Switch Source video?"),
          t(
            "Switching discards the unfinished Clip on the active Source video.",
          ),
          [t("Keep editing"), t("Switch video")],
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
    commitAnalysis(result);
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
        t("Discard Clip draft?"),
        t("The edits in the current Clip draft have not been saved."),
        [t("Keep editing"), t("Discard draft")],
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
        new Error(t("Move the playhead after the Clip start to mark its end.")),
      );
    else {
      player.current?.pause();
      setDraft({
        id: crypto.randomUUID(),
        source_video_id: source.id,
        name: t("Clip {count}", { count: analysis.clips.length + 1 }),
        start_ms: pending,
        end_ms: now,
        category_id: null,
        notes: "",
        creation_order: analysis.clips.length,
        ...(captureContext ? { handball: { ...captureContext } } : {}),
      });
      setPending(null);
    }
  }
  function tagPlay() {
    if (!source || draft || busy || queueRef.current || pending !== null)
      return;
    const capture = player.current?.capturePosition();
    if (!capture) return;
    try {
      player.current?.pause();
      setDraft({
        id: crypto.randomUUID(),
        source_video_id: source.id,
        name: t("Clip {count}", { count: analysis.clips.length + 1 }),
        ...captureRange(
          capture.position,
          Math.min(capture.duration, source.duration_ms ?? capture.duration),
          captureWindow.before * 1000,
          captureWindow.after * 1000,
        ),
        category_id: null,
        notes: "",
        creation_order: analysis.clips.length,
        ...(captureContext ? { handball: { ...captureContext } } : {}),
      });
    } catch (error) {
      fail(error);
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
        ...(captureContext ? { handball: { ...captureContext } } : {}),
      };
      change((a) => a.clips.push(clip));
      setTab("clips");
      setSelected(clip.id);
      setNotice(
        `${t("Captured {name}", { name: category.name })} · ${timecode(clip.start_ms, false)}–${timecode(clip.end_ms, false)}${captureContext ? ` · ${[captureContext.team, captureContext.player].filter(Boolean).join(" / ") || t("Handball context applied")}` : ""}`,
      );
    } catch (e) {
      fail(e);
    }
  }
  function showExport() {
    stopPlaylist();
    const ids = checked.length ? checked : analysis.clips.map((c) => c.id);
    if (!ids.length) {
      setNotice(t("Create a Clip before exporting"));
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
  function startTour() {
    if (
      !ready ||
      busy ||
      draft ||
      pending !== null ||
      playerExportClips ||
      projectsOpen ||
      settingsOpen ||
      setupOpen ||
      confirmation ||
      categoryDialog ||
      exportClips ||
      batchTags ||
      captureSettings ||
      playlistModal ||
      annotationSession ||
      rename
    )
      return;
    stopPlaylist();
    player.current?.stopPreview();
    player.current?.pause();
    setTourFrom(tab);
  }
  function closeTour() {
    if (tourFrom !== null) setTab(tourFrom);
    setTourFrom(null);
    setTourSeen(true);
    try {
      localStorage.setItem("tacticut-tour-seen", "yes");
    } catch {}
  }
  async function command(name: string) {
    if (annotationSession && (name === "undo" || name === "redo")) return;
    if (
      (name === "undo" || name === "redo") &&
      window.document.activeElement?.closest(
        "input,textarea,[contenteditable=true]",
      )
    ) {
      window.document.execCommand(name);
      return;
    }
    if (
      name === "theme-light" ||
      name === "theme-dark" ||
      name === "theme-system"
    ) {
      setTheme(name.slice(6) as "light" | "dark" | "system");
      return;
    }

    if (
      !ready ||
      operation.current ||
      tourFrom !== null ||
      playerExportClips ||
      projectsOpen ||
      settingsOpen ||
      setupOpen ||
      confirmation ||
      categoryDialog ||
      rename ||
      exportClips ||
      playlistModal ||
      annotationSession ||
      batchTags ||
      captureSettings
    )
      return;
    if (name === "settings") {
      setSettingsOpen(true);
      return;
    }
    if (name === "projects") {
      setProjectsOpen(true);
      return;
    }
    if (name === "setup") {
      setSetupOpen(true);
      return;
    }
    if (name === "undo" || name === "redo") {
      travel(name);
      return;
    }
    if (name === "tour") {
      startTour();
      return;
    }
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
      else if (name === "open-file") {
        // Read first: without a file waiting there is nothing to ask about.
        const data = await window.desktop.openPending();
        if (!data || !(await mayLeave())) return;
        clearRecoveryTimer();
        await window.desktop.recovery(null);
        replace(data);
      } else if (["new", "open", "close", "restart-update"].includes(name)) {
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
        if (name === "close" || name === "restart-update") {
          clearRecoveryTimer();
          await window.desktop.recovery(null);
          if (name === "close") window.desktop.close();
          else await window.desktop.updates?.restart();
        }
      }
    });
  }
  const commandRef = useRef(command);
  commandRef.current = command;
  // A double-clicked Analysis that launched the app opens once start-up (and any recovery) is done.
  useEffect(() => {
    if (ready) void commandRef.current("open-file");
  }, [ready]);
  useEffect(
    () => window.desktop.onCommand((name) => void commandRef.current(name)),
    [],
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        tourFrom !== null ||
        !!draft ||
        busy ||
        !ready ||
        playerExportClips ||
        projectsOpen ||
        settingsOpen ||
        setupOpen ||
        confirmation ||
        categoryDialog ||
        exportClips ||
        rename ||
        batchTags ||
        captureSettings ||
        playlistModal ||
        annotationSession ||
        (e.target instanceof Element &&
          e.target.closest(
            "input,textarea,select,[role=dialog],[role=combobox],[data-popup],[contenteditable=true]",
          ))
      )
        return;
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        (e.key.toLowerCase() === "z" ||
          (!e.metaKey && e.key.toLowerCase() === "y"))
      ) {
        e.preventDefault();
        if (!e.repeat)
          travel(e.shiftKey || e.key.toLowerCase() === "y" ? "redo" : "undo");
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!e.shiftKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        if (!e.repeat) {
          const category = analysis.categories.find(
            (c) => categoryShortcut(analysis.categories, c) === Number(e.key),
          );
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
        player.current?.scrub(d, e.shiftKey);
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        player.current?.changeSpeed(e.key === "ArrowUp" ? 1 : -1);
      }
      if (e.key.toLowerCase() === "t") {
        e.preventDefault();
        if (!e.repeat) tagPlay();
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
          `${c.name} ${c.notes} ${handballSearchText(c, language)} ${clipCategoryLabels(c, analysis.categories).join(" ")} ${analysis.source_videos.find((s) => s.id === c.source_video_id)?.display_name}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [analysis, query, scope, active, language],
  );
  const groups = useMemo(
    () =>
      sort === "category"
        ? [
            ...analysis.categories.map((c) => ({
              id: c.id,
              name: categoryLabel(c),
              color: c.color,
              clips: exportOrder(
                analysis,
                visible.filter((t) => t.category_id === c.id).map((t) => t.id),
              ),
            })),
            {
              id: "",
              name: t("Uncategorized"),
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
              name: t(sort === "time" ? "By start time" : "Creation order"),
              color: "#808080",
              clips: [...visible].sort((a, b) =>
                sort === "time"
                  ? a.start_ms - b.start_ms
                  : a.creation_order - b.creation_order,
              ),
            },
          ],
    [analysis, visible, sort, language],
  );
  async function removeSource(s: SourceVideo) {
    const count = analysis.clips.filter(
      (c) => c.source_video_id === s.id,
    ).length;
    if (
      (await confirm(
        t("Remove Source video?"),
        t(
          "Remove “{name}” and its {count} Clips from the Analysis? The video file stays on disk.",
          { name: s.display_name, count },
        ),
        [t("Cancel"), t("Remove")],
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
    setProgress({ percent: 0, message: t("Preparing export") });
    try {
      const path = await window.desktop.export(document(), options);
      if (path) {
        setNotice(t("Export saved: {path}", { path }));
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
        if (
          tourFrom === null &&
          !busy &&
          ready &&
          !playerExportClips &&
          !projectsOpen &&
          !settingsOpen &&
          !setupOpen &&
          !categoryDialog &&
          !batchTags &&
          !captureSettings &&
          !rename &&
          !confirmation &&
          !exportClips &&
          !annotationSession &&
          !playlistModal
        ) {
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
      <header
        className={`toolbar platform-${window.desktop.platform}`}
        inert={tourFrom !== null}
        aria-hidden={tourFrom !== null || undefined}
      >
        <input
          data-tour="project"
          className="analysis-title"
          aria-label={t("Analysis title")}
          placeholder={t("Untitled Analysis")}
          value={analysis.title}
          disabled={!ready || busy}
          onChange={(e) =>
            change((a) => {
              a.title = e.target.value;
            })
          }
        />
        {dirty && <span className="dirty-dot" title={t("Unsaved changes")} />}
        <span className="grow" />
        <button
          data-tour="projects"
          title={t("Projects and collections")}
          disabled={busy || !ready}
          onClick={() => void command("projects")}
        >
          <FolderOpen size={16} />
          {t(" Projects")}
        </button>
        <button
          title={t("New Analysis")}
          onClick={() => void command("new")}
          disabled={busy || !ready}
        >
          <FilePlus2 size={16} />
        </button>
        <button
          title={t("Open Analysis")}
          onClick={() => void command("open")}
          disabled={busy || !ready}
        >
          <FolderOpen size={16} />
        </button>
        <button
          title={t("Save Analysis")}
          onClick={() => void command("save")}
          disabled={busy || !analysis.source_videos.length}
        >
          <Save size={16} />
        </button>
        <span className="divider" />
        <div className="history-controls" data-tour="history">
          <button
            aria-label={t("Undo project edit")}
            title={t("Undo {edit} (⌘/Ctrl+Z)", {
              edit: t(history.current.past.at(-1)?.label || "project edit"),
            })}
            disabled={
              busy ||
              !ready ||
              !!draft ||
              pending !== null ||
              !history.current.past.length
            }
            onClick={() => travel("undo")}
          >
            <Undo2 size={16} />
          </button>
          <button
            aria-label={t("Redo project edit")}
            title={t("Redo {edit} (⌘/Ctrl+Shift+Z)", {
              edit: t(history.current.future.at(-1)?.label || "project edit"),
            })}
            disabled={
              busy ||
              !ready ||
              !!draft ||
              pending !== null ||
              !history.current.future.length
            }
            onClick={() => travel("redo")}
          >
            <Redo2 size={16} />
          </button>
        </div>
        <button onClick={() => void command("add")} disabled={busy || !ready}>
          <Plus size={15} />
          {t("Add video")}
        </button>
        <button
          data-tour="export"
          className="export-button"
          onClick={showExport}
          disabled={!analysis.clips.length || busy}
        >
          <Download size={15} />
          {t("Export")}
          {checked.length ? ` (${checked.length})` : ""}
        </button>
        <div data-tour="project-setup">
          <Select
            label={t("Analysis actions")}
            value=""
            display="···"
            options={[
              { value: "save-as", label: t("Save Analysis as…") },
              {
                value: "setup",
                label: t("Project setup · roster & templates"),
              },
              { value: "categories", label: t("Manage Categories") },
              { value: "template", label: t("Category template") },
            ]}
            onChange={(action) => void command(action)}
            disabled={busy || !ready}
          />
        </div>
        <button
          title={t("Settings")}
          aria-label={t("Settings")}
          className="settings-command"
          data-tour="settings"
          disabled={busy || !ready || !!draft || pending !== null}
          onClick={() => void command("settings")}
        >
          <Settings2 size={17} />
        </button>
        <div data-tour="appearance" className="appearance-control">
          <Select
            label={t("Appearance")}
            value={theme}
            display={
              theme === "system" ? (
                <Monitor size={16} />
              ) : theme === "light" ? (
                <Sun size={16} />
              ) : (
                <Moon size={16} />
              )
            }
            options={[
              { value: "system", label: t("System appearance") },
              { value: "light", label: t("Light appearance") },
              { value: "dark", label: t("Dark appearance") },
            ]}
            onChange={(value) => setTheme(value as "system" | "light" | "dark")}
          />
        </div>
        <button
          title={t("Welcome tour")}
          aria-label={t("Welcome tour")}
          disabled={
            !ready ||
            busy ||
            !!draft ||
            pending !== null ||
            !!annotationSession ||
            !!exportClips ||
            !!categoryDialog ||
            captureSettings ||
            batchTags ||
            playlistModal ||
            !!rename ||
            !!confirmation ||
            projectsOpen ||
            settingsOpen ||
            setupOpen ||
            !!playerExportClips
          }
          onClick={startTour}
        >
          <CircleHelp size={17} />
        </button>
        {window.desktop.platform !== "darwin" && (
          <div className="window-controls">
            <button
              title={t("Minimize window")}
              onClick={() => window.desktop.windowControl("minimize")}
            >
              −
            </button>
            <button
              title={t("Maximize or restore window")}
              onClick={() => window.desktop.windowControl("maximize")}
            >
              □
            </button>
            <button
              title={t("Close window")}
              onClick={() => window.desktop.windowControl("close")}
            >
              <X size={15} />
            </button>
          </div>
        )}
      </header>
      <div
        className="workspace"
        inert={tourFrom !== null}
        aria-hidden={tourFrom !== null || undefined}
      >
        <aside className="sidebar" data-tour="sidebar">
          <nav className="sidebar-tabs">
            <button
              className={tab === "clips" ? "active" : ""}
              onClick={() => setTab("clips")}
            >
              {t("Clips ")}
              <span>{analysis.clips.length}</span>
            </button>
            <button
              className={tab === "videos" ? "active" : ""}
              onClick={() => setTab("videos")}
            >
              {t("Videos ")}
              <span>{analysis.source_videos.length}</span>
            </button>
            <button
              data-tour="categories"
              title={t("Manage Categories")}
              className="settings-button"
              onClick={() => void command("categories")}
            >
              <Settings2 size={15} />
            </button>
            <button
              className={tab === "playlists" ? "active" : ""}
              onClick={() => setTab("playlists")}
            >
              {t("Playlists")}
            </button>
            <button
              className={tab === "handball" ? "active" : ""}
              onClick={() => setTab("handball")}
            >
              {t("Handball")}
            </button>
          </nav>
          {tab === "clips" ? (
            <>
              <div className="sidebar-filters">
                <div className="search">
                  <Search size={14} />
                  <input
                    aria-label={t("Search Clips")}
                    placeholder={t("Search Clips and notes…")}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <button
                      title={t("Clear search")}
                      onClick={() => setQuery("")}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                <div className="row">
                  <Select
                    label={t("Clip scope")}
                    value={scope}
                    onChange={setScope}
                    options={[
                      { value: "all", label: t("All videos") },
                      { value: "active", label: t("Active video") },
                    ]}
                  />
                  <Select
                    label={t("Clip sort")}
                    value={sort}
                    onChange={setSort}
                    options={[
                      { value: "category", label: t("By Category") },
                      { value: "time", label: t("By start time") },
                      { value: "creation", label: t("Creation order") },
                    ]}
                  />
                </div>
              </div>
              <div className="clip-list">
                {!analysis.clips.length && (
                  <div className="sidebar-empty">
                    <Scissors size={24} />
                    <p>{t("No Clips yet")}</p>
                    <small>
                      {t("Press ")}
                      <kbd>{t("M")}</kbd>
                      {t(" to mark a start,")}
                      <br />
                      {t("then again to mark the end.")}
                    </small>
                  </div>
                )}
                {!!analysis.clips.length && !visible.length && (
                  <p className="sidebar-empty">{t("No matching Clips")}</p>
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
                                  aria-label={t("Select {name} for export", {
                                    name: c.name,
                                  })}
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
                                {clipCategoryIds(c).length > 1 && (
                                  <small className="clip-extra-tags">
                                    {clipCategoryLabels(
                                      c,
                                      analysis.categories,
                                    ).join(" · ")}
                                  </small>
                                )}
                                {c.handball && (
                                  <small>
                                    {[
                                      c.handball.team,
                                      c.handball.player,
                                      c.handball.outcome
                                        ? t(
                                            handballLabel(
                                              "outcome",
                                              c.handball.outcome,
                                            ),
                                          )
                                        : undefined,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </small>
                                )}
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
                                title={t("Edit {name}", { name: c.name })}
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
                    <span className="muted">
                      {visible.length}
                      {t(" Clips")}
                    </span>
                    <button
                      disabled={!analysis.clips.length}
                      onClick={() => setSelecting(true)}
                    >
                      {t("Select clips")}
                    </button>
                  </>
                ) : (
                  <>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        aria-label={t("Select all visible Clips")}
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
                        ? t("{count} selected", { count: checked.length })
                        : t("Select all")}
                    </label>
                    <Select
                      label={t("Add selected Clips to playlist")}
                      display={<ListPlus size={15} />}
                      value=""
                      disabled={!checked.length}
                      options={[
                        {
                          value: "new",
                          label: t("New playlist from selection"),
                        },
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
                              name: t("Playlist {count}", {
                                count: a.playlists.length + 1,
                              }),
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
                      title={t("Tag selected Clips")}
                      disabled={!checked.length || !!draft || pending !== null}
                      onClick={() => setBatchTags(true)}
                    >
                      {t("Tag")}
                    </button>
                    <button
                      title={t("Delete selected Clips")}
                      disabled={!checked.length}
                      onClick={() =>
                        void run(async () => {
                          if (
                            (await confirm(
                              t("Delete selected Clips?"),
                              t("Delete {count} Clips from the Analysis?", {
                                count: checked.length,
                              }),
                              [t("Cancel"), t("Delete Clips")],
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
                      {t("Done")}
                    </button>
                  </>
                )}
              </div>
            </>
          ) : tab === "handball" ? (
            <HandballPanel
              key={analysis.id}
              analysis={analysis}
              canReview={!draft && pending === null && !busy && ready}
              onViews={(views) =>
                change((a) => {
                  if (views.length) a.handball_views = views;
                  else delete a.handball_views;
                })
              }
              onReview={(clips) =>
                playPlaylist({
                  id: "filtered-review",
                  name: t("Filtered review"),
                  clip_ids: clips.map((c) => c.id),
                })
              }
              onPlayerExports={(clips) => setPlayerExportClips(clips)}
              onPlayerReviews={(groups) => {
                const playlists = groups.map((g) => ({
                  id: crypto.randomUUID(),
                  name: g.name,
                  clip_ids: g.clips.map((c) => c.id),
                }));
                change((a) => a.playlists.push(...playlists));
                setPlaylistId(playlists[0]?.id || null);
                setTab("playlists");
                setNotice(
                  t("Created {count} player review playlists", {
                    count: playlists.length,
                  }),
                );
              }}
              onReport={(clips, format) =>
                void run(async () => {
                  if (!window.desktop.report)
                    throw new Error(
                      t(
                        "Reports are unavailable. Restart the updated desktop app.",
                      ),
                    );
                  const path = await window.desktop.report(
                    document(),
                    clips.map((c) => c.id),
                    format,
                  );
                  if (path)
                    setNotice(
                      t("Saved {format} report · {path}", {
                        format: format.toUpperCase(),
                        path,
                      }),
                    );
                })
              }
              onSelect={(clip) => void editClip(clip)}
              onPlaylist={(name, clips) => {
                const id = crypto.randomUUID();
                change((a) =>
                  a.playlists.push({
                    id,
                    name: name.slice(0, 120),
                    clip_ids: clips.map((c) => c.id),
                  }),
                );
                setPlaylistId(id);
                setTab("playlists");
                setNotice(
                  t("Created {name} with {count} Clips", {
                    name,
                    count: clips.length,
                  }),
                );
              }}
              onExport={(clips) => {
                stopPlaylist();
                setExportClips(clips);
              }}
            />
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
                            : t("Duration unknown")}{" "}
                          ·{" "}
                          {
                            analysis.clips.filter(
                              (c) => c.source_video_id === s.id,
                            ).length
                          }{" "}
                          {t("Clips")}
                        </small>
                      </span>
                      {active === s.id && <Check size={14} />}
                    </button>
                    <div className="source-actions">
                      <button
                        title={t("Rename Source video")}
                        onClick={() => setRename({ ...s })}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        title={t("Relink Source video")}
                        onClick={() => void run(() => relink(s))}
                      >
                        <Link size={13} />
                      </button>
                      <button
                        title={t("Move video earlier")}
                        disabled={!i}
                        onClick={() => moveSource(i, -1)}
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        title={t("Move video later")}
                        disabled={i === analysis.source_videos.length - 1}
                        onClick={() => moveSource(i, 1)}
                      >
                        <ArrowDown size={13} />
                      </button>
                      <button
                        title={t("Remove Source video")}
                        onClick={() => void run(() => removeSource(s))}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
                {!analysis.source_videos.length && (
                  <p className="sidebar-empty">
                    {t("Source videos appear here.")}
                  </p>
                )}
              </div>
              <div className="sidebar-footer">
                <button onClick={() => void command("add")}>
                  <Plus size={14} />
                  {t("Add Source video")}
                </button>
              </div>
            </>
          )}
        </aside>
        <Player
          ref={player}
          sequence={sequence}
          jumpSeconds={jumpSeconds}
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
          onAnnotate={(clip, time, media) => {
            stopPlaylist();
            player.current?.stopPreview();
            setAnnotationSession({ clip, time, media });
          }}
          onReview={(clip) =>
            playPlaylist({
              id: "clip-review",
              name: clip.name,
              clip_ids: [clip.id],
            })
          }
          onMark={mark}
          captureDisabled={!!draft || !!queue}
          onTagPlay={tagPlay}
          onQuickTag={quickTag}
          onCaptureSettings={() => setCaptureSettings(true)}
          onAdd={() => void command("add")}
          onOpen={() => void command("open")}
          onTour={startTour}
          tourSeen={tourSeen}
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
            source={analysis.source_videos.find(
              (s) => s.id === draft.source_video_id,
            )}
            documentPath={file}
            categories={analysis.categories}
            clips={analysis.clips}
            roster={analysis.roster}
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
                commitAnalysis(result);
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
      {settingsOpen && (
        <Settings
          theme={theme}
          onTheme={setTheme}
          capture={captureWindow}
          onCapture={setCaptureWindow}
          jump={jumpSeconds}
          onJump={setJumpSeconds}
          onClose={() => setSettingsOpen(false)}
          onTour={() => {
            setSettingsOpen(false);
            stopPlaylist();
            player.current?.pause();
            setTourFrom(tab);
          }}
        />
      )}
      {playerExportClips && (
        <PlayerExports
          clips={playerExportClips}
          running={exporting}
          progress={progress}
          onClose={() => setPlayerExportClips(null)}
          onCancel={() => void window.desktop.cancelExport()}
          onExport={(options) =>
            void run(async () => {
              if (!window.desktop.playerExports)
                throw new Error(
                  t("Restart the updated app to export player videos."),
                );
              setExporting(true);
              setProgress({
                percent: 0,
                message: t("Preparing player videos"),
              });
              try {
                const result = await window.desktop.playerExports(
                  document(),
                  options,
                );
                if (result) {
                  setNotice(
                    t(
                      "{status}: {completed}/{total} player videos · {directory}",
                      {
                        status: t(result.cancelled ? "Stopped" : "Finished"),
                        completed: result.completed,
                        total: result.total,
                        directory: result.directory,
                      },
                    ),
                  );
                  setPlayerExportClips(null);
                }
              } finally {
                setExporting(false);
              }
            })
          }
        />
      )}
      {projectsOpen && (
        <ProjectLibrary
          onClose={() => setProjectsOpen(false)}
          onOpen={async (path) => {
            let done = false;
            await run(async () => {
              if (!(await mayLeave())) return;
              const data = await window.desktop.openProject!(path);
              clearRecoveryTimer();
              await window.desktop.recovery(null);
              replace(data);
              done = true;
            });
            return done;
          }}
          onCollection={async (paths, title) => {
            let done = false;
            await run(async () => {
              if (!(await mayLeave())) return;
              const data = await window.desktop.createCollection!(paths, title);
              clearRecoveryTimer();
              await window.desktop.recovery(null);
              replace(data, true);
              setTab("handball");
              done = true;
              setNotice(
                t(
                  "Collection created. Save it as a new project; the original projects stay unchanged.",
                ),
              );
            });
            return done;
          }}
        />
      )}
      {setupOpen && (
        <ProjectSetup
          analysis={analysis}
          onClose={() => setSetupOpen(false)}
          onSave={(next) => {
            commitAnalysis(next, "project setup");
            setCaptureContext((context) =>
              syncRosterTag(context, next.roster || { teams: [], players: [] }),
            );
            setSetupOpen(false);
          }}
        />
      )}
      {tourFrom !== null && (
        <WelcomeTour onNavigate={setTab} onClose={closeTour} />
      )}
      <UpdateNotice
        updates={window.desktop.updates}
        onRestart={() => command("restart-update")}
      />
      {(notice || busy) && (
        <div className="notice-toast" role="status">
          <span>{busy ? t("Working…") : notice}</span>
          {!busy && (
            <button
              title={t("Dismiss notification")}
              onClick={() => setNotice("")}
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}
      {annotationSession && (
        <AnnotationEditor
          clip={annotationSession.clip}
          media={annotationSession.media}
          time={annotationSession.time}
          initial={analysis.freeze_frames.filter(
            (f) => f.clip_id === annotationSession.clip.id,
          )}
          onClose={() => setAnnotationSession(null)}
          onSave={(frames) => {
            try {
              const updated = mutate(latest.current.analysis, (a) => {
                a.freeze_frames = [
                  ...a.freeze_frames.filter(
                    (f) => f.clip_id !== annotationSession.clip.id,
                  ),
                  ...frames,
                ];
              });
              commitAnalysis(updated);
              setAnnotationSession(null);
              setNotice(
                t(
                  "Freeze-frames saved to Analysis; save the file to keep your changes.",
                ),
              );
            } catch (e) {
              fail(e);
            }
          }}
        />
      )}
      {batchTags && (
        <BatchHandball
          roster={analysis.roster}
          clips={analysis.clips.filter((c) => checked.includes(c.id))}
          onCancel={() => setBatchTags(false)}
          onApply={(tag, clear) => {
            change((a) => {
              for (const clip of a.clips)
                if (checked.includes(clip.id)) {
                  if (clear) delete clip.handball;
                  else
                    clip.handball = mergeHandballTag(clip.handball, tag || {});
                }
            });
            setBatchTags(false);
            setNotice(t("Updated {count} Clips", { count: checked.length }));
          }}
        />
      )}
      {captureSettings && (
        <Modal
          title={t("Quick capture")}
          onClose={() => setCaptureSettings(false)}
        >
          <div className="modal-body">
            <p>
              {t(
                "Press 1–9 to capture a Clip in the matching Category without pausing. Manual marking with M stays independent.",
              )}
            </p>
            <div
              className="capture-presets"
              role="group"
              aria-label={t("Capture presets")}
            >
              {[
                { name: "Short", before: 4, after: 2 },
                { name: "Play", before: 8, after: 3 },
                { name: "Possession", before: 20, after: 5 },
              ].map((p) => (
                <button
                  key={p.name}
                  aria-pressed={
                    captureWindow.before === p.before &&
                    captureWindow.after === p.after
                  }
                  onClick={() =>
                    setCaptureWindow({ before: p.before, after: p.after })
                  }
                >
                  {t(p.name)}
                  <small>
                    {p.before}
                    {t("s before · ")}
                    {p.after}
                    {t("s after")}
                  </small>
                </button>
              ))}
            </div>
            <div className="capture-window">
              <label>
                {t("Seconds before")}
                <input
                  aria-label={t("Seconds before")}
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
                {t("Seconds after")}
                <input
                  aria-label={t("Seconds after")}
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
            <details className="navigation-settings">
              <summary>{t("Navigation settings")}</summary>
              <label>
                {t("Jump interval (seconds)")}
                <input
                  aria-label={t("Jump interval (seconds)")}
                  type="number"
                  min={1}
                  max={120}
                  step={1}
                  value={jumpSeconds}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isInteger(n) && n >= 1 && n <= 120)
                      setJumpSeconds(n);
                  }}
                />
              </label>
              <p className="muted">
                {t(
                  "Used by the back/forward buttons and Shift + arrow keys. Remembered on this device.",
                )}
              </p>
            </details>
            {captureWindow.before + captureWindow.after === 0 && (
              <p className="inline-error" role="alert">
                {t("Choose at least one second of context.")}
              </p>
            )}
            <details className="handball-tags">
              <summary>
                {t("Handball capture context")}
                {captureContext ? t(" · active") : ""}
              </summary>
              <p className="muted">
                {t(
                  "Applied to new quick captures and manually marked Clips in this Analysis. Record each outcome in the Clip editor.",
                )}
              </p>
              <HandballFields
                roster={analysis.roster}
                contextOnly
                value={captureContext}
                clips={analysis.clips}
                onChange={setCaptureContext}
              />
            </details>
            <div className="capture-key-list">
              {analysis.categories.map((category, index) => (
                <div key={category.id}>
                  <span
                    className="color-dot"
                    style={{ background: category.color }}
                  />
                  <span>{categoryLabel(category)}</span>
                  <kbd>
                    {categoryShortcut(analysis.categories, category) ||
                      t("Tag menu")}
                  </kbd>
                </div>
              ))}
            </div>
            <p className="muted">
              {t(
                "Clips are trimmed at the video boundaries. Manage Categories assigns shortcut keys. Timing settings are remembered on this device.",
              )}
            </p>
            <button
              disabled={captureWindow.before + captureWindow.after === 0}
              onClick={() => setCaptureSettings(false)}
            >
              {t("Done")}
            </button>
          </div>
        </Modal>
      )}
      {error && (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          <button title={t("Dismiss error")} onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {!ready && !confirmation && (
        <div className="loading-shade">
          <span className="spinner" />
          {t("Opening Analysis…")}
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
              commitAnalysis(
                mutate(analysis, (a) => {
                  a.categories = categories;
                  for (const view of a.handball_views || []) {
                    if (!view.category_ids) continue;
                    view.category_ids = view.category_ids.filter((id) =>
                      categories.some((c) => c.id === id),
                    );
                    if (!view.category_ids.length) delete view.category_ids;
                  }
                  a.clips = a.clips.map((clip) =>
                    withClipCategories(
                      clip,
                      clipCategoryIds(clip).filter((id) =>
                        categories.some((c) => c.id === id),
                      ),
                    ),
                  );
                }),
              );
              setDraft((current) =>
                current
                  ? withClipCategories(
                      current,
                      clipCategoryIds(current).filter((id) =>
                        categories.some((c) => c.id === id),
                      ),
                    )
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
        <Modal title={t("Rename Source video")} onClose={() => setRename(null)}>
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
                {t("Display name")}
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
                {t("Cancel")}
              </button>
              <button className="primary">{t("Rename")}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
