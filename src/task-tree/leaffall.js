/* Leaf-fall: the third way a task leaves the Tree.

   A done leaf stays bright for a week after it's finished, fades once it's a
   week old, and a week after that it lets go and falls — down out of the tree
   and onto the Forest floor as litter. Done work is never silently deleted: the
   leaf is still there, on the ground, as proof the day happened.

   Ages are counted in local calendar days, not elapsed hours, so "yesterday"
   means yesterday however late you worked. Falling only ever happens on a
   sweep (app open, or the first return on a new day) so leaves never move
   under the cursor mid-session. */

export const FADE_DAY = 7; // done a week ago → faded
export const FALL_DAY = 14; // done two weeks ago → falls

/* Whole days since the epoch for the *local* calendar day of `ts`. Built from
   the local Y/M/D rather than dividing the timestamp, so a DST shift can't
   make two local midnights land on the same index. */
export function dayIndex(ts) {
  const d = new Date(ts);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}

/* Calendar days since the task was marked done. A done node with no `doneAt`
   (only possible before migrateNodes has stamped it) reads as finished today,
   so an unstamped node is never destroyed by a sweep. */
export const dayAge = (node, today) =>
  typeof node.doneAt === "number" ? today - dayIndex(node.doneAt) : 0;

/* Stamps doneAt whenever a patch sets the status, so the fade clock starts the
   moment a task is finished and resets if it's reopened. Status is written in
   exactly one place (the side panel), so this is the only place that needs it. */
export const stampDone = (patch) =>
  "status" in patch
    ? { ...patch, doneAt: patch.status === "done" ? Date.now() : null }
    : patch;

/* Ids of done nodes old enough to render faded. Anything past FALL_DAY also
   reads faded — it's waiting for the next sweep, not still fresh. */
export function fadedIds(children, today) {
  const ids = new Set();
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.status === "done" && dayAge(n, today) >= FADE_DAY) ids.add(n.id);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(children);
  return ids;
}

/* ---------- sweeping ---------- */

/* Done leaves ready to fall, each as {id, title, doneAt, ancestorIds}.
   `ancestorIds` runs from the top-level branch down to the leaf's parent: a
   fallen leaf banks at the foot of whichever ancestor later graduates to the
   Forest, and graduation counts the leaves a branch has already shed.

   Only nodes that are *already* childless are candidates. A parent emptied by
   this sweep is deliberately left alone until the next one, so a finished
   branch erodes from the tips inward over successive mornings instead of
   vanishing in one clump. */
export function collectFallen(children, today) {
  const out = [];
  const walk = (nodes, ancestorIds) => {
    for (const n of nodes) {
      if (n.children?.length) {
        walk(n.children, [...ancestorIds, n.id]);
      } else if (n.status === "done" && dayAge(n, today) >= FALL_DAY) {
        out.push({ id: n.id, title: n.title, doneAt: n.doneAt ?? null, ancestorIds });
      }
    }
  };
  walk(children, []);
  return out;
}

/* Removes `ids` from the tree. Applied when leaves land, and also when a
   branch graduates to the Forest — both are "this subtree left the Tree".

   A parent left childless by the removal keeps whatever status it had. It is
   never completed on its own: the parent's title is a task in its own right,
   and finishing every task *under* it says nothing about that. Marking it done
   here would start it fading and drop work nobody had finished.

   So a statusless parent simply becomes an ordinary actionable leaf — and gets
   a fresh createdAt, because it only just arrived at the actionable edge of the
   tree. That gives it a full week in view before the Backlog's staleness sweep
   can claim it, rather than aging out on a clock that started when it was still
   a branch nobody was expected to act on. */
export function applyFall(children, ids, now) {
  const walk = (nodes) => {
    const out = [];
    for (const n of nodes) {
      if (ids.has(n.id)) continue;
      const had = !!n.children?.length;
      const kids = had ? walk(n.children) : [];
      let next = { ...n, children: kids };
      if (had && !kids.length && !next.status) next = { ...next, createdAt: now };
      out.push(next);
    }
    return out;
  };
  return walk(children);
}

// Leaves this branch has already shed, so erosion can't shrink a slow project
// below the size that earns it a tree in the Forest.
export const shedUnder = (litter, id) =>
  litter.reduce((a, l) => a + ((l.ancestorIds ?? []).includes(id) ? 1 : 0), 0);
