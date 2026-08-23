#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { load, save, addTask, setStatus, setFields, move, block, unblock, remove } from "../src/task-tree/treeStore.js";
import { statusByKey, typeByKey } from "../src/task-tree/model.js";

/* CLI for editing the linked Task Tree markdown file from a terminal or an
   agent (Claude Code, Cursor). All mutations go through treeStore, so ids and
   blocked-by links stay consistent. The target file is resolved in order:
   --file <path>, the TASKTREE_FILE env var, then a `.task-tree.json` config
   ({"file": "..."}) found by walking up from the current directory. */

const CONFIG_NAME = ".task-tree.json";

// Walk up from `start` to the filesystem root looking for a config file; return
// its resolved `file` path (relative entries resolve against the config's own
// directory, so a repo-level default works from any subdirectory), or null.
function fileFromConfig(start = process.cwd()) {
  let dir = resolve(start);
  const root = parse(dir).root;
  for (;;) {
    const cfgPath = join(dir, CONFIG_NAME);
    if (existsSync(cfgPath)) {
      let cfg;
      try { cfg = JSON.parse(readFileSync(cfgPath, "utf8")); }
      catch (e) { throw new Error(`invalid ${CONFIG_NAME} at ${cfgPath}: ${e.message}`); }
      if (cfg.file) return isAbsolute(cfg.file) ? cfg.file : resolve(dir, cfg.file);
    }
    if (dir === root) return null;
    dir = dirname(dir);
  }
}

const USAGE = `task-tree — edit the linked Task Tree markdown file

  File resolution: --file <path>  >  TASKTREE_FILE env  >  ${CONFIG_NAME} ({"file": "..."}, found by walking up from the cwd).

  task-tree ls
  task-tree add "<title>" [--parent <id>] [--status <key>] [--type <key>] [--important]
  task-tree mv <id> [--parent <id>]              (omit --parent to move to top level)
  task-tree status <id> <key|none>
  task-tree set <id> [--title <t>] [--desc <d>] [--type <key|none>] [--important <true|false>]
  task-tree block <id> <blockerId>
  task-tree unblock <id> <blockerId>
  task-tree rm <id>

  status keys: ${Object.keys(statusByKey).join(", ")}
  type keys:   ${Object.keys(typeByKey).join(", ")}`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else { flags[key] = next; i++; }
    } else positional.push(a);
  }
  return { positional, flags };
}

function die(msg) { console.error(msg); process.exit(1); }

function printTree(roots, depth = 0) {
  for (const n of roots) {
    const s = n.status && statusByKey[n.status] ? `[${statusByKey[n.status].emoji}] ` : "";
    const t = n.type && typeByKey[n.type] ? `${typeByKey[n.type].emoji} ` : "";
    const blk = n.blockedBy?.length ? `  ⛓ ${n.blockedBy.join(",")}` : "";
    console.log(`${"  ".repeat(depth)}${n.id}  ${s}${t}${n.important ? `*${n.title}*` : n.title}${blk}`);
    if (n.children?.length) printTree(n.children, depth + 1);
  }
}

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = positional;
  if (!cmd || flags.help || cmd === "help") { console.log(USAGE); return; }

  const path = flags.file || process.env.TASKTREE_FILE || fileFromConfig();
  if (!path) die(`no file: pass --file <path>, set TASKTREE_FILE, or add ${CONFIG_NAME} ({"file": "..."})`);

  const roots = load(path);
  const commit = (next) => save(path, next);

  switch (cmd) {
    case "ls":
      printTree(roots);
      return;
    case "add": {
      if (!rest[0]) die('add needs a title: task-tree add "Title"');
      const { roots: next, id } = addTask(roots, {
        title: rest[0], parent: flags.parent || null,
        status: flags.status || null, type: flags.type || null, important: !!flags.important,
      });
      commit(next);
      console.log(id);
      return;
    }
    case "mv":
      if (!rest[0]) die("mv needs a task id");
      commit(move(roots, rest[0], flags.parent || null));
      return;
    case "status":
      if (!rest[0] || !rest[1]) die("usage: task-tree status <id> <key|none>");
      commit(setStatus(roots, rest[0], rest[1] === "none" ? null : rest[1]));
      return;
    case "set": {
      if (!rest[0]) die("set needs a task id");
      const patch = {};
      if (flags.title !== undefined) patch.title = String(flags.title);
      if (flags.desc !== undefined) patch.desc = String(flags.desc);
      if (flags.type !== undefined) patch.type = flags.type === "none" ? null : flags.type;
      if (flags.important !== undefined) patch.important = flags.important === true || flags.important === "true";
      commit(setFields(roots, rest[0], patch));
      return;
    }
    case "block":
      if (!rest[0] || !rest[1]) die("usage: task-tree block <id> <blockerId>");
      commit(block(roots, rest[0], rest[1]));
      return;
    case "unblock":
      if (!rest[0] || !rest[1]) die("usage: task-tree unblock <id> <blockerId>");
      commit(unblock(roots, rest[0], rest[1]));
      return;
    case "rm":
      if (!rest[0]) die("rm needs a task id");
      commit(remove(roots, rest[0]));
      return;
    default:
      die(`unknown command: ${cmd}\n\n${USAGE}`);
  }
}

try { main(); } catch (e) { die(e.message); }
