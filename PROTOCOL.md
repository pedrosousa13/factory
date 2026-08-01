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

- **Issue tracker reachable.** Read `docs/agents/issue-tracker.md` and run
  the reachability check *that file documents* — never hardcode a tracker
  here, so this check keeps working for whichever tracker a repo declares.
  Reachable means the tracker's tooling resolves and the place that file
  says issues live in actually exists; the file names the calls that
  confirm both. If the file doesn't exist, this check does not apply — an
  unstamped repo has no declared tracker yet, and its absence is the
  calling skill's problem, not Preflight's: the stamp check below catches
  it for `/factory`; `/factory-new` and `/factory-adopt` are what create
  the file in the first place, so its absence going in is expected.
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
  (below). This Preflight check is the *only* thing that guarantees them —
  the plugin manifest deliberately declares no dependency on superpowers.
  A manifest dependency has to name a marketplace as well as a plugin, so
  it fails on a machine that installed superpowers from a different one
  even though the skills are right there; checking for the skills
  themselves is what actually matters, and it doesn't care where they came
  from. Failure: install the `superpowers` plugin, from any marketplace.
- **No stale `factory*` symlinks**: `~/.claude/skills/factory`,
  `factory-new`, `factory-adopt` must not exist. The Factory ships as a
  plugin now; a leftover symlink from before that change means two things
  claim the name `factory`, and the wrong one can win. Failure: name which
  symlink(s) were found, fix by deleting them.

## Prerequisites: a stamped Project repo

`/factory` runs from the root of a Project repo that carries the Factory stamp:

- **Issue tracker**: one that satisfies the tracker contract below,
  documented in `docs/agents/issue-tracker.md`. That file names the exact
  tracker and the exact place this Project's issues live — never guess
  either.
