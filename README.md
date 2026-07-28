# Factory

The control plane for running AI-driven software development in a loop. This repo defines the workflow — preferences, loop protocol, conventions. Software gets built in separate project repos under `~/apps/`, each with its own Linear project.

The maintainer plans interactively; an AI Loop Session consumes the queue and only pings when it has a question. See `CONTEXT.md` for the glossary and `docs/adr/` for foundational decisions.

## The loop at a glance

1. **Plan** (you, interactive): `/grilling` → `/to-prd` → `/to-issues` files tracer-bullet issues to the project's Linear project, labeled `ready-for-agent`.
2. **Run** (AI, autonomous): `/factory` in the project repo starts a Loop Session:
   - reads the newest handoff in `.scratch/handoffs/`, if any
   - picks the next unblocked `ready-for-agent` issue — Linear priority first, then oldest — and moves it to In Progress
   - implements subagent-driven (superpowers TDD subagents; the session only orchestrates), gated by `/review`
   - lands it: branch per issue → PR → auto-merge when tests, typecheck, and review are green → issue Done
   - questions: push notification + block ~15 min; unanswered → question posted to the issue, `needs-info`, work stays on its branch, loop continues
   - at each issue boundary: context above ~40% → `/handoff` to `.scratch/handoffs/` and stop
   - empty queue → notify and stop; the loop never invents work
3. **Steer** (you, from anywhere): set priorities and answer `needs-info` questions in Linear.

Resuming after a handoff, a reboot, or a week away is always the same command: `/factory`.

`PROTOCOL.md` is the full Loop Session spec; the `/factory` skill executes it (source in `skills/factory/`, installed by symlinking into `~/.claude/skills/factory`).

## New project

Run `/factory-new <name>`. It will:

1. Create the repo under `~/apps/<name>` with git + a private GitHub remote
2. Create the Linear project on the Side projects team
3. Stamp Factory conventions: `AGENTS.md`, `docs/agents/` (issue tracker, triage labels, domain docs), triage labels in Linear, `.scratch/` in `.gitignore`
4. Drop you into a Planning Session to produce the first issues

## Existing project

Run `/factory-adopt` inside the repo. It will:

1. **Stamp** the repo with the same conventions as above — creating the Linear project, remote, and labels only where missing, and merging into an existing `AGENTS.md`/`CLAUDE.md` rather than overwriting
2. **Re-triage sweep**: every open issue gets a category label (`Feature`/`Improvement`/`Bug`) + a state label (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), and issues destined for agents get durable agent briefs written into them — you approve in batches
3. Leave the project loop-ready: `/factory` works from that point on

## Conventions all projects share

- **Issue tracker**: Linear via MCP; one Linear project per repo. See `docs/agents/issue-tracker.md` for the tool conventions.
- **Triage labels**: the five canonical states, 1:1 names. See `docs/agents/triage-labels.md`.
- **Domain docs**: single-context `CONTEXT.md` + `docs/adr/` per repo, created lazily. See `docs/agents/domain.md`.
- **Git**: branch per issue, PR, auto-merge on green. No half-done work on main — parked issues live on their branch.
- **Context discipline**: Loop Sessions stay under ~40% context; superpowers subagents do the implementation; `/handoff` bridges sessions.

## Install

What the Factory assumes on the machine:

1. **Claude Code** with the **Linear MCP server** connected to the Side projects workspace.
2. **`gh`** authenticated, git over SSH.
3. **Skills**: [superpowers](https://github.com/obra/superpowers) and the engineering skills (`/review`, `/handoff`, `/grilling`, …) installed under `~/.claude/skills`. New repos get their per-repo config (`AGENTS.md`, `docs/agents/`) via `/setup-matt-pocock-skills`, or via `/factory-new` for new projects and `/factory-adopt` for existing ones.
4. **This repo** at `~/apps/factory`, with the Factory skills symlinked in:

   ```sh
   ln -s ~/apps/factory/skills/factory ~/.claude/skills/factory
   ln -s ~/apps/factory/skills/factory-new ~/.claude/skills/factory-new
   ln -s ~/apps/factory/skills/factory-adopt ~/.claude/skills/factory-adopt
   ```

   `/factory` should then show up in any Claude Code session's skill list.

## Use

1. **Plan** in the project repo: `/grilling` an idea into shape, slice it into `ready-for-agent` Linear issues (see "The loop at a glance").
2. **Run** `/factory` in the project repo and walk away. The Loop Session works the Queue and pings only when it has a question.
3. **Steer** from Linear: reorder priorities, answer `needs-info` questions. Re-running `/factory` is always the right way to resume.

`PROTOCOL.md` is the contract for what the Loop Session does at every step.
