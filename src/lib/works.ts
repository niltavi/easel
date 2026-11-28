// Local work management: create, open, save, rename, duplicate, delete, import. All of it works offline.
import * as store from "./db.ts";
import {parseDocument, serializeDocument} from "./file.ts";
import {t} from "./i18n.ts";
import {canOpenWork, currentWork, editor, getState, isAvailable, notify, setState, visibleWorks} from "./state.ts";
import type {Scene, Session, WorkMeta} from "./types.ts";
import {emptyScene} from "./types.ts";

const LAST_OPENED = "lastOpened";
const PENDING_DELETES = "pendingDeletes";

export interface PendingDelete {
  id: string;
  account: string;
}

export const newId = () => crypto.randomUUID();

export async function refreshWorks() {
  setState({works: await store.allWorks()});
}

function uniqueName(base: string): string {
  const names = new Set(visibleWorks().map((work) => work.name));
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!names.has(candidate)) return candidate;
  }
}

function blankMeta(name: string): WorkMeta {
  const now = Date.now();
  return {id: newId(), name, account: null, createdAt: now, updatedAt: now, openedAt: now, cloud: null};
}

/**
 * A new work. While signed in it belongs to the account and syncs by default; it stays on this device only after the user moves it back.
 * A blank work has nothing to upload until its first change, so untouched canvases don't pile up in the cloud.
 */
function newMeta(name: string, hasContent: boolean): WorkMeta {
  const meta = blankMeta(name);
  const session = getState().session;
  if (!session) return meta;
  return {...meta, account: session.user.id, cloud: {baseVersion: 0, dirty: hasContent, downloaded: true, rev: hasContent ? 1 : 0}};
}

/** Startup: restore the last opened work if available; otherwise fall back to the most recent available one, and failing that provide a blank canvas. */
export async function loadWorkspace() {
  const [works, session, lastOpened] = await Promise.all([
    store.allWorks(),
    store.kvGet<Session>("session"),
    store.kvGet<string>(LAST_OPENED),
  ]);
  setState({works, session: session ?? null});
  const candidates = visibleWorks().filter(isAvailable);
  const target = candidates.find((work) => work.id === lastOpened) ?? candidates[0];
  if (target) await setCurrent(target.id);
  else await createWork();
  setState({phase: "ready"});
}

async function setCurrent(id: string) {
  const meta = await store.updateWork(id, (work) => ({meta: {...work, openedAt: Date.now()}}));
  if (!meta) return;
  await store.kvSet(LAST_OPENED, id);
  setState({works: await store.allWorks(), currentId: id, loadNonce: getState().loadNonce + 1, save: "saved"});
}

export async function createWork(): Promise<string> {
  await editor.flush();
  const meta = newMeta(uniqueName(t("name.untitled")), false);
  await store.putWork(meta, emptyScene());
  await setCurrent(meta.id);
  return meta.id;
}

/**
 * Switch to a work that is available on this device. Works not yet downloaded are downloaded by the sync layer first, see openWork in sync.ts.
 */
export async function openLocalWork(id: string): Promise<boolean> {
  const work = getState().works.find((item) => item.id === id);
  if (!work || !canOpenWork(work) || !isAvailable(work)) return false;
  if (id === getState().currentId) return true;
  await editor.flush();
  if (!canOpenWork(work)) return false;
  await setCurrent(id);
  return true;
}

/** When the current work is no longer available (deleted, signed out, etc.), switch to another canvas. */
export async function ensureCurrent() {
  const current = currentWork();
  const visible = visibleWorks();
  if (current && isAvailable(current) && visible.some((work) => work.id === current.id)) return;
  const next = visible.find(isAvailable);
  if (next) await setCurrent(next.id);
  else {
    const meta = newMeta(uniqueName(t("name.untitled")), false);
    await store.putWork(meta, emptyScene());
    await setCurrent(meta.id);
  }
}

export async function loadScene(id: string): Promise<Scene> {
  return (await store.getScene(id)) ?? emptyScene();
}

/**
 * Editor save. When contentChanged is false only the viewport is recorded, which doesn't count as a change to the work.
 * The status is set to "saved" only after the write succeeds; on failure the content is still in the editor, and the user is prompted to export.
 */
export async function saveScene(id: string, scene: Scene, contentChanged: boolean): Promise<boolean> {
  if (contentChanged) setState({save: "saving"});
  try {
    const meta = await store.updateWork(id, (work) => {
      if (!contentChanged) return {meta: work, scene};
      return {
        meta: {
          ...work,
          updatedAt: Date.now(),
          cloud: work.cloud ? {...work.cloud, dirty: true, rev: work.cloud.rev + 1} : null,
        },
        scene,
      };
    });
    if (contentChanged || getState().save === "failed") {
      setState({save: "saved", works: meta ? await store.allWorks() : getState().works});
    }
    return true;
  } catch (error) {
    console.error("Save failed", error);
    if (getState().save !== "failed") {
      notify({
        kind: "danger",
        title: t("save.failedTitle"),
        description: t("save.failedBody"),
        sticky: true,
        action: {label: t("common.exportFile"), run: () => editor.exportFile()},
      });
    }
    setState({save: "failed"});
    return false;
  }
}

export async function renameWork(id: string, name: string) {
  const trimmed = name.trim().slice(0, 120);
  if (!trimmed) return;
  await store.updateWork(id, (work) =>
    work.name === trimmed
      ? null
      : {
          meta: {
            ...work,
            name: trimmed,
            updatedAt: Date.now(),
            cloud: work.cloud ? {...work.cloud, dirty: true, rev: work.cloud.rev + 1} : null,
          },
        },
  );
  await refreshWorks();
}

export async function duplicateWork(id: string): Promise<string | null> {
  await editor.flush();
  const source = await store.getWork(id);
  const scene = await store.getScene(id);
  if (!source || !scene) return null;
  const meta = newMeta(uniqueName(t("name.copy", {name: source.name})), true);
  await store.putWork(meta, scene);
  await setCurrent(meta.id);
  return meta.id;
}

export async function removeWork(id: string) {
  const work = await store.getWork(id);
  if (!work) return;
  if (id === getState().currentId) await editor.flush();
  if (work.cloud && work.account && work.cloud.baseVersion > 0) {
    // The cloud copy is removed once back online; record it first so the deletion isn't lost while offline.
    const pending = (await store.kvGet<PendingDelete[]>(PENDING_DELETES)) ?? [];
    await store.kvSet(PENDING_DELETES, [...pending, {id, account: work.account}]);
  }
  await store.deleteWork(id);
  await refreshWorks();
  await ensureCurrent();
}

export const pendingDeletes = async () => (await store.kvGet<PendingDelete[]>(PENDING_DELETES)) ?? [];
export const setPendingDeletes = (list: PendingDelete[]) => store.kvSet(PENDING_DELETES, list);

/** Importing always creates a copy. A parse failure throws EaselFileError and leaves the current work untouched. */
export async function importDocument(text: string, sanitize: (scene: Scene) => Scene = (scene) => scene): Promise<string> {
  const parsed = parseDocument(text);
  const scene = sanitize(parsed.scene);
  await editor.flush();
  const meta = newMeta(uniqueName(parsed.name), true);
  await store.putWork(meta, scene);
  await setCurrent(meta.id);
  return meta.id;
}

export async function exportDocument(id: string): Promise<{name: string; text: string} | null> {
  if (id === getState().currentId) await editor.flush();
  const work = await store.getWork(id);
  const scene = await store.getScene(id);
  if (!work || !scene) return null;
  return {name: work.name, text: serializeDocument(work.name, scene)};
}
