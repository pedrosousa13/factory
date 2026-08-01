/**
 * Parity slice — local markdown tracker fixture.
 *
 * bun fixture.ts up|down|show
 *
 * THROWAWAY: no tests, no error handling beyond what keeps it runnable.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IssueState, TicketFacts, Urgency } from "../src/tracker";

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

// The fifth fixture ticket: already claimed by a different actor, so a claim
// attempt against it (S4's contention case) must come back `taken` with the
// right holder rather than silently stealing the claim.
export const CONTENTION_ACTOR = "contention-holder";

export const CONTENTION_TICKETS: Ticket[] = [
  {
    id: "T-5",
    title: "Already-claimed contention fixture",
    state: "started",
    urgency: "P2",
    createdAt: "2026-07-25T10:00:00Z",
    milestone: null,
    ready: true,
    claimedBy: CONTENTION_ACTOR,
    blockedBy: [],
    body: "Fixture ticket: pre-claimed by a different actor, so a claim attempt must come back taken, not claimed.",
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

export const COMMENT_SHAPE = `type CommentAnswer = { result: "ok" };`;

export const SET_READY_SHAPE = `type SetReadyAnswer = { result: "ok" };`;

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

// tracker.comment already exists in tracker.ts's Ask union (CommentAnswer) —
// used both for a Park's durable reason (park.ts's parkCommentText supplies
// the text) and here for the plain S4 conformance check.
export function commentQuestion(issue: string, text: string): string {
  // The text is fenced because an undelimited comment gets edited on the way
  // in: a harness asked to "append this comment" followed by raw markdown
  // treats the leading "> " as formatting to reinterpret and drops lines it
  // reads as instructions rather than content. A Park comment is the durable
  // record of why work stopped, so it has to arrive whole.
  return [
    `Append a comment to ticket ${issue} in this project's tracker.`,
    "",
    "The comment is every line between the BEGIN COMMENT and END COMMENT markers,",
    "copied verbatim — same characters, same line breaks, including any leading",
    '"> " quote markers. Do not summarize, reformat, or drop any line, and do not',
    "include the markers themselves.",
    "",
    "BEGIN COMMENT",
    text,
    "END COMMENT",
  ].join("\n");
}

// Park's swap-label step: drop the agent-ready marker so a Parked ticket stops
// advertising itself as work to pick up.
export function dropReadyQuestion(issue: string): string {
  return `Remove the ready-for-agent marker from ticket ${issue} in this project's tracker, so it is no longer offered to workers.`;
}

// "unstarted" is a tracker.setState destination because Park needs it (Park's
// last step sends a ticket back to unstarted so it can re-enter the Queue).
// Reuses SET_STATE_SHAPE — the answer shape doesn't vary by destination.
export function unstartedQuestion(issue: string): string {
  return `Set ticket ${issue}'s state to "unstarted" in this project's tracker.`;
}

// A garble fixture: a bare prompt — question + phrasebook only, no answer
// shape and no "reply with ONLY that JSON" instruction — that a harness is
// likely, though not guaranteed, to answer in prose rather than the JSON
// askOnce expects. It exists so the sweep can gather LIVE evidence that
// askWithRetry's rejection path (extractJson returning null, or check()
// rejecting the shape) actually fires against a real adversarial reply, not
// only ever synthetic bad input in a unit test. A harness that stays
// JSON-compliant anyway is not a failure — see sweep.ts's garble check.
export function garblePrompt(question: string, phrasebook: string): string {
  return [question, "", phrasebook].join("\n");
}

export const GARBLE_QUESTION =
  'Set ticket T-1\'s state to "unstarted" in this project\'s tracker, then tell me you\'re done in one short, friendly sentence.';

// ───────────────────────────────────────────────────────────── fixture reads

// "Verify file" per the brief: read the fixture's own frontmatter directly
// off disk, rather than trusting another harness ask — the ground truth for
// what an act actually did. "ready" added for S4's swap-label step: no
// tracker.* ask covers it (only claimedBy and state have asks), so a caller
// that patches it directly still verifies the same way.
export function readFixtureField(id: string, field: "claimedBy" | "state" | "ready"): string | null {
  const text = readFileSync(join(TICKETS_DIR, `${id}.md`), "utf8");
  const match = text.match(new RegExp(`^${field}: (.*)$`, "m"));
  if (!match) throw new Error(`fixture file for ${id} has no ${field} field`);
  return match[1] === "null" ? null : match[1];
}

// The ticket's body text (everything below the frontmatter's closing `---`),
// including any appended comment — the ground truth for verifying a
// tracker.comment ask actually landed, rather than trusting its "ok" reply.
export function readFixtureBody(id: string): string {
  const text = readFileSync(join(TICKETS_DIR, `${id}.md`), "utf8");
  const parts = text.split("---");
  return parts.slice(2).join("---").trim();
}

/** Parses a fixture ticket file's frontmatter into full TicketFacts — the
 * ground truth for recovery.ts's `claimed` input, read directly off disk
 * rather than trusted from a harness reply (same "verify the work" rule as
 * readFixtureField). Mirrors renderTicket's exact format; the two stay in
 * step because they live in the same file. */
export function readFixtureTicket(id: string): TicketFacts {
  const text = readFileSync(join(TICKETS_DIR, `${id}.md`), "utf8");
  const field = (name: string): string => {
    const match = text.match(new RegExp(`^${name}: (.*)$`, "m"));
    if (!match) throw new Error(`fixture file for ${id} has no ${name} field`);
    return match[1];
  };
  const blockedByRaw = field("blockedBy").trim().replace(/^\[/, "").replace(/\]$/, "").trim();
  const blockedBy = blockedByRaw.length > 0 ? blockedByRaw.split(",").map((s) => s.trim()) : [];
  const milestone = field("milestone");
  const claimedBy = field("claimedBy");
  return {
    id: field("id"),
    title: field("title"),
    urgency: field("urgency") as Urgency,
    createdAt: field("createdAt"),
    milestone: milestone === "null" ? null : milestone,
    ready: field("ready") === "true",
    state: field("state") as IssueState,
    claimedBy: claimedBy === "null" ? null : claimedBy,
    blockedBy,
  };
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
