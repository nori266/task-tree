/* Task Tree data model: status/type vocabularies and immutable tree helpers. */

export const DEFAULT_STATUSES = [
  { key: "inprogress", emoji: "💻", label: "In progress", color: "#4F836B" },
  { key: "waiting",    emoji: "⏳", label: "Waiting to start", color: "#A08D5F" },
  { key: "next",       emoji: "⏭️", label: "Will do next", color: "#5B7FA6" },
  { key: "done",       emoji: "✅", label: "Done", color: "#93A697" },
  { key: "question",   emoji: "❓", label: "Needs external input", color: "#8A6FA6" },
];
export const DEFAULT_TYPES = [
  { key: "call",     emoji: "☎️", label: "Call" },
  { key: "coding",   emoji: "👩🏻‍💻", label: "Coding" },
  { key: "docs",     emoji: "✍🏻", label: "Docs" },
  { key: "research", emoji: "🧐", label: "Research" },
];

// Keyword rules for guessing a task's type from its title. `starts` matches a
// prefix (so "recall" won't be a call); `has` matches anywhere. Keyed by type
// key; custom types simply have no rule and are never predicted.
export const TYPE_KEYWORDS = {
  call:     { starts: ["call", "discuss", "talk to", "book a call"], has: [] },
  coding:   { starts: ["implement", "fix", "build", "refactor", "debug", "add "], has: [] },
  docs:     { starts: ["write", "document"], has: ["docs", "readme"] },
  research: { starts: ["find out", "research", "investigate", "look into", "figure out", "explore"], has: [] },
};

// Status keys the app's own logic keys off (done drives the whole leaf-fall /
// graduation lifecycle; inprogress/next tint the links). They may be relabelled
// and recoloured, but not removed or re-keyed.
export const PROTECTED_STATUS_KEYS = ["done", "inprogress", "next"];

const clone = (arr) => arr.map((x) => ({ ...x }));

/* The live vocabulary. These are `let` so the customizer can replace them at
   runtime via setVocab(); every consumer imports the binding (not a snapshot),
   so a swap is seen everywhere on the next render. */
export let STATUSES = clone(DEFAULT_STATUSES);
export let TYPES = clone(DEFAULT_TYPES);
export let statusByKey = Object.fromEntries(STATUSES.map((s) => [s.key, s]));
export let typeByKey = Object.fromEntries(TYPES.map((t) => [t.key, t]));

export function setVocab({ types, statuses } = {}) {
  if (Array.isArray(types)) TYPES = types;
  if (Array.isArray(statuses)) STATUSES = statuses;
  statusByKey = Object.fromEntries(STATUSES.map((s) => [s.key, s]));
  typeByKey = Object.fromEntries(TYPES.map((t) => [t.key, t]));
}

// Guess a type key from a title using TYPE_KEYWORDS, or null if nothing
// matches. Iterates live TYPES so only existing keys are returned and their
// order sets priority when several rules could match.
export function predictType(title) {
  const t = (title || "").trim().toLowerCase();
  if (!t) return null;
  for (const type of TYPES) {
    const rule = TYPE_KEYWORDS[type.key];
    if (!rule) continue;
    if ((rule.starts || []).some((k) => t.startsWith(k))) return type.key;
    if ((rule.has || []).some((k) => t.includes(k))) return type.key;
  }
  return null;
}

let vocabKeyCounter = 1;
export const newTypeKey = () => `t${Date.now().toString(36)}_${vocabKeyCounter++}`;
export const newStatusKey = () => `s${Date.now().toString(36)}_${vocabKeyCounter++}`;

let idCounter = 1;
const nid = () => `n${Date.now().toString(36)}_${idCounter++}`;
export const newNode = (title = "New task", status = null, type = null, important = false) => ({
  id: nid(), title, desc: "", status, type, important, createdAt: Date.now(),
  doneAt: status === "done" ? Date.now() : null, blockedBy: [], children: [],
});

/* ---------- immutable tree helpers ---------- */

export const mapTree = (nodes, fn) =>
  nodes.map((n) => {
    const m = fn(n);
    return { ...m, children: m.children ? mapTree(m.children, fn) : [] };
  });

export const updateNode = (nodes, id, patch) =>
  mapTree(nodes, (n) => (n.id === id ? { ...n, ...patch } : n));

export const addChild = (nodes, parentId, child) =>
  mapTree(nodes, (n) =>
    n.id === parentId ? { ...n, children: [...n.children, child] } : n
  );

export function removeNode(nodes, id) {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => ({ ...n, children: removeNode(n.children, id) }));
}

/* ---------- cross-tree dependencies (blocked-by links) ---------- */

// `id` gains a dependency on `blockerId` — it is blocked by it. No self-links,
// no duplicates.
export const addDep = (nodes, id, blockerId) =>
  mapTree(nodes, (n) =>
    n.id === id && id !== blockerId && !(n.blockedBy || []).includes(blockerId)
      ? { ...n, blockedBy: [...(n.blockedBy || []), blockerId] }
      : n
  );

export const removeDep = (nodes, id, blockerId) =>
  mapTree(nodes, (n) =>
    n.id === id ? { ...n, blockedBy: (n.blockedBy || []).filter((b) => b !== blockerId) } : n
  );

export function collectIds(nodes, acc = new Set()) {
  for (const n of nodes) { acc.add(n.id); collectIds(n.children, acc); }
  return acc;
}

// Drop blocked-by references whose target no longer lives in the tree, so a
// deleted task doesn't leave dangling links behind.
export const pruneDeps = (nodes) => {
  const ids = collectIds(nodes);
  return mapTree(nodes, (n) =>
    n.blockedBy && n.blockedBy.some((b) => !ids.has(b))
      ? { ...n, blockedBy: n.blockedBy.filter((b) => ids.has(b)) }
      : n
  );
};

export function findNode(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    const f = findNode(n.children, id);
    if (f) return f;
  }
  return null;
}

export const countNodes = (nodes) =>
  nodes.reduce((a, n) => a + 1 + countNodes(n.children), 0);
export const countDone = (nodes) =>
  nodes.reduce((a, n) => a + (n.status === "done" ? 1 : 0) + countDone(n.children), 0);
// Leaf tasks (tips with no children) still present in the subtree.
export const countLeaves = (nodes) =>
  nodes.reduce((a, n) => a + (n.children.length ? countLeaves(n.children) : 1), 0);
