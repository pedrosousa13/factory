# Stamp templates

The Factory stamp is the set of conventions a Project repo must carry for
`/factory` to run against it — see `PROTOCOL.md`'s "The stamp" table for the
full list. `templates/stamp/` holds the file-shaped part of that stamp as
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
| `templates/stamp/docs/agents/issue-tracker.md` | `docs/agents/issue-tracker.md`    |
| `templates/stamp/docs/agents/triage-labels.md` | `docs/agents/triage-labels.md`    |
| `templates/stamp/docs/agents/domain.md`      | `docs/agents/domain.md`             |
| `templates/stamp/gitignore`                  | `.gitignore`                        |

`templates/stamp/gitignore` has no leading dot on purpose — a dotfile inside
the templates tree is easy to miss, and some copy operations skip hidden
files. The skill writes its contents to `.gitignore` in the target repo.

## Placeholders

| Placeholder             | Meaning                          | Example              |
| ------------------------ | --------------------------------- | --------------------- |
| `{{PROJECT_NAME}}`       | The Linear project name          | `Factory`             |
| `{{LINEAR_PROJECT_URL}}` | The Linear project URL           | (a linear.app link)   |
| `{{TEAM_NAME}}`          | The Linear team name             | `Side projects`       |
| `{{TEAM_KEY}}`           | The Linear team key              | `SIDEPRO`             |

`docs/agents/issue-tracker.md` uses all four. `AGENTS.md` uses
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

See `PROTOCOL.md`'s "The stamp" table for the complete list and how each
piece fits into the loop.

## Not part of the stamp

Domain docs (`CONTEXT.md`, `docs/adr/`) are deliberately absent from this
directory — `docs/agents/domain.md` explains that they're created lazily,
by `/domain-modeling`, not installed upfront.
