/**
 * Parity slice — host loop.
 *
 * Drives the same three-ask slice (candidates → claim → unclaim) through
 * claude, codex, and pi, using one shared prompt template for all three —
 * no per-harness prompt tweaks. Validates every answer with contract.ts's
 * check(), re-asking once on a bad answer; two failures in a row records the
 * ask as failed and skips whatever asks were left for that harness. Claim
 * and unclaim are also verified against the tracker file itself, not just
 * against what the agent said.
 *
 * bun run.ts
 *
 * THROWAWAY: no tests, no error handling beyond what keeps it runnable.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { check, queueOrder, type Ask, type Answer, type CandidatesAnswer, type ClaimAnswer, type TicketFacts } from "./contract";
import { runHarness, type HarnessName } from "./harnesses";

// ─────────────────────────────────────────────────────────────────── paths

// fixture.ts's own trailing CLI-dispatch block runs process.exit(1) on import
// with no argv match, so it can't be imported here — shell out instead, and
// recompute the path it would have exported.
const PROTO_DIR = import.meta.dir;
const TICKETS_DIR = join(PROTO_DIR, "tracker", "tickets");
const PHRASEBOOK_PATH = join(PROTO_DIR, "phrasebook.md");

function resetFixture(): void {
  const proc = Bun.spawnSync(["bun", "fixture.ts", "up"], { cwd: PROTO_DIR, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(`fixture reset failed (exit ${proc.exitCode}): ${proc.stderr.toString()}`);
}

function fileClaimedBy(id: string): string | null {
  const text = readFileSync(join(TICKETS_DIR, `${id}.md`), "utf8");
  const m = text.match(/^claimedBy:\s*(.+)$/m);
  if (!m) throw new Error(`claimedBy field not found in ${id}.md`);
  const v = m[1].trim();
  return v === "null" ? null : v;
}

// ───────────────────────────────────────────────────────────────── prompt

const CANDIDATES_SHAPE = `type TicketFacts = {
  id: string; // tracker-native identity, opaque to Factory
  title: string;
  urgency: "P0" | "P1" | "P2" | "P3" | "none";
  createdAt: string; // ISO 8601
  milestone: string | null;
  ready: boolean; // carries the ready-for-agent marker
  state: "unstarted" | "started" | "parked" | "done" | "canceled";
  claimedBy: string | null; // actor holding the claim, if any
  blockedBy: string[]; // ids of still-open tickets blocking this one
};

type CandidatesAnswer = { result: "ok"; tickets: TicketFacts[] };`;

const CLAIM_SHAPE = `type ClaimAnswer = { result: "claimed" } | { result: "taken"; by: string };`;

const UNCLAIM_SHAPE = `type UnclaimAnswer = { result: "ok" };`;

function buildPrompt(question: string, phrasebook: string, shape: string): string {
  return [question, "", phrasebook, "", shape, "", "Reply with ONLY that JSON, no prose."].join("\n");
}

// ─────────────────────────────────────────────────────────────── extract + validate

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
type AskLog<T> = { status: AskStatus; answer?: T; why?: string; ms: number };

function askWithRetry<K extends Ask["k"]>(harness: HarnessName, ask: Ask & { k: K }, prompt: string): AskLog<Answer[K]> {
  const r1 = runHarness(harness, prompt, PROTO_DIR);
  const v1 = validate(ask, r1.raw);
  if (v1.ok) return { status: "valid-first-try", answer: v1.answer as Answer[K], ms: r1.ms };

  const reaskPrompt = `${prompt}\n\nYour previous reply was invalid: ${v1.why}\nReply again with ONLY the corrected JSON, no prose.`;
  const r2 = runHarness(harness, reaskPrompt, PROTO_DIR);
  const v2 = validate(ask, r2.raw);
  const ms = r1.ms + r2.ms;
  if (v2.ok) return { status: "valid-after-reask", answer: v2.answer as Answer[K], ms };
  return { status: "failed", why: v2.why, ms };
}

// ─────────────────────────────────────────────────────────────────── decide

function isBlocked(ticket: TicketFacts, all: TicketFacts[]): boolean {
  const byId = new Map(all.map((t) => [t.id, t]));
  return ticket.blockedBy.some((id) => {
    const blocker = byId.get(id);
    if (!blocker) return false; // blocker not in the returned list — can't tell, assume clear
    return blocker.state !== "done" && blocker.state !== "canceled";
  });
}

// ───────────────────────────────────────────────────────────────── per-harness slice

type HarnessRecord = {
  harness: HarnessName;
  candidates: AskStatus;
  pickIsT1: boolean | null;
  claim: AskStatus | null;
  claimVerify: "verified" | "claimed-but-file-untouched" | null;
  unclaim: AskStatus | null;
  unclaimVerify: "verified" | "claimed-but-file-untouched" | null;
  reasks: number;
  totalMs: number;
};

function runSlice(harness: HarnessName, phrasebook: string): HarnessRecord {
  console.log(`\n=== ${harness} ===`);
  resetFixture();

  const record: HarnessRecord = {
    harness,
    candidates: "failed",
    pickIsT1: null,
    claim: null,
    claimVerify: null,
    unclaim: null,
    unclaimVerify: null,
    reasks: 0,
    totalMs: 0,
  };

  // Ask 1 — candidates
  const candidatesQuestion =
    "List the tickets in this project's tracker that are ready for an agent, unstarted, and unclaimed.";
  const candidatesPrompt = buildPrompt(candidatesQuestion, phrasebook, CANDIDATES_SHAPE);
  const candidatesLog = askWithRetry(harness, { k: "tracker.candidates", milestone: null }, candidatesPrompt);
  record.candidates = candidatesLog.status;
  record.totalMs += candidatesLog.ms;
  if (candidatesLog.status === "valid-after-reask") record.reasks += 1;

  if (candidatesLog.status === "failed") {
    console.log(`  candidates: FAILED — ${candidatesLog.why}`);
    return record;
  }

  const tickets = (candidatesLog.answer as CandidatesAnswer).tickets;
  const open = tickets.filter((t) => !isBlocked(t, tickets));
  const sorted = [...open].sort(queueOrder);
  const pick = sorted[0];

  if (!pick) {
    console.log(`  candidates: ${candidatesLog.status}, but no eligible (unblocked) ticket — skipping claim/unclaim`);
    return record;
  }
  record.pickIsT1 = pick.id === "T-1";
  console.log(`  candidates: ${candidatesLog.status}, picked ${pick.id} (T-1? ${record.pickIsT1 ? "yes" : "no"})`);

  // Ask 2 — claim
  const actor = `parity-${harness}`;
  const claimQuestion = `Claim ticket ${pick.id} in this project's tracker for actor "${actor}".`;
  const claimPrompt = buildPrompt(claimQuestion, phrasebook, CLAIM_SHAPE);
  const claimLog = askWithRetry(harness, { k: "tracker.claim", issue: pick.id, actor }, claimPrompt);
  record.claim = claimLog.status;
  record.totalMs += claimLog.ms;
  if (claimLog.status === "valid-after-reask") record.reasks += 1;

  if (claimLog.status === "failed") {
    console.log(`  claim: FAILED — ${claimLog.why}`);
    return record;
  }

  const claimAnswer = claimLog.answer as ClaimAnswer;
  if (claimAnswer.result === "claimed") {
    record.claimVerify = fileClaimedBy(pick.id) === actor ? "verified" : "claimed-but-file-untouched";
  } else {
    console.log(`  claim: answered "taken" by ${claimAnswer.by} (unexpected on a freshly reset fixture)`);
    record.claimVerify = fileClaimedBy(pick.id) === actor ? "verified" : "claimed-but-file-untouched";
  }
  console.log(`  claim: ${claimLog.status}, verify: ${record.claimVerify}`);

  // Ask 3 — unclaim
  const unclaimQuestion = `Release the claim on ticket ${pick.id} in this project's tracker.`;
  const unclaimPrompt = buildPrompt(unclaimQuestion, phrasebook, UNCLAIM_SHAPE);
  const unclaimLog = askWithRetry(harness, { k: "tracker.unclaim", issue: pick.id }, unclaimPrompt);
  record.unclaim = unclaimLog.status;
  record.totalMs += unclaimLog.ms;
  if (unclaimLog.status === "valid-after-reask") record.reasks += 1;

  if (unclaimLog.status === "failed") {
    console.log(`  unclaim: FAILED — ${unclaimLog.why}`);
    return record;
  }

  record.unclaimVerify = fileClaimedBy(pick.id) === null ? "verified" : "claimed-but-file-untouched";
  console.log(`  unclaim: ${unclaimLog.status}, verify: ${record.unclaimVerify}`);

  return record;
}

// ────────────────────────────────────────────────────────────────── report

function printTable(records: HarnessRecord[]): void {
  const cols = ["harness", "candidates", "pick T-1?", "claim+verify", "unclaim+verify", "re-asks", "total s"];
  const rows = records.map((r) => [
    r.harness,
    r.candidates,
    r.pickIsT1 === null ? "n/a" : r.pickIsT1 ? "yes" : "no",
    r.claim === null ? "n/a" : `${r.claim}/${r.claimVerify ?? "n/a"}`,
    r.unclaim === null ? "n/a" : `${r.unclaim}/${r.unclaimVerify ?? "n/a"}`,
    String(r.reasks),
    (r.totalMs / 1000).toFixed(1),
  ]);
  const widths = cols.map((c, i) => Math.max(c.length, ...rows.map((row) => row[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log("\n=== comparison ===");
  console.log(line(cols));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(line(row));
}

// ──────────────────────────────────────────────────────────────────── main

function main(): void {
  if (!existsSync(TICKETS_DIR)) {
    console.error(`${TICKETS_DIR} not found — run "bun fixture.ts up" first.`);
    process.exit(1);
  }
  const phrasebook = readFileSync(PHRASEBOOK_PATH, "utf8");
  const harnesses: HarnessName[] = ["claude", "codex", "pi"];
  const records = harnesses.map((h) => runSlice(h, phrasebook));
  printTable(records);
}

main();
