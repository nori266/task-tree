import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { load, save, addTask, setStatus, setFields, move, block, unblock, remove } from "../treeStore.js";

let dir, file;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tt-"));
  file = join(dir, "tasks.md");
});

describe("treeStore", () => {
  it("load returns [] for a missing file", () => {
    expect(load(join(dir, "nope.md"))).toEqual([]);
  });

  it("adds a root task and a child, persisting ids across a save/load", () => {
    let roots = [];
    const { roots: r1, id: pid } = addTask(roots, { title: "Parent" });
    const { roots: r2, id: cid } = addTask(r1, { title: "Child", parent: pid });
    save(file, r2);
    expect(existsSync(file)).toBe(true);
    const back = load(file);
    expect(back[0].id).toBe(pid);
    expect(back[0].children[0].id).toBe(cid);
  });

  it("rejects an unknown status and a missing parent", () => {
    const { roots } = addTask([], { title: "A" });
    expect(() => addTask(roots, { title: "B", status: "bogus" })).toThrow(/unknown status/);
    expect(() => addTask(roots, { title: "B", parent: "ghost" })).toThrow(/parent not found/);
  });

  it("marks done and drops the links touching it", () => {
    let { roots, id: a } = addTask([], { title: "A" });
    ({ roots } = { roots: addTask(roots, { title: "B" }).roots });
    const b = roots[1].id;
    roots = block(roots, b, a); // B blocked by A
    expect(roots[1].blockedBy).toEqual([a]);
    roots = setStatus(roots, a, "done");
    expect(roots[0].status).toBe("done");
    expect(roots.find((n) => n.id === b).blockedBy).toEqual([]); // link dropped
  });

  it("unblock removes one link without touching status", () => {
    let { roots, id: a } = addTask([], { title: "A" });
    roots = addTask(roots, { title: "B" }).roots;
    const b = roots[1].id;
    roots = block(roots, b, a);
    roots = unblock(roots, b, a);
    expect(roots[1].blockedBy).toEqual([]);
  });

  it("moves a subtree and refuses a move into its own descendant", () => {
    let { roots, id: p } = addTask([], { title: "P" });
    const { roots: r2, id: c } = addTask(roots, { title: "C", parent: p });
    roots = r2;
    expect(() => move(roots, p, c)).toThrow(/itself or its own subtree/);
    roots = move(roots, c, null); // promote child to root
    expect(roots).toHaveLength(2);
    expect(roots.find((n) => n.id === p).children).toHaveLength(0);
  });

  it("set updates fields and remove prunes dangling links", () => {
    let { roots, id: a } = addTask([], { title: "A" });
    roots = addTask(roots, { title: "B" }).roots;
    const b = roots[1].id;
    roots = block(roots, b, a);
    roots = setFields(roots, b, { title: "B2", type: "coding" });
    expect(roots[1].title).toBe("B2");
    expect(roots[1].type).toBe("coding");
    roots = remove(roots, a);
    save(file, roots);
    expect(readFileSync(file, "utf8")).not.toContain("blocked-by");
    expect(load(file)[0].blockedBy).toEqual([]);
  });
});