- **Triage labels**: the five canonical state labels (`needs-triage`,
  `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), mapped in
  `docs/agents/triage-labels.md`, plus the category labels
  (`Feature`/`Improvement`/`Bug`) as team labels.
- **Agent docs**: `AGENTS.md` pointing at `docs/agents/`; domain docs
  (`CONTEXT.md`, `docs/adr/`) created lazily per `docs/agents/domain.md`.
- **Git**: a GitHub remote (SSH), `gh` authenticated, `.scratch/` gitignored.
- **Config**: `.factory/config.json`, present, parsing, and carrying the
  current `stampVersion` — see the stamp check below.

**The stamp check.** `.factory/config.json` existing, parsing, and carrying
a `stampVersion` at the plugin's current stamp version — `STAMP_VERSION` in
`${CLAUDE_PLUGIN_ROOT}/runtime/src/version.ts`, the single source of truth
for this value — means the repo is stamped for v2. The check below —
`docs/agents/issue-tracker.md` present with a `Factory loop operations`
section — is the legacy v1 detection: it finds a stamp predating
`config.json`.

If `docs/agents/issue-tracker.md` is missing, or exists but carries no
`Factory loop operations` section, the repo is not stamped for the loop: tell
the maintainer to run `/factory-adopt` (safe to re-run — it diffs the
existing adapter against the template rather than overwriting) and stop.

## The tracker contract

Every Project has exactly one issue tracker, named and documented in
`docs/agents/issue-tracker.md` — that file is the Project's **Tracker
adapter**. This document states *what* a tracker must provide; the adapter
states *how* this Project's tracker provides it. Nothing in this document
names a tracker product, so moving a Project to a different tracker is a
rewrite of that one file and of nothing else.

| Operation | What the loop requires |
| --- | --- |
| Reachability | A check that the tracker is usable from here: its tooling resolves, and the place this Project's issues live actually exists |
| Queue listing | The issues that carry `ready-for-agent` and are in an unstarted state, each with its milestone, so Queue scope can be applied to the result |
| Queue order | A deterministic order over those issues: priority high→low, ties broken oldest-first |
| State: started | Move an issue into a started state and assign it, as one act |
| State: completed / canceled | Move an issue into a completed state (landed) or a canceled one (wontfix) |
| Park | Return an issue to an unstarted state, and swap its `ready-for-agent` label for `needs-info` |
| Blocking | Answer, for one issue, whether anything still unfinished blocks it |
| Milestone | Carry exactly one milestone per open issue, as a field or equivalent and never a triage label; list a Project's milestones in a stable order; report a milestone's completion |
| Milestone issue counts | Count every still-open issue in one milestone, broken down by state label — its own query, not a re-count of the Queue, which sees only `ready-for-agent` |
| Read an issue | Retrieve one issue's body and every comment on it — the brief Implementation works from, and where a declined milestone is recorded |
| Comment | Append a comment to an issue — pickup, completion, a Parked question, a declined milestone; the last two open with the AI disclaimer (see Ping and Park) |
| Branch name | A per-issue branch name, the same one for every session that touches that issue |
| State verification | Report an issue's current state on demand, so a claim about it can be checked |

**Priority is required.** Queue order is what makes two sessions over
identical state pick the same issue, so a tracker with no native priority
field must supply the ordering some other way — a label vocabulary, a rank
field — and its adapter must say which. A tracker whose Queue cannot be
ordered cannot run the loop.

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
3. **Ask which milestone to work.** List the Project's milestones.
   - **No milestones** → skip the question entirely; run the whole Queue
     unscoped, exactly as before this rule existed. Required: the Factory's
     own Project has none, and `/factory` must keep working here.
   - **Any milestones** → ask the maintainer, before touching the Queue.
     Never default to a scope. Menu, in order:
     1. Every milestone in the Project, in the tracker's own milestone
        order.
     2. **Everything** — no scope, run the whole Queue.
     3. **(No milestone)** — offered only if the Project has at least one
        issue with no milestone.
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

At every step boundary below, overwrite `.factory/journal.json` with the
current `{ticket, branch, step, openQuestion, workers}`. PRD #39 §5 item 8
states it plainly: "Each step overwrites it. … The journal is a hint, not
truth." The `step` field takes one of five values: `queue-selection`,
`state-mirroring`, `implementation`, `landing-gate`, or `issue-boundary`. A
claim always writes `openQuestion: null` — a question never survives a new
claim.

### 1. Queue selection

Overwrite the journal: `step: "queue-selection"`.

The Queue is the set of this Project's issues that are:

- labeled `ready-for-agent`, and
- in an unstarted state, and
- in scope (see "Queue scope" below), and
- outside the reserved planning namespace ("Wayfinder maps" below) — a
  `wayfinder:` or `planning:` labeled issue never enters the Queue, even
  one that also carries `ready-for-agent`, and
- **unblocked**: nothing that blocks them is still unfinished.

**Queue scope**, chosen once at Session start, narrows which issues count:

- **Everything**, or a Project with no milestones → no filter; every
  candidate is in scope.
- **A specific milestone** → in scope if the issue's milestone is that
  milestone, or the issue carries no milestone at all — fail-open, so
  unassigned work is never stranded by a scoped run.
- **(No milestone)** → in scope only if the issue carries no milestone.

Selection order: highest priority first, ties broken by the oldest issue.
Concretely: list the `ready-for-agent` candidates, narrow them to scope,
then walk them in that order, checking each for an unfinished blocker and
skipping any that has one. First unblocked candidate wins. The tracker's
priority vocabulary, and the calls behind the listing and the blocker
check, are in `docs/agents/issue-tracker.md`.

**Empty Queue** → stop cleanly. What to report depends on scope:

- **Unscoped** (Everything, or no milestones in the Project) → notify the
  maintainer with a push notification (one-line status), as before.
- **Scoped to a milestone** → an empty scoped Queue means agent-ready work is
  exhausted, not that the milestone is complete — those are different
  claims, and conflating them is exactly the failure scoping guards against.
  Re-fetch the milestone (don't reuse the Session-start snapshot — landed
  issues may have moved its progress since) and report its real progress
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

An interactive Session's empty-Queue report ends by noting that a fresh
session can plan more work — the loop does not start one itself. A
headless run stops with no such note.

### 2. State mirroring (pickup)

Overwrite the journal: `step: "state-mirroring"`.

Atomically with pickup, in the tracker:

- assign the issue to the maintainer,
- move it to a **started** state,
- comment the branch name being used.

Labels stay as they are — the tracker's state, not the label, tracks progress.
The one exception is Park, which swaps the state label.

Also write the Pause note (mechanics below): which issue, which branch, and
nothing decided yet.

### 3. Implementation

Overwrite the journal: `step: "implementation"`.

- **Branch per issue**, created from the freshly pulled default branch. Use
  the tracker's per-issue branch name (`docs/agents/issue-tracker.md`).
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

Overwrite the journal: `step: "landing-gate"`.

An issue lands only when all of these pass:

1. **Tests** green, if the Project has a test command.
2. **Typecheck** green, if the Project has one.
3. **`/review`** (Standards + Spec) against the issue brief, with no unresolved
   findings.

The merge method follows `.factory/config.json`'s `merge` setting
(`config.ts`'s `effective()`, `agentwork.ts`'s `mergeDecision`, pinned by
`runtime/test/config.test.ts:623-701`). An explicit `merge.method` wins. An
absent method under an auto policy — `squash`, `merge`, or `rebase` — takes
the policy itself as the method. An absent method under the `human` policy
defaults to `squash`. Under `human`, approval also gates the merge.

Then land it:

- Push the branch; open a PR titled after the issue, body summarizing the
  change and linking the issue. No AI attribution in the commits or the PR.
- If the repo has required checks, enable auto-merge and wait for green. If it
  has none, the Landing gate above *is* the green signal — merge immediately
  using the resolved method, delete the branch.
- Mirror completion in the tracker: comment with the PR link, move the issue
  to a **completed** state.
- Delete the Pause note (`.scratch/pause-note.md`) — this is the issue
  boundary that closes it.

No half-done work ever reaches the default branch. If the gate fails and the
fix isn't forthcoming, the work stays on its branch and the issue is Parked.

### 5. Issue boundary

Overwrite the journal: `step: "issue-boundary"`.

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
  Park exists to remove (ADR-0001). The native channel for the current harness
  carries this push where one exists — Claude Code's Notification hook, or
  Codex's `notify` — and Pi carries none. Beneath all three sits one fallback,
  the `notifierCommand` subprocess (`runtime/src/ping.ts`): PRD §5 item 4,
  "Factory does not rely on `notify` … to reach the maintainer."
- **Answered before the timer** → stop the timer, continue the issue with
  context intact. No Park, no state change. The answer is a maintainer
  decision: refresh the Pause note with it (mechanics below).
- **Unanswered** → Park, which is these four steps in order:
  1. **Store the work**: commit what exists on the issue branch and push it.
     The working tree must be clean and the default branch untouched — Parked
     work lives only on its branch.
  2. **Post the question** as a tracker comment on the issue, opening with the
     AI disclaimer the `/triage` skill (`~/.claude/skills/triage`) requires on
     agent-written tracker comments:
     `> *This was generated by AI during triage.*` — followed by the question,
     and a note of the branch name and what state the shelved work is in.
  3. **Re-label**: swap `ready-for-agent` for `needs-info` (an issue carries
     exactly one state label), and move the tracker state back to an
     **unstarted** state. Both matter: Queue selection requires
     `ready-for-agent` *and* an unstarted state, so an issue left in a
     started state would never re-enter the Queue even after it is
     re-labeled. Only now delete the Pause note (`.scratch/pause-note.md`)
     — this is the issue boundary that closes it. Deleting any earlier
     would be a mistake: until the re-label lands, the Pause note is the
     only record that a Park is half-finished, and an issue left started
     with `ready-for-agent` still on it cannot re-enter the Queue on its
     own.
  4. **Continue**: a Park is an issue boundary like a landing, so return to it
     — Context Budget check first, then the next Queue issue.
- **Re-entry**: the maintainer answers the tracker comment; normal triage moves
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
  named branch and the issue's actual state in the tracker.
  - **Verified** → check out that branch and resume Implementation for it
    directly — skipping Queue selection and State mirroring, both already
    done.
  - **Not verified** (the branch is missing, the tracker's state doesn't match,
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
is a tracker field or its equivalent, never a triage label; how to list a
Project's milestones and set one on an issue is the tracker's business
(`docs/agents/issue-tracker.md`).

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
milestones to assign. Finding none (the Project's milestone list is empty) —
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
Record it as a tracker comment on the issue, opening with the AI disclaimer
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

## Wayfinder maps

A Planning Session may chart an effort too large or too foggy for one
session with the `/wayfinder` skill (`~/.claude/skills/wayfinder`): a map
issue plus decision tickets on the Project's tracker, each carrying a
`wayfinder:*` label. The finished map's destination — typically a spec —
feeds the normal slicing flow that produces `ready-for-agent` issues; the
map itself never does.

Wayfinder issues are planning artifacts, not work items, and every
invariant and sweep in this document skips them: no category label, no
state label, no milestone, no priority label. They never carry
`ready-for-agent`, so they can never enter a Queue — the loop and a map
share a tracker without either seeing the other. How a tracker expresses
the map, its child tickets, blocking, and the frontier is the adapter's
business: a "Wayfinding operations" section in
`docs/agents/issue-tracker.md`. The section is optional — a repo stamped
before it existed still satisfies the loop's stamp check — but a repo
without it leaves `/wayfinder` with no per-tracker instructions: the skill
falls back to local markdown only when no tracker is provided at all, so on
a stamped repo it would be improvising against the live tracker. Add the
section before charting a map here — re-running `/factory-adopt` retrofits
it from the current template.

The reserved planning namespace is every label that starts with
`wayfinder:` or `planning:`. Today that is `wayfinder:map`,
`wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`,
`wayfinder:task`, and `planning:prd`. The match is on the prefix, so a new
artifact kind inherits the exclusion by naming itself in the namespace.
Triage (`~/.claude/skills/triage`) skips every issue in this namespace: it
assigns no category, no state, no priority, and no milestone to one.

## Security sweeps

Security work must be planned work, or it never exists: the loop never
invents work, and a Planning Session grilling a feature into issues has no
reason to file an injection check on its own. So it is a convention,
enforced at the same points as the milestone invariant.

**The attack-surface test.** A Project needs security sweeps when its
software accepts untrusted input, serves HTTP, authenticates anyone, stores
user data, or calls third-party services. A Project that does none of
these — a local-only tool, a conventions repo like the Factory's own — does
not. An agent proposes the test's outcome; the maintainer decides it, and
the decision holds until the Project's shape changes.

**One sweep issue per milestone that touches the surface.** Every milestone
containing issues that touch the attack surface also carries one
security-sweep issue: a full OWASP Top 10 pass over the Project's code as
it stands, filed, triaged, and milestoned like any other issue (category
`Improvement` — an audit of existing behavior, not a new capability or a
known defect), and blocked by the milestone's attack-surface issues so it
runs after they land. Its brief asks for findings filed as new issues
labeled `needs-triage` — the sweep reports; it does not fix, and nothing it
files enters a Queue until the maintainer triages it: executing a planned
sweep's brief is not the loop inventing work, any more than landing any
other brief is. The maintainer may consolidate several milestones' sweeps
into fewer — an explicit decision, not a default.

A sweep skips every issue in the reserved planning namespace, the same as
every other invariant in this document: a wayfinder map or a PRD never
touches the attack surface, so a sweep never treats one as though it did.
Findings a sweep files are ordinary issues labeled `needs-triage`, never
planning artifacts — a sweep never mints a `wayfinder:` or `planning:`
label.

**Intertwined criteria, as a complement.** A Planning Session slicing an
issue that touches the attack surface writes security acceptance criteria
into that issue's brief. This is discipline for briefs, not a substitute
for the sweep issue — the sweep is the artifact a session can check for.

**Declining.** The maintainer may rule that the Project fails the
attack-surface test, or decline sweeps outright. Record it in the Project's
`CONTEXT.md` (creating the file if the Project has none yet — a standing
decision is exactly what it exists to hold; a multi-context repo records it
in `CONTEXT-MAP.md` instead) with this exact marker line:

**Security sweeps: declined by the maintainer.**

Human-readable context belongs beneath the marker, but detection depends
only on the marker — the same rule as declining a milestone. An ambiguous
or absent record means *not declined*, and the sweep is proposed again.
Fail toward asking.

Three places enforce it — the same three as the milestone invariant:

- **Planning Sessions**, `/factory-new`'s first included. Filing a
  milestone's issues includes filing its security-sweep issue when any of
  them touch the attack surface, wired blocked-by.
- **`/factory-adopt`'s re-triage sweep.** For each milestone with
  attack-surface issues but no security-sweep issue — open or completed —
  and no recorded decline, propose one in the same maintainer-approved
  batches. This is also how a Project adopted before this convention
  existed picks it up.
- **The stamp docs.** The convention is written in
  `docs/agents/triage-labels.md` for every stamped Project — the same file
  that carries the milestone convention.

## The stamp

What `/factory-new` installs and `/factory-adopt` retrofits — the conventions
the loop relies on. The file half of the stamp lives in
`${CLAUDE_PLUGIN_ROOT}/templates/stamp/`, parameterised; those templates are its only source, and a
stamping skill fills their placeholders rather than hand-writing conventions.

| Piece | Convention |
| --- | --- |
| Repo | `~/apps/<name>`, private GitHub remote over SSH |
| Issue tracker | One tracker per repo, satisfying the tracker contract above, documented in `docs/agents/issue-tracker.md` |
| Labels | Tracker-dependent: 5 triage states + 3 categories, plus started-state and priority where fields are missing |
| Milestones | Every open issue carries exactly one, a third axis alongside category and state — see "## Milestones" |
| Agent docs | `AGENTS.md` + `docs/agents/` (issue-tracker, triage-labels, domain) |
| Domain docs | `CONTEXT.md` + `docs/adr/`, created lazily |
| Scratch | `.scratch/` gitignored; Handoffs in `.scratch/handoffs/`, Pause note at `.scratch/pause-note.md` |
| Git | Branch per issue → PR → merge on green; no direct commits to the default branch |
| Config | `.factory/config.json`, committed; `stampVersion` current means stamped for v2 — see "## Prerequisites: a stamped Project repo" |

## Migration

Migration carries a repo from an old `stampVersion` — including the legacy v1 stamp
detected above — to the plugin's current one.

**What ships today.** The plugin computes a migration. It detects the stamp, builds the
step chain, diffs the adapter document against its template, and renders the new
`config.json`. `/factory-migrate` is the entry point: it applies that result on a repo
whose stamp is legacy v1 or an older v2 version. A repo with no stamp at all is not
`/factory-migrate`'s job. Run `/factory-adopt` there instead. It is safe to re-run and it
uses the same section rules.

**Steps.** Migration runs as a chain of versioned steps: v1 to v2, v2 to v3, and so on. The
plugin computes one combined diff for all pending steps, shows it to the maintainer once,
and takes one approval — never one diff per step, even when several steps must run to
reach the current version.

**Idempotent by design.** Each step is idempotent: a repeat run finds nothing left to do.
A step interrupted partway repairs itself on the next run, because of the
order it writes in: the adapter document first, `config.json` last. That order is
load-bearing. `config.json` carries the stamp, so writing it last makes it the single
commit point. A crash before it leaves the repo at its old stamp, and the whole step runs
again. The reverse order leaves a repo stamped at the new version with a document nothing
retrofitted, and the next run reports nothing pending. This is what makes migration safe to
interrupt — a maintainer can stop a run at any point and re-run it later without auditing
what already landed.

**Section rules.** Migration reuses the adopt skill's section rules for template files; see
`skills/factory-adopt/SKILL.md`.

**The v1 to v2 step asks only what a v1 repo cannot answer.** It detects the tracker choice
from the legacy adapter document, `docs/agents/issue-tracker.md`, and offers it for
one-tap confirmation. It reads the tracker name from the H1 line only, case-insensitively,
and never guesses it from the rest of the document. A document that carries front matter or
a preamble before its H1 therefore falls through to asking for the tracker cold. A v1 repo
has no record of merge policy or attack surface, so the step asks both fresh and defaults
neither. Applying the step then writes `config.json`, retrofits the missing sections, and
sets the stamp version.

**A stale stamp blocks autonomous execution only.** Preflight reports it as a failure that
stops execution and not planning. Planning skills stay available, because they read the
prose docs, not the stamp. A headless run reports the pending migration and stops, because
preflight's stale-stamp failure blocks execution until the repo is migrated. **(pending)**
An interactive run does not yet offer to migrate now on its own. Today the maintainer reads
preflight's fix message and runs the migration themselves — see issue #50. Migration ends
with a full preflight check that validates the config against the adapter document and the
live tracker, and runs the non-interactive push check. Only a green preflight at the current
version unblocks execution.

**A stamp newer than the installed plugin also blocks execution**, with the message
"update the Factory plugin." The plugin never downgrades files.
