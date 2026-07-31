import { test, expect } from "bun:test";
import { branchName, applyInvariants, resolveBlocking, foldReads, pick } from "../src/pick";
import type { TicketFacts } from "../src/tracker";

// ───── fixtures

function ticket(overrides: Partial<TicketFacts> = {}): TicketFacts {
  return {
    id: "1",
    title: "a ticket",
    urgency: "P2",
    createdAt: "2026-01-01T00:00:00Z",
    milestone: null,
    ready: true,
    state: "unstarted",
    claimedBy: null,
    blockedBy: [],
    ...overrides,
  };
}

// ───── branchName

test("branchName is deterministic: same id and title always produce the same result", () => {
  const a = branchName("42", "Fix the thing that was broken");
  const b = branchName("42", "Fix the thing that was broken");
  expect(a).toBe(b);
});

test("branchName collapses runs of non-alphanumeric characters into a single hyphen", () => {
  expect(branchName("42", "Fix!!  the -- thing...")).toBe("42-fix-the-thing");
});

test("branchName caps the slug at 40 characters", () => {
  const longTitle = "a".repeat(100);
  const result = branchName("7", longTitle);
  const [id, ...rest] = result.split("-");
  expect(id).toBe("7");
  const slug = rest.join("-");
  expect(slug.length).toBeLessThanOrEqual(40);
});

test("branchName never leaves a trailing hyphen after the 40-char cap", () => {
  // 39 letters + a hyphen + more letters: slicing at 40 mid-word must not
  // leave a dangling hyphen from the cut.
  const title = "a".repeat(39) + " " + "b".repeat(20);
  const result = branchName("9", title);
  expect(result.endsWith("-")).toBe(false);
});

test("branchName always prefixes the id, even when the title yields no usable slug", () => {
  expect(branchName("13", "!!!")).toBe("13");
  expect(branchName("13", "")).toBe("13");
});

test("branchName prefixes the id ahead of the slug for a normal title", () => {
  expect(branchName("101", "Add login button")).toBe("101-add-login-button");
});

// ───── applyInvariants

test("applyInvariants keeps a ticket that satisfies every invariant", () => {
  const result = applyInvariants({ candidates: [ticket()], milestone: null });
  expect(result.eligible.length).toBe(1);
  expect(result.excluded.length).toBe(0);
});

test("applyInvariants excludes a not-ready ticket and says why", () => {
  const result = applyInvariants({ candidates: [ticket({ ready: false })], milestone: null });
  expect(result.eligible.length).toBe(0);
  expect(result.excluded.length).toBe(1);
  expect(result.excluded[0].id).toBe("1");
  expect(result.excluded[0].why).toMatch(/not ready/);
});

test("applyInvariants excludes a ticket that isn't unstarted and says why", () => {
  const result = applyInvariants({ candidates: [ticket({ state: "started" })], milestone: null });
  expect(result.excluded.length).toBe(1);
  expect(result.excluded[0].why).toMatch(/started/);
});

test("applyInvariants excludes an already-claimed ticket and says why", () => {
  const result = applyInvariants({
    candidates: [ticket({ claimedBy: "alice" })],
    milestone: null,
  });
  expect(result.excluded.length).toBe(1);
  expect(result.excluded[0].why).toMatch(/alice/);
});

test("applyInvariants excludes a ticket outside the milestone scope and says why", () => {
  const result = applyInvariants({
    candidates: [ticket({ milestone: "m1" })],
    milestone: "m2",
  });
  expect(result.excluded.length).toBe(1);
  expect(result.excluded[0].why).toMatch(/m1/);
  expect(result.excluded[0].why).toMatch(/m2/);
});

test("applyInvariants: null milestone scope means all milestones are in scope", () => {
  const result = applyInvariants({
    candidates: [ticket({ milestone: "m1" }), ticket({ id: "2", milestone: null })],
    milestone: null,
  });
  expect(result.eligible.length).toBe(2);
  expect(result.excluded.length).toBe(0);
});

test("applyInvariants collects every failing reason for a ticket that fails multiple invariants", () => {
  const result = applyInvariants({
    candidates: [ticket({ ready: false, state: "started", claimedBy: "bob" })],
    milestone: null,
  });
  expect(result.excluded.length).toBe(1);
  expect(result.excluded[0].why).toMatch(/not ready/);
  expect(result.excluded[0].why).toMatch(/started/);
  expect(result.excluded[0].why).toMatch(/bob/);
});

test("applyInvariants filters multiple candidates independently", () => {
  const result = applyInvariants({
    candidates: [ticket({ id: "1" }), ticket({ id: "2", ready: false })],
    milestone: null,
  });
  expect(result.eligible.map((t) => t.id)).toEqual(["1"]);
  expect(result.excluded.map((e) => e.id)).toEqual(["2"]);
});

// ───── resolveBlocking

test("resolveBlocking: no blockers means unblocked", () => {
  const t = ticket({ id: "1", blockedBy: [] });
  const result = resolveBlocking([t], [t]);
  expect(result.unblocked).toEqual([t]);
  expect(result.needsRead).toEqual([]);
});

test("resolveBlocking: a visible, open blocker blocks", () => {
  const blocker = ticket({ id: "2", state: "started" });
  const t = ticket({ id: "1", blockedBy: ["2"] });
  const result = resolveBlocking([t], [t, blocker]);
  expect(result.unblocked).toEqual([]);
  expect(result.needsRead).toEqual([]);
});

