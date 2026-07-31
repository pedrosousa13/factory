/**
 * L2 conformance sweep — reachable, verify, and slice 2's and slice 3's asks.
 *
 * For each harness (claude, codex, pi): reset the local markdown tracker
 * fixture (the committed default three plus a fourth ticket, T-4, blocked by
 * an invisible id T-9 — see EXTRA_TICKETS below), then ask Factory's tracker
 * asks against it — reachable, verify T-1, candidates, read T-1, read T-9
 * (the invisible blocker), claim T-1, setState started, unclaim — using one
 * shared prompt template (question + phrasebook + answer shape + "reply with
 * ONLY that JSON"), no per-harness prompt tweaks. Answers are validated with
 * `check()` from runtime/src/tracker.ts; one re-ask on a malformed or thrown
 * reply. The invisible-blocker fail-safe (T-4 stays blocked once its blocker
 * T-9 reads back missing) is asserted with the pure pick functions from
 * runtime/src/pick.ts, not a further harness call. Claim/setState/unclaim are
 * verified against the fixture's own file, not trusted from the ask reply.
 *
 * Then, slice 3's agent.implement asks against a fresh scratch code repo
 * (runtime/conformance/coderepo.ts) each: CLEAR_BRIEF, expecting a "done"
 * reply whose WORK is verified on the branch the brief told the agent to
 * commit on (file content, `bun check.ts`'s exit, the commit itself) rather
 * than trusted from the reply; VAGUE_BRIEF on a fresh repo, expecting the
 * question variant with a non-empty question. Answers are validated with
 * `checkAgent()` from runtime/src/agentwork.ts, one re-ask on a malformed or
 * thrown reply (a local mirror of askloop.ts's askWithRetry, since that one is
 * typed for the tracker's Ask union and doesn't fit agent.implement). Each
 * scratch repo is removed on every path, success or failure.
 *
 * Prints an honest per-harness scoreboard and exits non-zero if any harness
 * fails any check.
 *
 * bun sweep.ts
 *
 * THROWAWAY: no tests, no error handling beyond what keeps it runnable.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Answer, TicketFacts } from "../src/tracker";
import { askWithRetry, buildPrompt, extractJson, type AskStatus, type Runner } from "../src/askloop";
import { runHarness, type HarnessName } from "../src/harness";
import { applyInvariants, foldReads, resolveBlocking, type ReadResult } from "../src/pick";
import { checkAgent, type AgentAsk, type ImplementResult } from "../src/agentwork";
import { CLEAR_BRIEF, VAGUE_BRIEF, implementPrompt, mkCodeRepo, rmCodeRepo } from "./coderepo";
import {
  CANDIDATES_SHAPE,
  CANDIDATES_QUESTION,
  CLAIM_SHAPE,
  claimQuestion,
  down,
  EXTRA_TICKETS,
  READ_SHAPE,
  readFixtureField,
  readQuestion,
  SET_STATE_SHAPE,
  startedQuestion,
  TICKETS_DIR,
  UNCLAIM_SHAPE,
  unclaimQuestion,
  up,
} from "./fixture";

// ─────────────────────────────────────────────────── agent.implement asking
//
// askWithRetry (askloop.ts) is typed for the tracker's Ask union and validates
// with tracker.ts's check() — agent.implement isn't a tracker Ask, so it
// doesn't fit. This is a local mirror of the exact same one-ask/one-reask
// logic, retyped for AgentAsk and validated with agentwork.ts's checkAgent
// instead. askloop.ts itself is untouched (out of scope for this task).

type ImplementOutcome =
  | { status: "valid-first-try" | "valid-after-reask"; answer: ImplementResult }
  | { status: "failed"; whys: [string, string] };

function askImplementOnce(
  runner: Runner,
  ask: Extract<AgentAsk, { k: "agent.implement" }>,
  prompt: string,
): { ok: true; answer: ImplementResult } | { ok: false; why: string } {
  let raw: string;
  try {
    raw = runner(prompt).raw;
  } catch (e) {
    return { ok: false, why: `harness threw: ${(e as Error).message}` };
  }
  const parsed = extractJson(raw);
  if (parsed === null) return { ok: false, why: "could not extract JSON from response" };
  const checked = checkAgent(ask, parsed);
  if (!checked.ok) return { ok: false, why: checked.why };
  return { ok: true, answer: checked.answer as ImplementResult };
}

function askImplementWithRetry(
  runner: Runner,
  ask: Extract<AgentAsk, { k: "agent.implement" }>,
  prompt: string,
): ImplementOutcome {
  const r1 = askImplementOnce(runner, ask, prompt);
  if (r1.ok) return { status: "valid-first-try", answer: r1.answer };

  const reaskPrompt = `${prompt}\n\nYour previous reply was invalid: ${r1.why}\nReply again with ONLY the corrected JSON, no prose.`;
  const r2 = askImplementOnce(runner, ask, reaskPrompt);
  if (r2.ok) return { status: "valid-after-reask", answer: r2.answer };

  return { status: "failed", whys: [r1.why, r2.why] };
}

// ─────────────────────────────────────────────────────────── git (coderepo)

const CLEAR_BRIEF_BRANCH = "42-test/greeting"; // per coderepo.ts's CLEAR_BRIEF text

function gitOut(args: string[], cwd: string): { stdout: string; exit: number } {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  return { stdout: proc.stdout.toString(), exit: proc.exitCode };
}

/** Verifies the WORK, not the word: switches to the branch CLEAR_BRIEF told the
 * agent to commit on, then checks greet.ts's content, `bun check.ts`'s exit,
 * and the commit's presence on that branch — never trusting the "done" reply. */
