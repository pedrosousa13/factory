/**
 * Parity slice — local markdown tracker fixture.
 *
 * bun fixture.ts up|down|show
 *
 * THROWAWAY: no tests, no error handling beyond what keeps it runnable.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ───────────────────────────────────────────────────────────── tracker paths

export const TRACKER_DIR = join(import.meta.dir, "tracker");
export const TICKETS_DIR = join(TRACKER_DIR, "tickets");

// ──────────────────────────────────────────────────────────────── ticket data

export type Ticket = {
  id: string;
  title: string;
  state: string;
  urgency: string;
  createdAt: string;
  milestone: string | null;
  ready: boolean;
  claimedBy: string | null;
  blockedBy: string[];
  body: string;
};

const TICKETS: Ticket[] = [
  {
    id: "T-1",
    title: "Old P1 fixture",
    state: "unstarted",
    urgency: "P1",
    createdAt: "2026-07-01T10:00:00Z",
    milestone: null,
    ready: true,
    claimedBy: null,
    blockedBy: [],
    body: "Fixture ticket: the older of the two P1s — the expected deterministic pick.",
  },
  {
    id: "T-2",
    title: "New P1 fixture",
    state: "unstarted",
    urgency: "P1",
    createdAt: "2026-07-20T10:00:00Z",
    milestone: null,
    ready: true,
    claimedBy: null,
    blockedBy: [],
    body: "Fixture ticket: the newer of the two P1s.",
  },
  {
    id: "T-3",
    title: "Blocked P0 fixture",
    state: "unstarted",
    urgency: "P0",
    createdAt: "2026-07-10T10:00:00Z",
    milestone: null,
    ready: true,
    claimedBy: null,
    blockedBy: ["T-1"],
    body: "Fixture ticket: highest urgency, but blocked by T-1.",
  },
];

// ───────────────────────────────────────────────────────────────── rendering

export function renderTicket(t: Ticket): string {
  return `---
id: ${t.id}
title: ${t.title}
state: ${t.state}
urgency: ${t.urgency}
createdAt: ${t.createdAt}
milestone: ${t.milestone ?? "null"}
ready: ${t.ready}
claimedBy: ${t.claimedBy ?? "null"}
blockedBy: [${t.blockedBy.join(", ")}]
---

${t.body}
`;
}

// ──────────────────────────────────────────────────────────────────── commands

// extraTickets: additional tickets a caller wants written alongside the
// committed default three (e.g. a bin's own setup ticket). The committed
// default is unchanged; extras are appended, not substituted.
export function up(extraTickets: Ticket[] = []): void {
  if (existsSync(TRACKER_DIR)) rmSync(TRACKER_DIR, { recursive: true });
  mkdirSync(TICKETS_DIR, { recursive: true });
  const all = [...TICKETS, ...extraTickets];
  for (const t of all) writeFileSync(join(TICKETS_DIR, `${t.id}.md`), renderTicket(t));
  console.log(`up: wrote ${all.length} tickets to ${TICKETS_DIR}`);
}

export function down(): void {
  if (existsSync(TRACKER_DIR)) rmSync(TRACKER_DIR, { recursive: true });
  console.log(`down: removed ${TRACKER_DIR}`);
}

export function show(): void {
  if (!existsSync(TICKETS_DIR)) {
    console.log(`show: ${TICKETS_DIR} does not exist`);
    return;
  }
  const files = readdirSync(TICKETS_DIR).filter((f) => f.endsWith(".md")).sort();
  for (const f of files) {
    const frontmatter = readFileSync(join(TICKETS_DIR, f), "utf8").split("---")[1]?.trim();
    console.log(`## ${f}\n${frontmatter}\n`);
  }
}

// ───────────────────────────────────────────── shared conformance material
//
// EXTRA_TICKETS, the ask-answer shape strings, the ask question strings, and
// readFixtureField() below were byte-identical between runtime/bin/pick.ts
// and runtime/conformance/sweep.ts — both exercise the same fixture with the
// same fourth ticket, the same answer shapes, and the same questions. One
// definition here, imported by both.

// The fourth fixture ticket: blocked by an invisible id (no file for T-9) so
// the needsRead / fail-safe path runs live — a read on T-9 answers "missing",
// and per the fail-safe rule an unresolved blocker keeps the ticket blocked.
export const EXTRA_TICKETS: Ticket[] = [
  {
    id: "T-4",
    title: "Blocked-by-invisible-ticket fixture",
    state: "unstarted",
    urgency: "P0",
    createdAt: "2026-07-15T10:00:00Z",
    milestone: null,
    ready: true,
    claimedBy: null,
    blockedBy: ["T-9"],
    body: "Fixture ticket: blocked by an invisible id (T-9, no file) — forces the needsRead / fail-safe path live.",
  },
];

// ───────────────────────────────────────────────────────────── prompt shapes

export const TICKET_FACTS_SHAPE = `type TicketFacts = {
  id: string;
  title: string;
  urgency: "P0" | "P1" | "P2" | "P3" | "none";
  createdAt: string; // ISO 8601
  milestone: string | null;
  ready: boolean;
  state: "unstarted" | "started" | "parked" | "done" | "canceled";
  claimedBy: string | null;
  blockedBy: string[]; // ids of still-open tickets blocking this one
};`;

export const CANDIDATES_SHAPE = `${TICKET_FACTS_SHAPE}
type CandidatesAnswer = { result: "ok"; tickets: TicketFacts[] };`;

export const READ_SHAPE = `${TICKET_FACTS_SHAPE}
type ReadAnswer =
  | { result: "ok"; ticket: TicketFacts; body: string; comments: string[] }
  | { result: "missing" };`;

export const CLAIM_SHAPE = `type ClaimAnswer = { result: "claimed" } | { result: "taken"; by: string };`;

export const SET_STATE_SHAPE = `type SetStateAnswer = { result: "ok" };`;

export const UNCLAIM_SHAPE = `type UnclaimAnswer = { result: "ok" };`;

// ───────────────────────────────────────────────────────────── ask questions

export const CANDIDATES_QUESTION =
  "List every ticket in this project's tracker that is ready, unstarted, and unclaimed, with full facts for each. There is no milestone scope in play right now — list tickets from every milestone.";

export function readQuestion(id: string): string {
  return `Give me the full facts, body, and comments for ticket ${id} in this project's tracker.`;
}

export function claimQuestion(issue: string, actor: string): string {
  return `Claim ticket ${issue} in this project's tracker for actor "${actor}".`;
}

export function startedQuestion(issue: string): string {
  return `Set ticket ${issue}'s state to "started" in this project's tracker.`;
}

export function unclaimQuestion(issue: string): string {
  return `Release the claim on ticket ${issue} in this project's tracker.`;
}

// ───────────────────────────────────────────────────────────── fixture reads

// "Verify file" per the brief: read the fixture's own frontmatter directly
// off disk, rather than trusting another harness ask — the ground truth for
// what an act actually did.
export function readFixtureField(id: string, field: "claimedBy" | "state"): string | null {
  const text = readFileSync(join(TICKETS_DIR, `${id}.md`), "utf8");
  const match = text.match(new RegExp(`^${field}: (.*)$`, "m"));
  if (!match) throw new Error(`fixture file for ${id} has no ${field} field`);
  return match[1] === "null" ? null : match[1];
}

// ──────────────────────────────────────────────────────────────────────── main

// Guarded: the prototype's version of this block ran unconditionally on
// import, so importing fixture.ts elsewhere (e.g. sweep.ts) tripped
// process.exit(1) whenever the importer's own argv didn't match
// up|down|show. That was a recorded seam — see task-5 brief.
if (import.meta.main) {
  const cmd = process.argv[2];
  if (cmd === "up") up();
  else if (cmd === "down") down();
  else if (cmd === "show") show();
  else {
    console.error("usage: bun fixture.ts up|down|show");
    process.exit(1);
  }
}
