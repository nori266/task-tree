import { describe, it, expect } from "vitest";
import { parseMarkdown, toMarkdown, migrateNodes, mergeById, countNew } from "../markdown.js";

describe("parseMarkdown", () => {
  it("nests by indentation", () => {
    const roots = parseMarkdown("- Parent\n  - Child\n    - Grandchild");
    expect(roots).toHaveLength(1);
    expect(roots[0].title).toBe("Parent");
    expect(roots[0].children[0].title).toBe("Child");
    expect(roots[0].children[0].children[0].title).toBe("Grandchild");
  });
  it("reads a checked box as done", () => {
    const [n] = parseMarkdown("- [x] Finished");
    expect(n.status).toBe("done");
    expect(n.title).toBe("Finished");
  });
  it("extracts a leading type emoji and trailing status emoji", () => {
    const [n] = parseMarkdown("- ☎️ Ring the office ❓");
    expect(n.type).toBe("call");
    expect(n.status).toBe("question");
    expect(n.title).toBe("Ring the office");
  });
  it("marks **bold** titles important", () => {
    const [n] = parseMarkdown("- **Renew passport**");
    expect(n.important).toBe(true);
    expect(n.title).toBe("Renew passport");
  });
  it("accepts numbered items and attaches a description line", () => {
    const roots = parseMarkdown("1. Task\n  > a note");
    expect(roots[0].title).toBe("Task");
    expect(roots[0].desc).toBe("a note");
  });
  it("falls back to Untitled for an empty title", () => {
    const [n] = parseMarkdown("- ");
    expect(n.title).toBe("Untitled");
  });
});

describe("toMarkdown / roundtrip", () => {
  it("re-emits type, status, importance and nesting", () => {
    const md = "- ☎️ **Call bank** ✅\n  - Sub-task ⏭️\n";
    expect(toMarkdown(parseMarkdown(md))).toBe(md);
  });
  it("serialises description lines with a > prefix", () => {
    const out = toMarkdown(parseMarkdown("- Task\n  > note"));
    expect(out).toContain("  > note");
  });
  it("keeps the human export id-free by default", () => {
    expect(toMarkdown(parseMarkdown("- Task"))).toBe("- Task\n");
  });
});

describe("id + blocked-by round-trip (ids mode)", () => {
  it("preserves stable ids and blocked-by links through a round-trip", () => {
    const nodes = [
      { id: "a1", title: "Blocker", status: null, type: null, important: false, desc: "", blockedBy: [], children: [] },
      { id: "b2", title: "Blocked", status: null, type: null, important: false, desc: "", blockedBy: ["a1"], children: [] },
    ];
    const md = toMarkdown(nodes, 0, { ids: true });
    expect(md).toContain("^a1");
    expect(md).toContain("⛓ blocked-by: ^a1");
    const back = parseMarkdown(md);
    expect(back[0].id).toBe("a1");
    expect(back[1].id).toBe("b2");
    expect(back[1].blockedBy).toEqual(["a1"]);
  });
  it("mints a fresh id for a hand-written bullet without a marker", () => {
    const [n] = parseMarkdown("- Just typed this");
    expect(n.id).toMatch(/^n/);
  });
});

describe("mergeById", () => {
  it("carries createdAt/doneAt over from the node with the same id", () => {
    const parsed = parseMarkdown("- Kept ✅ ^keep\n- New task");
    const existing = [{ id: "keep", createdAt: 111, doneAt: 222, children: [] }];
    const [kept, fresh] = mergeById(parsed, existing, 999);
    expect(kept.createdAt).toBe(111);
    expect(kept.doneAt).toBe(222); // preserved, clock not reset
    expect(fresh.doneAt).toBeNull();
  });
  it("stamps doneAt now when the file newly marks a node done", () => {
    const parsed = parseMarkdown("- Finish ✅ ^x");
    const existing = [{ id: "x", createdAt: 1, doneAt: null, children: [] }];
    const [n] = mergeById(parsed, existing, 999);
    expect(n.doneAt).toBe(999);
  });
});

describe("countNew", () => {
  it("counts nodes at any depth whose id is not already in the tree", () => {
    const parsed = parseMarkdown("- Kept ^keep\n  - Added child\n- Added root ^fresh");
    const existing = [{ id: "keep", children: [] }];
    expect(countNew(parsed, existing)).toBe(2);
  });
  it("is zero when every id is already known", () => {
    const parsed = parseMarkdown("- A ^a\n  - B ^b");
    const existing = [{ id: "a", children: [{ id: "b", children: [] }] }];
    expect(countNew(parsed, existing)).toBe(0);
  });
});

describe("migrateNodes", () => {
  it("backfills blockedBy as an array", () => {
    const [n] = migrateNodes([{ title: "x", children: [] }]);
    expect(n.blockedBy).toEqual([]);
  });
  it("preserves an existing blockedBy array", () => {
    const [n] = migrateNodes([{ title: "x", blockedBy: ["z"], children: [] }]);
    expect(n.blockedBy).toEqual(["z"]);
  });
  it("converts the legacy 'call' status into a type", () => {
    const [n] = migrateNodes([{ title: "x", status: "call", children: [] }]);
    expect(n.status).toBeNull();
    expect(n.type).toBe("call");
  });
  it("stamps a missing createdAt with the supplied time", () => {
    const [n] = migrateNodes([{ title: "x", children: [] }], 1234);
    expect(n.createdAt).toBe(1234);
  });
  it("clears doneAt for non-done nodes and stamps it for done ones", () => {
    const [a, b] = migrateNodes(
      [{ title: "a", status: null, doneAt: 9, children: [] },
       { title: "b", status: "done", children: [] }], 55);
    expect(a.doneAt).toBeNull();
    expect(b.doneAt).toBe(55);
  });
  it("drops unknown statuses", () => {
    const [n] = migrateNodes([{ title: "x", status: "bogus", children: [] }]);
    expect(n.status).toBeNull();
  });
});
