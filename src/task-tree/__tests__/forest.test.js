import { describe, it, expect } from "vitest";
import { growTree } from "../forest.js";

const node = (id, children = []) => ({ id, title: id, children });
const fallen = (id, ancestorIds) => ({ id, title: id, doneAt: null, ancestorIds });

// root
//  └ a ── a1
//  └ b
const root = node("root", [node("a", [node("a1")]), node("b")]);

describe("growTree", () => {
  it("counts every task under the root, the replanted leaves included", () => {
    expect(growTree(root).size).toBe(3);
    expect(growTree(root, [fallen("f1", ["root", "a"])]).size).toBe(4);
  });

  it("tags the foliage of a replanted leaf so it can be toned apart", () => {
    const plain = growTree(root).leaves;
    const grown = growTree(root, [fallen("f1", ["root", "a"])]).leaves;
    expect(plain.every((l) => !l.shed)).toBe(true);
    expect(grown.filter((l) => l.shed).length).toBeGreaterThan(0);
    expect(grown.length).toBeGreaterThan(plain.length);
  });

  it("hangs a leaf whose own parent has also fallen on the nearest surviving ancestor", () => {
    const orphan = growTree(root, [fallen("f1", ["root", "gone", "alsogone"])]);
    expect(orphan.size).toBe(4);
    expect(orphan.leaves.filter((l) => l.shed).length).toBeGreaterThan(0);
  });

  it("skips a fallen leaf that is already back in the subtree", () => {
    const back = growTree(root, [fallen("a1", ["root", "a"])]);
    expect(back.size).toBe(3);
    expect(back.leaves.some((l) => l.shed)).toBe(false);
  });

  it("is deterministic — the same branch always grows the same tree", () => {
    const shed = [fallen("f1", ["root", "a"])];
    expect(growTree(root, shed)).toEqual(growTree(root, shed));
  });
});
