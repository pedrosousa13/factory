/**
 * Scratch code-repo fixture — a throwaway git repo with a tiny package for
 * the slice-3 agent.implement capability to edit and commit against.
 *
 * bun coderepo.ts up|down [root]
 *
 * THROWAWAY, with one exception: the shared prompt material at the bottom is
 * pinned by runtime/test/coderepo.test.ts, because a silent drift there voids
 * the L2 evidence. No error handling beyond what keeps it runnable.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ───────────────────────────────────────────────────────────────── contents

const GREET_TS = `export function greet(name: string): string {
  return "Hello, " + name;
}
`;

const CHECK_TS = `import { greet } from "./greet";

process.exit(greet("x") === "Hello, x" ? 0 : 1);
`;

// ──────────────────────────────────────────────────────────────────── git

function git(args: string[], cwd: string): void {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdin: "ignore", stdout: "ignore", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
  }
}

// ──────────────────────────────────────────────────────────── mk/rm coderepo

/**
 * Creates a scratch git repo in os.tmpdir with one committed file (greet.ts)
 * and its check gate (check.ts — `bun check.ts` exits 0 iff greet("x") ===
 * "Hello, x"). Local git identity only, no global config touched, no network.
 */
export function mkCodeRepo(): { root: string } {
  const root = mkdtempSync(join(tmpdir(), "factory-coderepo-"));
  git(["init", "-b", "main"], root);
  git(["config", "user.email", "coderepo@factory.local"], root);
  git(["config", "user.name", "Factory Coderepo Fixture"], root);
  writeFileSync(join(root, "greet.ts"), GREET_TS);
  writeFileSync(join(root, "check.ts"), CHECK_TS);
  git(["add", "greet.ts", "check.ts"], root);
  git(["commit", "-m", "Initial commit"], root);
  return { root };
}

