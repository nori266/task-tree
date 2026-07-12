# Task Tree

A calm, spatial task manager designed around how ADHD brains actually work. Instead of a scrolling list, your tasks are drawn as a **literal tree**: a graph that is automatically laid out to fill the screen evenly, so the whole plan exists outside your head in a single glance.

The core loop it supports: dive into a branch, break a task into sub-tasks as complexity reveals itself, finish the leaves, and surface back out to the other open branches. Design choices follow from ADHD-specific needs rather than generic productivity:

- **Externalized working memory** — the full structure is always visible spatially; nothing lives only in your head ("out of sight, out of mind" is the failure mode being prevented).
- **Reduced overwhelm** — a visually calm interface (muted sage palette, minimal chrome, gentle motion); *leaf* nodes (the actually actionable items) render brighter than the muted structural branch nodes, so the actionable edge of the tree pops forward.
- **Low-friction structure changes** — tasks are reorganized by direct manipulation (drag a node onto a new parent), not by ceremony.
- **Forgiving by design** — no deadlines, no overdue red badges, no guilt mechanics. Done branches fade and recede instead of demanding attention.

## Main functionality

**Markdown import / export.** Tasks round-trip as a nested bullet list (`-`, `*`, or `+`; indentation = depth). Conventions:
- A **type** emoji at the *start* of an item: `☎️` (call), `👩🏻‍💻` (coding), etc.
- A **status** emoji at the *end* of an item: `💻` in progress, `⏳` waiting to start, `🧱` blocked, `⏭️` will do next, `✅` done, `❓` needs external input. No emoji at the end → **no status** (deliberate default). `- [x]` also counts as done. The parser guards against reading the `💻` inside `👩🏻‍💻` (ZWJ sequence) as a status.
- Lines starting with `>` become the description of the item above.
- Import can **replace** the tree or **append** to it; export writes the same format back.

**Auto-balanced tree visualization.** d3 tidy-tree layout sized to the container's aspect ratio, so the tree spreads to use screen space evenly; toggle between **horizontal** (root left) and **radial** (root center) layouts. Auto-fit on load, import, layout switch, and structure changes; manual pan (drag), zoom (wheel/pinch), and a Fit button.

**Node editing.** Click a node → side panel (bottom sheet on mobile) to edit title and description, set type (none / call / coding), set status (none + the six statuses), add a sub-task, or delete the subtree (two-step confirm). The 🌳 root hub adds top-level tasks.

**Drag-to-reparent.** Press-drag a node to lift it into a ghost; valid drop targets highlight with a dashed ring (a node can't be dropped on itself or its descendants). Dropping moves the node **with its whole subtree**; dropping on the 🌳 hub makes it top-level; releasing over empty space cancels. A plain click still just selects. Reparenting appends as the target's last child (no sibling ordering yet) and does not open the panel.

**Visual language.** Pills show `[type emoji] title [status emoji]` with a thin status-colored bar (only when a status is set); done tasks fade with strikethrough; a small dot marks nodes that have a description; a legend explains both emoji groups. Progress counter (`done/total`) in the top bar.

**Persistence.** The whole document auto-saves (debounced) as JSON to `window.storage` under key `tasktree:doc`, with a save indicator. On load, docs from older schema versions are migrated (`status: "call"` → `type: "call"`, missing `type` field added).

## Tech notes for continuing work

- **Stack:** single-file React component (`task-tree.jsx`), d3 (only `d3.hierarchy` / `d3.tree`) for layout, hand-rolled SVG rendering, pan/zoom, and pointer-based drag. All CSS lives in a template string in the same file.
- **Data model:** `doc = { title, children: Node[] }`; `Node = { id, title, desc, status: key|null, type: key|null, children: Node[] }`. Vocabulary in `STATUSES` / `TYPES` constants; tree edits go through immutable helpers (`updateNode`, `addChild`, `removeNode`, `findNode`, `migrateNodes`).
- **Rendering pipeline:** `layout` useMemo builds a synthetic root (`id: "__root"`) → d3 tree → `{nodes, links}` in world coordinates → one `<g transform>` applies the view `{x, y, k}`. `fitView` computes the bounding box (using per-node `pillW`) and recenters; `structureRev` bumps trigger refit.
- **Environment:** built as a claude.ai artifact — `window.storage` is the artifact key-value API. To run locally (Vite + React), shim `window.storage` onto `localStorage` before mounting (see repo setup notes / main.jsx). No backend, no localStorage direct usage in the component itself.
- **Interaction subtleties worth preserving:** node pointer-down uses `setPointerCapture`; a 7px movement threshold distinguishes drag from click; `suppressClick` prevents the post-drag click from selecting; wheel zoom is attached natively with `{ passive: false }`.

## Roadmap (agreed direction, not yet implemented)

Prioritized for ADHD benefit:
1. **Focus mode / branch zoom** — double-click makes a node the temporary root; its subtree fills the screen, breadcrumb to climb back (targets overwhelm; highest expected impact).
2. **"Next up" spotlight** — dim everything except ⏭️/💻 nodes (or the shallowest unblocked leaf) to answer "what do I do now?" (targets task initiation).
3. **Completion feedback** — fold-closed animation on done, progress rings on parents, offer to complete a parent when all children are done (immediate reward).
4. **Undo** — snapshot stack of the doc; important now that mis-drops and subtree deletes are possible.
5. **Collapse/expand branches** with hidden-count badges; **sibling reordering** during drag (drop into gaps between pills); animated layout transitions; multiple named trees.
