/**
 * L2 conformance sweep — reachable, verify, and slice 2's, 3's, 4's, and 5's asks.
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
 * `checkAgent()` from runtime/src/agentwork.ts, and — unlike the tracker asks
 * above — each dispatch gets exactly one run, with a malformed or thrown reply
 * counting as failed (PRD §2). Each scratch repo is removed on every path,
 * success or failure.
 *
 * Then, slice 4's asks against the same fixture: a Park comment on T-3,
 * verified by reading its body back rather than trusting the "ok" reply; a
 * setState-to-unstarted on T-2 (patched to "started" first so the file check
 * proves a real transition); a garble case on T-1 — a bare prompt with no
 * answer shape or JSON instruction, gathering live evidence that a bad reply
 * actually gets rejected rather than only ever seeing synthetic bad input in
 * a unit test; and a contention case on T-5, pre-claimed by a different
 * actor (CONTENTION_ACTOR, fixture.ts), asserting a claim attempt comes back
 * `taken` with the right holder and never touches the file.
 *
 * Then, slice 5's own asks — the two named as this slice's L2 proof (PRD:
 * "L2 confirms role resolution and prompt-inlined skill delivery on all
 * three harnesses") plus the openIssues ask both depend on: tracker.openIssues
 * over the whole fixture (including the two planning-artifact tickets, T-6
 * and T-7), verified against the fixture files, not the reply — every open
 * ticket present, and the planning artifacts' labels intact; emptyQueueReport's
 * breakdown under a milestone scope, checked against a count taken directly
 * from the fixture files rather than the agent's own openIssues answer; and
 * prompt-inlined skill delivery — the phrasebook text present, byte-identical,
 * in the actual prompt string handed to the harness. These mirror
 * bin/planning.ts's steps 1, 4, and 6 exactly, reusing OPEN_ISSUES_QUESTION
 * and OPEN_ISSUES_SHAPE from fixture.ts rather than a second copy of either.
 *
 * Then, slice 6's v1-to-v2 migration — a real copy of this repo's own v1
 * stamp (conformance/v1repo.ts's mkV1Repo), migrated end to end: detect v1,
 * plan, apply (config.json plus the adapter doc's adopt-theirs/retrofit
 * offer), then a full preflight against the migrated copy. This is the PRD's
 * L2 proof for the slice — "runs the post-migration preflight per harness" —
 * and it reuses bin/migrate.ts's own shared material (v1repo.ts: the
 * rendered template and the chosen merge-policy/attack-surface answers)
 * rather than a second copy of either. Its trackerReachable fact reuses this
 * same function's own reachable check above rather than a second live ask —
 * the intervening asks only mutate ticket contents, never whether
 * tracker/tickets/ exists, so the earlier answer still holds. Every claim is
 * checked against the migrated copy's own files on disk, never trusted from a
 * plan field.
 *
 * Prints an honest per-harness scoreboard and exits non-zero if any harness
 * fails any check.
 *
 * bun sweep.ts
 *
 * THROWAWAY: no tests, no error handling beyond what keeps it runnable.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Answer, Ask, TicketFacts } from "../src/tracker";
import { askWithRetry, buildPrompt, extractJson, type AskStatus, type Runner } from "../src/askloop";
import { runHarness, type HarnessName } from "../src/harness";
import { applyInvariants, foldReads, resolveBlocking, type ReadResult } from "../src/pick";
import { breakdown, emptyQueueReport } from "../src/queuereport";
import { checkAgent, type AgentAsk, type ImplementResult } from "../src/agentwork";
import { parkCommentText, type ParkReason } from "../src/park";
import { ADAPTER_DOC_PATH, CONFIG_PATH, gatherPreflightFacts, gatherStampFacts } from "../src/edges";
import { pendingSteps, planMigration, renderV1ToV2Config, repoVersionOf } from "../src/migrate";
import { preflight } from "../src/preflight";
import { detectStamp } from "../src/stamp";
import { STAMP_VERSION } from "../src/version";
import {
  CLEAR_BRIEF,
  CLEAR_BRIEF_BRANCH,
  CLEAR_BRIEF_COMMIT,
  CLEAR_BRIEF_MARKER,
  VAGUE_BRIEF,
  implementPrompt,
  mkCodeRepo,
  rmCodeRepo,
} from "./coderepo";
import {
  CHOSEN_ATTACK_SURFACE,
  CHOSEN_MERGE_POLICY,
  mkFullSkillsHome,
  mkV1Repo,
  REACHABLE_SHAPE,
  renderRealLinearAdapterDoc,
  rmSkillsHome,
  rmV1Repo,
  TRACKER_REACHABLE_QUESTION,
} from "./v1repo";
import {
  CANDIDATES_SHAPE,
  CANDIDATES_QUESTION,
  CLAIM_SHAPE,
  claimQuestion,
  commentQuestion,
  COMMENT_SHAPE,
  CONTENTION_ACTOR,
  CONTENTION_TICKETS,
  down,
  EXTRA_TICKETS,
  garblePrompt,
  GARBLE_QUESTION,
  OPEN_ISSUES_QUESTION,
  OPEN_ISSUES_SHAPE,
  READ_SHAPE,
  readFixtureBody,
  readFixtureField,
  readFixtureTicket,
  readQuestion,
  SET_STATE_SHAPE,
  startedQuestion,
  TICKET_FACTS_SHAPE,
  TICKETS_DIR,
  UNCLAIM_SHAPE,
  unclaimQuestion,
  SET_READY_SHAPE,
  dropReadyQuestion,
  unstartedQuestion,
  up,
} from "./fixture";

// Direct fixture patch (fs, not a tracker ask) — same pattern as
// bin/pick.ts's resetFixtureState. Used to put T-2 into "started" before the
// setState-unstarted check, so the ask's own verification proves a real
// transition rather than checking a field that was already "unstarted".
function patchFixtureState(id: string, state: string): void {
  const path = join(TICKETS_DIR, `${id}.md`);
  const text = readFileSync(path, "utf8");
  writeFileSync(path, text.replace(/^state: .*$/m, `state: ${state}`));
}

// ─────────────────────────────────────────────────── agent.implement asking
//
// The one-re-ask rule askWithRetry (askloop.ts) implements belongs to the
// tracker's Ask vocabulary. PRD §2 gives agent.* the opposite rule: each
// dispatch is one top-level headless run, and any parse or validation failure
// counts as failed. bin/implement.ts already dispatches that way. Re-asking
// here would be worse than inconsistent — the brief mutates a repo, so a
// second send lands in a repo the first send already changed, and an agent
// that finds the work done replies "done" for work this run never verified.

type ImplementOutcome =
  | { status: "valid"; answer: ImplementResult }
  | { status: "failed"; why: string };

function askImplementOnce(
  runner: Runner,
  ask: Extract<AgentAsk, { k: "agent.implement" }>,
  prompt: string,
): ImplementOutcome {
  let raw: string;
  try {
    raw = runner(prompt).raw;
  } catch (e) {
    return { status: "failed", why: `harness threw: ${(e as Error).message}` };
  }
  const parsed = extractJson(raw);
  if (parsed === null) return { status: "failed", why: "could not extract JSON from response" };
  const checked = checkAgent(ask, parsed);
  if (!checked.ok) return { status: "failed", why: checked.why };
  return { status: "valid", answer: checked.answer as ImplementResult };
}

// ─────────────────────────────────────────────────────────── git (coderepo)


function gitOut(args: string[], cwd: string): { stdout: string; exit: number } {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  return { stdout: proc.stdout.toString(), exit: proc.exitCode };
}

/** Verifies the WORK, not the word: switches to the branch CLEAR_BRIEF told the
 * agent to commit on, then checks greet.ts's content, `bun check.ts`'s exit,
 * and the commit's presence on that branch — never trusting the "done" reply. */
