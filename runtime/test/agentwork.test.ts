import { test, expect } from "bun:test";
import { checkAgent, gatePlan, foldGates, mergeDecision } from "../src/agentwork";
import type { AgentAsk, CheckResult } from "../src/agentwork";

// ───── fixtures

const implementAsk: AgentAsk = {
  k: "agent.implement",
  issue: "42",
  branch: "slice/42-implement-gates-merge",
  brief: "implement task 1",
};

const checkAsk: AgentAsk = {
  k: "agent.check",
  kind: "tests",
  command: "bun test runtime/",
};

// ───── checkAgent: agent.implement variants validate

test("agent.implement: done validates", () => {
  const result = checkAgent(implementAsk, { result: "done" });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.answer).toEqual({ result: "done" });
  }
});

test("agent.implement: question validates with the question text", () => {
  const result = checkAgent(implementAsk, { result: "question", question: "which flag?" });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.answer).toEqual({ result: "question", question: "which flag?" });
  }
});

test("agent.implement: failed validates with the reason text", () => {
  const result = checkAgent(implementAsk, { result: "failed", reason: "cannot find file" });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.answer).toEqual({ result: "failed", reason: "cannot find file" });
  }
});

test("agent.implement: extra fields are ignored", () => {
  const result = checkAgent(implementAsk, { result: "done", extra: "ignored" });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.answer).toEqual({ result: "done" });
  }
});

// ───── checkAgent: agent.implement garbled variants rejected

test("agent.implement: unknown result tag is rejected", () => {
  const result = checkAgent(implementAsk, { result: "maybe" });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.why).toContain("result");
    expect(result.why).toContain("done|question|failed");
  }
});

test("agent.implement: question missing its question field is rejected", () => {
  const result = checkAgent(implementAsk, { result: "question" });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.why).toContain("question");
  }
});

test("agent.implement: empty question string is rejected", () => {
  const result = checkAgent(implementAsk, { result: "question", question: "" });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.why).toContain("question");
  }
});

test("agent.implement: non-string reason is rejected", () => {
  const result = checkAgent(implementAsk, { result: "failed", reason: 123 });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.why).toContain("reason");
  }
});

test("agent.implement: prose instead of an object is rejected", () => {
  const result = checkAgent(implementAsk, "the agent is done implementing");

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.why).toContain("not an object");
  }
});

// ───── checkAgent: agent.check pass/fail variants

test("agent.check: pass validates", () => {
  const result = checkAgent(checkAsk, { result: "pass" });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.answer).toEqual({ result: "pass" });
  }
});

test("agent.check: fail validates with the detail text", () => {
  const result = checkAgent(checkAsk, { result: "fail", detail: "2 tests failed" });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.answer).toEqual({ result: "fail", detail: "2 tests failed" });
  }
});

test("agent.check: unknown result tag is rejected", () => {
  const result = checkAgent(checkAsk, { result: "ok" });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.why).toContain("pass|fail");
  }
});

test("agent.check: empty detail string is rejected", () => {
  const result = checkAgent(checkAsk, { result: "fail", detail: "" });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.why).toContain("detail");
  }
});

// ───── gatePlan: capability combinations

test("gatePlan: both capabilities present includes all four gates in order", () => {
  expect(gatePlan({ tests: true, typecheck: true })).toEqual([
    "tests",
    "typecheck",
    "review.standards",
    "review.spec",
  ]);
});

test("gatePlan: neither capability present still runs both reviews", () => {
  expect(gatePlan({ tests: false, typecheck: false })).toEqual([
    "review.standards",
    "review.spec",
  ]);
});

test("gatePlan: tests only", () => {
  expect(gatePlan({ tests: true, typecheck: false })).toEqual([
    "tests",
    "review.standards",
    "review.spec",
  ]);
});

test("gatePlan: typecheck only", () => {
  expect(gatePlan({ tests: false, typecheck: true })).toEqual([
    "typecheck",
    "review.standards",
    "review.spec",
  ]);
});

// ───── foldGates: collects ALL failures

test("foldGates: all passing gates fold to pass", () => {
  const outcomes: { kind: "tests" | "typecheck"; result: CheckResult }[] = [
    { kind: "tests", result: { result: "pass" } },
    { kind: "typecheck", result: { result: "pass" } },
  ];

  expect(foldGates(outcomes)).toEqual({ k: "pass" });
});

test("foldGates: a single failure is reported", () => {
  const outcomes = [
    { kind: "tests" as const, result: { result: "pass" } as CheckResult },
    { kind: "typecheck" as const, result: { result: "fail", detail: "TS2322" } as CheckResult },
  ];

  expect(foldGates(outcomes)).toEqual({
    k: "fail",
    failures: [{ kind: "typecheck", detail: "TS2322" }],
  });
});

test("foldGates: multiple failures are all collected, not just the first", () => {
  const outcomes = [
    { kind: "tests" as const, result: { result: "fail", detail: "3 failing" } as CheckResult },
    { kind: "typecheck" as const, result: { result: "fail", detail: "TS2322" } as CheckResult },
    {
      kind: "review.standards" as const,
      result: { result: "fail", detail: "no section dividers" } as CheckResult,
    },
    { kind: "review.spec" as const, result: { result: "pass" } as CheckResult },
  ];

  const result = foldGates(outcomes);

  expect(result).toEqual({
    k: "fail",
    failures: [
      { kind: "tests", detail: "3 failing" },
      { kind: "typecheck", detail: "TS2322" },
      { kind: "review.standards", detail: "no section dividers" },
    ],
  });
});

// ───── mergeDecision: full matrix

test("mergeDecision: human policy with null approval awaits human", () => {
  expect(mergeDecision("human", undefined, null)).toEqual({ k: "await-human" });
});

test("mergeDecision: human policy approved with no method defaults to squash", () => {
  expect(mergeDecision("human", undefined, "approved")).toEqual({
    k: "merge",
    method: "squash",
  });
});

test("mergeDecision: human policy approved with an explicit method uses it", () => {
  expect(mergeDecision("human", "rebase", "approved")).toEqual({
    k: "merge",
    method: "rebase",
  });
});

test("mergeDecision: human policy declined is declined", () => {
  expect(mergeDecision("human", undefined, "declined")).toEqual({ k: "declined" });
});

test("mergeDecision: human policy declined ignores any method", () => {
  expect(mergeDecision("human", "squash", "declined")).toEqual({ k: "declined" });
});

test("mergeDecision: auto policy with no method merges using the policy as the method", () => {
  expect(mergeDecision("squash", undefined, null)).toEqual({ k: "merge", method: "squash" });
});

test("mergeDecision: auto policy with an explicit method uses the method, not the policy", () => {
  expect(mergeDecision("squash", "rebase", null)).toEqual({ k: "merge", method: "rebase" });
});

test("mergeDecision: rebase policy with no method merges by rebase", () => {
  expect(mergeDecision("rebase", undefined, null)).toEqual({ k: "merge", method: "rebase" });
});

test("mergeDecision: merge policy with no method merges by merge", () => {
  expect(mergeDecision("merge", undefined, null)).toEqual({ k: "merge", method: "merge" });
});

test("mergeDecision: auto policy ignores approval entirely", () => {
  expect(mergeDecision("squash", undefined, "declined")).toEqual({
    k: "merge",
    method: "squash",
  });
});
