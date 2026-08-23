import { describe, it, expect } from "vitest";
import { linearize } from "../linearize.js";

const n = (id, status, children = [], blockedBy = []) => ({
  id, title: id, status, blockedBy, children,
});
const ids = (order) => order.map((x) => x.id);

describe("linearize", () => {
  it("returns nothing when no task is active", () => {
    expect(linearize([n("a", null), n("b", "done")])).toEqual([]);
  });

  it("includes only active tasks and their descendants, dropping done", () => {
    const tree = [
      n("p", "inprogress", [n("c1", null), n("c2", "done")]),
      n("idle", null),
    ];
    expect(ids(linearize(tree)).sort()).toEqual(["c1", "p"]);
  });

  it("places children above their parent", () => {
    const order = ids(linearize([n("p", "inprogress", [n("c1", null), n("c2", null)])]));
    expect(order.indexOf("c1")).toBeLessThan(order.indexOf("p"));
    expect(order.indexOf("c2")).toBeLessThan(order.indexOf("p"));
  });

  it("orders groups in-progress, then next, then waiting", () => {
    const order = ids(linearize([
      n("w", "waiting"),
      n("x", "next"),
      n("i", "inprogress"),
    ]));
    expect(order).toEqual(["i", "x", "w"]);
  });

  it("puts a blocker above the task it blocks", () => {
    // b is blocked by a; both in progress
    const order = ids(linearize([n("a", "inprogress"), n("b", "inprogress", [], ["a"])]));
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
  });

  it("lets the blocker rule override group order", () => {
    // in-progress b is blocked by waiting w — w must still come first
    const order = ids(linearize([
      n("b", "inprogress", [], ["w"]),
      n("w", "waiting"),
    ]));
    expect(order.indexOf("w")).toBeLessThan(order.indexOf("b"));
  });

  it("does not place a node twice when it descends from a higher group", () => {
    // a waiting child under an in-progress parent lands once, in the parent's group
    const order = ids(linearize([n("p", "inprogress", [n("c", "waiting")])]));
    expect(order).toEqual(["c", "p"]);
  });

  it("survives a blocker cycle without dropping nodes", () => {
    const order = ids(linearize([
      n("a", "inprogress", [], ["b"]),
      n("b", "inprogress", [], ["a"]),
    ]));
    expect(order.sort()).toEqual(["a", "b"]);
  });
});
