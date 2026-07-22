/* Task Tree data model: status/type vocabularies and immutable tree helpers. */

export const STATUSES = [
  { key: "inprogress", emoji: "💻", label: "In progress", color: "#4F836B" },
  { key: "waiting",    emoji: "⏳", label: "Waiting to start", color: "#A08D5F" },
  { key: "next",       emoji: "⏭️", label: "Will do next", color: "#5B7FA6" },
  { key: "done",       emoji: "✅", label: "Done", color: "#93A697" },
  { key: "question",   emoji: "❓", label: "Needs external input", color: "#8A6FA6" },
];
export const TYPES = [
  { key: "call",     emoji: "☎️", label: "Call" },
  { key: "coding",   emoji: "👩🏻‍💻", label: "Coding" },
  { key: "docs",     emoji: "✍🏻", label: "Docs" },
  { key: "research", emoji: "🧐", label: "Research" },
];
export const statusByKey = Object.fromEntries(STATUSES.map((s) => [s.key, s]));
export const typeByKey = Object.fromEntries(TYPES.map((t) => [t.key, t]));

let idCounter = 1;
const nid = () => `n${Date.now().toString(36)}_${idCounter++}`;
export const newNode = (title = "New task", status = null, type = null, important = false) => ({
  id: nid(), title, desc: "", status, type, important, children: [],
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
