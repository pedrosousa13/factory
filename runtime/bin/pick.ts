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
} from "../conformance/fixture";
import { detectActor } from "../src/edges";
import { runHarness, type HarnessName } from "../src/harness";
import { askWithRetry, buildPrompt, type AskStatus, type Runner } from "../src/askloop";
import { applyInvariants, branchName, foldReads, pick, resolveBlocking, type ReadResult } from "../src/pick";

const DIR = import.meta.dir;
const PHRASEBOOK_PATH = join(DIR, "../conformance/phrasebook.md");

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
  const candidatesPrompt = buildPrompt(CANDIDATES_QUESTION, phrasebook, CANDIDATES_SHAPE);
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
    const readPrompt = buildPrompt(readQuestion(id), phrasebook, READ_SHAPE);
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
  const claimPrompt = buildPrompt(claimQuestion(picked.id, actor), phrasebook, CLAIM_SHAPE);
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
  const startedPrompt = buildPrompt(startedQuestion(picked.id), phrasebook, SET_STATE_SHAPE);
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

  // ── unclaim + reset to unstarted (fixture reset hygiene). The unclaim is a
  // real ask against the contract; the state rewind is a direct fixture patch
  // (fs), not a further ask, because rewinding this host's own setup is not a
  // capability under test here. (tracker.setState does accept "unstarted" now
  // — slice 4 added it for Park — but using it here would prove nothing.)
  const unclaimPrompt = buildPrompt(unclaimQuestion(picked.id), phrasebook, UNCLAIM_SHAPE);
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