function verifyClearBriefWork(root: string): { workOk: boolean; note: string } {
  const switchRes = gitOut(["switch", CLEAR_BRIEF_BRANCH], root);
  if (switchRes.exit !== 0) return { workOk: false, note: `branch ${CLEAR_BRIEF_BRANCH} not found` };

  const greetOk = readFileSync(join(root, "greet.ts"), "utf8").includes("Hi, ");
  const checkExit = Bun.spawnSync(["bun", "check.ts"], {
    cwd: root,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  }).exitCode;
  const checkOk = checkExit === 0;
  const log = gitOut(["log", "--oneline", "-10"], root).stdout;
  const commitOk = log.includes("Change greeting to Hi");

  const workOk = greetOk && checkOk && commitOk;
  return { workOk, note: workOk ? "verified" : `greet=${greetOk} check=${checkOk} commit=${commitOk}` };
}

const DIR = import.meta.dir;
const PHRASEBOOK_PATH = join(DIR, "phrasebook.md");

// ───────────────────────────────────────────────────────────────── prompt

const REACHABLE_SHAPE = `type ReachableAnswer = { result: "ok" } | { result: "unreachable"; why: string };`;

const VERIFY_SHAPE = `type VerifyAnswer =
  | { result: "ok"; state: "unstarted" | "started" | "parked" | "done" | "canceled"; claimedBy: string | null }
  | { result: "missing" };`;

// ───────────────────────────────────────────────────────────────── per-harness

type HarnessRecord = {
  harness: HarnessName;
  reachable: AskStatus;
  reachableOk: boolean; // answer.result === "ok"
  verify: AskStatus;
  verifyOk: boolean; // answer.result === "ok" && state === "unstarted" && claimedBy === null
  candidates: AskStatus;
  candidatesOk: boolean; // exactly {T-1,T-2,T-3,T-4} came back
  readT1: AskStatus;
  readT1Ok: boolean; // answer.result === "ok" && body is non-empty
  readT9: AskStatus;
  readT9Ok: boolean; // answer.result === "missing" (T-9 has no file)
  failSafeOk: boolean; // pure check: T-9 was needsRead and T-4 stays blocked after it reads missing
  claim: AskStatus;
  claimOk: boolean; // answer.result === "claimed"
  claimFileOk: boolean; // T-1.md claimedBy === actor
  setState: AskStatus;
  setStateOk: boolean; // answer.result === "ok"
  setStateFileOk: boolean; // T-1.md state === "started"
  unclaim: AskStatus;
  unclaimOk: boolean; // answer.result === "ok"
  unclaimFileOk: boolean; // T-1.md claimedBy === null
  implementDone: AskStatus;
  implementDoneOk: boolean; // answer.result === "done"
  workVerifiedOk: boolean; // greet.ts + bun check.ts + commit, all on CLEAR_BRIEF_BRANCH
  implementQuestion: AskStatus;
  implementQuestionOk: boolean; // answer.result === "question" && question non-empty
  reasks: number;
  totalMs: number;
  pass: boolean;
};

