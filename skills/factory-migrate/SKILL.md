---
name: factory-migrate
description: Carry a repo already stamped for the Factory loop — a legacy v1 stamp, or a v2 stamp older than the plugin's current version — to the plugin's current `stampVersion`, per `PROTOCOL.md`'s "## Migration" section. Detects the stamp without changing anything, builds one combined plan for every pending step (the v1-to-v2 step detects the issue tracker from the legacy adapter doc's H1 and offers it for one-tap confirmation, then asks merge policy and attack surface fresh with a researched recommendation but no silent default; the v2-to-v3 step renames CONTEXT.md to GLOSSARY.md and asks nothing), shows one diff — every drifted template-mapped file, the adapter document among them, plus the `config.json` it will write (the four stamp fields, carrying an existing `notifierCommand` forward) — for one approval, then writes the documents first and `config.json` last, and verifies them against disk with a full preflight run. Use when the user runs /factory-migrate inside a repo whose stamp is legacy v1 or an older v2 version.
---

# /factory-migrate — carry a stamped repo to the current version

This skill performs Migration: it carries a repo already stamped for the
Factory loop — a legacy v1 stamp, or a v2 stamp older than the plugin's
current version — to the plugin's current `stampVersion`.

**Read `${CLAUDE_PLUGIN_ROOT}/PROTOCOL.md`'s "## Migration" section in
full before doing anything else.** It is the spec
this skill executes; the sentences below point at it rather than restate
it. `${CLAUDE_PLUGIN_ROOT}/runtime/src/stamp.ts`, `sections.ts`, and
`migrate.ts` are that spec's executable form — this skill never runs them
(a skill has Read/Write/Bash, not a way to shell out to the plugin's own
runtime), but they're the precise reference if a step below reads
ambiguous.

**Every question in this skill** follows `PROTOCOL.md`'s "## Asking the
maintainer": a structured question, with the researched recommendation first.

**When to use this skill.** Follow the routing rule in `PROTOCOL.md`'s
"## Prerequisites: a stamped Project repo".
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

