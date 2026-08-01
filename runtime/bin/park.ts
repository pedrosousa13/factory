#!/usr/bin/env bun
// Edge entry (bun, fs + git allowed): the park host loop, slice 4's
// capability end to end against the local markdown tracker fixture and a
// scratch git repo with a real "origin" — claim a ticket, then run
// parkPlan()'s five steps IN ORDER by iterating the plan itself and
// switching on each step (the plan drives the run; nothing here is printed
// without being dispatched — slice 3 shipped a bug where a gate was printed
// but never dispatched, and this loop structurally can't repeat it, since
// there is nothing to print except what each case actually does). Verifies
// every step against the fixture/git ground truth, then proves
// reconcileClaims makes the right call on the claim-and-pushed-branch
// picture captured right after push-branch, both with and without a
// crashed-mid-Park journal (S19). Prints an honest per-step scoreboard and
// exits non-zero on any failure. Cleans up the scratch repo and the tracker
// fixture on every path.
//
// bun park.ts claude|codex|pi
//
// THROWAWAY: no tests, no error handling beyond what keeps it runnable.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLAIM_SHAPE,
  claimQuestion,
  commentQuestion,
  COMMENT_SHAPE,
  down,
  dropReadyQuestion,
  READ_SHAPE,
  readFixtureBody,
  readFixtureField,
  readFixtureTicket,
  readQuestion,
  SET_READY_SHAPE,
  SET_STATE_SHAPE,
  TICKETS_DIR,
  UNCLAIM_SHAPE,
  unclaimQuestion,
  unstartedQuestion,
  up,
} from "../conformance/fixture";
import { runHarness, type HarnessName } from "../src/harness";
import { askWithRetry, buildPrompt, type Runner } from "../src/askloop";
import { branchName } from "../src/pick";
import { parkCommentText, parkPlan, PARK_STEP, type ParkReason } from "../src/park";
import { reconcileClaims, type RecoveryInput } from "../src/recovery";
import type { JournalRecord } from "../src/journal";
import { readJournal, startClaim, writeJournal } from "../src/journalfile";
import { interactiveAnswer, waitDecision } from "../src/answerwait";
import { ping } from "../src/ping";

const DIR = import.meta.dir;
const PHRASEBOOK_PATH = join(DIR, "../conformance/phrasebook.md");

// ─────────────────────────────────────────────────────────── park repo (git)
//
// Distinct from conformance/coderepo.ts's scratch repo, which has no remote
// — Park's first step is a real push, so this needs a bare "origin" to push
// to and read branches back from. Host-local, not shared conformance
// material: nothing else in this slice needs a git repo with an origin.

function git(args: string[], cwd: string): void {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdin: "ignore", stdout: "ignore", stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
}

function gitOut(args: string[], cwd: string): string {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  return proc.stdout.toString();
}

function mkParkRepo(): { root: string; origin: string } {
  const origin = mkdtempSync(join(tmpdir(), "factory-park-origin-"));
  git(["init", "--bare", "-b", "main"], origin);

  const root = mkdtempSync(join(tmpdir(), "factory-park-repo-"));
  git(["init", "-b", "main"], root);
  git(["config", "user.email", "park@factory.local"], root);
  git(["config", "user.name", "Factory Park Fixture"], root);
  git(["remote", "add", "origin", origin], root);
  writeFileSync(join(root, "NOTES.md"), "park fixture\n");
  git(["add", "NOTES.md"], root);
  git(["commit", "-m", "Initial commit"], root);
  git(["push", "origin", "main"], root);
  return { root, origin };
}

function rmParkRepo(repo: { root: string; origin: string }): void {
  rmSync(repo.root, { recursive: true, force: true });
  rmSync(repo.origin, { recursive: true, force: true });
}

/** Branch names that currently exist on `origin`, read directly — the
 * ground truth for verifying push-branch and for recovery's originBranches. */
function originBranchNames(origin: string): string[] {
  const out = gitOut(["ls-remote", "--heads", origin], origin);
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => l.split("refs/heads/")[1])
    .filter((n): n is string => n !== undefined);
}