function runOne(harness: HarnessName, phrasebook: string): HarnessRecord {
  console.log(`\n=== ${harness} ===`);
  up(EXTRA_TICKETS);
  if (!existsSync(join(TICKETS_DIR, "T-1.md"))) {
    throw new Error(`fixture reset did not produce ${join(TICKETS_DIR, "T-1.md")}`);
  }

  const runner: Runner = (prompt) => runHarness(harness, prompt, DIR);

  // ── reachable
  const reachableQuestion = "Can this project's tracker be reached right now?";
  const reachablePrompt = buildPrompt(reachableQuestion, phrasebook, REACHABLE_SHAPE);
  const reachableStart = performance.now();
  const reachableLog = askWithRetry(runner, { k: "tracker.reachable" }, reachablePrompt);
  const reachableMs = Math.round(performance.now() - reachableStart);
  const reachableOk = reachableLog.status !== "failed" && reachableLog.answer.result === "ok";
  console.log(
    `  reachable: ${reachableLog.status}${reachableLog.status === "failed" ? ` — ${reachableLog.whys[1]}` : ""} (expected ok: ${reachableOk ? "yes" : "no"})`,
  );

  // ── verify T-1
  const verifyQuestion = "What is the current state of ticket T-1 in this project's tracker?";
  const verifyPrompt = buildPrompt(verifyQuestion, phrasebook, VERIFY_SHAPE);
  const verifyStart = performance.now();
  const verifyLog = askWithRetry(runner, { k: "tracker.verify", issue: "T-1" }, verifyPrompt);
  const verifyMs = Math.round(performance.now() - verifyStart);
  const verifyAnswer: Answer["tracker.verify"] | undefined =
    verifyLog.status !== "failed" ? verifyLog.answer : undefined;
  const verifyOk =
    verifyLog.status !== "failed" &&
    verifyAnswer?.result === "ok" &&
    verifyAnswer.state === "unstarted" &&
    verifyAnswer.claimedBy === null;
  console.log(
    `  verify T-1: ${verifyLog.status}${verifyLog.status === "failed" ? ` — ${verifyLog.whys[1]}` : ""} (expected ok/unstarted/null: ${verifyOk ? "yes" : "no"})`,
  );

  // ── candidates
  const candidatesPrompt = buildPrompt(CANDIDATES_QUESTION, phrasebook, CANDIDATES_SHAPE);
  const candidatesStart = performance.now();
  const candidatesLog = askWithRetry(runner, { k: "tracker.candidates", milestone: null }, candidatesPrompt);
  const candidatesMs = Math.round(performance.now() - candidatesStart);
  const candidates: TicketFacts[] = candidatesLog.status !== "failed" ? candidatesLog.answer.tickets : [];
  const candidateIds = candidates.map((t) => t.id).sort();
  const expectedIds = ["T-1", "T-2", "T-3", "T-4"];
  const candidatesOk =
    candidatesLog.status !== "failed" &&
    candidateIds.length === expectedIds.length &&
    expectedIds.every((id) => candidateIds.includes(id));
  console.log(
    `  candidates: ${candidatesLog.status}${candidatesLog.status === "failed" ? ` — ${candidatesLog.whys[1]}` : ""} (expected T-1..T-4, 4 tickets: ${candidatesOk ? "yes" : "no"}; got ${candidateIds.join(",") || "none"})`,
  );

  // ── read T-1 (body present)
  const readT1Prompt = buildPrompt(readQuestion("T-1"), phrasebook, READ_SHAPE);
  const readT1Start = performance.now();
  const readT1Log = askWithRetry(runner, { k: "tracker.read", issue: "T-1" }, readT1Prompt);
  const readT1Ms = Math.round(performance.now() - readT1Start);
  const readT1Ok =
    readT1Log.status !== "failed" && readT1Log.answer.result === "ok" && readT1Log.answer.body.trim().length > 0;
  console.log(
    `  read T-1: ${readT1Log.status}${readT1Log.status === "failed" ? ` — ${readT1Log.whys[1]}` : ""} (expected ok + body: ${readT1Ok ? "yes" : "no"})`,
  );

  // ── read T-9 (the invisible blocker — expected missing)
  const readT9Prompt = buildPrompt(readQuestion("T-9"), phrasebook, READ_SHAPE);
  const readT9Start = performance.now();
  const readT9Log = askWithRetry(runner, { k: "tracker.read", issue: "T-9" }, readT9Prompt);
  const readT9Ms = Math.round(performance.now() - readT9Start);
  const readT9Ok = readT9Log.status !== "failed" && readT9Log.answer.result === "missing";
  console.log(
    `  read T-9: ${readT9Log.status}${readT9Log.status === "failed" ? ` — ${readT9Log.whys[1]}` : ""} (expected missing: ${readT9Ok ? "yes" : "no"})`,
  );

  // ── fail-safe: T-9 (invisible blocker) reads missing, so T-4 stays blocked
  // (pure check via src/pick.ts — no further harness call beyond the T-9 read above)
  const { eligible } = applyInvariants({ candidates, milestone: null });
  const { unblocked: mechanicallyUnblocked, needsRead } = resolveBlocking(eligible, candidates);
  const stillBlocked = eligible.filter((t) => !mechanicallyUnblocked.some((u) => u.id === t.id));
  const reads: ReadResult[] =
    readT9Log.status !== "failed" && readT9Log.answer.result === "ok"
      ? [{ id: "T-9", state: readT9Log.answer.ticket.state }]
      : [];
  const { unblocked: foldedUnblocked } = foldReads(stillBlocked, reads);
  const finalUnblocked = [...mechanicallyUnblocked, ...foldedUnblocked];
  const failSafeOk = needsRead.includes("T-9") && !finalUnblocked.some((t) => t.id === "T-4");
  console.log(`  fail-safe: T-4 stays blocked: ${failSafeOk ? "yes" : "no"}`);

  // ── claim T-1 for actor parity-<harness>, verified against the fixture file
  const actor = `parity-${harness}`;
  const claimPrompt = buildPrompt(claimQuestion("T-1", actor), phrasebook, CLAIM_SHAPE);
  const claimStart = performance.now();
  const claimLog = askWithRetry(runner, { k: "tracker.claim", issue: "T-1", actor }, claimPrompt);
  const claimMs = Math.round(performance.now() - claimStart);
  const claimOk = claimLog.status !== "failed" && claimLog.answer.result === "claimed";
  const claimedByFile = readFixtureField("T-1", "claimedBy");
  const claimFileOk = claimedByFile === actor;
  console.log(
    `  claim T-1: ${claimLog.status}${claimLog.status === "failed" ? ` — ${claimLog.whys[1]}` : ""} (expected claimed: ${claimOk ? "yes" : "no"}; file claimedBy=${claimedByFile})`,
  );

  // ── setState started, verified against the fixture file
  const startedPrompt = buildPrompt(startedQuestion("T-1"), phrasebook, SET_STATE_SHAPE);
  const startedStart = performance.now();
  const startedLog = askWithRetry(runner, { k: "tracker.setState", issue: "T-1", state: "started" }, startedPrompt);
  const startedMs = Math.round(performance.now() - startedStart);
  const setStateOk = startedLog.status !== "failed" && startedLog.answer.result === "ok";
  const stateFile = readFixtureField("T-1", "state");
  const setStateFileOk = stateFile === "started";
  console.log(
    `  setState started: ${startedLog.status}${startedLog.status === "failed" ? ` — ${startedLog.whys[1]}` : ""} (expected ok: ${setStateOk ? "yes" : "no"}; file state=${stateFile})`,
  );

  // ── unclaim, verified against the fixture file
  const unclaimPrompt = buildPrompt(unclaimQuestion("T-1"), phrasebook, UNCLAIM_SHAPE);
  const unclaimStart = performance.now();
  const unclaimLog = askWithRetry(runner, { k: "tracker.unclaim", issue: "T-1" }, unclaimPrompt);
  const unclaimMs = Math.round(performance.now() - unclaimStart);
  const unclaimOk = unclaimLog.status !== "failed" && unclaimLog.answer.result === "ok";
  const claimedByAfterFile = readFixtureField("T-1", "claimedBy");
  const unclaimFileOk = claimedByAfterFile === null;
  console.log(
    `  unclaim T-1: ${unclaimLog.status}${unclaimLog.status === "failed" ? ` — ${unclaimLog.whys[1]}` : ""} (expected ok: ${unclaimOk ? "yes" : "no"}; file claimedBy=${claimedByAfterFile})`,
  );

  // ── slice 3: agent.implement — CLEAR_BRIEF on a fresh scratch code repo,
  // done + work verified against the branch the brief told the agent to
  // commit on (not trusted from the "done" reply)
  const clearRepo = mkCodeRepo();
  let clearLog: ImplementOutcome;
  let workVerifiedOk = false;
  const clearStart = performance.now();
  try {
    const clearRunner: Runner = (prompt) => runHarness(harness, prompt, clearRepo.root);
    const implementAsk: Extract<AgentAsk, { k: "agent.implement" }> = {
      k: "agent.implement",
      issue: "42-test",
      branch: CLEAR_BRIEF_BRANCH,
      brief: CLEAR_BRIEF,
    };
    clearLog = askImplementWithRetry(clearRunner, implementAsk, implementPrompt(CLEAR_BRIEF));
    if (clearLog.status !== "failed" && clearLog.answer.result === "done") {
      workVerifiedOk = verifyClearBriefWork(clearRepo.root).workOk;
    }
  } finally {
    rmCodeRepo(clearRepo.root);
  }
  const clearMs = Math.round(performance.now() - clearStart);
  const implementDoneOk = clearLog.status !== "failed" && clearLog.answer.result === "done";
  console.log(
    `  implement CLEAR_BRIEF: ${clearLog.status}${clearLog.status === "failed" ? ` — ${clearLog.whys[1]}` : ""} (expected done: ${implementDoneOk ? "yes" : "no"}; work verified: ${workVerifiedOk ? "yes" : "no"})`,
  );

  // ── slice 3: agent.implement — VAGUE_BRIEF on a fresh scratch code repo,
  // question variant with a non-empty question
  const vagueRepo = mkCodeRepo();
  let vagueLog: ImplementOutcome;
  const vagueStart = performance.now();
  try {
    const vagueRunner: Runner = (prompt) => runHarness(harness, prompt, vagueRepo.root);
    const vagueAsk: Extract<AgentAsk, { k: "agent.implement" }> = {
      k: "agent.implement",
      issue: "42-test-vague",
      branch: CLEAR_BRIEF_BRANCH,
      brief: VAGUE_BRIEF,
    };
    vagueLog = askImplementWithRetry(vagueRunner, vagueAsk, implementPrompt(VAGUE_BRIEF));
  } finally {
    rmCodeRepo(vagueRepo.root);
  }
  const vagueMs = Math.round(performance.now() - vagueStart);
  const implementQuestionOk =
    vagueLog.status !== "failed" &&
    vagueLog.answer.result === "question" &&
    vagueLog.answer.question.trim().length > 0;
  console.log(
    `  implement VAGUE_BRIEF: ${vagueLog.status}${vagueLog.status === "failed" ? ` — ${vagueLog.whys[1]}` : ""} (expected question: ${implementQuestionOk ? "yes" : "no"})`,
  );

  const asks = [reachableLog, verifyLog, candidatesLog, readT1Log, readT9Log, claimLog, startedLog, unclaimLog];
  const reasks =
    asks.filter((l) => l.status === "valid-after-reask").length +
    [clearLog, vagueLog].filter((l) => l.status === "valid-after-reask").length;
  const totalMs =
    reachableMs +
    verifyMs +
    candidatesMs +
    readT1Ms +
    readT9Ms +
    claimMs +
    startedMs +
    unclaimMs +
    clearMs +
    vagueMs;

  const pass =
    reachableOk &&
    verifyOk &&
    candidatesOk &&
    readT1Ok &&
    readT9Ok &&
    failSafeOk &&
    claimOk &&
    claimFileOk &&
    setStateOk &&
    setStateFileOk &&
    unclaimOk &&
    unclaimFileOk &&
    implementDoneOk &&
    workVerifiedOk &&
    implementQuestionOk;

  return {
    harness,
    reachable: reachableLog.status,
    reachableOk,
    verify: verifyLog.status,
    verifyOk,
    candidates: candidatesLog.status,
    candidatesOk,
    readT1: readT1Log.status,
    readT1Ok,
    readT9: readT9Log.status,
    readT9Ok,
    failSafeOk,
    claim: claimLog.status,
    claimOk,
    claimFileOk,
    setState: startedLog.status,
    setStateOk,
    setStateFileOk,
    unclaim: unclaimLog.status,
    unclaimOk,
    unclaimFileOk,
    implementDone: clearLog.status,
    implementDoneOk,
    workVerifiedOk,
    implementQuestion: vagueLog.status,
    implementQuestionOk,
    reasks,
    totalMs,
    pass,
  };
}

