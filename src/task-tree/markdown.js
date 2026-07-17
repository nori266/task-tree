import { STATUSES, TYPES, statusByKey, typeByKey, newNode } from "./model.js";

/* Markdown import/export: nested bullets ↔ tree. A type emoji is expected at
   the START of an item, a status emoji at the END, **bold** marks importance.
   Both emoji positions tolerate common variants (missing variation selector,
   other coder emojis). */

const TYPE_VARIANTS = {
  call: ["☎️", "☎"],
  coding: ["👩🏻‍💻", "👩‍💻", "🧑🏻‍💻", "🧑‍💻", "👨🏻‍💻", "👨‍💻"],
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
// type/important fields, literal ** markers left in stored titles).
export function migrateNodes(nodes) {
  return nodes.map((n) => {
    let { title, status = null, type = null, important = false } = n;
    if (status === "call") { type = type ?? "call"; status = null; }
    if (status && !statusByKey[status]) status = null;
    const bolded = stripBold(title);
    if (bolded !== null) { important = true; title = bolded || "Untitled"; }
    return { ...n, title, status, type, important, children: migrateNodes(n.children || []) };
  });
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
      const bolded = stripBold(title);
      if (bolded !== null) { important = true; title = bolded; }
      const ty = stripType(title);
      if (ty) { type = ty.key; title = ty.title; }
      const st = stripStatus(title);
      if (st) { status = st.key; title = st.title; }
      if (!title) title = "Untitled";
      const node = newNode(title, status, type, important);
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      if (stack.length) stack[stack.length - 1].node.children.push(node);
      else roots.push(node);
      stack.push({ indent, node });
      last = node;
      continue;
    }
    const descLine = raw.match(/^[ \t]*>\s?(.*)$/);
    if (descLine && last) {
      last.desc = last.desc ? last.desc + "\n" + descLine[1] : descLine[1];
    }
  }
  return roots;
}

export function toMarkdown(nodes, depth = 0) {
  let out = "";
  const pad = "  ".repeat(depth);
  for (const n of nodes) {
    const t = n.type && typeByKey[n.type] ? typeByKey[n.type].emoji + " " : "";
    const s = n.status && statusByKey[n.status] ? " " + statusByKey[n.status].emoji : "";
    out += `${pad}- ${t}${n.important ? `**${n.title}**` : n.title}${s}\n`;
    if (n.desc) for (const line of n.desc.split("\n")) out += `${pad}  > ${line}\n`;
    if (n.children?.length) out += toMarkdown(n.children, depth + 1);
  }
  return out;
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
