import { test, expect } from "bun:test";
import { check } from "../src/tracker";
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
    labels: [],
    ...overrides,
  };
}

// ───── tracker.setReady
//
// Park's fourth step. No other ask touches the agent-ready label, so without
// this one a Parked ticket would keep advertising itself as ready to work.

test("check accepts a well-formed setReady answer", () => {
  const result = check({ k: "tracker.setReady", issue: "T-1", ready: false }, { result: "ok" });

  expect(result).toEqual({ ok: true, answer: { result: "ok" } });
});

test("check rejects a setReady answer whose result is not ok", () => {
  const result = check({ k: "tracker.setReady", issue: "T-1", ready: false }, { result: "done" });

  expect(result.ok).toBe(false);
});

test("check rejects a setReady answer that is not an object", () => {
  expect(check({ k: "tracker.setReady", issue: "T-1", ready: true }, "ok").ok).toBe(false);
});

// ───── TicketFacts.labels

test("TicketFacts carries the tracker's labels alongside the agent-ready flag", () => {
  const t = ticket({ labels: ["needs-info", "Bug"], ready: false });
  expect(t.labels).toEqual(["needs-info", "Bug"]);
  expect(t.ready).toBe(false);
});

// ───── tracker.openIssues

test("tracker.openIssues accepts a well-formed ticket list", () => {
  const raw = { result: "ok", tickets: [ticket({ labels: [] })] };
  const got = check({ k: "tracker.openIssues", milestone: "m1" }, raw);
  expect(got.ok).toBe(true);
});

test("tracker.openIssues rejects a ticket missing labels", () => {
  const { labels, ...noLabels } = ticket();
  const got = check({ k: "tracker.openIssues", milestone: "m1" }, { result: "ok", tickets: [noLabels] });
  expect(got.ok).toBe(false);
});

// ───── tracker.milestoneCounts

test("tracker.milestoneCounts now carries every issue state, so progress is derivable", () => {
  const counts = { unstarted: 2, started: 1, parked: 0, done: 4, canceled: 1 };
  const got = check({ k: "tracker.milestoneCounts", milestone: "m1" }, { result: "ok", counts });
  expect(got.ok).toBe(true);
});

test("tracker.milestoneCounts rejects an answer missing a closed state", () => {
  const counts = { unstarted: 2, started: 1, parked: 0 };
  const got = check({ k: "tracker.milestoneCounts", milestone: "m1" }, { result: "ok", counts });
  expect(got.ok).toBe(false);
});
