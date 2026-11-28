// Sign-in session and cloud sync.
// The cloud stores a versioned full snapshot per work; the local copy is always the usable one, and a sync failure doesn't affect editing.
import type {AuthConfig, PushConflict, RemoteWorkInfo} from "../../shared/api.ts";
import {api, ApiError} from "./api.ts";
import * as store from "./db.ts";
import {EaselFileError, parseDocument, serializeDocument} from "./file.ts";
import {t} from "./i18n.ts";
import {canOpenWork, editor, getState, notify, setState, ui} from "./state.ts";
import type {Session, WorkMeta} from "./types.ts";
import {ensureCurrent, newId, openLocalWork, pendingDeletes, refreshWorks, setPendingDeletes} from "./works.ts";

const SESSION = "session";
const DEVICE = "deviceId";

async function deviceId(): Promise<string> {
  let id = await store.kvGet<string>(DEVICE);
  if (!id) {
    id = newId().replace(/-/g, "").slice(0, 12);
    await store.kvSet(DEVICE, id);
  }
  return id;
}

/** Valid session: signed in and not expired. */
function activeSession(): Session | null {
  const session = getState().session;
  return session && !session.expired ? session : null;
}

// ---------- Sign-in ----------

/** Sign-in methods the server offers now. Read on each sign-in so a change by the admin shows up without a reload. */
export async function authConfig(): Promise<AuthConfig> {
  try {
    return await api.authConfig();
  } catch {
    // Unreachable server: offer the local method, which is the server's default.
    return {localLogin: true, identityLogin: false};
  }
}

export const register = async (email: string, password: string) => adopt(await api.register(email, password));
export const signInWithPassword = async (email: string, password: string) => adopt(await api.login(email, password));

/** Handle an Identity OIDC callback: exchange the grant code in the URL for a session token. */
export async function handleAuthCallback(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  const grantCode = params.get("auth_grant");
  const authError = params.get("auth_error");

  // Clean up the URL regardless of outcome.
  if (grantCode || authError) {
    const url = new URL(window.location.href);
    url.searchParams.delete("auth_grant");
    url.searchParams.delete("auth_error");
    window.history.replaceState(null, "", url.pathname + (url.search || "") + url.hash);
  }

  if (authError) {
    notify({kind: "warning", title: t("auth.identityError"), sticky: true});
    return false;
  }
  if (!grantCode) return false;

  try {
    const result = await api.exchangeGrant(grantCode);
    await adopt(result);
    return true;
  } catch {
    notify({kind: "warning", title: t("auth.identityError"), sticky: true});
    return false;
  }
}

async function adopt({token, user}: {token: string; user: Session["user"]}) {
  const previous = getState().session;
  const session: Session = {token, user, expired: false};
  await store.kvSet(SESSION, session);
  setState({session});
  // Switched accounts: the previous account's works leave the list but stay on this device until it comes back.
  if (previous && previous.user.id !== user.id) await ensureCurrent();
  void syncNow();
}

export async function signOut() {
  const session = getState().session;
  if (!session) return;
  await editor.flush();
  if (!session.expired) void api.signOut(session.token).catch(() => {});
  await store.kvDelete(SESSION);
  setState({session: null, quota: null});
  await ensureCurrent();
}

async function expireSession() {
  const session = getState().session;
  if (!session || session.expired) return;
  const expired = {...session, expired: true};
  await store.kvSet(SESSION, expired);
  setState({session: expired, quota: null});
  notify({
    kind: "warning",
    title: t("session.expired"),
    description: t("session.expiredBody"),
    sticky: true,
    action: {label: t("common.signInAgain"), run: () => ui.openAuth()},
  });
}

// ---------- Sync ----------

let running: Promise<void> | null = null;
let queued = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Sync later; consecutive edits are merged into one run. */
export function scheduleSync(delay = 2500) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, delay);
}

