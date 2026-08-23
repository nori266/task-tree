import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseMarkdown, toMarkdown, migrateNodes } from "./markdown.js";
import {
  newNode, addChild, updateNode, removeNode, addDep, removeDep,
  dropDepsFor, pruneDeps, findNode, collectIds, statusByKey, typeByKey,
} from "./model.js";

/* Node-safe core for editing the linked markdown file from outside the browser
   (the CLI and, later, an MCP server both drive this). Every mutation goes
   through the same immutable helpers the app uses, so ids stay unique and no
   dangling blocked-by links survive. The file is the roots-level markdown the
   app syncs (no title line); ids and links are carried by toMarkdown's id mode. */

export function load(path) {
  if (!existsSync(path)) return [];
  return migrateNodes(parseMarkdown(readFileSync(path, "utf8")));
}

export function save(path, roots) {
  writeFileSync(path, toMarkdown(pruneDeps(roots), 0, { ids: true }));
}

const requireNode = (roots, id) => {
  if (!findNode(roots, id)) throw new Error(`task not found: ${id}`);
};

export function addTask(roots, { title, parent = null, status = null, type = null, important = false }) {
  if (!title || !title.trim()) throw new Error("a task needs a title");
  if (status && !statusByKey[status]) throw new Error(`unknown status: ${status}`);
  if (type && !typeByKey[type]) throw new Error(`unknown type: ${type}`);
  const node = newNode(title.trim(), status, type, important);
  if (parent) {
    if (!findNode(roots, parent)) throw new Error(`parent not found: ${parent}`);
    return { roots: addChild(roots, parent, node), id: node.id };
  }
  return { roots: [...roots, node], id: node.id };
}

export function setStatus(roots, id, status) {
  requireNode(roots, id);
  if (status && !statusByKey[status]) throw new Error(`unknown status: ${status}`);
  const doneAt = status === "done" ? Date.now() : null;
  let next = updateNode(roots, id, { status: status || null, doneAt });
  if (status === "done") next = dropDepsFor(next, id); // a done task no longer blocks or is blocked
  return next;
}

export function setFields(roots, id, patch) {
  requireNode(roots, id);
  const clean = {};
  if (patch.title != null) { if (!patch.title.trim()) throw new Error("title cannot be empty"); clean.title = patch.title.trim(); }
  if (patch.desc != null) clean.desc = patch.desc;
  if (patch.type !== undefined) {
    if (patch.type && !typeByKey[patch.type]) throw new Error(`unknown type: ${patch.type}`);
    clean.type = patch.type || null;
  }
  if (patch.important !== undefined) clean.important = !!patch.important;
  return updateNode(roots, id, clean);
}

export function move(roots, id, parent = null) {
  const node = findNode(roots, id);
  if (!node) throw new Error(`task not found: ${id}`);
  if (parent) {
    requireNode(roots, parent);
    if (parent === id || collectIds(node.children).has(parent))
      throw new Error("cannot move a task into itself or its own subtree");
  }
  const without = removeNode(roots, id);
  return parent ? addChild(without, parent, node) : [...without, node];
}

export function block(roots, id, blockerId) {
  requireNode(roots, id);
  requireNode(roots, blockerId);
  if (id === blockerId) throw new Error("a task cannot block itself");
  return addDep(roots, id, blockerId);
}

export function unblock(roots, id, blockerId) {
  requireNode(roots, id);
  return removeDep(roots, id, blockerId);
}

export function remove(roots, id) {
  requireNode(roots, id);
  return pruneDeps(removeNode(roots, id));
}
