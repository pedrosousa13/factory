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
    originBranches: [resumableBranch],
    actor: ACTOR,
    journal: null,
  });

  expect(decisions).toEqual([
    { k: "resume", ticket: "1", branch: resumableBranch },
    { k: "release", ticket: "2" },
    { k: "skip", ticket: "3" },
  ]);
});
