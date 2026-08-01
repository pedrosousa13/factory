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
  readFixtureBody,
  readFixtureField,
  readFixtureTicket,
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
