# PROTOCOL.md — the Factory loop

Source of truth for what a Loop Session does. The `/factory` skill executes this
protocol and must not duplicate it; when the skill and this document disagree,
this document wins.

Vocabulary (Loop Session, Queue, Handoff, Context Budget, Park…) is defined in
`${CLAUDE_PLUGIN_ROOT}/CONTEXT.md`. `${CLAUDE_PLUGIN_ROOT}/docs/adr/0001-interactive-loop-session.md` explains why the loop
is an interactive session, not a daemon.

## Preflight: prerequisites, not the stamp

Before `/factory`, `/factory-new`, or `/factory-adopt` do anything else, they
run this Preflight. It checks the Factory installation and the maintainer's
environment — not a specific repo's stamp. A repo's stamp (whether
`docs/agents/issue-tracker.md` exists, below) is a separate, later check;
Preflight is what has to be true before that check is even meaningful.

**Run every check below regardless of whether an earlier one already
failed.** Collect every failure, then report all of them together and stop —
never stop at the first. A maintainer who fixes one prerequisite only to
discover the next one on the following run is the exact failure this exists
to prevent. When every check passes, say nothing: Preflight adds no visible
ceremony to a fully-provisioned repo.

Each failure names what's missing, why the Factory needs it, and the exact
fix — never a bare "preflight failed." Shape:

> `/review` not found. The Landing gate cannot run without it. Install with
> `/setup-matt-pocock-skills`.

- **Issue tracker reachable.** Read `docs/agents/issue-tracker.md` and check
  whatever tracker *that file names* — never hardcode Linear here, so this
  check keeps working if the Factory later supports a tracker other than
  Linear. For a Linear-backed repo: the Linear MCP tools resolve, and the
  team and project the file names both exist (`list_teams`, `list_projects`
  filtered to that team). If the file doesn't exist, this check does not
  apply — an unstamped repo has no declared tracker yet, and its absence is
  the calling skill's problem, not Preflight's: the stamp check below
  catches it for `/factory`; `/factory-new` and `/factory-adopt` are what
  create the file in the first place, so its absence going in is expected.
- **`gh` authenticated.** Run `gh auth status`. Failure: `gh auth login`.
- **Dependent skills present**: `/review`, `/handoff`, `/triage`,
  `/domain-modeling`, each of which must exist at `~/.claude/skills/<name>/`
  — that path, not the skill's source location, is what makes a skill
  invocable in a session. `/setup-matt-pocock-skills` installs the four as
  symlinks there, pointing at `~/.agents/skills/<name>/`; check the
  `~/.claude/skills/` path itself; a missing or broken symlink there leaves
  the skill unavailable even if the `~/.agents/skills/` source exists.
  Failure, per missing skill: name it, name what it's for (`/review` gates
  Landing, `/handoff` bridges a Context Budget stop, `/triage` runs
  Adoption's re-triage sweep, `/domain-modeling` maintains `CONTEXT.md`), fix
  with `/setup-matt-pocock-skills`.
- **superpowers available**: `superpowers:subagent-driven-development` and
  `superpowers:test-driven-development`, both required by Implementation
  (below). The plugin manifest declares `superpowers@superpowers-marketplace`
  as a dependency, so an installation via the marketplace should already
  have it — check anyway, as a cheap assertion rather than trusting the
  manifest silently held. Failure: install the `superpowers` plugin.
- **No stale `factory*` symlinks**: `~/.claude/skills/factory`,
  `factory-new`, `factory-adopt` must not exist. The Factory ships as a
  plugin now; a leftover symlink from before that change means two things
  claim the name `factory`, and the wrong one can win. Failure: name which
  symlink(s) were found, fix by deleting them.

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
maintainer to run `/factory-adopt` and stop.

## Session start

1. **Check the working tree, and for a Pause note.** Clean tree, no Pause
   note (`.scratch/pause-note.md`) → proceed to step 2 normally. Otherwise
   the previous session was interrupted mid-issue:
   - **Pause note present** → read it, verify it, and resume the issue it
     names directly — mechanics in the Pause note section below. Do this
     before step 2: the Pause note decides what to resume right now; the
     Handoff (if also present) decides what follows once that issue reaches
     its own boundary. Step 2 is deferred, not skipped — it runs when the
     resumed issue reaches its own boundary (Issue boundary below), before
     Queue selection picks anything new.
   - **Dirty tree, no Pause note** → the interruption predates this
     mechanism or the note was lost: stop and ask the maintainer rather
     than guessing.