export function rmCodeRepo(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

// ────────────────────────────────────────────── shared implement prompt material
//
// Single source for the implement question builders — both the implement bin
// (task 3) and the sweep (task 4) import these rather than each declaring
// their own copy (slice-2 lesson: duplication voids L2 evidence).

/** The ImplementResult type text — kept byte-identical to src/agentwork.ts's ImplementResult. */
export const IMPLEMENT_SHAPE = `export type ImplementResult =
  | { result: "done" }
  | { result: "question"; question: string }
  | { result: "failed"; reason: string };`;

/** The CheckResult type text — kept byte-identical to src/agentwork.ts's CheckResult. */
export const CHECK_SHAPE = `export type CheckResult = { result: "pass" } | { result: "fail"; detail: string };`;

// The branch, the commit message, and the greeting marker CLEAR_BRIEF asks
// for. Both hosts verify the work against these, so they are interpolated
// into the brief rather than hand-copied beside it: a verifier that checks a
// different branch than the brief named would assert nothing.
export const CLEAR_BRIEF_BRANCH = "42-test/greeting";
export const CLEAR_BRIEF_COMMIT = "Change greeting to Hi";
export const CLEAR_BRIEF_MARKER = "Hi, ";

export const CLEAR_BRIEF =
  `Create and switch to a new branch named '${CLEAR_BRIEF_BRANCH}', then edit greet.ts so greet returns ` +
  `'${CLEAR_BRIEF_MARKER}' + name instead of 'Hello, ' + name, update check.ts's expectation to match, run ` +
  `\`bun check.ts\` to confirm it exits 0, and commit the change with message '${CLEAR_BRIEF_COMMIT}'. ` +
  "Then reply with ONLY the JSON result.";

export const VAGUE_BRIEF =
  "Improve the greeting. If anything essential is unspecified or ambiguous, do not guess — reply " +
  "with the question variant, asking one precise question.";

/** The shared template: brief + the answer shape + "reply with ONLY that JSON". */
export function implementPrompt(brief: string): string {
  return [brief, "", IMPLEMENT_SHAPE, "", "Reply with ONLY that JSON, no prose."].join("\n");
}

// ─────────────────────────────────────── shared journal-step prompt (task 11)
//
// The ticket/branch and the prompt that asks for them in one place: sweep.ts
// checks the record it gets back against JOURNAL_CLAIM_RECORD directly,
// rather than re-typing the ticket/branch/step literals a second time and
// risking the check drifting from what the agent was actually told to write.

export const JOURNAL_CLAIM_TICKET = "T-42";
export const JOURNAL_CLAIM_BRANCH = "T-42/claim-check";

/** The exact record the journal-step check's prompt asks the agent to write. */
export const JOURNAL_CLAIM_RECORD = {
  ticket: JOURNAL_CLAIM_TICKET,
  branch: JOURNAL_CLAIM_BRANCH,
  step: "claim",
  openQuestion: null,
  workers: [] as string[],
};

/**
 * Instructs the agent to overwrite `.factory/journal.json` whole with
 * JOURNAL_CLAIM_RECORD, in the setting of a claim on JOURNAL_CLAIM_TICKET.
 * The record is handed over in full rather than derived by the agent, so
 * what this measures is the file edge, not journal conformance. The file it
 * produces on disk is the evidence the sweep checks — not whatever the agent
 * replies with.
 */
export function journalClaimPrompt(): string {
  return (
    `You are performing the claim step for ticket '${JOURNAL_CLAIM_TICKET}' on branch ` +
    `'${JOURNAL_CLAIM_BRANCH}'. At this step boundary, overwrite .factory/journal.json whole (create the ` +
    ".factory directory first if it doesn't exist yet) with exactly this JSON:\n\n" +
    `${JSON.stringify(JOURNAL_CLAIM_RECORD, null, 2)}\n\n` +
    "Then reply with ONLY the word done, no prose."
  );
}

// ────────────────────────────── shared rebase-merge verification (task 11)
//
// bin/implement.ts (task 3, commit d45a6c9) folds a "human"/"rebase" merge
// decision into a real rebase of CLEAR_BRIEF's branch onto main, then proves
// it was a REAL rebase — no merge commit landed on main, and the work commit
// is still reachable from it, not squashed away. The sweep exercises the
// identical sequence, so it lives here once rather than a second copy of the
// git sequence.

function gitTry(args: string[], cwd: string): { stdout: string; exit: number } {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  return { stdout: proc.stdout.toString(), exit: proc.exitCode };
}

export type RebaseMergeResult = { mergeOk: boolean; mainHeadAfter: string };

/**
 * Rebases `branch` onto `main` and fast-forwards `main` to it, then verifies
 * the result: `main` advanced, `main`'s HEAD still carries `marker` (the
 * work), no merge commit landed on `main`, and `branch`'s commit is still
 * reachable from `main` (not squashed away).
 */
export function verifyRebaseMerge(
  root: string,
  branch: string,
  marker: string,
  mainHeadBefore: string,
): RebaseMergeResult {
  gitTry(["switch", branch], root);
  const rebaseRes = gitTry(["rebase", "main"], root);
  gitTry(["switch", "main"], root);
  const ffRes = gitTry(["merge", "--ff-only", branch], root);
  const mainHeadAfter = gitTry(["rev-parse", "main"], root).stdout.trim();
  let greetOnMain: boolean;
  try {
    greetOnMain = readFileSync(join(root, "greet.ts"), "utf8").includes(marker);
  } catch {
    greetOnMain = false;
  }
  const mergesOnMain = gitTry(["log", "--merges", "--oneline", "main"], root).stdout.trim();
  const branchHead = gitTry(["rev-parse", branch], root).stdout.trim();
  const ancestorRes = gitTry(["merge-base", "--is-ancestor", branchHead, "main"], root);
  const mergeOk =
    rebaseRes.exit === 0 &&
    ffRes.exit === 0 &&
    mainHeadAfter !== mainHeadBefore &&
    greetOnMain &&
    mergesOnMain === "" &&
    ancestorRes.exit === 0;
  return { mergeOk, mainHeadAfter };
}

// ──────────────────────────────────────────────────────────────────────── main

if (import.meta.main) {
  const cmd = process.argv[2];
  if (cmd === "up") {
    const { root } = mkCodeRepo();
    console.log(`up: created code repo at ${root}`);
  } else if (cmd === "down") {
    const root = process.argv[3];
    if (!root) {
      console.error("usage: bun coderepo.ts down <root>");
      process.exit(1);
    }
    rmCodeRepo(root);
    console.log(`down: removed ${root}`);
  } else {
    console.error("usage: bun coderepo.ts up|down [root]");
    process.exit(1);
  }
}
