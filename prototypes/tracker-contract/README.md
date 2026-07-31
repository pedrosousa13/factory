# Tracker contract

## Question

What tracker interface lets Matt skills plan against any configured tracker while giving
autonomous execution deterministic queue, claim, lease, blocking, state, milestone, and
verification guarantees?

## What this is

This is a throwaway prototype. It answers the question above.

## The idea

Factory manages unattended work and decides only what to execute next, and it owns no
tools and no commands. It asks the tracker questions in a neutral vocabulary, defined in
contract.ts. A per-Project phrasebook translates these concepts into the tracker's own
terms, in phrasebook.md. Factory checks the shape of every answer before it decides,
using the check function. Planning skills read only the phrasebook. Only autonomous
execution needs the checked vocabulary.

A lease is not a tracker concept: the runtime holds it itself, through its own
`lease.*` effects (see the sibling runtime prototype's machine.ts). This contract covers
only ticket-level claims — claim, unclaim, state — not run-level exclusivity.

## The files

- `contract.ts` — the neutral Ask/Answer vocabulary and the `check` function that
  verifies the shape of every answer.
- `phrasebook.md` — how the GitHub tracker expresses each neutral concept, plus its
  sharp edges.
- `roundtrip.ts` — four scripted scenes that run the contract end to end against a fake
  agent.

## Run

```
bun prototypes/tracker-contract/roundtrip.ts
```

`contract.ts` has no runnable entry point of its own. Only `roundtrip.ts` imports it.

Watch for four scenes:

- Scene 1, clean pick: three candidates arrive, the check passes, Factory filters out
  the blocked ticket, and queue order picks the oldest open P1 ticket.
- Scene 2, garbled once: the first claim answer fails the check, Factory asks again, and
  the second answer passes and claims the ticket.
- Scene 3, garbled twice: the same state-change answer fails the check twice, so Factory
  stops and tells a human.
- Scene 4, honest loss: the claim answer passes the check but reports the ticket taken
  by another agent, so Factory moves to the next candidate.

## Findings

- The Ask vocabulary covers all six `tracker.*` effects the sibling runtime prototype
  emits (candidates, read, claim, comment, state, unclaim), plus `reachable`,
  `milestones`, `milestoneCounts`, and `verify`. Naming divergences to reconcile when the
  two merge: `tracker.setState` vs `tracker.state`; `Urgency` has `"none"` where the
  sibling's `Priority` does not; `TicketFacts.ready`/`claimedBy` vs
  `IssueFacts.agentReady`/`assignee`; `createdAt` as a string here vs a number there.
- `check`'s plain, non-generic signature returns the full answer union, forcing
  caller-side casts (see Scene 1) — an API-shape question for the real runtime.
- The garble/bad-news split held in every scene: the checker rejects malformed answers,
  never shape-valid bad news.
- A lease is not a tracker concept; it stays with the runtime's `lease.*` effects.
- `tracker.verify` exists for the "listings lag writes" warning in the phrasebook, but no
  scene exercises it yet.
