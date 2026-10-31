// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProjectSetup } from "../src/ProjectSetup";
import { HandballFields } from "../src/HandballFields";
import { newAnalysis } from "../src/domain";
import type { Roster } from "../src/roster";
afterEach(() => { cleanup(); localStorage.clear(); });
it("keeps roster editing local and applies validated stable identities", () => {
  const analysis = newAnalysis();
  const save = vi.fn();
  render(<ProjectSetup analysis={analysis} onSave={save} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Add team" }));
  fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "Home" } });
  fireEvent.click(screen.getByRole("button", { name: "Add player" }));
  fireEvent.change(screen.getByLabelText("Player name"), { target: { value: "Alex" } });
  fireEvent.change(screen.getByLabelText("Shirt number"), { target: { value: "7" } });
  expect(analysis.roster).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "Apply setup" }));
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0][0].roster.players[0]).toMatchObject({ name: "Alex", number: "7" });
  expect(save.mock.calls[0][0].roster.players[0].team_id).toBe(save.mock.calls[0][0].roster.teams[0].id);
});
it("roster selection links a player and their attacking team, typed edits detach only the edited identity", () => {
  const roster: Roster = { teams: [{ id: crypto.randomUUID(), name: "Home" }], players: [] };
  const person = { id: crypto.randomUUID(), team_id: roster.teams[0].id, name: "Alex", number: "7", goalkeeper: false };
  roster.players.push(person);
  const change = vi.fn();
  const ui = render(<HandballFields roster={roster} onChange={change} />);
  fireEvent.click(screen.getByRole("combobox", { name: "Choose player from roster" }));
  fireEvent.click(screen.getByRole("option", { name: "#7 · Alex · Home" }));
  const tag = change.mock.calls[0][0];
  expect(tag).toEqual({ player_id: person.id, player: "Alex", team_id: person.team_id, team: "Home" });
  ui.rerender(<HandballFields value={tag} roster={roster} onChange={change} />);
  fireEvent.change(screen.getByLabelText("Attacking player"), { target: { value: "Guest" } });
  expect(change).toHaveBeenLastCalledWith({ player: "Guest", team_id: person.team_id, team: "Home" });
});
it("stores reusable templates without applying or changing the project", () => {
  const analysis = newAnalysis(); const save = vi.fn();
  render(<ProjectSetup analysis={analysis} onSave={save} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("tab", { name: "Reusable templates" }));
  fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "My setup" } });
  fireEvent.click(screen.getByRole("button", { name: "Save current setup as template" }));
  expect(screen.getByText("My setup")).toBeTruthy();
  expect(save).not.toHaveBeenCalled();
  expect(analysis.roster).toBeUndefined();
  expect(JSON.parse(localStorage.getItem("tacticut-setup-templates-v1")!)).toHaveLength(1);
});
