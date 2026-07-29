import { findNode, addChild } from "./model.js";

/* Backlog: leaves that sat untouched in the Tree for a week move out of it and
   into a mirror tree, keeping their place — every ancestor is copied along as a
   path stub so the branch reads the same as it did in the Tree.

   Untouched means no status at all: anything marked in progress / next /
   waiting / done / needs-input stays in the Tree however old it is.

   A parent left childless because all its children moved out follows them,
   again only when it is untouched. Ancestors that are merely path stubs
   disappear again when their last real backlog item returns to the Tree. */

// TEMPORARY: 1 day while testing — the intended threshold is 7 days.
export const STALE_MS = 7 * 24 * 60 * 60 * 1000;

const isUntouched = (n) => !n.status;
export const isStale = (n, now) => now - (n.createdAt ?? now) >= STALE_MS;

/* ---------- sweeping the Tree ---------- */

/* Returns the Tree's remaining children plus the nodes that aged out, each as
   {ancestors, node}: `ancestors` is the chain from the root down to (not
   including) the node, deepest last. Deeper nodes come first, so merging in
   order builds parents around children that already left. */
export function sweepBacklog(children, now) {
  const moved = [];
  const walk = (nodes, ancestors) => {
    const kept = [];
    for (const n of nodes) {
      if (n.children?.length) {
        const rest = walk(n.children, [...ancestors, n]);
        const next = { ...n, children: rest };
        // every child moved out, so this node is a leaf now — it follows them
        if (!rest.length && isUntouched(next)) {
          moved.push({ ancestors, node: next });
          continue;
        }
        kept.push(next);
      } else if (isUntouched(n) && isStale(n, now)) {
        moved.push({ ancestors, node: { ...n, children: [] } });
      } else {
        kept.push(n);
      }
    }
    return kept;
  };
  return { children: walk(children, []), moved };
}

/* ---------- merging into the Backlog ---------- */

export function mergeIntoBacklog(backlogChildren, moved, now) {
  let out = backlogChildren;
  for (const m of moved) out = insertPath(out, m.ancestors, m.node, now);
  return out;
}

function insertPath(nodes, ancestors, node, now) {
  if (!ancestors.length) return upsert(nodes, node, now);
  const [a, ...rest] = ancestors;
  const i = nodes.findIndex((n) => n.id === a.id);
  if (i === -1) {
    // copy the ancestor without its live subtree — only the path matters here
    const stub = { ...a, stub: true, children: insertPath([], rest, node, now) };
    return [...nodes, stub];
  }
  const out = [...nodes];
  out[i] = { ...out[i], children: insertPath(out[i].children, rest, node, now) };
  return out;
}

function upsert(nodes, node, now) {
  const item = { ...node, stub: false, backloggedAt: now };
  const i = nodes.findIndex((n) => n.id === node.id);
  if (i === -1) return [...nodes, item];
  // it is already here as a path stub — keep the children it collected
  const out = [...nodes];
  out[i] = { ...item, children: out[i].children };
  return out;
}

/* ---------- returning to the Tree ---------- */

function findPath(nodes, id, trail = []) {
  for (const n of nodes) {
    const here = [...trail, n.id];
    if (n.id === id) return here;
    const deeper = findPath(n.children ?? [], id, here);
    if (deeper) return deeper;
  }
  return null;
}

function removeAt(nodes, path) {
  const [head, ...rest] = path;
  const out = [];
  for (const n of nodes) {
    if (n.id !== head) { out.push(n); continue; }
    if (!rest.length) continue; // this is the node being taken out
    const children = removeAt(n.children ?? [], rest);
    if (!children.length && n.stub) continue; // an empty path stub has no reason to stay
    out.push({ ...n, children });
  }
  return out;
}

// A returned branch starts its week over, so it doesn't age straight back out.
function freshen(node, now) {
  const { stub, backloggedAt, ...rest } = node; // eslint-disable-line no-unused-vars
  return {
    ...rest,
    createdAt: now,
    children: (node.children ?? []).map((c) => freshen(c, now)),
  };
}

/* Pulls a branch out of the Backlog. Returns {children, node, ancestorIds,
   wasStub} — the remaining backlog, the freshened branch, the ancestor chain to
   try to re-attach it under, and whether the branch's own root was just a path
   stub (that node is still in the Tree, so only its children go back). */
export function takeFromBacklog(backlogChildren, id, now) {
  const path = findPath(backlogChildren, id);
  if (!path) return null;
  const node = findNode(backlogChildren, id);
  return {
    children: removeAt(backlogChildren, path),
    node: freshen(node, now),
    ancestorIds: path.slice(0, -1),
    wasStub: !!node.stub,
  };
}

// Re-attach under the deepest ancestor the Tree still has; a branch whose
// ancestors have all left becomes a top-level branch again.
export function graftIntoTree(children, ancestorIds, node) {
  for (let i = ancestorIds.length - 1; i >= 0; i--) {
    if (findNode(children, ancestorIds[i])) return addChild(children, ancestorIds[i], node);
  }
  return [...children, node];
}

/* ---------- misc ---------- */

// Path stubs aren't backlogged tasks themselves, so they don't count.
export const countBacklogged = (nodes) =>
  nodes.reduce((a, n) => a + (n.stub ? 0 : 1) + countBacklogged(n.children ?? []), 0);
