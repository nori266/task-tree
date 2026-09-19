/* Persist the sync FileSystemFileHandle across reloads. Handles are
   structured-cloneable but not strings, so they can't live in the
   localStorage-backed window.storage — a tiny IndexedDB store holds them,
   keyed by project id. Re-reading a restored handle still needs a permission
   re-grant, which must happen from a user gesture (verifyPermission). */

const DB = "tasktree";
const STORE = "handles";

function withStore(mode, fn) {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("no IndexedDB"));
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { resolve(req?.result); db.close(); };
      tx.onerror = () => { reject(tx.error); db.close(); };
    };
  });
}

export const saveHandle = (projectId, handle) =>
  withStore("readwrite", (s) => s.put(handle, projectId)).catch(() => {});

export const loadHandle = (projectId) =>
  withStore("readonly", (s) => s.get(projectId)).catch(() => null);

export const deleteHandle = (projectId) =>
  withStore("readwrite", (s) => s.delete(projectId)).catch(() => {});

/* Drop every stored handle. A backup restore replaces all projects, and ids are
   reused across backups, so a surviving handle would re-attach the old linked
   file to whatever project now holds that id. */
export const clearHandles = () =>
  withStore("readwrite", (s) => s.clear()).catch(() => {});

// Ensure we may read/write the handle, prompting if needed. Must be called from
// a user gesture when it would prompt. Returns true when access is granted.
export async function verifyPermission(handle, write = true) {
  const opts = { mode: write ? "readwrite" : "read" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}
