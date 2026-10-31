// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { HandballTagBoard } from "../src/HandballTagBoard";
import type { HandballTag } from "../src/handball";
import type { Roster } from "../src/roster";

afterEach(cleanup);
function fixture(): Roster {
  const teams = [
    { id: crypto.randomUUID(), name: "Home" },
    { id: crypto.randomUUID(), name: "Away" },
  ];
  return {
    teams,
    players: [
      {
        id: crypto.randomUUID(),
        name: "Alex",
        number: "7",
        team_id: teams[0].id,
        goalkeeper: false,
      },
      {
        id: crypto.randomUUID(),
        name: "Bea",
        number: "9",
        team_id: teams[1].id,
        goalkeeper: false,
      },
      {
        id: crypto.randomUUID(),
        name: "Keeper",
        number: "12",
        team_id: teams[1].id,
        goalkeeper: true,
      },
    ],
  };
}
function Board({
  initial,
  part,
  roster,
  contextOnly,
}: {
  initial?: HandballTag;
  part: "people" | "play" | "court";
  roster?: Roster;
  contextOnly?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <HandballTagBoard
        value={value}
        onChange={setValue}
        part={part}
        roster={roster}
        contextOnly={contextOnly}
      />
      <output aria-label="Selected metadata">
        {JSON.stringify(value || {})}
      </output>
    </>
  );
}
const metadata = () =>
  JSON.parse(screen.getByLabelText("Selected metadata").textContent!);
it("direct outcome choices replace or clear a result while preserving unrelated tags", () => {
  render(
    <Board
      part="play"
      initial={{
        team: "Home",
        player: "Alex",
        phase: "fast-break",
        outcome: "goal",
        goal_zone: "top-left",
      }}
    />,
  );
  const outcomes = screen.getByRole("group", { name: "Recorded outcome" });
  fireEvent.click(
    within(outcomes).getByRole("button", { name: "Outcome Saved shot" }),
  );
  expect(metadata()).toEqual({
    team: "Home",
    player: "Alex",
    phase: "fast-break",
    outcome: "saved",
    goal_zone: "top-left",
  });
  expect(
    within(outcomes)
      .getByRole("button", { name: "Outcome Saved shot" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.click(
    within(outcomes).getByRole("button", { name: "Outcome Saved shot" }),
  );
  expect(metadata().outcome).toBeUndefined();
  expect(metadata().phase).toBe("fast-break");
});
it("keeps outcomes out of remembered capture context and exposes direct tactical choices", () => {
  render(<Board part="play" contextOnly initial={{ team: "Home" }} />);
  expect(screen.queryByRole("group", { name: "Recorded outcome" })).toBeNull();
  fireEvent.click(
    within(screen.getByRole("group", { name: "Tactical phase" })).getByRole(
      "button",
      { name: "Fast break" },
    ),
  );
  fireEvent.click(
    within(screen.getByRole("group", { name: "Defense faced" })).getByRole(
      "button",
      { name: "6:0 defense" },
    ),
  );
  expect(metadata()).toEqual({
    team: "Home",
    phase: "fast-break",
    defense: "six-zero",
  });
});
it("roster player selection sets a stable team identity and a team change removes the prior linked player", () => {
  const roster = fixture();
  render(
    <Board
      part="people"
      roster={roster}
      initial={{ outcome: "saved", goalkeeper: "Prior keeper" }}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Player #7 · Alex · Home" }),
  );
  expect(metadata()).toEqual({
    outcome: "saved",
    goalkeeper: "Prior keeper",
    team: "Home",
    team_id: roster.teams[0].id,
    player: "Alex",
    player_id: roster.players[0].id,
  });
  fireEvent.click(screen.getByRole("button", { name: "Team Away" }));
  expect(metadata().team_id).toBe(roster.teams[1].id);
  expect(metadata().player_id).toBeUndefined();
  expect(metadata().player).toBeUndefined();
  expect(metadata().goalkeeper).toBe("Prior keeper");
  fireEvent.click(
    screen.getByRole("button", { name: "Goalkeeper #12 · Keeper · Away" }),
  );
  expect(metadata().goalkeeper_id).toBe(roster.players[2].id);
  expect(metadata().outcome).toBe("saved");
});
it("typing a name detaches only its identity; clearing the team clears its linked attacker", () => {
  const roster = fixture();
  const initial: HandballTag = {
    team: "Home",
    team_id: roster.teams[0].id,
    player: "Alex",
    player_id: roster.players[0].id,
    goalkeeper: "Keeper",
    goalkeeper_id: roster.players[2].id,
  };
  const change = vi.fn();
  const ui = render(
    <HandballTagBoard
      part="people"
      roster={roster}
      value={initial}
      onChange={change}
    />,
  );
  fireEvent.change(screen.getByLabelText("Attacking player", { exact: true }), {
    target: { value: "Guest" },
  });
  expect(change).toHaveBeenLastCalledWith({
    team: "Home",
    team_id: roster.teams[0].id,
    player: "Guest",
    goalkeeper: "Keeper",
    goalkeeper_id: roster.players[2].id,
  });
  ui.rerender(
    <HandballTagBoard
      part="people"
      roster={roster}
      value={initial}
      onChange={change}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Clear attacking team" }));
  expect(change).toHaveBeenLastCalledWith({
    goalkeeper: "Keeper",
    goalkeeper_id: roster.players[2].id,
  });
});
it("selects shot origin and target without inventing an outcome, and clears them independently", () => {
  render(<Board part="court" initial={{ team: "Home" }} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Shot origin Left wing" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Target Top left" }));
  expect(metadata()).toEqual({
    team: "Home",
    shot_position: "left-wing",
    goal_zone: "top-left",
  });
  fireEvent.click(screen.getByRole("button", { name: "Clear shot origin" }));
  expect(metadata()).toEqual({ team: "Home", goal_zone: "top-left" });
  fireEvent.click(screen.getByRole("button", { name: "Target Top left" }));
  expect(metadata()).toEqual({ team: "Home" });
});
it("searches large rosters without rewriting the current identity or hiding typed fallback", () => {
  const roster = fixture();
  for (let n = 0; n < 12; n++)
    roster.players.push({
      id: crypto.randomUUID(),
      name: `Player ${n}`,
      number: String(n + 20),
      team_id: roster.teams[0].id,
      goalkeeper: false,
    });
  render(
    <Board
      part="people"
      roster={roster}
      initial={{
        team: "Home",
        team_id: roster.teams[0].id,
        player: "Alex",
        player_id: roster.players[0].id,
      }}
    />,
  );
  fireEvent.change(screen.getByLabelText("Search roster"), {
    target: { value: "31" },
  });
  expect(
    screen.getByRole("button", { name: "Player #31 · Player 11 · Home" }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Player #7 · Alex · Home" }),
  ).toBeNull();
  expect(
    screen.getByLabelText("Attacking player", { exact: true }),
  ).toHaveProperty("value", "Alex");
  expect(metadata().player_id).toBe(roster.players[0].id);
});
