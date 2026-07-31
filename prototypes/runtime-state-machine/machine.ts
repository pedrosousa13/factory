/**
 * Factory v2 runtime — lifecycle state machine.
 *
 * QUESTION THIS PROTOTYPE ANSWERS (ticket #26): what is the smallest deep
 * runtime interface that can own deterministic lifecycle transitions,
 * recovery, and harness-neutral execution without absorbing judgment-heavy
 * skill behaviour?
 *
 * The answer under test: the runtime is a pure reducer. It owns *what
 * happens next*. It never performs I/O, never reads a clock, never parses
 * prose. Judgment lives behind `agent.*` effects whose results are a closed
 * set of variants the reducer can switch on.
 *
 * Interface: `step(state, event) -> { state, effects }` plus `initial()`.
 * That is the whole external surface. Everything else here is implementation.
 *
 * THROWAWAY: this file is the keepable part of a throwaway prototype. No
 * tests, no error handling beyond what keeps it runnable.
 */

// ─────────────────────────────────────────────────────────── domain values

export type Mode = "interactive" | "headless";
export type Priority = "P0" | "P1" | "P2" | "P3";
export type Tdd = "superpowers" | "matt";
export type MergeMethod = "squash" | "merge" | "rebase";

export type Caps = {
  superpowers: boolean;
  mattTdd: boolean;
  notify: boolean;
  tests: boolean;
  typecheck: boolean;
};

export type Settings = {
  actor: string;
  mergePolicy: MergeMethod | "human";
  answerWindowMs: number;
};

export type Scope = { milestone: string | null };

export type IssueFacts = {
  id: string;
  title: string;
  priority: Priority;
  createdAt: number;
  milestone: string | null;
  agentReady: boolean;
  blockedBy: string[]; // ids of still-open blockers
  assignee: string | null;
};

/** What a run found on disk and on the tracker before it selected work. */
export type Snapshot = {
  journalLast: JournalEntry | null;
  branch: { name: string; issue: string; pushed: boolean } | null;
  tracker: { issue: string; state: "started" | "parked"; assignee: string | null } | null;
};

export type JournalEntry = { at: number; note: string };

// ────────────────────────────────────────────────────────────────── effects

export type EffectId = string;

export type Effect = { id: EffectId } & (
  | { k: "host.preflight" }
  | { k: "host.snapshot" }
  | { k: "host.report"; text: string }
  | { k: "host.offerPlanning" }
  | { k: "host.ask"; issue: string; question: string; deadlineAt: number }
  | { k: "host.approval"; issue: string; branch: string }
  | { k: "lease.acquire"; actor: string }
  | { k: "lease.release" }
  | { k: "tracker.candidates"; scope: Scope }
  | { k: "tracker.read"; issue: string }
  | { k: "tracker.claim"; issue: string; actor: string }
  | { k: "tracker.comment"; issue: string; text: string }
  | { k: "tracker.state"; issue: string; state: "started" | "parked" | "done" }
  | { k: "tracker.unclaim"; issue: string }
  | { k: "git.sync" }
  | { k: "git.worktree"; issue: string; branch: string }
  | { k: "git.push"; branch: string }
  | { k: "git.merge"; branch: string; method: MergeMethod }
  | { k: "agent.implement"; issue: string; branch: string; tdd: Tdd }
  | {
      k: "agent.check";
      issue: string;
      kind: "tests" | "typecheck" | "review.standards" | "review.spec";
    }
  | { k: "journal.append"; entry: JournalEntry }
);

/** Closed-set results. The reducer switches on these; it never reads prose. */
export type ImplementResult =
  | { result: "done" }
  | { result: "question"; question: string }
  | { result: "failed"; reason: string };

export type Event =
  | { k: "run.start"; mode: Mode; scope: Scope; settings: Settings; now: number }
  | { k: "tick"; now: number }
  | { k: "ok"; id: EffectId; data?: unknown }
  | { k: "err"; id: EffectId; reason: string }
  | { k: "answer"; text: string };

// ──────────────────────────────────────────────────────────────────── state

export type WorkStep =
  | "claiming"
  | "starting"
  | "branching"
  | "implementing"
  | "question"
  | "parking"
  | "gates"
  | "merging"
  | "approval"
  | "completing";

export type Work = {
  issue: IssueFacts;
  branch: string;
  step: WorkStep;
  tdd: Tdd;
  question: string | null;
  deadlineAt: number | null;
  gates: { kind: string; pass: boolean | null }[];
  resumed: boolean;
};

