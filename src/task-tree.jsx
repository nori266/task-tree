import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import * as d3 from "d3";

/* ────────────────────────────────────────────────
   Task Tree — a calm, spatial todo manager
   Import nested markdown bullets → balanced tree.
   ──────────────────────────────────────────────── */

const STATUSES = [
  { key: "inprogress", emoji: "💻", label: "In progress", color: "#4F836B" },
  { key: "waiting",    emoji: "⏳", label: "Waiting to start", color: "#A08D5F" },
  { key: "blocked",    emoji: "🧱", label: "Blocked", color: "#B06A5A" },
  { key: "next",       emoji: "⏭️", label: "Will do next", color: "#5B7FA6" },
  { key: "done",       emoji: "✅", label: "Done", color: "#93A697" },
  { key: "question",   emoji: "❓", label: "Needs external input", color: "#8A6FA6" },
];
const TYPES = [
  { key: "call",   emoji: "☎️", label: "A call" },
  { key: "coding", emoji: "👩🏻‍💻", label: "Coding" },
];
const statusByKey = Object.fromEntries(STATUSES.map((s) => [s.key, s]));
const typeByKey = Object.fromEntries(TYPES.map((t) => [t.key, t]));
// Type emoji is expected at the START of an item, status emoji at the END.
// Both tolerate common variants (missing variation selector, other coder emojis).
const TYPE_VARIANTS = {
  call: ["☎️", "☎"],
  coding: ["👩🏻‍💻", "👩‍💻", "🧑🏻‍💻", "🧑‍💻", "👨🏻‍💻", "👨‍💻"],
};
function stripType(title) {
  for (const t of TYPES) {
    for (const v of TYPE_VARIANTS[t.key] ?? [t.emoji]) {
      if (title.startsWith(v)) return { key: t.key, title: title.slice(v.length).trim() };
    }
  }
  return null;
}
function stripStatus(title) {
  for (const s of STATUSES) {
    const variants = [...new Set([s.emoji, s.emoji.replace(/\uFE0F/g, "")])];
    for (const v of variants) {
      if (!title.endsWith(v)) continue;
      const rest = title.slice(0, -v.length);
      if (rest.endsWith("\u200D")) continue; // 💻 that is part of a 👩🏻‍💻-style sequence
      return { key: s.key, title: rest.trim() };
    }
  }
  return null;
}

// **Bold** anywhere in a title marks the task important; returns the title
// with the markers stripped, or null when there is no bold span.
function stripBold(title) {
  if (!/\*\*(.+?)\*\*/.test(title)) return null;
  return title.replace(/\*\*(.+?)\*\*/g, "$1").trim();
}

// Migrate docs saved by earlier versions (status "call" → type, missing
// type/important fields, literal ** markers left in stored titles).
function migrateNodes(nodes) {
  return nodes.map((n) => {
    let { title, status = null, type = null, important = false } = n;
    if (status === "call") { type = type ?? "call"; status = null; }
    if (status && !statusByKey[status]) status = null;
    const bolded = stripBold(title);
    if (bolded !== null) { important = true; title = bolded || "Untitled"; }
    return { ...n, title, status, type, important, children: migrateNodes(n.children || []) };
  });
}

let idCounter = 1;
const nid = () => `n${Date.now().toString(36)}_${idCounter++}`;
const newNode = (title = "New task", status = null, type = null, important = false) => ({
  id: nid(), title, desc: "", status, type, important, children: [],
});

/* ---------- markdown parsing / serializing ---------- */

function parseMarkdown(text) {
  const roots = [];
  const stack = []; // {indent, node}
  let last = null;
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    const bullet = raw.match(/^([ \t]*)[-*+]\s+(?:\[([ xX])\]\s*)?(.*)$/);
    if (bullet) {
      const indent = bullet[1].replace(/\t/g, "  ").length;
      let title = bullet[3].trim();
      let status = bullet[2] && bullet[2].toLowerCase() === "x" ? "done" : null;
      let type = null;
      let important = false;
      const bolded = stripBold(title);
      if (bolded !== null) { important = true; title = bolded; }
      const ty = stripType(title);
      if (ty) { type = ty.key; title = ty.title; }
      const st = stripStatus(title);
      if (st) { status = st.key; title = st.title; }
      if (!title) title = "Untitled";
      const node = newNode(title, status, type, important);
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      if (stack.length) stack[stack.length - 1].node.children.push(node);
      else roots.push(node);
      stack.push({ indent, node });
      last = node;
      continue;
    }
    const descLine = raw.match(/^[ \t]*>\s?(.*)$/);
    if (descLine && last) {
      last.desc = last.desc ? last.desc + "\n" + descLine[1] : descLine[1];
    }
  }
  return roots;
}

