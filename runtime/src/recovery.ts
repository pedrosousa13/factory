// Pure start-time recovery module (PRD §5 item 9): reconciles ticket claims
// against origin branches so a crashed run can resume the work it owns,
// release what it never got to, and leave every other actor's claim alone.
// No fs, no process, no clock reads — callers pass in what tracker, git, and
// the journal (if any) reported.

import type { TicketFacts } from "./tracker";
import type { JournalRecord } from "./journal";
import { branchName } from "./pick";
import { PARK_STEP, remainingPark } from "./park";
import type { ParkStep } from "./park";

// ───── the recovery decision

export type RecoveryDecision =
  | { k: "resume"; ticket: string; branch: string }
  | { k: "resume-park"; ticket: string; branch: string; remaining: ParkStep[] }
  | { k: "release"; ticket: string }
  | { k: "skip"; ticket: string };

export type RecoveryInput = {
  claimed: TicketFacts[]; // every currently-claimed ticket the tracker reports, any actor
  originBranches: string[]; // branch names that exist on origin right now
  actor: string; // the current run's identity
  journal: JournalRecord | null; // this run's own last-written hint, or null if none was usable
};

/**
 * PRD §5 item 9: a ticket claimed by the current actor with a pushed branch
 * resumes that branch; claimed with no branch releases back to the Queue
 * (the caller drops the claim); a different actor's claim is not this run's
 * to touch. The branch is always recomputed from the ticket's CURRENT title
 * via pick.ts's branchName, never read off the journal — recovery re-reads
 * the issue before it names a branch, so a rename since the journal was
 * written resumes under the new name.
 *
 * The journal is a hint, never trusted alone (journal.ts): it can only steer
 * a ticket onto the S19 Park-recovery path (resume-park), and only when the
 * tracker independently confirms this actor still holds the claim and git
 * independently confirms the freshly-derived branch exists on origin.
 * Either disagreeing falls back to the plain resume/release call above —
 * tracker and git win over the journal.
 */
export function reconcileClaims(input: RecoveryInput): RecoveryDecision[] {
  const onOrigin = new Set(input.originBranches);

  return input.claimed.map((ticket): RecoveryDecision => {
    if (ticket.claimedBy !== input.actor) return { k: "skip", ticket: ticket.id };

    const branch = branchName(ticket.id, ticket.title);
    if (!onOrigin.has(branch)) return { k: "release", ticket: ticket.id };

    // S19 allows a crashed Park to be completed OR reversed. Completing it
    // means re-posting the durable comment, which needs the original reason —
    // and the only Park reason that survives a crash is the journaled
    // question. With no recoverable reason there is nothing to say in the
    // comment, so the interrupted Park is reversed instead: the run simply
    // resumes the work on its branch. Inventing a reason would be worse than
    // either option.
    const parkInterrupted =
      input.journal !== null &&
      input.journal.ticket === ticket.id &&
      input.journal.step === PARK_STEP &&
      input.journal.openQuestion !== null;

    if (!parkInterrupted) return { k: "resume", ticket: ticket.id, branch };

    // The claim is still held — this map branch only runs when
    // ticket.claimedBy === actor — so release-claim cannot have completed,
    // and park.ts's fixed step order means neither tracker write has either.
    // commentPosted is unobservable from tracker facts alone, so it is
    // assumed not done; replaying the durable park comment is idempotent
    // (park.ts, S19), and "ask" is not a ParkStep, so this can never re-ask.
    const remaining = remainingPark({
      branchPushed: true,
      commentPosted: false,
      claimReleased: false,
      labelSwapped: false,
      stateUnstarted: false,
    });
    return { k: "resume-park", ticket: ticket.id, branch, remaining };
  });
}
