// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { HandballPanel } from "../src/HandballPanel";
import {
  newAnalysis,
  withClipCategories,
  type Clip,
  type HandballView,
} from "../src/domain";

afterEach(cleanup);
const makeClip = (
  name: string,
  handball: Clip["handball"],
  start = 0,
): Clip => ({
  id: crypto.randomUUID(),
  source_video_id: "source",
  name,
  start_ms: start,
  end_ms: start + 1000,
  notes: "",
  category_id: null,
  creation_order: start,
  handball,
});
function setup(canReview = true) {
  const analysis = newAnalysis();
  const goal = makeClip(
    "Wing goal",
    {
      team: "Home",
      player: "Mia",
      outcome: "goal",
      shot_position: "left-wing",
      goal_zone: "top-left",
    },
    2000,
  );
  const save = makeClip("Wing saved", {
    team: "Home",
    player: "Mia",
    outcome: "saved",
    shot_position: "left-wing",
    goal_zone: "top-left",
  });
  const away = makeClip("Opponent miss", {
    team: "Away",
    player: "Alex",
    outcome: "missed",
    shot_position: "left-wing",
  });
  const turnover = makeClip("Turnover", {
    team: "Home",
    outcome: "turnover",
    shot_position: "left-wing",
    goal_zone: "top-left",
  });
  analysis.clips = [goal, save, away, turnover];
  const onPlaylist = vi.fn(),
    onExport = vi.fn(),
    onSelect = vi.fn();
  render(
    <HandballPanel
      analysis={analysis}
      canReview={canReview}
      onPlaylist={onPlaylist}
      onExport={onExport}
      onSelect={onSelect}
    />,
  );
  return { goal, save, away, turnover, onPlaylist, onExport, onSelect };
}
function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("option", { name: option }));
}

it("intersects team/outcome filters and sends exactly the matching clips to review and export", () => {
  const { save, goal, onExport, onPlaylist, onSelect } = setup();
  choose("Filter Team", "Home");
  choose("Filter Outcome", "Saved shot");
  const results = screen.getByRole("region", {
    name: "Matching handball clips",
  });
  expect(within(results).getByText("1 matching clips")).toBeTruthy();
  expect(within(results).queryByText(goal.name)).toBeNull();
  fireEvent.click(within(results).getByRole("button", { name: /Wing saved/ }));
  expect(onSelect).toHaveBeenCalledWith(save);
  fireEvent.click(screen.getByRole("button", { name: "Export matching" }));
  expect(onExport).toHaveBeenCalledWith([save]);
  fireEvent.click(
    screen.getByRole("button", { name: "Create review playlist" }),
  );
  expect(onPlaylist).toHaveBeenCalledWith("Home · Saved shot", [save]);
  fireEvent.click(
    screen.getByRole("button", { name: "Reset handball filters" }),
  );
  expect(within(results).getByText("4 matching clips")).toBeTruthy();
});

it("counts only explicit shots in target cells and filters from a target cell", () => {
  setup();
  fireEvent.click(screen.getByText("Shot maps"));
  const target = screen.getByRole("button", { name: "Goal target Top left" });
  expect(target.textContent).toContain("1 / 2");
  fireEvent.click(target);
  expect(target.getAttribute("aria-pressed")).toBe("true");
  const results = screen.getByRole("region", {
    name: "Matching handball clips",
  });
  expect(within(results).queryByText("Opponent miss")).toBeNull();
  expect(within(results).getByText("3 matching clips")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear target" }));
  expect(within(results).getByText("4 matching clips")).toBeTruthy();
});

it("disables review and export during an unfinished edit", () => {
  const { onExport, onPlaylist } = setup(false);
  const exportButton = screen.getByRole("button", {
    name: "Export matching",
  }) as HTMLButtonElement;
  const reviewButton = screen.getByRole("button", {
    name: "Create review playlist",
  }) as HTMLButtonElement;
  expect(exportButton.disabled).toBe(true);
  expect(reviewButton.disabled).toBe(true);
  fireEvent.click(exportButton);
  fireEvent.click(reviewButton);
  expect(onExport).not.toHaveBeenCalled();
  expect(onPlaylist).not.toHaveBeenCalled();
});

it("intersects selected coaching themes and shot outcome, and restores/reset saved theme views", () => {
  const analysis = newAnalysis();
  analysis.categories[0].name = "Fast break";
  analysis.categories[0].group = "Attack";
  analysis.categories[1].name = "Good decision";
  analysis.categories[1].group = "Decision";
  const [a, b] = analysis.categories.map((c) => c.id);
  const bothGoal = withClipCategories(
    makeClip("Both themes goal", { outcome: "goal" }),
    [a, b],
  );
  const onlyGoal = withClipCategories(
    makeClip("One theme goal", { outcome: "goal" }),
    [a],
  );
  const bothSave = withClipCategories(
    makeClip("Both themes saved", { outcome: "saved" }),
    [a, b],
  );
  analysis.clips = [bothGoal, onlyGoal, bothSave];
  const onExport = vi.fn(),
    onPlaylist = vi.fn(),
    onViews = vi.fn();
  const props = {
    canReview: true,
    onExport,
    onPlaylist,
    onViews,
    onSelect: vi.fn(),
  };
  const ui = render(<HandballPanel analysis={analysis} {...props} />);
  fireEvent.click(screen.getByText("Coaching themes"));
  fireEvent.click(
    screen.getByRole("button", { name: "Filter theme Attack / Fast break" }),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "Filter theme Decision / Good decision",
    }),
  );
  choose("Filter Outcome", "Goal");
  fireEvent.click(screen.getByRole("button", { name: "Export matching" }));
  expect(onExport).toHaveBeenLastCalledWith([bothGoal]);
  fireEvent.click(
    screen.getByRole("button", { name: "Create review playlist" }),
  );
  expect(onPlaylist).toHaveBeenLastCalledWith(
    "Goal · Attack / Fast break · Decision / Good decision",
    [bothGoal],
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Save view" }),
  );
  fireEvent.change(screen.getByLabelText("View name"), {
    target: { value: "Two-theme goals" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const views = onViews.mock.calls[0][0] as HandballView[];
  expect(views[0]).toMatchObject({
    category_ids: [a, b],
    filters: { outcome: "goal" },
  });
  ui.rerender(
    <HandballPanel
      analysis={{ ...analysis, handball_views: views }}
      {...props}
    />,
  );
  fireEvent.click(screen.getByTitle("Reset handball filters"));
  expect(screen.getByText("3 matching clips")).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Filter theme Attack / Fast break" })
      .getAttribute("aria-pressed"),
  ).toBe("false");
  choose("Saved handball views", "Two-theme goals");
  fireEvent.click(screen.getByRole("button", { name: "Export matching" }));
  expect(onExport).toHaveBeenLastCalledWith([bothGoal]);
  expect(
    screen
      .getByRole("button", { name: "Filter theme Decision / Good decision" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.click(
    screen.getByRole("button", { name: "Clear themes" }),
  );
  expect(screen.getByText("2 matching clips")).toBeTruthy();
});
