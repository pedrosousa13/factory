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

### What the run shows

- **Parity held, 3/3.** Claude Code, Codex, and Pi each answered all three
  asks with schema-valid JSON on the first try, picked the same ticket
  (T-1), and their claim and unclaim were confirmed against the tracker
  file itself. No harness needed a re-ask. No harness said it acted
  without acting.
- **Host-side validation is the portable path.** No harness-native output
  schema was used. The runtime extracted and checked the JSON itself,
  identically for all three. The claim that only Claude Code can enforce a
  schema did not need testing, because the fallback works everywhere.
- **The contract is tracker-neutral.** `contract.ts` is byte-identical to
  the GitHub-facing prototype apart from a two-line header. Only
  `phrasebook.md` changed to move from GitHub issues to markdown files.
- **File verification caught nothing, and that is the point.** The runtime
  read `claimedBy` from disk rather than trusting the answer. A harness
  that reported success without editing would have shown as
  `claimed-but-file-untouched`.

### What process-per-ask costs

- One headless process per ask, no session reuse: roughly 12-13 s per ask
  for Claude Code, 27 s for Codex, 12 s for Pi. Per harness for the
  three-ask slice: 39.8 s, 82.0 s, 35.3 s. About 157 s for the full sweep.
- Every ask re-sends the whole phrasebook and pays a cold start, so token
  cost grows linearly with the number of asks and nothing is amortised. A
  Claude Code smoke call on a trivial prompt already cost about $0.34.
  A decision loop that needs many asks will feel both numbers.

### Seams found

- **The blocked-filter needs a fact the candidates ask does not return.**
  The runtime resolves `blockedBy` ids against the candidate list alone,
  and treats a blocker it cannot see as not blocking. Candidates are ready,
  unstarted and unclaimed tickets, so a blocker that is started or claimed
  is never in that list. The fixture hides this, because T-3's blocker T-1
  is itself a candidate. Real trackers will not be so kind. The runtime
  needs a second ask (`tracker.read` or `tracker.verify`) per unseen
  blocker, or the candidates ask must carry blocker states.
- **`fixture.ts` cannot be imported.** Its trailing CLI dispatch calls
  `process.exit(1)` at module load, so `run.ts` shells out to
  `bun fixture.ts up` and recomputes the tickets path instead of importing
  the constant. Two copies of one path can drift. `harnesses.ts` guards the
  same pattern correctly.
- **The scoreboard mislabels two cases.** An honest "taken by someone else"
  claim answer is recorded as `claimed-but-file-untouched`, which reads as a
  lie rather than as correct behaviour. A failed unclaim reuses the same
  `claimed-but-file-untouched` label. Neither fired in this run.
- **A failed ask reports zero re-asks.** The counter increments only when a
  re-ask succeeds, so an ask that burned its retry and still failed shows
  `re-asks 0`.
- **Tool grants are not identical, only the prompts are.** Claude Code got
  an explicit `--allowed-tools Read,Edit,Write,Glob,Grep,Bash` allowlist,
  Codex got `--sandbox workspace-write` with an implicit tool set, and Pi
  has no permission surface at all. All three had enough access to do the
  work, so this did not affect the result, but "equal conditions" holds for
  the prompt text and not for capability.

### What this run does not show

- **One run, one fixture.** No repeats, no variance data, no model or
  version sweep. Read the table as "all three can do this", not as a
  reliability rate.
- **The failure machinery never fired.** No re-ask, no failed ask, no
  malformed or fenced JSON, no lying agent. The re-ask path, the
  skip-remaining-asks path, the `extractJson` fence stripping, and the
  `claimed-but-file-untouched` detection all exist and are shared by every
  ask, but none was exercised by a real failure.
- **Answer-level parity is unmeasured.** Only the final pick was recorded,
  not the candidate lists. Two harnesses could have returned different
  ticket sets and still produced this identical table.
- **No contention.** The fixture is reset and unclaimed before each
  harness, so the `taken` branch and any concurrent-claim race are
  untested.
- **Three asks out of ten.** `tracker.milestones`, `tracker.milestoneCounts`,
  `tracker.verify`, `tracker.read`, `tracker.setState`, `tracker.comment`
  and `tracker.reachable` were never sent.
- **The native skill interface was not tested.** This slice covers the
  headless-run seam only. It never invoked a skill by name on any harness.
  Ticket #30 documents that surface instead: `/name` is stable in Claude
  Code's `-p` mode, Pi has `/skill:name`, and Codex has no documented
  headless invocation at all (finding F04, whose mitigation is to inline
  the skill text into the prompt). This slice does exactly that inlining,
  so it exercises the only path that can be uniform across all three
  today. Treat native skill invocation as documented but not yet run.
