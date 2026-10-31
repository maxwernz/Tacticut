import { useEffect, useLayoutEffect, useState } from "react";
export type ThemePreference = "system" | "light" | "dark";
const key = "tacticut-appearance";
export function readTheme(): ThemePreference {
  try {
    const saved = localStorage.getItem(key);
    if (saved === "light" || saved === "dark") return saved;
  } catch {}
  return "system";
}
export function applyTheme(preference: ThemePreference) {
  const dark =
    preference === "dark" ||
    (preference === "system" &&
      (window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true));
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
export function useTheme() {
  const [theme, setTheme] = useState<ThemePreference>(readTheme);
  useLayoutEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(key, theme);
    } catch {}
  }, [theme]);
  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const change = () => applyTheme("system");
    media?.addEventListener?.("change", change);
    return () => media?.removeEventListener?.("change", change);
  }, [theme]);
  return [theme, setTheme] as const;
}
