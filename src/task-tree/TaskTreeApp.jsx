import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  STATUSES, TYPES, setVocab, newNode, updateNode, addChild, removeNode, findNode,
  countNodes, countDone, addDep, removeDep, dropDepsFor, pruneDeps, predictType,
} from "./model.js";
import { parseMarkdown, toMarkdown, migrateNodes, SAMPLE_MD } from "./markdown.js";
import { PILL_H, labelOf, pillW, computeDoneBranchIds, computeLayout, ZOOM_SPEED, ZOOM_MIN, ZOOM_MAX } from "./layout.js";
import {
  RootHub, TaskPill, DoneLeaf, DoneTwig, DragGhost, Butterflies, makeFlock, FallingLeaves,
} from "./nodes.jsx";
import useLayoutTween from "./useLayoutTween.js";
import Panel from "./Panel.jsx";
import { ImportModal, ExportModal, VocabModal } from "./Modals.jsx";
import Forest from "./Forest.jsx";
import Backlog from "./Backlog.jsx";
import ProjectsPanel from "./ProjectsPanel.jsx";
import {
  INDEX_KEY, ACTIVE_KEY, VOCAB_KEY, docKey, forestKey, backlogKey, litterKey,
  newProjectId, migrateLegacy, getRaw,
} from "./projects.js";
import {
  sweepBacklog, mergeIntoBacklog, takeFromBacklog, graftIntoTree, countBacklogged,
} from "./backlog.js";
import {
  dayIndex, fadedIds as computeFadedIds, collectFallen, applyFall, stampDone, shedUnder,
} from "./leaffall.js";
import "./task-tree.css";

/* ────────────────────────────────────────────────
   Task Tree — a calm, spatial todo manager
   Import nested markdown bullets → balanced tree.
   ──────────────────────────────────────────────── */

const CELEBRATE_MIN_SUBNODES = 10; // subnodes that earn a branch a tree in the Forest
const BUTTERFLY_MIN_SUBNODES = 4;  // smaller finished branches erode, so they get butterflies

const HISTORY_LIMIT = 100;   // undo depth; older snapshots drop off the bottom
const EDIT_COALESCE_MS = 700; // consecutive text edits to one task fold into one undo step

