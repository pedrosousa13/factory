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
import { check, type Ask, type Answer } from "../src/tracker";
import { runHarness, type HarnessName } from "./harnesses";
import { down, TICKETS_DIR, up } from "./fixture";

const DIR = import.meta.dir;
const PHRASEBOOK_PATH = join(DIR, "phrasebook.md");

// ───────────────────────────────────────────────────────────────── prompt

const REACHABLE_SHAPE = `type ReachableAnswer = { result: "ok" } | { result: "unreachable"; why: string };`;

const VERIFY_SHAPE = `type VerifyAnswer =
  | { result: "ok"; state: "unstarted" | "started" | "parked" | "done" | "canceled"; claimedBy: string | null }
  | { result: "missing" };`;

function buildPrompt(question: string, phrasebook: string, shape: string): string {
  return [question, "", phrasebook, "", shape, "", "Reply with ONLY that JSON, no prose."].join("\n");
}

// ─────────────────────────────────────────────────────────── extract + validate

/** Strip a wrapping code fence if present, then take the first balanced {...} value. */
function extractJson(raw: string): unknown {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf("{");
  if (start === -1) throw new Error("no { found in response");
  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error("no matching } found in response");
  return JSON.parse(text.slice(start, end + 1));
}

function validate(ask: Ask, raw: string): { ok: true; answer: Answer[Ask["k"]] } | { ok: false; why: string } {
  let parsed: unknown;
  try {
    parsed = extractJson(raw);
  } catch (e) {
    return { ok: false, why: `could not extract JSON: ${(e as Error).message}` };
  }
  return check(ask, parsed);
}

// ──────────────────────────────────────────────────────────────── ask + reask

type AskStatus = "valid-first-try" | "valid-after-reask" | "failed";
type AskLog<K extends Ask["k"]> = { status: AskStatus; answer?: Answer[K]; why?: string; ms: number };

/** runHarness() throws on a malformed CLI envelope — treat that the same as an invalid reply. */
function runHarnessSafe(harness: HarnessName, prompt: string): { raw: string; ms: number } | { error: string; ms: number } {
  const start = performance.now();
  try {
    const run = runHarness(harness, prompt, DIR);
    return { raw: run.raw, ms: run.ms };
  } catch (e) {
    return { error: (e as Error).message, ms: Math.round(performance.now() - start) };
  }
}

function askWithRetry<K extends Ask["k"]>(harness: HarnessName, ask: Ask & { k: K }, prompt: string): AskLog<K> {
  const r1 = runHarnessSafe(harness, prompt);
  const v1 = "raw" in r1 ? validate(ask, r1.raw) : ({ ok: false, why: `harness threw: ${r1.error}` } as const);
  if (v1.ok) return { status: "valid-first-try", answer: v1.answer as Answer[K], ms: r1.ms };

  const reaskPrompt = `${prompt}\n\nYour previous reply was invalid: ${v1.why}\nReply again with ONLY the corrected JSON, no prose.`;
  const r2 = runHarnessSafe(harness, reaskPrompt);
  const v2 = "raw" in r2 ? validate(ask, r2.raw) : ({ ok: false, why: `harness threw: ${r2.error}` } as const);
  const ms = r1.ms + r2.ms;
  if (v2.ok) return { status: "valid-after-reask", answer: v2.answer as Answer[K], ms };
  return { status: "failed", why: v2.why, ms };
}

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

  const reachableQuestion = "Can this project's tracker be reached right now?";
  const reachablePrompt = buildPrompt(reachableQuestion, phrasebook, REACHABLE_SHAPE);
  const reachableLog = askWithRetry(harness, { k: "tracker.reachable" }, reachablePrompt);
  const reachableOk = reachableLog.status !== "failed" && reachableLog.answer?.result === "ok";
  console.log(
    `  reachable: ${reachableLog.status}${reachableLog.why ? ` — ${reachableLog.why}` : ""} (expected ok: ${reachableOk ? "yes" : "no"})`,
  );

  const verifyQuestion = "What is the current state of ticket T-1 in this project's tracker?";
  const verifyPrompt = buildPrompt(verifyQuestion, phrasebook, VERIFY_SHAPE);
  const verifyLog = askWithRetry(harness, { k: "tracker.verify", issue: "T-1" }, verifyPrompt);
  const verifyAnswer = verifyLog.answer as Answer["tracker.verify"] | undefined;
  const verifyOk =
    verifyLog.status !== "failed" &&
    verifyAnswer?.result === "ok" &&
    verifyAnswer.state === "unstarted" &&
    verifyAnswer.claimedBy === null;
  console.log(
    `  verify T-1: ${verifyLog.status}${verifyLog.why ? ` — ${verifyLog.why}` : ""} (expected ok/unstarted/null: ${verifyOk ? "yes" : "no"})`,
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
    totalMs: reachableLog.ms + verifyLog.ms,
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