function verifyClearBriefWork(root: string): { workOk: boolean; note: string } {
  const switchRes = gitOut(["switch", CLEAR_BRIEF_BRANCH], root);
  if (switchRes.exit !== 0) return { workOk: false, note: `git switch ${CLEAR_BRIEF_BRANCH} failed` };

  // An agent can claim "done" and leave no greet.ts (deleted, renamed, wrong
  // branch) — exactly what this sweep exists to catch. An uncaught ENOENT here
  // would kill the process before the scoreboard prints, turning one harness's
  // FAIL into no scoreboard at all.
  let greetOk: boolean;
  try {
    greetOk = readFileSync(join(root, "greet.ts"), "utf8").includes(CLEAR_BRIEF_MARKER);
  } catch {
    return { workOk: false, note: "greet.ts unreadable on the branch" };
  }
  const checkExit = Bun.spawnSync(["bun", "check.ts"], {
    cwd: root,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  }).exitCode;
  const checkOk = checkExit === 0;
  const log = gitOut(["log", "--oneline", "-10"], root).stdout;
  const commitOk = log.includes(CLEAR_BRIEF_COMMIT);

  const workOk = greetOk && checkOk && commitOk;
  return { workOk, note: workOk ? "verified" : `greet=${greetOk} check=${checkOk} commit=${commitOk}` };
}

