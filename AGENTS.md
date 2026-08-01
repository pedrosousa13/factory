# AGENTS.md

## Agent skills

### Issue tracker

Issues live in the repo itself — GitHub issues on pedrosousa13/factory, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical label names, as repo labels on pedrosousa13/factory — plus `in-progress` and `P0`–`P3`, labels that stand in for a missing field. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Dev loop

The Factory is self-hosting: `~/apps/factory` is the source repo, not the live
copy a Loop Session normally reads from.

- **Default is release discipline**: a Loop Session runs the *published*
  protocol from the plugin cache. Changes made here take effect on the next
  merge, not immediately.
- **`claude --plugin-dir ~/apps/factory`** loads this clone live for one
  session, for testing before publishing.
- **Hard rule**: edits go to this repo. A path under
  `~/.claude/plugins/cache/` is read-only — if you are reading one, you are
  reading, not writing. A Factory Loop Session will have two files named
  `PROTOCOL.md` in scope and must never edit the cached one.