function toMarkdown(nodes, depth = 0) {
  let out = "";
  const pad = "  ".repeat(depth);
  for (const n of nodes) {
    const t = n.type && typeByKey[n.type] ? typeByKey[n.type].emoji + " " : "";
    const s = n.status && statusByKey[n.status] ? " " + statusByKey[n.status].emoji : "";
    out += `${pad}- ${t}${n.important ? `**${n.title}**` : n.title}${s}\n`;
    if (n.desc) for (const line of n.desc.split("\n")) out += `${pad}  > ${line}\n`;
    if (n.children?.length) out += toMarkdown(n.children, depth + 1);
  }
  return out;
}

/* ---------- immutable tree helpers ---------- */

const mapTree = (nodes, fn) =>
  nodes.map((n) => {
    const m = fn(n);
    return { ...m, children: m.children ? mapTree(m.children, fn) : [] };
  });

const updateNode = (nodes, id, patch) =>
  mapTree(nodes, (n) => (n.id === id ? { ...n, ...patch } : n));

const addChild = (nodes, parentId, child) =>
  mapTree(nodes, (n) =>
    n.id === parentId ? { ...n, children: [...n.children, child] } : n
  );

function removeNode(nodes, id) {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => ({ ...n, children: removeNode(n.children, id) }));
}

function findNode(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    const f = findNode(n.children, id);
    if (f) return f;
  }
  return null;
}

const countNodes = (nodes) =>
  nodes.reduce((a, n) => a + 1 + countNodes(n.children), 0);
const countDone = (nodes) =>
  nodes.reduce((a, n) => a + (n.status === "done" ? 1 : 0) + countDone(n.children), 0);

/* ---------- sample ---------- */

const SAMPLE_MD = `- Plan the garden 💻
  > Sketch what goes where before buying anything.
  - Measure the plot ✅
  - Choose plants 💻
    - Shortlist herbs ✅
    - Pick two shade-tolerant flowers ⏭️
    - ☎️ Ask neighbor which soil mix worked ❓
  - Order raised beds 🧱
    > Waiting for choices above.
- **Renew passport** ⏳
  - ☎️ Call the office for an appointment
  - Print photos
- 👩🏻‍💻 Automate the monthly report ⏭️
- Write monthly review`;

/* ---------- node sizing ---------- */

const PILL_H = 34;
const labelOf = (t) => (t.length > 26 ? t.slice(0, 25) + "…" : t);
const pillW = (n) =>
  Math.max(64, 26 + labelOf(n.title).length * (n.important ? 7.6 : 7.0) + (n.type ? 24 : 0) + (n.status ? 22 : 0));

// Butterfly wing, drawn to the left of the body; the right wing mirrors it.
const WING_D = "M0,-1 C-8,-9 -13,-3 -6,-.5 C-12,2 -8,8 0,3 Z";
const WING_COLORS = ["#E8A94F", "#D98A66", "#8A6FA6", "#7FAE93", "#D9789B"];
const CELEBRATE_MIN_SUBNODES = 10;

// Deterministic pseudo-random in [-0.5, 0.5) seeded by node id, so the
// organic jitter of done branches is stable across renders.
function jitter(id, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000 - 0.5;
}

