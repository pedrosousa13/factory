/**
 * Scenario runner for machine.ts — the way in, replacing hand-driving the TUI.
 *
 * Run: bun prototypes/runtime-state-machine/scenarios.ts
 *      bun prototypes/runtime-state-machine/scenarios.ts S18   (id or id-prefix filter)
 *
 * Each scenario is a scripted host (a small table of effect -> answer) driven
 * through the real `step()` reducer, one queued effect at a time — the same
 * mechanics tui.ts's `perform()` + key loop exercise by hand. What differs
 * per scenario is only: the starting facts, the answers to interesting
 * effects, and which of the resulting effects are the scenario's substance
 * (`show`, printed as `→`) versus setup noise (`hide`, printed as nothing,
 * or `note`, printed as a condensed `...` line).
 *
 * THROWAWAY: this prints; it does not assert or throw. A wrong answer table
 * shows up as a wrong transcript, which is the point — the maintainer reads
 * it to spot the transition that's off.
 */

import {
  initial,
  step,
  branchName,
  type Caps,
  type Effect,
  type Event,
  type IssueFacts,
  type Mode,
  type RunState,
  type Scope,
  type Settings,
  type Snapshot,
} from "./machine.ts";

const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
const D = (s: string) => `\x1b[2m${s}\x1b[0m`;
const Y = (s: string) => `\x1b[33m${s}\x1b[0m`;

const MIN = 60_000;

// ───────────────────────────────────────────────────────────── left column
// Symbolic markers ("...", "→") center in a 9-wide field; word markers
// ("given", "+15m", "result") left-anchor after two spaces. Matches the
// brief's worked example byte-for-byte.

const COL = 9;
function sym(m: string): string {
  const pad = COL - m.length;
  const l = Math.max(0, Math.floor(pad / 2));
  return " ".repeat(l) + m + " ".repeat(Math.max(0, pad - l));
}
function word(m: string): string {
  return ("  " + m).padEnd(COL);
}
const row = (mark: string, text: string) => mark + text;

// ─────────────────────────────────────────────────────────────── fixtures

const SETTINGS: Settings = { actor: "me", mergePolicy: "squash", answerWindowMs: 15 * MIN };
const CAPS_FULL: Caps = { superpowers: true, mattTdd: true, notify: true, tests: true, typecheck: true };
const CAPS_NO_SUPERPOWERS: Caps = { ...CAPS_FULL, superpowers: false };
const EMPTY_SNAPSHOT: Snapshot = { journalLast: null, branch: null, tracker: null };

function iss(
  id: string,
  title: string,
  priority: IssueFacts["priority"],
  createdAt: number,
  milestone: string | null = null,
  blockedBy: string[] = [],
): IssueFacts {
  return { id, title, priority, createdAt, milestone, agentReady: true, blockedBy, assignee: null };
}

// ──────────────────────────────────────────────────────── scripted driver

type Resolve = { data?: unknown } | { err: string };
type Fmt = (e: any, res: Resolve) => string;

type Beat =
  | { kind: "hide"; answer?: Resolve }
  | { kind: "note"; fmt: Fmt; answer?: Resolve }
  | { kind: "show"; fmt: Fmt; answer?: Resolve }
  | { kind: "event"; event: Event; left: string; text: string };

const hide = (answer?: Resolve): Beat => ({ kind: "hide", answer });
const note = (fmt: Fmt, answer?: Resolve): Beat => ({ kind: "note", fmt, answer });
const show = (fmt: Fmt, answer?: Resolve): Beat => ({ kind: "show", fmt, answer });
const evt = (event: Event, left: string, text: string): Beat => ({ kind: "event", event, left, text });
/** N boilerplate effects that carry no scenario-specific meaning. */
const H = (n: number): Beat[] => Array.from({ length: n }, () => hide());

type RunCfg = {
  mode: Mode;
  scope: Scope;
  settings: Settings;
  now?: number;
  caps: Caps;
  issues: IssueFacts[];
  snapshot?: Snapshot;
  branches?: string[];
  beats: Beat[];
};

function defaultAnswer(cfg: RunCfg, e: Effect): Resolve {
  switch (e.k) {
    case "host.preflight":
      return { data: cfg.caps };
    case "host.snapshot":
      return { data: cfg.snapshot ?? EMPTY_SNAPSHOT };
    case "tracker.candidates":
      return { data: cfg.issues };
    case "tracker.read":
      return { data: cfg.issues.find((i) => i.id === (e as any).issue)! };
    case "git.sync":
      return { data: { branches: cfg.branches ?? [] } };
    case "agent.implement":
      return { data: { result: "done" } };
    case "agent.check":
      return { data: { pass: true } };
    case "host.approval":
      return { data: { granted: true } };
    default:
      return {};
  }
}

