import {en, zhCN, type MessageKey} from "./messages.ts";
import {route, type Locale} from "../site/routes.ts";

export type {MessageKey};

const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = {en, "zh-CN": zhCN};
export let locale: Locale = typeof window === "undefined" ? "en" : route(location.pathname)?.locale ?? "en";

export function selectLocale(next: Locale) {
  locale = next;
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = DICTIONARIES[locale][key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}
