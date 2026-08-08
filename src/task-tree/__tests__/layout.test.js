import { describe, it, expect } from "vitest";
import {
  jitter, labelOf, pillW, computeDoneBranchIds, computeLayout,
} from "../layout.js";

describe("jitter", () => {
  it("is deterministic for a given id and salt", () => {
    expect(jitter("node-x")).toBe(jitter("node-x"));
    expect(jitter("node-x", 7)).toBe(jitter("node-x", 7));
  });
  it("varies with id and with salt", () => {
    expect(jitter("a")).not.toBe(jitter("b"));
    expect(jitter("a")).not.toBe(jitter("a", 7));
  });
  it("stays within [-0.5, 0.5)", () => {
    for (const id of ["a", "bb", "ccc", "n123", ""]) {
      const v = jitter(id);
      expect(v).toBeGreaterThanOrEqual(-0.5);
      expect(v).toBeLessThan(0.5);
    }
  });
});

describe("labelOf / pillW", () => {
  it("truncates titles past 26 chars with an ellipsis", () => {
    expect(labelOf("short")).toBe("short");
    const long = labelOf("x".repeat(40));
    expect(long.endsWith("…")).toBe(true);
    expect(long.length).toBe(26);
  });
  it("never goes below the minimum pill width", () => {
    expect(pillW({ title: "" })).toBeGreaterThanOrEqual(64);
  });
});

describe("computeDoneBranchIds", () => {
  it("marks a fully-done subtree, not a partly-done one", () => {
    const children = [
      { id: "done", status: "done", children: [
        { id: "d1", status: "done", children: [] },
      ] },
      { id: "mixed", status: "done", children: [
        { id: "m1", status: null, children: [] },
      ] },
    ];
    const ids = computeDoneBranchIds(children);
    expect(ids.has("done")).toBe(true);
    expect(ids.has("d1")).toBe(true);
    expect(ids.has("mixed")).toBe(false);
  });
});

describe("computeLayout dependencies", () => {
  const size = { w: 1000, h: 700 };
  const doc = (extra = {}) => ({
    title: "root",
    children: [
      { id: "a", title: "A", blockedBy: [], children: [], ...extra.a },
      { id: "b", title: "B", blockedBy: [], children: [] },
    ],
  });

  it("emits a dep path from blocker to blocked when both are present", () => {
    const { deps } = computeLayout(
      doc({ a: { id: "a", title: "A", blockedBy: ["b"], children: [] } }),
      size, new Set());
    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({ from: "b", to: "a" });
    expect(deps[0].path).toMatch(/^M[\d.-]+,[\d.-]+ C/);
  });

  it("skips a dependency whose blocker is not in the tree", () => {
    const { deps } = computeLayout(
      doc({ a: { id: "a", title: "A", blockedBy: ["ghost"], children: [] } }),
      size, new Set());
    expect(deps).toEqual([]);
  });

  it("returns empty collections for a null doc", () => {
    expect(computeLayout(null, size, new Set())).toEqual({ nodes: [], links: [], deps: [] });
  });
});
