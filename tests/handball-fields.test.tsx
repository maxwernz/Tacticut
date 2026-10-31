// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ClipEditor } from "../src/ClipEditor";
import { HandballFields } from "../src/HandballFields";
import type { Clip } from "../src/domain";
afterEach(cleanup);
const clip: Clip = {
  id: crypto.randomUUID(),
  source_video_id: crypto.randomUUID(),
  name: "Shot",
  start_ms: 0,
  end_ms: 1000,
  notes: "",
  category_id: null,
  creation_order: 0,
  handball: {
    team: "Home",
    player: "7",
    outcome: "saved",
    goal_zone: "top-left",
  },
};
const props = {
  clip,
  categories: [],
  duration: 5000,
  current: () => 0,
  onSeek: vi.fn(),
  onPreview: vi.fn(),
  onStopPreview: vi.fn(),
  onCancel: vi.fn(),
};
it("keeps handball edits local until Save and supports clearing all tags", () => {
  const save = vi.fn();
  const ui = render(<ClipEditor {...props} onSave={save} />);
  fireEvent.change(screen.getByLabelText("Attacking player"), {
    target: { value: "9" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Target Bottom right" }));
  expect(clip.handball?.player).toBe("7");
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save Clip" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      handball: {
        team: "Home",
        player: "9",
        outcome: "saved",
        goal_zone: "bottom-right",
      },
    }),
  );
  ui.unmount();
  render(<ClipEditor {...props} onSave={save} />);
  fireEvent.click(screen.getByRole("button", { name: "Clear all tags" }));
  fireEvent.click(screen.getByRole("button", { name: "Save Clip" }));
  expect(save).toHaveBeenLastCalledWith(
    expect.objectContaining({ handball: undefined }),
  );
});
it("capture context omits shot outcomes and targets to avoid repeated event results", () => {
  const change = vi.fn();
  render(
    <HandballFields contextOnly value={{ team: "Home" }} onChange={change} />,
  );
  expect(
    screen.queryByRole("combobox", { name: "Recorded outcome" }),
  ).toBeNull();
  expect(screen.queryByRole("combobox", { name: "Shot origin" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Target/ })).toBeNull();
  fireEvent.click(screen.getByRole("combobox", { name: "Tactical phase" }));
  fireEvent.click(screen.getByRole("option", { name: "Fast break" }));
  expect(change).toHaveBeenCalledWith({ team: "Home", phase: "fast-break" });
});
