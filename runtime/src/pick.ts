// Pure pickup module: mechanical eligibility, blocker resolution with the
// fail-safe rule, and queue-order selection (PRD §2 "Queue order... A
// blocker that does not appear in the candidate list counts as blocking
// until one tracker.read proves otherwise"; PRD §4 "the runtime re-checks
// only mechanical invariants"). No fs, no process, no I/O.

import type { QueueScope, TicketFacts, IssueState, OpenState } from "./tracker";
import { OPEN_STATES, queueOrder } from "./tracker";
import { isPlanningArtifact } from "./planning";

// ───── branch naming

const SLUG_MAX = 40;

// Derived deterministically from the issue title (PRD §3: v1 branch naming
// was non-deterministic and is a recorded defect). Scheme: `<id>/<slug>`.
// Lowercase, non-alnum runs collapse to a single hyphen, leading/trailing
// hyphens trimmed, slug capped at 40 chars. The id prefix is always present,
// even when the title yields no usable slug.
export function branchName(id: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
  return slug.length > 0 ? `${id}/${slug}` : id;
}

// ───── mechanical invariants

export type PickInput = { candidates: TicketFacts[]; scope: QueueScope };

export type Excluded = { id: string; why: string };

// PROTOCOL.md:185-192. Milestone scope is fail-open on purpose: an issue with
// no milestone stays in scope, so a scoped run never strands unassigned work.
// "Everything" and "(No milestone)" are different scopes, not one nullable
// milestone — they select different Queues and report differently when empty.
function inScope(ticket: TicketFacts, scope: QueueScope): string | null {
  switch (scope.k) {
    case "everything":
      return null;
    case "milestone":
      if (ticket.milestone === null || ticket.milestone === scope.milestone) return null;
      return `milestone "${ticket.milestone}" is not in scope "${scope.milestone}"`;
    case "no-milestone":
      if (ticket.milestone === null) return null;
      return `milestone "${ticket.milestone}" is out of scope: this run is scoped to issues with no milestone`;
  }
}

// Ready, unstarted, unclaimed, in-scope milestone — the mechanical invariants
// re-checked at pickup (PRD §4). Collect every failing reason per ticket
// rather than stopping at the first (honest reporting).
export function applyInvariants(
  input: PickInput,
): { eligible: TicketFacts[]; excluded: Excluded[] } {
  const eligible: TicketFacts[] = [];
  const excluded: Excluded[] = [];

  for (const ticket of input.candidates) {
    const reasons: string[] = [];
    if (!ticket.ready) reasons.push("not ready");
    if (ticket.state !== "unstarted") reasons.push(`state is "${ticket.state}", not "unstarted"`);
    if (ticket.claimedBy !== null) reasons.push(`already claimed by "${ticket.claimedBy}"`);
    // PRD §4: the Queue excludes by namespace, so a new artifact kind inherits
    // the exclusion by naming itself correctly.
    if (isPlanningArtifact(ticket.labels)) reasons.push("planning artifact, not a work item");
    const scopeReason = inScope(ticket, input.scope);
    if (scopeReason !== null) reasons.push(scopeReason);

    if (reasons.length > 0) {
      excluded.push({ id: ticket.id, why: reasons.join("; ") });
    } else {
      eligible.push(ticket);
    }
  }

  return { eligible, excluded };
}

// ───── blocker resolution (fail-safe rule)

// A blocker id visible in allCandidates blocks only while its known state is
// still open. A blocker id NOT visible in allCandidates counts as blocking
// until a tracker.read proves otherwise — its id lands in needsRead. Getting
// this backwards (invisible = not blocking) is the parity-slice prototype's
// recorded defect.
export function resolveBlocking(
  eligible: TicketFacts[],
  allCandidates: TicketFacts[],
): { unblocked: TicketFacts[]; needsRead: string[] } {
  const byId = new Map(allCandidates.map((t) => [t.id, t]));
  const unblocked: TicketFacts[] = [];
  const needsRead = new Set<string>();

  for (const ticket of eligible) {
    let blocked = false;
    for (const blockerId of ticket.blockedBy) {
      const blocker = byId.get(blockerId);
      if (blocker === undefined) {
        needsRead.add(blockerId);
        blocked = true;
      } else if (OPEN_STATES.includes(blocker.state as OpenState)) {
        blocked = true;
      }
    }
    if (!blocked) unblocked.push(ticket);
  }

  return { unblocked, needsRead: [...needsRead] };
}

// ───── folding tracker.read answers back in

export type ReadResult = { id: string; state: IssueState };

// For each pending ticket (blocked pending a read on one or more of its
// blockers), a read showing done or canceled clears that blocker; anything
// else, or a blocker with no matching read, keeps the ticket blocked.
export function foldReads(
  pending: TicketFacts[],
  reads: ReadResult[],
): { unblocked: TicketFacts[]; stillBlocked: TicketFacts[] } {
  const readState = new Map(reads.map((r) => [r.id, r.state]));
  const unblocked: TicketFacts[] = [];
  const stillBlocked: TicketFacts[] = [];

  for (const ticket of pending) {
    const blocked = ticket.blockedBy.some((blockerId) => {
      const state = readState.get(blockerId);
      return state === undefined || OPEN_STATES.includes(state as OpenState);
    });
    if (blocked) {
      stillBlocked.push(ticket);
    } else {
      unblocked.push(ticket);
    }
  }

  return { unblocked, stillBlocked };
}

// ───── pick

// queueOrder sort, first or null.
export function pick(unblocked: TicketFacts[]): TicketFacts | null {
  if (unblocked.length === 0) return null;
  return [...unblocked].sort(queueOrder)[0];
}
