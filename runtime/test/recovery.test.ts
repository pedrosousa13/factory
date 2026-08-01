import { test, expect } from "bun:test";
import { reconcileClaims } from "../src/recovery";
import type { RecoveryInput } from "../src/recovery";
import { branchName } from "../src/pick";
import type { TicketFacts } from "../src/tracker";
import type { JournalRecord } from "../src/journal";

// ───── fixtures

const ACTOR = "runtime-actor-1";
const OTHER_ACTOR = "runtime-actor-2";

function ticket(overrides: Partial<TicketFacts>): TicketFacts {
  return {
    id: "43",
    title: "Ask, Park, and Recovery",
    urgency: "P2",
    createdAt: "2026-07-30T00:00:00Z",
    milestone: null,
    ready: true,
    state: "started",
    claimedBy: ACTOR,
    blockedBy: [],
    labels: [],
    ...overrides,
  };
}

const BRANCH = branchName("43", "Ask, Park, and Recovery");

const journal = (overrides: Partial<JournalRecord>): JournalRecord => ({
  ticket: "43",
  branch: BRANCH,
  step: "implement",
  openQuestion: null,
  workers: [ACTOR],
  ...overrides,
});

function input(overrides: Partial<RecoveryInput>): RecoveryInput {
  return {
    claimed: [ticket({})],
    originBranches: [BRANCH],
    actor: ACTOR,
    journal: null,
    unclaimed: [],
    parkCommented: [],
    ...overrides,
  };
}

// ───── both half transitions (PRD §5 item 9)

test("claimed by the current actor with its branch on origin resumes that branch", () => {
  const decisions = reconcileClaims(input({}));
  expect(decisions).toEqual([{ k: "resume", ticket: "43", branch: BRANCH }]);
});

test("claimed by the current actor with no branch on origin releases back to the Queue", () => {
  const decisions = reconcileClaims(input({ originBranches: [] }));
  expect(decisions).toEqual([{ k: "release", ticket: "43" }]);
});

// ───── another actor's claim is untouched

test("a ticket claimed by a different actor is left alone, whether or not its branch exists", () => {
  const claimedByOther = ticket({ claimedBy: OTHER_ACTOR });

  const withBranch = reconcileClaims(input({ claimed: [claimedByOther], originBranches: [BRANCH] }));
  const withoutBranch = reconcileClaims(input({ claimed: [claimedByOther], originBranches: [] }));

  expect(withBranch).toEqual([{ k: "skip", ticket: "43" }]);
  expect(withoutBranch).toEqual([{ k: "skip", ticket: "43" }]);
});

// ───── the journal is a hint, never trusted alone

test("a missing journal changes nothing about the resume outcome", () => {
  const withJournal = reconcileClaims(input({ journal: journal({ step: "implement" }) }));
  const withoutJournal = reconcileClaims(input({ journal: null }));
  expect(withJournal).toEqual(withoutJournal);
});

test("a missing journal changes nothing about the release outcome", () => {
  const base = input({ originBranches: [] });
  const withJournal = reconcileClaims({ ...base, journal: journal({ step: "implement" }) });
  const withoutJournal = reconcileClaims({ ...base, journal: null });
  expect(withJournal).toEqual(withoutJournal);
});

test("a journal naming a park step but disagreeing with git (branch never landed) loses: falls back to release", () => {
  const decisions = reconcileClaims(
    input({ originBranches: [], journal: journal({ step: "park" }) }),
  );
  expect(decisions).toEqual([{ k: "release", ticket: "43" }]);
});

test("a journal naming a park step for a different actor's claim loses: tracker's claimedBy wins, still skipped", () => {
  const claimedByOther = ticket({ claimedBy: OTHER_ACTOR });
  const decisions = reconcileClaims(
    input({ claimed: [claimedByOther], journal: journal({ step: "park" }) }),
  );
  expect(decisions).toEqual([{ k: "skip", ticket: "43" }]);
});

test("a journal for a ticket that isn't the one claimed here has no effect", () => {
  const decisions = reconcileClaims(input({ journal: journal({ ticket: "99", step: "park" }) }));
  expect(decisions).toEqual([{ k: "resume", ticket: "43", branch: BRANCH }]);
});

test("the journal's own branch field is never consulted — only the ticket's current title is", () => {
  const staleBranchJournal = journal({ branch: "43/some-stale-branch-name-from-before" });
  const decisions = reconcileClaims(input({ journal: staleBranchJournal }));
  expect(decisions).toEqual([{ k: "resume", ticket: "43", branch: BRANCH }]);
});

// ───── branch identity derives from the CURRENT title, not the journal's

