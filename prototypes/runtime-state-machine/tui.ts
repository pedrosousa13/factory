/**
 * THROWAWAY SHELL for machine.ts. Not production code, not lifted anywhere.
 *
 * Run: bun prototypes/runtime-state-machine/tui.ts
 *
 * It fakes a world (tracker, git, agent, host) so you can hand-drive the
 * reducer, arm failures, let a deadline expire, and crash mid-transition.
 */

import {
  initial,
  step,
  type Caps,
  type Effect,
  type Event,
  type IssueFacts,
  type MergeMethod,
  type RunState,
  type Snapshot,
} from "./machine.ts";

const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
const D = (s: string) => `\x1b[2m${s}\x1b[0m`;
const G = (s: string) => `\x1b[32m${s}\x1b[0m`;
const R = (s: string) => `\x1b[31m${s}\x1b[0m`;
const Y = (s: string) => `\x1b[33m${s}\x1b[0m`;

const MIN = 60_000;

// ─────────────────────────────────────────────────────────── the fake world

const ISSUES = (): IssueFacts[] => [
  { id: "41", title: "Add pagination to the queue reader", priority: "P2", createdAt: 1, milestone: "m1", agentReady: true, blockedBy: [], assignee: null },
  { id: "42", title: "Derive one branch identity", priority: "P0", createdAt: 5, milestone: "m1", agentReady: true, blockedBy: [], assignee: null },
  { id: "43", title: "Lease renewal", priority: "P0", createdAt: 9, milestone: "m1", agentReady: true, blockedBy: ["99"], assignee: null },
  { id: "44", title: "Unfiled cleanup task", priority: "P1", createdAt: 3, milestone: null, agentReady: true, blockedBy: [], assignee: null },
  { id: "45", title: "Next milestone work", priority: "P0", createdAt: 2, milestone: "m2", agentReady: true, blockedBy: [], assignee: null },
];

type World = {
  issues: IssueFacts[];
  caps: Caps;
  journal: { at: number; note: string }[];
  branch: { name: string; issue: string; pushed: boolean } | null;
  tracker: { issue: string; state: "started" | "parked"; assignee: string | null } | null;
  armQuestion: boolean;
  armImplFail: boolean;
  armGateFail: boolean;
  armDecline: boolean;
};

function freshWorld(keepJournal = false, prev?: World): World {
  return {
    issues: prev ? prev.issues : ISSUES(),
    caps: prev ? prev.caps : { superpowers: true, mattTdd: true, notify: true, tests: true, typecheck: true },
    journal: keepJournal && prev ? prev.journal : [],
    branch: prev ? prev.branch : null,
    tracker: prev ? prev.tracker : null,
    armQuestion: false,
    armImplFail: false,
    armDecline: false,
    armGateFail: false,
  };
}

