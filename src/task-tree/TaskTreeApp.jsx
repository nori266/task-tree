import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  STATUSES, TYPES, newNode, updateNode, addChild, removeNode, findNode,
  countNodes, countDone,
} from "./model.js";
import { parseMarkdown, toMarkdown, migrateNodes, SAMPLE_MD } from "./markdown.js";
import { PILL_H, pillW, computeDoneBranchIds, computeLayout } from "./layout.js";
import {
  RootHub, TaskPill, DoneLeaf, DoneTwig, DragGhost, Butterflies, makeFlock,
} from "./nodes.jsx";
import Panel from "./Panel.jsx";
import { ImportModal, ExportModal } from "./Modals.jsx";
import "./task-tree.css";

/* ────────────────────────────────────────────────
   Task Tree — a calm, spatial todo manager
   Import nested markdown bullets → balanced tree.
   ──────────────────────────────────────────────── */

const CELEBRATE_MIN_SUBNODES = 10;

export default function TaskTreeApp() {
  const [doc, setDoc] = useState(null); // {title, children}
  const [selectedId, setSelectedId] = useState(null);
  const [layoutMode, setLayoutMode] = useState("horizontal"); // horizontal | radial
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [modal, setModal] = useState(null); // 'import' | 'export' | null
  const [importText, setImportText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [copied, setCopied] = useState(false);
  const [structureRev, setStructureRev] = useState(0);
  const [size, setSize] = useState({ w: 1000, h: 700 });

  const containerRef = useRef(null);
  const svgWrapRef = useRef(null);
  const titleInputRef = useRef(null);
  const drag = useRef(null);
  const nodeDrag = useRef(null); // pointer bookkeeping for drag-to-reparent
  const [dragState, setDragState] = useState(null); // {id, x, y, over} while dragging a node
  const [celebration, setCelebration] = useState(null); // {id, key, flock} butterflies over a freshly finished big branch
  const loaded = useRef(false);
  const prevBigDone = useRef(null); // ids of big fully-done branches on the previous doc
  const celebrationTimer = useRef(null);

  /* ----- load ----- */
  useEffect(() => {
    (async () => {
      let d = null;
      try {
        const res = await window.storage.get("tasktree:doc");
        if (res?.value) d = JSON.parse(res.value);
      } catch (e) { /* first run */ }
      if (!d || !Array.isArray(d.children)) {
        d = { title: "My tasks", children: parseMarkdown(SAMPLE_MD) };
      } else {
        d = { ...d, children: migrateNodes(d.children) };
      }
      setDoc(d);
      loaded.current = true;
      setStructureRev((r) => r + 1);
    })();
  }, []);

  /* ----- save (debounced) ----- */
  useEffect(() => {
    if (!loaded.current || !doc) return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      try {
        await window.storage.set("tasktree:doc", JSON.stringify(doc));
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 1400);
      } catch (e) {
        setSaveState("error");
      }
    }, 600);
    return () => clearTimeout(t);
  }, [doc]);

  /* ----- resize ----- */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  /* ----- fully-done subtrees (folded into twigs, links tinted green) ----- */
  const doneBranchIds = useMemo(
    () => computeDoneBranchIds(doc?.children ?? []),
    [doc]
  );

  /* ----- butterflies when a big branch (>= CELEBRATE_MIN_SUBNODES subnodes)
         becomes fully done, itself included ----- */
  useEffect(() => {
    if (!doc) return;
    const allDone = (n) => n.status === "done" && n.children.every(allDone);
    const big = [];
    const walk = (n) => {
      if (countNodes(n.children) >= CELEBRATE_MIN_SUBNODES && allDone(n)) big.push(n);
      n.children.forEach(walk);
    };
    doc.children.forEach(walk);
    const prev = prevBigDone.current;
    prevBigDone.current = new Set(big.map((n) => n.id));
    if (!prev) return; // first doc after load — nothing was just completed
    const fresh = big.filter((n) => !prev.has(n.id));
    if (!fresh.length) return;
    // If completing one task finished several nested big branches, celebrate the largest.
    const star = fresh.reduce((a, b) => (countNodes(b.children) > countNodes(a.children) ? b : a));
    const count = Math.min(18, 8 + Math.floor(countNodes(star.children) / 3));
    clearTimeout(celebrationTimer.current);
    setCelebration({ id: star.id, key: Date.now(), flock: makeFlock(count) });
    celebrationTimer.current = setTimeout(() => setCelebration(null), 4600);
  }, [doc]);

  useEffect(() => () => clearTimeout(celebrationTimer.current), []);

  /* ----- layout ----- */
  const layout = useMemo(
    () => computeLayout(doc, layoutMode, size, doneBranchIds),
    [doc, layoutMode, size, doneBranchIds]
  );

  /* ----- fit view ----- */
  const fitView = useCallback(() => {
    const ns = layout.nodes;
    if (!ns.length) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of ns) {
      const w = n.d.depth === 0 ? 40 : pillW(n.d.data);
      minX = Math.min(minX, n.x - w / 2 - 16);
      maxX = Math.max(maxX, n.x + w / 2 + 16);
      minY = Math.min(minY, n.y - PILL_H);
      maxY = Math.max(maxY, n.y + PILL_H);
    }
    const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
    const pad = 36;
    const k = Math.min((size.w - pad * 2) / bw, (size.h - pad * 2) / bh, 1.5);
    const kk = Math.max(0.15, k);
    setView({
      k: kk,
      x: (size.w - bw * kk) / 2 - minX * kk,
      y: (size.h - bh * kk) / 2 - minY * kk,
    });
  }, [layout, size]);

  useEffect(() => { fitView(); }, [structureRev, layoutMode, size.w, size.h]); // eslint-disable-line

  /* ----- pan & zoom ----- */
  useEffect(() => {
    const el = svgWrapRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      setView((v) => {
        const factor = Math.exp(-e.deltaY * 0.0016);
        const k = Math.min(3, Math.max(0.12, v.k * factor));
        const rect = el.getBoundingClientRect();
        const px = e.clientX - rect.left, py = e.clientY - rect.top;
        return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e) => {
    if (e.target.closest?.("[data-node]")) return;
    drag.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.sx, dy = e.clientY - drag.current.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
    setView((v) => ({ ...v, x: drag.current.ox + dx, y: drag.current.oy + dy }));
  };
  const onPointerUp = () => {
    if (drag.current && !drag.current.moved) setSelectedId(null);
    drag.current = null;
  };

  /* ----- actions ----- */
  const bumpStructure = () => setStructureRev((r) => r + 1);

  const handleAddChild = (parentId) => {
    const child = newNode();
    setDoc((d) =>
      parentId === "__root"
        ? { ...d, children: [...d.children, child] }
        : { ...d, children: addChild(d.children, parentId, child) }
    );
    setSelectedId(child.id);
    setConfirmDelete(false);
    bumpStructure();
    setTimeout(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }, 60);
  };

  const handleDelete = (id) => {
    setDoc((d) => ({ ...d, children: removeNode(d.children, id) }));
    setSelectedId(null);
    setConfirmDelete(false);
    bumpStructure();
  };

  /* ----- drag-to-reparent ----- */

  const worldPoint = (e) => {
    const rect = svgWrapRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - view.x) / view.k,
      y: (e.clientY - rect.top - view.y) / view.k,
    };
  };

  const hitTarget = (p, exclude) => {
    for (const n of layout.nodes) {
      if (n.d.depth === 0) {
        if (Math.hypot(p.x - n.x, p.y - n.y) < 26) return "__root";
        continue;
      }
      const d = n.d.data;
      if (exclude.has(d.id)) continue;
      const w = pillW(d);
      if (Math.abs(p.x - n.x) <= w / 2 + 4 && Math.abs(p.y - n.y) <= PILL_H / 2 + 6) return d.id;
    }
    return null;
  };

  const beginNodeDrag = (e, data) => {
    e.stopPropagation();
    const exclude = new Set();
    (function collect(nd) { exclude.add(nd.id); (nd.children || []).forEach(collect); })(data);
    nodeDrag.current = { id: data.id, sx: e.clientX, sy: e.clientY, active: false, exclude, suppressClick: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const moveNodeDrag = (e, data) => {
    const nd = nodeDrag.current;
    if (!nd || nd.id !== data.id) return;
    if (!nd.active) {
      if (Math.abs(e.clientX - nd.sx) + Math.abs(e.clientY - nd.sy) < 7) return;
      nd.active = true;
    }
    const p = worldPoint(e);
    setDragState({ id: nd.id, x: p.x, y: p.y, over: hitTarget(p, nd.exclude) });
  };

  const endNodeDrag = (e, data) => {
    const nd = nodeDrag.current;
    if (!nd || nd.id !== data.id) return;
    if (nd.active) {
      nd.active = false;
      nd.suppressClick = true; // don't treat this release as a select-click
      if (dragState?.over) handleReparent(nd.id, dragState.over);
      setDragState(null);
    }
  };

  const handleReparent = (nodeId, targetId) => {
    setDoc((d) => {
      const subtree = findNode(d.children, nodeId);
      if (!subtree || nodeId === targetId) return d;
      const rest = removeNode(d.children, nodeId);
      const children =
        targetId === "__root" ? [...rest, subtree] : addChild(rest, targetId, subtree);
      return { ...d, children };
    });
    bumpStructure();
  };

  const handleImport = (mode) => {
    const roots = parseMarkdown(importText);
    if (!roots.length) return;
    setDoc((d) =>
      mode === "replace"
        ? { ...d, children: roots }
        : { ...d, children: [...d.children, ...roots] }
    );
    setModal(null);
    setImportText("");
    setSelectedId(null);
    bumpStructure();
  };

  const exportMd = doc ? toMarkdown(doc.children) : "";
  const copyExport = async () => {
    try {
      await navigator.clipboard.writeText(exportMd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) { /* textarea remains selectable */ }
  };

  const selected = doc && selectedId ? findNode(doc.children, selectedId) : null;
  const total = doc ? countNodes(doc.children) : 0;
  const done = doc ? countDone(doc.children) : 0;

  /* ────────────────── render ────────────────── */

  return (
    <div className="tt-root">
      {/* top bar */}
      <header className="tt-bar">
        <div className="tt-brand">
          <span className="tt-brand-dot" />
          <span className="tt-brand-name">Task Tree</span>
          <span className="tt-progress">
            {done}/{total} done
            {saveState === "saving" && <em> · saving…</em>}
            {saveState === "saved" && <em> · saved</em>}
            {saveState === "error" && <em className="err"> · couldn't save</em>}
          </span>
        </div>
        <div className="tt-actions">
          <button
            className="tt-btn ghost"
            onClick={() => setLayoutMode((m) => (m === "horizontal" ? "radial" : "horizontal"))}
            title="Switch layout"
          >
            {layoutMode === "horizontal" ? "◎ Radial" : "⇥ Tree"}
          </button>
          <button className="tt-btn ghost" onClick={fitView} title="Fit tree to screen">Fit</button>
          <button className="tt-btn ghost" onClick={() => { setModal("export"); setCopied(false); }}>Export</button>
          <button className="tt-btn solid" onClick={() => setModal("import")}>Import .md</button>
        </div>
      </header>

      {/* canvas */}
      <div className="tt-canvas" ref={containerRef}>
        <div
          className="tt-svgwrap"
          ref={svgWrapRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <svg width={size.w} height={size.h}>
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {layout.links.map((l) => (
                <path
                  key={l.id}
                  d={l.path}
                  className={`tt-link ${doneBranchIds.has(l.id) ? "done" : ""} ${l.inprogress ? "active" : ""}`}
                />
              ))}
              {layout.nodes.map((n) => {
                const data = n.d.data;
                if (n.d.depth === 0) {
                  return (
                    <RootHub
                      key="__root"
                      x={n.x}
                      y={n.y}
                      isDrop={dragState?.over === "__root"}
                      onAdd={() => { setSelectedId(null); handleAddChild("__root"); }}
                    />
                  );
                }
                const isSel = data.id === selectedId;
                const isDone = data.status === "done";
                const isLeaf = !data.children || data.children.length === 0;
                const shared = {
                  node: data,
                  x: n.x,
                  y: n.y,
                  isDrop: dragState?.over === data.id,
                  isDragging: dragState?.id === data.id,
                  handlers: {
                    onPointerDown: (e) => beginNodeDrag(e, data),
                    onPointerMove: (e) => moveNodeDrag(e, data),
                    onPointerUp: (e) => endNodeDrag(e, data),
                    onPointerCancel: () => { nodeDrag.current = null; setDragState(null); },
                    onClick: () => {
                      if (nodeDrag.current?.suppressClick) { nodeDrag.current = null; return; }
                      nodeDrag.current = null;
                      setSelectedId(data.id);
                      setConfirmDelete(false);
                    },
                  },
                };
                if (!isLeaf && doneBranchIds.has(data.id) && !isSel) {
                  return <DoneTwig key={data.id} {...shared} />;
                }
                if (isDone && isLeaf && !isSel) {
                  return <DoneLeaf key={data.id} {...shared} />;
                }
                return (
                  <TaskPill
                    key={data.id}
                    {...shared}
                    isSel={isSel}
                    isDone={isDone}
                    isLeaf={isLeaf}
                  />
                );
              })}
              {dragState && doc && (() => {
                const dn = findNode(doc.children, dragState.id);
                return dn ? <DragGhost node={dn} x={dragState.x} y={dragState.y} /> : null;
              })()}
              {celebration && (() => {
                const n = layout.nodes.find((m) => m.d.depth > 0 && m.d.data.id === celebration.id);
                return n ? (
                  <Butterflies key={celebration.key} flock={celebration.flock} x={n.x} y={n.y} />
                ) : null;
              })()}
            </g>
          </svg>
        </div>

        {/* legend */}
        <div className="tt-legend">
          <span className="tt-leg-label">Type</span>
          {TYPES.map((t) => (
            <span key={t.key} title={t.label}>
              {t.emoji}<i>{t.label}</i>
            </span>
          ))}
          <span className="tt-leg-label sep">Status</span>
          {STATUSES.map((s) => (
            <span key={s.key} title={s.label}>
              {s.emoji}<i>{s.label}</i>
            </span>
          ))}
        </div>

        {/* hint */}
        {doc && !doc.children.length && (
          <div className="tt-empty">
            The tree is empty. <button className="tt-linkbtn" onClick={() => setModal("import")}>Import a markdown list</button> or tap the 🌳 to plant a first task.
          </div>
        )}
      </div>

      {/* detail panel */}
      <Panel
        selected={selected}
        titleInputRef={titleInputRef}
        confirmDelete={confirmDelete}
        setConfirmDelete={setConfirmDelete}
        onPatch={(patch) => setDoc((d) => ({ ...d, children: updateNode(d.children, selectedId, patch) }))}
        onAddChild={() => handleAddChild(selected.id)}
        onDelete={() => handleDelete(selected.id)}
        onClose={() => setSelectedId(null)}
      />

      {/* modals */}
      {modal === "import" && (
        <ImportModal
          text={importText}
          setText={setImportText}
          onImport={handleImport}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "export" && (
        <ExportModal
          markdown={exportMd}
          copied={copied}
          onCopy={copyExport}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
