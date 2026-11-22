// App state container. The data layer doesn't depend on the UI library; the UI reads it by subscribing.
import type {AppState, WorkMeta} from "./types.ts";

let state: AppState = {
  phase: "loading",
  works: [],
  currentId: null,
  loadNonce: 0,
  session: null,
  online: typeof navigator === "undefined" || navigator.onLine !== false,
  save: "saved",
  syncing: false,
  quota: null,
};

const listeners = new Set<() => void>();

export const getState = () => state;

export function setState(patch: Partial<AppState>) {
  state = {...state, ...patch};
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetStateForTests() {
  state = {phase: "loading", works: [], currentId: null, loadNonce: 0, session: null, online: true, save: "saved", syncing: false, quota: null};
}

export function canOpenWork(work: WorkMeta, s: AppState = state): boolean {
  return work.account === null || work.account === s.session?.user.id;
}

/** Works visible to the current identity: local works plus the current account's works. Sorted by most recently modified; opening a work doesn't change the order. */
export function visibleWorks(s: AppState = state): WorkMeta[] {
  return s.works
    .filter((work) => canOpenWork(work, s))
    .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
}

export function currentWork(s: AppState = state): WorkMeta | null {
  return s.works.find((work) => work.id === s.currentId && canOpenWork(work, s)) ?? null;
}

/** Works that can be opened on this device right now. */
export const isAvailable = (work: WorkMeta) => !work.cloud || work.cloud.downloaded;

// Notices: the data layer only describes what happened, and the UI decides how to present it.
export interface Notice {
  kind: "info" | "success" | "warning" | "danger";
  title: string;
  description?: string;
  /** The user needs to see and deal with it; doesn't dismiss automatically. */
  sticky?: boolean;
  action?: {label: string; run: () => void};
}

const noticeListeners = new Set<(notice: Notice) => void>();

export function notify(notice: Notice) {
  for (const listener of noticeListeners) listener(notice);
}

export function onNotice(listener: (notice: Notice) => void) {
  noticeListeners.add(listener);
  return () => {
    noticeListeners.delete(listener);
  };
}

// The editor registers its capabilities here; the data layer uses them to flush unpersisted changes before switching or syncing.
export const editor = {
  flush: async (): Promise<void> => {},
  /** Export what is on the canvas right now as an .easel file, bypassing local storage. */
  exportFile: (): void => {},
};

// Entry points registered by the UI, for buttons in notices to call.
export const ui = {
  openAuth: (): void => {},
};
