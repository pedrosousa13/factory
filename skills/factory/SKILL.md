---
name: factory
description: Start or resume a Factory Loop Session. A bare /factory finds the next step itself — adopt an unstamped repo, migrate an old stamp, or work the whole Queue — then works through the Project's ready-for-agent issues one at a time (pickup, subagent implementation, review-gated landing, repeat), triages when the Queue runs out, and moves on to planning once nothing is left. An optional argument scopes the Queue to one milestone. Use when the user runs /factory, or asks to start, resume, or continue the factory loop in a project repo.
---

# /factory — Loop Session

You are now a Loop Session. The protocol lives in the Factory repo:

**Read `${CLAUDE_PLUGIN_ROOT}/PROTOCOL.md` in full before doing anything else.**
It is the source of truth; this file only bootstraps it.

## Bootstrap

1. Read `${CLAUDE_PLUGIN_ROOT}/PROTOCOL.md`.
2. Run its "## Preflight" section in full, plus the stamp check below, before
   doing anything else — accumulate failures from both rather than stopping
   at the first:
   - Every Preflight check in `${CLAUDE_PLUGIN_ROOT}/PROTOCOL.md`.
   - **Stamped**: `.factory/config.json` exists, parses, and carries a
     `stampVersion` at the plugin's current version. That config is the v2
     stamp. Do not read a `Factory loop operations` section in
     `docs/agents/issue-tracker.md` as "stamped" — that section is the
     *legacy v1* stamp, and a repo carrying it without a current config is a
     repo to bring forward, not one to run. Several distinct failures are
     possible. See `${CLAUDE_PLUGIN_ROOT}/PROTOCOL.md`'s
     "## Prerequisites: a stamped Project repo" for the cause and the fix of
     each.
   Then route on the result, per `${CLAUDE_PLUGIN_ROOT}/PROTOCOL.md`'s
   "## Invocation: what `/factory` does next": a Preflight failure → report
   every one collected, with its fix, and stop. Unstamped → follow
   `skills/factory-adopt/SKILL.md` in this session. Old stamp → follow
   `skills/factory-migrate/SKILL.md` in this session. After either one,
   re-run the checks above. Only a green result begins Session start. Their
   own approval gates still apply.
3. Read `docs/agents/issue-tracker.md` — the Project's Tracker adapter. It
   names where this Project's issues live and what tooling reaches them;
   load that tooling as it directs, via ToolSearch first if it names
   deferred tool schemas.
4. Follow ${CLAUDE_PLUGIN_ROOT}/PROTOCOL.md: Session start → the loop (Queue selection → State
   mirroring → Implementation → Landing gate → Issue boundary).

## Hard rules (from the protocol — details there)

- The Queue is the only source of work. Never invent work. Run out (empty
  after a Triage pass) → push notification and report. An interactive
  session then runs `/retro` over the session and opens a Planning Session,
  budget permitting. A headless run stops.
- A bare `/factory` never asks what to do: it routes itself, and its Queue
  scope is Everything. `/factory <milestone>` (or `everything`,
  `no-milestone`) sets the scope. Ask only when the argument names no
  milestone that exists. Draining a scoped Queue reports the milestone's
  progress and remaining-work breakdown, not "milestone complete" — see
  ${CLAUDE_PLUGIN_ROOT}/PROTOCOL.md.
- Every question to the maintainer is structured (`AskUserQuestion`), with
  the researched recommendation first — see "## Asking the maintainer". The
  one exception is a mid-loop Ping, which stays push + timer + Park.
- Triage when you need to. When the Queue runs out: one full pass that
  applies what the evidence settles and asks, in batches, about anything
  that would promote work into the Queue or drop it. After an issue that
  filed new `needs-triage` reports: a quiet pass that asks nothing, because
  a question would stall the loop. See "## Triage pass".
- Subagents implement; you orchestrate. Inline work only for genuine
  one-liners, as ${CLAUDE_PLUGIN_ROOT}/PROTOCOL.md defines them.
- A question only the maintainer can answer → ping and run a ~15 minute
  deadline timer without ending the turn. Unanswered → Park the issue and
  continue with the next one. Never guess.
- Nothing lands without the Landing gate (tests + typecheck where they exist,
  plus `/code-review`).
- Mirror every transition in the tracker: pickup comment with branch name,
  completion comment with PR link, State: started → State: completed.
- At every issue boundary, check the Context Budget; over budget → write a
  Handoff and stop. Never start a new issue over budget.
- A Pause note (`.scratch/pause-note.md`) is written on pickup, refreshed
  only on a maintainer decision or an irreversible external action, and
  deleted when the issue lands or is Parked. A dirty tree at Session start
  with a Pause note present is not a block — read, verify, and resume the
  named issue; see ${CLAUDE_PLUGIN_ROOT}/PROTOCOL.md.
