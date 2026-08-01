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

// ───── tracker.reachable
//
// "can you reach the tracker?" — the first thing a Session asks.

test("check accepts a well-formed reachable answer", () => {
  const result = check({ k: "tracker.reachable" }, { result: "ok" });

  expect(result).toEqual({ ok: true, answer: { result: "ok" } });
});

test("check accepts an unreachable answer and preserves why", () => {
  const result = check({ k: "tracker.reachable" }, { result: "unreachable", why: "network down" });

  expect(result).toEqual({ ok: true, answer: { result: "unreachable", why: "network down" } });
});

test("check rejects an unreachable answer missing why", () => {
  const result = check({ k: "tracker.reachable" }, { result: "unreachable" });

  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.why).toContain("why");
});

test("check rejects a reachable answer whose result is neither ok nor unreachable", () => {
  const result = check({ k: "tracker.reachable" }, { result: "nope" });

  expect(result.ok).toBe(false);
});

// ───── tracker.candidates
//
// "list ready, unstarted, unclaimed tickets (in this milestone)"

test("check accepts a well-formed candidates answer", () => {
  const raw = { result: "ok", tickets: [ticket({ id: "T-9" })] };
  const result = check({ k: "tracker.candidates", milestone: "m1" }, raw);

  expect(result).toEqual({ ok: true, answer: { result: "ok", tickets: [ticket({ id: "T-9" })] } });
});

test("check rejects a candidates answer whose ticket is missing id", () => {
  const { id, ...noId } = ticket();
  const result = check({ k: "tracker.candidates", milestone: null }, { result: "ok", tickets: [noId] });

  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.why).toContain("id");
});

test("check rejects a candidates answer whose tickets field is not an array", () => {
  const result = check({ k: "tracker.candidates", milestone: null }, { result: "ok", tickets: "nope" });

  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.why).toContain("tickets");
});

// ───── tracker.read
//
// "give me the full facts + body + comments for one ticket"

test("check accepts a well-formed read answer", () => {
  const raw = { result: "ok", ticket: ticket(), body: "the body", comments: ["hi"] };
  const result = check({ k: "tracker.read", issue: "T-1" }, raw);

  expect(result).toEqual({
    ok: true,
    answer: { result: "ok", ticket: ticket(), body: "the body", comments: ["hi"] },
  });
});

test("check accepts a missing read answer", () => {
  const result = check({ k: "tracker.read", issue: "T-1" }, { result: "missing" });

  expect(result).toEqual({ ok: true, answer: { result: "missing" } });
});

test("check rejects a read answer whose body is not a string", () => {
  const raw = { result: "ok", ticket: ticket(), body: 42, comments: [] };
  const result = check({ k: "tracker.read", issue: "T-1" }, raw);

  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.why).toContain("body");
});

test("check rejects a read answer whose result is neither ok nor missing", () => {
  const result = check({ k: "tracker.read", issue: "T-1" }, { result: "gone" });

  expect(result.ok).toBe(false);
});

// ───── tracker.claim
//
// "claim this ticket for actor"

test("check accepts a well-formed claimed answer", () => {
  const result = check({ k: "tracker.claim", issue: "T-1", actor: "agent-1" }, { result: "claimed" });

  expect(result).toEqual({ ok: true, answer: { result: "claimed" } });
});

test("check accepts a well-formed taken answer and preserves by", () => {
  const result = check(
    { k: "tracker.claim", issue: "T-1", actor: "agent-1" },
    { result: "taken", by: "agent-2" },
  );

  expect(result).toEqual({ ok: true, answer: { result: "taken", by: "agent-2" } });
});

test("check rejects a taken answer missing by", () => {
  const result = check({ k: "tracker.claim", issue: "T-1", actor: "agent-1" }, { result: "taken" });

  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.why).toContain("by");
});

test("check rejects a claim answer whose result is neither claimed nor taken", () => {
  const result = check({ k: "tracker.claim", issue: "T-1", actor: "agent-1" }, { result: "denied" });

  expect(result.ok).toBe(false);
});

