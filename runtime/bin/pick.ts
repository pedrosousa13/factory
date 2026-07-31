#!/usr/bin/env bun
// Edge entry (bun, fs + git allowed): the pick host loop, slice 2's
// capability end to end against the local markdown tracker fixture and
// phrasebook — reset fixture, detect actor, ask candidates, apply the pure
// invariants/blocking/pick from src/pick.ts, resolve any needsRead blockers,
// pick, print the deterministic branch name, then claim/setState/unclaim
// through the same tracker asks, verifying each act against the fixture's
// own files. Prints an honest per-step scoreboard and exits non-zero on any
// failure.
//
// bun pick.ts claude|codex|pi
//
// THROWAWAY: no tests, no error handling beyond what keeps it runnable.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { down, TICKETS_DIR, up, type Ticket } from "../conformance/fixture";
import { detectActor } from "../src/edges";
import { runHarness, type HarnessName } from "../src/harness";
import { askWithRetry, buildPrompt, type AskStatus, type Runner } from "../src/askloop";
import { applyInvariants, branchName, foldReads, pick, resolveBlocking, type ReadResult } from "../src/pick";
import type { TicketFacts } from "../src/tracker";

const DIR = import.meta.dir;
const PHRASEBOOK_PATH = join(DIR, "../conformance/phrasebook.md");

// ───── the fourth fixture ticket (this bin's own setup, per task-4 brief):
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

// ───────────────────────────────────────────────────────────────── prompt shapes

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

// Direct fixture patch (fs, not a tracker ask) — see the reset-hygiene note
// where this is called.
function resetFixtureState(id: string, state: string): void {
  const path = join(TICKETS_DIR, `${id}.md`);
  const text = readFileSync(path, "utf8");
  writeFileSync(path, text.replace(/^state: .*$/m, `state: ${state}`));
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
  console.error("usage: bun pick.ts claude|codex|pi");
  process.exit(1);
}

// ──────────────────────────────────────────────────────────────────── main