// ─────────────────────────────────────────────────── direct fixture patches
//
// "started" has no tracker.* ask of its own here: it is slice 2's pick
// capability setting up realistic in-flight state, not this slice's own
// capability, so it is simulated directly rather than dispatched — the same
// "direct fixture patch, not a tracker ask" pattern bin/pick.ts uses for its
// reset hygiene. Every step of the Park itself IS dispatched.

function patchTicketState(id: string, state: string): void {
  const path = join(TICKETS_DIR, `${id}.md`);
  const text = readFileSync(path, "utf8");
  writeFileSync(path, text.replace(/^state: .*$/m, `state: ${state}`));
}

// Simulates the maintainer answering: replying is the maintainer's own act,
// not this run's, so it is a direct fixture patch, not a tracker.* ask — the
// same pattern as patchTicketState above.
function appendAnswerComment(id: string, text: string): void {
  const path = join(TICKETS_DIR, `${id}.md`);
  const body = readFileSync(path, "utf8");
  writeFileSync(path, `${body}\n${text}\n`);
}

// ────────────────────────────────────────────────────── headless ask cycle
//
// Item 1 and item 2 of the ask/park proof (issue #43) share this exact
// sequence — post the question as a durable ticket comment, journal it, ping
// — up to whether an answer ever lands, which is where the two paths differ.

function askAndJournal(
  runner: Runner,
  phrasebook: string,
  repoRoot: string,
  harness: HarnessName,
  ticketId: string,
  branch: string,
  question: string,
  steps: Step[],
): void {
  const askPrompt = buildPrompt(commentQuestion(ticketId, question), phrasebook, COMMENT_SHAPE);
  const askOutcome = askWithRetry(runner, { k: "tracker.comment", issue: ticketId, text: question }, askPrompt);
  const askOk = askOutcome.status !== "failed" && askOutcome.answer.result === "ok";
  steps.push(
    step(
      `ask: post-question ${ticketId}`,
      askOutcome.status,
      askOk,
      askOutcome.status === "failed" ? askOutcome.whys[1] : undefined,
    ),
  );
  const postedOk = readFixtureBody(ticketId).includes(question);
  steps.push(step(`verify file: question posted ${ticketId}`, postedOk ? "found" : "missing", postedOk));

  // The window the wait later measures starts here, at post time — not at
  // process start — so it is journaled immediately.
  const askedAt = new Date().toISOString();
  writeJournal(repoRoot, {
    ticket: ticketId,
    branch,
    step: "ask",
    openQuestion: { text: question, askedAt },
    workers: [],
  });

  // No notifierCommand is configured for this host, so no-notifier-configured
  // (or pi-no-ping for pi) is the honest outcome, not a failure — ping.ts's
  // own contract.
  const pingOutcome = ping(harness, undefined, repoRoot);
  const pingOk = pingOutcome.k !== "notifier-failed";
  steps.push(step(`ping ${ticketId}`, pingOutcome.k, pingOk));
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
  console.error("usage: bun park.ts claude|codex|pi");
  process.exit(1);
}

// ──────────────────────────────────────────────────────────────────── main

