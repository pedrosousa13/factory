# Integration wiring — design

Date: 2026-08-01. Source: [#50](https://github.com/pedrosousa13/factory/issues/50), all four workstreams, plus the real migration of this repo ([#52](https://github.com/pedrosousa13/factory/issues/52)). Approved by the maintainer in session.

## The stance that governs everything

The run loop is PROTOCOL prose, executed by the skill with the agent's own tools. The runtime's pure modules are the executable spec. The conformance hosts prove that a live agent follows the spec on each harness.

This is the architecture that six merged slices shipped and proved. It is not the architecture PRD #39 §2 describes: the `initial()`/`step()` reducer was never built, and `runtime/test/config.test.ts:623` still says "the reducer arrives in a later slice." That slice never came. The maintainer chose to keep the shipped architecture rather than build the reducer after the fact. Practice superseded §2, and this document is the record of that decision.

Consequences:

- No new binaries. `runtime/bin/` stays throwaway conformance material.
- No skill shells out to the runtime. Skills instruct the agent; the agent uses its own tools.
- Factory continues to own no tools, no CLI names, and no commands (PRD §1).

## Workstream A — the journal at every step

PROTOCOL's loop (`PROTOCOL.md:171-304`) has five step boundaries: Queue selection, State mirroring, Implementation, Landing gate, Issue boundary. Each boundary gains one instruction: overwrite `.factory/journal.json` with `{ticket, branch, step, openQuestion, workers}`, the shape `runtime/src/journal.ts` defines.

The claim keeps `startClaim` semantics: a new claim writes `openQuestion: null`, always. This is the invariant `runtime/src/recovery.ts:57-64` documents and cannot enforce — a stale question that survives a new claim would make a finished Park read as one in flight.

Proof:

- L1: a test that a journal from a finished Park cannot read as a Park in flight, which is #50's acceptance line for this item.
- L2: a harness executes one loop step against a fixture repo, and the runtime verifies the journal file on disk afterward — never the agent's claim about it.

## Workstream B — the merge decision wired

PROTOCOL's Landing gate gains the merge rule. The rule is the three cases that `config.ts`'s `effective()` and `agentwork.ts`'s `mergeDecision` already agree on, pinned by `runtime/test/config.test.ts:623-701`:

1. An explicit `merge.method` wins.
2. An absent method under an auto policy takes the policy as the method.
3. An absent method under the `human` policy defaults to `squash`, and approval gates the merge.

`runtime/bin/implement.ts:265` currently calls `mergeDecision("squash", undefined, null)` with hardcoded values. It changes to read the fixture's real config through `effective()`.

Proof (L2, #50's acceptance line verbatim): a fixture configured `{"merge": {"policy": "human", "method": "rebase"}}` demonstrably rebases rather than squashes.

## Workstream C — the native ping channels

Factory cannot ship the push mechanism. The push mechanism is maintainer-specific — on this machine the `Notification` hook already runs the maintainer's own Herdr tooling. Factory ships the wiring instead:

- **Claude Code**: the plugin ships a `Notification` hook that reads `notifierCommand` from the Project's `.factory/config.json` and invokes it. Hook arrays append, so it coexists with whatever the maintainer already has.
- **Codex**: `notify` fires at the end of a turn, a known limit per PRD §5 item 4. The maintainer's `~/.codex/config.toml` carries no `notify` key today. The adopt and migrate skills offer to add the equivalent wiring, and the offer is declinable.
- **Pi**: ships no channel. `pi-no-ping` stays documented behavior, exactly as slice 4 decided.

The subprocess fallback (`runtime/src/ping.ts`) stays beneath all three, untouched.

Honest limit, stated here so the plan does not hide it: firing a real Notification hook headless is not sweepable. The proof for this workstream is config-presence checks plus one manual smoke test, and the plan says so plainly.

## Workstream D — /factory-migrate, and this repo migrates for real

A new skill, `skills/factory-migrate/SKILL.md`:

- Detects the stamp (the same facts `detectStamp` decides on).
- Builds the combined diff for all pending steps, shows it once, takes one approval.
- Writes the adapter document first and `config.json` last. The order is the commit point, per `PROTOCOL.md` §Migration: a crash before the config write leaves the repo at its old stamp and the step re-runs.
- On an `other-difference`, presents the three offers — adopt-theirs, keep-mine, merge-by-hand — and never overwrites silently.

`runtime/src/preflight.ts`'s legacy-v1 fix text switches from `/factory-adopt` to `/factory-migrate`. The unstamped fix text keeps `/factory-adopt`. The four `(pending)` sentences in `PROTOCOL.md` §Migration become current.

Then this repo migrates for real, by running the new skill on it:

- Detection reads the H1 and offers `linear`. The maintainer corrects it to `github`, which exercises the confirmation-override path and closes #52 in the same stroke.
- The maintainer answers merge policy and attack surface live.
- `.factory/config.json` and the corrected adapter document are committed.

**Ordering constraint the plan must carry.** `runtime/conformance/v1repo.ts` copies this repo and throws unless the copy detects as `legacy-v1`. After the real migration, this repo is v2 and that fixture breaks. So, strictly before the migration commit: the fixture switches to a preserved snapshot of the current v1 adapter document, checked into `runtime/conformance/` as fixture data, applied to a copy of the repo with `.factory/` dropped. Sweep expectations stay `linear`, because the snapshot stays stale on purpose.

## Carried small items

- `runtime/src/tracker.ts`'s `check()` gains tests for the nine ask kinds that have none: `reachable`, `candidates`, `read`, `claim`, `setState`, `unclaim`, `comment`, `milestones`, `verify`.
- `CHECK_SHAPE` in `runtime/bin/implement.ts` gets the byte-identity pin that `IMPLEMENT_SHAPE` already has (`runtime/test/coderepo.test.ts:74`), comparing against `agentwork.ts`'s `CheckResult` declaration.

## Proof, overall

- L1 throughout. `bun test runtime/` green before every commit; the filtered typecheck stays at its ten pre-existing hits.
- L2: the sweep gains a journal-step check and a merge-rebase check, reusing existing fixtures with minimal new live asks — the plan states the exact count. The migrate columns keep their current expectations, because the fixture snapshot stays stale.
- One sweep at the end. It re-runs only if a fix wave touches `sweep.ts`, and the ledger records both runs if so.

## Out of scope

- The PRD §2 reducer. Superseded, recorded above.
- Any second migration step (v2 to v3). The chain has one step until a version bump needs another.
- pi native notifications. No channel exists to configure.