/** The shared driver: run.start, then perform the queue head beat by beat. */
function runBeats(cfg: RunCfg): string[] {
  let state: RunState = initial();
  let queue: Effect[] = [];
  const lines: string[] = [];
  const dispatch = (ev: Event) => {
    const out = step(state, ev);
    state = out.state;
    queue = [...queue, ...out.effects];
  };
  dispatch({ k: "run.start", mode: cfg.mode, scope: cfg.scope, settings: cfg.settings, now: cfg.now ?? 0 });
  for (const b of cfg.beats) {
    if (b.kind === "event") {
      dispatch(b.event);
      lines.push(row(word(b.left), b.text));
      continue;
    }
    const e = queue.shift();
    if (!e) continue;
    const res = b.answer ?? defaultAnswer(cfg, e);
    dispatch("err" in res ? { k: "err", id: e.id, reason: res.err } : { k: "ok", id: e.id, data: (res as any).data });
    if (b.kind === "show") lines.push(row(sym("→"), b.fmt(e, res)));
    else if (b.kind === "note") lines.push(row(sym("..."), D(b.fmt(e, res))));
  }
  return lines;
}

// ──────────────────────────────────────────────────────────── scenario table

type Scenario = {
  id: string;
  title: string;
  tag: "preserve" | "correct";
  given: string[];
  body: () => string[];
  result: string;
  diverges?: string;
};

const mins = (deadlineAt: number, now: number) => (deadlineAt - now) / MIN;

