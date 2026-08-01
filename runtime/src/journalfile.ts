// Edge module (fs allowed): the journal's file edge — reading, writing, and
// clearing `.factory/journal.json` (PRD §5 item 8). No decision logic lives
// here; parsing/rendering stays delegated to journal.ts, the pure module
// this gives an fs edge to.
//
// The journal is a hint, not truth, so every read failure — missing file,
// unreadable file, garbled content — collapses to the same "no journal"
// answer journal.ts's parseJournal already returns for garbled text; this
// module just makes a failed read equivalent to it, never a throw.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JOURNAL_PATH, parseJournal, renderJournal } from "./journal";
import type { JournalRecord, ParseJournalResult } from "./journal";

export { JOURNAL_PATH };

/**
 * The record last written, or `{ ok: false }` for anything that isn't a
 * usable journal — file absent, unreadable, or content parseJournal can't
 * make sense of. Parsing itself is entirely journal.ts's job: this only
 * turns "couldn't read the file" into the same shape parseJournal already
 * uses for "couldn't read the content".
 */
export function readJournal(repoRoot: string): ParseJournalResult {
  let text: string;
  try {
    text = readFileSync(join(repoRoot, JOURNAL_PATH), "utf8");
  } catch {
    return { ok: false };
  }
  return parseJournal(text);
}

/** Overwrites the journal file whole, creating `.factory/` first if it isn't there yet. */
export function writeJournal(repoRoot: string, record: JournalRecord): void {
  mkdirSync(join(repoRoot, ".factory"), { recursive: true });
  writeFileSync(join(repoRoot, JOURNAL_PATH), renderJournal(record));
}

/** Removes the journal file. Clearing an already-clear (or never-written) journal is a no-op. */
export function clearJournal(repoRoot: string): void {
  rmSync(join(repoRoot, JOURNAL_PATH), { force: true });
}

/**
 * The claim-time write recovery.ts's INVARIANT comment requires: the journal
 * must be overwritten when a ticket is claimed, before any work on it
 * begins, or a journal left behind by an already-finished Park reads back
 * indistinguishably from a live interrupted one.
 *
 * `openQuestion` is not a parameter: there is no way to hand this function a
 * prior cycle's open question even by mistake, so the one invariant that
 * matters is enforced by the signature, not by caller discipline. `branch`
 * is still taken as an argument — the caller derives it the same way
 * recovery.ts does (pick.ts's branchName off the ticket's current title)
 * before the claim, since recovery re-derives rather than trusts it either
 * way; this just journals the value the caller already computed.
 */
export function startClaim(
  repoRoot: string,
  ticket: string,
  branch: string,
  step: string,
  workers: string[] = [],
): void {
  writeJournal(repoRoot, { ticket, branch, step, openQuestion: null, workers });
}
