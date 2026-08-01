#!/usr/bin/env bun
// Edge entry (bun, fs + git allowed): the implement host loop, slice 3's
// capability end to end against a scratch code repo — dispatch a clear
// brief to a live harness, verify the WORK it claims to have done (not the
// word), run the landing gates, fold the merge decision into a real squash
// merge, then dispatch a vague brief on a fresh repo to prove the question
// variant. Prints an honest per-step scoreboard and exits non-zero on any
// failure. rmCodeRepo runs on every path, success or failure.
//
// Each agent.* dispatch below is exactly one top-level headless harness run
// with cwd = the scratch repo (workers work in their own repo) — no re-ask
// loop here: a parse or validation failure counts as failed/fail outright
// (PRD §2), recorded honestly rather than retried away.
//
// bun implement.ts claude|codex|pi
//
// THROWAWAY: no tests, no error handling beyond what keeps it runnable.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runHarness, type HarnessName } from "../src/harness";
import { extractJson } from "../src/askloop";
import {
  checkAgent,
  foldGates,
  gatePlan,
  mergeDecision,
  type AgentAsk,
  type CheckResult,
  type GateKind,
  type ImplementResult,
} from "../src/agentwork";
import {
  CLEAR_BRIEF,
  CLEAR_BRIEF_BRANCH,
  CLEAR_BRIEF_COMMIT,
  CLEAR_BRIEF_MARKER,
  VAGUE_BRIEF,
  implementPrompt,
  mkCodeRepo,
  rmCodeRepo,
} from "../conformance/coderepo";
const REVIEW_STANDARDS_BRIEF =
  "Review the diff of the last commit in this repo against ordinary TypeScript standards: " +
  "does it keep the change minimal, leave no debug leftovers, and keep greet.ts and check.ts consistent? " +
  "Reply with ONLY the pass/fail JSON.";
const REVIEW_SPEC_BRIEF =
  "Review the diff of the last commit in this repo for: does it match the brief " +
  "'edit greet.ts so greet returns \"Hi, \" + name instead of \"Hello, \" + name'? " +
  "Reply with ONLY the pass/fail JSON.";
const CHECK_SHAPE = `type CheckResult = { result: "pass" } | { result: "fail"; detail: string };`;

function checkPrompt(brief: string): string {
  return [brief, "", CHECK_SHAPE, "", "Reply with ONLY that JSON, no prose."].join("\n");
}

// ───────────────────────────────────────────────────────────────────── git

function git(args: string[], cwd: string): { stdout: string; exit: number } {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  return { stdout: proc.stdout.toString(), exit: proc.exitCode };
}

