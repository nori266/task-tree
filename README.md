# Task Tree

A calm, spatial task manager designed around how ADHD brains actually work. Instead of a scrolling list, your tasks are drawn as a **literal tree**: a graph that is automatically laid out to fill the screen evenly, so the whole plan exists outside your head in a single glance.

The core loop it supports: dive into a branch, break a task into sub-tasks as complexity reveals itself, finish the leaves, and surface back out to the other open branches. Design choices follow from ADHD-specific needs rather than generic productivity:

- **Externalized working memory** — the full structure is always visible spatially; nothing lives only in your head ("out of sight, out of mind" is the failure mode being prevented).
- **Reduced overwhelm** — a visually calm interface (muted sage palette, minimal chrome, gentle motion); *leaf* nodes (the actually actionable items) render brighter than the muted structural branch nodes, so the actionable edge of the tree pops forward.
- **Low-friction structure changes** — tasks are reorganized by direct manipulation (drag a node onto a new parent), not by ceremony.
- **Forgiving by design** — no deadlines, no overdue red badges, no guilt mechanics. Done branches fade and recede instead of demanding attention.
- **Nothing done is ever silently deleted** — finished work leaves the Tree, but it always lands somewhere visible. Evidence of progress is load-bearing: a day that cleaned itself up must not read as a day where nothing happened.

## Main functionality

**Markdown import / export.** Tasks round-trip as a nested bullet list (`-`, `*`, or `+`; indentation = depth). Conventions:
- A **type** emoji at the *start* of an item: `☎️` (call), `👩🏻‍💻` (coding), etc.
- A **status** emoji at the *end* of an item: `💻` in progress, `⏳` waiting to start, `🧱` blocked, `⏭️` will do next, `✅` done, `❓` needs external input. No emoji at the end → **no status** (deliberate default). `- [x]` also counts as done. The parser guards against reading the `💻` inside `👩🏻‍💻` (ZWJ sequence) as a status.
- Lines starting with `>` become the description of the item above.
- Import can **replace** the tree or **append** to it; export writes the same format back.

**Sync to a file (two-way).** Beyond one-shot export, the tree can be bound to a markdown file on disk. The first sync opens a file picker (File System Access API); the chosen handle is **persisted in IndexedDB per project**, so it survives a reload (re-authorized with a permission prompt on the next read/write). **⌘S / Ctrl+S** writes the tree to that file from anywhere in the app, with a "synced" indicator and a toast naming the file. The bridge file is written with a trailing `^<id>` marker on each bullet and a `⛓ blocked-by: ^<id>` line for dependencies, so it round-trips **losslessly** (stable ids + cross-tree links); the human "Copy" export stays clean and id-free. Browsers without the File System Access API fall back to a plain download.

The reverse direction lets **external tools (Claude Code, Cursor, or a hand edit) modify the tree**: edit the linked file and the app pulls the change back in on window focus (a toast offers **Reload**, also a button in the Export modal). Import is a **merge by id** — the file is authoritative for structure, status, and links, but the leaf-fall / graduation clocks (`createdAt` / `doneAt`) are carried over from the node with the same id, so a round-trip never resets them; a bullet with no id becomes a new task. A `task-tree` CLI (`bin/task-tree.js`, over `treeStore.js`) drives the file safely from a terminal — see `AGENTS.md`.

**Projects.** Several independent projects can coexist, each a self-contained workspace with its own Tree, Forest, Backlog, and litter. A left sidebar (collapsed by default) switches between them and creates, renames, or deletes them; deletion is undoable via a toast. The active project's stores auto-save under per-project storage keys.

**Blocked-by links.** Any task can be marked as blocked by any other, drawn as a dashed, arrowed curve that leaves and enters pills on their nearest vertical edge. Start a link from the panel, then click the blocking task (an ⛓ hint banner guides the pick). A link is removed automatically when either of its two tasks is marked done, since a link to or from finished work no longer blocks anything.

