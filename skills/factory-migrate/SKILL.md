---
name: factory-migrate
description: Carry a repo already stamped for the Factory loop — a legacy v1 stamp, or a v2 stamp older than the plugin's current version — to the plugin's current `stampVersion`, per `PROTOCOL.md`'s "## Migration" section. Detects the stamp without changing anything, builds one combined plan for every pending step (the v1-to-v2 step detects the issue tracker from the legacy adapter doc's H1 and offers it for one-tap confirmation, then asks merge policy and attack surface fresh with no defaults), shows one diff — the retrofitted or adopted adapter document plus the four-field `config.json` — for one approval, then writes the adapter document first and `config.json` last, and verifies both against disk with a full preflight run. Use when the user runs /factory-migrate inside a repo whose stamp is legacy v1 or an older v2 version.
---

# /factory-migrate — carry a stamped repo to the current version

This skill performs Migration: it carries a repo already stamped for the
Factory loop — a legacy v1 stamp, or a v2 stamp older than the plugin's
current version — to the plugin's current `stampVersion`.

**Read `${CLAUDE_PLUGIN_ROOT}/PROTOCOL.md`'s "## Migration" section in
full before doing anything else** (`PROTOCOL.md:610-658`). It is the spec
this skill executes; the sentences below point at it rather than restate
it. `${CLAUDE_PLUGIN_ROOT}/runtime/src/stamp.ts`, `sections.ts`, and
`migrate.ts` are that spec's executable form — this skill never runs them
(a skill has Read/Write/Bash, not a way to shell out to the plugin's own
runtime), but they're the precise reference if a step below reads
ambiguous.

**When to use this skill.** Follow the routing rule at `PROTOCOL.md:87-98`.
A repo whose stamp is legacy v1, or a v2 stamp older than the plugin's
current version, belongs here. A repo with no stamp at all is not this
skill's job — `/factory-adopt` derives a stamp for the first time. If
Detect, below, finds an unstamped repo, tell the maintainer to run
`/factory-adopt` instead and stop.

## Detect, change nothing

Before writing anything, read two files and classify the repo:

- `.factory/config.json` — does it exist, does it parse, and what
  `stampVersion` does it carry?
- `docs/agents/issue-tracker.md` — does it exist, and does it carry a
  `## Factory loop operations` heading, matched exactly, on its own line?

Classify per `PROTOCOL.md`'s stamp check (`PROTOCOL.md:87-98`):

1. **`config.json` exists, parses, and its `stampVersion` matches the
   plugin's current version.** Nothing pending. Say so and stop — this
   skill has no work to do here.
2. **`config.json` exists, parses, and its `stampVersion` is older than
   the plugin's current version.** One or more migration steps are
   pending. Continue to "Build the combined plan" below.
3. **No `config.json`, but `docs/agents/issue-tracker.md` exists and
   carries the `## Factory loop operations` heading.** A legacy v1
   stamp — the stamp that predates `config.json` entirely. The v1-to-v2
   step is pending. Continue to "Build the combined plan" below.
4. **Neither.** The repo carries no stamp at all. Tell the maintainer to
   run `/factory-adopt` instead, and stop.

Report the detected state to the maintainer before proceeding — what's on
disk, and therefore what this run intends to change, before anything
changes.

## Build the combined plan

Take every pending step found above, oldest first, and build one plan
that covers all of them — never a separate plan per step. Today only one
step is registered, v1-to-v2; a future step (v2-to-v3 and beyond) folds
into the same combined plan and the same single diff below without
changing this shape.

**The v1-to-v2 step asks only what a v1 repo cannot answer**
(`PROTOCOL.md:640-647`):

- **Tracker.** Read `docs/agents/issue-tracker.md`'s first line only. If
  it matches `# Issue tracker: Linear` or `# Issue tracker: GitHub`,
  case-insensitively, offer that tracker back to the maintainer to
  confirm or override — never ask cold when this detection succeeds.
  Check the H1 only: a document that carries front matter or a preamble
  before its H1, or names the tracker only in its body, does not count
  as a detection. If the H1 matches neither name, ask the maintainer
  which tracker the repo uses.
