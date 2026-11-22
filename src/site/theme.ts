import {useSyncExternalStore} from "react";

export type Theme = "light" | "dark";

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, theme);
}

function theme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function subscribe(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, {attributes: true, attributeFilter: ["data-theme"]});
  return () => observer.disconnect();
}

export function toggleTheme() {
  const next = theme() === "light" ? "dark" : "light";
  try {
    localStorage.setItem("easel.theme", next);
  } catch {
    // Theme still applies to this page if storage is disabled.
  }
  document.documentElement.dataset.theme = next;
}
