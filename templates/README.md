# Stamp templates

The Factory stamp is the set of conventions a Project repo must carry for
`/factory` to run against it — see `${CLAUDE_PLUGIN_ROOT}/PROTOCOL.md`'s "The
stamp" table for the full list. `${CLAUDE_PLUGIN_ROOT}/templates/stamp/` holds
the file-shaped part of that stamp as
parameterised templates: `/factory-new` and `/factory-adopt` copy each one
into the Project repo, filling in the project-specific placeholders below.

These templates are the single source of the conventions. A skill fills in
placeholders and writes the result — it never hand-writes stamp content
itself. When a convention changes, change the template here, not a skill's
inline copy of it.

## File mapping

| Template                                    | Destination in the Project repo    |
| -------------------------------------------- | ----------------------------------- |
| `templates/stamp/AGENTS.md`                  | `AGENTS.md`                         |
| `templates/stamp/docs/agents/issue-tracker-linear.md` | `docs/agents/issue-tracker.md`      |
| `templates/stamp/docs/agents/triage-labels.md` | `docs/agents/triage-labels.md`    |
| `templates/stamp/docs/agents/domain.md`      | `docs/agents/domain.md`             |
| `templates/stamp/gitignore`                  | `.gitignore`                        |

`templates/stamp/gitignore` has no leading dot on purpose — a dotfile inside
the templates tree is easy to miss, and some copy operations skip hidden
files. The skill writes its contents to `.gitignore` in the target repo.

`issue-tracker-<tracker>.md` is one template per tracker — the Project's
**Tracker adapter**, answering every row of
`${CLAUDE_PLUGIN_ROOT}/PROTOCOL.md`'s "The tracker contract" for that one
tracker. Only the template's name carries the tracker; the destination is
always `docs/agents/issue-tracker.md`, because a Project has exactly one
tracker and nothing that reads that file should have to know which. Linear
is the only adapter today.

## Placeholders

| Placeholder             | Meaning                          | Example              |
| ------------------------ | --------------------------------- | --------------------- |
| `{{PROJECT_NAME}}`       | The Linear project name          | `Factory`             |
| `{{LINEAR_PROJECT_URL}}` | The Linear project URL           | (a linear.app link)   |
| `{{TEAM_NAME}}`          | The Linear team name             | `Side projects`       |
| `{{TEAM_KEY}}`           | The Linear team key              | `SIDEPRO`             |

The `issue-tracker-linear.md` template uses all four. `AGENTS.md` uses
`{{PROJECT_NAME}}` and `{{TEAM_NAME}}`. `docs/agents/triage-labels.md` uses
only `{{TEAM_NAME}}`. `docs/agents/domain.md` is fully generic and has no
placeholders.

## What the stamp is not, in this directory

Two pieces of the stamp aren't files a template can produce:

- **Triage labels**: the five canonical triage states plus the
  `Feature`/`Improvement`/`Bug` categories are created directly in Linear, as
  team labels, only where missing.
- **Git remote**: the Project repo's GitHub remote is created and wired up
  directly, not templated.

See `${CLAUDE_PLUGIN_ROOT}/PROTOCOL.md`'s "The stamp" table for the complete
list and how each piece fits into the loop.

## Created lazily, not templated

Domain docs (`CONTEXT.md`, `docs/adr/`) are part of the Factory stamp — see
`${CLAUDE_PLUGIN_ROOT}/PROTOCOL.md`'s "The stamp" table — but have no template
in this directory.
They're created lazily, by `/domain-modeling`, once terms and decisions
actually need resolving, not installed upfront. See
`docs/agents/domain.md`.
