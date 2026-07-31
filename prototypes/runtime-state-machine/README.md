# Prototype — Factory v2 runtime lifecycle state machine

Throwaway. It answers one question, from
[ticket #26](https://github.com/pedrosousa13/factory/issues/26):

> What is the smallest deep runtime interface that can own deterministic
> lifecycle transitions, recovery, and harness-neutral execution without
> absorbing judgment-heavy skill behavior?

Run it:

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

Three seams sit behind that one interface:

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

## Baseline scenarios it exercises

From `docs/research/factory-v2-baseline.md`: S06, S07, S09, S10, S11, S12,
S13, S14, S15, S16, S17, S18, S19, S20.

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
4. **A parked issue keeps its assignee, so it never returns to the queue.**
   Whether Park releases the claim is an open Project policy question.