export type Phase =
  | { k: "idle" }
  | { k: "preflight" }
  | { k: "reconciling" }
  | { k: "selecting"; pool: IssueFacts[]; cursor: number }
  | { k: "working" }
  | { k: "ended"; reason: string };

export type RunState = {
  mode: Mode;
  now: number;
  settings: Settings;
  scope: Scope;
  caps: Caps | null;
  lease: "none" | "held";
  phase: Phase;
  work: Work | null;
  inflight: Record<EffectId, Effect>;
  trace: string[];
  seq: number;
};

export function initial(): RunState {
  return {
    mode: "interactive",
    now: 0,
    settings: { actor: "me", mergePolicy: "squash", answerWindowMs: 15 * 60_000 },
    scope: { milestone: null },
    caps: null,
    lease: "none",
    phase: { k: "idle" },
    work: null,
    inflight: {},
    trace: [],
    seq: 0,
  };
}

// ───────────────────────────────────────────────────────── pure helpers

/** C03/S13: one exact branch identity, derivable by any harness at any time. */
export function branchName(issue: { id: string; title: string }): string {
  const slug = issue.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/, "");
  return `issue-${issue.id}-${slug}`;
}

const RANK: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/** S06/S07: deterministic order; a milestone scope stays fail-open. */
export function selectPool(all: IssueFacts[], scope: Scope): IssueFacts[] {
  return all
    .filter((i) => i.agentReady && !i.assignee)
    .filter(
      (i) =>
        scope.milestone === null ||
        i.milestone === scope.milestone ||
        i.milestone === null,
    )
    .sort(
      (a, b) => RANK[a.priority] - RANK[b.priority] || a.createdAt - b.createdAt,
    );
}

function eligible(i: IssueFacts, scope: Scope, actor: string): boolean {
  const inScope =
    scope.milestone === null ||
    i.milestone === scope.milestone ||
    i.milestone === null;
  return (
    i.agentReady &&
    inScope &&
    i.blockedBy.length === 0 &&
    (i.assignee === null || i.assignee === actor)
  );
}

function pickTdd(caps: Caps): Tdd | null {
  if (caps.superpowers) return "superpowers";
  if (caps.mattTdd) return "matt";
  return null;
}

function gatesFor(caps: Caps): { kind: string; pass: boolean | null }[] {
  const g: { kind: string; pass: boolean | null }[] = [];
  if (caps.tests) g.push({ kind: "tests", pass: null });
  if (caps.typecheck) g.push({ kind: "typecheck", pass: null });
  g.push({ kind: "review.standards", pass: null });
  g.push({ kind: "review.spec", pass: null });
  return g;
}

// ────────────────────────────────────────────────────────── the reducer

type Out = { state: RunState; effects: Effect[] };

type EffectSpec = Effect extends infer T ? (T extends Effect ? Omit<T, "id"> : never) : never;

/** Effect ids are allocated from state.seq, so a replay produces the same ids. */
function emit(s: RunState, ...specs: EffectSpec[]): Out {
  const effects: Effect[] = [];
  let seq = s.seq;
  const inflight = { ...s.inflight };
  for (const spec of specs) {
    const e = { ...spec, id: `e${seq++}` } as Effect;
    effects.push(e);
    inflight[e.id] = e;
  }
  return { state: { ...s, seq, inflight }, effects };
}

function say(s: RunState, line: string): RunState {
  return { ...s, trace: [...s.trace, line].slice(-14) };
}

function end(s: RunState, reason: string): Out {
  const done: RunState = say({ ...s, phase: { k: "ended", reason } }, `end: ${reason}`);
  return s.lease === "held"
    ? emit({ ...done, lease: "none" }, { k: "lease.release" })
    : { state: done, effects: [] };
}

export function step(prev: RunState, ev: Event): Out {
  switch (ev.k) {
    case "run.start": {
      const s: RunState = {
        ...initial(),
        mode: ev.mode,
        scope: ev.scope,
        settings: ev.settings,
        now: ev.now,
        phase: { k: "preflight" },
      };
      return emit(say(s, `run.start (${ev.mode})`), { k: "host.preflight" });
    }

    case "tick": {
      const s = { ...prev, now: ev.now };
      const w = s.work;
      // S18: an unanswered question Parks when its deadline passes.
      if (w && w.step === "question" && w.deadlineAt !== null && ev.now >= w.deadlineAt) {
        return park(s, w, "no answer before the deadline");
      }
      return { state: s, effects: [] };
    }

    case "answer": {
      const w = prev.work;
      if (!w || w.step !== "question") return { state: prev, effects: [] };
      const next: Work = { ...w, step: "implementing", question: null, deadlineAt: null };
      return emit(say({ ...prev, work: next }, `answer received; resume ${w.issue.id}`), {
        k: "journal.append",
        entry: { at: prev.now, note: `answered ${w.issue.id}` },
      });
    }

    case "err":
      return onErr(prev, ev.id, ev.reason);

    case "ok":
      return onOk(prev, ev.id, ev.data);
  }
}