2. **Consume the newest Handoff, if any.** If `.scratch/handoffs/` contains
   files, read the newest one and follow it — it carries state from the
   previous Loop Session (an in-flight issue, decisions, facts not in the
   artifacts). After absorbing it, move it to `.scratch/handoffs/archive/`
   (consume-once: the next session must not act on stale state). Writing
   Handoffs is specified in the Handoff section below.
3. **Ask which milestone to work.** Call `list_milestones` for the Project.
   - **No milestones** → skip the question entirely; run the whole Queue
     unscoped, exactly as before this rule existed. Required: the Factory's
     own Project has none, and `/factory` must keep working here.
   - **Any milestones** → ask the maintainer, before touching the Queue.
     Never default to a scope. Menu, in order:
     1. Every milestone in the Project, by ascending `sortOrder`.
     2. **Everything** — no scope, run the whole Queue.
     3. **(No milestone)** — offered only if the Project has at least one
        issue with no `projectMilestone`.
     List every milestone regardless of whether it currently has
     agent-ready work — a menu whose shape is stable beats one that shifts
     between runs, even though it means a milestone with nothing ready can
     be picked and the loop stops immediately.
   - Record the answer as this session's **Queue scope** (used by Queue
     selection below).
4. Enter the loop below.

## The loop

Repeat until a stop condition (empty Queue, spent Context Budget, or the
maintainer interrupts):

### 1. Queue selection

The Queue is the set of issues in this Project's Linear project that are:

- labeled `ready-for-agent`, and
- in an unstarted state (Todo/Backlog), and
- in scope (see "Queue scope" below), and
- **unblocked**: no `blockedBy` relation to an issue that is not Done/Canceled.

**Queue scope**, chosen once at Session start, narrows which issues count:

- **Everything**, or a Project with no milestones → no filter; every
  candidate is in scope.
- **A specific milestone** → in scope if the issue's `projectMilestone` is
  that milestone, or the issue carries no `projectMilestone` at all —
  fail-open, so unassigned work is never stranded by a scoped run.
- **(No milestone)** → in scope only if the issue carries no
  `projectMilestone`.

`list_issues` has no milestone filter; apply scope by filtering candidates
client-side on `projectMilestone`, a field `list_issues` already returns.

Selection order: highest Linear priority first (Urgent > High > Medium > Low >
No priority), ties broken by oldest `createdAt`. Concretely: `list_issues`
filtered by project + label, narrowed to scope, then walk candidates in that
order and confirm each with `get_issue` (`includeRelations: true`), skipping
any with an unfinished blocker. First unblocked candidate wins.

**Empty Queue** → stop cleanly. What to report depends on scope:

- **Unscoped** (Everything, or no milestones in the Project) → notify the
  maintainer with a push notification (one-line status), as before.
- **Scoped to a milestone** → an empty scoped Queue means agent-ready work is
  exhausted, not that the milestone is complete — those are different
  claims, and conflating them is exactly the failure scoping guards against.
  Re-fetch the milestone (don't reuse the Session-start snapshot — landed
  issues may have moved its `progress` since) and report its real `progress`
  plus a breakdown of its still-open issues: how many carry
  `ready-for-human`, how many carry `needs-info`, and how many
  `ready-for-agent` issues remain blocked by unfinished work.
  The breakdown covers **every still-open issue in the milestone**, not just
  the ones that reached the Queue — so it needs its own query, not a re-count
  of the `ready-for-agent` candidates already fetched. Counting within the
  Queue is the mistake to avoid: it can only ever find `ready-for-agent`
  issues, and would report zero for the two labels that matter most here.
  The blocked count is a fresh count at report time, not a tally accumulated
  as the loop skipped issues — a session-long tally counts the same issue
  once per iteration, so two runs over identical state would disagree.
  Deliver this the same way as the unscoped case: a push notification with a
  one-line status, the detail in the session.
- **Scoped to (No milestone)** → the same breakdown (`ready-for-human`,
  `needs-info`, blocked counts) among no-milestone issues, delivered the same
  way, with no progress figure — there is no milestone entity to report it
  against.

