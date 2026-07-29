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

| Template                                              | Destination in the Project repo    |
| ----------------------------------------------------- | ----------------------------------- |
| `templates/stamp/AGENTS-linear.md`                    | `AGENTS.md`                         |
| `templates/stamp/AGENTS-github.md`                    | `AGENTS.md`                         |
| `templates/stamp/docs/agents/issue-tracker-linear.md` | `docs/agents/issue-tracker.md`      |
| `templates/stamp/docs/agents/issue-tracker-github.md` | `docs/agents/issue-tracker.md`      |
| `templates/stamp/docs/agents/triage-labels.md`        | `docs/agents/triage-labels.md`    |
| `templates/stamp/docs/agents/domain.md`               | `docs/agents/domain.md`             |
| `templates/stamp/gitignore`                           | `.gitignore`                        |

`templates/stamp/gitignore` has no leading dot on purpose — a dotfile inside
the templates tree is easy to miss, and some copy operations skip hidden
files. The skill writes its contents to `.gitignore` in the target repo.

`issue-tracker-<tracker>.md` and `AGENTS-<tracker>.md` are each one template
per tracker — the former the Project's **Tracker adapter**, answering every
row of `${CLAUDE_PLUGIN_ROOT}/PROTOCOL.md`'s "The tracker contract" for that
one tracker; the latter `AGENTS.md` itself, stamped with tracker-accurate
sentences. Only the template's name carries the tracker; the destination
never does — `docs/agents/issue-tracker.md` and `AGENTS.md` respectively —
because a Project has exactly one tracker and nothing that reads either file
should have to know which. So for each family, exactly one of its templates
is ever copied into a given repo. Linear and GitHub are the adapters today.

## Placeholders

| Placeholder              | Meaning                 | Example                |
| ------------------------ | ----------------------- | ---------------------- |
| `{{PROJECT_NAME}}`       | The Linear project name | `Factory`              |
| `{{LINEAR_PROJECT_URL}}` | The Linear project URL  | (a linear.app link)    |
| `{{TEAM_NAME}}`          | The tracker's team name | `Side projects`        |
| `{{TEAM_KEY}}`           | The Linear team key     | `SIDEPRO`              |
| `{{REPO}}`               | The GitHub repo slug    | `pedrosousa13/factory` |

Placeholders differ per template — a template uses only what its own tracker
needs, and a skill fills only those:

| Template                                              | Placeholders it uses                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| `templates/stamp/docs/agents/issue-tracker-linear.md` | `{{PROJECT_NAME}}`, `{{LINEAR_PROJECT_URL}}`, `{{TEAM_NAME}}`, `{{TEAM_KEY}}` |
| `templates/stamp/docs/agents/issue-tracker-github.md` | `{{REPO}}`                                                                    |
| `templates/stamp/AGENTS-linear.md`                    | `{{PROJECT_NAME}}`, `{{TEAM_NAME}}`                                           |
| `templates/stamp/AGENTS-github.md`                    | `{{REPO}}`                                                                    |
| `templates/stamp/docs/agents/triage-labels.md`        | none — fully generic                                                          |
| `templates/stamp/docs/agents/domain.md`               | none — fully generic                                                          |
| `templates/stamp/gitignore`                           | none — fully generic                                                          |

## What the stamp is not, in this directory

Two pieces of the stamp aren't files a template can produce:

- **Triage labels**: the eight canonical labels — five triage states plus the
  `Feature`/`Improvement`/`Bug` categories — are created directly on the
  tracker, only where missing; scope and any tracker-specific extras (e.g.
  GitHub's `in-progress` and `P0`–`P3`) are per-tracker, in
  `docs/agents/triage-labels.md`.
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
