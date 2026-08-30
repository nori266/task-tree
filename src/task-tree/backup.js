import {
  INDEX_KEY, ACTIVE_KEY, VOCAB_KEY,
  docKey, forestKey, backlogKey, litterKey, getRaw,
} from "./projects.js";

/* Whole-app snapshot: a single JSON dump of every project's four stores plus the
   app-wide index, active id and vocab — a complete, lossless backup that survives
   a localStorage wipe (unlike the human-readable markdown sync, which carries
   only the active tree). Restore is a replace-all: it clears the existing
   tasktree keys before writing, so removed projects don't linger. */

export const SCHEMA_VERSION = 1;
const KEY_PREFIX = "tasktree:";

const parse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; } };

export async function buildSnapshot(storage, now = Date.now()) {
  const projects = parse(await getRaw(storage, INDEX_KEY)) ?? [];
  const activeId = await getRaw(storage, ACTIVE_KEY);
  const vocab = parse(await getRaw(storage, VOCAB_KEY));
  const snapshotProjects = [];
  for (const p of projects) {
    snapshotProjects.push({
      id: p.id,
      title: p.title,
      color: p.color ?? null,
      doc: parse(await getRaw(storage, docKey(p.id))),
      forest: parse(await getRaw(storage, forestKey(p.id))),
      backlog: parse(await getRaw(storage, backlogKey(p.id))),
      litter: parse(await getRaw(storage, litterKey(p.id))),
    });
  }
  return { version: SCHEMA_VERSION, exportedAt: now, activeId, vocab, projects: snapshotProjects };
}

export function validateSnapshot(snap) {
  if (!snap || typeof snap !== "object") throw new Error("not a Task Tree backup");
  if (snap.version !== SCHEMA_VERSION) throw new Error(`unsupported backup version: ${snap.version}`);
  if (!Array.isArray(snap.projects)) throw new Error("backup has no projects");
  return snap;
}

export async function restoreSnapshot(storage, snap) {
  validateSnapshot(snap);
  const { keys } = await storage.list(KEY_PREFIX);
  for (const k of keys) await storage.delete(k);

  const index = snap.projects.map((p) => ({
    id: p.id, title: p.title, ...(p.color ? { color: p.color } : {}),
  }));
  await storage.set(INDEX_KEY, JSON.stringify(index));
  if (snap.activeId) await storage.set(ACTIVE_KEY, snap.activeId);
  if (snap.vocab) await storage.set(VOCAB_KEY, JSON.stringify(snap.vocab));

  for (const p of snap.projects) {
    const put = (key, val) => (val != null ? storage.set(key, JSON.stringify(val)) : null);
    await put(docKey(p.id), p.doc);
    await put(forestKey(p.id), p.forest);
    await put(backlogKey(p.id), p.backlog);
    await put(litterKey(p.id), p.litter);
  }
}