function onErr(prev: RunState, id: EffectId, reason: string): Out {
  const eff = prev.inflight[id];
  const s = retire(prev, id);
  if (!eff) return { state: s, effects: [] };

  // S12: losing a claim race is normal — move to the next candidate.
  if (eff.k === "tracker.claim" && prev.phase.k === "selecting") {
    const p = prev.phase;
    return advance(say(s, `claim lost on ${eff.issue} (${reason})`), p.pool, p.cursor + 1);
  }
  return end(say(s, `${eff.k} failed: ${reason}`), `stopped on ${eff.k}`);
}

function onOk(prev: RunState, id: EffectId, data: unknown): Out {
  const eff = prev.inflight[id];
  const s = retire(prev, id);
  if (!eff) return { state: s, effects: [] };

  switch (eff.k) {
    case "host.preflight": {
      const caps = data as Caps;
      if (!pickTdd(caps)) return end(say(s, "preflight: no TDD path"), "preflight failed");
      // S15: report the selected path rather than failing when Superpowers is absent.
      const s2 = say({ ...s, caps, phase: { k: "reconciling" } }, `preflight ok (tdd=${pickTdd(caps)})`);
      return emit(s2, { k: "host.snapshot" });
    }

    case "host.snapshot":
      return reconcile(s, data as Snapshot);

    case "lease.acquire": {
      const held = say({ ...s, lease: "held" }, "lease held");
      // A resumed run already has its work; only a fresh one selects.
      if (held.phase.k === "working") return { state: held, effects: [] };
      return emit(held, { k: "tracker.candidates", scope: s.scope });
    }

    case "tracker.candidates": {
      const pool = selectPool(data as IssueFacts[], s.scope);
      return advance(say(s, `${pool.length} candidate(s)`), pool, 0);
    }

    // S09: the listing lags, so every candidate is re-read before it is claimed.
    case "tracker.read": {
      const fresh = data as IssueFacts;
      if (s.phase.k === "reconciling") {
        const work: Work = {
          issue: fresh,
          branch: branchName(fresh),
          step: "branching",
          tdd: pickTdd(s.caps!)!,
          question: null,
          deadlineAt: null,
          gates: [],
          resumed: true,
        };
        return emit(
          say({ ...s, phase: { k: "working" }, work }, `resuming ${fresh.id} at the branch step`),
          { k: "lease.acquire", actor: s.settings.actor },
          { k: "git.sync" },
        );
      }
      if (s.phase.k !== "selecting") return { state: s, effects: [] };
      const p = s.phase;
      if (!eligible(fresh, s.scope, s.settings.actor)) {
        return advance(say(s, `${fresh.id} no longer eligible`), p.pool, p.cursor + 1);
      }
      const pool = p.pool.map((i) => (i.id === fresh.id ? fresh : i));
      return emit(
        { ...s, phase: { ...p, pool } },
        { k: "tracker.claim", issue: fresh.id, actor: s.settings.actor },
      );
    }

    case "tracker.claim": {
      if (s.phase.k !== "selecting") return { state: s, effects: [] };
      const issue = s.phase.pool[s.phase.cursor];
      const work: Work = {
        issue,
        branch: branchName(issue),
        step: "starting",
        tdd: pickTdd(s.caps!)!,
        question: null,
        deadlineAt: null,
        gates: [],
        resumed: false,
      };
      const s2 = say({ ...s, phase: { k: "working" }, work }, `claimed ${issue.id}`);
      return emit(
        s2,
        { k: "tracker.state", issue: issue.id, state: "started" },
        { k: "tracker.comment", issue: issue.id, text: `branch ${work.branch}` },
        { k: "journal.append", entry: { at: s.now, note: `claimed ${issue.id}` } },
      );
    }

    case "tracker.state": {
      const w = s.work;
      if (!w) return { state: s, effects: [] };
      if (eff.state === "started" && w.step === "starting") {
        return emit({ ...s, work: { ...w, step: "branching" } }, { k: "git.sync" });
      }
      if (eff.state === "parked") return nextIssue(say(s, `parked ${w.issue.id}`));
      if (eff.state === "done") return nextIssue(say(s, `completed ${w.issue.id}`));
      return { state: s, effects: [] };
    }

    // S14: branch from a fresh default branch, unless a parked issue's pushed
    // branch already exists — then resume it instead of orphaning the work.
    case "git.sync": {
      const w = s.work!;
      const branches = (data as { branches: string[] }).branches;
      if (branches.includes(w.branch)) {
        return emit(
          say({ ...s, work: { ...w, step: "implementing", resumed: true } }, `resuming pushed branch ${w.branch}`),
          { k: "agent.implement", issue: w.issue.id, branch: w.branch, tdd: w.tdd },
        );
      }
      return emit(s, { k: "git.worktree", issue: w.issue.id, branch: w.branch });
    }

    case "git.worktree": {
      const w = s.work!;
      return emit(
        say({ ...s, work: { ...w, step: "implementing" } }, `worktree ${w.branch}`),
        { k: "agent.implement", issue: w.issue.id, branch: w.branch, tdd: w.tdd },
      );
    }

    // The judgment seam: a closed set of variants, never prose.
    case "agent.implement": {
      const w = s.work!;
      const r = data as ImplementResult;
      if (r.result === "done") {
        const gates = gatesFor(s.caps!);
        const s2 = say({ ...s, work: { ...w, step: "gates", gates } }, "implementation done");
        return emit(s2, ...gates.map((g) => ({
          k: "agent.check" as const,
          issue: w.issue.id,
          kind: g.kind as "tests",
        })));
      }
      if (r.result === "question") {
        const deadlineAt = s.now + s.settings.answerWindowMs;
        // S11/headless: nobody is there to answer, so Park immediately.
        if (s.mode === "headless" || !s.caps!.notify) {
          return park({ ...s, work: { ...w, question: r.question } }, w, r.question);
        }
        const next: Work = { ...w, step: "question", question: r.question, deadlineAt };
        return emit(say({ ...s, work: next }, `question: ${r.question}`), {
          k: "host.ask",
          issue: w.issue.id,
          question: r.question,
          deadlineAt,
        });
      }
      return park(s, w, `implementation failed: ${r.reason}`);
    }

    case "agent.check": {
      const w = s.work;
      if (!w || w.step !== "gates") return { state: s, effects: [] };
      const pass = (data as { pass: boolean }).pass;
      const gates = w.gates.map((g) => (g.kind === eff.kind ? { ...g, pass } : g));
      const s2 = { ...s, work: { ...w, gates } };
      if (gates.some((g) => g.pass === null)) return { state: s2, effects: [] };
      // S16: the landing gate is all-or-nothing.
      if (gates.some((g) => g.pass === false)) {
        return park(s2, { ...w, gates }, "landing gate failed");
      }
      return land(s2, { ...w, gates });
    }

    case "host.approval": {
      const w = s.work!;
      const granted = (data as { granted: boolean }).granted;
      if (!granted) return park(s, w, "merge approval declined");
      return emit(
        say({ ...s, work: { ...w, step: "merging" } }, "approval granted"),
        { k: "git.merge", branch: w.branch, method: "squash" },
      );
    }

    case "git.merge": {
      const w = s.work!;
      return emit(
        say({ ...s, work: { ...w, step: "completing" } }, `merged ${w.branch}`),
        { k: "tracker.state", issue: w.issue.id, state: "done" },
        { k: "journal.append", entry: { at: s.now, note: `landed ${w.issue.id}` } },
      );
    }

    case "git.push": {
      const w = s.work!;
      return emit(
        s,
        { k: "tracker.comment", issue: w.issue.id, text: w.question ?? "parked" },
        { k: "tracker.unclaim", issue: w.issue.id },
        { k: "tracker.state", issue: w.issue.id, state: "parked" },
      );
    }

    case "host.report":
      return end(s, "queue empty");

    case "host.offerPlanning":
      return end(s, "planning offered");

    default:
      return { state: s, effects: [] };
  }
}

