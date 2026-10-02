import { describe, it, expect } from "vitest";
import { parseMarkdown } from "../markdown.js";
import { mergeTrees } from "../merge.js";

const md = (s) => parseMarkdown(s);
const titles = (nodes) => nodes.map((n) => n.children.length ? [n.title, titles(n.children)] : n.title);

describe("mergeTrees", () => {
  const base = md("- A ^a\n  - A1 ^a1\n- B ^b");

  it("keeps nodes added in the app and nodes added in the file", () => {
    const local = md("- A ^a\n  - A1 ^a1\n  - Mine ^m\n- B ^b");
    const remote = md("- A ^a\n  - A1 ^a1\n- B ^b\n  - From CLI ^c");
    expect(titles(mergeTrees(base, local, remote))).toEqual([["A", ["A1", "Mine"]], ["B", ["From CLI"]]]);
  });

  it("slots a local addition after its preceding sibling", () => {
    const local = md("- A ^a\n- Mine ^m\n- B ^b");
    const remote = md("- A ^a\n- B ^b\n- C ^c");
    expect(titles(mergeTrees(md("- A ^a\n- B ^b"), local, remote))).toEqual(["A", "Mine", "B", "C"]);
  });

  it("applies deletions from either side", () => {
    const local = md("- A ^a\n  - A1 ^a1");
    const remote = md("- A ^a\n- B ^b");
    expect(titles(mergeTrees(base, local, remote))).toEqual(["A"]);
  });

  it("keeps a remotely deleted node that gained a local child", () => {
    const local = md("- A ^a\n  - A1 ^a1\n- B ^b\n  - Mine ^m");
    const remote = md("- A ^a\n  - A1 ^a1");
    expect(titles(mergeTrees(base, local, remote))).toEqual([["A", ["A1"]], ["B", ["Mine"]]]);
  });

  it("takes each field from the side that changed it, local on conflict", () => {
    const local = md("- A renamed ^a\n  - A1 ^a1\n- B mine ^b");
    const remote = md("- A ✅ ^a\n  - A1 ^a1\n- B theirs ^b");
    const [a, b] = mergeTrees(base, local, remote, 5);
    expect([a.title, a.status, a.doneAt]).toEqual(["A renamed", "done", 5]);
    expect(b.title).toBe("B mine");
  });

  it("follows a move made on either side", () => {
    const remote = md("- A ^a\n- B ^b\n  - A1 ^a1");
    expect(titles(mergeTrees(base, base, remote))).toEqual(["A", ["B", ["A1"]]]);
  });

  it("keeps local lifecycle clocks", () => {
    const local = md("- A ^a\n  - A1 ✅ ^a1\n- B ^b");
    local[0].createdAt = 1; local[0].children[0].doneAt = 2;
    const remote = md("- A ^a\n  - A1 ✅ ^a1\n- B ^b");
    const [a] = mergeTrees(base, local, remote);
    expect([a.createdAt, a.children[0].doneAt]).toEqual([1, 2]);
  });

  it("breaks a cycle from conflicting moves", () => {
    const b2 = md("- A ^a\n- B ^b");
    const local = md("- A ^a\n  - B ^b");
    const remote = md("- B ^b\n  - A ^a");
    const out = mergeTrees(b2, local, remote);
    const count = (ns) => ns.reduce((c, n) => c + 1 + count(n.children), 0);
    expect(count(out)).toBe(2);
  });

  it("without a base keeps everything from both sides", () => {
    const local = md("- A ^a\n- Mine ^m");
    const remote = md("- A ^a\n- C ^c");
    expect(titles(mergeTrees(null, local, remote))).toEqual(["A", "Mine", "C"]);
  });
});
