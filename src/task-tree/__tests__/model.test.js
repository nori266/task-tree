import { describe, it, expect } from "vitest";
import {
  newNode, updateNode, addChild, removeNode, findNode, countNodes, countDone,
  addDep, removeDep, pruneDeps, collectIds,
} from "../model.js";

const tree = () => [
  { id: "a", title: "A", status: "done", blockedBy: [], children: [
    { id: "a1", title: "A1", status: null, blockedBy: [], children: [] },
    { id: "a2", title: "A2", status: "done", blockedBy: [], children: [] },
  ] },
  { id: "b", title: "B", status: null, blockedBy: [], children: [] },
];

describe("newNode", () => {
  it("has an empty blockedBy and children by default", () => {
    const n = newNode("x");
    expect(n.blockedBy).toEqual([]);
    expect(n.children).toEqual([]);
    expect(n.title).toBe("x");
  });
  it("stamps doneAt only when created done", () => {
    expect(newNode("x", "done").doneAt).toEqual(expect.any(Number));
    expect(newNode("x", "next").doneAt).toBeNull();
  });
  it("gives distinct ids", () => {
    expect(newNode().id).not.toBe(newNode().id);
  });
});

describe("tree helpers", () => {
  it("updateNode patches only the matching node, immutably", () => {
    const t = tree();
    const out = updateNode(t, "a1", { title: "renamed" });
    expect(findNode(out, "a1").title).toBe("renamed");
    expect(findNode(t, "a1").title).toBe("A1"); // original untouched
  });
  it("addChild appends under the parent", () => {
    const out = addChild(tree(), "b", newNode("child"));
    expect(findNode(out, "b").children).toHaveLength(1);
  });
  it("removeNode deletes the subtree wherever it sits", () => {
    const out = removeNode(tree(), "a1");
    expect(findNode(out, "a1")).toBeNull();
    expect(findNode(out, "a2")).not.toBeNull();
  });
  it("findNode returns null when absent", () => {
    expect(findNode(tree(), "nope")).toBeNull();
  });
  it("counts nodes and done nodes across the whole tree", () => {
    expect(countNodes(tree())).toBe(4);
    expect(countDone(tree())).toBe(2);
  });
});

describe("dependencies", () => {
  it("addDep records a blocker", () => {
    const out = addDep(tree(), "a1", "b");
    expect(findNode(out, "a1").blockedBy).toEqual(["b"]);
  });
  it("addDep refuses self-links and duplicates", () => {
    let out = addDep(tree(), "a1", "a1");
    expect(findNode(out, "a1").blockedBy).toEqual([]);
    out = addDep(addDep(tree(), "a1", "b"), "a1", "b");
    expect(findNode(out, "a1").blockedBy).toEqual(["b"]);
  });
  it("removeDep drops one blocker and leaves the rest", () => {
    let out = addDep(addDep(tree(), "a1", "b"), "a1", "a2");
    out = removeDep(out, "a1", "b");
    expect(findNode(out, "a1").blockedBy).toEqual(["a2"]);
  });
  it("collectIds gathers every id", () => {
    expect(collectIds(tree())).toEqual(new Set(["a", "a1", "a2", "b"]));
  });
  it("pruneDeps strips references to ids no longer in the tree", () => {
    const withDep = addDep(tree(), "a1", "b");
    const pruned = pruneDeps(removeNode(withDep, "b"));
    expect(findNode(pruned, "a1").blockedBy).toEqual([]);
  });
  it("pruneDeps keeps references that still resolve", () => {
    const withDep = addDep(tree(), "a1", "a2");
    expect(findNode(pruneDeps(withDep), "a1").blockedBy).toEqual(["a2"]);
  });
});