// ──────────────────────────────────────────────────────── sub-transitions

function retire(s: RunState, id: EffectId): RunState {
  const inflight = { ...s.inflight };
  delete inflight[id];
  return { ...s, inflight };
}

/** S19/S20: Git and the tracker are truth; the journal only speeds this up. */
function reconcile(s: RunState, snap: Snapshot): Out {
  const t = snap.tracker;
  const b = snap.branch;

  if (t && t.state === "started" && b && t.issue === b.issue) {
    if (t.assignee !== s.settings.actor) {
      return emit(say(s, `${t.issue} is held by ${t.assignee ?? "nobody"}; leaving it`), {
        k: "lease.acquire",
        actor: s.settings.actor,
      });
    }
    const issue: IssueFacts = {
      id: t.issue,
      title: `resumed ${t.issue}`,
      priority: "P1",
      createdAt: 0,
      milestone: null,
      agentReady: true,
      blockedBy: [],
      assignee: s.settings.actor,
    };
    const work: Work = {
      issue,
      branch: b.name,
      step: "implementing",
      tdd: pickTdd(s.caps!)!,
      question: null,
      deadlineAt: null,
      gates: [],
      resumed: true,
    };
    const s2 = say(
      { ...s, phase: { k: "working" }, work },
      `resuming ${t.issue}${snap.journalLast ? "" : " (no journal — from git + tracker)"}`,
    );
    return emit(
      s2,
      { k: "lease.acquire", actor: s.settings.actor },
      { k: "agent.implement", issue: issue.id, branch: b.name, tdd: work.tdd },
    );
  }

  // The mirror half-transition: claimed on the tracker, but no branch yet.
  // The branch name is derived from the title, so recovery must re-read the
  // issue before it can name the branch it is resuming.
  if (t && t.state === "started" && !b && t.assignee === s.settings.actor) {
    return emit(say(s, `${t.issue} claimed with no branch; re-reading to resume`), {
      k: "tracker.read",
      issue: t.issue,
    });
  }

  // A completed Park is normal state, not a half-transition: leave it parked.
  if (b && (!t || t.state === "parked") && b.pushed) {
    return emit(say(s, `parked branch ${b.name} is at rest`), {
      k: "lease.acquire",
      actor: s.settings.actor,
    });
  }

  // A half-applied Park: branch exists, unpushed, and the tracker never
  // recorded it — crash between worktree and push. Repair by completing it.
  if (b && !t && !b.pushed) {
    return emit(
      say(s, `orphan branch ${b.name}; completing the park`),
      { k: "tracker.unclaim", issue: b.issue },
      { k: "tracker.state", issue: b.issue, state: "parked" },
    );
  }

  return emit(say(s, "nothing to reconcile"), { k: "lease.acquire", actor: s.settings.actor });
}

