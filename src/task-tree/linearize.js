/* Flatten the active part of the tree into a single ordered work stack.

   The stack holds every node whose status is one of the three "active" ones
   (In progress, Will do next, Waiting to start) together with all their
   descendants, with finished (done) nodes dropped. The order, read top to
   bottom, is a linear extension of two hard rules:
     - a child comes before (above) its parent — you finish the pieces first;
     - a blocker comes before (above) the task it blocks.
   Among the orderings those rules allow, the In-progress group floats to the
   top, then Will-do-next, then Waiting-to-start; ties fall back to tree order.
   The grouping is a preference, so a blocker can still be pulled above its
   group when a hard rule demands it. */

const GROUP_RANK = { inprogress: 0, next: 1, waiting: 2 };
const isActive = (n) => n && n.status in GROUP_RANK;

export function linearize(children) {
  const nodeById = new Map(); // id → node, in pre-order (Map keeps insertion order)
  const orderIndex = new Map(); // id → pre-order position, for stable tie-breaks
  let counter = 0;
  const walk = (nodes) => {
    for (const n of nodes) {
      nodeById.set(n.id, n);
      orderIndex.set(n.id, counter++);
      walk(n.children || []);
    }
  };
  walk(children || []);

  // Included = every active node and its descendants, minus anything done.
  const included = new Set();
  const includeSubtree = (n) => {
    if (n.status !== "done") included.add(n.id);
    (n.children || []).forEach(includeSubtree);
  };
  for (const n of nodeById.values()) if (isActive(n)) includeSubtree(n);
  if (!included.size) return [];

  // Group each included node by the highest-priority active ancestor that owns
  // it; the first (highest-priority) seed to reach a node wins, matching the
  // "if they are not yet in the stack" dedup in the three-pass description.
  const group = new Map();
  const seedsByPriority = [...nodeById.values()]
    .filter(isActive)
    .sort((a, b) =>
      GROUP_RANK[a.status] - GROUP_RANK[b.status] ||
      orderIndex.get(a.id) - orderIndex.get(b.id));
  const assign = (n, g) => {
    if (included.has(n.id) && !group.has(n.id)) group.set(n.id, g);
    (n.children || []).forEach((c) => assign(c, g));
  };
  seedsByPriority.forEach((s) => assign(s, GROUP_RANK[s.status]));

  // Constraint graph: an edge before→after means `before` must sit above
  // `after`. indeg counts unmet prerequisites; dependents lists who to release.
  const indeg = new Map();
  const dependents = new Map();
  for (const id of included) indeg.set(id, 0);
  const require = (before, after) => {
    if (!included.has(before) || !included.has(after)) return;
    if (!dependents.has(before)) dependents.set(before, []);
    dependents.get(before).push(after);
    indeg.set(after, indeg.get(after) + 1);
  };
  for (const id of included) {
    const n = nodeById.get(id);
    for (const c of n.children || []) require(c.id, id); // child before parent
    for (const b of n.blockedBy || []) require(b, id);   // blocker before blocked
  }

  // Kahn's algorithm, always releasing the best-priority ready node next.
  const cmp = (a, b) =>
    (group.get(a) ?? 99) - (group.get(b) ?? 99) ||
    orderIndex.get(a) - orderIndex.get(b);
  const ready = [...included].filter((id) => indeg.get(id) === 0);
  const out = [];
  const placed = new Set();
  while (ready.length) {
    ready.sort(cmp);
    const id = ready.shift();
    placed.add(id);
    out.push(nodeById.get(id));
    for (const dep of dependents.get(id) || []) {
      indeg.set(dep, indeg.get(dep) - 1);
      if (indeg.get(dep) === 0) ready.push(dep);
    }
  }
  // A blocker cycle would leave nodes unplaced; append them so none vanish.
  if (placed.size < included.size) {
    for (const id of [...included].filter((x) => !placed.has(x)).sort(cmp)) {
      out.push(nodeById.get(id));
    }
  }
  return out;
}
