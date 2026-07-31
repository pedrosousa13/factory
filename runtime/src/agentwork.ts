// Pure agent-work module: the agent.* ask/result vocabulary (PRD §2 "The
// judgment line"), the checker that validates an agent's raw answer against
// the closed variant union, the landing-gate plan and fold, and the merge
// decision (PRD §3 merge policy/method). No fs, no process, no I/O.

import type { MergeMethod, MergePolicy } from "./config";

// ───── the agent-work ask vocabulary

export type GateKind = "tests" | "typecheck" | "review.standards" | "review.spec";

export type AgentAsk =
  | { k: "agent.implement"; issue: string; branch: string; brief: string }
  | { k: "agent.check"; kind: GateKind; command: string };

// ───── the answer shapes

export type ImplementResult =
  | { result: "done" }
  | { result: "question"; question: string }
  | { result: "failed"; reason: string };

export type CheckResult = { result: "pass" } | { result: "fail"; detail: string };

/** Ask kind → the answer shape it expects. */
export type AgentAnswer = {
  "agent.implement": ImplementResult;
  "agent.check": CheckResult;
};

// ───── checkAgent

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function isNonEmptyStr(x: unknown): x is string {
  return typeof x === "string" && x.length > 0;
}

function bad(why: string): { ok: false; why: string } {
  return { ok: false, why };
}

/**
 * Structural validation only, exactly like tracker.ts's `check`: unknown
 * result tags, missing fields, and wrong types are rejected with a
 * path-naming why; extra fields are ignored. This function never decides
 * what a validation failure means to the caller — PRD §2's dispatch rule
 * ("any parse or validation failure counts as failed") is the caller's job.
 */
export function checkAgent(
  ask: AgentAsk,
  raw: unknown,
): { ok: true; answer: AgentAnswer[AgentAsk["k"]] } | { ok: false; why: string } {
  if (!isObj(raw)) return bad("raw: not an object");
  const result = raw.result;
  const ok = (answer: AgentAnswer[AgentAsk["k"]]) => ({ ok: true as const, answer });

  switch (ask.k) {
    case "agent.implement":
      if (result === "done") return ok({ result: "done" });
      if (result === "question") {
        if (!isNonEmptyStr(raw.question)) return bad("question: not a non-empty string");
        return ok({ result: "question", question: raw.question });
      }
      if (result === "failed") {
        if (!isNonEmptyStr(raw.reason)) return bad("reason: not a non-empty string");
        return ok({ result: "failed", reason: raw.reason });
      }
      return bad(`result: ${JSON.stringify(result)} is not done|question|failed`);

    case "agent.check":
      if (result === "pass") return ok({ result: "pass" });
      if (result === "fail") {
        if (!isNonEmptyStr(raw.detail)) return bad("detail: not a non-empty string");
        return ok({ result: "fail", detail: raw.detail });
      }
      return bad(`result: ${JSON.stringify(result)} is not pass|fail`);
  }
}

// ───── gatePlan

/**
 * The ordered gates for a run: tests and typecheck only when the capability
 * exists, review.standards and review.spec always, in this fixed order.
 */
export function gatePlan(caps: { tests: boolean; typecheck: boolean }): GateKind[] {
  const gates: GateKind[] = [];
  if (caps.tests) gates.push("tests");
  if (caps.typecheck) gates.push("typecheck");
  gates.push("review.standards", "review.spec");
  return gates;
}

// ───── foldGates

/** Collects ALL gate failures — never stops at the first. */
export function foldGates(
  outcomes: { kind: GateKind; result: CheckResult }[],
): { k: "pass" } | { k: "fail"; failures: { kind: GateKind; detail: string }[] } {
  const failures: { kind: GateKind; detail: string }[] = [];
  for (const outcome of outcomes) {
    if (outcome.result.result === "fail") {
      failures.push({ kind: outcome.kind, detail: outcome.result.detail });
    }
  }
  if (failures.length > 0) return { k: "fail", failures };
  return { k: "pass" };
}

// ───── mergeDecision

export type MergeDecision =
  | { k: "merge"; method: MergeMethod }
  | { k: "await-human" }
  | { k: "declined" };

/**
 * Merge policy and merge method are separate settings (PRD §3): the policy
 * says whether the runtime may merge at all, the method says how. Under the
 * "human" policy, approval gates the merge and a missing method defaults to
 * "squash". Under any auto policy, the policy value itself IS a method
 * preference — "squash"/"merge"/"rebase" name both a policy and a method —
 * so an explicit method overrides it, and absent both the policy supplies
 * the method directly. The "squash" default above is never reached on this
 * branch, because an auto policy can never be absent a method to fall back
 * on: the policy already is one.
 */
export function mergeDecision(
  policy: MergePolicy,
  method: MergeMethod | undefined,
  approval: "approved" | "declined" | null,
): MergeDecision {
  if (policy === "human") {
    if (approval === null) return { k: "await-human" };
    if (approval === "declined") return { k: "declined" };
    return { k: "merge", method: method ?? "squash" };
  }
  return { k: "merge", method: method ?? policy };
}
