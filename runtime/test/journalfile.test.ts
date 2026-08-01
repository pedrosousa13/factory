import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearJournal, JOURNAL_PATH, readJournal, startClaim, writeJournal } from "../src/journalfile";
import type { JournalRecord } from "../src/journal";
import { waitDecision } from "../src/answerwait";
import { reconcileClaims } from "../src/recovery";
import type { TicketFacts } from "../src/tracker";
import { branchName } from "../src/pick";

// ───── scratch repo root helper (a plain temp dir — no git needed here)

function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), "journalfile-test-"));
}

const record: JournalRecord = {
  ticket: "43",
  branch: "slice/43-ask-park-recovery",
  step: "implement",
  openQuestion: { text: "which flag should this use?", askedAt: "2026-08-01T12:00:00.000Z" },
  workers: ["w1"],
};

// ───── round trip

describe("round trip", () => {
  test("a record survives writeJournal then readJournal unchanged", () => {
    const dir = scratchDir();
    try {
      writeJournal(dir, record);
      const result = readJournal(dir);
      expect(result).toEqual({ ok: true, record });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ───── "no journal" collapses every failure mode

describe("readJournal: everything unusable reads back as no-journal, never throws", () => {
  test("missing file", () => {
    const dir = scratchDir();
    try {
      expect(readJournal(dir)).toEqual({ ok: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("unreadable path (a directory sits where the journal file should be)", () => {
    const dir = scratchDir();
    try {
      mkdirSync(join(dir, ".factory"), { recursive: true });
      mkdirSync(join(dir, JOURNAL_PATH)); // a directory, not a file, at the journal path
      expect(() => readJournal(dir)).not.toThrow();
      expect(readJournal(dir)).toEqual({ ok: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("garbled content", () => {
    const dir = scratchDir();
    try {
      mkdirSync(join(dir, ".factory"), { recursive: true });
      writeFileSync(join(dir, JOURNAL_PATH), "{ not valid json");
      expect(readJournal(dir)).toEqual({ ok: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ───── writeJournal creates .factory/ when absent

describe("writeJournal", () => {
  test("creates .factory/ when it doesn't exist yet", () => {
    const dir = scratchDir();
    try {
      expect(existsSync(join(dir, ".factory"))).toBe(false);
      writeJournal(dir, record);
      expect(existsSync(join(dir, JOURNAL_PATH))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("overwrites an existing journal whole, not merged", () => {
    const dir = scratchDir();
    try {
      writeJournal(dir, record);
      const replacement: JournalRecord = { ticket: "44", branch: "b44", step: "verify", openQuestion: null, workers: [] };
      writeJournal(dir, replacement);
      expect(readJournal(dir)).toEqual({ ok: true, record: replacement });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ───── clearJournal

describe("clearJournal", () => {
  test("removes a written journal", () => {
    const dir = scratchDir();
    try {
      writeJournal(dir, record);
      clearJournal(dir);
      expect(existsSync(join(dir, JOURNAL_PATH))).toBe(false);
      expect(readJournal(dir)).toEqual({ ok: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("clearing an already-absent journal is a no-op, not a throw", () => {
    const dir = scratchDir();
    try {
      expect(() => clearJournal(dir)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ───── startClaim: the invariant recovery.ts depends on

describe("startClaim", () => {
  test("a previous cycle's open question does not survive a new claim", () => {
    const dir = scratchDir();
    try {
      writeJournal(dir, record); // simulates a journal left behind with an open question
      startClaim(dir, "43", "slice/43-ask-park-recovery", "implement", []);

      const result = readJournal(dir);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.record.openQuestion).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("resets ticket, branch, step, and workers for the new claim", () => {
    const dir = scratchDir();
    try {
      writeJournal(dir, record);
      startClaim(dir, "99", "slice/99-other", "claim", ["w9"]);

      expect(readJournal(dir)).toEqual({
        ok: true,
        record: { ticket: "99", branch: "slice/99-other", step: "claim", openQuestion: null, workers: ["w9"] },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("workers defaults to empty when omitted", () => {
    const dir = scratchDir();
    try {
      startClaim(dir, "1", "b1", "claim");
      const result = readJournal(dir);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.record.workers).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("starting a claim when no journal existed before still produces a valid, no-question record", () => {
    const dir = scratchDir();
    try {
      startClaim(dir, "5", "b5", "claim");
      expect(readJournal(dir)).toEqual({
        ok: true,
        record: { ticket: "5", branch: "b5", step: "claim", openQuestion: null, workers: [] },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ───── the claim-time overwrite invariant (recovery.ts:57-64): nothing
// downstream can tell a finished cycle's leftover journal from a live one
// unless the journal is cleared at claim time. These pin that it is.

describe("the claim-time overwrite invariant", () => {
  test("a new claim erases the previous cycle's open question", () => {
    const dir = scratchDir();
    try {
      writeJournal(dir, {
        ticket: "T-1",
        branch: "issue-1",
        step: "ask",
        openQuestion: { text: "which tracker?", askedAt: "2026-08-01T10:00:00Z" },
        workers: [],
      });
      startClaim(dir, "T-2", "issue-2", "claim");
      const read = readJournal(dir);
      expect(read).toEqual({
        ok: true,
        record: { ticket: "T-2", branch: "issue-2", step: "claim", openQuestion: null, workers: [] },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Claimed path, not the unclaimed/stranded path: recovery.ts only ever
  // reads `journal` inside claimed.map's parkInterrupted check, and that
  // check requires journal.step === PARK_STEP ("park"). bin/park.ts:163-169
  // writes step: "ask" while a question is outstanding — PARK_STEP is
  // written later (park.ts:447), once the Park itself starts — so a
  // finished cycle's leftover "ask" journal must NOT read as an interrupted
  // Park: it plainly resumes.
  test("a finished Park's leftover journal does not resurrect the Park in recovery", () => {
    const actor = "factory-loop";
    const title = "Ask, Park, and Recovery";
    const branch = branchName("T-1", title);
    const claimedTicket: TicketFacts = {
      id: "T-1",
      title,
      urgency: "P2",
      createdAt: "2026-07-30T00:00:00Z",
      milestone: null,
      ready: true,
      state: "started",
      claimedBy: actor,
      blockedBy: [],
      labels: [],
    };
    const leftover: JournalRecord = {
      ticket: "T-1",
      branch,
      step: "ask", // not PARK_STEP — the question step, per bin/park.ts:166
      openQuestion: { text: "which tracker?", askedAt: "2026-08-01T10:00:00Z" },
      workers: [],
    };
    const decisions = reconcileClaims({
      claimed: [claimedTicket],
      unclaimed: [],
      originBranches: [branch],
      actor,
      journal: leftover,
      parkCommented: ["T-1"], // the Park's comment is on the tracker
    });
    expect(decisions).toEqual([{ k: "resume", ticket: "T-1", branch }]);
  });
});

// ───── askedAt survives the fs round trip in the exact form answerwait.ts accepts

describe("askedAt written by this module satisfies answerwait.ts's canonical-UTC-ISO requirement", () => {
  test("waitDecision does not park on a timestamp written and re-read through this edge", () => {
    const dir = scratchDir();
    try {
      const askedAt = new Date().toISOString();
      writeJournal(dir, { ...record, openQuestion: { text: "q", askedAt } });

      const result = readJournal(dir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const roundTripped = result.record.openQuestion?.askedAt;
      expect(roundTripped).toBe(askedAt); // survived byte-for-byte, not reparsed into a Date

      const decision = waitDecision({
        askedAt: roundTripped!,
        now: askedAt, // same instant: well inside any positive window
        windowMinutes: 15,
        answered: null,
      });
      expect(decision).toEqual({ k: "keep-waiting" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
