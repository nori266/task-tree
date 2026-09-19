# Editing the Task Tree from an agent

The running app (browser) and you (filesystem) meet at **one linked markdown
file** — the file the app syncs to via `Ctrl+S` (File System Access API). Edit
that file and the app pulls your changes in within a second or two, as long as
the tab is open and the tree has no unsaved in-memory edits. When it does have
unsaved edits it shows a *changed on disk* toast instead, so nothing is lost —
apply it with **Reload**, or via **Reload from file** in the Export modal.

Point the CLI at that file, resolved in this order:
1. `--file <path>` on the command
2. `TASKTREE_FILE` env var
3. a `.task-tree.json` config found by walking up from the current directory:
   ```json
   { "file": "tasks.md" }
   ```
   A relative `file` resolves against the config's own directory, so a repo-level
   `.task-tree.json` works from any subdirectory.

## CLI

```
task-tree ls
task-tree add "<title>" [--parent <id>] [--status <key>] [--type <key>] [--important]
task-tree mv <id> [--parent <id>]        # omit --parent to move to top level
task-tree status <id> <key|none>
task-tree set <id> [--title <t>] [--desc <d>] [--type <key|none>] [--important <true|false>]
task-tree block <id> <blockerId>
task-tree unblock <id> <blockerId>
task-tree rm <id>
```

`add` prints the new task id. `ls` prints ids so you can reference them. Status
keys: `inprogress`, `waiting`, `next`, `done`, `question`. Type keys: `call`,
`coding`, `docs`, `research`.

Run it directly during development: `node bin/task-tree.js ls --file tasks.md`.

## File format

Nested bullets; two-space indent = depth. Type emoji at the start, status emoji
at the end, `**bold**` = important, `> ` lines = description. The bridge file also
carries a trailing `^<id>` on each bullet and a `⛓ blocked-by: ^<id>` line for
dependencies — the CLI manages these; leave the ids alone so links and the
leaf-fall clocks survive the round-trip. A hand-added bullet without an id is
fine: it gets a fresh one on import.

You can hand-edit the file instead of using the CLI, but prefer the CLI for
structural changes (moves, blocks, deletes) so ids and links stay consistent.
