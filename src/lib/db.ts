// Local storage: work metadata, canvas content and a few device-level settings all live in IndexedDB.
import {openDB, type DBSchema, type IDBPDatabase} from "idb";
import type {Scene, StoredScene, WorkMeta} from "./types.ts";

interface EaselDB extends DBSchema {
  works: {key: string; value: WorkMeta};
  scenes: {key: string; value: StoredScene};
  kv: {key: string; value: unknown};
}

let dbPromise: Promise<IDBPDatabase<EaselDB>> | null = null;

export function db(): Promise<IDBPDatabase<EaselDB>> {
  dbPromise ??= openDB<EaselDB>("easel", 1, {
    upgrade(database) {
      database.createObjectStore("works", {keyPath: "id"});
      database.createObjectStore("scenes", {keyPath: "id"});
      database.createObjectStore("kv");
    },
  });
  return dbPromise;
}

/** Test only: drop the connection so the next call reopens the database. */
export async function resetDbForTests() {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

export async function allWorks(): Promise<WorkMeta[]> {
  return (await db()).getAll("works");
}

export async function getWork(id: string): Promise<WorkMeta | undefined> {
  return (await db()).get("works", id);
}

export async function getScene(id: string): Promise<Scene | undefined> {
  const stored = await (await db()).get("scenes", id);
  if (!stored) return undefined;
  const {id: _id, ...scene} = stored;
  return scene;
}

/** Metadata and content are written in the same transaction, so a work is never left half-written. */
export async function putWork(meta: WorkMeta, scene?: Scene): Promise<void> {
  const tx = (await db()).transaction(["works", "scenes"], "readwrite");
  tx.objectStore("works").put(meta);
  if (scene) tx.objectStore("scenes").put({id: meta.id, ...scene});
  await tx.done;
}

export async function deleteWork(id: string): Promise<void> {
  const tx = (await db()).transaction(["works", "scenes"], "readwrite");
  tx.objectStore("works").delete(id);
  tx.objectStore("scenes").delete(id);
  await tx.done;
}

/**
 * Read and modify a work within one read-write transaction. update returning null means abort.
 * Both sync and editor saves go through here, so neither overwrites the other with stale metadata.
 */
export async function updateWork(
  id: string,
  update: (meta: WorkMeta) => {meta: WorkMeta; scene?: Scene | "delete"} | null,
): Promise<WorkMeta | null> {
  const tx = (await db()).transaction(["works", "scenes"], "readwrite");
  const current = await tx.objectStore("works").get(id);
  if (!current) {
    await tx.done;
    return null;
  }
  const next = update(current);
  if (!next) {
    await tx.done;
    return null;
  }
  tx.objectStore("works").put(next.meta);
  if (next.scene === "delete") tx.objectStore("scenes").delete(id);
  else if (next.scene) tx.objectStore("scenes").put({id, ...next.scene});
  await tx.done;
  return next.meta;
}

/** Atomic write of multiple works, for changes such as conflict copies that must "either all happen or not happen at all". */
export async function writeBatch(
  ops: Array<{put: WorkMeta; scene?: Scene | "delete"} | {remove: string}>,
): Promise<void> {
  const tx = (await db()).transaction(["works", "scenes"], "readwrite");
  for (const op of ops) {
    if ("remove" in op) {
      tx.objectStore("works").delete(op.remove);
      tx.objectStore("scenes").delete(op.remove);
    } else {
      tx.objectStore("works").put(op.put);
      if (op.scene === "delete") tx.objectStore("scenes").delete(op.put.id);
      else if (op.scene) tx.objectStore("scenes").put({id: op.put.id, ...op.scene});
    }
  }
  await tx.done;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get("kv", key)) as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await db()).put("kv", value, key);
}

export async function kvDelete(key: string): Promise<void> {
  await (await db()).delete("kv", key);
}