**Linearize (work stack).** A **☰ Linearize** button (left of **Fit** in the Tree toolbar) flattens the live, actionable part of the tree into a single ordered stack — the answer to "what do I actually do next?" without the spatial layout. The stack holds every task whose status is 💻 in progress, ⏭️ will do next, or ⏳ waiting to start, together with all of their descendants (finished ✅ nodes dropped), read top to bottom. The order is a linear extension of two hard rules and one preference:

- **A child sits above its parent** — you finish the pieces before the branch that contains them.
- **A blocker sits above the task it blocks** (from the blocked-by links above).
- Otherwise the 💻 in-progress group floats to the top, then ⏭️ will do next, then ⏳ waiting to start; remaining ties fall back to tree order.

The grouping is only the tie-break, so the two hard rules win when they conflict with it: a ⏳ waiting task that blocks a 💻 in-progress one is still pulled above it. A task reached as the descendant of a higher-priority group isn't listed again lower down. Picking any card returns to the Tree with that task selected and centered. Ordering lives in `linearize.js` (a priority topological sort — Kahn's algorithm draining the best-priority ready node first; a blocker cycle can't drop nodes, leftovers are appended), the view in `Linearize.jsx`.

**Three ways a task leaves the Tree.** The Tree only holds live work; everything finished or abandoned exits by one of three routes, so it never silts up.

- **Forest (graduation).** Any fully-done branch with ≥10 subnodes — at *any* depth, not just top level — is lifted out of the Tree and planted in the Forest tab as a tree grown from its own shape. When nested branches qualify in the same tick the outermost wins, so one achievement isn't shredded into several. In ordinary use a nested milestone finishes before the project containing it and graduates on its own, so a long project shows up as a cluster of milestone trees rather than one grand one. Leaves the branch already shed count toward the ≥10, so slow work can't erode below the bar for its own tree.
- **Leaf-fall (litter).** A done leaf stays bright for a week after it's finished, fades once it's a week old, and a week after that it lets go: it detaches, sways down out of the view, and comes to rest on the Forest floor as litter. Ages count in local calendar days, so a "week" means seven calendar days however late you worked. Falling happens only on app open and on the first return on a new day — never under your cursor mid-session.

  *Timeline of a done leaf* (calendar days since you marked it done, `dayAge`; thresholds `FADE_DAY = 7`, `FALL_DAY = 14` in `leaffall.js`):

  | Day | Age | State | What the user sees |
  | --- | --- | --- | --- |
  | Days 0–6 | `0`–`6` | fresh | Marked done; `doneAt` stamped by `stampDone`. Bright, with strikethrough, still on the Tree. |
  | Days 7–13 | `7`–`13` | faded (`fadedIds`) | Dims to recede; stays in place on the Tree, still counted in `done/total`. |
  | Day 14+ | `≥ 14` | falls (`collectFallen`) | On the **next sweep** (app open / first return on a new day) it detaches, sways down over ~2s, and lands as litter on the Forest floor. Removed from the Tree by `applyFall`. |

  Only leaves that are *already childless* fall; a parent emptied by the same sweep is left for the next sweep, so a finished branch erodes tip-inward over successive weeks rather than vanishing at once. Age is measured off `doneAt`, so reopening a task (which nulls `doneAt`) resets the clock, and a leaf that sits several days past `FALL_DAY` before the app is next opened still just falls on that first sweep. **A parent is never completed on your behalf** — its title is a task in its own right, and finishing everything under it says nothing about that, so nothing fades or falls until you mark it done yourself. An emptied statusless parent simply becomes an ordinary actionable leaf, with its `createdAt` reset so it gets a full week in view before the Backlog's staleness sweep can reach it. Litter banks at the foot of its branch's tree once that branch graduates, and otherwise drifts in a band along the bottom of the Forest tab with a running count. An undo toast is the only way back, since litter has no per-item UI.
