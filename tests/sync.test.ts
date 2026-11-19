// Exercises sign-in, sync and conflict handling end to end with the real server app (in-memory database) and fake-indexeddb.
import "fake-indexeddb/auto";
import {IDBFactory} from "fake-indexeddb";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {createApp} from "../server/app.ts";
import {openDatabase} from "../server/db.ts";
import * as store from "../src/lib/db.ts";
import {parseDocument, serializeDocument} from "../src/lib/file.ts";
import {getState, onNotice, resetStateForTests, setState, visibleWorks, type Notice} from "../src/lib/state.ts";
import {disableSync, enableSync, openWork, signOut, syncNow, verifyCode} from "../src/lib/sync.ts";
import {workStatus, type Scene} from "../src/lib/types.ts";
import {createWork, loadWorkspace, removeWork, saveScene} from "../src/lib/works.ts";

let app: ReturnType<typeof createApp>;
let codes: Record<string, string>;
let clock: number;
let online: boolean;
let notices: Notice[];
let requests: string[];

const sceneWith = (label: string): Scene => ({elements: [{id: label, type: "rectangle"}], files: {}, view: {scrollX: 0, scrollY: 0, zoom: 1}});

async function signIn(email: string) {
  await app.request("/api/auth/request", {method: "POST", body: JSON.stringify({email}), headers: {"content-type": "application/json"}});
  await verifyCode(email, codes[email]);
  await syncNow();
}

/** Simulates "another device": calls the server API directly. */
async function otherDevice(email: string) {
  clock += 61_000;
  await app.request("/api/auth/request", {method: "POST", body: JSON.stringify({email}), headers: {"content-type": "application/json"}});
  const res = await app.request("/api/auth/verify", {method: "POST", body: JSON.stringify({email, code: codes[email]}), headers: {"content-type": "application/json"}});
  const {token} = (await res.json()) as {token: string};
  const call = (method: string, path: string, body?: unknown) =>
    app.request(`/api${path}`, {method, body: body ? JSON.stringify(body) : undefined, headers: {authorization: `Bearer ${token}`, "content-type": "application/json"}});
  return {
    list: async () => ((await (await call("GET", "/works")).json()) as {works: Array<{id: string; version: number; name: string}>}).works,
    get: async (id: string) => (await (await call("GET", `/works/${id}`)).json()) as {version: number; snapshot: string; name: string},
    push: (id: string, baseVersion: number, label: string, mutationId = `other:${label}`) =>
      call("PUT", `/works/${id}`, {name: "作品", snapshot: serializeDocument("作品", sceneWith(label)), baseVersion, mutationId}),
    remove: (id: string) => call("DELETE", `/works/${id}`),
  };
}

beforeEach(async () => {
  await store.resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  resetStateForTests();
  codes = {};
  clock = 1_800_000_000_000;
  online = true;
  notices = [];
  requests = [];
  app = createApp({
    db: openDatabase(":memory:"),
    mailer: async (email, code) => void (codes[email] = code),
    ai: null,
    dailyQuota: 5,
    now: () => clock,
  });
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    if (!online) throw new TypeError("offline");
    requests.push(`${init?.method ?? "GET"} ${input}`);
    return app.request(input, init);
  });
  onNotice((notice) => notices.push(notice));
  await loadWorkspace();
});

describe("local workspace", () => {
  it("opens a blank work on first launch, then restores the last opened one", async () => {
    expect(visibleWorks()).toHaveLength(1);
    const first = getState().currentId!;
    const second = await createWork();
    await openWork(first);
    resetStateForTests();
    await loadWorkspace();
    expect(getState().currentId).toBe(first);
    await removeWork(first);
    expect(getState().currentId).toBe(second);
    await removeWork(second);
    expect(visibleWorks()).toHaveLength(1);
  });

  it("does not upload works that have sync turned off", async () => {
    await saveScene(getState().currentId!, sceneWith("local"), true);
    await signIn("a@example.com");
    expect(requests.filter((r) => r.startsWith("PUT"))).toEqual([]);
    expect(workStatus(visibleWorks()[0])).toBe("local");
  });
});

