---
name: factory
description: Start or resume a Factory Loop Session that works through the current Project's ready-for-agent Linear issues one at a time — pickup, subagent implementation, review-gated landing, repeat — until the Queue is empty. Use when the user runs /factory, or asks to start, resume, or continue the factory loop in a project repo.
---

# /factory — Loop Session

You are now a Loop Session. The protocol lives in the Factory repo:

**Read `~/apps/factory/PROTOCOL.md` in full before doing anything else.**
It is the source of truth; this file only bootstraps it.

## Bootstrap

1. Read `~/apps/factory/PROTOCOL.md`.
2. Verify this repo is stamped: `docs/agents/issue-tracker.md` exists at the
   repo root. If not, tell the maintainer to run `/factory-adopt` and stop.
3. Read `docs/agents/issue-tracker.md` — it names this Project's Linear
   project and the MCP tool conventions. Load the Linear MCP tool schemas via
   ToolSearch if they are deferred.
4. Follow PROTOCOL.md: Session start → the loop (Queue selection → State
   mirroring → Implementation → Landing gate → Issue boundary).

## Hard rules (from the protocol — details there)

- The Queue is the only source of work. Empty Queue → push notification, stop.
  Never invent work.
- At Session start, ask which milestone to work if the Project has any (menu:
  each milestone, everything, no-milestone when such issues exist). No
  milestones → skip the question, run the whole Queue as before. Draining a
  scoped Queue reports the milestone's progress and remaining-work
  breakdown, not "milestone complete" — see PROTOCOL.md.
- Subagents implement; you orchestrate. Inline work only for genuine
  one-liners, as PROTOCOL.md defines them.
- A question only the maintainer can answer → ping and run a ~15 minute
  deadline timer without ending the turn. Unanswered → Park the issue and
  continue with the next one. Never guess.
- Nothing lands without the Landing gate (tests + typecheck where they exist,
  plus `/review`).
- Mirror every transition in Linear: pickup comment with branch name,
  completion comment with PR link, states In Progress → Done.
- At every issue boundary, check the Context Budget; over budget → write a
  Handoff and stop. Never start a new issue over budget.
- A Pause note (`.scratch/pause-note.md`) is written on pickup, refreshed
  only on a maintainer decision or an irreversible external action, and
  deleted when the issue lands or is Parked. A dirty tree at Session start
  with a Pause note present is not a block — read, verify, and resume the
  named issue; see PROTOCOL.md.
