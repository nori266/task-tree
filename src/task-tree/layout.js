import * as d3 from "d3";
import { jitter } from "./hash.js";

/* Pure layout math: node sizing, done-branch detection, and the d3 tidy-tree
   placement (horizontal) with organic jitter applied on top. */

export const PILL_H = 34;

// Wheel-zoom sensitivity: k multiplies by exp(-deltaY * ZOOM_SPEED) per scroll.
export const ZOOM_SPEED = 0.003;
export const ZOOM_MIN = 0.12;
export const ZOOM_MAX = 3;
export const labelOf = (t) => (t.length > 26 ? t.slice(0, 25) + "…" : t);
export const pillW = (n) =>
  Math.max(64, 26 + labelOf(n.title).length * (n.important ? 7.6 : 7.0) + (n.type ? 24 : 0) + (n.status ? 22 : 0));

// Seeded pseudo-random in [-0.5, 0.5): the organic jitter stays stable across
// renders, so a given leaf always falls the same way and lands in the same
// spot on the Forest floor. Re-exported so layout consumers have one import.
export { jitter };

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

export function computeLayout(doc, size, doneBranchIds) {
  if (!doc) return { nodes: [], links: [], deps: [] };
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
  // horizontal tidy tree: width follows the container, but rows are laid
  // out at a fixed vertical pitch so leaves never overlap no matter how
  // many there are — fitView then scales the taller tree to the screen
  const W = Math.max(560, size.w - 200) * 1.4;
  d3.tree()
    .nodeSize([PILL_H + 14, W / Math.max(1, h.height)])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.35))(h);
  const nodes = h.descendants().map((d) => ({ d, x: d.y, y: d.x }));
  const pos = new Map(nodes.map((n) => [n.d, n]));
  compactLanes(pos, h);
  naturalize(nodes);
  const links = h.links().map((l) => {
    const s = pos.get(l.source), t = pos.get(l.target);
    return {
      id: l.target.data.id,
      source: l.source.data.id,
      inprogress: l.target.data.status === "inprogress",
      next: l.target.data.status === "next",
      path: linkPath(s, t),
    };
  });
  const deps = computeDeps(nodes);
  return { nodes, links, deps };
}

// Vertical skyline packing over the tidy tree's fixed columns. d3.tree spaces
// siblings by whole-subtree breadth, so a deep-but-thin branch reserves a full
// lane across every column even where it stands alone. This drops each sibling
// subtree only as far as its actual per-column (per-depth) occupancy collides
// with the branches already placed above it — so where a shorter branch has
// ended, a deeper neighbour's lane rises into that free space. Columns (x) are
// untouched; only lanes (y) tighten, then each parent re-centres over its kids.
function compactLanes(pos, root) {
  const PITCH = PILL_H + 14; // min lane gap between two pills sharing a column
  // For a subtree, the top (min y) and bottom (max y) at each depth column.
  const occ = (d) => {
    const m = new Map();
    const walk = (x) => {
      const y = pos.get(x).y;
      const e = m.get(x.depth);
      if (e) { e.top = Math.min(e.top, y); e.bottom = Math.max(e.bottom, y); }
      else m.set(x.depth, { top: y, bottom: y });
      x.children?.forEach(walk);
    };
    walk(d);
    return m;
  };
  const shift = (d, dy) => {
    const walk = (x) => { pos.get(x).y += dy; x.children?.forEach(walk); };
    walk(d);
  };
  const pack = (d) => {
    const kids = d.children;
    if (!kids?.length) return;
    kids.forEach(pack); // pack descendants first, then this sibling group
    const skyline = new Map(); // depth → lowest occupied y among placed kids
    kids.forEach((k, i) => {
      const o = occ(k);
      if (i > 0) {
        // drop k the least amount that clears every column it shares with a
        // branch above; columns nobody above occupies impose no constraint,
        // letting k slide up into the gap. A sibling's root column is always
        // shared, which keeps sibling order and root spacing intact.
        let need = -Infinity;
        for (const [depth, seg] of o) {
          const floor = skyline.get(depth);
          if (floor !== undefined) need = Math.max(need, floor + PITCH - seg.top);
        }
        if (need > -Infinity && need !== 0) shift(k, need);
      }
      for (const [depth, seg] of occ(k)) {
        const floor = skyline.get(depth);
        skyline.set(depth, floor === undefined ? seg.bottom : Math.max(floor, seg.bottom));
      }
    });
    const first = pos.get(kids[0]).y, last = pos.get(kids[kids.length - 1]).y;
    pos.get(d).y = (first + last) / 2;
  };
  pack(root);
}

// Parent→child edge: a horizontal S-curve between two node centres.
export function linkPath(s, t) {
  const mx = (s.x + t.x) / 2;
  return `M${s.x},${s.y} C${mx},${s.y} ${mx},${t.y} ${t.x},${t.y}`;
}

// Anchor on the top or bottom edge of the pill (its longest side), so a
// dependency link leaves and enters orthogonally to that side — vertically.
function vEdge(node, towardY) {
  const hh = PILL_H / 2 + 4;
  const dir = towardY < node.y ? -1 : 1;
  return { x: node.x, y: node.y + dir * hh };
}

// Blocked-by link: a gently bowed dashed path from blocker to blocked, anchored
// on each pill's nearest vertical edge.
export function depPath(src, tgt) {
  const p1 = vEdge(src, tgt.y);
  const p2 = vEdge(tgt, src.y);
  const my = (p1.y + p2.y) / 2;
  return `M${p1.x},${p1.y} C${p1.x},${my} ${p2.x},${my} ${p2.x},${p2.y}`;
}

// Blocked-by links: only drawn when both ends are present in the current layout.
function computeDeps(nodes) {
  const byId = new Map(nodes.map((n) => [n.d.data.id, n]));
  const deps = [];
  for (const tgt of nodes) {
    const blockers = tgt.d.data.blockedBy;
    if (!blockers || !blockers.length) continue;
    for (const bid of blockers) {
      const src = byId.get(bid);
      if (!src) continue;
      deps.push({
        id: `${bid}->${tgt.d.data.id}`,
        from: bid,
        to: tgt.d.data.id,
        path: depPath(src, tgt),
      });
    }
  }
  return deps;
}
