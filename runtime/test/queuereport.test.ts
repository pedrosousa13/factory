import { test, expect } from "bun:test";
import { breakdown, progress, emptyQueueReport } from "../src/queuereport";
import type { TicketFacts } from "../src/tracker";

function ticket(overrides: Partial<TicketFacts> = {}): TicketFacts {
  return {
    id: "1",
    title: "a ticket",
    urgency: "P2",
    createdAt: "2026-01-01T00:00:00Z",
    milestone: "m1",
    ready: false,
    state: "unstarted",
    claimedBy: null,
    blockedBy: [],
    labels: [],
    ...overrides,
  };
}

// ───── breakdown

test("breakdown counts every still-open issue as open", () => {
  const got = breakdown([ticket({ id: "1" }), ticket({ id: "2", state: "started" })]);
  expect(got.open).toBe(2);
});

test("breakdown counts ready-for-human and needs-info from labels", () => {
  const got = breakdown([
    ticket({ id: "1", labels: ["ready-for-human"] }),
    ticket({ id: "2", labels: ["needs-info"] }),
    ticket({ id: "3", labels: ["needs-info"] }),
    ticket({ id: "4", labels: ["Bug"] }),
  ]);
  expect(got.readyForHuman).toBe(1);
  expect(got.needsInfo).toBe(2);
});

test("breakdown counts only agent-ready issues as blocked", () => {
  const got = breakdown([
    ticket({ id: "1", ready: true, blockedBy: ["9"] }),
    ticket({ id: "2", ready: false, blockedBy: ["9"] }),
    ticket({ id: "3", ready: true, blockedBy: [] }),
  ]);
  expect(got.blocked).toBe(1);
});

test("breakdown excludes planning artifacts from every count", () => {
  const got = breakdown([
    ticket({ id: "1", labels: ["wayfinder:map"] }),
    ticket({ id: "2", labels: ["planning:prd", "needs-info"] }),
    ticket({ id: "3", labels: ["needs-info"] }),
  ]);
  expect(got.open).toBe(1);
  expect(got.needsInfo).toBe(1);
});

test("breakdown of no open issues is all zeros, not an error", () => {
  expect(breakdown([])).toEqual({ open: 0, readyForHuman: 0, needsInfo: 0, blocked: 0 });
});

test("the same input always gives the same blocked count, however often it is called", () => {
  const open = [ticket({ id: "1", ready: true, blockedBy: ["9"] })];
  expect(breakdown(open).blocked).toBe(breakdown(open).blocked);
});

// ───── progress

test("progress is closed issues over all issues in the milestone", () => {
  const got = progress({ unstarted: 2, started: 1, parked: 0, done: 6, canceled: 1 });
  expect(got).toEqual({ closed: 7, total: 10 });
});

test("progress of an empty milestone does not divide by zero", () => {
  expect(progress({ unstarted: 0, started: 0, parked: 0, done: 0, canceled: 0 })).toEqual({
    closed: 0,
    total: 0,
  });
});

// ───── the three scope reports

test("an unscoped empty Queue reports one line and no breakdown", () => {
  const got = emptyQueueReport({
    scope: { k: "everything" },
    openIssues: [ticket({ labels: ["needs-info"] })],
    counts: null,
    mode: "interactive",
  });
  expect(got.k).toBe("unscoped");
  expect(got.notification.split("\n").length).toBe(1);
  expect(got.lines.join("\n")).not.toContain("needs-info");
});

test("a milestone-scoped empty Queue reports progress and the full breakdown", () => {
  const got = emptyQueueReport({
    scope: { k: "milestone", milestone: "m1" },
    openIssues: [
      ticket({ id: "1", labels: ["needs-info"] }),
      ticket({ id: "2", labels: ["ready-for-human"] }),
      ticket({ id: "3", ready: true, blockedBy: ["9"] }),
    ],
    counts: { unstarted: 3, started: 0, parked: 0, done: 4, canceled: 0 },
    mode: "interactive",
  });
  const text = got.lines.join("\n");
  expect(got.k).toBe("milestone");
  expect(text).toContain("m1");
  expect(text).toContain("3 open");
  expect(text).toContain("1 needs-info");
  expect(text).toContain("1 ready-for-human");
  expect(text).toContain("1 blocked");
  expect(text).toContain("4 of 7");
});

test("a milestone-scoped report says agent-ready work is exhausted, not that the milestone is done", () => {
  const got = emptyQueueReport({
    scope: { k: "milestone", milestone: "m1" },
    openIssues: [ticket()],
    counts: { unstarted: 1, started: 0, parked: 0, done: 4, canceled: 0 },
    mode: "interactive",
  });
  const text = got.lines.join("\n").toLowerCase();
  expect(text).toContain("agent-ready work");
  expect(text).not.toContain("milestone is complete");
});

test("a (No milestone) empty Queue reports the breakdown with no progress figure", () => {
  const got = emptyQueueReport({
    scope: { k: "no-milestone" },
    openIssues: [ticket({ milestone: null, labels: ["needs-info"] })],
    counts: null,
    mode: "interactive",
  });
  expect(got.k).toBe("no-milestone");
  const text = got.lines.join("\n");
  expect(text).toContain("1 needs-info");
  expect(text).not.toContain(" of ");
});

// ───── the planning exit

test("an interactive run offers planning and ends", () => {
  const got = emptyQueueReport({
    scope: { k: "everything" },
    openIssues: [],
    counts: null,
    mode: "interactive",
  });
  expect(got.exit).toEqual({ k: "offer-planning" });
  expect(got.lines.join("\n")).toContain("fresh session");
});

test("a headless run prints the same report and stops with no offer", () => {
  const interactive = emptyQueueReport({
    scope: { k: "milestone", milestone: "m1" },
    openIssues: [ticket({ labels: ["needs-info"] })],
    counts: { unstarted: 1, started: 0, parked: 0, done: 2, canceled: 0 },
    mode: "headless",
  });
  expect(interactive.exit).toEqual({ k: "stop" });
  expect(interactive.lines.join("\n")).not.toContain("fresh session");
});

test("both exits are terminal — neither returns to work", () => {
  for (const mode of ["interactive", "headless"] as const) {
    const got = emptyQueueReport({ scope: { k: "everything" }, openIssues: [], counts: null, mode });
    expect(["offer-planning", "stop"]).toContain(got.exit.k);
  }
});
