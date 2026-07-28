---
name: factory-adopt
description: Bring an already-existing project under Factory conventions — Adoption, per ${CLAUDE_PLUGIN_ROOT}/CONTEXT.md's glossary. Stamps the repo idempotently (Linear project, GitHub remote, triage labels, agent docs, .scratch/ gitignore, all created only where missing and never overwritten), then sweeps every open issue through the triage state machine so it carries exactly one category + one state label + one milestone, with agent briefs written for anything ready-for-agent. Use when the user runs /factory-adopt inside an existing repo.
---

# /factory-adopt — bring an existing repo under Factory conventions

This skill performs **Adoption** (see `${CLAUDE_PLUGIN_ROOT}/CONTEXT.md`'s glossary): bringing an
already-existing repo under Factory conventions so `/factory` can run there.
It is the idempotent counterpart to `/factory-new` — same stamp, same
placeholders, same voice — but every step is "create if missing, merge if
present, never clobber," because this repo may already have history,
opinions, and issues of its own.

**Read `${CLAUDE_PLUGIN_ROOT}/PROTOCOL.md`'s "The stamp" table and
`${CLAUDE_PLUGIN_ROOT}/templates/README.md` in full before doing anything else**,
same as `/factory-new`. `${CLAUDE_PLUGIN_ROOT}/templates/stamp/` is the single source of stamp
content here too — you fill in its placeholders and write the result, you
never hand-write `AGENTS.md`, `docs/agents/`, or `.gitignore` content
yourself.

**Read `${CLAUDE_PLUGIN_ROOT}/skills/factory-new/SKILL.md`** for the parts that are
genuinely identical: how to derive and confirm the Linear project name, the
label set, the file mapping, the placeholder values, the SSH-remote check.
This file does not repeat that mechanics — it only calls out where Adoption
does it differently (existence checks first) and adds the parts `/factory-new`
has no equivalent for (merging, the re-triage sweep).

**Read `~/.claude/skills/triage/SKILL.md`** (and its `AGENT-BRIEF.md`,
`OUT-OF-SCOPE.md`) before Phase 2. This skill defers to it for triage
semantics — roles, the state machine, verification, grilling, agent-brief
structure, the AI disclaimer — rather than re-deriving any of that here. Where
the triage skill speaks in the canonical `bug`/`enhancement` category
vocabulary, translate through `docs/agents/triage-labels.md` (see below):
the real label names are `Feature`/`Improvement`/`Bug`. Never emit `bug` or
`enhancement` as a literal label name.

## Preflight — establish what exists, change nothing

Run `${CLAUDE_PLUGIN_ROOT}/PROTOCOL.md`'s "## Preflight" section first, in
full — accumulate every failure there rather than stopping at the first, per
its own instruction, and stop before doing anything else if it finds one.
Its tracker-reachable check applies only if `docs/agents/issue-tracker.md`
already exists in this repo: if it doesn't, that's not a failure — this
skill is what derives and writes that file (see "Derive the Linear project
name" below), so its absence going in is expected. If the file already
exists (a second `/factory-adopt` run, or a repo adopted before), the check
does apply, and catches a tracker that's since gone stale (renamed project,
revoked access) before the sweep below relies on it.

Must run inside an existing git repo (`git rev-parse --is-inside-work-tree`).
Stop if not.

Before touching anything, detect and record the current state:

- **Git remote**: does `origin` exist? Is it SSH or HTTPS?
- **`AGENTS.md`**: present or absent?
- **`CLAUDE.md`**: present or absent?
- **`docs/agents/`**: which of `issue-tracker.md`, `triage-labels.md`,
  `domain.md` already exist, and do their contents match what the template
  would produce once placeholders are filled?
- **`.gitignore`**: present or absent, and if present, does it already ignore
  `.scratch/` (an exact `.scratch/` line, or a broader pattern that already
  covers it)?
- **Linear project**: does `docs/agents/issue-tracker.md` already name one
  for this repo? If that file doesn't exist yet, derive the project name and
  check for a match exactly as described in "Derive the Linear project name"
  below.
- **Labels**: call `list_issue_labels` for the Side projects team and note
  which of the eight canonical names already exist.

**Report this detected state to the maintainer before proceeding.** Adoption
touches a repo that already has content and conventions of its own — the
maintainer sees what is present, what is missing, and therefore what this run
intends to change, before anything changes.

### Derive the Linear project name

If `docs/agents/issue-tracker.md` already names a project, use it — don't
re-derive, don't re-confirm, don't create a second one.

Otherwise derive the name exactly as `/factory-new` does: title-case the
repo's directory name, splitting on hyphens (`my-app` → `My App`), show the
maintainer, and ask them to confirm or override. Use their answer as
`{{PROJECT_NAME}}`.

Then call `list_projects` filtered to the Side projects team. This is where
Adoption's check diverges from `/factory-new`'s: `/factory-new` stops on a
match, because a second project with the same name would be a duplicate for
work that doesn't exist yet. Adoption's job is the opposite — if a project
named `{{PROJECT_NAME}}` already exists, that almost certainly *is* this
repo's project, so reuse it (capture its URL) rather than create a new one.
Confirm with the maintainer that the matched project is indeed the right one
before reusing it. Only create a new project (`save_project`, same call as
`/factory-new`) if no match exists.

If the maintainer says the matched project is *not* this repo's, don't reuse
it and don't create a new project under the same name — ask them whether to
use a different existing project instead (and which one) or create a new one
under a different name, then follow their answer. This is a name collision
between two unrelated projects; silently reusing the matched project or
silently creating a confusing duplicate are both wrong.

## Phase 1 — stamp, idempotently

For every piece below: create only if missing, merge only if present, never
overwrite. `{{TEAM_NAME}}` is `Side projects`, `{{TEAM_KEY}}` is `SIDEPRO` —
both fixed, per `${CLAUDE_PLUGIN_ROOT}/PROTOCOL.md`.

### AGENTS.md vs CLAUDE.md — the merge rule

This is the subtlest rule in this skill, so state it plainly and don't invert
it:

> If `AGENTS.md` exists, merge the Agent skills block into it. If `AGENTS.md`
> is absent but `CLAUDE.md` exists, merge the block into `CLAUDE.md` instead.
> If neither exists, create `AGENTS.md` from the template. **Never create the
> file that is missing when the other is present** — a repo that only has
> `CLAUDE.md` gets its block merged into `CLAUDE.md`, not a fresh `AGENTS.md`
> written alongside it.

The "Agent skills block" is the `## Agent skills` section of
`${CLAUDE_PLUGIN_ROOT}/templates/stamp/AGENTS.md` (its three subsections: Issue tracker, Triage
labels, Domain docs), placeholders filled. Merging means:

- If the target file has no `## Agent skills` heading, append the whole
  section to the end of the file. Everything already in the file is
  untouched.
- If it already has an `## Agent skills` heading, add only the subsections
  that are missing under it (`### Issue tracker`, `### Triage labels`,
  `### Domain docs`). For a subsection that's already present, decide which
  of these two cases it is before touching anything:
  - **Same thing, different words** — it describes the same tracker,
    project, and label vocabulary as the template, just phrased
    differently (for example, an `### Issue tracker` subsection that names
    the same Linear project but says "Track work in Linear" instead of the
    template's exact phrasing). Leave it exactly as it is — don't rewrite
    it, even to match the template's wording.
  - **Conflict** — it asserts something different: a different tracker, a
    different project, a different label vocabulary, or a pointer to
    different files (for example, an `### Issue tracker` subsection
    pointing at a different tracker entirely). Surface the conflict to the
    maintainer and let them decide. Never clobber it, and never leave it in
    place without flagging it.

### docs/agents/*

Write, from `${CLAUDE_PLUGIN_ROOT}/templates/stamp/docs/agents/`, only the files that don't already
exist (placeholders filled). If a file already exists:

- and its content matches what the template would produce — nothing to do,
  this is what makes the second run idempotent. "Matches" means byte-identical
  to the template with its placeholders filled; compare the rendered template
  against the file rather than eyeballing them. A file that is merely similar
  does not match, and treating it as a match would silently leave a repo
  half-stamped.
- and its content differs — do not overwrite it. Surface the diff to the
  maintainer and let them decide whether to adopt the template version, keep
  theirs, or merge by hand.

### .gitignore

If `.gitignore` doesn't exist, create it from `${CLAUDE_PLUGIN_ROOT}/templates/stamp/gitignore`
(remember: no leading dot in the templates tree, write it to `.gitignore`).
If it exists and doesn't already ignore `.scratch/`, append a `.scratch/`
line — don't rewrite or reorder the rest of the file. If it already ignores
`.scratch/` (exactly or via a broader pattern), leave it alone.

### Linear project, GitHub remote, labels

- **Linear project**: created above, in "Derive the Linear project name," only
  if no match existed.
- **GitHub remote**: if `origin` is already set, leave it — Adoption's job is
  filling gaps, not rewriting a maintainer's existing remote configuration.
  If it's missing, create one the same way `/factory-new` does:
  `gh repo create <name> --private --source=. --remote=origin --push`, then
  confirm the resulting remote is SSH and correct it if not (same check
  `/factory-new` runs). If `origin` already exists but isn't SSH, that's a
  finding to report during Preflight, not something this skill silently
  fixes.
- **Labels**: call `list_issue_labels` for the Side projects team (already
  done in Preflight) and call `create_issue_label` only for the eight
  canonical names — five triage states, three categories — that are missing.
  Never create a label you haven't first confirmed is missing.

### The idempotency contract

A second run of Phase 1 must find: `origin` present, the Agent skills block
already fully merged into whichever of `AGENTS.md`/`CLAUDE.md` carries it,
every `docs/agents/*` file already matching the template, `.gitignore`
already ignoring `.scratch/`, the Linear project already existing, and all
eight labels already present. When that's what Preflight finds, Phase 1 makes
zero changes. Don't just assume this follows from "create only if missing" —
actively check it at the end of Phase 1 and report to the maintainer either
"stamp already complete, nothing changed" or a list of what was created or
merged this run. That report is how the maintainer sees acceptance criterion
1 hold.

Before that report, also run `/factory-new`'s build step 7 check: from the
repo root, `grep -rn '{{' . --exclude-dir=.git`, scanning the whole tree. It
must return nothing. This matters more here than in `/factory-new`, because
it covers the merged block in `AGENTS.md`/`CLAUDE.md` — not just the
`docs/agents/` files — and the merge path hand-assembles subsections into an
existing file rather than copying a rendered template whole, so it's the
likeliest place for a placeholder to survive. If the grep finds anything,
stop and fix it before reporting Phase 1 complete.

## Phase 2 — re-triage sweep

Walk every **open** issue (any state that isn't Done or Canceled) in the
project's Linear project through the triage state machine defined by
`~/.claude/skills/triage`. That skill's per-issue procedure — gather context,
recommend, verify the claim, grill if needed, apply the outcome — applies
unchanged; this section only adds the sweep-specific rules.

- **Exactly one of each label.** Every open issue ends with exactly one
  category label (`Feature`/`Improvement`/`Bug`, per
  `docs/agents/triage-labels.md`) and exactly one state label
  (`needs-triage`/`needs-info`/`ready-for-agent`/`ready-for-human`/
  `wontfix`). "Exactly one" is the invariant, not "at least one" — if an
  issue carries two state labels or two category labels, removing the wrong
  one is part of the job, not an optional cleanup.

  The invariant is **per axis, and only over these two label axes**. A
  project's own labels — area, component, anything outside the eight
  canonical names — are a separate axis this sweep does not touch. Leave
  them exactly as they are. An issue ending up with one category, one state,
  and three of the project's own labels satisfies the invariant; stripping
  those three does not "clean up" anything, it destroys information the
  maintainer curated.
- **One milestone, a third axis.** Alongside the two label axes, every open
  issue also gets exactly one milestone (`${CLAUDE_PLUGIN_ROOT}/PROTOCOL.md`, "## Milestones") — a
  Linear field, not a label, set via `save_issue`'s `milestone` parameter
  against a milestone from `list_milestones`. Per-axis like the two above:
  assigning it must not touch the category label, the state label, or the
  project's own domain labels.

  **No milestones defined.** If `list_milestones` returns none, this axis
  can't be applied yet. Surface that to the maintainer as a sweep finding —
  the project needs milestones defined before this axis can hold — rather
  than skipping it silently or naming milestones yourself; that's a
  maintainer decision. Continue the sweep on the category and state axes
  regardless.

  **Declining a milestone.** The maintainer may decline one for a specific
  issue, the same way they can adjust any other proposal in its batch.
  Record the decline exactly as `${CLAUDE_PLUGIN_ROOT}/PROTOCOL.md`'s "## Milestones" section
  specifies: a Linear comment opening with the AI disclaimer below, then
  the canonical marker line, `**Milestone: declined by the maintainer.**`,
  with human-readable context beneath it. Detection is the marker line
  only — an ambiguous or absent record is treated as not declined, per
  that same section. Before proposing a milestone to an unassigned issue,
  check its comments for the marker: an issue that already carries one is
  left alone, not re-proposed every sweep.
- **Agent briefs for `ready-for-agent`.** An issue moving to `ready-for-agent`
  gets a durable agent brief written into its body (not just a comment),
  structured per `~/.claude/skills/triage/AGENT-BRIEF.md`: category, one-line
  summary, current behavior, desired behavior, key interfaces described
  behaviorally (no file paths, no line numbers — they'll be stale by the time
  a Loop Session picks the issue up), concrete testable acceptance criteria,
  and explicit out-of-scope boundaries. Enough context that a Loop Session
  can implement it without the maintainer present. If you cannot write that
  brief honestly — the request is too vague, or a judgment call only a human
  can make — the issue isn't `ready-for-agent`. Label it `needs-info` or
  `ready-for-human` instead; don't force a thin brief just to hit the label.
- **Batched approval is mandatory.** Work through open issues in batches of
  roughly 5–10. For each batch, show the maintainer every proposed label
  change, milestone assignment, and body/comment edit in the batch, and
  apply only what they approve — in full, or with their adjustments. Never
  apply a batch's changes before showing it. Never offer or accept a blanket
  "approve everything" that skips showing the batch content; the checkpoint
  is what makes acceptance criterion 3 true, not a formality to route
  around. Move to the next batch only once the current one is applied.

  **Approval does not travel to a subagent.** If you dispatch a subagent to
  analyse issues, it cannot apply a batch on the strength of you telling it
  the maintainer approved — from inside that subagent, a relayed approval is
  indistinguishable from an agent inventing one, and a correctly-built
  subagent will refuse. Only the session that received the maintainer's
  answer can act on it. So either apply the batch from that session, or
  dispatch a fresh subagent whose task is applying already-approved content,
  passing the approved text verbatim so nothing drifts between what was shown
  and what is written.
- **The AI disclaimer.** Every AI-written issue body or comment — agent
  briefs, needs-info triage notes, wontfix closing comments, anything this
  sweep writes into the tracker — opens with the line the `/triage` skill
  requires: `> *This was generated by AI during triage.*`
- **Sweep completion.** The sweep ends when every open issue satisfies the
  invariant. Re-list open issues at the end and verify each has exactly one
  category label, exactly one state label, and — if the project has
  milestones defined — exactly one milestone or an explicit decline comment
  in its place. Report the final tally (issue count, how many landed in each
  state, how many carry a milestone vs. a recorded decline) to the
  maintainer. Don't declare the sweep done on assumption — check it the same
  way Phase 1's idempotency is checked, not just hoped for.

## End state

Once both phases are complete and verified, the project is loop-ready — tell
the maintainer their next command is `/factory` there. Don't run it for
them; starting the Loop Session is a separate, maintainer-initiated step.

## Hard rules

- Never clobber existing content. Surface conflicts (in `AGENTS.md`,
  `CLAUDE.md`, `docs/agents/*`, or anywhere else) and let the maintainer
  decide.
- Create only where missing — Linear project, GitHub remote, labels,
  `docs/agents/*` files, the `.scratch/` gitignore line. Check first, every
  time, even on a repo you believe you've already adopted.
- `${CLAUDE_PLUGIN_ROOT}/templates/stamp/` is the only source of stamp content. Never hand-write
  `AGENTS.md`, `docs/agents/` files, or `.gitignore` content inline.
- Every open issue carries exactly one category label and exactly one state
  label when the sweep ends — not zero, not two.
- Every open issue carries exactly one milestone when the sweep ends, or an
  explicit, recorded decline in its place — never a silent unassigned issue
  indistinguishable from one nobody got to. Doesn't apply until the project
  has milestones defined.
- No triage batch is relabeled or rewritten without the maintainer approving
  that batch first.
- Every AI-written tracker body or comment carries the disclaimer
  `> *This was generated by AI during triage.*`
- No AI attribution anywhere — not in commits, not in issue bodies or
  comments beyond the required disclaimer, not in the repo.