/** Only one round runs at a time; if another request arrives meanwhile, run one more round after it finishes. */
export function syncNow(): Promise<void> {
  if (running) {
    queued = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        queued = false;
        await syncOnce();
      } while (queued);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function syncOnce() {
  const session = activeSession();
  if (!session || !getState().online) return;
  setState({syncing: true});
  try {
    await editor.flush();
    await flushPendingDeletes(session);
    const {works: remote} = await api.listWorks(session.token);
    await reconcile(session, remote);
    await pushDirty(session);
  } catch (error) {
    if (error instanceof ApiError && error.code === "unauthorized") await expireSession();
    else if (!(error instanceof ApiError)) console.error("Sync failed", error);
    // Network or service failure: stay "pending" and retry next time.
  } finally {
    await refreshWorks();
    await ensureCurrent();
    setState({syncing: false});
  }
}

async function flushPendingDeletes(session: Session) {
  const pending = await pendingDeletes();
  for (const item of pending) {
    if (item.account !== session.user.id) continue;
    try {
      await api.deleteWork(session.token, item.id);
    } catch (error) {
      if (!(error instanceof ApiError) || (error.code !== "not_found" && error.code !== "gone")) throw error;
    }
    await setPendingDeletes((await pendingDeletes()).filter((entry) => entry.id !== item.id));
  }
}

async function reconcile(session: Session, remote: RemoteWorkInfo[]) {
  const account = session.user.id;
  const locals = new Map((await store.allWorks()).map((work) => [work.id, work]));
  const deleting = new Set((await pendingDeletes()).map((item) => item.id));
  const remoteIds = new Set<string>();

  for (const info of remote) {
    remoteIds.add(info.id);
    if (deleting.has(info.id)) continue;
    const local = locals.get(info.id);
    if (!local) {
      // Works with sync turned on from another device: show them in the list first, download on open.
      await store.putWork({
        id: info.id,
        name: info.name,
        account,
        createdAt: info.updatedAt,
        updatedAt: info.updatedAt,
        openedAt: 0,
        cloud: {baseVersion: info.version, dirty: false, downloaded: false, rev: 0},
      });
      continue;
    }
    if (!local.cloud || local.account !== account) continue;
    if (local.cloud.dirty || info.version <= local.cloud.baseVersion) continue;
    if (local.cloud.downloaded) await download(session, info.id);
    else {
      await store.updateWork(info.id, (work) =>
        work.cloud && !work.cloud.dirty
          ? {meta: {...work, name: info.name, updatedAt: info.updatedAt, cloud: {...work.cloud, baseVersion: info.version}}}
          : null,
      );
    }
  }

  // Works no longer in the cloud: deleted elsewhere, or sync was turned off.
  for (const local of locals.values()) {
    if (local.account !== account || !local.cloud || local.cloud.baseVersion === 0 || remoteIds.has(local.id)) continue;
    await detachFromCloud(local.id);
  }
}

/**
 * The cloud copy is gone. If this device has changes that weren't uploaded, keep them as a local copy; otherwise clear the cache along with it.
 * The copy gets a new id, so it won't collide if the same work has sync turned on again later.
 */
async function detachFromCloud(id: string) {
  const work = await store.getWork(id);
  if (!work?.cloud) return;
  const scene = await store.getScene(id);
  if (work.cloud.downloaded && work.cloud.dirty && scene) {
    const copy: WorkMeta = {...work, id: newId(), name: t("name.localCopy", {name: work.name}), cloud: null};
    await store.writeBatch([{put: copy, scene}, {remove: id}]);
    if (getState().currentId === id) {
      await store.kvSet("lastOpened", copy.id);
      setState({works: await store.allWorks(), currentId: copy.id, loadNonce: getState().loadNonce + 1});
    }
    notify({
      kind: "warning",
      title: t("sync.cloudRemovedTitle", {name: work.name}),
      description: t("sync.cloudRemovedBody"),
      sticky: true,
    });
  } else {
    await store.deleteWork(id);
    if (getState().currentId === id) {
      notify({kind: "info", title: t("sync.removedElsewhere", {name: work.name})});
    }
  }
}

async function pushDirty(session: Session) {
  const account = session.user.id;
  for (const work of await store.allWorks()) {
    if (work.account === account && work.cloud?.dirty && work.cloud.downloaded) await pushOne(session, work.id);
  }
}

async function pushOne(session: Session, id: string, rebased = false): Promise<void> {
  const work = await store.getWork(id);
  const scene = await store.getScene(id);
  if (!work?.cloud || !scene) return;
  const {rev, baseVersion} = work.cloud;
  const device = await deviceId();
  // mutationId stays the same when retrying the same content, so the server only ever creates one version.
  const mutationId = `${device}:${rev}`;
  try {
    const {version} = await api.pushWork(session.token, id, {
      name: work.name,
      snapshot: serializeDocument(work.name, scene),
      baseVersion,
      mutationId,
    });
    await store.updateWork(id, (current) =>
      current.cloud
        ? {meta: {...current, cloud: {...current.cloud, baseVersion: version, dirty: current.cloud.rev !== rev}}}
        : null,
    );
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.code === "conflict") {
      const conflict = error.body as PushConflict & {error: string};
      // The latest cloud version is the one this device submitted (the previous response was lost): not a conflict, keep submitting on top of it.
      if (!rebased && conflict.mutationId.startsWith(`${device}:`)) {
        await store.updateWork(id, (current) =>
          current.cloud ? {meta: {...current, cloud: {...current.cloud, baseVersion: conflict.version}}} : null,
        );
        return pushOne(session, id, true);
      }
      await keepConflictCopy(session, id);
    } else if (error.code === "gone" || error.code === "not_found") {
      await detachFromCloud(id);
    } else if (error.code === "too_large") {
      notify({kind: "warning", title: t("sync.tooLargeTitle", {name: work.name}), description: t("sync.tooLargeBody")});
    } else {
      throw error;
    }
  }
}

/**
 * Another device submitted first. The cloud version stays untouched, and this device's late changes are saved as a separate copy.
 * The copy and "original work goes back to awaiting download" complete in the same transaction, so a retry won't create a second copy.
 */
