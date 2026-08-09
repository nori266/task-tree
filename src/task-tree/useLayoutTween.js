import { useEffect, useRef, useState } from "react";
import { linkPath, depPath } from "./layout.js";

/* Glide the tree between layouts instead of snapping. When a node is
   re-parented the whole tree re-balances; we tween every node from where it
   currently sits to its new tidy-tree position and rebuild the connecting
   curves from the in-between coordinates each frame, so pills and their links
   move as one. Only structural changes (a different parent, a node added or
   removed, entering/leaving focus) animate — pure resizes, restyles and text
   edits update instantly, since there is nothing to re-balance. */

const DUR = 460; // ms
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// A signature of the parent→child shape; when it changes, the tree re-balanced.
const shapeOf = (layout) =>
  layout.nodes
    .map((n) => `${n.d.data.id}>${n.d.parent?.data.id ?? ""}`)
    .join("|");

// Rebuild link/dep path strings from a Map<id, {x,y}> of current positions.
function edgesFrom(pos, layout) {
  const links = layout.links.map((l) => {
    const s = pos.get(l.source), t = pos.get(l.id);
    return s && t ? { ...l, path: linkPath(s, t) } : l;
  });
  const deps = layout.deps.map((d) => {
    const s = pos.get(d.from), t = pos.get(d.to);
    return s && t ? { ...d, path: depPath(s, t) } : d;
  });
  return { links, deps };
}

export default function useLayoutTween(layout) {
  const [rendered, setRendered] = useState(layout);
  const posRef = useRef(new Map()); // id -> {x,y} currently displayed
  const shapeRef = useRef(shapeOf(layout));
  const rafRef = useRef(0);

  useEffect(() => {
    const targetPos = new Map(
      layout.nodes.map((n) => [n.d.data.id, { x: n.x, y: n.y }])
    );
    const nextShape = shapeOf(layout);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const structural = nextShape !== shapeRef.current;
    shapeRef.current = nextShape;

    cancelAnimationFrame(rafRef.current);

    // Snap when there's nothing to re-balance (or motion is unwelcome).
    if (!structural || reduced || !posRef.current.size) {
      posRef.current = targetPos;
      setRendered(layout);
      return;
    }

    // Start from where each node sits now; a brand-new node starts at its
    // destination (it has no prior position to glide from).
    const startPos = new Map();
    for (const [id, tp] of targetPos) {
      startPos.set(id, posRef.current.get(id) ?? tp);
    }

    let t0 = null;
    const tick = (now) => {
      if (t0 === null) t0 = now;
      const e = easeInOut(Math.min(1, (now - t0) / DUR));
      const pos = new Map();
      const nodes = layout.nodes.map((n) => {
        const id = n.d.data.id;
        const s = startPos.get(id), tp = targetPos.get(id);
        const x = s.x + (tp.x - s.x) * e;
        const y = s.y + (tp.y - s.y) * e;
        pos.set(id, { x, y });
        return { ...n, x, y };
      });
      posRef.current = pos;
      setRendered({ nodes, ...edgesFrom(pos, layout) });
      if (e < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [layout]);

  return rendered;
}