test("a ticket renamed since the journal was written resumes the branch matching the NEW title", () => {
  const renamed = ticket({ title: "A brand new title after rename" });
  const newBranch = branchName("43", "A brand new title after rename");

  const decisions = reconcileClaims(
    input({
      claimed: [renamed],
      originBranches: [newBranch], // only the new-title branch exists on origin
      journal: journal({ branch: BRANCH, step: "implement" }), // journal still remembers the OLD branch
    }),
  );

  expect(decisions).toEqual([{ k: "resume", ticket: "43", branch: newBranch }]);
  expect(newBranch).not.toBe(BRANCH);
});

// ───── S19: a mid-Park crash resumes the remaining steps and never re-asks

const PARKED_QUESTION = { text: "squash or merge for this one?", askedAt: "2026-08-01T10:00:00.000Z" };
const parkingJournal = journal({ step: "park", openQuestion: PARKED_QUESTION });

test("a journal at the park step, corroborated by tracker and git, resumes the remaining Park steps", () => {
  const decisions = reconcileClaims(input({ journal: parkingJournal }));

  expect(decisions).toEqual([
    {
      k: "resume-park",
      ticket: "43",
      branch: BRANCH,
      remaining: ["post-comment", "release-claim", "swap-label", "set-unstarted"],
    },
  ]);
});

// S19 permits completing OR reversing an interrupted Park. Completing it means
// re-posting the durable comment, which needs the original reason — and the
// only reason that survives a crash is the journaled question. With none, the
// Park is reversed: the run just resumes the work rather than inventing a
// reason to post.
test("a park-step journal with no recoverable reason reverses to a plain resume", () => {
  const decisions = reconcileClaims(input({ journal: journal({ step: "park", openQuestion: null }) }));

  expect(decisions).toEqual([{ k: "resume", ticket: "43", branch: BRANCH }]);
});

test("S19: the resume-park decision never contains an ask step — re-asking is structurally impossible", () => {
  const decisions = reconcileClaims(input({ journal: parkingJournal }));
  const decision = decisions[0];

  expect(decision.k).toBe("resume-park");
  if (decision.k === "resume-park") {
    expect(decision.remaining).not.toContain("push-branch");
    for (const step of decision.remaining) {
      expect(["post-comment", "release-claim", "swap-label", "set-unstarted"]).toContain(step);
    }
  }
});

// ───── idempotence

test("calling reconcileClaims twice on the same input produces identical decisions", () => {
  const args = input({ journal: parkingJournal });
  expect(reconcileClaims(args)).toEqual(reconcileClaims(args));
});

test("a resume-park decision is stable across repeated calls: no phantom progress is assumed", () => {
  const args = input({ journal: parkingJournal });
  const first = reconcileClaims(args);
  const second = reconcileClaims(args);
  expect(first).toEqual(second);
});

test("once a ticket's claim is actually released, it drops out of the claimed list and reconcile has nothing left to do for it", () => {
  // Models the state AFTER a release decision has been carried out: the
  // ticket no longer appears among currently-claimed tickets at all.
  const decisions = reconcileClaims(input({ claimed: [] }));
  expect(decisions).toEqual([]);
});

// ───── batch behavior: every claimed ticket gets its own decision

test("multiple claimed tickets each get an independent decision in the same call", () => {
  const resumable = ticket({ id: "1", title: "Resumable one", claimedBy: ACTOR });
  const releasable = ticket({ id: "2", title: "Releasable two", claimedBy: ACTOR });
  const foreign = ticket({ id: "3", title: "Someone else's three", claimedBy: OTHER_ACTOR });

  const resumableBranch = branchName("1", "Resumable one");

  const decisions = reconcileClaims({
    claimed: [resumable, releasable, foreign],
    unclaimed: [],
    originBranches: [resumableBranch],
    actor: ACTOR,
    journal: null,
    parkCommented: [],
  });

  expect(decisions).toEqual([
    { k: "resume", ticket: "1", branch: resumableBranch },
    { k: "release", ticket: "2" },
    { k: "skip", ticket: "3" },
  ]);
});

// tracker.comment appends rather than replaces, so a Park that crashed after
// its comment landed must not post the maintainer a second copy of the same
// question. Whether the comment ran is read off the tracker, not assumed.
test("a Park whose comment already landed owes only the steps after it", () => {
  const decisions = reconcileClaims(input({ journal: parkingJournal, parkCommented: ["43"] }));

  expect(decisions).toEqual([
    {
      k: "resume-park",
      ticket: "43",
      branch: BRANCH,
      remaining: ["release-claim", "swap-label", "set-unstarted"],
    },
  ]);
});