async function keepConflictCopy(session: Session, id: string) {
  const work = await store.getWork(id);
  const scene = await store.getScene(id);
  if (!work?.cloud?.dirty || !scene) return;
  const now = Date.now();
  const copy: WorkMeta = {...work, id: newId(), name: t("name.conflictCopy", {name: work.name}), cloud: null, createdAt: now, updatedAt: now, openedAt: now - 1};
  await store.writeBatch([
    {put: copy, scene},
    {put: {...work, cloud: {...work.cloud, dirty: false, downloaded: false}}, scene: "delete"},
  ]);
  const wasOpen = getState().currentId === id;
  const downloaded = await download(session, id).catch(() => false);
  if (wasOpen && !downloaded) {
    await store.kvSet("lastOpened", copy.id);
    setState({works: await store.allWorks(), currentId: copy.id, loadNonce: getState().loadNonce + 1});
  }
  notify({
    kind: "warning",
    title: t("sync.conflictTitle", {name: work.name}),
    description: t("sync.conflictBody", {copy: copy.name}),
    sticky: true,
    action: {label: t("sync.openCopy"), run: () => void openLocalWork(copy.id)},
  });
}

/** Download the cloud version and replace the local content. Doesn't overwrite when this device has changes that weren't uploaded. */
async function download(session: Session, id: string): Promise<boolean> {
  const remote = await api.getWork(session.token, id);
  let parsed;
  try {
    parsed = parseDocument(remote.snapshot);
  } catch (error) {
    if (!(error instanceof EaselFileError)) throw error;
    notify({kind: "warning", title: t("sync.unsupported", {name: remote.name}), description: error.message});
    return false;
  }
  // The canvas may still hold a few unpersisted strokes: write them down first. That makes the work "pending", so the code below won't overwrite it.
  if (getState().currentId === id) await editor.flush();
  const previous = await store.getScene(id);
  const updated = await store.updateWork(id, (work) => {
    if (!work.cloud || work.cloud.dirty) return null;
    return {
      meta: {
        ...work,
        name: remote.name,
        updatedAt: remote.updatedAt,
        cloud: {...work.cloud, baseVersion: remote.version, downloaded: true, dirty: false},
      },
      // The viewport is each device's own reading position; keep the existing one if there is one.
      scene: {...parsed.scene, view: previous?.view ?? parsed.scene.view},
    };
  });
  if (!updated) return false;
  if (getState().currentId === id) setState({works: await store.allWorks(), loadNonce: getState().loadNonce + 1});
  return true;
}

// ---------- User actions ----------

/** Open a work; download it first if it hasn't been downloaded yet. */
export async function openWork(id: string): Promise<boolean> {
  const work = getState().works.find((item) => item.id === id);
  if (!work || !canOpenWork(work)) return false;
  if (work.cloud && !work.cloud.downloaded) {
    const session = activeSession();
    if (!session || !getState().online) {
      notify({kind: "info", title: t("sync.notDownloadedTitle"), description: session || !getState().session ? t("sync.notDownloadedOffline") : t("sync.notDownloadedSignIn")});
      return false;
    }
    try {
      if (!(await download(session, id))) return false;
    } catch (error) {
      if (error instanceof ApiError && error.code === "unauthorized") await expireSession();
      else if (error instanceof ApiError && (error.code === "not_found" || error.code === "gone")) {
        await detachFromCloud(id);
        await refreshWorks();
        notify({kind: "info", title: t("sync.currentRemovedElsewhere")});
      } else notify({kind: "warning", title: t("sync.downloadFailed"), description: t("error.checkNetwork")});
      return false;
    }
    await refreshWorks();
  }
  return openLocalWork(id);
}

export async function enableSync(id: string) {
  const session = getState().session;
  if (!session) return;
  await store.updateWork(id, (work) =>
    work.cloud ? null : {meta: {...work, account: session.user.id, cloud: {baseVersion: 0, dirty: true, downloaded: true, rev: 1}}},
  );
  await refreshWorks();
  void syncNow();
}

/** Turn off sync: remove the cloud copy and keep the work on this device. Must be done online. */
export async function disableSync(id: string): Promise<boolean> {
  const session = activeSession();
  const work = await store.getWork(id);
  if (!work?.cloud) return true;
  if (!session || !getState().online) {
    notify({kind: "info", title: t("sync.offNeedsOnlineTitle"), description: t("sync.offNeedsOnlineBody")});
    return false;
  }
  await running;
  try {
    if (work.cloud.baseVersion > 0) await api.deleteWork(session.token, id);
  } catch (error) {
    if (error instanceof ApiError && error.code === "unauthorized") {
      await expireSession();
      return false;
    }
    if (!(error instanceof ApiError) || (error.code !== "not_found" && error.code !== "gone")) {
      notify({kind: "warning", title: t("sync.offFailed"), description: t("error.checkNetwork")});
      return false;
    }
  }
  await store.updateWork(id, (current) => ({meta: {...current, account: null, cloud: null}}));
  await refreshWorks();
  return true;
}

export async function refreshQuota() {
  const session = activeSession();
  if (!session || !getState().online) return;
  try {
    setState({quota: await api.quota(session.token)});
  } catch (error) {
    if (error instanceof ApiError && error.code === "unauthorized") await expireSession();
  }
}

export {activeSession, expireSession};