const DIR = import.meta.dir;
const PHRASEBOOK_PATH = join(DIR, "phrasebook.md");

// ───────────────────────────────────────────────────────────────── prompt

// REACHABLE_SHAPE and its question now live in ./v1repo — bin/migrate.ts's
// own post-migration preflight asks the identical question there, and
// duplicating the shape here would fork what the two hosts test. The slice-6
// block below reuses the one ask this function already makes with it,
// rather than asking again.

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
  implementDone: ImplementOutcome["status"];
  implementDoneOk: boolean; // answer.result === "done"
  workVerifiedOk: boolean; // greet.ts + bun check.ts + commit, all on CLEAR_BRIEF_BRANCH
  implementQuestion: ImplementOutcome["status"];
  implementQuestionOk: boolean; // answer.result === "question" && question non-empty
  comment: AskStatus;
  commentOk: boolean; // answer.result === "ok"
  commentFileOk: boolean; // T-3's body carries the disclaimer, the reason, and the branch
  dropReady: AskStatus;
  dropReadyOk: boolean; // answer.result === "ok"
  dropReadyFileOk: boolean; // T-3.md ready === false — the label actually dropped
  setUnstarted: AskStatus;
  setUnstartedOk: boolean; // answer.result === "ok"
  setUnstartedFileOk: boolean; // T-2.md state === "unstarted" (started beforehand, by direct patch)
  garble: AskStatus;
  garbleRejectedLive: boolean; // status !== "valid-first-try" — live evidence a bad reply was actually rejected
  contention: AskStatus;
  contentionOk: boolean; // answer.result === "taken" && answer.by === CONTENTION_ACTOR
  contentionFileOk: boolean; // T-5.md claimedBy is still CONTENTION_ACTOR, untouched
  openIssues: AskStatus;
  openIssuesOk: boolean; // every open ticket listed, T-6/T-7 present with labels intact
  breakdownOk: boolean; // emptyQueueReport's breakdown matches a count taken directly from the fixture files
  phrasebookInlinedOk: boolean; // the phrasebook text is present, byte-identical, in the actual prompt sent
  // slice 6: v1-to-v2 migration against a real copy of this repo's own v1
  // stamp (conformance/v1repo.ts's mkV1Repo), migrated end to end. The PRD's
  // L2 proof for this slice: "runs the post-migration preflight per harness."
  migrateDetectV1Ok: boolean; // the fixture copy detects as legacy-v1 before migration
  migrateApplyOk: boolean; // config.json + adapter doc marker on disk, detectStamp no longer legacy-v1 — all verified against the fixture's own files
  migrateReachable: AskStatus; // == reachable above — reused, not re-asked (see runOne)
  migrateReachableOk: boolean; // == reachableOk above
  migratePreflightGreenOk: boolean; // full preflight against the migrated copy is green at the current stamp version
  reasks: number;
  totalMs: number;
  pass: boolean;
};