function runCheckTs(cwd: string): number {
  const proc = Bun.spawnSync(["bun", "check.ts"], { cwd, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  return proc.exitCode;
}

/** "" when the agent left no greet.ts — a failed check, never a thrown error. */
function readGreet(cwd: string): string {
  try {
    return readFileSync(join(cwd, "greet.ts"), "utf8");
  } catch {
    return "";
  }
}

// ──────────────────────────────────────────────────────────── agent dispatch
//
// One top-level headless harness run each, validated with checkAgent. A
// parse failure (no JSON found) or a checkAgent rejection (unknown tag,
// missing field, wrong type) is not distinguished from a real "failed"/"fail"
// answer — the caller only ever sees the closed variant, never a thrown error.

function dispatchImplement(
  harness: HarnessName,
  cwd: string,
  brief: string,
  ask: Extract<AgentAsk, { k: "agent.implement" }>,
): ImplementResult {
  let raw: string;
  try {
    raw = runHarness(harness, implementPrompt(brief), cwd).raw;
  } catch (e) {
    return { result: "failed", reason: `harness threw: ${(e as Error).message}` };
  }
  const parsed = extractJson(raw);
  if (parsed === null) return { result: "failed", reason: "could not extract JSON from response" };
  const checked = checkAgent(ask, parsed);
  if (!checked.ok) return { result: "failed", reason: checked.why };
  return checked.answer as ImplementResult;
}

function dispatchCheck(
  harness: HarnessName,
  cwd: string,
  brief: string,
  ask: Extract<AgentAsk, { k: "agent.check" }>,
): CheckResult {
  let raw: string;
  try {
    raw = runHarness(harness, checkPrompt(brief), cwd).raw;
  } catch (e) {
    return { result: "fail", detail: `harness threw: ${(e as Error).message}` };
  }
  const parsed = extractJson(raw);
  if (parsed === null) return { result: "fail", detail: "could not extract JSON from response" };
  const checked = checkAgent(ask, parsed);
  if (!checked.ok) return { result: "fail", detail: checked.why };
  return checked.answer as CheckResult;
}

// ───────────────────────────────────────────────────────────────── scoreboard

type Step = { name: string; status: string; ok: boolean; note?: string };

function step(name: string, status: string, ok: boolean, note?: string): Step {
  return { name, status, ok, note };
}

function printSteps(steps: Step[]): void {
  const cols = ["step", "status", "ok?", "note"];
  const rows = steps.map((s) => [s.name, s.status, s.ok ? "yes" : "no", s.note ?? ""]);
  const widths = cols.map((c, i) => Math.max(c.length, ...rows.map((row) => row[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log("\n=== scoreboard ===");
  console.log(line(cols));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(line(row));
}

// ───────────────────────────────────────────────────────────────── argv

function parseHarness(argv: string[]): HarnessName {
  const name = argv[2];
  if (name === "claude" || name === "codex" || name === "pi") return name;
  console.error("usage: bun implement.ts claude|codex|pi");
  process.exit(1);
}

// ──────────────────────────────────────────────────────────────────── main

function main(): void {
  const harness = parseHarness(process.argv);
  const steps: Step[] = [];
  let clearRoot: string | undefined;
  let vagueRoot: string | undefined;

  console.log(`\n=== ${harness} ===`);

  try {
    // ── 1: scratch repo + dispatch CLEAR_BRIEF (harness cwd = the scratch repo)
    clearRoot = mkCodeRepo().root;
    const mainHeadBefore = git(["rev-parse", "main"], clearRoot).stdout.trim();

    const implementAsk: Extract<AgentAsk, { k: "agent.implement" }> = {
      k: "agent.implement",
      issue: "42-test",
      branch: CLEAR_BRIEF_BRANCH,
      brief: CLEAR_BRIEF,
    };
    const implementResult = dispatchImplement(harness, clearRoot, CLEAR_BRIEF, implementAsk);
    steps.push(
      step(
        "agent.implement CLEAR_BRIEF",
        implementResult.result,
        implementResult.result === "done",
        implementResult.result === "question"
          ? implementResult.question
          : implementResult.result === "failed"
            ? implementResult.reason
            : undefined,
      ),
    );

    // ── 3: verify the WORK, not the word
    let workVerified = false;
    if (implementResult.result === "done") {
      // An agent can claim "done" and leave no greet.ts behind — the very
      // claim this step exists to disbelieve. An uncaught ENOENT here would
      // kill the process before the scoreboard prints, losing every step
      // already recorded, so a missing file is a failed check, not a crash.
      const greetOk = readGreet(clearRoot).includes(CLEAR_BRIEF_MARKER);
      const checkOk = runCheckTs(clearRoot) === 0;
      const log = git(["log", "--oneline", "-10"], clearRoot).stdout;
      const commitOk = log.includes(CLEAR_BRIEF_COMMIT);
      workVerified = greetOk && checkOk && commitOk;

      steps.push(
        step("verify greet.ts", greetOk ? `contains '${CLEAR_BRIEF_MARKER}'` : `missing '${CLEAR_BRIEF_MARKER}'`, greetOk),
      );
      steps.push(step("verify bun check.ts", checkOk ? "exit 0" : "nonzero exit", checkOk));
      steps.push(step("verify git log", commitOk ? "commit found" : "commit missing", commitOk, log.trim().split("\n")[0]));
      steps.push(
        step("done-status", workVerified ? "done-verified" : "done-but-work-unverified", workVerified),
      );
    }

    // ── 4 + 5: gates and merge, only meaningful once the work is verified
    if (implementResult.result === "done" && workVerified) {
      // The scratch repo has `bun check.ts` and no typecheck command, so the
      // plan is tests + both reviews. Every planned gate is dispatched below
      // and the plan is compared against what actually ran — a gate that is
      // printed but skipped would otherwise read as a gate that passed.
      const gates = gatePlan({ tests: true, typecheck: false });
      const outcomes: { kind: GateKind; result: CheckResult }[] = [];

      const testsExit = runCheckTs(clearRoot);
      const testsResult: CheckResult =
        testsExit === 0 ? { result: "pass" } : { result: "fail", detail: `bun check.ts exit ${testsExit}` };
      outcomes.push({ kind: "tests", result: testsResult });
      steps.push(
        step("gate: tests", testsResult.result, testsResult.result === "pass", "same command as verify bun check.ts"),
      );

      for (const [kind, brief] of [
        ["review.standards", REVIEW_STANDARDS_BRIEF],
        ["review.spec", REVIEW_SPEC_BRIEF],
      ] as const) {
        const checkAsk: Extract<AgentAsk, { k: "agent.check" }> = { k: "agent.check", kind, command: brief };
        const reviewResult = dispatchCheck(harness, clearRoot, brief, checkAsk);
        outcomes.push({ kind, result: reviewResult });
        steps.push(
          step(
            `gate: ${kind}`,
            reviewResult.result,
            reviewResult.result === "pass",
            reviewResult.result === "fail" ? reviewResult.detail : undefined,
          ),
        );
      }

      const ran = outcomes.map((o) => o.kind);
      const planMatched = gates.join(",") === ran.join(",");
      steps.push(
        step(
          "gatePlan",
          planMatched ? "every planned gate ran" : "plan and dispatches diverged",
          planMatched,
          `planned ${gates.join(", ")}; ran ${ran.join(", ")}`,
        ),
      );

      const folded = foldGates(outcomes);
      steps.push(
        step(
          "foldGates",
          folded.k,
          folded.k === "pass",
          folded.k === "fail" ? folded.failures.map((f) => `${f.kind}: ${f.detail}`).join("; ") : undefined,
        ),
      );

      if (folded.k === "pass") {
        const decision = mergeDecision("squash", undefined, null);
        steps.push(
          step("mergeDecision", decision.k, decision.k === "merge", decision.k === "merge" ? decision.method : undefined),
        );

        if (decision.k === "merge") {
          git(["switch", "main"], clearRoot);
          git(["merge", "--squash", CLEAR_BRIEF_BRANCH], clearRoot);
          const commitRes = git(["commit", "-m", CLEAR_BRIEF_COMMIT], clearRoot);
          const mainHeadAfter = git(["rev-parse", "main"], clearRoot).stdout.trim();
          const greetOnMain = readGreet(clearRoot).includes(CLEAR_BRIEF_MARKER);
          const mergeOk = commitRes.exit === 0 && mainHeadAfter !== mainHeadBefore && greetOnMain;
          steps.push(
            step(
              "merge: squash to main",
              mergeOk ? "main updated" : "merge failed",
              mergeOk,
              `before=${mainHeadBefore.slice(0, 7)} after=${mainHeadAfter.slice(0, 7)}`,
            ),
          );
        }
      } else {
        steps.push(step("merge", "skipped", false, "gates failed"));
      }
    } else {
      steps.push(step("gates + merge", "skipped", false, "implement result was not done-verified"));
    }

    // ── 6: VAGUE_BRIEF on a fresh scratch repo → expect the question variant
    vagueRoot = mkCodeRepo().root;
    const vagueAsk: Extract<AgentAsk, { k: "agent.implement" }> = {
      k: "agent.implement",
      issue: "42-test-vague",
      branch: CLEAR_BRIEF_BRANCH,
      brief: VAGUE_BRIEF,
    };
    const vagueResult = dispatchImplement(harness, vagueRoot, VAGUE_BRIEF, vagueAsk);
    steps.push(
      step(
        "agent.implement VAGUE_BRIEF",
        vagueResult.result,
        vagueResult.result === "question",
        vagueResult.result === "question"
          ? vagueResult.question
          : vagueResult.result === "failed"
            ? vagueResult.reason
            : undefined,
      ),
    );

    // ── 7: honest scoreboard
    printSteps(steps);
    const allOk = steps.every((s) => s.ok);
    console.log(`\noverall: ${allOk ? "PASS" : "FAIL"}`);
    if (!allOk) process.exitCode = 1;
  } finally {
    if (clearRoot) rmCodeRepo(clearRoot);
    if (vagueRoot) rmCodeRepo(vagueRoot);
  }
}

main();
