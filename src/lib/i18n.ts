// Interface language. The locale is resolved once at module load and stays fixed for the page's lifetime;
// changing it stores the choice and reloads, so module-level label tables can simply call t().
import {en, zhCN, type MessageKey} from "./messages.ts";

export type Locale = "en" | "zh-CN";
export type {MessageKey};

const STORAGE_KEY = "easel.lang";
const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = {en, "zh-CN": zhCN};

const isLocale = (value: unknown): value is Locale => value === "en" || value === "zh-CN";

function resolveLocale(): Locale {
  // Outside a browser (tests, tooling) there is no user preference to read.
  if (typeof window === "undefined") return "en";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // Storage is unavailable: fall through to the browser language
  }
  try {
    if (navigator.language.toLowerCase().startsWith("zh")) return "zh-CN";
  } catch {
    // No navigator: use the default
  }
  return "en";
}

export const locale: Locale = resolveLocale();

/** The language the switch in the menu leads to. */
export const otherLocale: Locale = locale === "en" ? "zh-CN" : "en";

/** A language's name written in that language. */
export const localeName = (target: Locale): string => DICTIONARIES[target]["lang.name"];

/** Remember the choice and reload, so every label is rebuilt in the new language. */
export function setLocale(next: Locale) {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // The choice can't be remembered; the reload below would come back in the same language.
  }
  location.reload();
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = DICTIONARIES[locale][key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}