The loop never invents work, scoped or not.

### 2. State mirroring (pickup)

Atomically with pickup, in Linear:

- assign the issue to the maintainer,
- move it to **In Progress**,
- comment the branch name being used.

Labels stay as they are — the Linear state, not the label, tracks progress. The
one exception is Park, which swaps the state label.

Also write the Pause note (mechanics below): which issue, which branch, and
nothing decided yet.

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
- **Questions**: when blocked on a decision only the maintainer can make, ping
  and — if it goes unanswered — Park (mechanics in the Ping and Park section
  below).

### 4. Landing gate

An issue lands only when all of these pass:

1. **Tests** green, if the Project has a test command.
2. **Typecheck** green, if the Project has one.
3. **`/review`** (Standards + Spec) against the issue brief, with no unresolved
   findings.

Then land it:

- Push the branch; open a PR titled after the issue, body summarizing the
  change and linking the issue. No AI attribution in the commits or the PR.
- If the repo has required checks, enable auto-merge and wait for green. If it
  has none, the Landing gate above *is* the green signal — merge immediately
  (squash), delete the branch.
- Mirror completion in Linear: comment with the PR link, move the issue to
  **Done**.
- Delete the Pause note (`.scratch/pause-note.md`) — this is the issue
  boundary that closes it.

No half-done work ever reaches the default branch. If the gate fails and the
fix isn't forthcoming, the work stays on its branch and the issue is Parked.

### 5. Issue boundary

After each issue lands or is Parked:

1. **Context Budget check**: above ~40% of the context window → write a
   Handoff and stop (mechanics in the Handoff section below).
2. **If this issue was resumed from a Pause note at Session start**, and
   Session start step 2 has not run yet this session, run it now: consume
   the newest Handoff, if any (mechanics in the Handoff section below).
   This is the one place that deferred step is picked back up — skipping it
   here would strand a Handoff unread for the rest of the session.
3. Return to Queue selection.

## Ping and Park

How a Loop Session handles a mid-issue question it must not answer itself:

- **When**: only for a decision the maintainer alone can make — a genuine fork
  in the brief, not something resolvable by reading the code, the issue, or the
  docs. Guessing is the failure this prevents; so is pinging for what you could
  have looked up.
- **Ping**: send a push notification with the question in one line, then start
  a ~15 minute deadline timer — a backgrounded `sleep`, whose completion
  notification is the signal to Park. Keep working the turn while it runs; the
  maintainer's answer, if it comes, arrives mid-turn alongside a tool result.
  Do not end the turn to ask: that stalls the loop indefinitely, the exact cost
  Park exists to remove (ADR-0001).
- **Answered before the timer** → stop the timer, continue the issue with
  context intact. No Park, no state change. The answer is a maintainer
  decision: refresh the Pause note with it (mechanics below).
- **Unanswered** → Park, which is these four steps in order:
  1. **Store the work**: commit what exists on the issue branch and push it.
     The working tree must be clean and the default branch untouched — Parked
     work lives only on its branch.
  2. **Post the question** as a Linear comment on the issue, opening with the
     AI disclaimer the `/triage` skill (`~/.claude/skills/triage`) requires on
     agent-written tracker comments:
     `> *This was generated by AI during triage.*` — followed by the question,
     and a note of the branch name and what state the shelved work is in.
  3. **Re-label**: swap `ready-for-agent` for `needs-info` (an issue carries
     exactly one state label), and move the Linear state back to **Todo**. Both
     matter: Queue selection requires `ready-for-agent` *and* an unstarted
     state, so an issue left In Progress would never re-enter the Queue even
     after it is re-labeled. Only now delete the Pause note
     (`.scratch/pause-note.md`) — this is the issue boundary that closes it.
     Deleting any earlier would be a mistake: until the re-label lands, the
     Pause note is the only record that a Park is half-finished, and an
     issue that is In Progress with `ready-for-agent` still on it cannot
     re-enter the Queue on its own.
  4. **Continue**: a Park is an issue boundary like a landing, so return to it
     — Context Budget check first, then the next Queue issue.
