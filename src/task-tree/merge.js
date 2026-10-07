/* Three-way merge of the in-memory tree (local) and the linked file (remote)
   against the tree as of the last sync (base). Nodes are matched by id.

   - A node added on either side is kept.
   - A node deleted on one side is dropped, unless the other side edited it or
     it still has surviving descendants (so a child added under it isn't lost).
   - Per field (title, desc, status, type, important, blockedBy, parent), a side
     that changed it from base wins; when both changed it, local wins.
   - Sibling order follows whichever side reordered that parent's children;
     items only the other side placed there are slotted in after their nearest
     preceding sibling.
   With no base (never synced), every node present on either side is kept. */

const FIELDS = ["title", "desc", "status", "type", "important", "blockedBy"];

const norm = (n, f) => {
  const v = n[f];
  if (f === "desc") return v || "";
  if (f === "important") return !!v;
  if (f === "blockedBy") return JSON.stringify(v || []);
  return v ?? null;
};

function index(nodes) {
  const map = new Map(); // id -> {node, parent, order: child ids}
  const walk = (list, parent) => {
    for (const n of list) {
      map.set(n.id, { node: n, parent, order: (n.children || []).map((c) => c.id) });
      walk(n.children || [], n.id);
    }
  };
  walk(nodes, null);
  map.rootOrder = nodes.map((n) => n.id);
  return map;
}

const childOrder = (map, parent) =>
  parent === null ? map.rootOrder : map.get(parent)?.order || [];

const edited = (side, base) =>
  FIELDS.some((f) => norm(side.node, f) !== norm(base.node, f)) || side.parent !== base.parent;

export function mergeTrees(base, local, remote, now = Date.now()) {
  const B = base ? index(base) : null;
  const L = index(local);
  const R = index(remote);

  // Which ids survive, before the descendant rule.
  const ids = new Set([...L.keys(), ...R.keys()]);
  const keep = new Set();
  for (const id of ids) {
    const b = B?.get(id), l = L.get(id), r = R.get(id);
    if (l && r) keep.add(id);
    else if (!b) keep.add(id); // added on one side
    else if (l && edited(l, b)) keep.add(id); // deleted remotely, edited locally
    else if (r && edited(r, b)) keep.add(id); // deleted locally, edited remotely
  }

  // Fields and parent per surviving node.
  const merged = new Map();
  for (const id of ids) {
    const b = B?.get(id), l = L.get(id), r = R.get(id);
    const fields = {};
    for (const f of FIELDS) {
      const src = !l ? r : !r ? l : (b && norm(l.node, f) === norm(b.node, f) ? r : l);
      fields[f] = src.node[f];
    }
    const parent = !l ? r.parent : !r ? l.parent : (b && l.parent === b.parent ? r.parent : l.parent);
    // Local-only fields (lifecycle clocks etc.) come from the in-memory node.
    merged.set(id, { node: { ...(r?.node || {}), ...(l?.node || {}), ...fields }, parent, l, r });
  }

  // A dropped node with a kept descendant is kept too, so nothing is orphaned.
  const parentOf = (id) => merged.get(id)?.parent ?? null;
  for (const id of [...keep]) {
    for (let p = parentOf(id); p !== null && !keep.has(p); p = parentOf(p)) keep.add(p);
  }

  // Resolve parents that no longer survive or would create a cycle.
  const resolved = new Map();
  for (const id of keep) {
    const m = merged.get(id);
    const candidates = [m.parent, m.l?.parent, m.r?.parent, null];
    resolved.set(id, candidates.find((p) => p === null || keep.has(p)));
  }
  for (const id of keep) {
    const seen = new Set([id]);
    for (let p = resolved.get(id); p !== null; p = resolved.get(p)) {
      if (seen.has(p)) { resolved.set(id, null); break; }
      seen.add(p);
    }
  }

  const kids = new Map([[null, []]]);
  for (const id of keep) {
    const p = resolved.get(id);
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(id);
  }

  const orderFor = (parent) => {
    const members = new Set(kids.get(parent) || []);
    const lo = childOrder(L, parent).filter((id) => members.has(id));
    const ro = childOrder(R, parent).filter((id) => members.has(id));
    const bo = B ? childOrder(B, parent).filter((id) => members.has(id)) : [];
    const localReordered = B && lo.filter((id) => bo.includes(id)).join() !== bo.filter((id) => lo.includes(id)).join();
    const [primary, secondary] = localReordered ? [lo, ro] : [ro, lo];
    const out = [...primary];
    for (let i = 0; i < secondary.length; i++) {
      const id = secondary[i];
      if (out.includes(id)) continue;
      let at = 0;
      for (let j = i - 1; j >= 0; j--) {
        const k = out.indexOf(secondary[j]);
        if (k >= 0) { at = k + 1; break; }
      }
      out.splice(at, 0, id);
    }
    for (const id of members) if (!out.includes(id)) out.push(id); // moved here by parent fallback
    return out;
  };

  const build = (parent) => orderFor(parent).map((id) => {
    const { node } = merged.get(id);
    const doneAt = node.status === "done" ? (node.doneAt || now) : null;
    return { ...node, doneAt, children: build(id) };
  });
  return build(null);
}

// Flag nodes in `merged` that `local` didn't have, so the app can highlight
// tasks that arrived from the file until the user reviews them.
export function markUnseen(merged, local) {
  const seen = new Set();
  const index = (nodes) => { for (const n of nodes) { seen.add(n.id); index(n.children || []); } };
  index(local);
  const walk = (nodes) => nodes.map((n) => ({
    ...(seen.has(n.id) ? n : { ...n, unseen: true }),
    children: walk(n.children || []),
  }));
  return walk(merged);
}
