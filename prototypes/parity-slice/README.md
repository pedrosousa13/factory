# Parity slice

## Question

Can one narrow Factory capability run through the proposed runtime and native
skill interface on Claude Code, Codex, and Pi with equivalent guarantees and
native interaction? Use the prototype to expose incorrect seams before the
full design is fixed.

## The slice

One capability, end to end: list ready/unstarted/unclaimed tickets, pick the
queue-order winner, claim it, then release the claim — asked identically of
Claude Code, Codex, and Pi against a local markdown tracker fixture.

Every harness gets the exact same three prompts (one shared template: the
plain question + the full `phrasebook.md` text + the exact answer-shape text
+ "Reply with ONLY that JSON, no prose") — no per-harness tweaks. Every
answer is validated against `contract.ts`'s `check()`, with one re-ask on a
bad answer before the ask is recorded as failed. Claim and unclaim are also
verified against the tracker file itself (`claimedBy` in
`tracker/tickets/<id>.md`), not just against what the agent said.

## Files

- `contract.ts` — the Ask/Answer vocabulary, `check()`, `queueOrder`.
- `phrasebook.md` — how the local markdown tracker expresses each neutral
  concept.
- `fixture.ts` — up/down/show for the `tracker/tickets/` fixture (three
  tickets: T-1 older P1, T-2 newer P1, T-3 higher-urgency but blocked by
  T-1).
- `harnesses.ts` — `runHarness(name, prompt, cwd)` adapters for
  claude/codex/pi.
- `run.ts` — the host loop: runs the three-ask slice through all three
  harnesses and prints a comparison table.

## Run it

```
bun fixture.ts up      # write the fixture
bun run.ts              # runs the slice through claude, codex, pi in turn
bun fixture.ts down     # remove the fixture
```

`run.ts` resets the fixture itself before each harness, so a fresh `up` is
only needed once before the first run.

## Comparison table (from a real run)

```
=== claude ===
  candidates: valid-first-try, picked T-1 (T-1? yes)
  claim: valid-first-try, verify: verified
  unclaim: valid-first-try, verify: verified

=== codex ===
  candidates: valid-first-try, picked T-1 (T-1? yes)
  claim: valid-first-try, verify: verified
  unclaim: valid-first-try, verify: verified

=== pi ===
  candidates: valid-first-try, picked T-1 (T-1? yes)
  claim: valid-first-try, verify: verified
  unclaim: valid-first-try, verify: verified

=== comparison ===
harness  candidates       pick T-1?  claim+verify              unclaim+verify            re-asks  total s
-------  ---------------  ---------  ------------------------  ------------------------  -------  -------
claude   valid-first-try  yes        valid-first-try/verified  valid-first-try/verified  0        39.8
codex    valid-first-try  yes        valid-first-try/verified  valid-first-try/verified  0        82.0
pi       valid-first-try  yes        valid-first-try/verified  valid-first-try/verified  0        35.3
```

## Findings

_(filled in at review time)_
