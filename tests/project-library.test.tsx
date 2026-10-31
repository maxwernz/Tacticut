// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectLibrary } from "../src/ProjectLibrary";
import type { DesktopAPI, ProjectEntry } from "../src/api";
afterEach(cleanup);
function setup() {
  const rows: ProjectEntry[] = ["One", "Two", "Missing"].map((name) => ({ path: `/${name}.analysis`, title: name, clips: 4, videos: 1, lastOpened: "2026-10-01T12:00:00Z", missing: name === "Missing" }));
  window.desktop = { projects: vi.fn().mockResolvedValue(rows), browseProjects: vi.fn().mockResolvedValue(rows), forgetProject: vi.fn().mockResolvedValue(undefined) } as unknown as DesktopAPI;
  const onOpen = vi.fn().mockResolvedValue(false), onCollection = vi.fn().mockResolvedValue(true), onClose = vi.fn();
  render(<ProjectLibrary onOpen={onOpen} onCollection={onCollection} onClose={onClose} />);
  return { user: userEvent.setup(), onOpen, onCollection, onClose };
}
it("creates a named snapshot from selected projects even when search hides selected rows", async () => {
  const { user, onCollection, onClose } = setup();
  await screen.findByText("One");
  expect((screen.getByRole("checkbox", { name: "Select Missing" }) as HTMLInputElement).disabled).toBe(true);
  await user.click(screen.getByRole("checkbox", { name: "Select One" }));
  await user.click(screen.getByRole("checkbox", { name: "Select Two" }));
  await user.type(screen.getByRole("textbox", { name: "Search projects" }), "One");
  await user.clear(screen.getByRole("textbox", { name: "Collection name" }));
  await user.type(screen.getByRole("textbox", { name: "Collection name" }), "Our season");
  await user.click(screen.getByRole("button", { name: "Create collection" }));
  expect(onCollection).toHaveBeenCalledWith(["/One.analysis", "/Two.analysis"], "Our season");
  expect(onClose).toHaveBeenCalledOnce();
});
it("keeps the library open when the unsaved guard is cancelled and displays load failures", async () => {
  const { user, onOpen, onClose } = setup();
  await screen.findByText("One");
  await user.click(screen.getByRole("button", { name: "Open One" }));
  expect(onOpen).toHaveBeenCalledWith("/One.analysis");
  expect(onClose).not.toHaveBeenCalled();
  onOpen.mockRejectedValueOnce(new Error("This project moved"));
  await user.click(screen.getByRole("button", { name: "Open One" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "This project moved");
  expect(onClose).not.toHaveBeenCalled();
});
it("removes only a recent entry and clears its collection selection", async () => {
  const { user } = setup();
  await screen.findByText("One");
  await user.click(screen.getByRole("checkbox", { name: "Select One" }));
  await user.click(screen.getByRole("button", { name: "Remove One from recent projects" }));
  expect(window.desktop.forgetProject).toHaveBeenCalledWith("/One.analysis");
  await waitFor(() => expect(screen.queryByRole("checkbox", { name: "Select One" })).toBeNull());
  expect(screen.getByText("0 selected")).toBeTruthy();
});
