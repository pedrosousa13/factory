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
  // Unclaimed tickets to check for a Park that crashed AFTER release-claim
  // (parkPlan's step 3) but before the two tracker writes that follow it. A
  // ticket in that window never appears in `claimed` — the claim is already
  // gone — so without this list nothing here ever produces a decision for it
  // and it is stranded forever (S19). Required, not optional: looking only at
  // claimed tickets is precisely the omission that stranded them, and an
  // optional field lets the next caller make it again by saying nothing.
  unclaimed: TicketFacts[];
  originBranches: string[]; // branch names that exist on origin right now
  actor: string; // the current run's identity
  journal: JournalRecord | null; // this run's own last-written hint, or null if none was usable
  // Ticket ids whose Park comment is already on the tracker. The comment is
  // the one Park step the tracker can be asked about directly, so whether it
  // ran is observed rather than assumed — otherwise a crash between the
  // comment and the claim release would post the maintainer a second copy.
  parkCommented: string[];
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
 *
 * INVARIANT the journal writer must hold: the journal is overwritten when a
 * ticket is claimed, before any work on it begins. Nothing here can verify
 * that. A journal left behind by an already-finished Park names the same
 * ticket, the same actor, and (once the next cycle pushes) the same branch as
 * a live interrupted Park, and no input to this function distinguishes the
 * two — telling them apart needs a claim timestamp the tracker vocabulary
 * does not carry. Clearing the journal at claim time is what keeps the stale
 * record from ever being read as a Park in flight.
 */
export function reconcileClaims(input: RecoveryInput): RecoveryDecision[] {
  const onOrigin = new Set(input.originBranches);
  const onTracker = new Set(input.parkCommented);

  const claimedDecisions = input.claimed.map((ticket): RecoveryDecision => {
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
    // Whether the comment ran is read off the tracker rather than guessed:
    // tracker.comment appends, so replaying one the maintainer can already
    // see would leave two copies of the same question on the ticket.
    const remaining = remainingPark({
      branchPushed: true,
      commentPosted: onTracker.has(ticket.id),
      claimReleased: false,
      labelSwapped: false,
      stateUnstarted: false,
    });
    return { k: "resume-park", ticket: ticket.id, branch, remaining };
  });

  // S19's second half: release-claim is parkPlan's step 3, so a ticket that
  // is unclaimed and still NOT "unstarted" can only be sitting mid-Park —
  // nothing else in the protocol drops the claim while leaving the ticket
  // "started". A finished Park's last step sets state to "unstarted", and an
  // ordinary ticket nobody has touched starts there too, so state=unstarted
  // is exactly the signal that there is nothing left to do; no journal is
  // needed to tell this apart from an in-progress ticket, because being
  // unclaimed and non-unstarted is not a state any other flow produces.
  //
  // The claim is gone, so "reverse to a plain resume" (the claimed path's
  // fallback when no journaled reason survives) has nothing to resume under
  // — there is no actor to hand the work back to. That fallback does not
  // apply here: by park.ts's prefix invariant, release-claim (step 3) cannot
  // have run before post-comment (step 2), so the durable comment is always
  // already posted by the time a ticket can be unclaimed-and-started. This
  // path only ever completes the remaining Park writes, never reverses one.
  const strandedDecisions = (input.unclaimed ?? [])
    .filter((ticket) => ticket.claimedBy === null && ticket.state !== "unstarted")
    .map((ticket): RecoveryDecision => {
      const branch = branchName(ticket.id, ticket.title);
      const remaining = remainingPark({
        branchPushed: onOrigin.has(branch),
        commentPosted: onTracker.has(ticket.id),
        claimReleased: true,
        labelSwapped: !ticket.ready,
        stateUnstarted: ticket.state === "unstarted",
      });
      return { k: "resume-park", ticket: ticket.id, branch, remaining };
    });

  return [...claimedDecisions, ...strandedDecisions];
}
