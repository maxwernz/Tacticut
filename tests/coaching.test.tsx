// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HandballPanel } from "../src/HandballPanel";
import { BatchHandball } from "../src/BatchHandball";
import {
  newAnalysis,
  encode,
  decode,
  type Clip,
  type HandballView,
} from "../src/domain";
import { playerReviewGroups } from "../src/handball";
afterEach(cleanup);
const clip = (team: string, player?: string, start = 0): Clip => ({
  id: crypto.randomUUID(),
  source_video_id: crypto.randomUUID(),
  name: `${team} shot`,
  start_ms: start,
  end_ms: start + 1000,
  notes: "",
  category_id: null,
  creation_order: 0,
  handball: { team, ...(player ? { player } : {}), outcome: "goal" },
});
it("separates players across teams and omits unassigned clips from automatic reviews", () => {
  const rows = [
    clip("Home", "7", 1000),
    clip("Away", "7"),
    clip("Home", "7", 2000),
    clip("Home"),
  ];
  const groups = playerReviewGroups(rows);
  expect(groups.map((g) => g.clips.map((c) => c.id))).toEqual([
    [rows[0].id, rows[2].id],
    [rows[1].id],
  ]);
  expect(groups.map((g) => g.name)).toEqual(["Home · 7", "Away · 7"]);
});
it("round trips saved views in schema 5 and falls back safely when removed", () => {
  const a = newAnalysis();
  a.source_videos = [
    {
      id: crypto.randomUUID(),
      display_name: "Match",
      location: "/match.mp4",
      relative_path: null,
      duration_ms: 10000,
      byte_size: null,
      fingerprint: null,
    },
  ];
  a.handball_views = [
    {
      id: crypto.randomUUID(),
      name: "Left wing goals",
      filters: { outcome: "goal", shot_position: "left-wing" },
      query: "",
      source_video_id: a.source_videos[0].id,
    },
  ];
  expect(JSON.parse(encode(a)).schema_version).toBe(5);
  expect(decode(encode(a))).toEqual(a);
  delete a.handball_views;
  expect(JSON.parse(encode(a)).schema_version).toBe(1);
});
it("saves current combined filters and restores a named view without changing clips", () => {
  const a = newAnalysis();
  a.clips = [clip("Home", "7"), clip("Away", "9")];
  const views = vi.fn();
  const report = vi.fn();
  const reviews = vi.fn();
  const props = {
    analysis: a,
    canReview: true,
    onSelect: vi.fn(),
    onExport: vi.fn(),
    onPlaylist: vi.fn(),
    onViews: views,
    onReport: report,
    onPlayerReviews: reviews,
  };
  const ui = render(<HandballPanel {...props} />);
  fireEvent.click(screen.getByRole("combobox", { name: "Filter Team" }));
  fireEvent.click(screen.getByRole("option", { name: "Home" }));
  fireEvent.click(screen.getByTitle("Save current handball view"));
  fireEvent.change(screen.getByLabelText("View name"), {
    target: { value: "Home review" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
  const saved: HandballView[] = views.mock.calls[0][0];
  expect(saved[0]).toMatchObject({
    name: "Home review",
    filters: { team: "Home" },
    query: "",
    source_video_id: null,
  });
  ui.rerender(
    <HandballPanel {...props} analysis={{ ...a, handball_views: saved }} />,
  );
  fireEvent.click(screen.getByTitle("Reset handball filters"));
  fireEvent.click(
    screen.getByRole("combobox", { name: "Saved handball views" }),
  );
  fireEvent.click(screen.getByRole("option", { name: "Home review" }));
  expect(screen.getByText("1 matching clips")).toBeTruthy();
  fireEvent.click(screen.getByText("Reports & player reviews"));
  fireEvent.click(
    screen.getByRole("button", { name: "Shooting report (PDF)" }),
  );
  expect(report).toHaveBeenCalledWith([a.clips[0]], "pdf");
  fireEvent.click(
    screen.getByRole("button", { name: "Create 1 player playlists" }),
  );
  expect(reviews).toHaveBeenCalledWith([
    { name: "Home · 7", clips: [a.clips[0]] },
  ]);
});
it("batch tagging submits only explicitly filled fields and supports an explicit clear mode", () => {
  const apply = vi.fn();
  render(
    <BatchHandball
      clips={[clip("Home", "7"), clip("Home", "8")]}
      onApply={apply}
      onCancel={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Attacking team"), {
    target: { value: " Home renamed " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply tags" }));
  expect(apply).toHaveBeenCalledWith({ team: "Home renamed" }, false);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Remove tags" }));
  expect(apply).toHaveBeenLastCalledWith({ team: "Home renamed" }, true);
});
