# Prototype — Factory v2 runtime lifecycle state machine

Throwaway. It answers one question, from
[ticket #26](https://github.com/pedrosousa13/factory/issues/26):

> What is the smallest deep runtime interface that can own deterministic
> lifecycle transitions, recovery, and harness-neutral execution without
> absorbing judgment-heavy skill behavior?

Run the scenario runner — one command, no keys, prints every baseline
scenario as a labelled walkthrough:

```
bun prototypes/runtime-state-machine/scenarios.ts
bun prototypes/runtime-state-machine/scenarios.ts S18   # just one scenario
```

Each block shows the scenario's starting facts (`given`), the condensed
setup (`...`), the effects that are the scenario's substance (`→`), any
clock advance or host-side event, and the durable `result`. Scenarios known
not to hold today print a trailing `⚠ diverges` line instead of a clean
walkthrough. Read `scenarios.ts` top to bottom for the scenario table itself
— it is written to be read, not just run.

For poking at edge cases by hand — arming a specific failure, watching one
effect resolve at a time, crashing mid-transition — run the TUI instead:

```
bun prototypes/runtime-state-machine/tui.ts
```

## The interface under test

The whole external surface of the runtime is two functions:

```ts
initial(): RunState
step(state: RunState, event: Event): { state: RunState; effects: Effect[] }
```

`step` is pure. It performs no I/O, reads no clock, and parses no prose. The
host executes each `Effect` and feeds the outcome back as an `ok` or `err`
event. Time enters only as `tick` events.

Four seams sit behind that one interface:

| Seam | Effects | Adapter varies by |
| --- | --- | --- |
| Tracker | `tracker.*` | GitHub, Linear |
| Git | `git.*` | one implementation for now |
| Judgment | `agent.*` | Superpowers TDD, Matt TDD, review skills |
| Host | `host.*`, `lease.*`, `journal.*` | Claude Code, Codex, Pi |

## Where the judgment line falls

The runtime owns *what happens next*. Skills own *what to do*. The line is
the result type: every `agent.*` effect returns a closed set of variants.

```ts
type ImplementResult =
  | { result: "done" }
  | { result: "question"; question: string }
  | { result: "failed"; reason: string }
```

The reducer switches on `result`. The `question` string is carried and
posted, never interpreted. A skill cannot widen the runtime's behaviour by
saying something new — only by returning a variant that already exists.

## What the TUI drives

`machine.ts` is the portable part. `tui.ts` is a throwaway shell with a fake
tracker, git, agent, and host, so failures can be armed by hand.

| Key | Effect |
| --- | --- |
| `enter` | perform the next queued effect successfully |
| `f` | fail the next queued effect |
| `t` | advance the clock 5 minutes |
| `a` | answer the pending question |
| `Q` `X` `G` `D` | arm: question, implement failure, gate failure, merge decline |
| `k` / `K` | crash and restart, keeping / wiping the journal |
| `m` `s` `p` `h` | merge policy, Superpowers, milestone scope, headless |

### Park lifecycle

Park pushes the branch, comments the actual park reason, releases the
tracker claim (`tracker.unclaim`), and marks the issue `parked` — in that
order, so reconcile can tell a crash mid-Park from a Park that finished. The
TUI's `[A]` key stands in for a maintainer re-readying a parked issue: it
flips `agentReady` back on and clears the fake tracker's `parked` marker, so
the next selection pass re-picks the issue and `git.sync` resumes the pushed
branch instead of creating a fresh worktree.

## Baseline scenarios it exercises

`scenarios.ts` drives every scenario listed in `docs/research/factory-v2-baseline.md`
that this reducer models: S06, S07, S09, S10, S11 (both halves), S12, S13,
S14, S15 (both halves), S16, S17 (both halves), S18, S19, S20 — plus a local
`P01` covering the maintainer-approved Park policy (park, re-ready,
re-pickup) that the baseline doc doesn't number. S01–S05, S08, S21–S25 are
out of scope: Preflight, setup, Adoption, pagination, Handoffs, and
cross-harness parity are not modelled here.

S10 and S19 both print a clean walkthrough followed by a `⚠ diverges` line,
for different reasons. S10's empty-queue report states truthfully that no
unblocked work remains, but it carries no progress or open-issue counts,
which is what S10 requires. S19's reason is the journal gap — see Finding 6
below.

## Findings

1. **A crash between the claim and the branch stranded the issue.** The
   tracker held the claim, no branch existed, and selection skipped the issue
   because it was already assigned. Reconciliation must cover both half
   transitions, not just the one that leaves a branch behind.
2. **Recovery needs a tracker read before it can name a branch.** Branch
   identity derives from the issue title (C03), so a run that resumes a claim
   without a branch must re-read the issue first. Recovery is not free of the
   tracker.
3. **Effect ids come from a counter in the state, not from the host.** Two
   harnesses replaying the same event log produce the same ids, which is what
   makes S25 parity a data equality test.
4. **Park releases the claim and drops agent-ready** (`tracker.unclaim`); the
   maintainer re-readies the issue, and any worker that re-picks it gets
   routed by `git.sync`'s branch list to resume the pushed branch instead of
   creating a new worktree. Reconcile needs `tracker.state` (started vs.
   parked), not claim presence, to tell a parked-at-rest branch from a
   half-applied transition.
5. **Effect results are undeclared, closed only by convention.** `ok.data` is
   `unknown`; the reducer casts eight result shapes (`Caps`, `Snapshot`,
   `{branches: string[]}`, `{pass: boolean}`, `{granted: boolean}`,
   `ImplementResult`, …) with nothing checking that a harness's adapter
   actually returns them. `tracker.unclaim`'s effect on agent-ready,
   `git.sync`'s `{branches}` contract, and `host.ask` obliging a later
   `answer` event all live only in the fake world (`tui.ts`), not in
   `machine.ts`. A harness-neutral v2 needs declared per-effect result types.
6. **The journal earned its place only for Park intent.** `journalLast` is
   never read by reconcile — git and the tracker sufficed for every arm
   except telling a mid-Park crash apart from an at-rest Park. S19 as
   literally stated (complete or reverse a half-applied transition) is not
   implemented: a run that crashes after the push but before the tracker
   Park write resumes and re-parks, which converges but re-asks the
   maintainer's question rather than completing idempotently.
7. **The merge method is hardcoded to squash after human approval.**
   `land()` honors `Settings.mergePolicy` for an automatic merge, but the
   `host.approval` ok handler always calls `git.merge` with
   `method: "squash"` regardless of policy. `mergePolicy` conflates "may the
   runtime merge" with "how" — v2 should model the two separately.
