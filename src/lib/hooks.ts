import {useSyncExternalStore} from "react";
import {getState, subscribe} from "./state.ts";
import type {AppState} from "./types.ts";

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getState);
}

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
    () => window.matchMedia(query).matches,
  );
}

export const useIsMobile = () => useMediaQuery("(max-width: 767px)");
export const useTheme = (): "light" | "dark" => (useMediaQuery("(prefers-color-scheme: dark)") ? "dark" : "light");
