import { describe, it, expect } from "vitest";
import {
  newProjectId, docKey, forestKey, backlogKey, litterKey,
  migrateLegacy, INDEX_KEY, ACTIVE_KEY,
  PROJECT_COLORS, nextProjectColor,
} from "../projects.js";

// Minimal in-memory stand-in for window.storage: get() throws when absent.
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
  };
}

describe("key builders", () => {
  it("namespace each store under the project id", () => {
    expect(docKey("p1")).toBe("tasktree:project:p1:doc");
    expect(forestKey("p1")).toBe("tasktree:project:p1:forest");
    expect(backlogKey("p1")).toBe("tasktree:project:p1:backlog");
    expect(litterKey("p1")).toBe("tasktree:project:p1:litter");
  });
  it("newProjectId is unique", () => {
    expect(newProjectId()).not.toBe(newProjectId());
  });
});

describe("nextProjectColor", () => {
  it("cycles the palette by project count", () => {
    expect(nextProjectColor([])).toBe(PROJECT_COLORS[0]);
    expect(nextProjectColor([{}])).toBe(PROJECT_COLORS[1]);
    expect(nextProjectColor(new Array(PROJECT_COLORS.length).fill({}))).toBe(PROJECT_COLORS[0]);
  });
  it("treats a missing list as empty", () => {
    expect(nextProjectColor()).toBe(PROJECT_COLORS[0]);
  });
});

describe("migrateLegacy", () => {
  it("returns an existing index untouched and fixes a stale active id", async () => {
    const projects = [{ id: "a", title: "A" }, { id: "b", title: "B" }];
    const s = fakeStorage({
      [INDEX_KEY]: JSON.stringify(projects),
      [ACTIVE_KEY]: "gone",
    });
    const res = await migrateLegacy(s);
    expect(res.projects).toEqual(projects);
    expect(res.activeId).toBe("a"); // stale "gone" falls back to the first
    expect(s.map.get(ACTIVE_KEY)).toBe("a");
  });

  it("wraps legacy single-tree data as one project and drops legacy keys", async () => {
    const doc = { title: "Old tree", children: [{ id: "n1", children: [] }] };
    const s = fakeStorage({
      "tasktree:doc": JSON.stringify(doc),
      "tasktree:forest": JSON.stringify([{ id: "f" }]),
      "tasktree:backlog": JSON.stringify([]),
      "tasktree:litter": JSON.stringify([]),
    });
    const res = await migrateLegacy(s);
    expect(res.projects).toHaveLength(1);
    const { id, title } = res.projects[0];
    expect(title).toBe("Old tree");
    expect(res.activeId).toBe(id);
    // moved onto per-project keys...
    expect(JSON.parse(s.map.get(docKey(id)))).toEqual(doc);
    expect(JSON.parse(s.map.get(forestKey(id)))).toEqual([{ id: "f" }]);
    // ...and legacy keys removed
    expect(s.map.has("tasktree:doc")).toBe(false);
    expect(s.map.has("tasktree:forest")).toBe(false);
  });

  it("seeds a single sample project when storage is empty", async () => {
    const s = fakeStorage();
    const res = await migrateLegacy(s);
    expect(res.projects).toHaveLength(1);
    const { id, title } = res.projects[0];
    expect(title).toBe("My tasks");
    expect(res.activeId).toBe(id);
    const doc = JSON.parse(s.map.get(docKey(id)));
    expect(doc.title).toBe("My tasks");
    expect(doc.children.length).toBeGreaterThan(0); // seeded from SAMPLE_MD
    expect(s.map.get(INDEX_KEY)).toContain(id);
  });
});
