import { test, expect } from "bun:test";
import { waitDecision, interactiveAnswer, stopMessage } from "../src/answerwait";
import type { Ask } from "../src/tracker";
import type { AskOutcome } from "../src/askloop";

// Timestamps are ISO 8601 strings, the form journal.ts stores, so the
// journaled askedAt feeds waitDecision unconverted. A 15-minute window from
// 10:00:00Z puts the deadline at 10:15:00Z.
const askedAt = "2026-08-01T10:00:00.000Z";
const windowMinutes = 15;
const deadline = "2026-08-01T10:15:00.000Z";
const beforeDeadline = "2026-08-01T10:08:00.000Z";
const pastDeadline = "2026-08-01T10:16:00.000Z";
const beforeAsked = "2026-08-01T09:52:00.000Z";

// ───── waitDecision (headless)

test("waitDecision: an answer present before the deadline continues", () => {
  const result = waitDecision({ askedAt, now: beforeDeadline, windowMinutes, answered: "yes" });
  expect(result).toEqual({ k: "continue", answer: "yes" });
});

test("waitDecision: no answer before the deadline keeps waiting", () => {
  const result = waitDecision({ askedAt, now: beforeDeadline, windowMinutes, answered: null });
  expect(result).toEqual({ k: "keep-waiting" });
});

// Boundary choice: `now` measured against the deadline with >=, so the poll
// landing exactly on the deadline with no answer parks rather than getting
// one more grace tick — the window is "answer must land inside", not "up to
// and including one extra moment past".
test("waitDecision: no answer at exactly the deadline parks", () => {
  const result = waitDecision({ askedAt, now: deadline, windowMinutes, answered: null });
  expect(result).toEqual({ k: "park" });
});

test("waitDecision: an answer present at or past the deadline still continues, never parks", () => {
  const atDeadline = waitDecision({ askedAt, now: deadline, windowMinutes, answered: "late" });
  expect(atDeadline).toEqual({ k: "continue", answer: "late" });

  const afterDeadline = waitDecision({ askedAt, now: pastDeadline, windowMinutes, answered: "later" });
  expect(afterDeadline).toEqual({ k: "continue", answer: "later" });
});

test("waitDecision: a now earlier than askedAt (clock jumped backwards) does not park early", () => {
  const result = waitDecision({ askedAt, now: beforeAsked, windowMinutes, answered: null });
  expect(result).toEqual({ k: "keep-waiting" });
});

// ───── interactiveAnswer

test("interactiveAnswer: returns the answer directly without consulting the clock at all", () => {
  const result = interactiveAnswer("live answer");
  expect(result).toEqual({ k: "continue", answer: "live answer" });
});

// ───── stopMessage

const failedAsk: Ask = { k: "tracker.claim", issue: "FACT-43", actor: "worker-1" };
const failedOutcome: Extract<AskOutcome<"tracker.claim">, { status: "failed" }> = {
  status: "failed",
  whys: ["first reply was not valid JSON", "second reply had result: nonsense"],
};

test("stopMessage: names the failed ask, both whys, and the outstanding claim", () => {
  const message = stopMessage(failedAsk, failedOutcome, "claim still held on FACT-43 by worker-1");
  expect(message).toContain("tracker.claim");
  expect(message).toContain("FACT-43");
  expect(message).toContain("first reply was not valid JSON");
  expect(message).toContain("second reply had result: nonsense");
  expect(message).toContain("claim still held on FACT-43 by worker-1");
});

test("stopMessage: no outstanding state reads as none rather than a blank", () => {
  const message = stopMessage(failedAsk, failedOutcome, null);
  expect(message.toLowerCase()).toContain("no outstanding state");
});

// The window is measured from the journaled askedAt, so a run that crashed and
// restarted resumes the same window instead of being granted a fresh one.
test("waitDecision: a restart mid-window inherits the original deadline, not a new one", () => {
  const justInside = waitDecision({ askedAt, now: "2026-08-01T10:14:59.000Z", windowMinutes, answered: null });
  expect(justInside).toEqual({ k: "keep-waiting" });

  const justOutside = waitDecision({ askedAt, now: "2026-08-01T10:15:01.000Z", windowMinutes, answered: null });
  expect(justOutside).toEqual({ k: "park" });
});

// An unmeasurable window must not hang the run. The question is already
// durable on the ticket, so parking loses nothing; waiting forever would.
test("waitDecision: an unparseable timestamp parks rather than waiting forever", () => {
  expect(waitDecision({ askedAt: "not a date", now: deadline, windowMinutes, answered: null })).toEqual({ k: "park" });
  expect(waitDecision({ askedAt, now: "garbage", windowMinutes, answered: null })).toEqual({ k: "park" });
});

test("waitDecision: an answer wins even when the timestamps are unparseable", () => {
  const result = waitDecision({ askedAt: "not a date", now: "also not", windowMinutes, answered: "yes" });
  expect(result).toEqual({ k: "continue", answer: "yes" });
});
