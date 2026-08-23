import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { PILL_H, pillW, labelOf, computeLayout, ZOOM_SPEED, ZOOM_MIN, ZOOM_MAX } from "./layout.js";
import { TaskPill } from "./nodes.jsx";
import { statusByKey, typeByKey } from "./model.js";
import { toMarkdown } from "./markdown.js";

/* The Backlog tab: the same tree drawing as the Tree, holding the branches
   that aged out of it. Nodes here are read-only — pick one to send its branch
   back to the Tree, or drop it for good. Ancestors copied along only to keep
   the shape are dimmed. */

const fmt = (t) =>
  typeof t === "number"
    ? new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "—";

export default function Backlog({ nodes, size, onReturn, onDelete }) {
  const [selectedId, setSelectedId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef(null);
  const drag = useRef(null);

  const doc = useMemo(() => ({ title: "Backlog", children: nodes }), [nodes]);
  const layout = useMemo(() => computeLayout(doc, size, new Set()), [doc, size]);

  const bounds = useMemo(() => {
    if (!layout.nodes.length) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of layout.nodes) {
      const w = n.d.depth === 0 ? 40 : pillW(n.d.data);
      minX = Math.min(minX, n.x - w / 2 - 16);
      maxX = Math.max(maxX, n.x + w / 2 + 16);
      minY = Math.min(minY, n.y - PILL_H);
      maxY = Math.max(maxY, n.y + PILL_H);
    }
    return { minX, maxX, minY, maxY };
  }, [layout]);

  const clampView = useCallback((v) => {
    if (!bounds) return v;
    const m = 80;
    return {
      ...v,
      x: Math.min(size.w - m - bounds.minX * v.k, Math.max(m - bounds.maxX * v.k, v.x)),
      y: Math.min(size.h - m - bounds.minY * v.k, Math.max(m - bounds.maxY * v.k, v.y)),
    };
  }, [bounds, size]);

  const fitView = useCallback(() => {
    if (!bounds) return;
    const bw = Math.max(1, bounds.maxX - bounds.minX), bh = Math.max(1, bounds.maxY - bounds.minY);
    const pad = 36;
    const k = Math.max(0.15, Math.min((size.w - pad * 2) / bw, (size.h - pad * 2) / bh, 1.5));
    setView({
      k,
      x: (size.w - bw * k) / 2 - bounds.minX * k,
      y: (size.h - bh * k) / 2 - bounds.minY * k,
    });
  }, [bounds, size]);

  // re-fit when the backlog's shape or the viewport changes
  const shape = layout.nodes.length;
  useEffect(() => { fitView(); }, [shape, size.w, size.h]); // eslint-disable-line

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      setView((v) => {
        const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.k * Math.exp(-e.deltaY * ZOOM_SPEED)));
        const rect = el.getBoundingClientRect();
        const px = e.clientX - rect.left, py = e.clientY - rect.top;
        return clampView({ k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k });
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [clampView]);

  const onPointerDown = (e) => {
    if (e.target.closest?.("[data-node]")) return;
    drag.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true;
    const nx = d.ox + (e.clientX - d.sx), ny = d.oy + (e.clientY - d.sy);
    setView((v) => clampView({ ...v, x: nx, y: ny }));
  };
  const onPointerUp = () => {
    if (drag.current && !drag.current.moved) { setSelectedId(null); setConfirmDelete(false); }
    drag.current = null;
  };

  const find = (nodes) => {
    for (const n of nodes) {
      if (n.id === selectedId) return n;
      const f = find(n.children ?? []);
      if (f) return f;
    }
    return null;
  };
  const selected = selectedId ? find(nodes) : null;

  const copyMd = async () => {
    try {
      await navigator.clipboard.writeText(toMarkdown(selected ? [selected] : nodes));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) { /* clipboard unavailable */ }
  };

  if (!nodes.length) {
    return (
      <div className="ff-empty">
        Nothing in the backlog. A leaf task you never gave a status sits in the Tree for
        a week, then moves here with its branch — so the Tree only shows what you’re
        actually working on. 🗂️
      </div>
    );
  }

  return (
    <>
      <div
        className="tt-svgwrap"
        ref={wrapRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <svg width={size.w} height={size.h}>
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {layout.links.map((l) => (
              <path key={l.id} d={l.path} className="tt-link bl" />
            ))}
            {layout.nodes.map((n) => {
              if (n.d.depth === 0) {
                return <circle key="__root" cx={n.x} cy={n.y} r={13} className="bl-hub" />;
              }
              const data = n.d.data;
              return (
                <g key={data.id} className={data.stub ? "bl-stub" : ""}>
                  <TaskPill
                    node={data}
                    x={n.x}
                    y={n.y}
                    isSel={data.id === selectedId}
                    isDone={data.status === "done"}
                    isLeaf={!data.children?.length}
                    isDrop={false}
                    isDragging={false}
                    handlers={{
                      onClick: () => { setSelectedId(data.id); setConfirmDelete(false); },
                    }}
                  />
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      <div className="bl-bar">
        {selected ? (
          <>
            <span className="bl-bar-title">
              {selected.type && typeByKey[selected.type] ? typeByKey[selected.type].emoji + " " : ""}
              {labelOf(selected.title)}
              {selected.status && statusByKey[selected.status] ? " " + statusByKey[selected.status].emoji : ""}
            </span>
            <span className="bl-bar-meta">
              {selected.stub
                ? <>kept for shape · still in the Tree</>
                : <>created {fmt(selected.createdAt)} · backlogged {fmt(selected.backloggedAt)}</>}
            </span>
            <button className="tt-btn ghost" onClick={copyMd}>{copied ? "✓ Copied" : "⧉ Copy .md"}</button>
            <button className="tt-btn solid" onClick={() => onReturn(selected.id)}>
              ↩ Return to Tree{selected.children?.length ? " (with sub-tasks)" : ""}
            </button>
            {!selected.stub && (
              <button
                className={`tt-btn danger ${confirmDelete ? "confirm" : ""}`}
                onClick={() => (confirmDelete ? onDelete(selected.id) : setConfirmDelete(true))}
                onBlur={() => setConfirmDelete(false)}
              >
                {confirmDelete ? "Really delete?" : "Delete"}
              </button>
            )}
          </>
        ) : (
          <>
            <span className="bl-bar-meta">Pick a task to send its branch back to the Tree.</span>
            <button className="tt-btn ghost" onClick={fitView}>Fit</button>
            <button className="tt-btn ghost" onClick={copyMd}>{copied ? "✓ Copied" : "⧉ Copy all .md"}</button>
          </>
        )}
      </div>
    </>
  );
}
