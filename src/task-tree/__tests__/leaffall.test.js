import { describe, it, expect, vi, afterEach } from "vitest";
import {
  dayIndex, dayAge, fadedIds, collectFallen, applyFall, stampDone,
  FADE_DAY, FALL_DAY,
} from "../leaffall.js";

// Build a done node whose doneAt is `days` calendar days before `today`.
const daysAgo = (today, days) => new Date((today - days) * 86400000).getTime();

afterEach(() => vi.useRealTimers());

describe("dayIndex / dayAge", () => {
  it("gives consecutive indices to consecutive local days", () => {
    const d0 = dayIndex(new Date(2026, 0, 1, 9).getTime());
    const d1 = dayIndex(new Date(2026, 0, 2, 23).getTime());
    expect(d1 - d0).toBe(1);
  });
  it("reads an unstamped done node as finished today", () => {
    const today = dayIndex(Date.now());
    expect(dayAge({ status: "done" }, today)).toBe(0);
  });
});

describe("fadedIds", () => {
  it("includes done nodes at or past FADE_DAY, excludes fresher ones", () => {
    const today = dayIndex(Date.now());
    const children = [
      { id: "old", status: "done", doneAt: daysAgo(today, FADE_DAY), children: [] },
      { id: "fresh", status: "done", doneAt: daysAgo(today, 1), children: [] },
      { id: "todo", status: null, children: [] },
    ];
    const ids = fadedIds(children, today);
    expect(ids.has("old")).toBe(true);
    expect(ids.has("fresh")).toBe(false);
    expect(ids.has("todo")).toBe(false);
  });
});

describe("collectFallen", () => {
  it("collects only childless done leaves past FALL_DAY", () => {
    const today = dayIndex(Date.now());
    const children = [
      { id: "ripe", status: "done", doneAt: daysAgo(today, FALL_DAY), children: [] },
      { id: "young", status: "done", doneAt: daysAgo(today, FALL_DAY - 1), children: [] },
      { id: "parent", status: "done", doneAt: daysAgo(today, FALL_DAY), children: [
        { id: "kid", status: null, children: [] },
      ] },
    ];
    const fallen = collectFallen(children, today);
    expect(fallen.map((f) => f.id)).toEqual(["ripe"]);
  });
  it("records the ancestor chain to a fallen leaf", () => {
    const today = dayIndex(Date.now());
    const children = [{ id: "p", status: "done", children: [
      { id: "leaf", status: "done", doneAt: daysAgo(today, FALL_DAY), children: [] },
    ] }];
    expect(collectFallen(children, today)[0].ancestorIds).toEqual(["p"]);
  });
});

describe("applyFall", () => {
  it("removes the fallen ids", () => {
    const out = applyFall([{ id: "a", children: [] }, { id: "b", children: [] }],
      new Set(["a"]), 100);
    expect(out.map((n) => n.id)).toEqual(["b"]);
  });
  it("refreshes createdAt of a statusless parent emptied by the fall", () => {
    const out = applyFall(
      [{ id: "p", status: null, createdAt: 1, children: [{ id: "c", children: [] }] }],
      new Set(["c"]), 999);
    expect(out[0].createdAt).toBe(999);
    expect(out[0].children).toEqual([]);
  });
  it("leaves a parent's createdAt alone when it keeps a child", () => {
    const out = applyFall(
      [{ id: "p", status: null, createdAt: 1, children: [
        { id: "c1", children: [] }, { id: "c2", children: [] }] }],
      new Set(["c1"]), 999);
    expect(out[0].createdAt).toBe(1);
  });
});

describe("stampDone", () => {
  it("stamps a numeric doneAt when status becomes done", () => {
    vi.useFakeTimers().setSystemTime(new Date(2026, 5, 1));
    const patch = stampDone({ status: "done" });
    expect(patch.doneAt).toBe(new Date(2026, 5, 1).getTime());
  });
  it("clears doneAt when status changes to something else", () => {
    expect(stampDone({ status: "next" }).doneAt).toBeNull();
  });
  it("leaves patches that don't touch status unchanged", () => {
    expect(stampDone({ title: "x" })).toEqual({ title: "x" });
  });
});