// ───── tracker.setState
//
// "move ticket to state" — Park's third step sends a ticket back to unstarted.

test("check accepts a well-formed setState answer", () => {
  const result = check({ k: "tracker.setState", issue: "T-1", state: "parked" }, { result: "ok" });

  expect(result).toEqual({ ok: true, answer: { result: "ok" } });
});

test("check rejects a setState answer whose result is not ok", () => {
  const result = check({ k: "tracker.setState", issue: "T-1", state: "parked" }, { result: "done" });

  expect(result.ok).toBe(false);
});

test("check rejects a setState answer that is not an object", () => {
  expect(check({ k: "tracker.setState", issue: "T-1", state: "started" }, "ok").ok).toBe(false);
});

// ───── tracker.unclaim
//
// "release the claim; ticket re-enters the pool"

test("check accepts a well-formed unclaim answer", () => {
  const result = check({ k: "tracker.unclaim", issue: "T-1" }, { result: "ok" });

  expect(result).toEqual({ ok: true, answer: { result: "ok" } });
});

test("check rejects an unclaim answer whose result is not ok", () => {
  const result = check({ k: "tracker.unclaim", issue: "T-1" }, { result: "released" });

  expect(result.ok).toBe(false);
});

test("check rejects an unclaim answer that is not an object", () => {
  expect(check({ k: "tracker.unclaim", issue: "T-1" }, null).ok).toBe(false);
});

// ───── tracker.comment
//
// "append this comment"

test("check accepts a well-formed comment answer", () => {
  const result = check({ k: "tracker.comment", issue: "T-1", text: "note" }, { result: "ok" });

  expect(result).toEqual({ ok: true, answer: { result: "ok" } });
});

test("check rejects a comment answer whose result is not ok", () => {
  const result = check({ k: "tracker.comment", issue: "T-1", text: "note" }, { result: "posted" });

  expect(result.ok).toBe(false);
});

test("check rejects a comment answer that is not an object", () => {
  expect(check({ k: "tracker.comment", issue: "T-1", text: "note" }, "ok").ok).toBe(false);
});

// ───── tracker.milestones
//
// "list milestones in stable order"

test("check accepts a well-formed milestones answer", () => {
  const result = check({ k: "tracker.milestones" }, { result: "ok", milestones: ["m1", "m2"] });

  expect(result).toEqual({ ok: true, answer: { result: "ok", milestones: ["m1", "m2"] } });
});

test("check rejects a milestones answer whose milestones field is not a string array", () => {
  const result = check({ k: "tracker.milestones" }, { result: "ok", milestones: [1, 2] });

  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.why).toContain("milestones");
});

test("check rejects a milestones answer whose result is not ok", () => {
  const result = check({ k: "tracker.milestones" }, { result: "nope" });

  expect(result.ok).toBe(false);
});

// ───── tracker.verify
//
// "what is this ticket's current state right now?"

test("check accepts a well-formed verify answer", () => {
  const raw = { result: "ok", state: "started", claimedBy: "agent-1" };
  const result = check({ k: "tracker.verify", issue: "T-1" }, raw);

  expect(result).toEqual({ ok: true, answer: { result: "ok", state: "started", claimedBy: "agent-1" } });
});

test("check accepts a missing verify answer", () => {
  const result = check({ k: "tracker.verify", issue: "T-1" }, { result: "missing" });

  expect(result).toEqual({ ok: true, answer: { result: "missing" } });
});

test("check rejects a verify answer whose state is not a valid IssueState", () => {
  const raw = { result: "ok", state: "in-progress", claimedBy: null };
  const result = check({ k: "tracker.verify", issue: "T-1" }, raw);

  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.why).toContain("state");
});

test("check rejects a verify answer whose result is neither ok nor missing", () => {
  const result = check({ k: "tracker.verify", issue: "T-1" }, { result: "deleted" });

  expect(result.ok).toBe(false);
});
