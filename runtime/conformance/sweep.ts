/**
 * L2 conformance sweep — reachable, verify, and slice 2's asks.
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
import { askWithRetry, buildPrompt, type AskStatus, type Runner } from "../src/askloop";
import { runHarness, type HarnessName } from "../src/harness";
import { applyInvariants, foldReads, resolveBlocking, type ReadResult } from "../src/pick";
import { down, TICKETS_DIR, up, type Ticket } from "./fixture";

const DIR = import.meta.dir;
const PHRASEBOOK_PATH = join(DIR, "phrasebook.md");

// ───── the fourth fixture ticket (same shape as bin/pick.ts's own setup):
// blocked by an invisible id (no file for T-9) so the needsRead / fail-safe
// path runs live — a read on T-9 answers "missing", and per the fail-safe
// rule an unresolved blocker keeps the ticket blocked.
const EXTRA_TICKETS: Ticket[] = [
  {
    id: "T-4",
    title: "Blocked-by-invisible-ticket fixture",
    state: "unstarted",
    urgency: "P0",
    createdAt: "2026-07-15T10:00:00Z",
    milestone: null,
    ready: true,
    claimedBy: null,
    blockedBy: ["T-9"],
    body: "Fixture ticket: blocked by an invisible id (T-9, no file) — forces the needsRead / fail-safe path live.",
  },
];

// ───────────────────────────────────────────────────────────────── prompt

const REACHABLE_SHAPE = `type ReachableAnswer = { result: "ok" } | { result: "unreachable"; why: string };`;

const VERIFY_SHAPE = `type VerifyAnswer =
  | { result: "ok"; state: "unstarted" | "started" | "parked" | "done" | "canceled"; claimedBy: string | null }
  | { result: "missing" };`;

const TICKET_FACTS_SHAPE = `type TicketFacts = {
  id: string;
  title: string;
  urgency: "P0" | "P1" | "P2" | "P3" | "none";
  createdAt: string; // ISO 8601
  milestone: string | null;
  ready: boolean;
  state: "unstarted" | "started" | "parked" | "done" | "canceled";
  claimedBy: string | null;
  blockedBy: string[]; // ids of still-open tickets blocking this one
};`;

const CANDIDATES_SHAPE = `${TICKET_FACTS_SHAPE}
type CandidatesAnswer = { result: "ok"; tickets: TicketFacts[] };`;

const READ_SHAPE = `${TICKET_FACTS_SHAPE}
type ReadAnswer =
  | { result: "ok"; ticket: TicketFacts; body: string; comments: string[] }
  | { result: "missing" };`;

const CLAIM_SHAPE = `type ClaimAnswer = { result: "claimed" } | { result: "taken"; by: string };`;

const SET_STATE_SHAPE = `type SetStateAnswer = { result: "ok" };`;

const UNCLAIM_SHAPE = `type UnclaimAnswer = { result: "ok" };`;

// ───────────────────────────────────────────────────────────────── fixture reads

// "Verify file" per the brief: read the fixture's own frontmatter directly
// off disk, rather than trusting another harness ask — the ground truth for
// what an act actually did.
function readFixtureField(id: string, field: "claimedBy" | "state"): string | null {
  const text = readFileSync(join(TICKETS_DIR, `${id}.md`), "utf8");
  const match = text.match(new RegExp(`^${field}: (.*)$`, "m"));
  if (!match) throw new Error(`fixture file for ${id} has no ${field} field`);
  return match[1] === "null" ? null : match[1];
}

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
  const candidatesQuestion =
    "List every ticket in this project's tracker that is ready, unstarted, and unclaimed, with full facts for each. There is no milestone scope in play right now — list tickets from every milestone.";
  const candidatesPrompt = buildPrompt(candidatesQuestion, phrasebook, CANDIDATES_SHAPE);
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
  const readT1Question = "Give me the full facts, body, and comments for ticket T-1 in this project's tracker.";
  const readT1Prompt = buildPrompt(readT1Question, phrasebook, READ_SHAPE);
  const readT1Start = performance.now();
  const readT1Log = askWithRetry(runner, { k: "tracker.read", issue: "T-1" }, readT1Prompt);
  const readT1Ms = Math.round(performance.now() - readT1Start);
  const readT1Ok =
    readT1Log.status !== "failed" && readT1Log.answer.result === "ok" && readT1Log.answer.body.trim().length > 0;
  console.log(
    `  read T-1: ${readT1Log.status}${readT1Log.status === "failed" ? ` — ${readT1Log.whys[1]}` : ""} (expected ok + body: ${readT1Ok ? "yes" : "no"})`,
  );

  // ── read T-9 (the invisible blocker — expected missing)
  const readT9Question = "Give me the full facts, body, and comments for ticket T-9 in this project's tracker.";
  const readT9Prompt = buildPrompt(readT9Question, phrasebook, READ_SHAPE);
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
  const claimQuestion = `Claim ticket T-1 in this project's tracker for actor "${actor}".`;
  const claimPrompt = buildPrompt(claimQuestion, phrasebook, CLAIM_SHAPE);
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
  const startedQuestion = `Set ticket T-1's state to "started" in this project's tracker.`;
  const startedPrompt = buildPrompt(startedQuestion, phrasebook, SET_STATE_SHAPE);
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
  const unclaimQuestion = `Release the claim on ticket T-1 in this project's tracker.`;
  const unclaimPrompt = buildPrompt(unclaimQuestion, phrasebook, UNCLAIM_SHAPE);
  const unclaimStart = performance.now();
  const unclaimLog = askWithRetry(runner, { k: "tracker.unclaim", issue: "T-1" }, unclaimPrompt);
  const unclaimMs = Math.round(performance.now() - unclaimStart);
  const unclaimOk = unclaimLog.status !== "failed" && unclaimLog.answer.result === "ok";
  const claimedByAfterFile = readFixtureField("T-1", "claimedBy");
  const unclaimFileOk = claimedByAfterFile === null;
  console.log(
    `  unclaim T-1: ${unclaimLog.status}${unclaimLog.status === "failed" ? ` — ${unclaimLog.whys[1]}` : ""} (expected ok: ${unclaimOk ? "yes" : "no"}; file claimedBy=${claimedByAfterFile})`,
  );

  const asks = [reachableLog, verifyLog, candidatesLog, readT1Log, readT9Log, claimLog, startedLog, unclaimLog];
  const reasks = asks.filter((l) => l.status === "valid-after-reask").length;
  const totalMs = reachableMs + verifyMs + candidatesMs + readT1Ms + readT9Ms + claimMs + startedMs + unclaimMs;

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
    unclaimFileOk;

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