- **Re-entry**: the maintainer answers the Linear comment; normal triage moves
  the issue `needs-info` → `needs-triage` → `ready-for-agent`, and it re-enters
  the Queue like any other issue. A later Loop Session picks it up and finds
  its work waiting on the branch.
- **The other trigger**: a Landing gate that fails with no fix forthcoming
  Parks the issue too, by the same four steps — with the gate failure and what
  it would take to clear it posted in place of the question.

## Pause note

How a Loop Session survives an interruption that lands mid-issue — a usage
cutoff, a killed session — where the Context Budget's own issue-boundary
discipline does not apply, because the interruption is external and arrives
whenever it likes, not when the session chooses to check.

- **Distinct from a Handoff, deliberately weaker.** A Handoff is trustworthy
  by construction: written only at issue boundaries, so it never carries
  half-done work. A Pause note is the opposite on purpose — written
  mid-issue, and never trusted without verification. Keeping the two
  separate is what protects the Handoff guarantee; folding a "maybe
  mid-issue" flag into one shared artifact would force every reader to check
  it, and the guarantee decays. The "Handoffs at issue boundaries only" rule
  is not relaxed by this section.
- **Location**: `.scratch/pause-note.md` — a single file, not a directory
  with an archive like `.scratch/handoffs/`. At most one issue is ever in
  flight, and a Pause note is never a history: it is overwritten in place on
  refresh and removed entirely once the issue it describes reaches a
  boundary. Nothing about it is ever read twice, so nothing about it needs
  archiving.
- **Written on pickup** — as part of, or immediately after, State mirroring
  (loop step 2): which issue, which branch, and what has been decided so far
  (nothing, at first pickup).
- **Refreshed** only on:
  - a maintainer decision (e.g., a Ping answered, an approval batch or a
    scope approved), or
  - an irreversible external action (e.g., a PR merged, a branch pushed, a
    remote or repo created, an approval batch actually applied).
  An approval batch is the maintainer-approved set of changes from a
  `/factory-adopt` re-triage sweep — not a Queue scope; the two are unrelated
  and must not be conflated.
  Nothing else triggers a rewrite — not an intermediate code state, which
  `git log`/`git diff` on the branch already shows. The bar stays this
  narrow so two agents working the same interruption refresh at the same
  moments; a vaguer trigger becomes either constant rewriting or a judgment
  call agents get wrong.
- **Deleted** when the issue lands (Landing gate) or is Parked (Ping and
  Park, step 3, after the re-label). Its existence must mean exactly one
  thing — there is half-done work in progress — and nothing else may cause a
  write outside pickup and the two refresh triggers above, or a delete
  outside landing and Park.
