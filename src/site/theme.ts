import {useSyncExternalStore} from "react";

import {preferredTheme, saveTheme, type ProductTheme} from "../vendor/niltavi-ui/theme.ts";

export function useTheme(): ProductTheme {
  return useSyncExternalStore(subscribe, theme);
}

function theme(): ProductTheme {
  const current = document.documentElement.dataset.theme;
  return current === "dark" || current === "light" ? current : preferredTheme();
}

function subscribe(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, {attributes: true, attributeFilter: ["data-theme"]});
  return () => observer.disconnect();
}

export function toggleTheme() {
  saveTheme(theme() === "light" ? "dark" : "light");
}