/* ════════════════════════════════════════════════ */

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
  const doneBranchIds = useMemo(() => {
    const ids = new Set();
    const allDone = (n) => n.status === "done" && n.children.every(allDone);
    const mark = (n) => { ids.add(n.id); n.children.forEach(mark); };
    const walk = (n) => {
      if (n.children.length && allDone(n)) mark(n);
      else n.children.forEach(walk);
    };
    doc?.children.forEach(walk);
    return ids;
  }, [doc]);

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
    const flock = Array.from({ length: count }, (_, i) => {
      const a = -Math.PI * (0.12 + 0.76 * Math.random()); // upward fan
      const dist = 90 + Math.random() * 110;
      return {
        tx: Math.cos(a) * dist,
        ty: Math.sin(a) * dist - 20,
        dur: 2.2 + Math.random() * 1.6,
        delay: Math.random() * 0.7,
        rot: -25 + Math.random() * 50,
        color: WING_COLORS[i % WING_COLORS.length],
      };
    });
    clearTimeout(celebrationTimer.current);
    setCelebration({ id: star.id, key: Date.now(), flock });
    celebrationTimer.current = setTimeout(() => setCelebration(null), 4600);
  }, [doc]);

  useEffect(() => () => clearTimeout(celebrationTimer.current), []);

  /* ----- layout ----- */
  const layout = useMemo(() => {
    if (!doc) return { nodes: [], links: [] };
    const rootData = { id: "__root", title: doc.title, children: doc.children };
    const h = d3.hierarchy(rootData, (d) => d.children);
    // Nudge nodes of finished subtrees off the tidy grid — varying edge
    // lengths (and a little sideways drift) so the branch reads organic.
    const naturalize = (nodes) => {
      const byD = new Map(nodes.map((n) => [n.d, n]));
      for (const n of nodes) {
        if (n.d.depth === 0 || !doneBranchIds.has(n.d.data.id)) continue;
        const p = byD.get(n.d.parent);
        if (!p) continue;
        let dx = n.x - p.x, dy = n.y - p.y;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        const along = jitter(n.d.data.id) * 48;
        const side = jitter(n.d.data.id, 7) * 24;
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
  }, [doc, layoutMode, size.w, size.h, doneBranchIds]);

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
  const onPointerUp = (e) => {
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
      <style>{CSS}</style>

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
                    <g
                      key="__root"
                      data-node="root"
                      transform={`translate(${n.x},${n.y})`}
                      className={`tt-hub ${dragState?.over === "__root" ? "drop" : ""}`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => { setSelectedId(null); handleAddChild("__root"); }}
                    >
                      <circle r={17} />
                      <text y={1} textAnchor="middle" dominantBaseline="middle" className="tt-hub-emoji">🌳</text>
                      <title>Add a top-level task</title>
                    </g>
                  );
                }
                const w = pillW(data);
                const st = data.status ? statusByKey[data.status] : null;
                const ty = data.type ? typeByKey[data.type] : null;
                const isSel = data.id === selectedId;
                const isDone = data.status === "done";
                const isLeaf = !data.children || data.children.length === 0;
                const isDrop = dragState?.over === data.id;
                const isDragging = dragState?.id === data.id;
                const nodeHandlers = {
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
                };
                // Inner nodes of a fully-done subtree fold into a bare twig;
                // selecting expands them back to a pill.
                if (!isLeaf && doneBranchIds.has(data.id) && !isSel) {
                  return (
                    <g
                      key={data.id}
                      data-node={data.id}
                      transform={`translate(${n.x},${n.y})`}
                      className={`tt-twig ${isDragging ? "dragging" : ""}`}
                      {...nodeHandlers}
                    >
                      <g className="tt-twig-inner">
                        <circle r={17} className="tt-realleaf-hit" />
                        <path d="M-16,0 Q-2,2 15,-2 M-3,1 Q5,-3 10,-9 M3,0 Q9,5 14,8" className="tt-twig-wood" />
                        <path d="M0,0 C-3,-3 -3,-8 0,-11 C3,-8 3,-3 0,0 Z" transform="translate(10,-9) rotate(40)" className="tt-twig-leaf" />
                        <path d="M0,0 C-3,-3 -3,-8 0,-11 C3,-8 3,-3 0,0 Z" transform="translate(14,8) rotate(130)" className="tt-twig-leaf" />
                      </g>
                      {isDrop && <circle r={21} className="tt-drop-ring" />}
                      <title>{data.title}{data.desc ? "\n" + data.desc : ""}</title>
                    </g>
                  );
                }
                // Done leaves fold into a real leaf; selecting expands them back to a pill.
                if (isDone && isLeaf && !isSel) {
                  return (
                    <g
                      key={data.id}
                      data-node={data.id}
                      transform={`translate(${n.x},${n.y}) rotate(90)`}
                      className={`tt-realleaf ${isDragging ? "dragging" : ""}`}
                      {...nodeHandlers}
                    >
                      <g className="tt-realleaf-inner">
                        <circle r={17} className="tt-realleaf-hit" />
                        <path d="M0,9 Q1,15 -2,20" className="tt-realleaf-stem" />
                        <path d="M0,10 C-10,2 -10,-10 0,-18 C10,-10 10,2 0,10 Z" className="tt-realleaf-blade" />
                        <path d="M0,8 L0,-14 M0,2 Q-4,-1 -6,-5 M0,-2 Q4,-5 6,-9" className="tt-realleaf-vein" />
                      </g>
                      {isDrop && <circle r={21} className="tt-drop-ring" />}
                      <title>{data.title}{data.desc ? "\n" + data.desc : ""}</title>
                    </g>
                  );
                }
                return (
                  <g
                    key={data.id}
                    data-node={data.id}
                    transform={`translate(${n.x - w / 2},${n.y - PILL_H / 2})`}
                    className={`tt-pill ${isSel ? "sel" : ""} ${isDone ? "done" : ""} ${isLeaf ? "leaf" : ""} ${data.important ? "imp" : ""} ${isDragging ? "dragging" : ""}`}
                    {...nodeHandlers}
                  >
                    <rect width={w} height={PILL_H} rx={11} className="tt-pill-bg" />
                    {st && (
                      <rect width={4} height={PILL_H - 12} x={5} y={6} rx={2} fill={st.color} opacity={isDone ? 0.4 : 0.9} />
                    )}
                    {ty && (
                      <text x={13} y={PILL_H / 2 + 1} dominantBaseline="middle" className="tt-pill-emoji">
                        {ty.emoji}
                      </text>
                    )}
                    <text x={ty ? 38 : 14} y={PILL_H / 2 + 1} dominantBaseline="middle" className="tt-pill-title">
                      {labelOf(data.title)}
                    </text>
                    {st && (
                      <text x={w - 23} y={PILL_H / 2 + 1} dominantBaseline="middle" className="tt-pill-emoji">
                        {st.emoji}
                      </text>
                    )}
                    {data.desc && <circle cx={w - 8} cy={8} r={2.6} className="tt-desc-dot" />}
                    {isDrop && (
                      <rect x={-3} y={-3} width={w + 6} height={PILL_H + 6} rx={13} className="tt-drop-ring" />
                    )}
                    {isSel && <rect width={w} height={PILL_H} rx={11} className="tt-pill-ring" />}
                    <title>{data.title}{data.desc ? "\n" + data.desc : ""}</title>
                  </g>
                );
              })}
              {dragState && doc && (() => {
                const dn = findNode(doc.children, dragState.id);
                if (!dn) return null;
                const w = pillW(dn);
                const ty = dn.type ? typeByKey[dn.type] : null;
                const st = dn.status ? statusByKey[dn.status] : null;
                return (
                  <g
                    className={`tt-ghost ${dn.important ? "imp" : ""}`}
                    style={{ pointerEvents: "none" }}
                    transform={`translate(${dragState.x - w / 2},${dragState.y - PILL_H / 2})`}
                  >
                    <rect width={w} height={PILL_H} rx={11} className="tt-pill-bg" />
                    {ty && (
                      <text x={13} y={PILL_H / 2 + 1} dominantBaseline="middle" className="tt-pill-emoji">{ty.emoji}</text>
                    )}
                    <text x={ty ? 38 : 14} y={PILL_H / 2 + 1} dominantBaseline="middle" className="tt-pill-title">
                      {labelOf(dn.title)}
                    </text>
                    {st && (
                      <text x={w - 23} y={PILL_H / 2 + 1} dominantBaseline="middle" className="tt-pill-emoji">{st.emoji}</text>
                    )}
                  </g>
                );
              })()}
              {celebration && (() => {
                const n = layout.nodes.find((m) => m.d.depth > 0 && m.d.data.id === celebration.id);
                if (!n) return null;
                return (
                  <g key={celebration.key} className="tt-bflock" transform={`translate(${n.x},${n.y})`}>
                    {celebration.flock.map((b, i) => (
                      <g
                        key={i}
                        className="tt-bfly"
                        style={{ "--tx": `${b.tx}px`, "--ty": `${b.ty}px`, animationDuration: `${b.dur}s`, animationDelay: `${b.delay}s` }}
                      >
                        <g className="tt-bfly-sway" style={{ animationDelay: `${-i * 0.13}s` }}>
                          <g transform={`rotate(${b.rot})`}>
                            <path className="tt-bfly-wing" d={WING_D} fill={b.color} style={{ animationDelay: `${-i * 0.05}s` }} />
                            <g transform="scale(-1,1)">
                              <path className="tt-bfly-wing" d={WING_D} fill={b.color} style={{ animationDelay: `${-i * 0.05}s` }} />
                            </g>
                            <ellipse rx={1.3} ry={4.6} className="tt-bfly-body" />
                          </g>
                        </g>
                      </g>
                    ))}
                  </g>
                );
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
      <aside className={`tt-panel ${selected ? "open" : ""}`}>
        {selected && (
          <>
            <div className="tt-panel-head">
              <span className="tt-panel-eyebrow">Task</span>
              <button className="tt-x" onClick={() => setSelectedId(null)} aria-label="Close panel">×</button>
            </div>

            <div className="tt-panel-body">
              <label className="tt-field">
                <span>Title</span>
                <input
                  ref={titleInputRef}
                  value={selected.title}
                  onChange={(e) => setDoc((d) => ({ ...d, children: updateNode(d.children, selected.id, { title: e.target.value }) }))}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                />
              </label>

              <label className="tt-field">
                <span>Description</span>
                <textarea
                  rows={2}
                  placeholder="Notes, links, context…"
                  value={selected.desc}
                  onChange={(e) => setDoc((d) => ({ ...d, children: updateNode(d.children, selected.id, { desc: e.target.value }) }))}
                />
              </label>

              <div className="tt-field">
                <span>Type</span>
                <div className="tt-types">
                  <button
                    className={`tt-chip ${!selected.type ? "on" : ""}`}
                    onClick={() => setDoc((d) => ({ ...d, children: updateNode(d.children, selected.id, { type: null }) }))}
                  >
                    — None
                  </button>
                  {TYPES.map((t) => (
                    <button
                      key={t.key}
                      className={`tt-chip ${selected.type === t.key ? "on" : ""}`}
                      onClick={() => setDoc((d) => ({ ...d, children: updateNode(d.children, selected.id, { type: t.key }) }))}
                    >
                      {t.emoji} {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="tt-field">
                <span>Importance</span>
                <div className="tt-types">
                  <button
                    className={`tt-chip ${selected.important ? "on" : ""}`}
                    onClick={() => setDoc((d) => ({ ...d, children: updateNode(d.children, selected.id, { important: !selected.important }) }))}
                  >
                    ★ Important
                  </button>
                </div>
              </div>

              <div className="tt-field">
                <span>Status</span>
                <div className="tt-statuses">
                  <button
                    className={`tt-status ${!selected.status ? "on" : ""}`}
                    style={{ "--sc": "#9AA79E" }}
                    onClick={() => setDoc((d) => ({ ...d, children: updateNode(d.children, selected.id, { status: null }) }))}
                  >
                    <b>—</b>No status
                  </button>
                  {STATUSES.map((s) => (
                    <button
                      key={s.key}
                      className={`tt-status ${selected.status === s.key ? "on" : ""}`}
                      style={{ "--sc": s.color }}
                      onClick={() => setDoc((d) => ({ ...d, children: updateNode(d.children, selected.id, { status: s.key }) }))}
                    >
                      <b>{s.emoji}</b>{s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="tt-panel-foot">
              <button className="tt-btn solid wide" onClick={() => handleAddChild(selected.id)}>
                + Add sub-task
              </button>
              <button
                className={`tt-btn danger wide ${confirmDelete ? "confirm" : ""}`}
                onClick={() => (confirmDelete ? handleDelete(selected.id) : setConfirmDelete(true))}
                onBlur={() => setConfirmDelete(false)}
              >
                {confirmDelete
                  ? `Really delete${selected.children.length ? " (with sub-tasks)" : ""}?`
                  : "Delete task"}
              </button>
            </div>
          </>
        )}
      </aside>

      {/* modals */}
      {modal === "import" && (
        <div className="tt-scrim" onClick={() => setModal(null)}>
          <div className="tt-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Import markdown</h3>
            <p className="tt-note">
              Nested bullets become branches. A type emoji at the start of an item
              ({TYPES.map((t) => t.emoji).join(" ")}) and a status emoji at its end
              ({STATUSES.map((s) => s.emoji).join(" ")}) are picked up; items without a
              status emoji stay status-free. <code>- [x]</code> counts as done; lines
              starting with <code>&gt;</code> become the description of the item above.
              Titles written in <code>**bold**</code> are marked important and shown
              highlighted in the tree.
            </p>
            <textarea
              rows={12}
              autoFocus
              placeholder={SAMPLE_MD}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <div className="tt-modal-actions">
              <button className="tt-btn ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="tt-btn ghost" disabled={!importText.trim()} onClick={() => handleImport("append")}>Add to tree</button>
              <button className="tt-btn solid" disabled={!importText.trim()} onClick={() => handleImport("replace")}>Replace tree</button>
            </div>
          </div>
        </div>
      )}

      {modal === "export" && (
        <div className="tt-scrim" onClick={() => setModal(null)}>
          <div className="tt-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Export markdown</h3>
            <textarea rows={12} readOnly value={exportMd} onFocus={(e) => e.currentTarget.select()} />
            <div className="tt-modal-actions">
              <button className="tt-btn ghost" onClick={() => setModal(null)}>Close</button>
              <button className="tt-btn solid" onClick={copyExport}>{copied ? "Copied ✓" : "Copy"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────────────── styles ────────────────── */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Albert+Sans:wght@400;500;600;700&family=Newsreader:ital,opsz,wght@1,6..72,400&display=swap');

.tt-root {
  --bg: #ECEFEA;
  --ink: #33403A;
  --muted: #86928A;
  --line: #C6D0C7;
  --pill: #FBFCFA;
  --pill-border: #DDE4DC;
  --accent: #4F836B;
  --panel: #F7F9F5;
  position: fixed; inset: 0;
  background:
    radial-gradient(1200px 800px at 70% -10%, #F4F7F1 0%, transparent 60%),
    var(--bg);
  color: var(--ink);
  font-family: 'Albert Sans', ui-rounded, system-ui, -apple-system, sans-serif;
  font-size: 14px;
  overflow: hidden;
  display: flex; flex-direction: column;
}
.tt-root *, .tt-root *::before, .tt-root *::after { box-sizing: border-box; }
.tt-root button { font: inherit; cursor: pointer; }

/* top bar */
.tt-bar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 10px 16px;
  border-bottom: 1px solid #DFE6DD;
  background: rgba(247,249,245,.8); backdrop-filter: blur(6px);
  z-index: 5; flex-wrap: wrap;
}
.tt-brand { display: flex; align-items: baseline; gap: 10px; }
.tt-brand-dot {
  width: 10px; height: 10px; border-radius: 50%;
  background: var(--accent); display: inline-block; align-self: center;
}
.tt-brand-name { font-weight: 600; letter-spacing: .01em; }
.tt-progress { color: var(--muted); font-size: 12.5px; }
.tt-progress em { font-style: normal; opacity: .8; }
.tt-progress .err { color: #B06A5A; }
.tt-actions { display: flex; gap: 8px; flex-wrap: wrap; }

.tt-btn {
  border-radius: 9px; padding: 7px 13px; border: 1px solid transparent;
  transition: background .18s ease, border-color .18s ease, color .18s ease, transform .12s ease;
  font-weight: 500;
}
.tt-btn:active { transform: scale(.97); }
.tt-btn.ghost { background: transparent; border-color: #D6DED4; color: var(--ink); }
.tt-btn.ghost:hover { background: #E4E9E2; }
.tt-btn.solid { background: var(--accent); color: #FBFDFA; }
.tt-btn.solid:hover { background: #45755F; }
.tt-btn.solid:disabled, .tt-btn.ghost:disabled { opacity: .45; cursor: default; }
.tt-btn.danger { background: transparent; border-color: #DCC9C3; color: #A15B4C; }
.tt-btn.danger:hover { background: #F2E7E3; }
.tt-btn.danger.confirm { background: #B06A5A; border-color: #B06A5A; color: #FFF7F4; }
.tt-btn.wide { width: 100%; }

/* canvas */
.tt-canvas { position: relative; flex: 1; min-height: 0; }
.tt-svgwrap { position: absolute; inset: 0; cursor: grab; touch-action: none; }
.tt-svgwrap:active { cursor: grabbing; }

.tt-link {
  fill: none; stroke: var(--line); stroke-width: 1.4;
  transition: stroke .2s ease;
}

.tt-hub circle {
  fill: #F2F5EF; stroke: #C9D3C8; stroke-width: 1.5;
  transition: fill .18s ease, stroke .18s ease;
}
.tt-hub { cursor: pointer; }
.tt-hub:hover circle { fill: #E7EEE5; stroke: var(--accent); }
.tt-hub-emoji { font-size: 15px; }

.tt-pill { cursor: grab; }
.tt-pill-bg {
  fill: #EDF1EB; stroke: var(--pill-border); stroke-width: 1;
  filter: drop-shadow(0 1px 2px rgba(51,64,58,.08));
  transition: stroke .18s ease, fill .18s ease, filter .18s ease;
}
.tt-pill.leaf .tt-pill-bg {
  fill: #FFFFFF; stroke: #D3DED3;
  filter: drop-shadow(0 2px 5px rgba(51,64,58,.12));
}
.tt-pill:hover .tt-pill-bg {
  stroke: #B9C6BB;
  filter: drop-shadow(0 3px 8px rgba(51,64,58,.14));
}
.tt-pill.dragging { opacity: .3; }
.tt-ghost { opacity: .95; cursor: grabbing; }
.tt-ghost .tt-pill-bg {
  fill: #FFFFFF; stroke: var(--accent); stroke-width: 1.4;
  filter: drop-shadow(0 10px 22px rgba(51,64,58,.26));
}
.tt-drop-ring {
  fill: rgba(79,131,107,.06); stroke: var(--accent); stroke-width: 1.8;
  stroke-dasharray: 6 5; pointer-events: none;
}
.tt-hub.drop circle { stroke: var(--accent); stroke-width: 2.2; fill: #E4EFE6; }
.tt-pill-ring {
  fill: none; stroke: var(--accent); stroke-width: 1.8;
  pointer-events: none;
}
.tt-pill-emoji { font-size: 13px; }
.tt-pill-title {
  font-size: 12.5px; font-weight: 500; fill: var(--ink);
  font-family: inherit;
}
/* important (**bold** in imported md): bold label, brighter pill */
.tt-pill.imp .tt-pill-title, .tt-ghost.imp .tt-pill-title { font-weight: 700; }
.tt-pill.imp .tt-pill-bg {
  fill: #FBFEF3; stroke: #AECBA9;
  filter: drop-shadow(0 2px 6px rgba(79,131,107,.22));
}
.tt-pill.imp:hover .tt-pill-bg { stroke: #8FB68F; }
.tt-pill.done .tt-pill-bg { fill: #F1F4EF; }
.tt-pill.done .tt-pill-title { fill: #9AA79E; text-decoration: line-through; }
.tt-pill.done .tt-pill-emoji { opacity: .75; }
.tt-desc-dot { fill: var(--muted); opacity: .7; }

/* done leaf → real leaf */
.tt-realleaf { cursor: grab; }
.tt-realleaf.dragging { opacity: .3; }
.tt-realleaf-hit { fill: transparent; }
.tt-realleaf-blade {
  fill: #7FAE93; stroke: #4F836B; stroke-width: 1.2;
  transition: fill .18s ease;
}
.tt-realleaf:hover .tt-realleaf-blade { fill: #91BFA5; }
.tt-realleaf-stem, .tt-realleaf-vein {
  fill: none; stroke: #4F836B; stroke-width: 1.1;
  stroke-linecap: round; opacity: .65;
}
.tt-realleaf-inner {
  transform-box: fill-box; transform-origin: 50% 88%;
  animation: tt-sprout .55s cubic-bezier(.34,1.56,.64,1) both;
}
/* fully-done subtree: same weight as other branches, just greener */
.tt-link.done { stroke: #9CBD9F; }
/* branch feeding an in-progress task reads heavier and darker */
.tt-link.active { stroke: #7E9184; stroke-width: 2.8; }
.tt-twig { cursor: grab; }
.tt-twig.dragging { opacity: .3; }
.tt-twig-wood {
  fill: none; stroke: #7A6248; stroke-width: 2; stroke-linecap: round;
  transition: stroke .18s ease;
}
.tt-twig:hover .tt-twig-wood { stroke: #93795B; }
.tt-twig-leaf { fill: #7FAE93; stroke: #4F836B; stroke-width: .9; }
.tt-twig-inner {
  transform-box: fill-box; transform-origin: 0% 50%;
  animation: tt-grow .5s ease-out both;
}
@keyframes tt-grow {
  from { transform: scaleX(.3); opacity: 0; }
  to { transform: none; opacity: 1; }
}
@keyframes tt-sprout {
  from { transform: scale(0) rotate(-45deg); opacity: 0; }
  60% { transform: scale(1.15) rotate(8deg); opacity: 1; }
  to { transform: scale(1) rotate(0deg); opacity: 1; }
}

/* butterflies over a big branch that just became fully done */
.tt-bflock { pointer-events: none; }
.tt-bfly { animation: tt-bfly-fly ease-out both; }
@keyframes tt-bfly-fly {
  0% { transform: translate(0,0) scale(.3); opacity: 0; }
  10% { opacity: 1; }
  15% { transform: translate(calc(var(--tx)*.18), calc(var(--ty)*.18)) scale(1); }
  80% { opacity: .9; }
  100% { transform: translate(var(--tx), var(--ty)) scale(.85); opacity: 0; }
}
.tt-bfly-sway { animation: tt-bfly-sway .7s ease-in-out infinite alternate; }
@keyframes tt-bfly-sway {
  from { transform: translateX(-5px) rotate(-9deg); }
  to { transform: translateX(5px) rotate(9deg); }
}
.tt-bfly-wing {
  stroke: rgba(51,64,58,.35); stroke-width: .6;
  transform-box: fill-box; transform-origin: 100% 50%;
  animation: tt-bfly-flap .16s ease-in-out infinite alternate;
}
@keyframes tt-bfly-flap { from { transform: scaleX(1); } to { transform: scaleX(.2); } }
.tt-bfly-body { fill: #5B4A3A; }

/* legend */
.tt-legend {
  position: absolute; left: 12px; bottom: 12px;
  display: flex; gap: 4px 10px; flex-wrap: wrap; max-width: min(560px, 90%);
  background: rgba(247,249,245,.85); backdrop-filter: blur(4px);
  border: 1px solid #E0E7DE; border-radius: 10px;
  padding: 7px 11px; font-size: 11.5px; color: var(--muted);
}
.tt-legend span { display: inline-flex; align-items: center; gap: 4px; }
.tt-legend i { font-style: normal; }
@media (max-width: 640px) { .tt-legend i { display: none; } .tt-legend { gap: 8px; } }

.tt-empty {
  position: absolute; left: 50%; top: 42%; transform: translate(-50%,-50%);
  font-family: 'Newsreader', Georgia, serif; font-style: italic;
  font-size: 17px; color: var(--muted); text-align: center; width: min(420px, 86%);
}
.tt-linkbtn {
  background: none; border: none; padding: 0; font: inherit;
  color: var(--accent); text-decoration: underline;
}

/* panel */
.tt-panel {
  position: absolute; top: 54px; right: 0; bottom: 0; width: 320px;
  background: var(--panel); border-left: 1px solid #E0E7DE;
  padding: 16px;
  transform: translateX(105%);
  transition: transform .32s cubic-bezier(.3,.8,.3,1);
  z-index: 6; display: flex; flex-direction: column; gap: 14px;
  box-shadow: -8px 0 24px rgba(51,64,58,.06);
}
.tt-panel.open { transform: translateX(0); }
@media (max-width: 640px) {
  .tt-panel {
    top: auto; left: 0; width: 100%; max-height: 62%;
    border-left: none; border-top: 1px solid #E0E7DE;
    border-radius: 16px 16px 0 0;
    transform: translateY(105%);
  }
  .tt-panel.open { transform: translateY(0); }
}
.tt-panel-head { display: flex; align-items: center; justify-content: space-between; }
/* only the fields scroll; the footer buttons stay pinned and reachable.
   the tiny negative margin keeps focus rings from being clipped at the edges */
.tt-panel-body {
  flex: 1; min-height: 0; overflow-y: auto;
  display: flex; flex-direction: column; gap: 14px;
  margin: -3px; padding: 3px;
}
.tt-panel-eyebrow {
  font-size: 11px; letter-spacing: .14em; text-transform: uppercase;
  color: var(--muted); font-weight: 600;
}
.tt-x {
  background: none; border: none; font-size: 22px; line-height: 1;
  color: var(--muted); padding: 2px 6px; border-radius: 6px;
}
.tt-x:hover { background: #E7ECE5; color: var(--ink); }

.tt-field { display: flex; flex-direction: column; gap: 6px; }
.tt-field > span { font-size: 12px; color: var(--muted); font-weight: 500; }
.tt-field input, .tt-field textarea, .tt-modal textarea {
  border: 1px solid #D8E0D6; border-radius: 9px; padding: 8px 10px;
  background: #FDFEFC; color: var(--ink); font: inherit; resize: vertical;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.tt-field input:focus, .tt-field textarea:focus, .tt-modal textarea:focus {
  outline: none; border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(79,131,107,.14);
}

.tt-statuses { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
.tt-types { display: flex; gap: 6px; flex-wrap: wrap; }
.tt-chip {
  border: 1px solid #DDE4DB; border-radius: 9px; padding: 7px 11px;
  background: #FDFEFC; color: var(--ink);
  transition: border-color .15s ease, background .15s ease;
}
.tt-chip:hover { border-color: var(--accent); }
.tt-chip.on { border-color: var(--accent); background: #EDF3EE; box-shadow: inset 0 0 0 1px var(--accent); }
.tt-leg-label {
  color: #6E7A72; font-weight: 600; text-transform: uppercase;
  letter-spacing: .08em; font-size: 10px;
}
.tt-leg-label.sep { margin-left: 8px; }
.tt-status {
  display: flex; align-items: center; gap: 6px;
  border: 1px solid #DDE4DB; border-radius: 9px; padding: 6px 8px;
  background: #FDFEFC; color: var(--ink); text-align: left;
  font-size: 12.5px; line-height: 1.25;
  transition: border-color .15s ease, background .15s ease;
}
.tt-status b { font-weight: 400; width: 18px; text-align: center; flex: none; }
.tt-status:hover { border-color: var(--sc); }
.tt-status.on {
  border-color: var(--sc);
  background: color-mix(in srgb, var(--sc) 10%, #FDFEFC);
  box-shadow: inset 3px 0 0 var(--sc);
}

.tt-panel-foot {
  display: flex; flex-direction: column; gap: 8px;
  padding-top: 10px; border-top: 1px solid #E0E7DE;
}

/* modal */
.tt-scrim {
  position: fixed; inset: 0; background: rgba(51,64,58,.28);
  display: flex; align-items: center; justify-content: center;
  z-index: 20; padding: 16px; backdrop-filter: blur(2px);
  animation: tt-fade .2s ease;
}
@keyframes tt-fade { from { opacity: 0; } to { opacity: 1; } }
.tt-modal {
  background: var(--panel); border-radius: 14px; padding: 18px;
  width: min(620px, 100%); display: flex; flex-direction: column; gap: 12px;
  box-shadow: 0 20px 60px rgba(51,64,58,.22);
  animation: tt-rise .24s cubic-bezier(.3,.8,.3,1);
}
@keyframes tt-rise { from { transform: translateY(10px); opacity: 0; } to { transform: none; opacity: 1; } }
.tt-modal h3 { margin: 0; font-size: 16px; font-weight: 600; }
.tt-note { margin: 0; color: var(--muted); font-size: 12.5px; line-height: 1.5; }
.tt-note code { background: #E7ECE5; border-radius: 4px; padding: 1px 4px; font-size: 11.5px; }
.tt-modal textarea { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 12.5px; line-height: 1.5; }
.tt-modal-actions { display: flex; justify-content: flex-end; gap: 8px; }

@media (prefers-reduced-motion: reduce) {
  .tt-root * { transition-duration: 0s !important; animation-duration: 0s !important; }
}
`;
