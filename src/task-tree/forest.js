import { countNodes } from "./model.js";
import { hashInt, rand, jitter } from "./hash.js";

/* Grow a natural-looking tree whose branching mirrors a completed task
   subtree: the achievement's root becomes the trunk, each task a branch that
   splits off into its children, and leaf tasks sprout foliage at the tips.
   Pure geometry — returns branch segments (tapered), leaf blobs and a bbox;
   Forest.jsx turns those into SVG and fits them to each card.
   Seeded by node id, so a given achievement always grows the exact same tree.

   `shed` are the branch's fallen leaves: they left the subtree before it
   graduated, so they're replanted onto it here rather than lying on the floor. */

/* Each fallen leaf goes back under the deepest ancestor still in the subtree
   (the root, if its own parent fell too) and is marked `shed`, so it grows its
   own twig and its foliage can be tinted apart from the leaves that never
   fell. Without this the grown tree would be smaller than the work it stands
   for, since applyFall removed those nodes weeks before graduation. */
function replant(root, shed) {
  if (!shed.length) return root;
  const present = new Set();
  const index = (n) => {
    present.add(n.id);
    (n.children || []).forEach(index);
  };
  index(root);

  const extra = new Map(); // parent id -> replanted leaf nodes
  for (const l of shed) {
    if (present.has(l.id)) continue; // already back in the subtree; don't graft a twin
    const anc = (l.ancestorIds || []).filter((id) => present.has(id));
    const parent = anc.length ? anc[anc.length - 1] : root.id;
    const kids = extra.get(parent) || [];
    kids.push({ id: l.id, title: l.title, shed: true, children: [] });
    extra.set(parent, kids);
  }

  const graft = (n) => {
    const kids = (n.children || []).map(graft);
    const added = extra.get(n.id);
    return { ...n, children: added ? [...kids, ...added] : kids };
  };
  return graft(root);
}

export function growTree(root, shed = []) {
  const tree = replant(root, shed);
  const branches = []; // {x1,y1,x2,y2,w1,w2,depth}
  const leaves = []; // {x,y,r,rot,tone,shed}
  const size = countNodes(tree.children);
  const TRUNK_LEN = 92;
  const TRUNK_W = Math.min(22, 9 + Math.sqrt(size) * 1.7);

  const grow = (node, x, y, ang, len, w, depth) => {
    const x2 = x + Math.cos(ang) * len;
    const y2 = y + Math.sin(ang) * len;
    const w2 = Math.max(1.1, w * 0.66);
    branches.push({ x1: x, y1: y, x2, y2, w1: w, w2, depth });

    const kids = node.children || [];
    if (!kids.length) {
      // leaf task → a little cluster of foliage at the branch tip
      const cn = 3 + (hashInt(node.id, 99) % 3);
      for (let i = 0; i < cn; i++) {
        leaves.push({
          x: x2 + jitter(node.id, i * 3 + 1) * 15,
          y: y2 + jitter(node.id, i * 3 + 2) * 15,
          r: 7 + rand(node.id, i * 3 + 3) * 5,
          rot: jitter(node.id, i * 3 + 4) * 90,
          tone: hashInt(node.id, i),
          shed: !!node.shed,
        });
      }
      return;
    }

    const n = kids.length;
    const fan = Math.min(2.0, 0.55 + n * 0.22); // total angular spread (rad)
    kids.forEach((c, i) => {
      const t = n === 1 ? 0 : i / (n - 1) - 0.5; // -0.5 … 0.5 across the fan
      const wander = n === 1 ? jitter(c.id, 9) * 0.5 : jitter(c.id, depth) * 0.4;
      const childAng = ang + t * fan + wander;
      const lenScale = 0.66 + rand(c.id, 5) * 0.24;
      grow(c, x2, y2, childAng, len * lenScale, w2, depth + 1);
    });
  };

  grow(tree, 0, 0, -Math.PI / 2, TRUNK_LEN, TRUNK_W, 0);

  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  const stretch = (x, y, m) => {
    minX = Math.min(minX, x - m); maxX = Math.max(maxX, x + m);
    minY = Math.min(minY, y - m); maxY = Math.max(maxY, y + m);
  };
  for (const b of branches) { stretch(b.x1, b.y1, b.w1 / 2); stretch(b.x2, b.y2, b.w2 / 2); }
  for (const l of leaves) stretch(l.x, l.y, l.r);

  return { branches, leaves, bbox: { minX, maxX, minY, maxY }, size };
}