- **Backlog (staleness).** Statusless leaves that sat untouched for a week move to the Backlog with a copy of their ancestor path. Disjoint from leaf-fall by status: anything marked done goes to the litter, never here.

Butterflies now mark the finished branches *below* the graduation threshold (4–9 subnodes) — the wins that erode quietly and would otherwise pass unmarked; bigger ones get the Forest toast instead.

**Auto-balanced tree visualization.** d3 tidy-tree layout sized to the container's aspect ratio, so the tree spreads to use screen space evenly, laid out horizontally (root left) with organic jitter so branches don't read as a rigid grid. Auto-fit on load, import, and structure changes; manual pan (drag), zoom (wheel/pinch), and a Fit button. Animated layout transitions tween node positions so re-parenting glides instead of snapping. **Node rectangles never overlap:** a final separation pass spreads the depth columns apart to fit the widest pill in each and packs each column vertically, pushing pills apart only where the fixed pitch or the jitter would otherwise let two touch.

**Node editing.** Click a node → side panel (bottom sheet on mobile) to edit title and description, set type, set status, add a sub-task, mark it blocked by another task, or delete the subtree (two-step confirm). A type is auto-predicted from the title's keywords when none is set yet, and never overrides one already chosen. The 🌳 root hub adds top-level tasks.

**Customizable vocabulary.** The type and status sets aren't fixed: a ✎ icon on each legend heading opens an app-wide editor to change an entry's emoji, label, and colour, or add and remove entries. Saved under `tasktree:vocab`, outside the undo history.

**Keyboard navigation.** Move around the tree without touching the mouse. A dashed **cursor ring** marks the current node and moves by tree relationship; opening it is a separate, deliberate step, so scanning the tree stays calm and no panel flashes open as you move.

