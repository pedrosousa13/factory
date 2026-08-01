// Lifted verbatim from prototype/parity-slice:prototypes/parity-slice/contract.ts,
// minus that file's prototype header. Reconciliation with the runtime prototype's
// Effect union happens after this slice reports.

/**
 * Factory v2 — tracker contract.
 *
 * The vocabulary Factory uses to ask a coding agent about the Project's issue
 * tracker, and the shape-checking of its answers. Pure: no I/O here — see
 * phrasebook.md for how the tracker says each neutral concept.
 */

// ───────────────────────────────────────────────────────────── domain values

export type Urgency = "P0" | "P1" | "P2" | "P3" | "none";
export type IssueState = "unstarted" | "started" | "parked" | "done" | "canceled";
/** The open-ended subset of IssueState: everything that hasn't reached a final state. */
export type OpenState = "unstarted" | "started" | "parked";

/** One ticket, as Factory needs to see it. Everything the loop decides on. */
export type TicketFacts = {
  id: string; // tracker-native identity, opaque to Factory
  title: string;
  urgency: Urgency;
  createdAt: string; // ISO 8601; ties in queue order break oldest-first
  milestone: string | null;
  ready: boolean; // carries the ready-for-agent marker
  state: IssueState;
  claimedBy: string | null; // actor holding the claim, if any
  blockedBy: string[]; // ids of still-open tickets blocking this one
};

// ────────────────────────────────────────────────────────── the ask vocabulary

export type Ask =
  | { k: "tracker.reachable" } // "can you reach the tracker?"
  | { k: "tracker.candidates"; milestone: string | null } // "list ready, unstarted, unclaimed tickets (in this milestone)"
  | { k: "tracker.read"; issue: string } // "give me the full facts + body + comments for one ticket"
  | { k: "tracker.claim"; issue: string; actor: string } // "claim this ticket for actor"
  // "unstarted" is here because Park needs it: PROTOCOL's Park step 3 sends a
  // ticket back to an unstarted state, and pick.ts's Queue eligibility accepts
  // nothing else, so without it Parked work could never be picked up again.
  | { k: "tracker.setState"; issue: string; state: "unstarted" | "started" | "parked" | "done" | "canceled" } // "move ticket to state"
  | { k: "tracker.unclaim"; issue: string } // "release the claim; ticket re-enters the pool"
  | { k: "tracker.comment"; issue: string; text: string } // "append this comment"
  | { k: "tracker.milestones" } // "list milestones in stable order"
  | { k: "tracker.milestoneCounts"; milestone: string } // "count open tickets in milestone, by state"
  | { k: "tracker.verify"; issue: string }; // "what is this ticket's current state right now?"

// ──────────────────────────────────────────────────────────── the answer shapes

export type ReachableAnswer = { result: "ok" } | { result: "unreachable"; why: string };
export type CandidatesAnswer = { result: "ok"; tickets: TicketFacts[] };
export type ReadAnswer =
  | { result: "ok"; ticket: TicketFacts; body: string; comments: string[] }
  | { result: "missing" };
export type ClaimAnswer = { result: "claimed" } | { result: "taken"; by: string };
export type SetStateAnswer = { result: "ok" };
export type UnclaimAnswer = { result: "ok" };
export type CommentAnswer = { result: "ok" };
export type MilestonesAnswer = { result: "ok"; milestones: string[] };
/** Open tickets only — done/canceled tickets don't get counted here. */
export type MilestoneCountsAnswer = { result: "ok"; counts: Record<OpenState, number> };
export type VerifyAnswer =
  | { result: "ok"; state: IssueState; claimedBy: string | null }
  | { result: "missing" };

/** Ask kind → the answer shape it expects. */
export type Answer = {
  "tracker.reachable": ReachableAnswer;
  "tracker.candidates": CandidatesAnswer;
  "tracker.read": ReadAnswer;
  "tracker.claim": ClaimAnswer;
  "tracker.setState": SetStateAnswer;
  "tracker.unclaim": UnclaimAnswer;
  "tracker.comment": CommentAnswer;
  "tracker.milestones": MilestonesAnswer;
  "tracker.milestoneCounts": MilestoneCountsAnswer;
  "tracker.verify": VerifyAnswer;
};

// ──────────────────────────────────────────────────────────────────── the checker

const URGENCIES: Urgency[] = ["P0", "P1", "P2", "P3", "none"];
const STATES: IssueState[] = ["unstarted", "started", "parked", "done", "canceled"];
export const OPEN_STATES: OpenState[] = ["unstarted", "started", "parked"];

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function isStr(x: unknown): x is string {
  return typeof x === "string";
}

function isOneOf<T extends string>(x: unknown, allowed: readonly T[]): x is T {
  return typeof x === "string" && (allowed as readonly string[]).includes(x);
}

function isStrArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every(isStr);
}

function bad(why: string): { ok: false; why: string } {
  return { ok: false, why };
}

type Checked<T> = { ok: true; value: T } | { ok: false; why: string };