test("resolveBlocking: a visible, done blocker does not block", () => {
  const blocker = ticket({ id: "2", state: "done" });
  const t = ticket({ id: "1", blockedBy: ["2"] });
  const result = resolveBlocking([t], [t, blocker]);
  expect(result.unblocked).toEqual([t]);
  expect(result.needsRead).toEqual([]);
});

test("resolveBlocking: a visible, canceled blocker does not block", () => {
  const blocker = ticket({ id: "2", state: "canceled" });
  const t = ticket({ id: "1", blockedBy: ["2"] });
  const result = resolveBlocking([t], [t, blocker]);
  expect(result.unblocked).toEqual([t]);
});

test("resolveBlocking: an invisible blocker counts as blocking and lands in needsRead — NOT unblocked", () => {
  const t = ticket({ id: "1", blockedBy: ["ghost"] });
  const result = resolveBlocking([t], [t]);
  // The fail-safe rule: a blocker id absent from the candidate set is not
  // proof it's resolved. The prototype's opposite behavior (invisible =
  // unblocked) is the recorded defect this pins against.
  expect(result.unblocked).toEqual([]);
  expect(result.needsRead).toEqual(["ghost"]);
});

test("resolveBlocking: needsRead has no duplicate ids across multiple blocked tickets sharing a blocker", () => {
  const a = ticket({ id: "1", blockedBy: ["ghost"] });
  const b = ticket({ id: "2", blockedBy: ["ghost"] });
  const result = resolveBlocking([a, b], [a, b]);
  expect(result.needsRead).toEqual(["ghost"]);
  expect(result.unblocked).toEqual([]);
});

test("resolveBlocking: a ticket with one visible-open blocker and one invisible blocker stays blocked and still reports the invisible one", () => {
  const openBlocker = ticket({ id: "2", state: "unstarted" });
  const t = ticket({ id: "1", blockedBy: ["2", "ghost"] });
  const result = resolveBlocking([t], [t, openBlocker]);
  expect(result.unblocked).toEqual([]);
  expect(result.needsRead).toEqual(["ghost"]);
});

// ───── foldReads

test("foldReads unblocks a pending ticket when its blocker reads done", () => {
  const t = ticket({ id: "1", blockedBy: ["ghost"] });
  const result = foldReads([t], [{ id: "ghost", state: "done" }]);
  expect(result.unblocked).toEqual([t]);
  expect(result.stillBlocked).toEqual([]);
});

test("foldReads unblocks a pending ticket when its blocker reads canceled", () => {
  const t = ticket({ id: "1", blockedBy: ["ghost"] });
  const result = foldReads([t], [{ id: "ghost", state: "canceled" }]);
  expect(result.unblocked).toEqual([t]);
});

test("foldReads keeps a pending ticket blocked when its blocker reads unstarted", () => {
  const t = ticket({ id: "1", blockedBy: ["ghost"] });
  const result = foldReads([t], [{ id: "ghost", state: "unstarted" }]);
  expect(result.stillBlocked).toEqual([t]);
  expect(result.unblocked).toEqual([]);
});

test("foldReads keeps a pending ticket blocked when its blocker reads started", () => {
  const t = ticket({ id: "1", blockedBy: ["ghost"] });
  const result = foldReads([t], [{ id: "ghost", state: "started" }]);
  expect(result.stillBlocked).toEqual([t]);
});

test("foldReads keeps a pending ticket blocked when its blocker reads parked", () => {
  const t = ticket({ id: "1", blockedBy: ["ghost"] });
  const result = foldReads([t], [{ id: "ghost", state: "parked" }]);
  expect(result.stillBlocked).toEqual([t]);
});

test("foldReads keeps a pending ticket blocked when a blocker has no matching read at all", () => {
  const t = ticket({ id: "1", blockedBy: ["ghost"] });
  const result = foldReads([t], []);
  expect(result.stillBlocked).toEqual([t]);
});

test("foldReads only unblocks once every one of a ticket's blockers reads done or canceled", () => {
  const t = ticket({ id: "1", blockedBy: ["a", "b"] });
  const partial = foldReads([t], [{ id: "a", state: "done" }]);
  expect(partial.stillBlocked).toEqual([t]);

  const full = foldReads([t], [
    { id: "a", state: "done" },
    { id: "b", state: "canceled" },
  ]);
  expect(full.unblocked).toEqual([t]);
});

// ───── pick (queue order)

test("pick returns null for an empty unblocked list", () => {
  expect(pick([])).toBeNull();
});

test("pick picks P0 first regardless of input order", () => {
  const p2 = ticket({ id: "1", urgency: "P2" });
  const p0 = ticket({ id: "2", urgency: "P0" });
  expect(pick([p2, p0])).toEqual(p0);
});

test("pick sorts \"none\" urgency last", () => {
  const none = ticket({ id: "1", urgency: "none" });
  const p3 = ticket({ id: "2", urgency: "P3" });
  expect(pick([none, p3])).toEqual(p3);
});

test("pick breaks urgency ties oldest-first", () => {
  const older = ticket({ id: "1", urgency: "P1", createdAt: "2025-01-01T00:00:00Z" });
  const newer = ticket({ id: "2", urgency: "P1", createdAt: "2026-01-01T00:00:00Z" });
  expect(pick([newer, older])).toEqual(older);
});
