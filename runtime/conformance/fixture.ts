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

type Ticket = {
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

export function up(): void {
  if (existsSync(TRACKER_DIR)) rmSync(TRACKER_DIR, { recursive: true });
  mkdirSync(TICKETS_DIR, { recursive: true });
  for (const t of TICKETS) writeFileSync(join(TICKETS_DIR, `${t.id}.md`), renderTicket(t));
  console.log(`up: wrote ${TICKETS.length} tickets to ${TICKETS_DIR}`);
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
