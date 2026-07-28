# Factory

The control plane for running AI-driven software development in a loop. This repo defines the workflow — preferences, loop protocol, conventions — while software gets built in separate project repos.

## Language

**Factory**:
The control plane defined by this repo: the preferences, loop protocol, and conventions that govern how AI builds software across projects.
_Avoid_: workspace, monorepo

**Project**:
A piece of software the Factory builds. Lives in its own repo under `~/apps/` with its own Linear project, stamped with the Factory's conventions.
_Avoid_: app, product, workspace

**Tracker adapter**:
A Project's `docs/agents/issue-tracker.md` — the one file that says how its issue tracker satisfies the tracker contract in `PROTOCOL.md`. The protocol names no tracker product, so moving a Project to a different tracker rewrites this file and nothing else. The Factory's own adapter is Linear.
_Avoid_: tracker config, issue-tracker doc, integration

**Loop Session**:
A long-lived interactive Claude Code session that works through a Project's ready-for-agent issues one at a time, pinging the maintainer only when a question arises.
_Avoid_: run, agent loop, daemon

**Planning Session**:
An interactive session where the maintainer turns an idea into ready-for-agent issues (grilling → PRD → issue slices). The only place new work is created.
_Avoid_: intake, brainstorm session

**Queue**:
A Project's set of ready-for-agent issues that are not blocked. The only thing a Loop Session consumes; when empty, the loop stops.
_Avoid_: backlog, todo list

**Queue scope**:
The narrowing a Loop Session chooses at Session start — one milestone, everything, or the unassigned issues — that decides which of a Project's ready-for-agent issues enter its Queue. Draining a scoped Queue means the session's agent-ready work is exhausted, never that the milestone is complete.
_Avoid_: filter, sprint

**Handoff**:
The compacted document a Loop Session writes when its context budget is spent, so a fresh Loop Session can continue without the old context.
_Avoid_: summary, compaction

**Pause note**:
The single file (`.scratch/pause-note.md`) a Loop Session writes on picking up an issue and deletes when that issue lands or is Parked. The opposite of a Handoff: written mid-issue rather than at a boundary, refreshed only on a maintainer decision or an irreversible external action, and read at Session start as an interrupted state to verify, never as trusted fact.
_Avoid_: handoff, pause file, checkpoint

**Context Budget**:
The ceiling (~40% of the context window) a Loop Session may consume before it must hand off. Checked at issue boundaries.
_Avoid_: token limit

**Park**:
Shelving an in-progress issue because a question went unanswered: the question is posted to the issue, the issue moves to needs-info, work is stored cleanly, and the Loop Session continues with the next issue.
_Avoid_: pause, defer, skip

**Adoption**:
Bringing an already-existing Project under Factory conventions: stamping the repo, and fixing its existing issues to meet Factory standards.
_Avoid_: onboarding, migration, import