/** The host side of the seam: performs one effect, returns its result. */
function perform(w: World, e: Effect): { data?: unknown; err?: string } {
  switch (e.k) {
    case "host.preflight":
      return { data: w.caps };
    case "host.snapshot":
      return {
        data: {
          journalLast: w.journal.at(-1) ?? null,
          branch: w.branch,
          tracker: w.tracker,
        } satisfies Snapshot,
      };
    case "tracker.candidates":
      return { data: w.issues };
    case "tracker.read":
      return { data: w.issues.find((i) => i.id === e.issue)! };
    case "tracker.claim": {
      const i = w.issues.find((x) => x.id === e.issue)!;
      i.assignee = e.actor;
      w.tracker = { issue: i.id, state: "started", assignee: e.actor };
      return {};
    }
    case "tracker.unclaim": {
      const i = w.issues.find((x) => x.id === e.issue);
      if (i) { i.assignee = null; i.agentReady = false; }
      w.tracker = null;
      return {};
    }
    case "tracker.state":
      if (e.state === "parked") w.tracker = { issue: e.issue, state: "parked", assignee: null };
      if (e.state === "done") {
        w.tracker = null;
        w.issues = w.issues.filter((i) => i.id !== e.issue);
        w.branch = null;
      }
      return {};
    case "git.sync":
      return { data: { branches: w.branch ? [w.branch.name] : [] } };
    case "git.worktree":
      w.branch = { name: e.branch, issue: e.issue, pushed: false };
      return {};
    case "git.push":
      if (w.branch) w.branch.pushed = true;
      return {};
    case "git.merge":
      w.branch = null;
      return {};
    case "journal.append":
      w.journal.push(e.entry);
      return {};
    case "agent.implement":
      if (w.armImplFail) { w.armImplFail = false; return { data: { result: "failed", reason: "tests never went green" } }; }
      if (w.armQuestion) { w.armQuestion = false; return { data: { result: "question", question: "which tracker owns the lease?" } }; }
      return { data: { result: "done" } };
    case "agent.check":
      if (w.armGateFail) { w.armGateFail = false; return { data: { pass: false } }; }
      return { data: { pass: true } };
    case "host.approval": {
      const granted = !w.armDecline;
      w.armDecline = false;
      return { data: { granted } };
    }
    default:
      return {};
  }
}

/** The parked issue: not agentReady, with a pushed branch pointed at it. */
function parkedIssue(w: World): IssueFacts | undefined {
  return w.issues.find((i) => !i.agentReady && w.branch?.issue === i.id && w.branch?.pushed);
}

// ───────────────────────────────────────────────────────────────── the loop

let world = freshWorld();
let state: RunState = initial();
let queue: Effect[] = [];
let mode: "interactive" | "headless" = "interactive";
let policy: MergeMethod | "human" = "squash";
let milestone: string | null = "m1";

function dispatch(ev: Event) {
  const out = step(state, ev);
  state = out.state;
  queue = [...queue, ...out.effects];
}

function startRun() {
  const now = state.now;
  queue = [];
  state = initial();
  dispatch({
    k: "run.start",
    mode,
    scope: { milestone },
    settings: { actor: "me", mergePolicy: policy, answerWindowMs: 15 * MIN },
    now,
  });
}

function performNext(fail: boolean) {
  const e = queue.shift();
  if (!e) return;
  if (fail) {
    dispatch({ k: "err", id: e.id, reason: e.k === "tracker.claim" ? "already assigned" : "host refused" });
    return;
  }
  const r = perform(world, e);
  dispatch(r.err ? { k: "err", id: e.id, reason: r.err } : { k: "ok", id: e.id, data: r.data });
}

// ────────────────────────────────────────────────────────────────── render

function describe(e: Effect): string {
  const rest = Object.entries(e)
    .filter(([k]) => k !== "k" && k !== "id")
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" ");
  return `${e.k} ${D(rest)}`;
}

