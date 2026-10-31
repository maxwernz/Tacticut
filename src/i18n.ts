import { useSyncExternalStore } from "react";
import { de } from "./locales/de";

export type Language = "en" | "de";
export type TranslationParams = Record<string, string | number>;
const storageKey = "tacticut-language";
const listeners = new Set<() => void>();
let current: Language | undefined;
const validLanguage = (value: unknown): value is Language =>
  value === "de" || value === "en";
export function readLanguage(): Language {
  if (typeof window === "undefined") return "en";
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (validLanguage(saved)) return saved;
  } catch {}
  if (validLanguage(window.desktop?.language)) return window.desktop.language;
  return window.navigator.language?.toLowerCase().startsWith("de")
    ? "de"
    : "en";
}
export function getLanguage(): Language {
  return current ?? readLanguage();
}
export function tFor(
  language: Language,
  source: string,
  params: TranslationParams = {},
): string {
  const lookup = (key: string) =>
    Object.hasOwn(de, key) ? de[key] : undefined;
  const direct = language === "de" ? lookup(source) : undefined;
  const trimmed = language === "de" ? lookup(source.trim()) : undefined;
  const translated =
    direct ??
    (trimmed === undefined
      ? source
      : `${source.match(/^\s*/)?.[0] || ""}${trimmed}${source.match(/\s*$/)?.[0] || ""}`);
  return translated.replace(/\{(\w+)\}/g, (token, name: string) =>
    params[name] === undefined ? token : String(params[name]),
  );
}
export function t(source: string, params: TranslationParams = {}): string {
  return tFor(getLanguage(), source, params);
}
export async function setLanguage(language: Language): Promise<void> {
  if (!validLanguage(language)) throw new Error("Unsupported language");
  await window.desktop?.setLanguage?.(language);
  current = language;
  try {
    window.localStorage.setItem(storageKey, language);
  } catch {}
  document.documentElement.lang = language;
  for (const notify of listeners) notify();
}
export function initializeLanguage() {
  if (typeof document !== "undefined")
    document.documentElement.lang = getLanguage();
}
export function useLanguage() {
  const language = useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    getLanguage,
    () => "en" as const,
  );
  return { language, setLanguage };
}