| Key | Action |
| --- | --- |
| `→` | into the first child (deeper) |
| `←` | up to the parent (shallower) |
| `↑` / `↓` | previous / next node in the same-depth column (crosses from one parent's children into the next) |
| `Enter` | open the cursor node's panel (same as clicking it); press again to close and return to the tree |
| `Tab` | add a sub-task under the cursor, with the caret already in its title editor — type and press `Enter` to finalize |
| `Esc` | close the panel, then clear the cursor |

The panel *follows* the cursor while it's open, so arrowing browses details node by node. Navigation targets only **live** work: finished nodes receding off the Tree — done leaves and every node inside a fully-done branch (the twigs) — are skipped in every direction, so the cursor jumps straight to the next unfinished node. A done-status parent that still has live sub-tasks stays navigable, so you can reach its unfinished children. Keys are inert while a text field, button, or link is focused (so typing a title and the `⌘Z` shortcuts keep working), and while a dependency link is being drawn. The view pans just enough to keep the cursor on screen when it moves out of view. The first arrow with no cursor set lands on the top-most live root task.

**Drag-to-reparent.** Press-drag a node to lift it into a ghost; valid drop targets highlight with a dashed ring (a node can't be dropped on itself or its descendants). Dropping moves the node **with its whole subtree**; dropping on the 🌳 hub makes it top-level; releasing over empty space cancels. A plain click still just selects. Reparenting appends as the target's last child (no sibling ordering yet) and does not open the panel.

**Undo / redo.** `⌘Z` / `Ctrl+Z` reverses the last action, `⇧⌘Z` / `Ctrl+Y` reapplies it; both also sit in the top bar. History holds the **last 100 actions** (`HISTORY_LIMIT`), so up to 100 consecutive edits can be undone before the oldest step drops off. Each step snapshots all four stores (Tree, Forest, Backlog, litter) together, so a multi-store action reverses atomically. Consecutive text edits to one task fold into a single step; the time-driven lifecycle events (graduation, leaf-fall, backlog aging) keep their own undo toasts instead. History is in-memory only and clears on reload. While a text field is focused the shortcut yields to the browser's native caret-level undo.

**Visual language.** Pills show `[type emoji] title [status emoji]` with a thin status-colored bar (only when a status is set); done tasks fade with strikethrough; a small dot marks nodes that have a description; a legend explains both emoji groups. Progress counter (`done/total`) in the top bar.

**Persistence.** Each project's four stores auto-save (debounced) as JSON to `window.storage` under per-project keys, with a save indicator. On load, docs from older schema versions are migrated (`status: "call"` → `type: "call"`, missing `type` field added), and a pre-projects single-tree document is migrated into the first project.

## Tech notes for continuing work

- **Stack:** single-file React component (`task-tree.jsx`), d3 (only `d3.hierarchy` / `d3.tree`) for layout, hand-rolled SVG rendering, pan/zoom, and pointer-based drag. All CSS lives in a template string in the same file.
- **Data model:** `doc = { title, children: Node[] }`; `Node = { id, title, desc, status: key|null, type: key|null, important, createdAt, doneAt: number|null, children: Node[] }`. `doneAt` drives the fade/fall clock and is stamped by `stampDone` in the single place status is written (the side panel's `onPatch`); `migrateNodes` back-fills it as *now* for pre-existing done tasks, so the first open after an update doesn't shower away the whole history. Vocabulary in `STATUSES` / `TYPES` constants; tree edits go through immutable helpers (`updateNode`, `addChild`, `removeNode`, `findNode`, `migrateNodes`).
- **Leaf-fall (`leaffall.js`):** `dayIndex` builds a day number from the *local* Y/M/D (not a timestamp division) so a DST shift can't collapse two midnights onto one index. `collectFallen` picks victims, `applyFall` removes an id set and re-dates any parent it empties — reused for graduation removal, since both are "this subtree left the Tree". Neither ever writes a status: only the user marks a task done. The sweep is two-phase: victims are held in flight with the coordinates they had at sweep time and the doc is only patched when the last leaf lands, or the tree would re-layout and the surviving pills would jump underneath them. The commit patches the *current* doc, so an edit made during the ~2s flight isn't lost.
- **Storage keys:** a project index (`tasktree:projects`), the active project id (`tasktree:activeProject`), the shared vocabulary (`tasktree:vocab`), and four per-project stores keyed by project id (doc / forest / backlog / litter) — see `projects.js` for the key helpers and the legacy-migration path.
- **Rendering pipeline:** `layout` useMemo builds a synthetic root (`id: "__root"`) → d3 tree → `{nodes, links}` in world coordinates → one `<g transform>` applies the view `{x, y, k}`. `fitView` computes the bounding box (using per-node `pillW`) and recenters; `structureRev` bumps trigger refit.
- **Environment:** built as a claude.ai artifact — `window.storage` is the artifact key-value API. To run locally (Vite + React), shim `window.storage` onto `localStorage` before mounting (see repo setup notes / main.jsx). No backend, no localStorage direct usage in the component itself.
- **Interaction subtleties worth preserving:** node pointer-down uses `setPointerCapture`; a 7px movement threshold distinguishes drag from click; `suppressClick` prevents the post-drag click from selecting; wheel zoom is attached natively with `{ passive: false }`.

## Roadmap (agreed direction, not yet implemented)

Prioritized for ADHD benefit:
1. **Focus mode / branch zoom** — double-click makes a node the temporary root; its subtree fills the screen, breadcrumb to climb back (targets overwhelm; highest expected impact).
2. **"Next up" spotlight** — dim everything except ⏭️/💻 nodes (or the shallowest unblocked leaf) to answer "what do I do now?" (targets task initiation).
3. **Completion feedback** — fold-closed animation on done, progress rings on parents, offer to complete a parent when all children are done (immediate reward).
4. **Collapse/expand branches** with hidden-count badges; **sibling reordering** during drag (drop into gaps between pills).
