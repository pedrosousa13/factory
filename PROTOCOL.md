# PROTOCOL.md — the Factory loop

Source of truth for what a Loop Session does. The `/factory` skill executes this
protocol and must not duplicate it; when the skill and this document disagree,
this document wins.

Vocabulary (Loop Session, Queue, Handoff, Context Budget, Park…) is defined in
`CONTEXT.md`. `docs/adr/0001-interactive-loop-session.md` explains why the loop
is an interactive session, not a daemon.

## Prerequisites: a stamped Project repo

`/factory` runs from the root of a Project repo that carries the Factory stamp:

- **Issue tracker**: a Linear project on the **Side projects** team, documented
  in `docs/agents/issue-tracker.md`. That file names the exact Linear project —
  never guess it.
- **Triage labels**: the five canonical state labels (`needs-triage`,
  `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), mapped in
  `docs/agents/triage-labels.md`, plus the category labels
  (`Feature`/`Improvement`/`Bug`) as team labels.
- **Agent docs**: `AGENTS.md` pointing at `docs/agents/`; domain docs
  (`CONTEXT.md`, `docs/adr/`) created lazily per `docs/agents/domain.md`.
- **Git**: a GitHub remote (SSH), `gh` authenticated, `.scratch/` gitignored.

If `docs/agents/issue-tracker.md` is missing, the repo is not stamped: tell the
maintainer to run `/factory-adopt` (forthcoming, SIDEPRO-110) and stop.

## Session start

1. **Consume the newest Handoff, if any.** If `.scratch/handoffs/` contains
   files, read the newest one and follow it — it carries state from the
   previous Loop Session (an in-flight issue, decisions, facts not in the
   artifacts). After absorbing it, move it to `.scratch/handoffs/archive/`
   (consume-once: the next session must not act on stale state). Writing
   Handoffs is specified under "Handoff" below.
2. **Check the working tree.** Must be clean. A dirty tree means the previous
   session died mid-issue: stop and ask the maintainer rather than guessing.
3. Enter the loop below.

## The loop

Repeat until a stop condition (empty Queue, spent Context Budget, or the
maintainer interrupts):

### 1. Queue selection

The Queue is the set of issues in this Project's Linear project that are:

- labeled `ready-for-agent`, and
- in an unstarted state (Todo/Backlog), and
- **unblocked**: no `blockedBy` relation to an issue that is not Done/Canceled.

Selection order: highest Linear priority first (Urgent > High > Medium > Low >
No priority), ties broken by oldest `createdAt`. Concretely: `list_issues`
filtered by project + label, then walk candidates in that order and confirm
each with `get_issue` (`includeRelations: true`), skipping any with an
unfinished blocker. First unblocked candidate wins.

**Empty Queue** → notify the maintainer (push notification with a one-line
status) and stop cleanly. The loop never invents work.

### 2. State mirroring (pickup)

Atomically with pickup, in Linear:

- assign the issue to the maintainer,
- move it to **In Progress**,
- comment the branch name being used.

Labels stay as they are — the Linear state, not the label, tracks progress.

### 3. Implementation

- **Branch per issue**, created from the freshly pulled default branch. Use
  Linear's suggested branch name (`gitBranchName` on the issue).
- The issue brief is the spec. Read the issue and its comments in full before
  writing anything.
- **The Loop Session orchestrates; subagents implement.** Dispatch code work to
  superpowers TDD subagents (`superpowers:subagent-driven-development`,
  `superpowers:test-driven-development`); the session reviews their output and
  keeps its own context lean.
- **Trivial-issue escape hatch** (a rule, not a judgment call): inline
  implementation without subagents is allowed only for a genuine one-liner —
  a single hunk in a single file whose whole behavior one line expresses
  (a typo, a config value, one doc line). Anything more goes to subagents.
- **Questions**: when blocked on something only the maintainer can decide,
  ping (push notification) and block ~15 minutes for an answer. Unanswered →
  Park: post the question as a comment on the issue, label it `needs-info`,
  leave the work on its branch, continue with the next Queue issue. Full
  ping/park mechanics ship in SIDEPRO-108; until then, ping and keep blocking —
  accepting that an unanswered question stalls the loop, the exact cost Park
  exists to remove (ADR-0001).

### 4. Landing gate

An issue lands only when all of these pass:

1. **Tests** green, if the Project has a test command.
2. **Typecheck** green, if the Project has one.
3. **`/review`** (Standards + Spec) against the issue brief, with no unresolved
   findings.

Then land it:

- Push the branch; open a PR titled after the issue, body summarizing the
  change and linking the issue. No AI attribution anywhere.
- If the repo has required checks, enable auto-merge and wait for green. If it
  has none, the Landing gate above *is* the green signal — merge immediately
  (squash), delete the branch.
- Mirror completion in Linear: comment with the PR link, move the issue to
  **Done**.

No half-done work ever reaches the default branch. If the gate fails and the
fix isn't forthcoming, the work stays on its branch and the issue is Parked.

### 5. Issue boundary

After each issue lands or is Parked:

1. **Context Budget check**: above ~40% of the context window → write a
   Handoff and stop (mechanics under "Handoff" below).
2. Otherwise return to Queue selection.

## Handoff

The compacted document a Loop Session writes when its Context Budget is spent,
so a fresh Loop Session can continue without the old context.

- **Issue boundaries only.** A Handoff is written after an issue lands or is
  Parked, never mid-issue. The boundary guarantees the previous issue landed
  or was Parked cleanly, so a Handoff never carries half-done work.
- **Written via the `/handoff` skill**, with two Factory overrides: the
  document goes to `.scratch/handoffs/<timestamp>.md` in the Project repo,
  not the OS temp dir the skill defaults to, where `<timestamp>` is a
  sortable date-time prefix, optionally followed by a short slug — e.g.
  `2026-07-28-0912-resume-queue.md`. "Newest" in Session start means last in
  lexicographic order, which the sortable prefix guarantees.
- **Contents**: where the Queue stood, decisions made, and facts not
  recoverable from the artifacts (issues, commits, PRs, docs). Reference,
  don't duplicate, what the artifacts already hold — the skill's own rule.
- **Then stop.** Send the maintainer a push notification (one line: Handoff
  written, fresh session needed) and stop cleanly. Resuming is just running
  `/factory` in a fresh session — its Session start consumes the Handoff and
  archives it to `.scratch/handoffs/archive/` (consume-once).

## The stamp

What `/factory-new` (SIDEPRO-109) installs and `/factory-adopt` (SIDEPRO-110)
retrofits — the conventions the loop relies on:

| Piece | Convention |
| --- | --- |
| Repo | `~/apps/<name>`, private GitHub remote over SSH |
| Issue tracker | One Linear project per repo, Side projects team, documented in `docs/agents/issue-tracker.md` |
| Labels | Five canonical triage states + `Feature`/`Improvement`/`Bug` categories, as team labels |
| Agent docs | `AGENTS.md` + `docs/agents/` (issue-tracker, triage-labels, domain) |
| Domain docs | `CONTEXT.md` + `docs/adr/`, created lazily |
| Scratch | `.scratch/` gitignored; Handoffs in `.scratch/handoffs/` |
| Git | Branch per issue → PR → merge on green; no direct commits to the default branch |
