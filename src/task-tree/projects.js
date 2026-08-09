import { parseMarkdown, SAMPLE_MD } from "./markdown.js";

/* Multiple projects, each a self-contained workspace (doc + forest + backlog +
   litter). This module owns the persistence layout: an index of projects, the
   active project id, and the per-project storage keys. The stores themselves
   are still driven by TaskTreeApp — here we only build keys and handle the
   one-time migration from the original single-tree layout. */

export const INDEX_KEY = "tasktree:projects";
export const ACTIVE_KEY = "tasktree:activeProject";

const LEGACY = {
  doc: "tasktree:doc",
  forest: "tasktree:forest",
  backlog: "tasktree:backlog",
  litter: "tasktree:litter",
};

let idCounter = 1;
export const newProjectId = () => `p${Date.now().toString(36)}_${idCounter++}`;

const keyFor = (id, store) => `tasktree:project:${id}:${store}`;
export const docKey = (id) => keyFor(id, "doc");
export const forestKey = (id) => keyFor(id, "forest");
export const backlogKey = (id) => keyFor(id, "backlog");
export const litterKey = (id) => keyFor(id, "litter");

// window.storage.get throws when a key is absent; treat that as "no value".
async function getRaw(storage, key) {
  try {
    const res = await storage.get(key);
    return res?.value ?? null;
  } catch (e) {
    return null;
  }
}

function seedDoc() {
  return { title: "My tasks", children: parseMarkdown(SAMPLE_MD) };
}

/* Resolve the projects index on startup, migrating older layouts in place.
   - index already present  → return it (and a valid active id) untouched;
   - legacy single-tree data → wrap it as one project, move its four blobs to
     per-project keys, drop the legacy keys;
   - nothing at all         → seed one project from the sample.
   Returns { projects: [{id, title}], activeId }. */
export async function migrateLegacy(storage) {
  const indexRaw = await getRaw(storage, INDEX_KEY);
  if (indexRaw) {
    let projects = [];
    try { projects = JSON.parse(indexRaw); } catch (e) { projects = []; }
    if (Array.isArray(projects) && projects.length) {
      const active = await getRaw(storage, ACTIVE_KEY);
      const activeId = projects.some((p) => p.id === active) ? active : projects[0].id;
      await storage.set(ACTIVE_KEY, activeId);
      return { projects, activeId };
    }
  }

  const id = newProjectId();
  const legacyDoc = await getRaw(storage, LEGACY.doc);
  let title = "My tasks";
  if (legacyDoc) {
    try {
      const parsed = JSON.parse(legacyDoc);
      if (parsed?.title) title = parsed.title;
    } catch (e) { /* fall through to the seed below */ }
  }

  if (legacyDoc) {
    // move the four global blobs verbatim onto the project's keys
    for (const [store, legacyKey] of Object.entries(LEGACY)) {
      const raw = await getRaw(storage, legacyKey);
      if (raw !== null) await storage.set(keyFor(id, store), raw);
      await storage.delete(legacyKey).catch(() => {});
    }
  } else {
    await storage.set(docKey(id), JSON.stringify(seedDoc()));
  }

  const projects = [{ id, title }];
  await storage.set(INDEX_KEY, JSON.stringify(projects));
  await storage.set(ACTIVE_KEY, id);
  return { projects, activeId: id };
}
