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

- Scene 1, clean pick: three candidates arrive, the check removes the blocked ticket,
  and queue order picks the oldest open P1 ticket.
- Scene 2, garbled once: the first claim answer fails the check, Factory asks again, and
  the second answer passes and claims the ticket.
- Scene 3, garbled twice: the same state-change answer fails the check twice, so Factory
  stops and tells a human.
- Scene 4, honest loss: the claim answer passes the check but reports the ticket taken
  by another agent, so Factory moves to the next candidate.

## Findings

- [ ]
