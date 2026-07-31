/**
 * Scratch code-repo fixture — a throwaway git repo with a tiny package for
 * the slice-3 agent.implement capability to edit and commit against.
 *
 * bun coderepo.ts up|down [root]
 *
 * THROWAWAY: no tests, no error handling beyond what keeps it runnable.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
export const IMPLEMENT_SHAPE = `type ImplementResult =
  | { result: "done" }
  | { result: "question"; question: string }
  | { result: "failed"; reason: string };`;

export const CLEAR_BRIEF =
  "On the current branch, edit greet.ts so greet returns 'Hi, ' + name instead of 'Hello, ' + name, " +
  "update check.ts's expectation to match, run `bun check.ts` to confirm it exits 0, and commit the " +
  "change with message 'Change greeting to Hi'. Then reply with ONLY the JSON result.";

export const VAGUE_BRIEF =
  "Improve the greeting. If anything essential is unspecified or ambiguous, do not guess — reply " +
  "with the question variant, asking one precise question.";

/** The shared template: brief + the answer shape + "reply with ONLY that JSON". */
export function implementPrompt(brief: string): string {
  return [brief, "", IMPLEMENT_SHAPE, "", "Reply with ONLY that JSON, no prose."].join("\n");
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