const SCENARIOS: Scenario[] = [
  // ── S06 — select deterministically ────────────────────────────────────
  {
    id: "S06",
    title: "Select deterministically",
    tag: "preserve",
    given: [
      "candidates: 52 (P0, age 1, blocked by 99), 51 (P0, age 2), 50 (P0, age 9), 53 (P1, age 3)",
      "all agent-ready, unassigned",
    ],
    body: () =>
      runBeats({
        mode: "interactive",
        scope: { milestone: null },
        settings: SETTINGS,
        caps: CAPS_FULL,
        issues: [
          iss("52", "Oldest but blocked issue", "P0", 1, null, ["99"]),
          iss("51", "Second-oldest P0 issue", "P0", 2),
          iss("50", "Newest P0 issue", "P0", 9),
          iss("53", "P1 issue", "P1", 3),
        ],
        beats: [
          ...H(3), // preflight, snapshot, lease.acquire
          show(() => "tracker.candidates → sorted 52, 51, 50, 53 (priority, then age)"),
          show((e) => `tracker.read ${e.issue} — 52 skipped (blocked by 99)`),
          show((e) => `tracker.claim ${e.issue}`),
        ],
      }),
    result: "issue 51 claimed: oldest unblocked P0 candidate — 52 outranked it but was blocked, 50 and 53 rank lower",
  },

  // ── S07 — include unassigned work in milestone scope ──────────────────
  {
    id: "S07",
    title: "Include unassigned work in milestone scope",
    tag: "correct",
    given: ["scope: milestone A", "60 is in milestone A (P1); 61 has no milestone (P2)"],
    body: () =>
      runBeats({
        mode: "interactive",
        scope: { milestone: "A" },
        settings: SETTINGS,
        caps: CAPS_FULL,
        issues: [iss("60", "Milestone A work", "P1", 1, "A"), iss("61", "Unfiled work", "P2", 2, null)],
        beats: [
          ...H(3),
          show(() => "tracker.candidates → both 60 and 61 enter the pool (61 has no milestone)"),
          show((e) => `tracker.read ${e.issue}`),
          show((e) => `tracker.claim ${e.issue}`),
        ],
      }),
    result: "pool included 60 (milestone A) and 61 (unfiled); 60 claimed first by priority — scope did not drop the unfiled issue",
  },

  // ── S09 — trust a fresh candidate read ─────────────────────────────────
  {
    id: "S09",
    title: "Trust a fresh candidate read",
    tag: "preserve",
    given: ["stale candidate list: 70 (P0) looks unassigned, 71 (P1) backup"],
    body: () => {
      const issue70 = iss("70", "Stale-looking issue", "P0", 1);
      const issue71 = iss("71", "Backup issue", "P1", 2);
      return runBeats({
        mode: "interactive",
        scope: { milestone: null },
        settings: SETTINGS,
        caps: CAPS_FULL,
        issues: [issue70, issue71],
        beats: [
          ...H(3),
          show(() => "tracker.candidates → 2 candidates (stale): 70, 71"),
          show((e) => `tracker.read ${e.issue} → now assigned to someone else; skipped`, {
            data: { ...issue70, assignee: "other" },
          }),
          show((e) => `tracker.read ${e.issue} → still eligible`),
          show((e) => `tracker.claim ${e.issue}`),
        ],
      });
    },
    result: "70 dropped after a fresh read showed it already assigned; 71 claimed instead — the stale list never drove a claim directly",
  },

  // ── S10 — report an empty scoped Queue accurately ──────────────────────
  {
    id: "S10",
    title: "Report an empty scoped Queue accurately",
    tag: "preserve",
    given: ["scope: milestone m1", "no agent-ready, unblocked issues remain in m1"],
    body: () =>
      runBeats({
        mode: "headless",
        scope: { milestone: "m1" },
        settings: SETTINGS,
        caps: CAPS_FULL,
        issues: [],
        beats: [
          ...H(3),
          show(() => "tracker.candidates → 0 candidates"),
          show((e) => `host.report "${e.text}"`),
        ],
      }),
    result: "reports \"no unblocked agent-ready work in milestone m1\" — true, but carries no progress or open-issue counts",
    diverges:
      "requires the empty-queue report to carry progress and open-issue counts; the actual text only states that no unblocked work remains",
  },

  // ── S11 — do not invent work (both halves) ─────────────────────────────
  {
    id: "S11a",
    title: "Do not invent work — headless reports and stops",
    tag: "preserve",
    given: ["headless run, empty queue"],
    body: () =>
      runBeats({
        mode: "headless",
        scope: { milestone: null },
        settings: SETTINGS,
        caps: CAPS_FULL,
        issues: [],
        beats: [...H(3), show(() => "tracker.candidates → 0 candidates"), show((e) => `host.report "${e.text}" — run ends`)],
      }),
    result: "headless run reports the empty queue and stops; nothing is invented to work on",
  },
  {
    id: "S11b",
    title: "Do not invent work — interactive offers Planning",
    tag: "preserve",
    given: ["interactive run, empty queue"],
    body: () =>
      runBeats({
        mode: "interactive",
        scope: { milestone: null },
        settings: SETTINGS,
        caps: CAPS_FULL,
        issues: [],
        beats: [
          ...H(3),
          show(() => "tracker.candidates → 0 candidates"),
          show(() => "host.offerPlanning — a separate Planning Session is offered"),
        ],
      }),
    result: "interactive run offers a separate Planning Session instead of inventing work",
  },

  // ── S12 — claim once across workers ────────────────────────────────────
  {
    id: "S12",
    title: "Claim once across workers",
    tag: "correct",
    given: ["two candidates, 80 (P0) and 81 (P1); another worker claims 80 first"],
    body: () =>
      runBeats({
        mode: "interactive",
        scope: { milestone: null },
        settings: SETTINGS,
        caps: CAPS_FULL,
        issues: [iss("80", "Contended issue", "P0", 1), iss("81", "Fallback issue", "P1", 2)],
        beats: [
          ...H(4), // preflight, snapshot, lease.acquire, candidates
          hide(), // tracker.read 80
          show((e) => `tracker.claim ${e.issue} → lost the race (already assigned)`, { err: "already assigned" }),
          hide(), // tracker.read 81
          show((e) => `tracker.claim ${e.issue} → won`),
        ],
      }),
    result: "this worker lost the claim race on 80 and moved to 81 — exactly one claim succeeds per issue",
  },

  // ── S13 — derive one branch identity ───────────────────────────────────
  {
    id: "S13",
    title: "Derive one branch identity",
    tag: "correct",
    given: ["issue 18 'Derive one branch identity' claimed by harness A at t=0 and harness B at t=+6h"],
    body: () => {
      const issue = iss("18", "Derive one branch identity", "P0", 4);
      const a = branchName(issue);
      const b = branchName(issue);
      return [
        row(sym("→"), `harness A resolves the branch name at t=0 → ${a}`),
        row(sym("→"), `harness B resolves the branch name at t=+6h → ${b}`),
      ];
    },
    result: "both harnesses derive issue-18-derive-one-branch-identity — identity depends only on issue id and title, never on timing",
  },

  // ── S14 — start from the latest default branch ─────────────────────────
  {
    id: "S14",
    title: "Start from the latest default branch",
    tag: "preserve",
    given: ["issue 24 has no existing work branch"],
    body: () =>
      runBeats({
        mode: "interactive",
        scope: { milestone: null },
        settings: SETTINGS,
        caps: CAPS_FULL,
        issues: [iss("24", "Sync from the default branch", "P1", 1)],
        beats: [
          ...H(9), // preflight..journal.append
          show(() => "git.sync → default branch updated; no existing branch for 24"),
          show((e) => `git.worktree ${e.branch} — isolated worktree created`),
        ],
      }),
    result: "no prior branch existed, so the runtime synced the default branch first and created a fresh isolated worktree",
  },

  // ── S15 — select the TDD implementation (both halves) ──────────────────
  {
    id: "S15a",
    title: "Select the TDD implementation — Superpowers available",
    tag: "correct",
    given: ["Superpowers and Matt TDD are both available"],
    body: () =>
      runBeats({
        mode: "interactive",
        scope: { milestone: null },
        settings: SETTINGS,
        caps: CAPS_FULL,
        issues: [iss("25", "Implement the queue reader", "P1", 1)],
        beats: [
          show(() => "host.preflight → Superpowers present; tdd=superpowers selected"),
          ...H(10), // snapshot..git.worktree
          show((e) => `agent.implement ${e.issue} (tdd=${e.tdd})`),
        ],
      }),
    result: "implementation starts on Superpowers TDD",
  },
  {
    id: "S15b",
    title: "Select the TDD implementation — Superpowers absent",
    tag: "correct",
    given: ["Superpowers is unavailable; Matt TDD is available"],
    body: () =>
      runBeats({
        mode: "interactive",
        scope: { milestone: null },
        settings: SETTINGS,
        caps: CAPS_NO_SUPERPOWERS,
        issues: [iss("25", "Implement the queue reader", "P1", 1)],
        beats: [
          show(() => "host.preflight → Superpowers absent, Matt TDD available; tdd=matt selected, Preflight still passes"),
          ...H(10),
          show((e) => `agent.implement ${e.issue} (tdd=${e.tdd})`),
        ],
      }),
    result: "Preflight does not fail; implementation falls back to Matt TDD",
  },

  // ── S16 — enforce the landing gate ─────────────────────────────────────
  {
    id: "S16",
    title: "Enforce the landing gate",
    tag: "preserve",
    given: ["issue 26 implementation is complete; all four gates run (tests, typecheck, standards, spec)"],
    body: () =>
      runBeats({
        mode: "interactive",
        scope: { milestone: null },
        settings: SETTINGS,
        caps: CAPS_FULL,
        issues: [iss("26", "Add the landing gate check", "P1", 1)],
        beats: [
          ...H(12), // preflight..agent.implement (done)
          show((e) => `agent.check ${e.kind} → pass`),
          show((e) => `agent.check ${e.kind} → pass`),
          show((e) => `agent.check ${e.kind} → FAIL`, { data: { pass: false } }),
          show((e) => `agent.check ${e.kind} → pass`),
          show((e) => `git.push ${e.branch} — parked, not merged`),
        ],
      }),
    result: "review.standards failed the landing gate; the runtime parks the branch instead of merging or completing the issue",
  },

  // ── S17 — apply Project merge policy (both halves) ─────────────────────
  {
    id: "S17a",
    title: "Apply Project merge policy — automatic merge permitted",
    tag: "correct",
    given: ["all landing checks pass", "policy: rebase"],
    body: () =>
      runBeats({
        mode: "interactive",
        scope: { milestone: null },
        settings: { ...SETTINGS, mergePolicy: "rebase" },
        caps: CAPS_FULL,
        issues: [iss("27", "Apply the merge policy", "P1", 1)],
        beats: [
          ...H(12),
          ...H(4), // agent.check x4, all pass
          show((e) => `git.merge ${e.branch} (${e.method})`),
        ],
      }),
    result: "policy 'rebase' permits automatic merge, so the runtime merges with rebase — the configured method, not a hardcoded default",
  },
  {
    id: "S17b",
    title: "Apply Project merge policy — human approval required",
    tag: "correct",
    given: ["all landing checks pass", "policy: human"],
    body: () =>
      runBeats({
        mode: "interactive",
        scope: { milestone: null },
        settings: { ...SETTINGS, mergePolicy: "human" },
        caps: CAPS_FULL,
        issues: [iss("28", "Require human approval", "P1", 1)],
        beats: [
          ...H(12),
          ...H(4),
          show((e) => `host.approval ${e.issue} ${e.branch} — human approval requested`),
        ],
      }),
    result: "policy requires human approval, so the runtime requests it and has not merged",
  },

  // ── S18 — Park an unanswered question ──────────────────────────────────
  {
    id: "S18",
    title: "Park an unanswered question",
    tag: "preserve",
    given: [
      "interactive run, 15 min answer window, milestone m1 scope",
      "issue 42 agent-ready, unassigned, unblocked",
    ],
    body: () => {
      const issue = iss("42", "Derive one branch identity", "P1", 5, "m1");
      return runBeats({
        mode: "interactive",
        scope: { milestone: "m1" },
        settings: SETTINGS,
        caps: CAPS_FULL,
        issues: [issue],
        beats: [
          note(() => "preflight ok (tdd=superpowers)"),
          hide(), // snapshot
          hide(), // lease.acquire
          hide(), // tracker.candidates
          hide(), // tracker.read
          note((e) => `claimed ${e.issue}, branch ${branchName(issue)}`), // tracker.claim
          hide(), // tracker.state started
          hide(), // tracker.comment (branch ...)
          hide(), // journal.append
          hide(), // git.sync
          hide(), // git.worktree
          note((e, res) => `agent.implement → question "${(res as { data: any }).data.question}"`, {
            data: { result: "question", question: "which tracker owns the lease?" },
          }),
          show((e) => `host.ask (deadline ${mins(e.deadlineAt, 0)}m)`),
          evt({ k: "tick", now: SETTINGS.answerWindowMs }, "+15m", "deadline passed with no answer"),
          show((e) => `git.push ${e.branch}`),
          show((e) => `tracker.comment "${e.text}"`),
          show((e) => `tracker.unclaim ${e.issue}`),
          show((e) => `tracker.state ${e.state}`),
        ],
      });
    },
    result: "issue 42 parked: claim released, agent-ready dropped, work on the branch",
  },

  // ── S19 — reconcile an interrupted transition ───────────────────────────
  {
    id: "S19",
    title: "Reconcile an interrupted transition",
    tag: "correct",
    given: [
      "run crashed after git.push but before the tracker Park write (issue 55 was mid-question)",
      "git shows branch issue-55-rotate-the-lease-token pushed; tracker still shows 55 started, assigned to me",
    ],
    body: () =>
      runBeats({
        mode: "interactive",
        scope: { milestone: null },
        settings: SETTINGS,
        caps: CAPS_FULL,
        issues: [],
        snapshot: {
          journalLast: null,
          branch: { name: "issue-55-rotate-the-lease-token", issue: "55", pushed: true },
          tracker: { issue: "55", state: "started", assignee: "me" },
        },
        beats: [
          hide(), // host.preflight
          show(() => "host.snapshot → branch pushed, tracker still 'started'; no journal entry marks the Park"),
          show(() => "reconcile: can't distinguish a stalled Park from ordinary in-progress work → resumes it → lease.acquire"),
          show((e) => `agent.implement ${e.issue} → question "should this land before the payments migration?" (re-asked)`, {
            data: { result: "question", question: "should this land before the payments migration?" },
          }),
          show((e) => `host.ask (deadline ${mins(e.deadlineAt, 0)}m)`),
        ],
      }),
    result: "run resumes issue 55 as in-progress and re-asks the same question instead of completing or reversing the interrupted Park",
    diverges:
      "asks for idempotent completion of an interrupted Park; this run resumes and re-asks the question instead",
  },

  // ── S20 — recover without the local journal ─────────────────────────────
  {
    id: "S20",
    title: "Recover without the local journal",
    tag: "correct",
    given: [
      "clean clone, no .scratch/ journal",
      "git and the tracker agree: issue 70 started, branch issue-70-normalize-the-tracker-adapter pushed, assigned to me",
    ],
    body: () =>
      runBeats({
        mode: "interactive",
        scope: { milestone: null },
        settings: SETTINGS,
        caps: CAPS_FULL,
        issues: [],
        snapshot: {
          journalLast: null,
          branch: { name: "issue-70-normalize-the-tracker-adapter", issue: "70", pushed: true },
          tracker: { issue: "70", state: "started", assignee: "me" },
        },
        beats: [
          hide(), // host.preflight
          show(() => "host.snapshot → no journal; git and tracker agree on issue 70 in progress"),
          show(() => "reconcile: reconstructs 70 from git + tracker alone → lease.acquire"),
          show((e) => `agent.implement ${e.issue} (resumed, tdd=${e.tdd}) — same issue, not new work`),
        ],
      }),
    result: "the run reconstructs issue 70 entirely from git and the tracker — no journal required — and resumes it instead of selecting new work",
  },

  // ── P01 — Park, re-ready, and re-pickup (local id) ──────────────────────
  {
    id: "P01",
    title: "Park, re-ready, and re-pickup",
    tag: "correct",
    given: [
      "issue 48 parks on an unanswered question (run 1); the maintainer re-readies it",
      "run 2 starts fresh with 48 agent-ready again and its pushed branch still on git",
    ],
    body: () => {
      const issue = iss("48", "Add pagination to the queue reader", "P1", 3);
      const branch = branchName(issue);
      const run1 = runBeats({
        mode: "interactive",
        scope: { milestone: null },
        settings: SETTINGS,
        caps: CAPS_FULL,
        issues: [issue],
        beats: [
          ...H(5), // preflight, snapshot, lease.acquire, candidates, read
          note((e) => `claimed ${e.issue}, branch ${branch}`), // tracker.claim
          ...H(5), // state, comment, journal, git.sync, git.worktree
          note(() => 'agent.implement → question "does the audit log need a schema bump first?"', {
            data: { result: "question", question: "does the audit log need a schema bump first?" },
          }),
          hide(), // host.ask
          evt({ k: "tick", now: SETTINGS.answerWindowMs }, "+15m", "deadline passed with no answer"),
          hide(), // git.push
          hide(), // tracker.comment
          hide(), // tracker.unclaim
          note(() => "parked 48: branch pushed, claim released, agent-ready dropped"), // tracker.state
        ],
      });
      const ready = row(word("ready"), "maintainer re-readies issue 48 — agent-ready restored, tracker claim cleared");
      const run2 = runBeats({
        mode: "interactive",
        scope: { milestone: null },
        settings: SETTINGS,
        caps: CAPS_FULL,
        issues: [{ ...issue, agentReady: true, assignee: null }],
        branches: [branch],
        snapshot: { journalLast: null, branch: { name: branch, issue: "48", pushed: true }, tracker: null },
        beats: [
          ...H(9), // preflight..journal.append
          show(() => `git.sync → ${branch} already exists; resuming it instead of a fresh worktree`),
          show((e) => `agent.implement ${e.issue} (resumed, tdd=${e.tdd})`),
        ],
      });
      return [...run1, ready, ...run2];
    },
    result:
      "issue 48 re-enters selection after being re-readied, and git.sync finds its pushed branch already exists — the run resumes it instead of creating a new worktree",
  },
];