function main(): void {
  const harness = parseHarness(process.argv);
  const phrasebook = readFileSync(PHRASEBOOK_PATH, "utf8");
  const runner: Runner = (prompt) => runHarness(harness, prompt, DIR);

  const steps: Step[] = [];
  // A function declaration, not a const arrow: TS only treats a call to a
  // never-returning function as terminating control flow (narrowing away the
  // checked-out branch afterward) for hoisted function declarations, not for
  // a never-typed value assigned to a const.
  function fail(): never {
    down();
    printSteps(steps);
    process.exit(1);
  }

  console.log(`\n=== ${harness} ===`);

  up(EXTRA_TICKETS);

  const actorResult = detectActor(process.cwd());
  if ("error" in actorResult) {
    steps.push(step("detectActor", "error", false, actorResult.error));
    fail();
  }
  const actor = actorResult.actor;
  steps.push(step("detectActor", actorResult.source, true, actor));

  // ── candidates
  const candidatesQuestion =
    "List every ticket in this project's tracker that is ready, unstarted, and unclaimed, with full facts for each. There is no milestone scope in play right now — list tickets from every milestone.";
  const candidatesPrompt = buildPrompt(candidatesQuestion, phrasebook, CANDIDATES_SHAPE);
  const candidatesOutcome = askWithRetry(runner, { k: "tracker.candidates", milestone: null }, candidatesPrompt);
  if (candidatesOutcome.status === "failed") {
    steps.push(step("tracker.candidates", "failed", false, candidatesOutcome.whys[1]));
    fail();
  }
  const candidates = candidatesOutcome.answer.tickets;
  steps.push(
    step("tracker.candidates", candidatesOutcome.status, true, `${candidates.length} tickets returned`),
  );

  // ── mechanical invariants + blocker resolution (pure, src/pick.ts)
  const { eligible } = applyInvariants({ candidates, milestone: null });
  const { unblocked: mechanicallyUnblocked, needsRead } = resolveBlocking(eligible, candidates);
  const stillBlocked = eligible.filter((t) => !mechanicallyUnblocked.some((u) => u.id === t.id));

  // ── resolve each needsRead id with a tracker.read ask
  const reads: ReadResult[] = [];
  for (const id of needsRead) {
    const readQuestion = `Give me the full facts, body, and comments for ticket ${id} in this project's tracker.`;
    const readPrompt = buildPrompt(readQuestion, phrasebook, READ_SHAPE);
    const readOutcome = askWithRetry(runner, { k: "tracker.read", issue: id }, readPrompt);
    if (readOutcome.status === "failed") {
      steps.push(step(`tracker.read ${id}`, "failed", false, readOutcome.whys[1]));
      fail();
    }
    const answer = readOutcome.answer;
    if (answer.result === "ok") {
      reads.push({ id, state: answer.ticket.state });
      steps.push(step(`tracker.read ${id}`, readOutcome.status, true, `found, state=${answer.ticket.state}`));
    } else {
      steps.push(step(`tracker.read ${id}`, readOutcome.status, true, "missing, as expected"));
    }
  }

  const { unblocked: foldedUnblocked, stillBlocked: foldedStillBlocked } = foldReads(stillBlocked, reads);
  const finalUnblocked = [...mechanicallyUnblocked, ...foldedUnblocked];

  const t4Blocked =
    foldedStillBlocked.some((t) => t.id === "T-4") && !finalUnblocked.some((t) => t.id === "T-4");
  steps.push(step("fail-safe: T-4 stays blocked", "checked", t4Blocked, `stillBlocked=${foldedStillBlocked.map((t) => t.id).join(",")}`));

  // ── pick
  const picked = pick(finalUnblocked);
  const pickOk = picked !== null && picked.id === "T-1";
  steps.push(step("pick", pickOk ? "ok" : "unexpected", pickOk, picked ? `picked ${picked.id}` : "picked null"));
  if (!pickOk || picked === null) fail();

  // ── branch name (printed only — no git branch created against the fixture)
  const branch = branchName(picked.id, picked.title);
  console.log(`branch: ${branch}`);
  steps.push(step("branchName", "printed", true, branch));

  // ── claim
  const claimQuestion = `Claim ticket ${picked.id} in this project's tracker for actor "${actor}".`;
  const claimPrompt = buildPrompt(claimQuestion, phrasebook, CLAIM_SHAPE);
  const claimOutcome = askWithRetry(runner, { k: "tracker.claim", issue: picked.id, actor }, claimPrompt);
  if (claimOutcome.status === "failed") {
    steps.push(step("tracker.claim", "failed", false, claimOutcome.whys[1]));
    fail();
  }
  const claimAnswer = claimOutcome.answer;
  const claimOk = claimAnswer.result === "claimed";
  steps.push(
    step(
      "tracker.claim",
      claimOutcome.status,
      claimOk,
      claimAnswer.result === "taken" ? `taken by ${claimAnswer.by}` : undefined,
    ),
  );
  if (!claimOk) fail();

  const claimedByFile = readFixtureField(picked.id, "claimedBy");
  const claimVerified = claimedByFile === actor;
  steps.push(step("verify file: claimedBy", claimVerified ? "match" : "mismatch", claimVerified, `file says claimedBy=${claimedByFile}`));
  if (!claimVerified) fail();

  // ── setState started
  const startedQuestion = `Set ticket ${picked.id}'s state to "started" in this project's tracker.`;
  const startedPrompt = buildPrompt(startedQuestion, phrasebook, SET_STATE_SHAPE);
  const startedOutcome = askWithRetry(
    runner,
    { k: "tracker.setState", issue: picked.id, state: "started" },
    startedPrompt,
  );
  if (startedOutcome.status === "failed") {
    steps.push(step("tracker.setState started", "failed", false, startedOutcome.whys[1]));
    fail();
  }
  steps.push(step("tracker.setState started", startedOutcome.status, true));

  const startedFile = readFixtureField(picked.id, "state");
  const startedVerified = startedFile === "started";
  steps.push(step("verify file: state=started", startedVerified ? "match" : "mismatch", startedVerified, `file says state=${startedFile}`));
  if (!startedVerified) fail();

  // ── unclaim + reset to unstarted (fixture reset hygiene). tracker.setState's
  // ask vocabulary only targets started|parked|done|canceled — "unstarted" is
  // a ticket's initial state, not a setState destination — so the unclaim is
  // a real ask against the contract, and the state rewind is a direct fixture
  // patch (fs), not a further ask.
  const unclaimQuestion = `Release the claim on ticket ${picked.id} in this project's tracker.`;
  const unclaimPrompt = buildPrompt(unclaimQuestion, phrasebook, UNCLAIM_SHAPE);
  const unclaimOutcome = askWithRetry(runner, { k: "tracker.unclaim", issue: picked.id }, unclaimPrompt);
  if (unclaimOutcome.status === "failed") {
    steps.push(step("tracker.unclaim", "failed", false, unclaimOutcome.whys[1]));
    fail();
  }
  steps.push(step("tracker.unclaim", unclaimOutcome.status, true));

  resetFixtureState(picked.id, "unstarted");

  const resetClaimedBy = readFixtureField(picked.id, "claimedBy");
  const resetState = readFixtureField(picked.id, "state");
  const resetVerified = resetClaimedBy === null && resetState === "unstarted";
  steps.push(
    step(
      "verify file: reset",
      resetVerified ? "match" : "mismatch",
      resetVerified,
      `file says claimedBy=${resetClaimedBy}, state=${resetState}`,
    ),
  );

  down();
  printSteps(steps);

  const allOk = steps.every((s) => s.ok);
  const reasks = steps.filter((s): s is Step & { status: AskStatus } => s.status === "valid-after-reask").length;
  console.log(`\n${reasks} re-ask(s); overall: ${allOk ? "PASS" : "FAIL"}`);
  if (!allOk) process.exit(1);
}

main();