// The journal names one ticket. Another ticket the same actor holds must not
// be dragged onto the Park-recovery path with it.
test("a second ticket held by the same actor resumes plainly, not as a Park", () => {
  const other = ticket({ id: "44", title: "Something else entirely" });
  const otherBranch = branchName("44", "Something else entirely");
  const decisions = reconcileClaims(
    input({
      claimed: [ticket({}), other],
      originBranches: [BRANCH, otherBranch],
      journal: parkingJournal,
    }),
  );

  expect(decisions[1]).toEqual({ k: "resume", ticket: "44", branch: otherBranch });
});

// ───── S19's second half: a Park that crashed AFTER release-claim (step 3)
// leaves a ticket that appears in no `claimed` list at all — nothing above
// this point can ever produce a decision for it, which is exactly how it
// gets permanently stranded (unclaimed, still ready, still "started").

test("unclaimed + ready + started owes exactly swap-label and set-unstarted", () => {
  const stranded = ticket({ claimedBy: null, ready: true, state: "started" });

  const decisions = reconcileClaims(
    input({ claimed: [], unclaimed: [stranded], originBranches: [BRANCH], parkCommented: ["43"] }),
  );

  expect(decisions).toEqual([
    { k: "resume-park", ticket: "43", branch: BRANCH, remaining: ["swap-label", "set-unstarted"] },
  ]);
});

test("a crash after swap-label but before set-unstarted owes only set-unstarted", () => {
  const stranded = ticket({ claimedBy: null, ready: false, state: "started" });

  const decisions = reconcileClaims(
    input({ claimed: [], unclaimed: [stranded], originBranches: [BRANCH], parkCommented: ["43"] }),
  );

  expect(decisions).toEqual([{ k: "resume-park", ticket: "43", branch: BRANCH, remaining: ["set-unstarted"] }]);
});

test("unclaimed, not ready, and unstarted (a Park that finished cleanly) owes nothing and is not dragged back into recovery", () => {
  const finished = ticket({ claimedBy: null, ready: false, state: "unstarted" });

  const decisions = reconcileClaims(
    input({ claimed: [], unclaimed: [finished], originBranches: [BRANCH], parkCommented: ["43"] }),
  );

  expect(decisions).toEqual([]);
});

test("an ordinary unclaimed, ready, unstarted ticket sitting in the Queue is untouched", () => {
  const queued = ticket({ claimedBy: null, ready: true, state: "unstarted" });

  const decisions = reconcileClaims(input({ claimed: [], unclaimed: [queued], originBranches: [BRANCH] }));

  expect(decisions).toEqual([]);
});

test("recovering the stranded case twice on the same input is idempotent", () => {
  const stranded = ticket({ claimedBy: null, ready: true, state: "started" });
  const args = input({ claimed: [], unclaimed: [stranded], originBranches: [BRANCH], parkCommented: ["43"] });

  expect(reconcileClaims(args)).toEqual(reconcileClaims(args));
});

test("a claimed ticket and a stranded ticket in the same call each get their own decision", () => {
  const claimedTicket = ticket({ id: "1", title: "Resumable one", claimedBy: ACTOR });
  const claimedBranch = branchName("1", "Resumable one");
  const stranded = ticket({ id: "2", title: "Stranded two", claimedBy: null, ready: true, state: "started" });
  const strandedBranch = branchName("2", "Stranded two");

  const decisions = reconcileClaims(
    input({
      claimed: [claimedTicket],
      unclaimed: [stranded],
      originBranches: [claimedBranch, strandedBranch],
      parkCommented: ["2"],
    }),
  );

  expect(decisions).toEqual([
    { k: "resume", ticket: "1", branch: claimedBranch },
    { k: "resume-park", ticket: "2", branch: strandedBranch, remaining: ["swap-label", "set-unstarted"] },
  ]);
});

// Claim and state are separate acts (phrasebook.md), so an unclaimed ticket
// can sit in a closed state without any Park ever having run on it. Matching
// those would let recovery set a maintainer-closed ticket back to unstarted
// and push it into the Queue.
for (const state of ["canceled", "done", "parked"] as const) {
  test(`an unclaimed ${state} ticket is left alone, not mistaken for a stranded Park`, () => {
    const closed = ticket({ id: "9", title: "Closed by the maintainer", claimedBy: null, state });

    const decisions = reconcileClaims(input({ claimed: [], unclaimed: [closed] }));

    expect(decisions).toEqual([]);
  });
}

test("an unclaimed unstarted ticket waiting in the Queue is left alone", () => {
  const queued = ticket({ id: "9", title: "Waiting its turn", claimedBy: null, state: "unstarted" });

  expect(reconcileClaims(input({ claimed: [], unclaimed: [queued] }))).toEqual([]);
});
