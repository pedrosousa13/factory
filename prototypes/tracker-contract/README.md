# Tracker contract

## Question

What tracker interface lets Matt skills plan against any configured tracker while giving
autonomous execution deterministic queue, claim, lease, blocking, state, milestone, and
verification guarantees?

## Shape of the answer

Planning skills read the phrasebook alone; execution asks in the `Ask` vocabulary and
trusts nothing unchecked; Factory owns no commands.

## Run

```
bun prototypes/tracker-contract/roundtrip.ts
```

`contract.ts` is import-only — it has no runnable entry point of its own; `roundtrip.ts`
is the only thing that imports it.

## Findings

- [ ]
