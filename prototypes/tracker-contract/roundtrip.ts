/**
 * Factory v2 — tracker contract roundtrip demo.
 *
 * Plays four scripted scenes against a fake agent (a plain function mapping
 * an Ask to a canned unknown). Shows: the checker rejects garble, never bad
 * news; Factory decides only on checked answers; two failures on one ask
 * means stop and tell the human.
 *
 * THROWAWAY: no tests, no error handling beyond what keeps it runnable.
 */

import { check, queueOrder, type Ask, type CandidatesAnswer, type TicketFacts } from "./contract.ts";

// ───────────────────────────────────────────────────────────────── printing

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function line(label: "ask" | "agent" | "check" | "factory", text: string): void {
  console.log(`${BOLD}${label.padEnd(8)}${RESET}${DIM}→${RESET} ${text}`);
}

function heading(text: string): void {
  console.log(`\n${BOLD}${text}${RESET}`);
}

// ───────────────────────────────────────────────────────────────── fixtures

const ticketA: TicketFacts = {
  id: "TCKT-1",
  title: "Fix login bug",
  urgency: "P1",
  createdAt: "2026-01-05T00:00:00Z",
  milestone: "v2",
  ready: true,
  state: "unstarted",
  claimedBy: null,
  blockedBy: [],
};

const ticketB: TicketFacts = {
  id: "TCKT-2",
  title: "Add search filter",
  urgency: "P1",
  createdAt: "2026-03-10T00:00:00Z",
  milestone: "v2",
  ready: true,
  state: "unstarted",
  claimedBy: null,
  blockedBy: [],
};

const ticketC: TicketFacts = {
  id: "TCKT-3",
  title: "Migrate database",
  urgency: "P0",
  createdAt: "2026-02-01T00:00:00Z",
  milestone: "v2",
  ready: true,
  state: "unstarted",
  claimedBy: null,
  blockedBy: ["TCKT-9"],
};

// ───────────────────────────────────────────────────────────────── scene 1

function sceneOne(): { picked: TicketFacts; runnerUp: TicketFacts } {
  heading("Scene 1 — clean pick");

  const ask: Ask = { k: "tracker.candidates", milestone: null };
  const raw = { result: "ok", tickets: [ticketA, ticketB, ticketC] };

  line("ask", JSON.stringify(ask));
  line("agent", JSON.stringify(raw));
  const checked = check(ask, raw);
  line("check", checked.ok ? "ok" : `FAIL — ${checked.why}`);

  const { tickets } = (checked as { ok: true; answer: CandidatesAnswer }).answer;
  const open = tickets.filter((t) => t.blockedBy.length === 0);
  const [picked, runnerUp] = [...open].sort(queueOrder);

  line(
    "factory",
    `filtered ${tickets.length - open.length} blocked (${ticketC.id}), picked ${picked.id} ` +
      `"${picked.title}" (${picked.urgency}, oldest of the ${open.length} open)`,
  );
  return { picked, runnerUp };
}

// ───────────────────────────────────────────────────────────────── scene 2

function sceneTwo(ticket: TicketFacts): void {
  heading("Scene 2 — garbled answer");

  const ask: Ask = { k: "tracker.claim", issue: ticket.id, actor: "factory" };
  let attempt = 0;
  const agent = (): unknown => {
    attempt++;
    return attempt === 1 ? { result: "sure, claimed it for you!" } : { result: "claimed" };
  };

  line("ask", JSON.stringify(ask));
  const raw1 = agent();
  line("agent", JSON.stringify(raw1));
  const checked1 = check(ask, raw1);
  line("check", checked1.ok ? "ok" : `FAIL — ${checked1.why}`);
  line("factory", "garbled — re-asking tracker.claim once");

  line("ask", JSON.stringify(ask));
  const raw2 = agent();
  line("agent", JSON.stringify(raw2));
  const checked2 = check(ask, raw2);
  line("check", checked2.ok ? "ok" : `FAIL — ${checked2.why}`);
  line("factory", `claimed ${ticket.id} for factory`);
}

// ───────────────────────────────────────────────────────────────── scene 3

function sceneThree(ticket: TicketFacts): void {
  heading("Scene 3 — garbled twice");

  const ask: Ask = { k: "tracker.setState", issue: ticket.id, state: "started" };
  const raw = { result: "yep, all set!" };

  line("ask", JSON.stringify(ask));
  line("agent", JSON.stringify(raw));
  const checked1 = check(ask, raw);
  const why1 = checked1.ok ? "" : checked1.why;
  line("check", `FAIL — ${why1}`);
  line("factory", "garbled — re-asking tracker.setState once");

  line("ask", JSON.stringify(ask));
  line("agent", JSON.stringify(raw));
  const checked2 = check(ask, raw);
  const why2 = checked2.ok ? "" : checked2.why;
  line("check", `FAIL — ${why2}`);

  line(
    "factory",
    `stopping — tracker.setState on ${ticket.id} failed twice:\n` +
      `  1) ${why1}\n  2) ${why2}\nnothing was decided; a human should look at ${ticket.id}.`,
  );
}

// ───────────────────────────────────────────────────────────────── scene 4

function sceneFour(ticket: TicketFacts): void {
  heading("Scene 4 — honest loss");

  const ask: Ask = { k: "tracker.claim", issue: ticket.id, actor: "factory" };
  const raw = { result: "taken", by: "other-agent" };

  line("ask", JSON.stringify(ask));
  line("agent", JSON.stringify(raw));
  const checked = check(ask, raw);
  line("check", checked.ok ? "ok" : `FAIL — ${checked.why}`);
  line("factory", `${ticket.id} already taken by other-agent — moving to next candidate`);
}

// ───────────────────────────────────────────────────────────────── main

const { picked, runnerUp } = sceneOne();
sceneTwo(picked);
sceneThree(picked);
sceneFour(runnerUp);

heading("Point");
console.log("the checker rejects garble, never bad news;");
console.log("Factory decides only on checked answers;");
console.log("two failures on one ask = stop and tell the human.");