- **Consumed at Session start** (step 1), where it turns a dirty tree from
  an unconditional block into an informative one: if present, the session
  reads it and verifies its claims against `git status`/`git log` on the
  named branch and the issue's actual state in Linear.
  - **Verified** → check out that branch and resume Implementation for it
    directly — skipping Queue selection and State mirroring, both already
    done.
  - **Not verified** (the branch is missing, Linear's state doesn't match,
    or a claimed decision can't be confirmed) → the note is not trustworthy
    and must not be acted on. Do not guess or partially resume: fall back
    to the same stop-and-ask path a dirty tree with no Pause note takes,
    reporting which specific claim failed, and let the maintainer decide.
  It is read before the Handoff and answers a different question: the
  Pause note says what to resume right now, if anything; the Handoff says
  what to do once that issue reaches its own boundary.

## Handoff

How a Loop Session bridges to the next one when its Context Budget is spent:

- **Issue boundaries only.** A Handoff is written after an issue lands or is
  Parked, never mid-issue. The boundary guarantees the previous issue landed
  or was Parked cleanly, so a Handoff never carries half-done work.
- **Follow the `/handoff` skill** (machine-level, at
  `~/.claude/skills/handoff` — it is human-invoke-only, so the session
  reads its SKILL.md and applies the instructions directly), with two
  Factory overrides:
  - **Destination**: `.scratch/handoffs/` in the Project repo, not the OS
    temp dir the skill defaults to.
  - **Name**: `<timestamp>.md` — a full date-time prefix, `YYYY-MM-DD-HHMM`,
    optionally a short slug after it, e.g. `2026-07-28-0912-resume-queue.md`.
    The fixed-width prefix is what makes "newest" — last in lexicographic
    order, as Session start reads it — correct.
- **Contents**: where the Queue stood, decisions made, and facts not
  recoverable from the artifacts (issues, commits, PRs, docs). Reference,
  don't duplicate, what the artifacts already hold — the skill's own rule.
- **Then stop.** Send the maintainer a push notification (one line: Handoff
  written, fresh session needed) and stop cleanly. Resuming is just running
  `/factory` in a fresh session — its Session start consumes the Handoff and
  archives it to `.scratch/handoffs/archive/` (consume-once).

## Milestones

Every open issue carries exactly one milestone — a third invariant axis
alongside the category label and the state label (see "The stamp" table).
Per-axis, exactly as the other two: assigning a milestone must not disturb
either label, and a Project's own domain labels stay untouched. A milestone
is a Linear field (`projectMilestone`), not a label — set it with
`save_issue`'s `milestone` parameter, against a milestone from
`list_milestones`.

Three places enforce it:

- **Issue creation, in a Planning Session.** A new issue is filed with a
  milestone already set, the same as it is filed with a category label.
- **`/factory-adopt`'s re-triage sweep.** Proposes a milestone for every
  open issue alongside its category and state, in the same
  maintainer-approved batches (`skills/factory-adopt/SKILL.md`, "Phase 2"),
  and backfills issues a prior sweep left unassigned.
- **The stamp docs.** The convention is written in
  `docs/agents/triage-labels.md` for every stamped Project — the same file
  that carries the category and state conventions.

**No milestones defined.** The invariant cannot hold until the Project has
milestones to assign. Finding none (`list_milestones` returns empty) —
surface that to the maintainer and stop there for this axis, rather than
skipping it silently or inventing milestone names: naming milestones is a
maintainer decision, made once, outside any sweep or issue-creation step.
Category and state labeling proceeds regardless. This mirrors Queue scope's
own "no milestones" case above, and doesn't contradict it: the invariant is
the goal state a Project grows into, not a precondition Queue scoping
already requires — Queue scoping already works with milestones only
partially applied.

**Declining a milestone.** The maintainer may decline one for a specific
issue — an explicit decision, not an oversight, and it must read as one.
Record it as a Linear comment on the issue, opening with the AI disclaimer
used elsewhere for agent-written tracker comments (see Ping and Park), then
this exact marker line beneath it:

**Milestone: declined by the maintainer.**

Human-readable context belongs beneath the marker — which milestone was
proposed, and why it was declined if the maintainer said — but detection
depends only on the marker, not on that prose.

A decline is recognised **only** by a comment containing that exact line.
Nothing else counts: not a comment that merely discusses milestones, not a
maintainer remark in passing. Before proposing a milestone to an
unassigned issue, check its comments for the marker: an issue that already
carries one is left alone, not re-proposed every sweep.

**Ambiguous or absent record** — no comment contains the marker, or
whether one does is unclear — the issue is treated as *not declined*, and
the sweep proposes a milestone again. Re-asking costs the maintainer one
approval; wrongly inferring a decline from vague prose silently strips an
issue out of the invariant forever. Fail toward asking.

## The stamp

What `/factory-new` installs and `/factory-adopt` retrofits — the conventions
the loop relies on. The file half of the stamp lives in
`${CLAUDE_PLUGIN_ROOT}/templates/stamp/`, parameterised; those templates are its only source, and a
stamping skill fills their placeholders rather than hand-writing conventions.

| Piece | Convention |
| --- | --- |
| Repo | `~/apps/<name>`, private GitHub remote over SSH |
| Issue tracker | One Linear project per repo, Side projects team, documented in `docs/agents/issue-tracker.md` |
| Labels | Five canonical triage states + `Feature`/`Improvement`/`Bug` categories, as team labels |
| Milestones | Every open issue carries exactly one, a third axis alongside category and state — see "## Milestones" |
| Agent docs | `AGENTS.md` + `docs/agents/` (issue-tracker, triage-labels, domain) |
| Domain docs | `CONTEXT.md` + `docs/adr/`, created lazily |
| Scratch | `.scratch/` gitignored; Handoffs in `.scratch/handoffs/`, Pause note at `.scratch/pause-note.md` |
| Git | Branch per issue → PR → merge on green; no direct commits to the default branch |