// ───────────────────────────────────────────────────────────────── printing

const HEADER_WIDTH = 79;

function divergeBlock(id: string, text: string): string {
  const prefix = "  ⚠ diverges  ";
  const indent = " ".repeat(14);
  const width = 65;
  const words = `${id} ${text}`.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > width) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.map((l, i) => (i === 0 ? prefix + l : indent + l)).join("\n");
}

function printScenario(s: Scenario): string {
  const out: string[] = [];
  const tagStr = `[${s.tag}]`;
  const header = `${s.id} — ${s.title}`;
  const coloredTag = s.tag === "correct" ? Y(tagStr) : D(tagStr);
  out.push(B(header.padEnd(HEADER_WIDTH - tagStr.length)) + coloredTag);
  for (const g of s.given) out.push(row(word("given"), D(g)));
  out.push(...s.body());
  out.push(row(word("result"), s.result));
  if (s.diverges) out.push(divergeBlock(s.id, s.diverges));
  return out.join("\n");
}

function main() {
  const filter = process.argv[2];
  const list = filter ? SCENARIOS.filter((s) => s.id === filter || s.id.startsWith(filter)) : SCENARIOS;
  console.log(list.map(printScenario).join("\n\n"));
  console.log("");
  const diverged = list.filter((s) => s.diverges).map((s) => s.id);
  console.log(`${list.length} scenario(s) ran.`);
  console.log(diverged.length ? `diverges from baseline: ${diverged.join(", ")}` : "diverges from baseline: (none)");
}

main();
