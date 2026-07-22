import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  STATUSES, TYPES, newNode, updateNode, addChild, removeNode, findNode,
  countNodes, countDone,
} from "./model.js";
import { parseMarkdown, toMarkdown, migrateNodes, SAMPLE_MD } from "./markdown.js";
import { PILL_H, labelOf, pillW, computeDoneBranchIds, computeLayout } from "./layout.js";
import {
  RootHub, TaskPill, DoneLeaf, DoneTwig, DragGhost, Butterflies, makeFlock,
} from "./nodes.jsx";
import Panel from "./Panel.jsx";
import { ImportModal, ExportModal } from "./Modals.jsx";
import Forest from "./Forest.jsx";
import "./task-tree.css";

/* ────────────────────────────────────────────────
   Task Tree — a calm, spatial todo manager
   Import nested markdown bullets → balanced tree.
   ──────────────────────────────────────────────── */

const CELEBRATE_MIN_SUBNODES = 10;

export default function TaskTreeApp() {
  const [doc, setDoc] = useState(null); // {title, children}
  const [forest, setForest] = useState([]); // graduated achievements, newest first
  const [tab, setTab] = useState("tree"); // 'tree' | 'forest'
  const [planted, setPlanted] = useState(null); // {trees, key} undo toast
  const [selectedId, setSelectedId] = useState(null);
  const [focusId, setFocusId] = useState(null); // when set, only this node's subtree is shown
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [modal, setModal] = useState(null); // 'import' | 'export' | null
  const [importText, setImportText] = useState("");
  const [importTarget, setImportTarget] = useState(null); // node id to import into, or null for whole tree
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [copied, setCopied] = useState(false);
  const [syncState, setSyncState] = useState("idle"); // idle | syncing | synced | error
  const [syncFileName, setSyncFileName] = useState(null);
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
  const prevTopDone = useRef(null); // ids of top-level branches that already graduated
  const celebrationTimer = useRef(null);
  const plantedTimer = useRef(null);
  const syncHandle = useRef(null); // retained FileSystemFileHandle for the user-chosen sync file
  const syncTimer = useRef(null);

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
      try {
        const fr = await window.storage.get("tasktree:forest");
        if (fr?.value) {
          const parsed = JSON.parse(fr.value);
          if (Array.isArray(parsed)) setForest(parsed);
        }
      } catch (e) { /* no forest yet */ }
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

  /* ----- persist the forest ----- */
  useEffect(() => {
    if (!loaded.current) return;
    window.storage.set("tasktree:forest", JSON.stringify(forest)).catch(() => {});
  }, [forest]);

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
    // top-level branches graduate to the Forest, so butterflies celebrate
    // only nested milestones (depth > 0 within a branch)
    const walk = (n, depth) => {
      if (depth > 0 && countNodes(n.children) >= CELEBRATE_MIN_SUBNODES && allDone(n)) big.push(n);
      n.children.forEach((c) => walk(c, depth + 1));
    };
    doc.children.forEach((n) => walk(n, 0));
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

  /* ----- graduate a completed big top-level branch to the Forest -----
     When a direct child of the root and its whole subtree (>= CELEBRATE_MIN_SUBNODES
     tasks under it) become done, it's cleared from the tree and planted as a
     tree in the Forest tab. A brief toast lets an accidental completion be undone. */
  useEffect(() => {
    if (!doc) return;
    const allDone = (n) => n.status === "done" && n.children.every(allDone);
    const eligible = doc.children.filter(
      (n) => n.children.length && countNodes(n.children) >= CELEBRATE_MIN_SUBNODES && allDone(n)
    );
    const prev = prevTopDone.current;
    prevTopDone.current = new Set(eligible.map((n) => n.id));
    if (!prev) return; // first doc after load — don't graduate pre-existing branches
    const fresh = eligible.filter((n) => !prev.has(n.id));
    if (!fresh.length) return;
    const freshIds = new Set(fresh.map((n) => n.id));
    const trees = fresh.map((n) => ({
      id: n.id, title: n.title, tree: n, md: toMarkdown([n]), completedAt: Date.now(),
    }));
    setForest((f) => [...trees, ...f]);
    setDoc((d) => ({ ...d, children: d.children.filter((c) => !freshIds.has(c.id)) }));
    if (focusId && freshIds.has(focusId)) setFocusId(null);
    setSelectedId((s) => (s && freshIds.has(s) ? null : s));
    clearTimeout(plantedTimer.current);
    setPlanted({ trees, key: Date.now() });
    plantedTimer.current = setTimeout(() => setPlanted(null), 6500);
    bumpStructure();
  }, [doc]); // eslint-disable-line

  useEffect(() => () => clearTimeout(plantedTimer.current), []);

  const undoPlant = () => {
    if (!planted) return;
    const ids = new Set(planted.trees.map((t) => t.id));
    setForest((f) => f.filter((a) => !ids.has(a.id)));
    setDoc((d) => ({ ...d, children: [...d.children, ...planted.trees.map((t) => t.tree)] }));
    // these branches are done again, so record them so they don't re-graduate
    prevTopDone.current = new Set([...(prevTopDone.current ?? []), ...ids]);
    setPlanted(null);
    clearTimeout(plantedTimer.current);
    bumpStructure();
  };

  /* ----- move a tree from the Forest back into the Tree ----- */
  const returnFromForest = (id) => {
    const achievement = forest.find((a) => a.id === id);
    if (!achievement) return;
    setForest((f) => f.filter((a) => a.id !== id));
    setDoc((d) => ({ ...d, children: [...d.children, achievement.tree] }));
    // it's still fully done and big — record it so it isn't graduated straight back
    prevTopDone.current = new Set([...(prevTopDone.current ?? []), id]);
    // drop a pending undo toast that referenced it, so undo can't re-add it
    setPlanted((p) => (p && p.trees.some((t) => t.id === id) ? null : p));
    setTab("tree");
    bumpStructure();
  };

  /* ----- focus mode: only the focused node and its subtree are laid out, so
         the branch occupies the full screen; the hub still adds/reparents
         into the focused node so nothing lands outside the visible view ----- */
  const focus = doc && focusId ? findNode(doc.children, focusId) : null;
  const viewDoc = useMemo(
    () => (focus ? { title: doc.title, children: [focus] } : doc),
    [doc, focus]
  );

  /* ----- layout ----- */
  const layout = useMemo(
    () => computeLayout(viewDoc, size, doneBranchIds),
    [viewDoc, size, doneBranchIds]
  );

  /* ----- content bounds (world coords) ----- */
  const bounds = useMemo(() => {
    const ns = layout.nodes;
    if (!ns.length) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of ns) {
      const w = n.d.depth === 0 ? 40 : pillW(n.d.data);
      minX = Math.min(minX, n.x - w / 2 - 16);
      maxX = Math.max(maxX, n.x + w / 2 + 16);
      minY = Math.min(minY, n.y - PILL_H);
      maxY = Math.max(maxY, n.y + PILL_H);
    }
    return { minX, maxX, minY, maxY };
  }, [layout]);

  /* ----- keep the tree on screen: clamp pan/zoom so at least a strip of the
         content always overlaps the viewport (otherwise it can be dragged or
         zoomed entirely out of view, leaving a blank canvas) ----- */
  const clampView = useCallback((v) => {
    if (!bounds) return v;
    const m = 80; // px of content kept visible at every edge
    const minX = m - bounds.maxX * v.k;
    const maxX = size.w - m - bounds.minX * v.k;
    const minY = m - bounds.maxY * v.k;
    const maxY = size.h - m - bounds.minY * v.k;
    return {
      ...v,
      x: Math.min(maxX, Math.max(minX, v.x)),
      y: Math.min(maxY, Math.max(minY, v.y)),
    };
  }, [bounds, size]);

  /* ----- fit view ----- */
  const fitView = useCallback(() => {
    if (!bounds) return;
    const { minX, maxX, minY, maxY } = bounds;
    const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
    const pad = 36;
    const k = Math.min((size.w - pad * 2) / bw, (size.h - pad * 2) / bh, 1.5);
    const kk = Math.max(0.15, k);
    setView({
      k: kk,
      x: (size.w - bw * kk) / 2 - minX * kk,
      y: (size.h - bh * kk) / 2 - minY * kk,
    });
  }, [bounds, size]);

  useEffect(() => { fitView(); }, [structureRev, size.w, size.h, focusId]); // eslint-disable-line

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
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    // Capture the target position now; don't read the mutable ref inside the
    // setView updater — onPointerUp may null it out before React runs it.
    const nx = d.ox + dx, ny = d.oy + dy;
    setView((v) => clampView({ ...v, x: nx, y: ny }));
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
    // no bumpStructure(): adding a sub-task must not re-fit the view
    setTimeout(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }, 60);
  };

  const handleDelete = (id) => {
    if (id === focusId) setFocusId(null);
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
    // in focus mode the hub stands in for the focused node
    const realTarget = targetId === "__root" && focusId ? focusId : targetId;
    setDoc((d) => {
      const subtree = findNode(d.children, nodeId);
      if (!subtree || nodeId === realTarget) return d;
      const rest = removeNode(d.children, nodeId);
      const children =
        realTarget === "__root" ? [...rest, subtree] : addChild(rest, realTarget, subtree);
      return { ...d, children };
    });
    bumpStructure();
  };

  const handleImport = (mode) => {
    const roots = parseMarkdown(importText);
    if (!roots.length) return;
    setDoc((d) => {
      if (importTarget) {
        const node = findNode(d.children, importTarget);
        if (!node) return d;
        const nextChildren = mode === "replace" ? roots : [...node.children, ...roots];
        return { ...d, children: updateNode(d.children, importTarget, { children: nextChildren }) };
      }
      return mode === "replace"
        ? { ...d, children: roots }
        : { ...d, children: [...d.children, ...roots] };
    });
    setModal(null);
    setImportText("");
    if (importTarget) setSelectedId(importTarget);
    else setSelectedId(null);
    setImportTarget(null);
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

  const flashSynced = () => {
    setSyncState("synced");
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => setSyncState("idle"), 1500);
  };

  // Let the user set (or change) the file the tree syncs to, then write to it.
  const pickSyncFile = async () => {
    if (!window.showSaveFilePicker) {
      // Browser without the File System Access API — fall back to a plain download.
      const blob = new Blob([exportMd], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(doc?.title || "tasks").replace(/[^\w.-]+/g, "-")}.md`;
      a.click();
      URL.revokeObjectURL(url);
      flashSynced();
      return;
    }
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: `${(doc?.title || "tasks").replace(/[^\w.-]+/g, "-")}.md`,
        types: [{ description: "Markdown", accept: { "text/markdown": [".md"] } }],
      });
      syncHandle.current = handle;
      setSyncFileName(handle.name);
      await writeSyncFile(handle);
    } catch (e) {
      if (e?.name !== "AbortError") setSyncState("error");
    }
  };

  const writeSyncFile = async (handle) => {
    setSyncState("syncing");
    try {
      const writable = await handle.createWritable();
      await writable.write(exportMd);
      await writable.close();
      flashSynced();
    } catch (e) {
      setSyncState("error");
    }
  };

  // Sync button: write to the already-chosen file, or prompt for one on first use.
  const syncExport = async () => {
    if (syncHandle.current) {
      await writeSyncFile(syncHandle.current);
    } else {
      await pickSyncFile();
    }
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
          <div className="tt-tabs" role="tablist">
            <button
              className={`tt-tab ${tab === "tree" ? "on" : ""}`}
              onClick={() => setTab("tree")}
            >
              🌳 Tree
            </button>
            <button
              className={`tt-tab ${tab === "forest" ? "on" : ""}`}
              onClick={() => setTab("forest")}
            >
              🌲 Forest{forest.length ? ` (${forest.length})` : ""}
            </button>
          </div>
          {tab === "tree" && (
            <span className="tt-progress">
              {done}/{total} done
              {focus && <em> · ◉ {labelOf(focus.title)}</em>}
              {saveState === "saving" && <em> · saving…</em>}
              {saveState === "saved" && <em> · saved</em>}
              {saveState === "error" && <em className="err"> · couldn't save</em>}
            </span>
          )}
        </div>
        <div className="tt-actions">
          {tab === "tree" && (selectedId || focusId) && (
            <button
              className="tt-btn ghost"
              onClick={() =>
                setFocusId(selectedId && selectedId !== focusId ? selectedId : null)
              }
              title={
                selectedId && selectedId !== focusId
                  ? "Show only this task's subtasks, full screen"
                  : "Show the whole tree again"
              }
            >
              {selectedId && selectedId !== focusId ? "◉ Focus" : "⊙ Show all"}
            </button>
          )}
          {tab === "tree" && (
            <>
              <button className="tt-btn ghost" onClick={fitView} title="Fit tree to screen">Fit</button>
              <button className="tt-btn ghost" onClick={() => { setModal("export"); setCopied(false); setSyncState("idle"); }}>Export</button>
              <button className="tt-btn solid" onClick={() => { setImportTarget(null); setImportText(""); setModal("import"); }}>Import .md</button>
            </>
          )}
        </div>
      </header>

      {/* canvas */}
      <div className="tt-canvas" ref={containerRef}>
        {tab === "forest" && <Forest achievements={forest} onReturn={returnFromForest} />}
        {tab === "tree" && (
        <>
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
                      onAdd={() => { setSelectedId(null); handleAddChild(focusId ?? "__root"); }}
                      label={focus ? `${focus.title} — add a sub-task` : undefined}
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
            The tree is empty. <button className="tt-linkbtn" onClick={() => { setImportTarget(null); setImportText(""); setModal("import"); }}>Import a markdown list</button> or tap the 🌳 to plant a first task.
          </div>
        )}
        </>
        )}

        {/* graduated-to-forest toast, with undo */}
        {planted && (
          <div className="tt-toast" key={planted.key}>
            <span className="tt-toast-icon">🌲</span>
            <span className="tt-toast-text">
              {planted.trees.length === 1
                ? <>“{labelOf(planted.trees[0].title || "Untitled branch")}” is complete — planted in your Forest.</>
                : <>{planted.trees.length} branches complete — planted in your Forest.</>}
            </span>
            <button className="tt-toast-undo" onClick={undoPlant}>Undo</button>
            {tab === "tree" && (
              <button className="tt-toast-go" onClick={() => setTab("forest")}>View</button>
            )}
          </div>
        )}
      </div>

      {/* detail panel */}
      <Panel
        selected={tab === "tree" ? selected : null}
        titleInputRef={titleInputRef}
        confirmDelete={confirmDelete}
        setConfirmDelete={setConfirmDelete}
        onPatch={(patch) => setDoc((d) => ({ ...d, children: updateNode(d.children, selectedId, patch) }))}
        onAddChild={() => handleAddChild(selected.id)}
        onImportChild={() => { setImportTarget(selected.id); setImportText(""); setModal("import"); }}
        onDelete={() => handleDelete(selected.id)}
        onClose={() => setSelectedId(null)}
      />

      {/* modals */}
      {modal === "import" && (
        <ImportModal
          text={importText}
          setText={setImportText}
          onImport={handleImport}
          onClose={() => { setModal(null); setImportTarget(null); }}
          targetTitle={importTarget ? findNode(doc.children, importTarget)?.title : null}
        />
      )}
      {modal === "export" && (
        <ExportModal
          markdown={exportMd}
          copied={copied}
          onCopy={copyExport}
          onClose={() => setModal(null)}
          onSync={syncExport}
          onPickSyncFile={pickSyncFile}
          syncState={syncState}
          syncFileName={syncFileName}
        />
      )}
    </div>
  );
}
