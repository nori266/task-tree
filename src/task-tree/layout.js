import * as d3 from "d3";

/* Pure layout math: node sizing, done-branch detection, and the d3 tidy-tree
   placement (horizontal or radial) with organic jitter applied on top. */

export const PILL_H = 34;
export const labelOf = (t) => (t.length > 26 ? t.slice(0, 25) + "…" : t);
export const pillW = (n) =>
  Math.max(64, 26 + labelOf(n.title).length * (n.important ? 7.6 : 7.0) + (n.type ? 24 : 0) + (n.status ? 22 : 0));

// Deterministic pseudo-random in [-0.5, 0.5) seeded by node id, so the
// organic jitter is stable across renders.
function jitter(id, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000 - 0.5;
}

// Ids of every node inside a fully-done subtree (folded into twigs/leaves,
// links tinted green).
export function computeDoneBranchIds(children) {
  const ids = new Set();
  const allDone = (n) => n.status === "done" && n.children.every(allDone);
  const mark = (n) => { ids.add(n.id); n.children.forEach(mark); };
  const walk = (n) => {
    if (n.children.length && allDone(n)) mark(n);
    else n.children.forEach(walk);
  };
  children.forEach(walk);
  return ids;
}

export function computeLayout(doc, layoutMode, size, doneBranchIds) {
  if (!doc) return { nodes: [], links: [] };
  const rootData = { id: "__root", title: doc.title, children: doc.children };
  const h = d3.hierarchy(rootData, (d) => d.children);
  // Nudge every node off the tidy grid — varying edge lengths so siblings
  // don't line up in rigid columns. Finished subtrees also drift sideways
  // more, so those branches read fully organic; live nodes stay close to
  // their row to keep the tree readable.
  const naturalize = (nodes) => {
    const byD = new Map(nodes.map((n) => [n.d, n]));
    for (const n of nodes) {
      if (n.d.depth === 0) continue;
      const p = byD.get(n.d.parent);
      if (!p) continue;
      let dx = n.x - p.x, dy = n.y - p.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      const done = doneBranchIds.has(n.d.data.id);
      const along = jitter(n.d.data.id) * 48;
      const side = jitter(n.d.data.id, 7) * (done ? 24 : 10);
      n.x += dx * along - dy * side;
      n.y += dy * along + dx * side;
    }
  };
  if (layoutMode === "radial") {
    const R = Math.max(240, Math.min(size.w, size.h) / 2 - 60);
    d3.tree()
      .size([2 * Math.PI, R])
      .separation((a, b) => ((a.parent === b.parent ? 1 : 1.6) / Math.max(a.depth, 1)))(h);
    const nodes = h.descendants().map((d) => ({
      d,
      x: d.depth === 0 ? 0 : d.y * Math.cos(d.x - Math.PI / 2),
      y: d.depth === 0 ? 0 : d.y * Math.sin(d.x - Math.PI / 2),
    }));
    naturalize(nodes);
    const pos = new Map(nodes.map((n) => [n.d, n]));
    const links = h.links().map((l) => {
      const s = pos.get(l.source), t = pos.get(l.target);
      const mx = (s.x + t.x) / 2, my = (s.y + t.y) / 2;
      return {
        id: l.target.data.id,
        inprogress: l.target.data.status === "inprogress",
        path: `M${s.x},${s.y} Q${mx},${my} ${t.x},${t.y}`,
      };
    });
    return { nodes, links };
  }
  // horizontal tidy tree: width follows the container, but rows are laid
  // out at a fixed vertical pitch so leaves never overlap no matter how
  // many there are — fitView then scales the taller tree to the screen
  const W = Math.max(560, size.w - 200);
  d3.tree()
    .nodeSize([PILL_H + 14, W / Math.max(1, h.height)])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.35))(h);
  const nodes = h.descendants().map((d) => ({ d, x: d.y, y: d.x }));
  naturalize(nodes);
  const pos = new Map(nodes.map((n) => [n.d, n]));
  const links = h.links().map((l) => {
    const s = pos.get(l.source), t = pos.get(l.target);
    const mx = (s.x + t.x) / 2;
    return {
      id: l.target.data.id,
      inprogress: l.target.data.status === "inprogress",
      path: `M${s.x},${s.y} C${mx},${s.y} ${mx},${t.y} ${t.x},${t.y}`,
    };
  });
  return { nodes, links };
}
