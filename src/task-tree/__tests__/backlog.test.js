import { describe, it, expect } from "vitest";
import {
  isStale, sweepBacklog, mergeIntoBacklog, takeFromBacklog, graftIntoTree,
  countBacklogged, STALE_MS,
} from "../backlog.js";

const now = 1_000_000_000_000;
const old = now - STALE_MS - 1;
const recent = now - 1000;

describe("isStale", () => {
  it("is true once a node has sat past the threshold", () => {
    expect(isStale({ createdAt: old }, now)).toBe(true);
    expect(isStale({ createdAt: recent }, now)).toBe(false);
  });
});

describe("sweepBacklog", () => {
  it("moves out an untouched stale leaf, keeps a fresh or statusful one", () => {
    const children = [
      { id: "stale", status: null, createdAt: old, children: [] },
      { id: "fresh", status: null, createdAt: recent, children: [] },
      { id: "working", status: "inprogress", createdAt: old, children: [] },
    ];
    const { children: kept, moved } = sweepBacklog(children, now);
    expect(moved.map((m) => m.node.id)).toEqual(["stale"]);
    expect(kept.map((n) => n.id)).toEqual(["fresh", "working"]);
  });

  it("an untouched parent emptied by the sweep follows its children out", () => {
    const children = [
      { id: "p", status: null, createdAt: old, children: [
        { id: "c", status: null, createdAt: old, children: [] },
      ] },
    ];
    const { children: kept, moved } = sweepBacklog(children, now);
    expect(kept).toEqual([]);
    expect(moved.map((m) => m.node.id).sort()).toEqual(["c", "p"]);
  });

  it("keeps a parent that still has a statusful child", () => {
    const children = [
      { id: "p", status: null, createdAt: old, children: [
        { id: "c", status: "done", createdAt: old, children: [] },
      ] },
    ];
    const { children: kept, moved } = sweepBacklog(children, now);
    expect(moved).toEqual([]);
    expect(kept[0].id).toBe("p");
  });
});

describe("merge / take roundtrip", () => {
  it("rebuilds the ancestor path in the backlog, then returns it", () => {
    const tree = [
      { id: "root", status: null, createdAt: old, children: [
        { id: "leaf", status: null, createdAt: old, children: [] },
      ] },
    ];
    const { moved } = sweepBacklog(tree, now);
    const backlog = mergeIntoBacklog([], moved, now);
    expect(backlog[0].id).toBe("root");

    const taken = takeFromBacklog(backlog, "leaf", now + 1);
    expect(taken.node.id).toBe("leaf");
    expect(taken.node.createdAt).toBe(now + 1); // freshened
    expect(taken.ancestorIds).toEqual(["root"]);
  });

  it("takeFromBacklog returns null for an unknown id", () => {
    expect(takeFromBacklog([], "nope", now)).toBeNull();
  });
});

describe("countBacklogged", () => {
  it("counts real items but not path stubs", () => {
    const backlog = [
      { id: "stub", stub: true, children: [
        { id: "real", stub: false, children: [] },
      ] },
    ];
    expect(countBacklogged(backlog)).toBe(1);
  });
});

describe("graftIntoTree", () => {
  it("attaches under the deepest surviving ancestor", () => {
    const tree = [{ id: "root", children: [] }];
    const out = graftIntoTree(tree, ["root", "gone"], { id: "n", children: [] });
    expect(out[0].children[0].id).toBe("n");
  });
  it("falls back to top level when no ancestor remains", () => {
    const out = graftIntoTree([{ id: "other", children: [] }], ["gone"], { id: "n", children: [] });
    expect(out.map((n) => n.id)).toEqual(["other", "n"]);
  });
});
