import type {Quota, User} from "../../shared/api.ts";
import {t} from "./i18n.ts";

/** Canvas content. The concrete structure of elements is interpreted by the canvas engine's adapter layer. */
export interface Scene {
  elements: unknown[];
  files: Record<string, unknown>;
  view: SceneView;
}

export interface SceneView {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export interface CloudState {
  /** The cloud version the local content is based on; 0 means it has never been uploaded. */
  baseVersion: number;
  /** This device has changes that haven't been uploaded. */
  dirty: boolean;
  /** Whether the content is fully saved on this device. */
  downloaded: boolean;
  /** Incremented on every local save; used to generate the mutationId for deduplication. */
  rev: number;
}

export interface WorkMeta {
  id: string;
  name: string;
  /** Owning account. null means a work on this device, visible to guests and to any account. */
  account: string | null;
  createdAt: number;
  updatedAt: number;
  openedAt: number;
  cloud: CloudState | null;
}

export interface StoredScene extends Scene {
  id: string;
}

export interface Session {
  token: string;
  user: User;
  /** Sign-in has expired: keep saving locally and wait for the user to sign in again. */
  expired: boolean;
}

export type WorkStatus = "local" | "pending" | "synced" | "remote";

export function workStatus(work: WorkMeta): WorkStatus {
  if (!work.cloud) return "local";
  if (!work.cloud.downloaded) return "remote";
  return work.cloud.dirty ? "pending" : "synced";
}

export const STATUS_LABEL: Record<WorkStatus, string> = {
  local: t("status.local"),
  pending: t("status.pending"),
  synced: t("status.synced"),
  remote: t("status.remote"),
};

export type SaveState = "saved" | "saving" | "failed";

export interface AppState {
  phase: "loading" | "ready";
  works: WorkMeta[];
  currentId: string | null;
  /** When incremented, the editor reloads the current work from local storage. */
  loadNonce: number;
  session: Session | null;
  online: boolean;
  save: SaveState;
  syncing: boolean;
  quota: Quota | null;
}

export const emptyView: SceneView = {scrollX: 0, scrollY: 0, zoom: 1};
export const emptyScene = (): Scene => ({elements: [], files: {}, view: {...emptyView}});