function main(): void {
  const harness = parseHarness(process.argv);
  const phrasebook = readFileSync(PHRASEBOOK_PATH, "utf8");
  const runner: Runner = (prompt) => runHarness(harness, prompt, DIR);
  const steps: Step[] = [];
  let repo: { root: string; origin: string } | undefined;

  console.log(`\n=== ${harness} ===`);

  try {
    up();
    repo = mkParkRepo();

    const actor = `park-${harness}`;
    const ticketId = "T-1";

    // ── claim T-1
    const claimPrompt = buildPrompt(claimQuestion(ticketId, actor), phrasebook, CLAIM_SHAPE);
    const claimOutcome = askWithRetry(runner, { k: "tracker.claim", issue: ticketId, actor }, claimPrompt);
    const claimAskOk = claimOutcome.status !== "failed" && claimOutcome.answer.result === "claimed";
    steps.push(
      step("tracker.claim", claimOutcome.status, claimAskOk, claimOutcome.status === "failed" ? claimOutcome.whys[1] : undefined),
    );
    const claimFileOk = readFixtureField(ticketId, "claimedBy") === actor;
    steps.push(step("verify file: claimedBy", claimFileOk ? "match" : "mismatch", claimFileOk));

    if (claimAskOk && claimFileOk) {
      // Simulate that work was already underway when the question came up:
      // Park step 5 sends a STARTED ticket back to unstarted, so starting it
      // here (direct patch — this transition is slice 2's capability, not
      // this one) makes that later verification prove a real transition
      // rather than checking a field that was never anything else.
      patchTicketState(ticketId, "started");

      const ticketBefore = readFixtureTicket(ticketId);
      const branch = branchName(ticketBefore.id, ticketBefore.title);

      // The claim is where the journal gets reset. recovery.ts depends on it:
      // a record left by an earlier cycle names the same ticket, actor, and
      // branch as a live interrupted Park, so anything stale surviving into a
      // new claim would be read as a Park in flight. startClaim takes no
      // openQuestion, so the reset cannot carry one over.
      startClaim(repo.root, ticketId, branch, "claim", [actor]);
      const journalAtClaim = readJournal(repo.root);
      const claimJournalOk =
        journalAtClaim.ok && journalAtClaim.record.ticket === ticketId && journalAtClaim.record.openQuestion === null;
      steps.push(
        step(
          "journal: reset at claim",
          claimJournalOk ? "no open question carried over" : "stale or unreadable",
          claimJournalOk,
        ),
      );

      let branchSetupOk = true;
      try {
        git(["checkout", "-b", branch], repo.root);
        writeFileSync(join(repo.root, "NOTES.md"), "shelved work in progress\n");
        git(["add", "NOTES.md"], repo.root);
        git(["commit", "-m", "Shelved work"], repo.root);
      } catch (e) {
        branchSetupOk = false;
        steps.push(step("setup: branch + shelved commit", "error", false, (e as Error).message));
      }

      if (branchSetupOk) {
        steps.push(step("setup: branch + shelved commit", "committed", true, branch));

        const reason: ParkReason = {
          k: "unanswered-question",
          question: "Should this ticket squash-merge or regular-merge once it's unblocked?",
          askedAt: new Date().toISOString(),
        };
        const commentText = parkCommentText(reason, branch, "1 commit, pushed by Park");

        // The plan drives the run: every entry in parkPlan() gets a case
        // below that both performs the step and records it, so a step can
        // never be printed without having actually been dispatched.
        const plan = parkPlan();
        let recoverySnapshotAfterPush:
          | { claimed: RecoveryInput["claimed"]; originBranches: string[] }
          | undefined;
        let recoverySnapshotAfterComment:
          | { claimed: RecoveryInput["claimed"]; originBranches: string[]; parkCommented: string[] }
          | undefined;

        for (const s of plan) {
          switch (s) {
            case "push-branch": {
              let pushOk = true;
              try {
                git(["push", "origin", branch], repo.root);
              } catch (e) {
                pushOk = false;
                steps.push(step("park: push-branch", "error", false, (e as Error).message));
              }
              if (pushOk) {
                const onOrigin = originBranchNames(repo.origin).includes(branch);
                steps.push(step("park: push-branch", onOrigin ? "pushed" : "not on origin", onOrigin, branch));
              }

              // Snapshot right here — claimed + branch-on-origin, before any
              // tracker write below — for the S19 recovery proof.
              recoverySnapshotAfterPush = {
                claimed: [readFixtureTicket(ticketId)],
                originBranches: originBranchNames(repo.origin),
              };
              break;
            }

            case "post-comment": {
              const commentPrompt = buildPrompt(commentQuestion(ticketId, commentText), phrasebook, COMMENT_SHAPE);
              const commentOutcome = askWithRetry(
                runner,
                { k: "tracker.comment", issue: ticketId, text: commentText },
                commentPrompt,
              );
              const commentAskOk = commentOutcome.status !== "failed" && commentOutcome.answer.result === "ok";
              steps.push(
                step(
                  "park: post-comment",
                  commentOutcome.status,
                  commentAskOk,
                  commentOutcome.status === "failed" ? commentOutcome.whys[1] : undefined,
                ),
              );
              const body = readFixtureBody(ticketId);
              const commentFileOk =
                body.includes("This was generated by AI during triage") &&
                body.includes(reason.question) &&
                body.includes(branch);
              steps.push(step("verify file: comment landed", commentFileOk ? "found" : "missing", commentFileOk));

              // Snapshot again here — same claim, same branch, but now the
              // comment has (verifiably) landed — for the recovery proof
              // that a Park interrupted AFTER its comment owes only the
              // steps that come after it (recovery.ts's parkCommented).
              recoverySnapshotAfterComment = {
                claimed: [readFixtureTicket(ticketId)],
                originBranches: originBranchNames(repo.origin),
                parkCommented: commentFileOk ? [ticketId] : [],
              };
              break;
            }

            case "release-claim": {
              const unclaimPrompt = buildPrompt(unclaimQuestion(ticketId), phrasebook, UNCLAIM_SHAPE);
              const unclaimOutcome = askWithRetry(runner, { k: "tracker.unclaim", issue: ticketId }, unclaimPrompt);
              const unclaimAskOk = unclaimOutcome.status !== "failed" && unclaimOutcome.answer.result === "ok";
              steps.push(
                step(
                  "park: release-claim",
                  unclaimOutcome.status,
                  unclaimAskOk,
                  unclaimOutcome.status === "failed" ? unclaimOutcome.whys[1] : undefined,
                ),
              );
              const releasedFileOk = readFixtureField(ticketId, "claimedBy") === null;
              steps.push(step("verify file: claim released", releasedFileOk ? "released" : "still claimed", releasedFileOk));
              break;
            }

            case "swap-label": {
              const dropReadyPrompt = buildPrompt(dropReadyQuestion(ticketId), phrasebook, SET_READY_SHAPE);
              const dropReadyOutcome = askWithRetry(
                runner,
                { k: "tracker.setReady", issue: ticketId, ready: false },
                dropReadyPrompt,
              );
              const dropReadyOk = dropReadyOutcome.status !== "failed" && dropReadyOutcome.answer.result === "ok";
              const swappedFileOk = readFixtureField(ticketId, "ready") === "false";
              steps.push(
                step(
                  "park: swap-label",
                  dropReadyOutcome.status,
                  dropReadyOk && swappedFileOk,
                  swappedFileOk ? "file ready=false" : "file still ready=true",
                ),
              );
              break;
            }

            case "set-unstarted": {
              const unstartedPrompt = buildPrompt(unstartedQuestion(ticketId), phrasebook, SET_STATE_SHAPE);
              const unstartedOutcome = askWithRetry(
                runner,
                { k: "tracker.setState", issue: ticketId, state: "unstarted" },
                unstartedPrompt,
              );
              const unstartedAskOk = unstartedOutcome.status !== "failed" && unstartedOutcome.answer.result === "ok";
              steps.push(
                step(
                  "park: set-unstarted",
                  unstartedOutcome.status,
                  unstartedAskOk,
                  unstartedOutcome.status === "failed" ? unstartedOutcome.whys[1] : undefined,
                ),
              );
              const unstartedFileOk = readFixtureField(ticketId, "state") === "unstarted";
              steps.push(step("verify file: state=unstarted", unstartedFileOk ? "match" : "mismatch", unstartedFileOk));
              break;
            }
          }
        }

        // ── recovery: prove reconcileClaims makes the right call on the
        // claim-and-pushed-branch picture, at two different points in the
        // Park — right after push-branch, and again right after
        // post-comment — each checked with no journal (plain resume) and
        // with a journal naming the park step (S19: resume-park). The
        // second pair proves recovery.ts's parkCommented field: a Park
        // interrupted AFTER its comment already landed must not be told to
        // replay it (tracker.comment appends, so a replay would post the
        // maintainer a second copy of the same question).
        if (recoverySnapshotAfterPush) {
          const resumeInput: RecoveryInput = {
            claimed: recoverySnapshotAfterPush.claimed,
            unclaimed: [],
            originBranches: recoverySnapshotAfterPush.originBranches,
            actor,
            journal: null,
            parkCommented: [],
          };
          const resumeDecisions = reconcileClaims(resumeInput);
          const resumeDecision = resumeDecisions[0];
          const resumeOk =
            resumeDecisions.length === 1 &&
            resumeDecision !== undefined &&
            resumeDecision.k === "resume" &&
            resumeDecision.ticket === ticketId &&
            resumeDecision.branch === branch;
          steps.push(
            step("recovery: resume (no journal)", resumeDecision?.k ?? "none", resumeOk, JSON.stringify(resumeDecision)),
          );

          const parkedJournal: JournalRecord = {
            ticket: ticketId,
            branch,
            step: PARK_STEP,
            openQuestion: { text: reason.question, askedAt: reason.askedAt },
            workers: [actor],
          };
          const resumeParkDecisions = reconcileClaims({ ...resumeInput, journal: parkedJournal });
          const resumeParkDecision = resumeParkDecisions[0];
          const expectedRemaining = ["post-comment", "release-claim", "swap-label", "set-unstarted"];
          const resumeParkOk =
            resumeParkDecisions.length === 1 &&
            resumeParkDecision !== undefined &&
            resumeParkDecision.k === "resume-park" &&
            resumeParkDecision.ticket === ticketId &&
            resumeParkDecision.branch === branch &&
            resumeParkDecision.remaining.join(",") === expectedRemaining.join(",");
          steps.push(
            step(
              "recovery: resume-park before comment (S19)",
              resumeParkDecision?.k ?? "none",
              resumeParkOk,
              JSON.stringify(resumeParkDecision),
            ),
          );

          if (recoverySnapshotAfterComment) {
            const afterCommentInput: RecoveryInput = {
              claimed: recoverySnapshotAfterComment.claimed,
              unclaimed: [],
              originBranches: recoverySnapshotAfterComment.originBranches,
              actor,
              journal: parkedJournal,
              parkCommented: recoverySnapshotAfterComment.parkCommented,
            };
            const afterCommentDecisions = reconcileClaims(afterCommentInput);
            const afterCommentDecision = afterCommentDecisions[0];
            const expectedRemainingAfterComment = ["release-claim", "swap-label", "set-unstarted"];
            const afterCommentOk =
              afterCommentDecisions.length === 1 &&
              afterCommentDecision !== undefined &&
              afterCommentDecision.k === "resume-park" &&
              afterCommentDecision.ticket === ticketId &&
              afterCommentDecision.branch === branch &&
              afterCommentDecision.remaining.join(",") === expectedRemainingAfterComment.join(",");
            steps.push(
              step(
                "recovery: resume-park after comment (parkCommented)",
                afterCommentDecision?.k ?? "none",
                afterCommentOk,
                JSON.stringify(afterCommentDecision),
              ),
            );
          } else {
            steps.push(step("recovery: resume-park after comment", "skipped", false, "no post-comment snapshot"));
          }
        } else {
          steps.push(step("recovery", "skipped", false, "no snapshot captured — push-branch never ran"));
        }

        // ── headless ask cycle: answered path (T-2). Proves answerwait.ts,
        // journalfile.ts, and ping.ts live — before this slice all three had
        // no caller but their own unit test (issue #43).
        const askTicketBefore = readFixtureTicket("T-2");
        const askBranch = branchName(askTicketBefore.id, askTicketBefore.title);
        const question = "Should T-2 pull in the shared parsing library or vendor its own copy?";
        askAndJournal(runner, phrasebook, repo.root, harness, "T-2", askBranch, question, steps);

        const answerText = "Use the shared library.";
        appendAnswerComment("T-2", `MAINTAINER ANSWER: ${answerText}`);

        // Poll: a live tracker.read ask proves the read capability itself,
        // but the `answered` value fed to waitDecision comes from the
        // fixture file directly, never from the agent's reply.
        const pollPrompt = buildPrompt(readQuestion("T-2"), phrasebook, READ_SHAPE);
        const pollOutcome = askWithRetry(runner, { k: "tracker.read", issue: "T-2" }, pollPrompt);
        const pollOk = pollOutcome.status !== "failed" && pollOutcome.answer.result === "ok";
        steps.push(
          step(
            "ask: poll T-2 (answered)",
            pollOutcome.status,
            pollOk,
            pollOutcome.status === "failed" ? pollOutcome.whys[1] : undefined,
          ),
        );
        const answeredGroundTruth = readFixtureBody("T-2").includes(`MAINTAINER ANSWER: ${answerText}`)
          ? answerText
          : null;

        // askedAt read back from the journal file, not the variable this
        // closure already holds — a journal survives a crash and a kept
        // variable does not, and that gap is the property under test.
        const journalAfterAsk = readJournal(repo.root);
        const askedAtFromJournal =
          journalAfterAsk.ok && journalAfterAsk.record.openQuestion !== null
            ? journalAfterAsk.record.openQuestion.askedAt
            : null;
        steps.push(
          step("journal: read back askedAt (T-2)", askedAtFromJournal ?? "missing", askedAtFromJournal !== null),
        );

        if (askedAtFromJournal !== null) {
          const decision = waitDecision({
            askedAt: askedAtFromJournal,
            now: new Date().toISOString(), // well inside the 15-minute window
            windowMinutes: 15, // mirrors config.ts's ANSWER_WINDOW_MINUTES_DEFAULT
            answered: answeredGroundTruth,
          });
          const decisionOk = decision.k === "continue" && decision.answer === answerText;
          steps.push(step("waitDecision: answered path", decision.k, decisionOk, JSON.stringify(decision)));
        } else {
          steps.push(step("waitDecision: answered path", "skipped", false, "no journaled askedAt"));
        }

        // ── headless ask cycle: unanswered path (T-3). No answer ever
        // lands; `now` arrives already past the window rather than the run
        // actually sleeping 15 minutes — the window is a parameter.
        const parkTicketBefore = readFixtureTicket("T-3");
        const parkBranch = branchName(parkTicketBefore.id, parkTicketBefore.title);
        const parkQuestion = "Should T-3 stay blocked on the pending audit, or proceed without it?";
        askAndJournal(runner, phrasebook, repo.root, harness, "T-3", parkBranch, parkQuestion, steps);

        const journalAfterAsk2 = readJournal(repo.root);
        const askedAtFromJournal2 =
          journalAfterAsk2.ok && journalAfterAsk2.record.openQuestion !== null
            ? journalAfterAsk2.record.openQuestion.askedAt
            : null;
        steps.push(
          step("journal: read back askedAt (T-3)", askedAtFromJournal2 ?? "missing", askedAtFromJournal2 !== null),
        );

        if (askedAtFromJournal2 !== null) {
          // 16 minutes past the journaled askedAt: past the 15-minute window
          // without a real sleep, proving the same deadline a real clock
          // would eventually reach.
          const past = new Date(Date.parse(askedAtFromJournal2) + 16 * 60_000).toISOString();
          const decision = waitDecision({
            askedAt: askedAtFromJournal2,
            now: past,
            windowMinutes: 15,
            answered: null, // no maintainer answer was ever posted to T-3
          });
          const decisionOk = decision.k === "park";
          steps.push(step("waitDecision: unanswered path", decision.k, decisionOk, JSON.stringify(decision)));

          if (decisionOk) {
            const unansweredReason: ParkReason = {
              k: "unanswered-question",
              question: parkQuestion,
              askedAt: askedAtFromJournal2,
            };
            const unansweredText = parkCommentText(
              unansweredReason,
              parkBranch,
              "no commits yet — parked before any work began",
            );
            const carriesQuestion =
              unansweredText.includes(parkQuestion) && unansweredText.includes("Unanswered question");
            steps.push(
              step(
                "park: unanswered-question reason carries the question",
                carriesQuestion ? "confirmed" : "missing",
                carriesQuestion,
              ),
            );
          } else {
            steps.push(step("park: unanswered-question reason", "skipped", false, "waitDecision did not park"));
          }
        } else {
          steps.push(step("waitDecision: unanswered path", "skipped", false, "no journaled askedAt"));
        }

        // ── interactive path (PRD §5 item 3): skips ping/wait/Park entirely,
        // no clock involved.
        const interactiveText = "Rebase, per the maintainer's live reply.";
        const interactiveDecision = interactiveAnswer(interactiveText);
        const interactiveOk = interactiveDecision.k === "continue" && interactiveDecision.answer === interactiveText;
        steps.push(step("interactiveAnswer", interactiveDecision.k, interactiveOk));

        // ── stranded-ticket recovery (S19's second half): a ticket whose
        // Park crashed after release-claim — unclaimed, but not unstarted —
        // must come back owing exactly swap-label and set-unstarted. T-2 is
        // mutated into that exact shape: never claimed, its state pushed to
        // "started" (direct patch, same simulated-precondition pattern as
        // T-1's setup above), its branch actually pushed to origin, and its
        // Park comment actually posted and verified — every input here but
        // the journal (which this recovery path does not consult) is real.
        patchTicketState("T-2", "started");
        git(["checkout", "main"], repo.root);
        const strandedBranch = askBranch;
        let strandedPushOk = true;
        try {
          git(["checkout", "-b", strandedBranch], repo.root);
          writeFileSync(join(repo.root, "NOTES.md"), "stranded park shelved work\n");
          git(["add", "NOTES.md"], repo.root);
          git(["commit", "-m", "Stranded park shelved work"], repo.root);
          git(["push", "origin", strandedBranch], repo.root);
        } catch (e) {
          strandedPushOk = false;
          steps.push(step("stranded: push-branch T-2", "error", false, (e as Error).message));
        }
        if (strandedPushOk) {
          steps.push(step("stranded: push-branch T-2", "pushed", true, strandedBranch));

          const strandedReason: ParkReason = {
            k: "unanswered-question",
            question,
            askedAt: askedAtFromJournal ?? new Date().toISOString(),
          };
          const strandedCommentText = parkCommentText(
            strandedReason,
            strandedBranch,
            "shelved, Park crashed after release-claim",
          );
          const strandedCommentPrompt = buildPrompt(commentQuestion("T-2", strandedCommentText), phrasebook, COMMENT_SHAPE);
          const strandedCommentOutcome = askWithRetry(
            runner,
            { k: "tracker.comment", issue: "T-2", text: strandedCommentText },
            strandedCommentPrompt,
          );
          const strandedCommentAskOk =
            strandedCommentOutcome.status !== "failed" && strandedCommentOutcome.answer.result === "ok";
          steps.push(
            step(
              "stranded: post-comment T-2",
              strandedCommentOutcome.status,
              strandedCommentAskOk,
              strandedCommentOutcome.status === "failed" ? strandedCommentOutcome.whys[1] : undefined,
            ),
          );
          const strandedCommentFileOk =
            readFixtureBody("T-2").includes("Unanswered question") && readFixtureBody("T-2").includes(question);
          steps.push(
            step("verify file: stranded comment landed", strandedCommentFileOk ? "found" : "missing", strandedCommentFileOk),
          );

          // The real unclaimed tickets read off the fixture — not a
          // hand-picked array of only the one that qualifies. T-1 (state
          // unstarted) and T-3 (state unstarted) are filtered out by
          // reconcileClaims itself; only T-2 (state started, unclaimed)
          // is the stranded signature.
          const unclaimedTickets = ["T-1", "T-2", "T-3"].map(readFixtureTicket);
          const strandedInput: RecoveryInput = {
            claimed: [],
            unclaimed: unclaimedTickets,
            originBranches: originBranchNames(repo.origin),
            actor,
            journal: null,
            parkCommented: strandedCommentFileOk ? ["T-2"] : [],
          };
          const strandedDecisions = reconcileClaims(strandedInput);
          const strandedDecision = strandedDecisions[0];
          const expectedRemaining = ["swap-label", "set-unstarted"];
          const strandedOk =
            strandedDecisions.length === 1 &&
            strandedDecision !== undefined &&
            strandedDecision.k === "resume-park" &&
            strandedDecision.ticket === "T-2" &&
            strandedDecision.branch === strandedBranch &&
            strandedDecision.remaining.join(",") === expectedRemaining.join(",");
          steps.push(
            step(
              "recovery: stranded ticket (resume-park)",
              strandedDecision?.k ?? "none",
              strandedOk,
              JSON.stringify(strandedDecision),
            ),
          );
        }
      }
    } else {
      steps.push(step("park + recovery", "skipped", false, "claim did not succeed"));
    }

    printSteps(steps);
    const allOk = steps.every((s) => s.ok);
    console.log(`\noverall: ${allOk ? "PASS" : "FAIL"}`);
    if (!allOk) process.exitCode = 1;
  } finally {
    if (repo) rmParkRepo(repo);
    down();
  }
}

main();