function runOne(harness: HarnessName, phrasebook: string): HarnessRecord {
  console.log(`\n=== ${harness} ===`);
  up([...EXTRA_TICKETS, ...CONTENTION_TICKETS]);
  if (!existsSync(join(TICKETS_DIR, "T-1.md"))) {
    throw new Error(`fixture reset did not produce ${join(TICKETS_DIR, "T-1.md")}`);
  }

  // lastPrompt: the exact prompt string handed to the harness for the most
  // recent ask — captured, not reconstructed, for slice 5's prompt-inlined
  // skill delivery check below (mirrors bin/planning.ts's step 6).
  let lastPrompt = "";
  const runner: Runner = (prompt) => {
    lastPrompt = prompt;
    return runHarness(harness, prompt, DIR);
  };

  // ── reachable
  const reachablePrompt = buildPrompt(TRACKER_REACHABLE_QUESTION, phrasebook, REACHABLE_SHAPE);
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
  // T-6 (slice 5's planning-artifact fixture, EXTRA_TICKETS) is deliberately
  // ready/unstarted/unclaimed, so a compliant answer to CANDIDATES_QUESTION's
  // literal wording includes it — tracker.candidates does not itself know
  // about the planning namespace; only applyInvariants (src/pick.ts) excludes
  // it, and that exclusion is asserted separately, below.
  const expectedIds = ["T-1", "T-2", "T-3", "T-4", "T-6"];
  const candidatesOk =
    candidatesLog.status !== "failed" &&
    candidateIds.length === expectedIds.length &&
    expectedIds.every((id) => candidateIds.includes(id));
  console.log(
    `  candidates: ${candidatesLog.status}${candidatesLog.status === "failed" ? ` — ${candidatesLog.whys[1]}` : ""} (expected T-1..T-4 + T-6, 5 tickets: ${candidatesOk ? "yes" : "no"}; got ${candidateIds.join(",") || "none"})`,
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
  const { eligible } = applyInvariants({ candidates, scope: { k: "everything" } });
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

  // ── slice 4: post a Park comment on T-3, verified by reading the fixture
  // body back — never trusting the "ok" reply
  const parkReason: ParkReason = {
    k: "unanswered-question",
    question: "Should this ticket squash-merge or regular-merge once it's unblocked?",
    askedAt: "2026-08-01T10:00:00.000Z",
  };
  const parkBranchLabel = "T-3/park-comment-conformance-check";
  const commentText = parkCommentText(parkReason, parkBranchLabel, "1 commit pushed, tests unrun");
  const commentPrompt = buildPrompt(commentQuestion("T-3", commentText), phrasebook, COMMENT_SHAPE);
  const commentStart = performance.now();
  const commentLog = askWithRetry(runner, { k: "tracker.comment", issue: "T-3", text: commentText }, commentPrompt);
  const commentMs = Math.round(performance.now() - commentStart);
  const commentOk = commentLog.status !== "failed" && commentLog.answer.result === "ok";
  const commentBody = readFixtureBody("T-3");
  const commentFileOk =
    commentBody.includes("This was generated by AI during triage") &&
    commentBody.includes(parkReason.question) &&
    commentBody.includes(parkBranchLabel);
  console.log(
    `  comment T-3: ${commentLog.status}${commentLog.status === "failed" ? ` — ${commentLog.whys[1]}` : ""} (expected ok: ${commentOk ? "yes" : "no"}; landed in body: ${commentFileOk ? "yes" : "no"})`,
  );

  // ── slice 4: setState unstarted — T-2 is patched to "started" directly
  // first (fixture setup, not an ask) so the file check below proves a real
  // transition rather than a field that was already "unstarted"
  patchFixtureState("T-2", "started");
  // ── drop the agent-ready label on T-3 (Park's swap-label step), verified
  // against the fixture file rather than trusted from the reply
  const dropReadyPrompt = buildPrompt(dropReadyQuestion("T-3"), phrasebook, SET_READY_SHAPE);
  const dropReadyStart = performance.now();
  const dropReadyLog = askWithRetry(runner, { k: "tracker.setReady", issue: "T-3", ready: false }, dropReadyPrompt);
  const dropReadyMs = Math.round(performance.now() - dropReadyStart);
  const dropReadyOk = dropReadyLog.status !== "failed" && dropReadyLog.answer.result === "ok";
  const dropReadyFileOk = readFixtureField("T-3", "ready") === "false";
  console.log(
    `  drop ready T-3: ${dropReadyLog.status}${dropReadyLog.status === "failed" ? ` — ${dropReadyLog.whys[1]}` : ""} (expected ok: ${dropReadyOk ? "yes" : "no"}; file ready=${readFixtureField("T-3", "ready")})`,
  );

  const setUnstartedPrompt = buildPrompt(unstartedQuestion("T-2"), phrasebook, SET_STATE_SHAPE);
  const setUnstartedStart = performance.now();
  const setUnstartedLog = askWithRetry(runner, { k: "tracker.setState", issue: "T-2", state: "unstarted" }, setUnstartedPrompt);
  const setUnstartedMs = Math.round(performance.now() - setUnstartedStart);
  const setUnstartedOk = setUnstartedLog.status !== "failed" && setUnstartedLog.answer.result === "ok";
  const setUnstartedFileOk = readFixtureField("T-2", "state") === "unstarted";
  console.log(
    `  setState unstarted T-2: ${setUnstartedLog.status}${setUnstartedLog.status === "failed" ? ` — ${setUnstartedLog.whys[1]}` : ""} (expected ok: ${setUnstartedOk ? "yes" : "no"}; file state=${readFixtureField("T-2", "state")})`,
  );

  // ── slice 4: garble — a bare prompt (no shape, no "reply ONLY JSON") on
  // T-1, likely to draw prose. check() (tracker.ts) cannot accept a garbled
  // reply as valid by construction — a "valid" status only ever follows a
  // check() pass — so this can't gate pass/fail on the reply's content. What
  // it proves, honestly, is whether the live rejection path (a re-ask firing,
  // or the ask ultimately failing) actually triggered against a real
  // adversarial reply rather than only ever synthetic bad input in a unit
  // test. A harness that stays JSON-compliant anyway is fine, per the brief.
  const garbleAsk: Ask = { k: "tracker.setState", issue: "T-1", state: "unstarted" };
  const garbleStart = performance.now();
  const garbleLog = askWithRetry(runner, garbleAsk, garblePrompt(GARBLE_QUESTION, phrasebook));
  const garbleMs = Math.round(performance.now() - garbleStart);
  // Reported, not scored. There is deliberately no garbleOk conjunct in pass
  // below: a constant true ANDed into the verdict would read as a check that
  // passed when nothing was ever checked.
  const garbleRejectedLive = garbleLog.status !== "valid-first-try";
  console.log(
    `  garble: ${garbleLog.status}${garbleLog.status === "failed" ? ` — ${garbleLog.whys[1]}` : ""} (live rejection observed: ${garbleRejectedLive ? "yes" : "no"})`,
  );

  // ── slice 4: contention — T-5 is pre-claimed by CONTENTION_ACTOR; a claim
  // attempt by this harness's actor must come back taken, name the right
  // holder, and the fixture file must still show the ORIGINAL holder
  // afterward — a claim ask must never silently steal another actor's claim.
  const contentionActor = `parity-${harness}`;
  const contentionPrompt = buildPrompt(claimQuestion("T-5", contentionActor), phrasebook, CLAIM_SHAPE);
  const contentionStart = performance.now();
  const contentionLog = askWithRetry(
    runner,
    { k: "tracker.claim", issue: "T-5", actor: contentionActor },
    contentionPrompt,
  );
  const contentionMs = Math.round(performance.now() - contentionStart);
  const contentionOk =
    contentionLog.status !== "failed" &&
    contentionLog.answer.result === "taken" &&
    contentionLog.answer.by === CONTENTION_ACTOR;
  const contentionFileOk = readFixtureField("T-5", "claimedBy") === CONTENTION_ACTOR;
  console.log(
    `  contention T-5: ${contentionLog.status}${contentionLog.status === "failed" ? ` — ${contentionLog.whys[1]}` : ""} (expected taken by ${CONTENTION_ACTOR}: ${contentionOk ? "yes" : "no"}; file claimedBy=${readFixtureField("T-5", "claimedBy")})`,
  );

  // ── slice 5: tracker.openIssues — every still-open ticket, including the
  // two planning artifacts (T-6, T-7) with their labels intact. Verified
  // against the fixture files, never against the agent's claim — mirrors
  // bin/planning.ts's step 1. Reuses OPEN_ISSUES_QUESTION/OPEN_ISSUES_SHAPE
  // from fixture.ts rather than a second copy of the prompt.
  const ALL_OPEN_IDS = ["T-1", "T-2", "T-3", "T-4", "T-5", "T-6", "T-7", "T-8", "T-10"];
  const openIssuesShape = `${TICKET_FACTS_SHAPE}\n${OPEN_ISSUES_SHAPE}`;
  const openIssuesPrompt = buildPrompt(OPEN_ISSUES_QUESTION, phrasebook, openIssuesShape);
  const openIssuesStart = performance.now();
  const openIssuesLog = askWithRetry(runner, { k: "tracker.openIssues", milestone: null }, openIssuesPrompt);
  const openIssuesMs = Math.round(performance.now() - openIssuesStart);
  const openTickets: TicketFacts[] = openIssuesLog.status !== "failed" ? openIssuesLog.answer.tickets : [];
  const openIds = new Set(openTickets.map((t) => t.id));
  const everyTicketListed = ALL_OPEN_IDS.every((id) => openIds.has(id));
  const t6 = openTickets.find((t) => t.id === "T-6");
  const t7 = openTickets.find((t) => t.id === "T-7");
  const planningLabelsIntact =
    t6 !== undefined && t6.labels.includes("wayfinder:map") && t7 !== undefined && t7.labels.includes("planning:prd");
  const openIssuesOk = openIssuesLog.status !== "failed" && everyTicketListed && planningLabelsIntact;
  console.log(
    `  openIssues: ${openIssuesLog.status}${openIssuesLog.status === "failed" ? ` — ${openIssuesLog.whys[1]}` : ""} (every open ticket listed: ${everyTicketListed ? "yes" : "no"}; planning labels intact: ${planningLabelsIntact ? "yes" : "no"})`,
  );

  // ── slice 5: emptyQueueReport's breakdown under a milestone scope, checked
  // against a count taken directly from the fixture files — not from the
  // agent's openIssues reply above — mirrors bin/planning.ts's step 4. L2
  // proof named by the PRD ("L2 confirms role resolution and prompt-inlined
  // skill delivery on all three harnesses" — this is the breakdown half of
  // that same empty-Queue path).
  const groundTruthOpenIssues = ALL_OPEN_IDS.map(readFixtureTicket);
  const groundTruthBreakdown = breakdown(groundTruthOpenIssues);
  const report = emptyQueueReport({
    scope: { k: "milestone", milestone: "M1" },
    openIssues: openTickets,
    counts: null,
    mode: "headless",
  });
  const breakdownOk =
    report.breakdown !== null &&
    report.breakdown.open === groundTruthBreakdown.open &&
    report.breakdown.readyForHuman === groundTruthBreakdown.readyForHuman &&
    report.breakdown.needsInfo === groundTruthBreakdown.needsInfo &&
    report.breakdown.blocked === groundTruthBreakdown.blocked;
  console.log(
    `  breakdown (milestone scope): fixture=${JSON.stringify(groundTruthBreakdown)} report=${JSON.stringify(report.breakdown)} (match: ${breakdownOk ? "yes" : "no"})`,
  );

  // ── slice 5: prompt-inlined skill delivery — the phrasebook text is
  // present, byte-identical, in the actual prompt string handed to the
  // runner for the openIssues ask above (captured, not reconstructed) —
  // mirrors bin/planning.ts's step 6. The PRD's other named L2 proof for
  // this slice.
  const phrasebookInlinedOk = lastPrompt.includes(phrasebook);
  console.log(`  prompt-inlined skill delivery: ${phrasebookInlinedOk ? "present, byte-identical" : "missing or altered"}`);

  // ── slice 6: v1-to-v2 migration — a real copy of this repo's own v1 stamp
  // (conformance/v1repo.ts's mkV1Repo), migrated end to end: detect v1, plan,
  // apply (config.json + the adapter doc's adopt-theirs/retrofit offer), then
  // a full preflight against the migrated copy. Reuses bin/migrate.ts's own
  // shared material (v1repo.ts) — the rendered template and the chosen
  // merge-policy/attack-surface answers — rather than a second copy of
  // either. The preflight's trackerReachable fact reuses the reachable check
  // already run above (no second harness call — see the comment where it's
  // consumed, below). Every claim is checked against the fixture's own files
  // on disk, never trusted from a plan field.
  const migrateRepo = mkV1Repo();
  const migrateSkillsHome = mkFullSkillsHome();
  let migrateDetectV1Ok = false;
  let migrateApplyOk = false;
  let migratePreflightGreenOk = false;
  const migrateStart = performance.now();
  try {
    const preState = detectStamp(gatherStampFacts(migrateRepo.root));
    migrateDetectV1Ok = preState.k === "legacy-v1";

    const repoVersion = repoVersionOf(preState);
    const chain = repoVersion === null ? [] : pendingSteps(repoVersion, STAMP_VERSION);
    const renderedAdapterDoc = renderRealLinearAdapterDoc();
    const currentAdapterDoc = readFileSync(join(migrateRepo.root, ADAPTER_DOC_PATH), "utf8");
    const plan = planMigration(chain, { adapterDoc: currentAdapterDoc, renderedAdapterDoc });

    // Write order is load-bearing, not stylistic: the adapter doc FIRST,
    // config.json LAST. config.json is the stamp, so writing it last makes it
    // the step's single commit point — a crash before it leaves the repo at
    // legacy-v1 and the whole step re-runs idempotently. The reverse order
    // strands a repo stamped v2 whose doc was never retrofitted, which no
    // later run can detect (see src/migrate.ts's header). bin/migrate.ts
    // writes in this same order.
    //
    // The maintainer's offer on a genuine drift (SKILL.md:254-256) is
    // adopt-theirs / keep-mine / merge-by-hand — this host takes adopt-theirs,
    // same as bin/migrate.ts. missing-sections keeps the ordinary retrofit.
    if (plan.docDiff.k === "other-difference") {
      writeFileSync(join(migrateRepo.root, ADAPTER_DOC_PATH), renderedAdapterDoc);
    } else if (plan.docDiff.k === "missing-sections" && plan.retrofittedDoc !== null) {
      writeFileSync(join(migrateRepo.root, ADAPTER_DOC_PATH), plan.retrofittedDoc);
    }

    mkdirSync(join(migrateRepo.root, ".factory"), { recursive: true });
    writeFileSync(
      join(migrateRepo.root, CONFIG_PATH),
      renderV1ToV2Config({
        tracker: plan.detectedTracker ?? "linear",
        merge: CHOSEN_MERGE_POLICY,
        attackSurface: CHOSEN_ATTACK_SURFACE,
      }),
    );

    const configOnDisk = JSON.parse(readFileSync(join(migrateRepo.root, CONFIG_PATH), "utf8"));
    const configKeys = Object.keys(configOnDisk).sort().join(",");
    const markerPresent = /<!--\s*factory:tracker\s+kind=linear\s*-->/.test(
      readFileSync(join(migrateRepo.root, ADAPTER_DOC_PATH), "utf8"),
    );
    const postState = detectStamp(gatherStampFacts(migrateRepo.root));
    migrateApplyOk =
      configKeys === "attackSurface,merge,stampVersion,tracker" &&
      configOnDisk.stampVersion === STAMP_VERSION &&
      configOnDisk.tracker.kind === "linear" &&
      configOnDisk.merge.policy === CHOSEN_MERGE_POLICY &&
      configOnDisk.attackSurface === CHOSEN_ATTACK_SURFACE &&
      markerPresent &&
      postState.k === "v2" &&
      postState.version === STAMP_VERSION;

    // trackerReachable reuses the reachable check already run above (same
    // question, shape, runner, cwd, and fixture) rather than asking again: the
    // intervening asks mutate ticket *contents*, never whether
    // tracker/tickets/ exists, so the predicate is unchanged and the answer
    // is already in reachableLog — a second live ask here would just spend
    // another harness call answering the same question a second time.
    const trackerReachable =
      reachableLog.status !== "failed"
        ? reachableLog.answer
        : { result: "unreachable" as const, why: `harness ask failed: ${reachableLog.whys[1]}` };

    const preflightFacts = gatherPreflightFacts(migrateRepo.root, {
      trackerReachable,
      home: migrateSkillsHome.home,
    });
    const verdict = preflight(preflightFacts);
    migratePreflightGreenOk = verdict.ok && preflightFacts.stampVersion.repo === STAMP_VERSION;
    console.log(
      `  migrate v1->v2: detect=${migrateDetectV1Ok ? "yes" : "no"} apply=${migrateApplyOk ? "yes" : "no"} reachable=${reachableLog.status} preflight=${verdict.ok ? "green" : "red"} (expected green: ${migratePreflightGreenOk ? "yes" : "no"})`,
    );
  } finally {
    rmSkillsHome(migrateSkillsHome.home);
    rmV1Repo(migrateRepo.root);
  }
  const migrateMs = Math.round(performance.now() - migrateStart);

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
    clearLog = askImplementOnce(clearRunner, implementAsk, implementPrompt(CLEAR_BRIEF));
    if (clearLog.status !== "failed" && clearLog.answer.result === "done") {
      workVerifiedOk = verifyClearBriefWork(clearRepo.root).workOk;
    }
  } finally {
    rmCodeRepo(clearRepo.root);
  }
  const clearMs = Math.round(performance.now() - clearStart);
  const implementDoneOk = clearLog.status !== "failed" && clearLog.answer.result === "done";
  console.log(
    `  implement CLEAR_BRIEF: ${clearLog.status}${clearLog.status === "failed" ? ` — ${clearLog.why}` : ""} (expected done: ${implementDoneOk ? "yes" : "no"}; work verified: ${workVerifiedOk ? "yes" : "no"})`,
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
    vagueLog = askImplementOnce(vagueRunner, vagueAsk, implementPrompt(VAGUE_BRIEF));
  } finally {
    rmCodeRepo(vagueRepo.root);
  }
  const vagueMs = Math.round(performance.now() - vagueStart);
  const implementQuestionOk =
    vagueLog.status !== "failed" &&
    vagueLog.answer.result === "question" &&
    vagueLog.answer.question.trim().length > 0;
  console.log(
    `  implement VAGUE_BRIEF: ${vagueLog.status}${vagueLog.status === "failed" ? ` — ${vagueLog.why}` : ""} (expected question: ${implementQuestionOk ? "yes" : "no"})`,
  );

  // Only the tracker asks can re-ask; the agent.implement dispatches get one
  // run each (PRD §2), so they cannot contribute to this count. The garble
  // ask is a tracker ask too (and does count toward re-asks when one fires),
  // but it is deliberately excluded from `pass` — see the check itself.
  const asks = [
    reachableLog,
    verifyLog,
    candidatesLog,
    readT1Log,
    readT9Log,
    claimLog,
    startedLog,
    unclaimLog,
    commentLog,
    dropReadyLog,
    setUnstartedLog,
    garbleLog,
    contentionLog,
    openIssuesLog,
  ];
  const reasks = asks.filter((l) => l.status === "valid-after-reask").length;
  const totalMs =
    reachableMs +
    verifyMs +
    candidatesMs +
    readT1Ms +
    readT9Ms +
    claimMs +
    startedMs +
    unclaimMs +
    commentMs +
    dropReadyMs +
    setUnstartedMs +
    garbleMs +
    contentionMs +
    openIssuesMs +
    migrateMs +
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
    commentOk &&
    commentFileOk &&
    dropReadyOk &&
    dropReadyFileOk &&
    setUnstartedOk &&
    setUnstartedFileOk &&
    contentionOk &&
    contentionFileOk &&
    openIssuesOk &&
    breakdownOk &&
    phrasebookInlinedOk &&
    migrateDetectV1Ok &&
    migrateApplyOk &&
    migratePreflightGreenOk &&
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
    comment: commentLog.status,
    commentOk,
    dropReady: dropReadyLog.status,
    dropReadyOk,
    dropReadyFileOk,
    commentFileOk,
    setUnstarted: setUnstartedLog.status,
    setUnstartedOk,
    setUnstartedFileOk,
    garble: garbleLog.status,
    garbleRejectedLive,
    contention: contentionLog.status,
    contentionOk,
    contentionFileOk,
    openIssues: openIssuesLog.status,
    openIssuesOk,
    breakdownOk,
    phrasebookInlinedOk,
    migrateDetectV1Ok,
    migrateApplyOk,
    migrateReachable: reachableLog.status,
    migrateReachableOk: reachableOk,
    migratePreflightGreenOk,
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
    "comment",
    "ok?",
    "file?",
    "drop-ready",
    "ok?",
    "file?",
    "setState unstarted",
    "ok?",
    "file?",
    "garble",
    "rejected-live?",
    "contention",
    "ok?",
    "file?",
    "openIssues",
    "ok?",
    "breakdown",
    "ok?",
    "phrasebook",
    "ok?",
    "migrate v1",
    "ok?",
    "migrate apply",
    "ok?",
    "migrate reachable",
    "ok?",
    "migrate preflight",
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
    r.comment,
    r.commentOk ? "yes" : "no",
    r.commentFileOk ? "yes" : "no",
    r.dropReady,
    r.dropReadyOk ? "yes" : "no",
    r.dropReadyFileOk ? "yes" : "no",
    r.setUnstarted,
    r.setUnstartedOk ? "yes" : "no",
    r.setUnstartedFileOk ? "yes" : "no",
    r.garble,
    r.garbleRejectedLive ? "yes" : "no",
    r.contention,
    r.contentionOk ? "yes" : "no",
    r.contentionFileOk ? "yes" : "no",
    r.openIssues,
    r.openIssuesOk ? "yes" : "no",
    "checked",
    r.breakdownOk ? "yes" : "no",
    "checked",
    r.phrasebookInlinedOk ? "yes" : "no",
    r.migrateDetectV1Ok ? "detected" : "not detected",
    r.migrateDetectV1Ok ? "yes" : "no",
    "checked",
    r.migrateApplyOk ? "yes" : "no",
    r.migrateReachable,
    r.migrateReachableOk ? "yes" : "no",
    r.migratePreflightGreenOk ? "green" : "red",
    r.migratePreflightGreenOk ? "yes" : "no",
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
