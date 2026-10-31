import { t, useLanguage } from "./i18n";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { Select } from "./Select";
export type WorkspaceTab = "clips" | "videos" | "playlists" | "handball";
type Step = {
  title: string;
  target: string;
  tab?: WorkspaceTab;
  reveal?: string;
  text: string;
  tip: string;
};
export const tourSteps: Step[] = [
  {
    title: "Your Analysis is your project",
    target: "project",
    text: "One Analysis keeps your videos, clips, categories, drawings, playlists and saved handball views together. Use New or Open to switch projects, and Save to keep a .tcut file.",
    tip: "Video files stay separate. Keep them with your project when moving it; use Videos → Relink if a file moves.",
  },
  {
    title: "Bring in match footage",
    target: "sidebar",
    tab: "videos",
    text: "Add video imports one or several recordings. You can also drop videos onto the workspace. The Videos tab switches sources and lets you rename, reorder, remove or relink them.",
    tip: "Use one Analysis for a match, opponent, training theme or a collection of recordings.",
  },
  {
    title: "Find the right moment",
    target: "transport",
    text: "Space plays or pauses. Left and Right scrub at the selected speed; Shift + arrow makes larger jumps at that speed. The frame buttons always move exactly one frame. Up and Down change playback speed from quarter speed through 8×.",
    tip: "The settings button beside Tag changes the jump interval. Fullscreen keeps the focus on the footage.",
  },
  {
    title: "Capture a clip",
    target: "capture",
    text: "Click Tag play or press T for a large tagging panel around the playhead. Select categories, players, outcome, court origin and goal target together. Save Clip applies the whole scene; Cancel discards the draft. M still marks an exact start and end.",
    tip: "For instant capture, press 1–9 or use Tag. Short, Play and Possession presets control the context before and after the playhead.",
  },
  {
    title: "Organize and edit clips",
    target: "sidebar",
    tab: "clips",
    text: "Search names, notes, categories and handball tags. Filter by active video or sort by time. Click a clip to seek to it; double-click or use its pencil to edit it.",
    tip: "Select clips enables batch tagging, deletion, playlist creation and export. Only filled batch-tag fields replace existing tags.",
  },
  {
    title: "Make categories your own",
    target: "categories",
    tab: "clips",
    text: "Categories are your coaching themes. Select several in Tag play to describe one scene. Optional groups organize them; 1–9 shortcuts quick-capture outside the panel and toggle choices inside it.",
    tip: "Analysis actions → Category template sets reusable categories for new projects. Changing a template does not rewrite existing projects.",
  },
  {
    title: "Code the handball context",
    target: "sidebar",
    tab: "handball",
    text: "The Tag play panel puts handball choices beside your categories. Pick a player, phase and result with buttons; click the court and goal map for shot locations. Clip timing & preview adjusts the range.",
    tip: "Capture context repeats team/player and tactical fields on new clips. Record each shot outcome individually so statistics remain meaningful.",
  },
  {
    title: "Turn tags into an analysis",
    target: "handball-filters",
    tab: "handball",
    text: "Combine coaching themes, team, player, keeper and tactical filters. Multiple themes match together on the same clip. Save view stores the filters, search and source in this project. Play matching reviews the results immediately; Create review playlist saves that selection.",
    tip: "Statistics count tagged clips, not official match totals. Conversion is goals/all recorded shots; save percentage is saves/(goals + saves). Duplicate clips count separately.",
  },
  {
    title: "Explore the shooting picture",
    target: "shot-maps",
    tab: "handball",
    reveal: "shot-maps",
    text: "Expand Shot maps to inspect shot origins and the nine goal targets. Each cell shows goals/shots. Click a position or target to filter its footage, and click again to clear it.",
    tip: "Goal targets use the shooter’s perspective. A position or target alone does not count as a shot; an explicit shot outcome is required.",
  },
  {
    title: "Reports and individual feedback",
    target: "reports",
    tab: "handball",
    reveal: "reports",
    text: "Export the matching selection as a PDF shooting report or a CSV table. Player reviews previews one playlist per attacking team/player. Export player videos renders one MP4 per player from the filtered result.",
    tip: "Clips without a player remain outside player playlists. These are snapshots of the current result, rather than filters that update themselves.",
  },
  {
    title: "Build your coaching sequence",
    target: "sidebar",
    tab: "playlists",
    text: "Create a named playlist, add existing clips, then reorder them into a clear coaching story. Play it across source videos or export it. A clip can belong to several playlists.",
    tip: "Removing a clip from a playlist keeps the original clip. Deleting the original removes its playlist references and saved drawings.",
  },
  {
    title: "Explain a decision on a frozen frame",
    target: "transport",
    text: "Select a clip, pause on an important frame and choose Annotate selected Clip. Draw arrows, circles, lines or text, choose a color and set a hold. Select a drawing to move, resize, recolor or delete it. New moment adds another freeze in the same clip.",
    tip: "Save freeze-frames commits the drawings. Clip review, playlists and exports include the holds; you can pause a hold or Continue now.",
  },
  {
    title: "Present and export",
    target: "export",
    text: "Export all clips, an explicit selection or a playlist. Reorder the export list and choose title/notes cards, clip numbers, audio and resolution. Presentation adds handball information and a silent half- or quarter-speed replay.",
    tip: "The original includes saved drawing holds; the replay shows the raw footage without repeated holds. You can cancel a running export.",
  },
  {
    title: "Language and appearance",
    target: "settings",
    text: "Settings changes the app language between German and English, the theme, capture timing and jump interval. Preferences stay on this device; your project names and notes stay as written.",
    tip: "Reopen this tour with the ? button or Help → Welcome tour. Save regularly; recovery snapshots also help protect unsaved work after an abnormal exit.",
  },
  {
    title: "Review across matches",
    target: "projects",
    text: "Projects lists saved and opened analyses. Browse adds existing files. Select two or more matches and Create collection to filter, report and present their clips together.",
    tip: "A collection is a separate snapshot. Save it under a new name; changes to its source projects do not update it automatically.",
  },
  {
    title: "Set up your team once",
    target: "project-setup",
    text: "Analysis actions → Project setup maintains teams, shirt numbers and players. Choose those identities from the roster when tagging. Renames keep linked clips together.",
    tip: "Reusable templates share your category groups, shortcuts and roster between projects. Export a template to share it with another coach.",
  },
  {
    title: "Edit with confidence",
    target: "history",
    text: "Undo and Redo cover committed project changes, including clips, tags, categories, playlists, sources and drawings. Use the toolbar, Edit menu or Command/Control + Z and Shift + Z.",
    tip: "Saving keeps history. Opening another project resets it. Text fields have their own undo, and the drawing editor has local history until you save its freeze-frames.",
  },
];
export function WelcomeTour({
  onNavigate,
  onClose,
}: {
  onNavigate(tab: WorkspaceTab): void;
  onClose(): void;
}) {
  useLanguage();
  const [index, setIndex] = useState(0);
  const step = tourSteps[index];
  const card = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    card.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        card.current?.querySelector('[role="listbox"]')
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      close.current();
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, []);

  const [box, setBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const restored = useRef(new Map<string, boolean>());
  const navigate = useRef(onNavigate);
  navigate.current = onNavigate;
  useLayoutEffect(() => {
    if (step.tab) navigate.current(step.tab);
    setBox(null);
  }, [index]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => {
      for (const [name, open] of restored.current) {
        const node = document.querySelector<HTMLDetailsElement>(
          `[data-tour="${name}"]`,
        );
        if (node) node.open = open;
      }
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    let frame = 0;
    const position = () => {
      const target = document.querySelector<HTMLElement>(
        `[data-tour="${step.target}"]`,
      );
      if (!target) {
        setBox(null);
        return;
      }
      const r = target.getBoundingClientRect();
      const left = Math.max(6, r.left - 5),
        top = Math.max(6, r.top - 5);
      const right = Math.min(window.innerWidth - 6, r.right + 5),
        bottom = Math.min(window.innerHeight - 6, r.bottom + 5);
      setBox(
        right > left && bottom > top
          ? { left, top, width: right - left, height: bottom - top }
          : null,
      );
    };
    frame = requestAnimationFrame(() => {
      if (step.reveal) {
        const detail = document.querySelector<HTMLDetailsElement>(
          `[data-tour="${step.reveal}"]`,
        );
        if (detail) {
          if (!restored.current.has(step.reveal))
            restored.current.set(step.reveal, detail.open);
          detail.open = true;
        }
      }
      document
        .querySelector(`[data-tour="${step.target}"]`)
        ?.scrollIntoView?.({ block: "nearest" });
      position();
      card.current?.focus();
    });
    window.addEventListener("resize", position);
    document.addEventListener("scroll", position, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", position);
      document.removeEventListener("scroll", position, true);
    };
  }, [index]);
  const wideTarget = box && box.width > window.innerWidth * 0.6;
  const left =
    box && !wideTarget && box.left + box.width + 410 < window.innerWidth
      ? box.left + box.width + 22
      : Math.max(16, window.innerWidth - 410);
  const top =
    box && box.top > window.innerHeight * 0.6
      ? 80
      : Math.max(76, Math.min(box?.top || 100, window.innerHeight - 450));
  return (
    <div
      className={`welcome-tour ${!box ? "without-target" : ""}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
        if (e.key === "Tab") {
          const controls = Array.from(
            card.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled),[tabindex="0"]',
            ) || [],
          );
          const first = controls[0],
            last = controls.at(-1);
          if (
            e.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === card.current)
          ) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      {box && <div className="tour-spotlight" style={box} />}
      <section
        ref={card}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-text"
        className="tour-card"
        style={{
          left,
          top,
          maxHeight: Math.max(200, window.innerHeight - top - 16),
        }}
      >
        <div className="tour-top">
          <span>{t("WELCOME TO TACTICUT")}</span>
          <button aria-label={t("Close welcome tour")} onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div
          className="tour-progress"
          aria-label={t("Step {value1} of {length}", {
            value1: index + 1,
            length: tourSteps.length,
          })}
        >
          <span
            style={{ width: `${((index + 1) / tourSteps.length) * 100}%` }}
          />
        </div>
        <Select
          label={t("Tour chapter")}
          value={String(index)}
          onChange={(v) => setIndex(Number(v))}
          options={tourSteps.map((s, i) => ({
            value: String(i),
            label: `${i + 1}. ${t(s.title)}`,
          }))}
        />
        <h2 id="tour-title">{t(step.title)}</h2>
        <p id="tour-text">{t(step.text)}</p>
        <p className="tour-tip">{t(step.tip)}</p>
        <div className="tour-footer">
          <button disabled={!index} onClick={() => setIndex(index - 1)}>
            <ArrowLeft size={14} /> {t(" Back")}
          </button>
          <span>
            {index + 1} / {tourSteps.length}
          </span>
          <button
            className="primary"
            onClick={() =>
              index === tourSteps.length - 1 ? onClose() : setIndex(index + 1)
            }
          >
            {index === tourSteps.length - 1 ? t("Finish tour") : t("Next")}
            <ArrowRight size={14} />
          </button>
        </div>
        <button className="tour-skip" onClick={onClose}>
          {t("Skip for now · reopen with ?")}
        </button>
      </section>
    </div>
  );
}