function ticketFacts(raw: unknown, path: string): Checked<TicketFacts> {
  if (!isObj(raw)) return bad(`${path}: not an object`);
  if (!isStr(raw.id)) return bad(`${path}.id: not a string`);
  if (!isStr(raw.title)) return bad(`${path}.title: not a string`);
  if (!isOneOf(raw.urgency, URGENCIES))
    return bad(`${path}.urgency: ${JSON.stringify(raw.urgency)} is not P0|P1|P2|P3|none`);
  if (!isStr(raw.createdAt)) return bad(`${path}.createdAt: not a string`);
  if (raw.milestone !== null && !isStr(raw.milestone))
    return bad(`${path}.milestone: not a string or null`);
  if (typeof raw.ready !== "boolean") return bad(`${path}.ready: not a boolean`);
  if (!isOneOf(raw.state, STATES))
    return bad(`${path}.state: ${JSON.stringify(raw.state)} is not unstarted|started|parked|done|canceled`);
  if (raw.claimedBy !== null && !isStr(raw.claimedBy))
    return bad(`${path}.claimedBy: not a string or null`);
  if (!isStrArray(raw.blockedBy)) return bad(`${path}.blockedBy: not a string array`);
  return {
    ok: true,
    value: {
      id: raw.id,
      title: raw.title,
      urgency: raw.urgency,
      createdAt: raw.createdAt,
      milestone: raw.milestone,
      ready: raw.ready,
      state: raw.state,
      claimedBy: raw.claimedBy,
      blockedBy: raw.blockedBy,
    },
  };
}

export function check(
  ask: Ask,
  raw: unknown,
): { ok: true; answer: Answer[Ask["k"]] } | { ok: false; why: string } {
  if (!isObj(raw)) return bad("raw: not an object");
  const result = raw.result;
  const ok = (answer: Answer[Ask["k"]]) => ({ ok: true as const, answer });

  switch (ask.k) {
    case "tracker.reachable":
      if (result === "ok") return ok({ result: "ok" });
      if (result === "unreachable") {
        if (!isStr(raw.why)) return bad("why: not a string");
        return ok({ result: "unreachable", why: raw.why });
      }
      return bad(`result: ${JSON.stringify(result)} is not ok|unreachable`);

    case "tracker.candidates": {
      if (result !== "ok") return bad(`result: ${JSON.stringify(result)} is not ok`);
      if (!Array.isArray(raw.tickets)) return bad("tickets: not an array");
      const tickets: TicketFacts[] = [];
      for (let i = 0; i < raw.tickets.length; i++) {
        const t = ticketFacts(raw.tickets[i], `tickets[${i}]`);
        if (!t.ok) return t;
        tickets.push(t.value);
      }
      return ok({ result: "ok", tickets });
    }

    case "tracker.read": {
      if (result === "missing") return ok({ result: "missing" });
      if (result !== "ok") return bad(`result: ${JSON.stringify(result)} is not ok|missing`);
      const t = ticketFacts(raw.ticket, "ticket");
      if (!t.ok) return t;
      if (!isStr(raw.body)) return bad("body: not a string");
      if (!isStrArray(raw.comments)) return bad("comments: not a string array");
      return ok({ result: "ok", ticket: t.value, body: raw.body, comments: raw.comments });
    }

    case "tracker.claim":
      if (result === "claimed") return ok({ result: "claimed" });
      if (result === "taken") {
        if (!isStr(raw.by)) return bad("by: not a string");
        return ok({ result: "taken", by: raw.by });
      }
      return bad(`result: ${JSON.stringify(result)} is not claimed|taken`);

    case "tracker.setState":
    case "tracker.unclaim":
    case "tracker.comment":
      if (result !== "ok") return bad(`result: ${JSON.stringify(result)} is not ok`);
      return ok({ result: "ok" });

    case "tracker.milestones":
      if (result !== "ok") return bad(`result: ${JSON.stringify(result)} is not ok`);
      if (!isStrArray(raw.milestones)) return bad("milestones: not a string array");
      return ok({ result: "ok", milestones: raw.milestones });

    case "tracker.milestoneCounts": {
      if (result !== "ok") return bad(`result: ${JSON.stringify(result)} is not ok`);
      if (!isObj(raw.counts)) return bad("counts: not an object");
      const counts = {} as Record<OpenState, number>;
      for (const s of OPEN_STATES) {
        const v = raw.counts[s];
        if (typeof v !== "number") return bad(`counts.${s}: not a number`);
        counts[s] = v;
      }
      return ok({ result: "ok", counts });
    }

    case "tracker.verify": {
      if (result === "missing") return ok({ result: "missing" });
      if (result !== "ok") return bad(`result: ${JSON.stringify(result)} is not ok|missing`);
      if (!isOneOf(raw.state, STATES))
        return bad(`state: ${JSON.stringify(raw.state)} is not unstarted|started|parked|done|canceled`);
      if (raw.claimedBy !== null && !isStr(raw.claimedBy))
        return bad("claimedBy: not a string or null");
      return ok({ result: "ok", state: raw.state, claimedBy: raw.claimedBy });
    }
  }
}

// ──────────────────────────────────────────────────────────────────── queue order

const URGENCY_RANK: Record<Urgency, number> = { P0: 0, P1: 1, P2: 2, P3: 3, none: 4 };

/** P0 first, none last; ties break oldest createdAt first. */
export function queueOrder(a: TicketFacts, b: TicketFacts): number {
  return URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] || a.createdAt.localeCompare(b.createdAt);
}
