// Pure empty-Queue report module (PROTOCOL.md "### 1. Queue selection"; closes S10).
// Three
// scopes report differently, the breakdown covers every still-open issue
// rather than the Queue candidates, and the loop stops consuming here — it
// never invents work. Only an interactive session carries on, into planning. No fs, no process, no clock reads.

import type { IssueState, QueueScope, TicketFacts } from "./tracker";
import { isPlanningArtifact } from "./planning";

// ───── the breakdown

export type OpenBreakdown = {
  open: number;
  readyForHuman: number;
  needsInfo: number;
  blocked: number;
};

// Counts every still-open issue the caller fetched with tracker.openIssues —
// NOT the Queue candidates. PROTOCOL.md "### 1. Queue selection": "Counting within
// the Queue is
// the mistake to avoid: it can only ever find `ready-for-agent` issues, and
// would report zero for the two labels that matter most here."
//
// `blocked` is derived here, at report time, from the list. The same section
// forbids a tally accumulated as the loop skipped issues: it counts the same
// issue once per iteration, so two runs over identical state would disagree.
//
// Planning artifacts are not work items and are excluded from every count.
export function breakdown(openIssues: TicketFacts[]): OpenBreakdown {
  const work = openIssues.filter((t) => !isPlanningArtifact(t.labels));
  return {
    open: work.length,
    readyForHuman: work.filter((t) => t.labels.includes("ready-for-human")).length,
    needsInfo: work.filter((t) => t.labels.includes("needs-info")).length,
    blocked: work.filter((t) => t.ready && t.blockedBy.length > 0).length,
  };
}

// ───── milestone progress

export type MilestoneProgress = { closed: number; total: number };

// Re-fetched at report time, never the Session-start snapshot: landed issues
// may have moved the milestone's progress since (PROTOCOL.md "### 1. Queue selection").
export function progress(counts: Record<IssueState, number>): MilestoneProgress {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { closed: counts.done + counts.canceled, total };
}

// ───── the report

export type QueueExit = { k: "offer-planning" } | { k: "stop" };

export type QueueEmptyReport = {
  k: "unscoped" | "milestone" | "no-milestone";
  // One-line status for the push notification, on every scope
  // (PROTOCOL.md "### 1. Queue selection").
  notification: string;
  // The detail delivered in the session. Empty of counts on unscoped.
  lines: string[];
  breakdown: OpenBreakdown | null;
  progress: MilestoneProgress | null;
  exit: QueueExit;
};

export type ReportInput = {
  scope: QueueScope;
  // Every still-open issue in scope, from tracker.openIssues.
  openIssues: TicketFacts[];
  // Milestone state counts, from tracker.milestoneCounts. Null on any scope
  // with no milestone entity to report against.
  counts: Record<IssueState, number> | null;
  mode: "interactive" | "headless";
};

function breakdownLine(b: OpenBreakdown): string {
  return `  ${b.open} open, ${b.readyForHuman} ready-for-human, ${b.needsInfo} needs-info, ${b.blocked} blocked`;
}

// PROTOCOL.md "### 1. Queue selection": an interactive run goes on to
// planning, budget permitting — a retrospective first when one is due (an
// issue landed or Parked since the last one, or a consumed Handoff says one
// is pending), then a Planning Session in the same session, then back to
// Queue selection. A spent budget writes a Handoff instead. A headless run
// prints the same report and stops, with no offer. Either way this report
// creates no work: only the maintainer does, in the Planning Session.
function exitLines(mode: "interactive" | "headless"): { exit: QueueExit; lines: string[] } {
  if (mode === "headless") return { exit: { k: "stop" }, lines: ["  run ends here."] };
  return {
    exit: { k: "offer-planning" },
    lines: ["  Nothing left to consume. Next, budget permitting: a retrospective if one is due, then a Planning Session."],
  };
}

export function emptyQueueReport(input: ReportInput): QueueEmptyReport {
  const tail = exitLines(input.mode);

  // Unscoped: a one-line status and nothing else. An unscoped empty Queue means
  // the Project has no agent-ready work at all, and there is no milestone to
  // break down against (PROTOCOL.md "### 1. Queue selection").
  if (input.scope.k === "everything") {
    const notification = "Queue empty: no agent-ready work left in this Project.";
    return {
      k: "unscoped",
      notification,
      lines: [`QUEUE EMPTY`, "", `  ${notification}`, "", ...tail.lines],
      breakdown: null,
      progress: null,
      exit: tail.exit,
    };
  }

  const b = breakdown(input.openIssues);

  if (input.scope.k === "no-milestone") {
    const notification = `Queue empty among no-milestone issues: ${b.open} still open.`;
    return {
      k: "no-milestone",
      notification,
      lines: [`QUEUE EMPTY (no milestone)`, "", breakdownLine(b), "  nothing unblocked to pick up.", "", ...tail.lines],
      breakdown: b,
      progress: null,
      exit: tail.exit,
    };
  }

  // Milestone scope. An empty scoped Queue means agent-ready work is exhausted,
  // not that the milestone is complete — conflating the two is exactly the
  // failure scoping guards against (PROTOCOL.md "### 1. Queue selection").
  const p = input.counts === null ? null : progress(input.counts);
  const progressLine = p === null ? "" : `  milestone ${input.scope.milestone}: ${p.closed} of ${p.total} closed`;
  const notification = `Queue empty in milestone ${input.scope.milestone}: agent-ready work exhausted, ${b.open} still open.`;

  return {
    k: "milestone",
    notification,
    lines: [
      `QUEUE EMPTY (milestone ${input.scope.milestone})`,
      "",
      ...(progressLine === "" ? [] : [progressLine]),
      breakdownLine(b),
      "  agent-ready work is exhausted here. That is not the same as the milestone being finished.",
      "",
      ...tail.lines,
    ],
    breakdown: b,
    progress: p,
    exit: tail.exit,
  };
}
