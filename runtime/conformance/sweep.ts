/**
 * L2 conformance sweep — reachable + verify.
 *
 * For each harness (claude, codex, pi): reset the local markdown tracker
 * fixture, then ask two of Factory's tracker asks against it —
 * `tracker.reachable` and `tracker.verify` on T-1 — using one shared prompt
 * template (question + phrasebook + answer shape + "reply with ONLY that
 * JSON"), no per-harness prompt tweaks. Answers are validated with `check()`
 * from runtime/src/tracker.ts; one re-ask on a malformed or thrown reply.
 * Prints an honest per-harness scoreboard and exits non-zero if any harness
 * fails either ask.
 *
 * bun sweep.ts
 *
 * THROWAWAY: no tests, no error handling beyond what keeps it runnable.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Answer } from "../src/tracker";
import { askWithRetry, buildPrompt, type AskStatus, type Runner } from "../src/askloop";
import { runHarness, type HarnessName } from "./harnesses";
import { down, TICKETS_DIR, up } from "./fixture";

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
  reasks: number;
  totalMs: number;
  pass: boolean;
};

function runOne(harness: HarnessName, phrasebook: string): HarnessRecord {
  console.log(`\n=== ${harness} ===`);
  up();
  if (!existsSync(join(TICKETS_DIR, "T-1.md"))) {
    throw new Error(`fixture reset did not produce ${join(TICKETS_DIR, "T-1.md")}`);
  }

  const runner: Runner = (prompt) => runHarness(harness, prompt, DIR);

  const reachableQuestion = "Can this project's tracker be reached right now?";
  const reachablePrompt = buildPrompt(reachableQuestion, phrasebook, REACHABLE_SHAPE);
  const reachableStart = performance.now();
  const reachableLog = askWithRetry(runner, { k: "tracker.reachable" }, reachablePrompt);
  const reachableMs = Math.round(performance.now() - reachableStart);
  const reachableOk = reachableLog.status !== "failed" && reachableLog.answer.result === "ok";
  console.log(
    `  reachable: ${reachableLog.status}${reachableLog.status === "failed" ? ` — ${reachableLog.whys[1]}` : ""} (expected ok: ${reachableOk ? "yes" : "no"})`,
  );

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

  const reasks =
    (reachableLog.status === "valid-after-reask" ? 1 : 0) + (verifyLog.status === "valid-after-reask" ? 1 : 0);

  return {
    harness,
    reachable: reachableLog.status,
    reachableOk,
    verify: verifyLog.status,
    verifyOk,
    reasks,
    totalMs: reachableMs + verifyMs,
    pass: reachableOk && verifyOk,
  };
}

// ────────────────────────────────────────────────────────────────── report

function printTable(records: HarnessRecord[]): void {
  const cols = ["harness", "reachable", "ok?", "verify T-1", "ok?", "re-asks", "total s", "pass"];
  const rows = records.map((r) => [
    r.harness,
    r.reachable,
    r.reachableOk ? "yes" : "no",
    r.verify,
    r.verifyOk ? "yes" : "no",
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
