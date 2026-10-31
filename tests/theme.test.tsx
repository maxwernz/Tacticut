// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useTheme } from "../src/theme";
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});
it("follows system changes only while System appearance is selected", () => {
  let dark = false;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return dark;
    },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }));
  const ui = renderHook(() => useTheme());
  expect(document.documentElement.dataset.theme).toBe("light");
  act(() => {
    dark = true;
    listeners.forEach((fn) => fn());
  });
  expect(document.documentElement.dataset.theme).toBe("dark");
  act(() => ui.result.current[1]("light"));
  expect(listeners.size).toBe(0);
  act(() => {
    dark = true;
    listeners.forEach((fn) => fn());
  });
  expect(document.documentElement.dataset.theme).toBe("light");
  ui.unmount();
  const restored = renderHook(() => useTheme());
  expect(restored.result.current[0]).toBe("light");
});
