import { STATUSES, TYPES, statusByKey, typeByKey, newNode } from "./model.js";

/* Markdown import/export: nested bullets ↔ tree. A type emoji is expected at
   the START of an item, a status emoji at the END, **bold** marks importance.
   Both emoji positions tolerate common variants (missing variation selector,
   other coder emojis). */

const TYPE_VARIANTS = {
  call: ["☎️", "☎"],
  coding: ["👩🏻‍💻", "👩‍💻", "🧑🏻‍💻", "🧑‍💻", "👨🏻‍💻", "👨‍💻"],
  docs: ["✍🏻", "✍🏼", "✍🏽", "✍🏾", "✍🏿", "✍️", "✍"],
  research: ["🧐"],
};
function stripType(title) {
  for (const t of TYPES) {
    for (const v of TYPE_VARIANTS[t.key] ?? [t.emoji]) {
      if (title.startsWith(v)) return { key: t.key, title: title.slice(v.length).trim() };
    }
  }
  return null;
}
function stripStatus(title) {
  for (const s of STATUSES) {
    const variants = [...new Set([s.emoji, s.emoji.replace(/️/g, "")])];
    for (const v of variants) {
      if (!title.endsWith(v)) continue;
      const rest = title.slice(0, -v.length);
      if (rest.endsWith("‍")) continue; // 💻 that is part of a 👩🏻‍💻-style sequence
      return { key: s.key, title: rest.trim() };
    }
  }
  return null;
}

// **Bold** anywhere in a title marks the task important; returns the title
// with the markers stripped, or null when there is no bold span.
function stripBold(title) {
  if (!/\*\*(.+?)\*\*/.test(title)) return null;
  return title.replace(/\*\*(.+?)\*\*/g, "$1").trim();
}

// Migrate docs saved by earlier versions (status "call" → type, missing
// type/important fields, literal ** markers left in stored titles, no
// createdAt). Nodes saved before created times existed are stamped with the
// migration time, so nothing ages into the Backlog on the first load.
export function migrateNodes(nodes, now = Date.now()) {
  return nodes.map((n) => {
    let { title, status = null, type = null, important = false, createdAt, doneAt } = n;
    if (status === "call") { type = type ?? "call"; status = null; }
    if (status && !statusByKey[status]) status = null;
    const bolded = stripBold(title);
    if (bolded !== null) { important = true; title = bolded || "Untitled"; }
    if (typeof createdAt !== "number") createdAt = now;
    // Tasks finished before leaf-fall existed start their fade clock now, so
    // the first open after the update doesn't shower away the whole history.
    if (status !== "done") doneAt = null;
    else if (typeof doneAt !== "number") doneAt = now;
    return {
      ...n, title, status, type, important, createdAt, doneAt,
      blockedBy: Array.isArray(n.blockedBy) ? n.blockedBy : [],
      children: migrateNodes(n.children || [], now),
    };
  });
}

// Pull a trailing `^id` marker (written by toMarkdown's id mode) off a title,
// so it survives a round-trip instead of being read as part of the title.
function stripId(title) {
  const m = title.match(/\s+\^(\S+)$/);
  if (!m) return null;
  return { id: m[1], title: title.slice(0, m.index).trim() };
}