describe("cloud sync", () => {
  it("uploads once sync is turned on; another device can see and download it", async () => {
    const id = getState().currentId!;
    await saveScene(id, sceneWith("v1"), true);
    await signIn("a@example.com");
    await enableSync(id);
    await syncNow();
    expect(workStatus(visibleWorks()[0])).toBe("synced");
    const other = await otherDevice("a@example.com");
    const remote = await other.get(id);
    expect(parseDocument(remote.snapshot).scene.elements).toEqual(sceneWith("v1").elements);
  });

  it("works from other devices first show as needing a download, and are usable offline once opened", async () => {
    await signIn("a@example.com");
    const other = await otherDevice("a@example.com");
    await other.push("remote-work-1", 0, "from-other");
    await syncNow();
    const stub = visibleWorks().find((w) => w.id === "remote-work-1")!;
    expect(workStatus(stub)).toBe("remote");

    online = false;
    setState({online: false});
    expect(await openWork("remote-work-1")).toBe(false);

    online = true;
    setState({online: true});
    expect(await openWork("remote-work-1")).toBe(true);
    expect((await store.getScene("remote-work-1"))?.elements).toEqual(sceneWith("from-other").elements);
  });

  it("both devices edit: the cloud keeps the version that arrived first, and the local changes become the one and only conflict copy", async () => {
    const id = getState().currentId!;
    await signIn("a@example.com");
    await enableSync(id);
    await syncNow();
    const other = await otherDevice("a@example.com");

    online = false;
    setState({online: false});
    await saveScene(id, sceneWith("mine"), true);
    expect((await other.push(id, 1, "theirs")).status).toBe(200);

    online = true;
    setState({online: true});
    await syncNow();
    await syncNow();

    const works = visibleWorks();
    const copies = works.filter((w) => w.name.includes("冲突副本"));
    expect(copies).toHaveLength(1);
    expect((await store.getScene(copies[0].id))?.elements).toEqual(sceneWith("mine").elements);
    expect((await store.getScene(id))?.elements).toEqual(sceneWith("theirs").elements);
    expect(workStatus(works.find((w) => w.id === id)!)).toBe("synced");
    expect((await other.get(id)).version).toBe(2);
    expect(notices.some((n) => n.title.includes("另一台设备"))).toBe(true);
  });

  it("commit succeeded but the response was lost: retrying creates neither a new version nor a copy", async () => {
    const id = getState().currentId!;
    await signIn("a@example.com");
    await enableSync(id);
    await syncNow();
    await saveScene(id, sceneWith("v2"), true);

    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      const response = await realFetch(input, init);
      if (init?.method === "PUT") throw new TypeError("connection reset");
      return response;
    });
    await syncNow();
    expect(workStatus(visibleWorks().find((w) => w.id === id)!)).toBe("pending");

    // After the response was lost the user kept drawing a few more strokes
    await saveScene(id, sceneWith("v3"), true);
    vi.stubGlobal("fetch", realFetch);
    await syncNow();

    expect(visibleWorks().filter((w) => w.name.includes("副本"))).toEqual([]);
    const other = await otherDevice("a@example.com");
    const remote = await other.get(id);
    expect(remote.version).toBe(3);
    expect(parseDocument(remote.snapshot).scene.elements).toEqual(sceneWith("v3").elements);
  });

  it("after a cloud delete, un-uploaded changes on an offline device are kept as a local copy", async () => {
    const id = getState().currentId!;
    await signIn("a@example.com");
    await enableSync(id);
    await syncNow();
    const other = await otherDevice("a@example.com");

    online = false;
    setState({online: false});
    await saveScene(id, sceneWith("offline-edit"), true);
    await other.remove(id);
    online = true;
    setState({online: true});
    await syncNow();

    const works = visibleWorks();
    expect(works.find((w) => w.id === id)).toBeUndefined();
    const kept = works.find((w) => w.name.includes("本机副本"))!;
    expect(workStatus(kept)).toBe("local");
    expect((await store.getScene(kept.id))?.elements).toEqual(sceneWith("offline-edit").elements);
    expect(getState().currentId).toBe(kept.id);
    expect(await other.list()).toEqual([]);
  });

  it("turning sync off: removes the cloud copy, the work stays on this device", async () => {
    const id = getState().currentId!;
    await signIn("a@example.com");
    await enableSync(id);
    await syncNow();
    online = false;
    setState({online: false});
    expect(await disableSync(id)).toBe(false);
    online = true;
    setState({online: true});
    expect(await disableSync(id)).toBe(true);
    expect(workStatus(visibleWorks().find((w) => w.id === id)!)).toBe("local");
    expect(await (await otherDevice("a@example.com")).list()).toEqual([]);
    // After sync is turned back on, version numbers continue from where they left off
    await enableSync(id);
    await syncNow();
    expect((await (await otherDevice("a@example.com")).list())[0].version).toBe(3);
  });

  it("deleting a synced work while offline also removes the cloud copy once back online", async () => {
    const id = getState().currentId!;
    await signIn("a@example.com");
    await enableSync(id);
    await syncNow();
    online = false;
    setState({online: false});
    await removeWork(id);
    online = true;
    setState({online: true});
    await syncNow();
    expect(await (await otherDevice("a@example.com")).list()).toEqual([]);
    expect(visibleWorks().some((w) => w.id === id)).toBe(false);
  });

  it("session expired: keeps saving locally without losing changes, and syncs after signing in again", async () => {
    const id = getState().currentId!;
    await signIn("a@example.com");
    await enableSync(id);
    await syncNow();
    clock += 31 * 24 * 3600_000;
    await saveScene(id, sceneWith("after-expiry"), true);
    await syncNow();
    expect(getState().session?.expired).toBe(true);
    expect(workStatus(visibleWorks().find((w) => w.id === id)!)).toBe("pending");
    await signIn("a@example.com");
    expect(workStatus(visibleWorks().find((w) => w.id === id)!)).toBe("synced");
  });

  it("sign out or switch account: account works stay out of the guest's and other accounts' lists, and un-uploaded changes are restored when the original account returns", async () => {
    const localId = getState().currentId!;
    const syncedId = await createWork();
    await signIn("a@example.com");
    await enableSync(syncedId);
    await syncNow();
    online = false;
    setState({online: false});
    await saveScene(syncedId, sceneWith("unsent"), true);
    await signOut();
    online = true;
    setState({online: true});

    expect(visibleWorks().map((w) => w.id)).toEqual([localId]);
    expect(getState().currentId).toBe(localId);

    clock += 61_000;
    await signIn("b@example.com");
    expect(visibleWorks().map((w) => w.id)).toEqual([localId]);
    expect(await (await otherDevice("b@example.com")).list()).toEqual([]);

    await signOut();
    clock += 61_000;
    await signIn("a@example.com");
    const restored = visibleWorks().find((w) => w.id === syncedId)!;
    expect(workStatus(restored)).toBe("synced");
    const remote = await (await otherDevice("a@example.com")).get(syncedId);
    expect(parseDocument(remote.snapshot).scene.elements).toEqual(sceneWith("unsent").elements);
  });
});