/** Walk the sorted pool: re-read, then claim. Blocked candidates are skipped. */
function advance(s: RunState, pool: IssueFacts[], cursor: number): Out {
  let c = cursor;
  while (c < pool.length && pool[c].blockedBy.length > 0) c++;
  if (c >= pool.length) return emptyQueue(s);
  const s2: RunState = { ...s, phase: { k: "selecting", pool, cursor: c } };
  return emit(s2, { k: "tracker.read", issue: pool[c].id });
}

/** S10/S11: report what is true; never claim a milestone is complete. */
function emptyQueue(s: RunState): Out {
  const where = s.scope.milestone ? `milestone ${s.scope.milestone}` : "the queue";
  const text = `no unblocked agent-ready work in ${where}`;
  if (s.mode === "headless") return emit(say(s, text), { k: "host.report", text });
  return emit(say(s, text), { k: "host.report", text }, { k: "host.offerPlanning" });
}

function park(s: RunState, w: Work, why: string): Out {
  const next: Work = { ...w, step: "parking" };
  return emit(say({ ...s, work: next }, `parking ${w.issue.id}: ${why}`), {
    k: "git.push",
    branch: w.branch,
  });
}

/** S17: policy decides; absent or protected fails safe to a human. */
function land(s: RunState, w: Work): Out {
  const policy = s.settings.mergePolicy;
  if (policy === "human") {
    return emit(say({ ...s, work: { ...w, step: "approval" } }, "policy: human approval"), {
      k: "host.approval",
      issue: w.issue.id,
      branch: w.branch,
    });
  }
  return emit(say({ ...s, work: { ...w, step: "merging" } }, `merging (${policy})`), {
    k: "git.merge",
    branch: w.branch,
    method: policy,
  });
}

function nextIssue(s: RunState): Out {
  const s2: RunState = { ...s, work: null, phase: { k: "selecting", pool: [], cursor: 0 } };
  return emit(s2, { k: "tracker.candidates", scope: s.scope });
}