export default function TaskTreeApp() {
  const [doc, setDoc] = useState(null); // {title, children}
  const [forest, setForest] = useState([]); // graduated achievements, newest first
  const [backlog, setBacklog] = useState([]); // mirror tree of aged-out branches
  const [litter, setLitter] = useState([]); // fallen done leaves, on the Forest floor
  const [tab, setTab] = useState("tree"); // 'tree' | 'forest' | 'backlog'
  const [planted, setPlanted] = useState(null); // {trees, key} undo toast
  const [backlogged, setBacklogged] = useState(null); // {count, title, key} toast
  const [fell, setFell] = useState(null); // {count, key, snapshot} undo toast for a leaf-fall
  const [falling, setFalling] = useState(null); // {key, ids, leaves} mid-flight, tree not yet reflowed
  const [fallTick, setFallTick] = useState(0); // bumped when a leaf-fall sweep is due
  const [today, setToday] = useState(() => dayIndex(Date.now())); // local calendar day
  const [sweepTick, setSweepTick] = useState(0); // re-checks ages while the app stays open
  const [selectedId, setSelectedId] = useState(null);
  const [cursorId, setCursorId] = useState(null); // keyboard navigation cursor (ring only, no panel)
  const [linkingId, setLinkingId] = useState(null); // dependent node awaiting a blocker pick
  const [focusId, setFocusId] = useState(null); // when set, only this node's subtree is shown
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [modal, setModal] = useState(null); // 'import' | 'export' | 'vocab' | null
  const [, setVocabRev] = useState(0); // bumped on vocab change to force a re-render
  const [importText, setImportText] = useState("");
  const [importTarget, setImportTarget] = useState(null); // node id to import into, or null for whole tree
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [copied, setCopied] = useState(false);
  const [syncState, setSyncState] = useState("idle"); // idle | syncing | synced | error
  const [syncFileName, setSyncFileName] = useState(null);
  const [structureRev, setStructureRev] = useState(0);
  const [size, setSize] = useState({ w: 1000, h: 700 });
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [projects, setProjects] = useState([]); // [{id, title}]
  const [activeId, setActiveId] = useState(null); // active project id
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [deletedProject, setDeletedProject] = useState(null); // {meta, raws, at, key} undo toast

  const containerRef = useRef(null);
  const svgWrapRef = useRef(null);
  const titleInputRef = useRef(null);
  const drag = useRef(null);
  const nodeDrag = useRef(null); // pointer bookkeeping for drag-to-reparent
  const [dragState, setDragState] = useState(null); // {id, x, y, over} while dragging a node
  const [celebration, setCelebration] = useState(null); // {id, key, flock} butterflies over a freshly finished big branch
  const loaded = useRef(false);
  const prevBigDone = useRef(null); // ids of big fully-done branches on the previous doc
  const prevGraduable = useRef(null); // ids of branches that already graduated, any depth
  const celebrationTimer = useRef(null);
  const plantedTimer = useRef(null);
  const backloggedTimer = useRef(null);
  const lastSweepDay = useRef(null); // day index of the last leaf-fall sweep
  const fallTimer = useRef(null);
  const fellTimer = useRef(null);
  const syncHandle = useRef(null); // retained FileSystemFileHandle for the user-chosen sync file
  const syncTimer = useRef(null);
  const deletedTimer = useRef(null);

  /* ----- undo/redo -----
     Every undoable action snapshots the four persistent stores (doc, forest,
     backlog, litter) before it runs. Snapshots hold references, not clones:
     all mutations are immutable (model.js), so a captured store is never
     altered underneath us. Transient UI state (selection, focus, view, toasts)
     is deliberately outside history — undo restores data, not cursor position.
     The time-driven lifecycle events (graduation, leaf-fall, backlog aging)
     keep their own toast-undos and are not pushed here; a global undo after one
     of them rewinds to the last user-committed state, which stays consistent. */
  const liveState = useRef({ doc: null, forest: [], backlog: [], litter: [] });
  const past = useRef([]);   // undo stack, newest last
  const future = useRef([]); // redo stack, newest last
  const editCoalesce = useRef({ id: null, at: 0 });

  /* ----- read one project's four stores from storage -----
     Pure read + parse/migrate; never touches React state, so it's reused by the
     initial load, project switching, delete and undo. */
  const readStores = async (id) => {
    const read = async (key) => {
      const raw = await getRaw(window.storage, key);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch (e) { return null; }
    };
    let d = await read(docKey(id));
    if (!d || !Array.isArray(d.children)) {
      d = { title: "My tasks", children: parseMarkdown(SAMPLE_MD) };
    } else {
      d = { ...d, children: migrateNodes(d.children) };
    }
    const f = await read(forestKey(id));
    const b = await read(backlogKey(id));
    const l = await read(litterKey(id));
    return {
      doc: d,
      forest: Array.isArray(f) ? f : [],
      backlog: Array.isArray(b) ? migrateNodes(b) : [],
      litter: Array.isArray(l) ? l : [],
    };
  };

  /* ----- load ----- */
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get(VOCAB_KEY);
        const v = r?.value ? JSON.parse(r.value) : null;
        if (v && (Array.isArray(v.types) || Array.isArray(v.statuses))) setVocab(v);
      } catch (e) { /* keep the defaults */ }
      const { projects: idx, activeId: id } = await migrateLegacy(window.storage);
      setProjects(idx);
      setActiveId(id);
      const stores = await readStores(id);
      const title = idx.find((p) => p.id === id)?.title;
      setDoc(title ? { ...stores.doc, title } : stores.doc);
      setForest(stores.forest);
      setBacklog(stores.backlog);
      setLitter(stores.litter);
      prevBigDone.current = null;
      prevGraduable.current = null;
      lastSweepDay.current = null;
      loaded.current = true;
      setStructureRev((r) => r + 1);
      setSweepTick((x) => x + 1); // age check now that the saved doc is in place
      setFallTick((x) => x + 1); // and the day's leaf-fall
    })();
  }, []); // eslint-disable-line

  /* ----- save (debounced) -----
     All four persist to the active project's own keys; changing project carries
     the new stores and new id in together (batched), so nothing is written to
     the wrong project's key. */
  useEffect(() => {
    if (!loaded.current || !doc || !activeId) return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      try {
        await window.storage.set(docKey(activeId), JSON.stringify(doc));
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 1400);
      } catch (e) {
        setSaveState("error");
      }
    }, 600);
    return () => clearTimeout(t);
  }, [doc, activeId]);

  /* ----- persist the forest ----- */
  useEffect(() => {
    if (!loaded.current || !activeId) return;
    window.storage.set(forestKey(activeId), JSON.stringify(forest)).catch(() => {});
  }, [forest, activeId]);

  /* ----- persist the backlog ----- */
  useEffect(() => {
    if (!loaded.current || !activeId) return;
    window.storage.set(backlogKey(activeId), JSON.stringify(backlog)).catch(() => {});
  }, [backlog, activeId]);

  /* ----- persist the litter ----- */
  useEffect(() => {
    if (!loaded.current || !activeId) return;
    window.storage.set(litterKey(activeId), JSON.stringify(litter)).catch(() => {});
  }, [litter, activeId]);

  /* ----- age untouched leaves out of the Tree into the Backlog -----
     A leaf with no status that has sat in the Tree for a week moves to the
     Backlog together with a copy of its ancestors; a parent left childless by
     the move follows it. Runs on every doc change (so a cascade settles at
     once) and on a timer, so a long-open tab still ages tasks out. */
  useEffect(() => {
    if (!loaded.current || !doc) return;
    const now = Date.now();
    const { children, moved } = sweepBacklog(doc.children, now);
    if (!moved.length) return;
    const movedIds = new Set(moved.map((m) => m.node.id));
    setDoc((d) => ({ ...d, children }));
    setBacklog((b) => mergeIntoBacklog(b, moved, now));
    if (focusId && movedIds.has(focusId)) setFocusId(null);
    setSelectedId((s) => (s && movedIds.has(s) ? null : s));
    clearTimeout(backloggedTimer.current);
    setBacklogged({ count: moved.length, title: moved[moved.length - 1].node.title, key: now });
    backloggedTimer.current = setTimeout(() => setBacklogged(null), 6500);
    bumpStructure();
  }, [doc, sweepTick]); // eslint-disable-line

  useEffect(() => {
    const t = setInterval(() => {
      setSweepTick((x) => x + 1);
      // a tab left open past midnight should at least show the new fade state;
      // the fall itself waits for the next return to the tab
      setToday(dayIndex(Date.now()));
    }, 10 * 60 * 1000);
    return () => { clearInterval(t); clearTimeout(backloggedTimer.current); };
  }, []);

  /* ----- move a branch from the Backlog back into the Tree ----- */
  const returnFromBacklog = (id) => {
    const taken = takeFromBacklog(backlog, id, Date.now());
    if (!taken) return;
    commit();
    const { children: rest, node, ancestorIds, wasStub } = taken;
    setBacklog(rest);
    setDoc((d) => {
      // a stub is still in the Tree itself, so only its backlogged children return
      const grafts = wasStub ? node.children : [node];
      const under = wasStub ? [...ancestorIds, node.id] : ancestorIds;
      return {
        ...d,
        children: grafts.reduce((cs, g) => graftIntoTree(cs, under, g), d.children),
      };
    });
    setTab("tree");
    bumpStructure();
  };

  const deleteFromBacklog = (id) => {
    const taken = takeFromBacklog(backlog, id, Date.now());
    if (!taken) return;
    commit();
    setBacklog(taken.children);
  };

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

  /* ----- done tasks old enough to render faded (finished yesterday or earlier,
         so they're on their way off the tree) ----- */
  const fadedIds = useMemo(
    () => computeFadedIds(doc?.children ?? [], today),
    [doc, today]
  );

  /* ----- butterflies when a smallish branch becomes fully done -----
         Branches big enough to graduate get the Forest toast instead (and no
         longer have a node to fly over once they're lifted out), so the
         butterflies now belong to the finished branches that will quietly
         erode into litter — the wins that would otherwise pass unmarked. */
  useEffect(() => {
    if (!doc) return;
    const allDone = (n) => n.status === "done" && n.children.every(allDone);
    const big = [];
    const walk = (n) => {
      const size = countNodes(n.children);
      if (n.children.length && size >= BUTTERFLY_MIN_SUBNODES
          && size < CELEBRATE_MIN_SUBNODES && allDone(n)) big.push(n);
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
  }, [doc]); // eslint-disable-line

  useEffect(() => () => clearTimeout(celebrationTimer.current), []);

  /* ----- graduate a completed branch to the Forest -----
     When a branch and its whole subtree (>= CELEBRATE_MIN_SUBNODES tasks under
     it) become done, it's cleared from the Tree and planted as a tree in the
     Forest tab — at any depth, not only top level. When nested branches
     qualify in the same tick the outermost one wins, so one achievement isn't
     shredded into several trees; in ordinary use a nested branch finishes
     earlier than the parent containing it and graduates on its own.
     The bar is every task still on the branch — leaf or sub-branch: tasks
     already shed to litter don't count toward it.
     A brief toast lets an accidental completion be undone. */
  useEffect(() => {
    if (!doc) return;
    const allDone = (n) => n.status === "done" && n.children.every(allDone);
    const eligible = [];
    const walk = (nodes) => {
      for (const n of nodes) {
        if (n.children.length && countNodes(n.children) >= CELEBRATE_MIN_SUBNODES && allDone(n)) eligible.push(n);
        else walk(n.children); // don't look inside a branch that is graduating
      }
    };
    walk(doc.children);
    const prev = prevGraduable.current;
    prevGraduable.current = new Set(eligible.map((n) => n.id));
    if (!prev) return; // first doc after load — don't graduate pre-existing branches
    const fresh = eligible.filter((n) => !prev.has(n.id));
    if (!fresh.length) return;
    const freshIds = new Set(fresh.map((n) => n.id));
    const now = Date.now();
    const trees = fresh.map((n) => ({
      id: n.id, title: n.title, tree: n, md: toMarkdown([n]),
      shed: shedUnder(litter, n.id), completedAt: now,
    }));
    setForest((f) => [...trees, ...f]);
    // applyFall, not a plain filter: the branch may be nested, and a parent
    // left childless by its departure needs its week in view as a newly
    // actionable leaf rather than aging out on the clock it had as a branch
    setDoc((d) => ({ ...d, children: applyFall(d.children, freshIds, now) }));
    if (focusId && freshIds.has(focusId)) setFocusId(null);
    setSelectedId((s) => (s && freshIds.has(s) ? null : s));
    clearTimeout(plantedTimer.current);
    setPlanted({ trees, key: now, snapshot: doc.children });
    plantedTimer.current = setTimeout(() => setPlanted(null), 6500);
    bumpStructure();
  }, [doc]); // eslint-disable-line

  useEffect(() => () => clearTimeout(plantedTimer.current), []);

  const undoPlant = () => {
    if (!planted) return;
    const ids = new Set(planted.trees.map((t) => t.id));
    setForest((f) => f.filter((a) => !ids.has(a.id)));
    // restore the pre-graduation tree wholesale, so a nested branch goes back
    // exactly where it was rather than resurfacing as a top-level one
    setDoc((d) => ({ ...d, children: planted.snapshot }));
    // these branches are done again, so record them so they don't re-graduate
    prevGraduable.current = new Set([...(prevGraduable.current ?? []), ...ids]);
    setPlanted(null);
    clearTimeout(plantedTimer.current);
    bumpStructure();
  };

  /* ----- move a tree from the Forest back into the Tree ----- */
  const returnFromForest = (id) => {
    const achievement = forest.find((a) => a.id === id);
    if (!achievement) return;
    commit();
    setForest((f) => f.filter((a) => a.id !== id));
    setDoc((d) => ({ ...d, children: [...d.children, achievement.tree] }));
    // it's still fully done and big — record it so it isn't graduated straight back
    prevGraduable.current = new Set([...(prevGraduable.current ?? []), id]);
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

  /* Tweened copy of the layout for drawing: nodes glide and their links follow
     when the tree re-balances (e.g. after a re-parent). All interaction logic
     below stays on `layout` (final positions), so hit-testing, keyboard nav and
     fit-view target where things land, not where they are mid-flight. */
  const render = useLayoutTween(layout);

  /* ----- leaf-fall: done leaves let go and drop to the Forest floor -----
     Runs only when the app opens and when you come back on a new day, so
     nothing ever moves under the cursor mid-session. Two-phase on purpose:
     the leaves are held in flight with the coordinates they had at sweep time
     and the doc isn't touched until the last one lands, otherwise the tree
     would re-layout and the surviving pills would jump around underneath them. */
  useEffect(() => {
    if (!loaded.current || !doc || falling) return;
    const now = Date.now();
    const t = dayIndex(now);
    lastSweepDay.current = t;
    const fallen = collectFallen(doc.children, t);
    if (!fallen.length) return;
    const ids = new Set(fallen.map((f) => f.id));
    // where each leaf hangs right now; a leaf outside the focused subtree has
    // no position on screen, so it just leaves without the animation
    const byId = new Map(
      layout.nodes.filter((n) => n.d.depth > 0).map((n) => [n.d.data.id, n])
    );
    const placed = fallen
      .map((f) => ({ f, n: byId.get(f.id) }))
      .filter((p) => p.n)
      .sort((a, b) => b.n.d.depth - a.n.d.depth); // outer tips let go first
    const span = Math.min(1.0, placed.length * 0.06); // whole shower stays brief
    const leaves = placed.map((p, i) => ({
      id: p.f.id,
      x: p.n.x,
      y: p.n.y,
      delay: placed.length > 1 ? (i / (placed.length - 1)) * span : 0,
    }));
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const flight = reduced ? 520 : (span + 1.85) * 1000;
    const snapshot = { children: doc.children, litter };
    setFalling({ key: now, ids, leaves });
    clearTimeout(fallTimer.current);
    fallTimer.current = setTimeout(() => {
      const landed = Date.now();
      // patch the *current* doc rather than the one captured at sweep time, so
      // an edit made during the flight isn't thrown away
      setDoc((d) => ({ ...d, children: applyFall(d.children, ids, landed) }));
      setLitter((ls) => [...ls, ...fallen.map((f) => ({ ...f, fallenAt: landed }))]);
      if (focusId && ids.has(focusId)) setFocusId(null);
      setSelectedId((s) => (s && ids.has(s) ? null : s));
      setFalling(null);
      clearTimeout(fellTimer.current);
      setFell({ count: fallen.length, key: landed, snapshot });
      fellTimer.current = setTimeout(() => setFell(null), 7000);
      bumpStructure();
    }, flight);
  }, [fallTick]); // eslint-disable-line

  /* Coming back to the tab on a new day fades what aged overnight and drops
     what's ready; the same-day return does nothing. */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const t = dayIndex(Date.now());
      setToday(t);
      if (lastSweepDay.current !== null && t !== lastSweepDay.current) {
        setFallTick((x) => x + 1);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(fallTimer.current);
      clearTimeout(fellTimer.current);
    };
  }, []);

  const undoFall = () => {
    if (!fell) return;
    setDoc((d) => ({ ...d, children: fell.snapshot.children }));
    setLitter(fell.snapshot.litter);
    setFell(null);
    clearTimeout(fellTimer.current);
    bumpStructure();
  };

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
        const factor = Math.exp(-e.deltaY * ZOOM_SPEED);
        const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.k * factor));
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
    if (drag.current && !drag.current.moved) {
      setSelectedId(null);
      setCursorId(null);
      setLinkingId(null);
    }
    drag.current = null;
  };

  /* ----- Escape cancels an in-progress dependency link ----- */
  useEffect(() => {
    if (!linkingId) return;
    const onKey = (e) => { if (e.key === "Escape") setLinkingId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [linkingId]);

  /* ----- actions ----- */
  const bumpStructure = () => setStructureRev((r) => r + 1);

  /* keep a live mirror of the undoable stores so a snapshot taken at action
     time never captures a stale closure value */
  useEffect(() => {
    liveState.current = { doc, forest, backlog, litter };
  }, [doc, forest, backlog, litter]);

  const snapshot = () => ({ ...liveState.current });

  const restore = (snap) => {
    setDoc(snap.doc);
    setForest(snap.forest);
    setBacklog(snap.backlog);
    setLitter(snap.litter);
    // a restored store may no longer contain what the user had selected/focused
    setSelectedId(null);
    setCursorId(null);
    setLinkingId(null);
    setFocusId(null);
    setDragState(null);
    bumpStructure();
  };

  // Push the pre-action state onto the undo stack. Call before mutating.
  const commit = () => {
    past.current.push(snapshot());
    if (past.current.length > HISTORY_LIMIT) past.current.shift();
    future.current = [];
    editCoalesce.current = { id: null, at: 0 };
    setCanUndo(true);
    setCanRedo(false);
  };

  // Like commit(), but folds a run of edits to the same task into one step, so
  // typing a title isn't one undo per keystroke.
  const commitTextEdit = () => {
    const now = Date.now();
    const c = editCoalesce.current;
    if (c.id === selectedId && now - c.at < EDIT_COALESCE_MS) {
      c.at = now; // extend the run; the snapshot already on the stack stands
      return;
    }
    commit();
    editCoalesce.current = { id: selectedId, at: now };
  };

  const undo = () => {
    if (!past.current.length) return;
    future.current.push(snapshot());
    restore(past.current.pop());
    editCoalesce.current = { id: null, at: 0 };
    setCanUndo(past.current.length > 0);
    setCanRedo(true);
  };

  const redo = () => {
    if (!future.current.length) return;
    past.current.push(snapshot());
    restore(future.current.pop());
    editCoalesce.current = { id: null, at: 0 };
    setCanRedo(future.current.length > 0);
    setCanUndo(true);
  };

  /* cmd/ctrl+Z undo, cmd/ctrl+shift+Z or ctrl+Y redo. Ignored while a text
     field is focused, so the field's own caret-level undo keeps working; blur
     it and the shortcut drives the task-level history instead. undo/redo touch
     only refs and stable setters, so binding once is safe. */
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const t = e.target;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if (k === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line

  /* ----- projects ----- */

  // Write the active project's current stores to their keys now, without waiting
  // for the debounced save — used before leaving a project.
  const flushActive = () => {
    if (!activeId) return;
    const { doc: d, forest: f, backlog: b, litter: l } = liveState.current;
    if (d) window.storage.set(docKey(activeId), JSON.stringify(d)).catch(() => {});
    window.storage.set(forestKey(activeId), JSON.stringify(f)).catch(() => {});
    window.storage.set(backlogKey(activeId), JSON.stringify(b)).catch(() => {});
    window.storage.set(litterKey(activeId), JSON.stringify(l)).catch(() => {});
  };

  // Everything scoped to a single tree is reset when a new project takes over:
  // undo history, the graduation/celebration/leaf-fall bookkeeping, transient
  // selection, the sync handle, and any pending toasts.
  const resetForProject = () => {
    past.current = [];
    future.current = [];
    setCanUndo(false);
    setCanRedo(false);
    editCoalesce.current = { id: null, at: 0 };
    prevBigDone.current = null;
    prevGraduable.current = null;
    lastSweepDay.current = null;
    setSelectedId(null);
    setCursorId(null);
    setFocusId(null);
    setLinkingId(null);
    setDragState(null);
    setConfirmDelete(false);
    syncHandle.current = null;
    setSyncFileName(null);
    setSyncState("idle");
    setPlanted(null);
    setBacklogged(null);
    setFell(null);
    setFalling(null);
    loaded.current = true;
    bumpStructure();
    setSweepTick((x) => x + 1);
    setFallTick((x) => x + 1);
  };

  const applyStores = (stores, title) => {
    setDoc(title ? { ...stores.doc, title } : stores.doc);
    setForest(stores.forest);
    setBacklog(stores.backlog);
    setLitter(stores.litter);
    resetForProject();
  };

  const switchProject = async (id) => {
    if (!id || id === activeId) return;
    flushActive();
    // read first, then set the id + stores together so a single batched render
    // never persists the outgoing project's data under the incoming keys
    const stores = await readStores(id);
    setActiveId(id);
    window.storage.set(ACTIVE_KEY, id).catch(() => {});
    applyStores(stores, projects.find((p) => p.id === id)?.title);
  };

  const createProject = () => {
    flushActive();
    const id = newProjectId();
    const title = "New project";
    const next = [...projects, { id, title }];
    setProjects(next);
    window.storage.set(INDEX_KEY, JSON.stringify(next)).catch(() => {});
    setActiveId(id);
    window.storage.set(ACTIVE_KEY, id).catch(() => {});
    setDoc({ title, children: [] });
    setForest([]);
    setBacklog([]);
    setLitter([]);
    resetForProject();
    return id;
  };

  const renameProject = (id, title) => {
    const clean = title.trim() || "Untitled";
    const next = projects.map((p) => (p.id === id ? { ...p, title: clean } : p));
    setProjects(next);
    window.storage.set(INDEX_KEY, JSON.stringify(next)).catch(() => {});
    if (id === activeId) setDoc((d) => (d ? { ...d, title: clean } : d));
  };

  const deleteProject = async (id) => {
    const at = projects.findIndex((p) => p.id === id);
    if (at < 0) return;
    const meta = projects[at];
    // snapshot the project's four stores for undo: from memory when it's the
    // active one (may hold unsaved edits), from storage otherwise
    let raws;
    if (id === activeId) {
      const { doc: d, forest: f, backlog: b, litter: l } = liveState.current;
      raws = {
        doc: d ? JSON.stringify(d) : null,
        forest: JSON.stringify(f),
        backlog: JSON.stringify(b),
        litter: JSON.stringify(l),
      };
    } else {
      const rawOf = (key) => getRaw(window.storage, key);
      raws = {
        doc: await rawOf(docKey(id)),
        forest: await rawOf(forestKey(id)),
        backlog: await rawOf(backlogKey(id)),
        litter: await rawOf(litterKey(id)),
      };
    }
    [docKey, forestKey, backlogKey, litterKey].forEach((k) =>
      window.storage.delete(k(id)).catch(() => {})
    );

    let remaining = projects.filter((p) => p.id !== id);
    let nextActive = activeId;
    if (id === activeId) {
      if (remaining.length) {
        nextActive = remaining[Math.max(0, at - 1)].id;
      } else {
        // never leave the app with zero projects — seed a fresh empty one
        const seedId = newProjectId();
        window.storage
          .set(docKey(seedId), JSON.stringify({ title: "My tasks", children: [] }))
          .catch(() => {});
        remaining = [{ id: seedId, title: "My tasks" }];
        nextActive = seedId;
      }
    }
    setProjects(remaining);
    window.storage.set(INDEX_KEY, JSON.stringify(remaining)).catch(() => {});

    if (nextActive !== activeId) {
      const stores = await readStores(nextActive);
      setActiveId(nextActive);
      window.storage.set(ACTIVE_KEY, nextActive).catch(() => {});
      applyStores(stores, remaining.find((p) => p.id === nextActive)?.title);
    }

    clearTimeout(deletedTimer.current);
    setDeletedProject({ meta, raws, at, key: Date.now() });
    deletedTimer.current = setTimeout(() => setDeletedProject(null), 7000);
  };

  const undoDeleteProject = async () => {
    if (!deletedProject) return;
    const { meta, raws, at } = deletedProject;
    clearTimeout(deletedTimer.current);
    setDeletedProject(null);
    const put = (key, val) => { if (val != null) window.storage.set(key, val).catch(() => {}); };
    put(docKey(meta.id), raws.doc);
    put(forestKey(meta.id), raws.forest);
    put(backlogKey(meta.id), raws.backlog);
    put(litterKey(meta.id), raws.litter);
    const next = projects.some((p) => p.id === meta.id)
      ? projects
      : (() => { const c = [...projects]; c.splice(Math.min(at, c.length), 0, meta); return c; })();
    setProjects(next);
    window.storage.set(INDEX_KEY, JSON.stringify(next)).catch(() => {});
    flushActive();
    const stores = await readStores(meta.id);
    setActiveId(meta.id);
    window.storage.set(ACTIVE_KEY, meta.id).catch(() => {});
    applyStores(stores, meta.title);
  };

  useEffect(() => () => clearTimeout(deletedTimer.current), []);

  const handleAddChild = (parentId) => {
    const child = newNode();
    commit();
    setDoc((d) =>
      parentId === "__root"
        ? { ...d, children: [...d.children, child] }
        : { ...d, children: addChild(d.children, parentId, child) }
    );
    setSelectedId(child.id);
    setCursorId(child.id);
    setConfirmDelete(false);
    // no bumpStructure(): adding a sub-task must not re-fit the view
    setTimeout(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }, 60);
  };

  const handleDelete = (id) => {
    commit();
    if (id === focusId) setFocusId(null);
    if (id === linkingId) setLinkingId(null);
    setDoc((d) => ({ ...d, children: pruneDeps(removeNode(d.children, id)) }));
    setSelectedId(null);
    setConfirmDelete(false);
    bumpStructure();
  };

  /* ----- keyboard navigation -----
     Arrows walk the visible tree by tree-relationship (right = into first
     child, left = up to parent, up/down = siblings). A lightweight cursor ring
     tracks the current node without opening the panel; Enter opens it (and
     toggles it shut), Tab adds a sub-task under it, Esc backs out. The panel
     follows the cursor while it's open, so arrowing browses details. Keys are
     inert while a text field is focused and while a dependency link is being
     drawn, and modifier chords (undo/redo) are left to their own handler. */
  useEffect(() => {
    if (tab !== "tree") return;
    const byId = new Map(
      layout.nodes.filter((n) => n.d.depth > 0).map((n) => [n.d.data.id, n.d])
    );
    // finished work receding off the tree — done leaves and every node inside a
    // fully-done branch (rendered as twigs) — isn't a navigation target; the
    // cursor skips over it to the next live node
    const skip = (d) =>
      doneBranchIds.has(d.data.id) ||
      (d.data.status === "done" && (!d.data.children || d.data.children.length === 0));
    const firstTopId = () => {
      let best = null;
      for (const n of layout.nodes) {
        if (n.d.depth === 0 || skip(n.d)) continue;
        if (!best || n.d.depth < best.d.depth || (n.d.depth === best.d.depth && n.y < best.y)) best = n;
      }
      return best?.d.data.id ?? null;
    };
    const move = (dir) => {
      const cur = cursorId ? byId.get(cursorId) : null;
      let next = null;
      if (!cur) next = firstTopId();
      else if (dir === "right") next = cur.children?.find((c) => !skip(c))?.data.id ?? null;
      else if (dir === "left") next = cur.parent && cur.parent.depth > 0 ? cur.parent.data.id : null;
      else {
        // walk the whole same-depth column by vertical position, so up/down
        // crosses from one parent's children into the next parent's, skipping
        // any finished (done leaf / done branch) nodes along the way
        const col = layout.nodes
          .filter((n) => n.d.depth === cur.depth)
          .sort((a, b) => a.y - b.y);
        const i = col.findIndex((n) => n.d.data.id === cursorId);
        const step = dir === "down" ? 1 : -1;
        for (let k = i + step; k >= 0 && k < col.length; k += step) {
          if (!skip(col[k].d)) { next = col[k].d.data.id; break; }
        }
      }
      if (!next) return;
      setCursorId(next);
      setConfirmDelete(false);
      setSelectedId((s) => (s ? next : s)); // panel, if open, follows the cursor
    };
    const onKey = (e) => {
      const t = e.target, tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
          || tag === "BUTTON" || tag === "A" || t?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (linkingId) return;
      switch (e.key) {
        case "ArrowRight": e.preventDefault(); move("right"); break;
        case "ArrowLeft": e.preventDefault(); move("left"); break;
        case "ArrowUp": e.preventDefault(); move("up"); break;
        case "ArrowDown": e.preventDefault(); move("down"); break;
        case "Enter": {
          e.preventDefault();
          const id = cursorId ?? firstTopId();
          if (!id) break;
          if (!cursorId) setCursorId(id);
          setSelectedId((s) => (s === id ? null : id));
          setConfirmDelete(false);
          break;
        }
        case "Tab":
          e.preventDefault();
          handleAddChild(cursorId ?? focusId ?? "__root");
          break;
        case "Escape":
          if (selectedId) setSelectedId(null);
          else setCursorId(null);
          break;
        default: break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, cursorId, selectedId, focusId, linkingId, layout, doneBranchIds]); // eslint-disable-line

  /* ----- keep the cursor on screen: pan just enough when it lands outside ----- */
  useEffect(() => {
    if (!cursorId) return;
    const n = layout.nodes.find((m) => m.d.depth > 0 && m.d.data.id === cursorId);
    if (!n) return;
    setView((v) => {
      const m = 90;
      const sx = n.x * v.k + v.x, sy = n.y * v.k + v.y;
      let nx = v.x, ny = v.y;
      if (sx < m) nx += m - sx; else if (sx > size.w - m) nx -= sx - (size.w - m);
      if (sy < m) ny += m - sy; else if (sy > size.h - m) ny -= sy - (size.h - m);
      return nx === v.x && ny === v.y ? v : clampView({ ...v, x: nx, y: ny });
    });
  }, [cursorId, layout, size, clampView]);

  /* ----- blocked-by dependency links ----- */
  const startLinking = (id) => setLinkingId((cur) => (cur === id ? null : id));

  // While linking, the next node clicked becomes the selected task's blocker.
  const handleLink = (blockerId) => {
    const dependent = linkingId;
    setLinkingId(null);
    if (!dependent || dependent === blockerId) return;
    commit();
    setDoc((d) => ({ ...d, children: addDep(d.children, dependent, blockerId) }));
  };

  const handleRemoveDep = (id, blockerId) => {
    commit();
    setDoc((d) => ({ ...d, children: removeDep(d.children, id, blockerId) }));
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
    if (nodeId === realTarget || !findNode(doc.children, nodeId)) return;
    commit();
    setDoc((d) => {
      const rest = removeNode(d.children, nodeId);
      const subtree = findNode(d.children, nodeId);
      const children =
        realTarget === "__root" ? [...rest, subtree] : addChild(rest, realTarget, subtree);
      return { ...d, children };
    });
    bumpStructure();
  };

  const handleImport = (mode) => {
    const roots = parseMarkdown(importText);
    if (!roots.length) return;
    commit();
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

  /* ----- customize the type/status vocabulary (app-wide, outside undo) ----- */
  const saveVocab = ({ types, statuses }) => {
    setVocab({ types, statuses });
    window.storage.set(VOCAB_KEY, JSON.stringify({ types, statuses })).catch(() => {});
    setVocabRev((r) => r + 1); // force the tree, panel and legend to re-read
    setModal(null);
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
  const backlogCount = countBacklogged(backlog);

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
            <button
              className={`tt-tab ${tab === "backlog" ? "on" : ""}`}
              onClick={() => setTab("backlog")}
              title="Tasks that sat untouched in the Tree for a week"
            >
              🗂️ Backlog{backlogCount ? ` (${backlogCount})` : ""}
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
              <button
                className="tt-btn ghost"
                onClick={undo}
                disabled={!canUndo}
                title="Undo (⌘Z)"
              >↶ Undo</button>
              <button
                className="tt-btn ghost"
                onClick={redo}
                disabled={!canRedo}
                title="Redo (⇧⌘Z)"
              >↷ Redo</button>
              <button className="tt-btn ghost" onClick={fitView} title="Fit tree to screen">Fit</button>
              <button className="tt-btn ghost" onClick={() => { setModal("export"); setCopied(false); setSyncState("idle"); }}>Export</button>
              <button className="tt-btn solid" onClick={() => { setImportTarget(null); setImportText(""); setModal("import"); }}>Import .md</button>
            </>
          )}
        </div>
      </header>

      {/* main: projects sidebar + canvas */}
      <div className="tt-main">
      <ProjectsPanel
        projects={projects}
        activeId={activeId}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((c) => !c)}
        onSwitch={switchProject}
        onCreate={createProject}
        onRename={renameProject}
        onDelete={deleteProject}
      />
      {/* canvas */}
      <div className="tt-canvas" ref={containerRef}>
        {tab === "forest" && (
          <Forest achievements={forest} litter={litter} onReturn={returnFromForest} />
        )}
        {tab === "backlog" && (
          <Backlog
            nodes={backlog}
            size={size}
            onReturn={returnFromBacklog}
            onDelete={deleteFromBacklog}
          />
        )}
        {tab === "tree" && (
        <>
        <div
          className={`tt-svgwrap ${linkingId ? "linking" : ""}`}
          ref={svgWrapRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <svg width={size.w} height={size.h}>
            <defs>
              <marker
                id="tt-dep-arrow"
                viewBox="0 0 10 10"
                refX="8.5"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                markerUnits="userSpaceOnUse"
                orient="auto"
              >
                <path d="M0,0 L10,5 L0,10 z" className="tt-dep-head" />
              </marker>
            </defs>
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {render.deps.map((dp) => (
                falling?.ids.has(dp.from) || falling?.ids.has(dp.to) ? null : (
                  <path key={dp.id} d={dp.path} className="tt-dep" markerEnd="url(#tt-dep-arrow)" />
                )
              ))}
              {render.links.map((l) => (
                falling?.ids.has(l.id) ? null : (
                  <path
                    key={l.id}
                    d={l.path}
                    className={`tt-link ${doneBranchIds.has(l.id) ? "done" : ""} ${fadedIds.has(l.id) ? "faded" : ""} ${l.inprogress ? "active" : ""} ${l.next ? "next" : ""}`}
                  />
                )
              ))}
              {render.nodes.map((n) => {
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
                // in flight: drawn by FallingLeaves instead, and the tree
                // deliberately keeps its old layout until they land
                if (falling?.ids.has(data.id)) return null;
                const isSel = data.id === selectedId;
                const isCursor = data.id === cursorId;
                const isDone = data.status === "done";
                const isLeaf = !data.children || data.children.length === 0;
                const shared = {
                  node: data,
                  x: n.x,
                  y: n.y,
                  faded: fadedIds.has(data.id),
                  isCursor,
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
                      if (linkingId) { handleLink(data.id); return; }
                      setSelectedId(data.id);
                      setCursorId(data.id);
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
              {falling && (
                <FallingLeaves
                  key={falling.key}
                  leaves={falling.leaves}
                  fallDist={(size.h + 240) / view.k}
                />
              )}
              {celebration && (() => {
                const n = render.nodes.find((m) => m.d.depth > 0 && m.d.data.id === celebration.id);
                return n ? (
                  <Butterflies key={celebration.key} flock={celebration.flock} x={n.x} y={n.y} />
                ) : null;
              })()}
            </g>
          </svg>
        </div>

        {/* linking-mode hint */}
        {linkingId && (
          <div className="tt-linking-hint">
            <span>⛓ Click the task that blocks “{labelOf(findNode(doc.children, linkingId)?.title || "this task")}”</span>
            <button className="tt-linkbtn" onClick={() => setLinkingId(null)}>Cancel (Esc)</button>
          </div>
        )}

        {/* legend */}
        <div className="tt-legend">
          <div className="tt-leg-head">
            <span className="tt-leg-label">Type</span>
            <button
              className="tt-leg-edit"
              onClick={() => setModal("vocab")}
              title="Customize types & statuses"
              aria-label="Customize types"
            >✎</button>
          </div>
          {TYPES.map((t) => (
            <span key={t.key} title={t.label}>
              {t.emoji}<i>{t.label}</i>
            </span>
          ))}
          <div className="tt-leg-head sep">
            <span className="tt-leg-label">Status</span>
            <button
              className="tt-leg-edit"
              onClick={() => setModal("vocab")}
              title="Customize types & statuses"
              aria-label="Customize statuses"
            >✎</button>
          </div>
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

        {/* fallen-leaves toast, with undo — litter has no per-item UI, so this
            is the only way back for a leaf that shouldn't have dropped */}
        {fell && !planted && (
          <div className="tt-toast" key={fell.key}>
            <span className="tt-toast-icon">🍂</span>
            <span className="tt-toast-text">
              {fell.count === 1
                ? <>A finished leaf let go — it’s on the forest floor now.</>
                : <>{fell.count} finished leaves let go — they’re on the forest floor now.</>}
            </span>
            <button className="tt-toast-undo" onClick={undoFall}>Undo</button>
            {tab === "tree" && (
              <button className="tt-toast-go" onClick={() => setTab("forest")}>View</button>
            )}
          </div>
        )}

        {/* aged-out-to-backlog toast */}
        {backlogged && !planted && !fell && (
          <div className="tt-toast" key={backlogged.key}>
            <span className="tt-toast-icon">🗂️</span>
            <span className="tt-toast-text">
              {backlogged.count === 1
                ? <>“{labelOf(backlogged.title || "Untitled task")}” sat untouched for a week — moved to your Backlog.</>
                : <>{backlogged.count} untouched tasks sat for a week — moved to your Backlog.</>}
            </span>
            {tab !== "backlog" && (
              <button className="tt-toast-go" onClick={() => setTab("backlog")}>View</button>
            )}
          </div>
        )}

        {/* deleted-project toast, with undo */}
        {deletedProject && (
          <div className="tt-toast" key={deletedProject.key}>
            <span className="tt-toast-icon">🗑️</span>
            <span className="tt-toast-text">
              Project “{labelOf(deletedProject.meta.title || "Untitled")}” deleted.
            </span>
            <button className="tt-toast-undo" onClick={undoDeleteProject}>Undo</button>
          </div>
        )}
      </div>
      </div>

      {/* detail panel */}
      <Panel
        selected={tab === "tree" ? selected : null}
        titleInputRef={titleInputRef}
        confirmDelete={confirmDelete}
        setConfirmDelete={setConfirmDelete}
        onPatch={(patch) => {
          let p = patch;
          // Fill in a type from the title's keywords, but only when none is set
          // yet — never override a type the user (or a prior guess) already chose.
          if ("title" in patch && !selected.type && !("type" in patch)) {
            const predicted = predictType(patch.title);
            if (predicted) p = { ...patch, type: predicted };
          }
          const textOnly = Object.keys(p).every((k) => k === "title" || k === "desc");
          if (textOnly) commitTextEdit(); else commit();
          setDoc((d) => {
            let children = updateNode(d.children, selectedId, stampDone(p));
            if (p.status === "done") children = dropDepsFor(children, selectedId);
            return { ...d, children };
          });
        }}
        onAddChild={() => handleAddChild(selected.id)}
        onImportChild={() => { setImportTarget(selected.id); setImportText(""); setModal("import"); }}
        onDelete={() => handleDelete(selected.id)}
        onClose={() => setSelectedId(null)}
        blockers={selected ? (selected.blockedBy || []).map((id) => findNode(doc.children, id)).filter(Boolean) : []}
        linking={selected && selected.id === linkingId}
        onStartLink={() => selected && startLinking(selected.id)}
        onRemoveDep={(blockerId) => selected && handleRemoveDep(selected.id, blockerId)}
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
      {modal === "vocab" && (
        <VocabModal onSave={saveVocab} onClose={() => setModal(null)} />
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