Classify per the stamp check in `PROTOCOL.md`'s "## Prerequisites: a
stamped Project repo", and the newer-stamp block in its "## Migration":

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
5. **`config.json` exists, parses, and its `stampVersion` is newer than
   the plugin's current version.** The plugin never downgrades files
   (`PROTOCOL.md`'s "## Migration"). Tell the maintainer to update the Factory
   plugin, write nothing, and stop — this is not a migration this skill
   can run.

Report the detected state to the maintainer before proceeding — what's on
disk, and therefore what this run intends to change, before anything
changes.

## Build the combined plan

Take every pending step found above, oldest first, and build one plan
that covers all of them — never a separate plan per step. Two steps are
registered: v1-to-v2 (version 2.0.0) and v2-to-v3 (version 3.0.0). A step
is pending when its version is newer than the repo's and no newer than the
plugin's. A legacy v1 repo counts as 1.0.0, so it takes both steps. A
2.0.0 repo takes v2-to-v3 only. Both steps fold into the same single diff
below.

**The v1-to-v2 step asks only what the old stamp cannot answer**
(`PROTOCOL.md`'s "## Migration"). It runs only on a legacy v1 repo, which
has no `config.json` at all. It asks all three answers fresh. If a stray
`config.json` exists anyway, the step never reads it for them. Writing the
plan's `config.json` later replaces
the file wholesale rather than merging into it, so a stale v2 repo's
existing `merge.method`, or any other field this step does not write, does
not survive. `notifierCommand` is the single exception, and the paragraph
after the bullets says why. Don't read an old config for answers; ask
fresh, every time:

- **Tracker.** Read `docs/agents/issue-tracker.md`'s first line only. If
  it matches `# Issue tracker: Linear` or `# Issue tracker: GitHub`,
  case-insensitively, offer that tracker back to the maintainer to
  confirm or override — never ask cold when this detection succeeds.
  Check the H1 only: a document that carries front matter or a preamble
  before its H1, or names the tracker only in its body, does not count
  as a detection. If the H1 matches neither name, ask the maintainer
  which tracker the repo uses.
- **Merge policy.** Ask the maintainer. Take no silent default, but
  recommend one from the evidence. If the repo has tests and CI that would
  back an automatic merge, recommend `squash`. If it has neither, recommend
  `human`.
- **Attack surface.** Ask the maintainer, the same way. Recommend the
  outcome of `PROTOCOL.md`'s attack-surface test ("## Security sweeps"),
  applied to the code as it stands, and name what you found: an HTTP
  server, auth, user data, a third-party call.

Ask merge policy and attack surface fresh every run, whether or not the
tracker was detected, and regardless of what an existing `config.json`
already says.

**One field survives the rewrite: `notifierCommand`.** If the existing
`config.json` carries it, read it and write it back into the new one
unchanged. This is not a breach of the fresh-answers rule above. That rule
exists so a stale answer cannot stand in for a decision this step must put
to the maintainer, and `notifierCommand` is not one of those decisions — it
is a machine-local address the maintainer already gave `/factory-adopt`, and
this step never asks for it. Dropping it would silently unwire the ping
channel and leave the verify step below rejecting a config that was correct.

Once the tracker is settled, render that tracker's v2 adapter-doc
template — `${CLAUDE_PLUGIN_ROOT}/templates/stamp/docs/agents/issue-tracker-<tracker>.md`,
per `templates/README.md`'s file mapping — with this repo's real values
filled in. Fill every placeholder the template uses; `templates/README.md`'s
placeholder table (`templates/README.md:41-62`) names the set per
template, and each value is derived, never invented, the way
`/factory-adopt`'s "Choose the tracker" phase derives it
(`skills/factory-adopt/SKILL.md:83-161`) — for example `{{REPO}}` from the
git remote's owner/repo slug. Then diff the current
`docs/agents/issue-tracker.md` against that rendering. Classify the diff
per the adopt skill's section rules (`skills/factory-adopt/SKILL.md:229-257`,
cross-referenced in `PROTOCOL.md`'s "## Migration") — this skill does not restate
those rules, only applies them here to a legacy or stale-v2 document
instead of a freshly-adopted one.

**The v2-to-v3 step renames the glossary, and asks nothing**
(`PROTOCOL.md`'s "## Migration"). For each pair, `CONTEXT.md` →
`GLOSSARY.md` and `CONTEXT-MAP.md` → `GLOSSARY-MAP.md`, check which names
exist at the repo root:

- only the old name → the plan renames it with `git mv`;
- only the new name, or neither → nothing to do for that pair;
- both → a conflict. The plan renames neither and overwrites neither. Show
  both files in the diff, and tell the maintainer to merge them by hand and
  delete the old one.

In a multi-context repo, `GLOSSARY-MAP.md` points at one glossary per
context. Rename each per-context `CONTEXT.md` that the map lists, by the
same rules.

On a 2.0.0 repo, this step's `config.json` is the existing one, with
`stampVersion` bumped to the current version. Every other field stays as it
is, `merge.method` and `notifierCommand` included. Nothing is asked fresh:
the v2 config already answers everything. When v1-to-v2 runs in the same
plan, its freshly written config simply carries the current version.

**The adapter document is not the only stamp file.** `templates/README.md`'s
file mapping also maps `AGENTS.md`, `docs/agents/triage-labels.md`, and
`.gitignore` into the repo, and an old stamp drifts on those exactly as it
drifts on the adapter document. A run that retrofits the adapter document
alone leaves the rest of the repo describing the stamp it used to have — the
old tracker named in `AGENTS.md`, the old label scope in `triage-labels.md`.

So for every other row of that mapping, do what the paragraph above does for
the adapter document: render the template with this repo's real values — the
tracker-specific `AGENTS-<tracker>.md` for `AGENTS.md`, the generic templates
for the rest — and classify the diff by the same section rules. `.gitignore`
is the one file those rules do not govern, and the adopt skill already says
why: append the lines it lacks, leave the rest alone, and never diff it whole.
Every file this produces joins the one diff below, under the one approval.

## One diff, one approval

Show the maintainer everything this run will write, as one combined diff,
and take one approval for the whole thing — never one diff per file and
never one approval per step:

- the adapter document, as it will read after this run — retrofitted with
  whatever the section-rules classification above found missing, adopted
  whole from the template, or unchanged if it already matches;
- every other template-mapped file the classification above found drifted,
  each in the same three shapes, plus the `.gitignore` lines to append;
- every glossary rename the v2-to-v3 step found, and any conflict it
  reports;
- the `config.json` this run will write. When only v2-to-v3 is pending,
  that is the existing config with only `stampVersion` changed. Otherwise
  it is the four-field config, in the shape
  `/factory-adopt`'s own config-write step states
  (`skills/factory-adopt/SKILL.md:325-349`): `stampVersion` and
  `attackSurface` as plain values, but `tracker` and `merge` as objects —
  `tracker.kind`, `merge.policy` — not flat strings. `merge.policy` is one
  of `squash`, `merge`, `rebase`, `human`; the maintainer's answer above
  must be one of these four. On GitHub, `tracker` also carries `repo`, the
  `owner/name` slug from the git remote — the same value `{{REPO}}` takes
  above, derived the same way and never asked for. It sits inside
  `tracker`, so it is not a fifth top-level field. Show `notifierCommand`
  as a fifth field whenever the old config carried one.

If the classification found the document already matches its template,
the diff still shows `config.json` — a pending step writes `config.json`
regardless of what the document needs, so there's nothing to add here
beyond that.

**On an `other-difference` verdict**, present the maintainer three
choices and act on whichever they pick. Whichever they choose,
`config.json` is still written — a pending step writes it regardless of
`docDiff`'s outcome, so the doc choice below decides only what happens to
the adapter document, never to `config.json`:

- **adopt-theirs** — write the template's version of the adapter
  document, discarding the repo's own edits to it. Both files land in
  sync at the current version.
- **keep-mine** — do not write the adapter document. `config.json` is
  still written, so the repo's `stampVersion` becomes current while the
  document stays unretrofitted. Tell the maintainer plainly what this
  costs: preflight's adapter-marker check stays red on `missing-marker`,
  and because the repo now reads as case 1 in "Detect, change nothing"
  above (current `stampVersion`), a later `/factory-migrate` run reports
  nothing pending and does not re-offer this document. Migration itself
  does not revisit a keep-mine drift. Recovery is `/factory-adopt` (safe
  to re-run; it diffs the document against the same template on its own,
  independently of `stampVersion`) or editing the document by hand.
- **merge-by-hand** — the maintainer resolves the document themselves,
  outside this run; this run does not write it. Same cost, same recovery
  path as keep-mine: `config.json` is written regardless, so the repo
  stamps current before the document is fixed.

## Apply, in the load-bearing order

Write in this order, and no other: the documents and the glossary renames
first, `config.json` last. `PROTOCOL.md` states why:

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
   is present, unless the maintainer chose keep-mine or merge-by-hand
   above. Confirm no template placeholder survived into it: run
   `grep -rn '{{' docs/agents/issue-tracker.md` and confirm it returns
   nothing — a surviving `{{...}}` means a template value was never
   filled in.
2. If v2-to-v3 ran, confirm each rename landed: the new name exists, and
   the old name is gone, unless the plan reported a conflict for that pair.
   When only v2-to-v3 ran, confirm `.factory/config.json` parses, carries
   the current `stampVersion`, and is otherwise byte-identical to the
   config before the run. Then skip the four-field check below. The
   four-field check is the v1-to-v2 step's contract.
   Otherwise, re-read `.factory/config.json` from disk. Confirm it parses, and that
   it carries the four top-level fields — `stampVersion`, `tracker`,
   `merge`, `attackSurface` — and at most one more, `notifierCommand`,
   present only if the old config carried it. Any other fifth field, or a
   missing one of the four, is a failure. Confirm the shape, not
   just the names: `tracker` and `merge` are each objects
   (`tracker.kind`, `merge.policy`), not flat strings, per
   `skills/factory-adopt/SKILL.md:325-349`. Confirm `merge.policy` is one
   of `squash`/`merge`/`rebase`/`human`, and `tracker.kind` matches the
   tracker settled on above. On GitHub, confirm `tracker.repo` is present
   and matches the git remote's slug.
3. Re-read every other template-mapped file this run wrote — `AGENTS.md`,
   `docs/agents/triage-labels.md`, `.gitignore` — and confirm each carries
   what the approved diff said it would, unless the maintainer chose
   keep-mine or merge-by-hand for it. That includes `docs/agents/domain.md`,
   which v2-to-v3's glossary rename changes. Widen the placeholder grep to cover
   them: run `grep -rn '{{' AGENTS.md docs/agents/` and confirm it returns
   nothing.
4. Run `PROTOCOL.md`'s full Preflight, and show the maintainer the
   result.

## The idempotency contract

Each step is idempotent by design (`PROTOCOL.md`'s "## Migration"): a repeat run
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