// ────────────────────────────────────────────────────────────────── report

function printTable(records: HarnessRecord[]): void {
  const cols = [
    "harness",
    "reachable",
    "ok?",
    "verify T-1",
    "ok?",
    "candidates",
    "ok?",
    "read T-1",
    "ok?",
    "read T-9",
    "ok?",
    "fail-safe T-4",
    "ok?",
    "claim",
    "ok?",
    "file?",
    "setState",
    "ok?",
    "file?",
    "unclaim",
    "ok?",
    "file?",
    "implement-done",
    "ok?",
    "work?",
    "implement-question",
    "ok?",
    "re-asks",
    "total s",
    "pass",
  ];
  const rows = records.map((r) => [
    r.harness,
    r.reachable,
    r.reachableOk ? "yes" : "no",
    r.verify,
    r.verifyOk ? "yes" : "no",
    r.candidates,
    r.candidatesOk ? "yes" : "no",
    r.readT1,
    r.readT1Ok ? "yes" : "no",
    r.readT9,
    r.readT9Ok ? "yes" : "no",
    "checked",
    r.failSafeOk ? "yes" : "no",
    r.claim,
    r.claimOk ? "yes" : "no",
    r.claimFileOk ? "yes" : "no",
    r.setState,
    r.setStateOk ? "yes" : "no",
    r.setStateFileOk ? "yes" : "no",
    r.unclaim,
    r.unclaimOk ? "yes" : "no",
    r.unclaimFileOk ? "yes" : "no",
    r.implementDone,
    r.implementDoneOk ? "yes" : "no",
    r.workVerifiedOk ? "yes" : "no",
    r.implementQuestion,
    r.implementQuestionOk ? "yes" : "no",
    String(r.reasks),
    (r.totalMs / 1000).toFixed(1),
    r.pass ? "PASS" : "FAIL",
  ]);
  const widths = cols.map((c, i) => Math.max(c.length, ...rows.map((row) => row[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log("\n=== scoreboard ===");
  console.log(line(cols));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(line(row));
}

// ──────────────────────────────────────────────────────────────────── main

function main(): void {
  const phrasebook = readFileSync(PHRASEBOOK_PATH, "utf8");
  const harnesses: HarnessName[] = ["claude", "codex", "pi"];
  const records = harnesses.map((h) => runOne(h, phrasebook));
  down();
  printTable(records);
  const allPass = records.every((r) => r.pass);
  if (!allPass) process.exit(1);
}

main();
