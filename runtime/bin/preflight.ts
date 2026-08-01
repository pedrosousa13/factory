#!/usr/bin/env bun
// Edge entry (bun, fs + git allowed): gathers preflight facts for the
// current directory, optionally asks a live harness whether the tracker is
// reachable, turns the facts into a verdict via the pure preflight.ts, and
// reports per PROTOCOL.md's rule — "When every check passes, say nothing":
// silent exit 0 on green, every failure's what/why/fix on red.
//
// bun preflight.ts [--ask-reachable <claude|codex|pi>]

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ADAPTER_DOC_PATH, gatherPreflightFacts } from "../src/edges";
import { preflight, type Failure, type TrackerReachable } from "../src/preflight";
import { runHarness, type HarnessName } from "../src/harness";
import { askWithRetry, buildPrompt, type Runner } from "../src/askloop";
import { resolveRoles, roleReport } from "../src/roles";

const REPO_ROOT = process.cwd();

const REACHABLE_QUESTION = "Can this project's tracker be reached right now?";
const REACHABLE_SHAPE = `type ReachableAnswer = { result: "ok" } | { result: "unreachable"; why: string };`;

// ───── the optional --ask-reachable question

// Runs the tracker.reachable ask against a live harness using the repo's own
// phrasebook — which, per the PRD (§2), *is* docs/agents/issue-tracker.md:
// the same adapter doc the marker check reads. Only meaningful once the
// repo is stamped with that doc; an unstamped repo has no phrasebook to ask
// through, so this reports "not-asked" and leaves it to preflight.ts's own
// excusal logic (an already-failing adapter marker) to explain why.
function askReachable(harnessName: HarnessName): TrackerReachable {
  const docPath = join(REPO_ROOT, ADAPTER_DOC_PATH);
  if (!existsSync(docPath)) return "not-asked";

  const phrasebook = readFileSync(docPath, "utf8");
  const prompt = buildPrompt(REACHABLE_QUESTION, phrasebook, REACHABLE_SHAPE);
  const runner: Runner = (p) => runHarness(harnessName, p, REPO_ROOT);
  const outcome = askWithRetry(runner, { k: "tracker.reachable" }, prompt);

  if (outcome.status === "failed") {
    return {
      result: "unreachable",
      why: `harness gave no valid answer after a re-ask: ${outcome.whys[0]} / ${outcome.whys[1]}`,
    };
  }
  return outcome.answer;
}

// ───── flag parsing

function parseAskReachable(argv: string[]): HarnessName | undefined {
  const i = argv.indexOf("--ask-reachable");
  if (i === -1) return undefined;

  const name = argv[i + 1];
  if (name === "claude" || name === "codex" || name === "pi") return name;

  console.error("--ask-reachable requires one of: claude, codex, pi");
  process.exit(1);
}

// ───── report

function report(failures: Failure[]): void {
  for (const f of failures) {
    console.error(f.what);
    console.error(`  ${f.why}`);
    console.error(`  Fix: ${f.fix}`);
    console.error("");
  }
}

// ───── main

function main(): void {
  const harnessName = parseAskReachable(process.argv.slice(2));
  const trackerReachable: TrackerReachable = harnessName ? askReachable(harnessName) : "not-asked";

  const facts = gatherPreflightFacts(REPO_ROOT, { trackerReachable, home: process.env.HOME ?? "" });
  const result = preflight(facts);

  if (result.ok) {
    const roles = resolveRoles(facts.availableRoles);
    if (roles.resolved.some((s) => s.via === "fallback")) {
      console.log("planning roles:");
      console.log(roleReport(roles.resolved));
    }
    process.exit(0);
  }

  report(result.failures);
  process.exit(1);
}

main();