- **Merge policy.** Ask the maintainer directly. A v1 repo has no record
  of this, so take no default.
- **Attack surface.** Ask the maintainer directly, the same way. Take no
  default.

Ask merge policy and attack surface fresh every run, whether or not the
tracker was detected.

Once the tracker is settled, render that tracker's v2 template
(`${CLAUDE_PLUGIN_ROOT}/templates/stamp/issue-tracker-<tracker>.md`) with
this repo's real values filled in, then diff the current
`docs/agents/issue-tracker.md` against that rendering. Classify the diff
per the adopt skill's section rules (`skills/factory-adopt/SKILL.md:229-257`,
cross-referenced at `PROTOCOL.md:637-638`) — this skill does not restate
those rules, only applies them here to a legacy document instead of a
freshly-adopted one.

## One diff, one approval

Show the maintainer everything this run will write, as one combined diff,
and take one approval for the whole thing — never one diff per file and
never one approval per step:

- the adapter document, as it will read after this run — retrofitted with
  whatever the section-rules classification above found missing, adopted
  whole from the template, or unchanged if it already matches;
- the four-field `config.json` this run will write —
  `stampVersion`, `tracker`, `merge`, `attackSurface` — rendered from the
  tracker, merge policy, and attack-surface answers gathered above.

If the classification found the document already matches its template,
the diff shows `config.json` only — there's nothing to change in the
document.

**On an `other-difference` verdict**, present the maintainer three
choices and act on whichever they pick:

- **adopt-theirs** — write the template's version of the adapter
  document, discarding the repo's own edits to it.
- **keep-mine** — do not write the adapter document. Tell the maintainer
  plainly what this costs: preflight's adapter-marker check stays red on
  `missing-marker` until the drift is resolved by hand, on this run or a
  later one.
- **merge-by-hand** — the maintainer edits the document themselves; this
  run does not write it, and the diff stays unresolved until they do.

## Apply, in the load-bearing order

Write in this order, and no other: the adapter document first,
`config.json` last. `PROTOCOL.md` states why:

> config.json carries the stamp, so writing it last makes it the single
> commit point. A crash before it leaves the repo at its old stamp, and
> the whole step runs again.

Writing `config.json` first would leave a repo stamped at the new version
with a document nothing retrofitted — and the next run, finding a current
`stampVersion`, would report nothing pending. The order above is what
prevents that; don't reorder it for convenience.

## Verify against disk

A reply of done is not evidence — the files are. After writing:

1. Re-read `docs/agents/issue-tracker.md` from disk. Confirm the tracker
   marker (`<!-- factory:tracker kind=... -->`, immediately after the H1)
   is present, unless the maintainer chose keep-mine above.
2. Re-read `.factory/config.json` from disk. Confirm it parses, and that
   it carries exactly four top-level fields — `stampVersion`, `tracker`,
   `merge`, `attackSurface` — no more, no fewer.
3. Run `PROTOCOL.md`'s full Preflight, and show the maintainer the
   result.

## The idempotency contract

Each step is idempotent by design (`PROTOCOL.md:627-635`): a repeat run
recomputes its diff from what's actually on disk, so re-running this
skill against an already-migrated repo finds nothing pending and says
so — the same "`config.json` exists, parses, current `stampVersion`" case
Detect handles above.

The write order above is also what makes an interrupted run safe. A crash
between the two writes leaves `config.json` still at the old
`stampVersion`, so the next run's Detect step still sees the step
pending and runs it again — including the adapter-document write, even
if that part already landed last time. Retrofitting a document that is
already retrofitted is itself idempotent, so repeating it is harmless:
the second pass finds nothing left to add and writes back the same
document.
