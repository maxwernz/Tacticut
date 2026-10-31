// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { Settings } from "../src/Settings";
import {
  getLanguage,
  readLanguage,
  setLanguage,
  tFor,
  useLanguage,
} from "../src/i18n";
import type { DesktopAPI } from "../src/api";
import { fieldOptions, handballSearchText } from "../src/handball";
import { tourSteps } from "../src/WelcomeTour";
import type { Clip } from "../src/domain";

afterEach(async () => {
  cleanup();
  window.desktop = {} as DesktopAPI;
  await setLanguage("en");
  localStorage.clear();
  vi.restoreAllMocks();
});

it("switches subscribed UI after native persistence succeeds and keeps interpolation values verbatim", async () => {
  const persist = vi.fn(async () => {});
  window.desktop = { setLanguage: persist } as unknown as DesktopAPI;
  const hook = renderHook(() => useLanguage());
  await act(() => setLanguage("de"));
  expect(hook.result.current.language).toBe("de");
  expect(persist).toHaveBeenCalledWith("de");
  expect(readLanguage()).toBe("de");
  expect(document.documentElement.lang).toBe("de");
  expect(tFor("de", "Player {name}", { name: "Save {name} $&" })).toBe(
    "Spieler Save {name} $&",
  );
  expect(tFor("de", "unknown label")).toBe("unknown label");
  expect(tFor("de", "constructor")).toBe("constructor");
  persist.mockRejectedValueOnce(new Error("Could not save"));
  await expect(setLanguage("en")).rejects.toThrow("Could not save");
  expect(getLanguage()).toBe("de");
  expect(localStorage.getItem("tacticut-language")).toBe("de");
  expect(document.documentElement.lang).toBe("de");
});

it("keeps invalid timing visible, rejects blank inputs and saves valid preferences", () => {
  const capture = vi.fn(),
    jump = vi.fn(),
    close = vi.fn();
  render(
    <Settings
      theme="system"
      onTheme={vi.fn()}
      capture={{ before: 8, after: 3 }}
      onCapture={capture}
      jump={5}
      onJump={jump}
      onTour={vi.fn()}
      onClose={close}
    />,
  );
  const before = screen.getByRole("spinbutton", {
    name: "Settings seconds before",
  });
  const after = screen.getByRole("spinbutton", {
    name: "Settings seconds after",
  });
  const interval = screen.getByRole("spinbutton", {
    name: "Settings jump interval",
  });
  const done = screen.getByRole("button", { name: "Done" });
  fireEvent.change(before, { target: { value: "" } });
  fireEvent.click(done);
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("capture window");
  expect(capture).not.toHaveBeenCalled();
  fireEvent.change(before, { target: { value: "0" } });
  fireEvent.change(after, { target: { value: "0" } });
  fireEvent.click(done);
  expect(close).not.toHaveBeenCalled();
  fireEvent.change(before, { target: { value: "12" } });
  fireEvent.change(after, { target: { value: "4" } });
  fireEvent.change(interval, { target: { value: "" } });
  fireEvent.click(done);
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("jump interval");
  fireEvent.change(interval, { target: { value: "7" } });
  fireEvent.click(done);
  expect(capture).toHaveBeenLastCalledWith({ before: 12, after: 4 });
  expect(jump).toHaveBeenLastCalledWith(7);
  expect(close).toHaveBeenCalledOnce();
});

it("translates the full tour and every fixed handball choice, with German searchable outcomes", () => {
  for (const step of tourSteps)
    for (const key of [step.title, step.text, step.tip])
      expect(tFor("de", key), key).not.toBe(key);
  for (const options of Object.values(fieldOptions))
    for (const option of options)
      if (option.value !== "seven-metre")
        expect(tFor("de", option.label), option.label).not.toBe(option.label);
      else expect(tFor("de", option.label)).toBe("7 m");
  const clip = {
    handball: { outcome: "saved", player: "Goal", team: "Start" },
  } as Clip;
  expect(handballSearchText(clip, "de")).toContain("Gehaltener Wurf");
  expect(clip.handball).toEqual({
    outcome: "saved",
    player: "Goal",
    team: "Start",
  });
});