export function parseMarkdown(text) {
  const roots = [];
  const stack = []; // {indent, node}
  let last = null;
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    // bullets (- * +) and numbered items (1. / 1)) are interchangeable
    const bullet = raw.match(/^([ \t]*)(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s*)?(.*)$/);
    if (bullet) {
      const indent = bullet[1].replace(/\t/g, "  ").length;
      let title = bullet[3].trim();
      let status = bullet[2] && bullet[2].toLowerCase() === "x" ? "done" : null;
      let type = null;
      let important = false;
      let id = null;
      const idm = stripId(title);
      if (idm) { id = idm.id; title = idm.title; }
      const bolded = stripBold(title);
      if (bolded !== null) { important = true; title = bolded; }
      const ty = stripType(title);
      if (ty) { type = ty.key; title = ty.title; }
      const st = stripStatus(title);
      if (st) { status = st.key; title = st.title; }
      if (!title) title = "Untitled";
      const node = newNode(title, status, type, important);
      if (id) node.id = id;
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      if (stack.length) stack[stack.length - 1].node.children.push(node);
      else roots.push(node);
      stack.push({ indent, node });
      last = node;
      continue;
    }
    // `⛓ blocked-by: ^id ^id` metadata line (written by toMarkdown's id mode)
    const blk = raw.match(/^[ \t]*⛓\s*blocked-by:\s*(.*)$/);
    if (blk && last) {
      const ids = blk[1].split(/\s+/).map((x) => x.replace(/^\^/, "")).filter(Boolean);
      last.blockedBy = [...(last.blockedBy || []), ...ids];
      continue;
    }
    const descLine = raw.match(/^[ \t]*>\s?(.*)$/);
    if (descLine && last) {
      last.desc = last.desc ? last.desc + "\n" + descLine[1] : descLine[1];
    }
  }
  return roots;
}

// `opts.ids` writes a trailing `^id` marker on each bullet and a
// `⛓ blocked-by:` line for its dependencies, so the file round-trips losslessly
// (stable ids + cross-tree links) — used for the bidirectional agent-sync file.
// Left off by default so the human export stays clean.
export function toMarkdown(nodes, depth = 0, opts = {}) {
  let out = "";
  const pad = "  ".repeat(depth);
  for (const n of nodes) {
    const t = n.type && typeByKey[n.type] ? typeByKey[n.type].emoji + " " : "";
    const s = n.status && statusByKey[n.status] ? " " + statusByKey[n.status].emoji : "";
    const id = opts.ids && n.id ? ` ^${n.id}` : "";
    out += `${pad}- ${t}${n.important ? `**${n.title}**` : n.title}${s}${id}\n`;
    if (opts.ids && n.blockedBy?.length)
      out += `${pad}  ⛓ blocked-by:${n.blockedBy.map((b) => " ^" + b).join("")}\n`;
    if (n.desc) for (const line of n.desc.split("\n")) out += `${pad}  > ${line}\n`;
    if (n.children?.length) out += toMarkdown(n.children, depth + 1, opts);
  }
  return out;
}

// Reconcile a freshly-parsed file against the tree already in memory: the file
// is authoritative for structure/title/status/type/importance/desc/blockedBy,
// but the lifecycle clocks (createdAt, doneAt) are carried over from the node
// with the same id so a round-trip doesn't reset the leaf-fall / graduation
// timers. A node whose id isn't found is new (keeps the createdAt newNode gave
// it); doneAt is stamped now when the file marks a node done that wasn't before.
export function mergeById(parsed, existing, now = Date.now()) {
  const prev = new Map();
  const index = (nodes) => { for (const n of nodes) { prev.set(n.id, n); index(n.children); } };
  index(existing);
  const walk = (nodes) => nodes.map((n) => {
    const old = prev.get(n.id);
    const createdAt = old ? old.createdAt : n.createdAt;
    const doneAt = n.status === "done" ? (old && old.doneAt ? old.doneAt : now) : null;
    return { ...n, createdAt, doneAt, children: walk(n.children) };
  });
  return walk(parsed);
}

// Nodes in `parsed` whose id isn't anywhere in `existing`, i.e. added externally.
export function countNew(parsed, existing) {
  const ids = new Set();
  const index = (nodes) => { for (const n of nodes) { ids.add(n.id); index(n.children); } };
  index(existing);
  const count = (nodes) => nodes.reduce((c, n) => c + (ids.has(n.id) ? 0 : 1) + count(n.children), 0);
  return count(parsed);
}

export const SAMPLE_MD = `- Plan the garden 💻
  > Sketch what goes where before buying anything.
  - Measure the plot ✅
  - Choose plants 💻
    - Shortlist herbs ✅
    - Pick two shade-tolerant flowers ⏭️
    - ☎️ Ask neighbor which soil mix worked ❓
  - Order raised beds 🧱
    > Waiting for choices above.
- **Renew passport** ⏳
  - ☎️ Call the office for an appointment
  - Print photos
- 👩🏻‍💻 Automate the monthly report ⏭️
- Write monthly review`;