function render() {
  const w = state.work;
  const lines: string[] = [];
  lines.push(B("FACTORY v2 RUNTIME — lifecycle state machine") + D("  (prototype, ticket #26)"));
  lines.push("");
  lines.push(
    `${B("mode")} ${mode}   ${B("scope")} ${milestone ?? "all"}   ${B("policy")} ${policy}   ` +
      `${B("superpowers")} ${world.caps.superpowers ? G("yes") : R("no")}   ${B("clock")} ${D(`${state.now / MIN}m`)}`,
  );
  lines.push(`${B("phase")} ${Y(state.phase.k)}${state.phase.k === "selecting" ? D(` cursor=${state.phase.cursor}/${state.phase.pool.length}`) : ""}   ${B("lease")} ${state.lease}`);
  lines.push("");

  if (w) {
    lines.push(`${B("work")} #${w.issue.id} ${D(w.issue.title)}`);
    lines.push(`  ${B("step")} ${Y(w.step)}${w.resumed ? D(" (resumed)") : ""}   ${B("tdd")} ${w.tdd}`);
    lines.push(`  ${B("branch")} ${w.branch}`);
    if (w.question) lines.push(`  ${B("question")} ${Y(w.question)}  ${D(w.deadlineAt !== null ? `deadline ${w.deadlineAt / MIN}m` : "")}`);
    if (w.gates.length)
      lines.push(`  ${B("gates")} ` + w.gates.map((g) => `${g.kind}:${g.pass === null ? D("?") : g.pass ? G("ok") : R("fail")}`).join(" "));
  } else {
    lines.push(D("work  (none)"));
  }
  lines.push("");
  lines.push(`${B("pending effects")} ${queue.length ? "" : D("(none)")}`);
  queue.slice(0, 5).forEach((e, i) => lines.push(`  ${i === 0 ? Y("▶") : " "} ${describe(e)}`));
  if (queue.length > 5) lines.push(D(`  … ${queue.length - 5} more`));
  lines.push("");
  const parked = parkedIssue(world);
  lines.push(
    `${B("world")} ${D(
      `branch=${world.branch ? `${world.branch.name}${world.branch.pushed ? " (pushed)" : ""}` : "none"}  ` +
        `tracker=${world.tracker ? `${world.tracker.issue}@${world.tracker.assignee ?? "-"}(${world.tracker.state})` : "idle"}  ` +
        `journal=${world.journal.length}  open=${world.issues.length}` +
        (parked ? `  parked=${parked.id}` : ""),
    )}`,
  );
  const armed = [
    world.armQuestion && "question",
    world.armImplFail && "impl-fail",
    world.armGateFail && "gate-fail",
    world.armDecline && "decline",
  ].filter(Boolean);
  if (armed.length) lines.push(`${B("armed")} ${Y(armed.join(", "))}`);
  lines.push("");
  lines.push(B("trace"));
  state.trace.forEach((t) => lines.push(D("  " + t)));
  lines.push("");
  lines.push(
    D("[enter] perform next  [f] fail next  [t] +5min  [a] answer  [A] answer parked  [r] restart run\n") +
      D("[Q] arm question  [X] arm impl-fail  [G] arm gate-fail  [D] arm decline\n") +
      D("[k] crash+restart (keep journal)  [K] crash+restart (wipe journal)\n") +
      D("[m] merge policy  [s] superpowers  [p] scope  [h] headless  [q] quit"),
  );

  console.clear();
  console.log(lines.join("\n"));
}

// ──────────────────────────────────────────────────────────────── keyboard

startRun();
render();

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  for (const key of chunk) handleKey(key);
  render();
});

function handleKey(key: string) {
  switch (key) {
    case "\r":
    case "\n":
    case " ":
      performNext(false);
      break;
    case "f":
      performNext(true);
      break;
    case "t":
      dispatch({ k: "tick", now: state.now + 5 * MIN });
      break;
    case "a":
      dispatch({ k: "answer", text: "the coordinator owns it" });
      break;
    case "A": {
      const parked = parkedIssue(world);
      if (parked) {
        parked.agentReady = true;
        if (world.tracker && world.tracker.issue === parked.id && world.tracker.state === "parked") {
          world.tracker = null;
        }
      }
      break;
    }
    case "Q":
      world.armQuestion = true;
      break;
    case "X":
      world.armImplFail = true;
      break;
    case "G":
      world.armGateFail = true;
      break;
    case "D":
      world.armDecline = true;
      break;
    case "r":
      startRun();
      break;
    case "k":
      world = freshWorld(true, world);
      startRun();
      break;
    case "K":
      world = freshWorld(false, world);
      startRun();
      break;
    case "m":
      policy = policy === "squash" ? "human" : "squash";
      break;
    case "s":
      world.caps = { ...world.caps, superpowers: !world.caps.superpowers };
      break;
    case "p":
      milestone = milestone === "m1" ? null : "m1";
      break;
    case "h":
      mode = mode === "interactive" ? "headless" : "interactive";
      break;
    case "q":
    case "":
      console.clear();
      process.exit(0);
  }
}
