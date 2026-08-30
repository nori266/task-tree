import { describe, it, expect } from "vitest";
import { buildSnapshot, validateSnapshot, restoreSnapshot, SCHEMA_VERSION } from "../backup.js";
import {
  INDEX_KEY, ACTIVE_KEY, VOCAB_KEY, docKey, forestKey, backlogKey, litterKey,
} from "../projects.js";

// Full in-memory stand-in for window.storage (mirrors src/main.jsx, incl. list()).
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    async get(key) {
      if (!map.has(key)) throw new Error("not found");
      return { key, value: map.get(key) };
    },
    async set(key, value) { map.set(key, value); return { key, value }; },
    async delete(key) { map.delete(key); return { key, deleted: true }; },
    async list(prefix = "") {
      return { keys: [...map.keys()].filter((k) => k.startsWith(prefix)) };
    },
  };
}

const seeded = () => fakeStorage({
  [INDEX_KEY]: JSON.stringify([
    { id: "a", title: "A", color: "#EAF2FB" },
    { id: "b", title: "B" },
  ]),
  [ACTIVE_KEY]: "b",
  [VOCAB_KEY]: JSON.stringify({ types: [{ key: "x" }], statuses: [] }),
  [docKey("a")]: JSON.stringify({ title: "A", children: [{ id: "n1", createdAt: 111, children: [] }] }),
  [forestKey("a")]: JSON.stringify([{ id: "tree1" }]),
  [backlogKey("a")]: JSON.stringify([{ id: "bl1" }]),
  [litterKey("a")]: JSON.stringify([{ id: "lf1" }]),
  [docKey("b")]: JSON.stringify({ title: "B", children: [] }),
  [forestKey("b")]: JSON.stringify([]),
  [backlogKey("b")]: JSON.stringify([]),
  [litterKey("b")]: JSON.stringify([]),
});

describe("buildSnapshot", () => {
  it("captures every project's stores, the active id and vocab", async () => {
    const snap = await buildSnapshot(seeded(), 999);
    expect(snap.version).toBe(SCHEMA_VERSION);
    expect(snap.exportedAt).toBe(999);
    expect(snap.activeId).toBe("b");
    expect(snap.vocab).toEqual({ types: [{ key: "x" }], statuses: [] });
    expect(snap.projects).toHaveLength(2);
    const a = snap.projects.find((p) => p.id === "a");
    expect(a.title).toBe("A");
    expect(a.color).toBe("#EAF2FB");
    expect(a.doc.children[0].createdAt).toBe(111); // timestamps preserved
    expect(a.forest).toEqual([{ id: "tree1" }]);
    expect(a.backlog).toEqual([{ id: "bl1" }]);
    expect(a.litter).toEqual([{ id: "lf1" }]);
  });
});

describe("validateSnapshot", () => {
  it("accepts a well-formed snapshot", () => {
    expect(() => validateSnapshot({ version: SCHEMA_VERSION, projects: [] })).not.toThrow();
  });
  it("rejects a wrong version and a missing projects array", () => {
    expect(() => validateSnapshot({ version: 99, projects: [] })).toThrow(/version/);
    expect(() => validateSnapshot({ version: SCHEMA_VERSION })).toThrow(/projects/);
    expect(() => validateSnapshot(null)).toThrow();
  });
});

describe("restoreSnapshot", () => {
  it("round-trips a snapshot back into storage", async () => {
    const snap = await buildSnapshot(seeded(), 1);
    const target = fakeStorage();
    await restoreSnapshot(target, snap);
    expect(JSON.parse(target.map.get(INDEX_KEY))).toEqual([
      { id: "a", title: "A", color: "#EAF2FB" },
      { id: "b", title: "B" },
    ]);
    expect(target.map.get(ACTIVE_KEY)).toBe("b");
    expect(JSON.parse(target.map.get(docKey("a"))).children[0].createdAt).toBe(111);
    expect(JSON.parse(target.map.get(litterKey("a")))).toEqual([{ id: "lf1" }]);
  });

  it("replaces all: stale tasktree keys are cleared first", async () => {
    const snap = await buildSnapshot(seeded(), 1);
    const target = fakeStorage({
      [docKey("stale")]: JSON.stringify({ title: "gone" }),
      "tasktree:project:stale:forest": "[]",
    });
    await restoreSnapshot(target, snap);
    expect(target.map.has(docKey("stale"))).toBe(false);
    expect(target.map.has("tasktree:project:stale:forest")).toBe(false);
    expect(target.map.has(docKey("a"))).toBe(true);
  });
});
