import { describe, it, expect } from "vitest";
import {
  jitter, labelOf, pillW, computeDoneBranchIds, computeLayout, PILL_H,
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

describe("computeLayout lane compaction", () => {
  const size = { w: 1400, h: 800 };
  const leaf = (id) => ({ id, title: id, blockedBy: [], children: [] });
  const chain = (id, n) =>
    n === 0 ? [] : [{ id: `${id}${n}`, title: id, blockedBy: [], children: chain(id, n - 1) }];

  it("never overlaps two nodes that share a depth column", () => {
    // shallow-bushy and deep-thin branches interleaved: the packer may pull the
    // deep tail up into free lanes, but pills in the same column must stay clear.
    const doc = { title: "root", children: [
      { id: "B1", title: "B1", blockedBy: [], children: [leaf("a"), leaf("b"), leaf("c")] },
      { id: "D1", title: "D1", blockedBy: [], children: chain("d", 5) },
      { id: "B2", title: "B2", blockedBy: [], children: [leaf("e"), leaf("f"), leaf("g")] },
    ] };
    const { nodes } = computeLayout(doc, size, new Set());
    const byCol = new Map();
    for (const n of nodes) {
      const col = n.d.depth;
      (byCol.get(col) ?? byCol.set(col, []).get(col)).push(n.y);
    }
    for (const ys of byCol.values()) {
      ys.sort((p, q) => p - q);
      for (let i = 1; i < ys.length; i++) {
        expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(PILL_H - 1e-6);
      }
    }
  });

  it("never overlaps any two node rectangles, even with wide titles", () => {
    // mix long and short titles across several depths so pill widths vary and
    // the fixed depth pitch alone would collide neighbouring columns.
    const wide = (id) => ({ id, title: `a really quite long task title ${id}`, blockedBy: [], children: [] });
    const doc = { title: "root project", children: [
      { id: "P1", title: "a really quite long parent title", blockedBy: [], children: [wide("a"), leaf("b"), wide("c")] },
      { id: "P2", title: "short", blockedBy: [], children: [leaf("d"), wide("e"), chain("t", 4)[0]] },
      { id: "P3", title: "another lengthy branch heading here", blockedBy: [], children: [wide("f"), wide("g")] },
    ] };
    const { nodes } = computeLayout(doc, size, new Set());
    const rect = (n) => {
      const hw = n.d.depth === 0 ? 20 : pillW(n.d.data) / 2;
      return { l: n.x - hw, r: n.x + hw, t: n.y - PILL_H / 2, b: n.y + PILL_H / 2 };
    };
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const A = rect(nodes[i]), B = rect(nodes[j]);
        const overlap = A.l < B.r && B.l < A.r && A.t < B.b && B.t < A.b;
        expect(overlap, `${nodes[i].d.data.id} overlaps ${nodes[j].d.data.id}`).toBe(false);
      }
    }
  });
});
