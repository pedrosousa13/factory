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
| `templates/stamp/AGENTS.md`                           | `AGENTS.md`                         |
| `templates/stamp/docs/agents/issue-tracker-linear.md` | `docs/agents/issue-tracker.md`      |
| `templates/stamp/docs/agents/issue-tracker-github.md` | `docs/agents/issue-tracker.md`      |
| `templates/stamp/docs/agents/triage-labels.md`        | `docs/agents/triage-labels.md`    |
| `templates/stamp/docs/agents/domain.md`               | `docs/agents/domain.md`             |
| `templates/stamp/gitignore`                           | `.gitignore`                        |

Exactly one `issue-tracker-<tracker>.md` row applies per Project — the one
for the tracker that Project uses. They share a destination because a Project
has exactly one tracker.

`templates/stamp/gitignore` has no leading dot on purpose — a dotfile inside
the templates tree is easy to miss, and some copy operations skip hidden
files. The skill writes its contents to `.gitignore` in the target repo.

`issue-tracker-<tracker>.md` is one template per tracker — the Project's
**Tracker adapter**, answering every row of
`${CLAUDE_PLUGIN_ROOT}/PROTOCOL.md`'s "The tracker contract" for that one
tracker. Only the template's name carries the tracker; the destination is
always `docs/agents/issue-tracker.md`, because a Project has exactly one
tracker and nothing that reads that file should have to know which. Linear
and GitHub Issues are the adapters today.

Adding a tracker means writing one new `issue-tracker-<tracker>.md` that
answers every row of that contract, and defining its values for the shared
placeholders below. Nothing else in this directory is tracker-specific:
`AGENTS.md` and `triage-labels.md` name the tracker only through placeholders
and otherwise defer to the adapter, so they render correctly for any tracker
without being rewritten.

## Placeholders

Three placeholders are shared by every tracker. A stamping skill fills them
with values the Project's chosen adapter defines:

| Placeholder            | Meaning                                            |
| ---------------------- | -------------------------------------------------- |
| `{{PROJECT_NAME}}`     | The Project's name in its tracker                  |
| `{{TRACKER_NAME}}`     | The tracker product, as prose                      |
| `{{TRACKER_LOCATION}}` | One-line phrase naming where this Project's issues live, and the tooling that reaches them |
| `{{LABEL_SCOPE}}`      | Where the canonical labels live, as prose          |

Their per-tracker values:

| Placeholder            | Linear                                                              | GitHub Issues                                          |
| ---------------------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| `{{PROJECT_NAME}}`     | `Factory`                                                           | `Hop`                                                   |
| `{{TRACKER_NAME}}`     | `Linear`                                                            | `GitHub Issues`                                         |
| `{{TRACKER_LOCATION}}` | ``project "Factory" on the Side projects team, via the Linear MCP tools`` | ``the `pedrosousa13/hop` repository, via the `gh` CLI`` |
| `{{LABEL_SCOPE}}`      | `team labels on the Side projects team`                             | ``repository labels on `pedrosousa13/hop```             |

The remaining placeholders are tracker-specific, used only by their own
adapter:

| Placeholder              | Tracker | Meaning                | Example             |
| ------------------------ | ------- | ---------------------- | ------------------- |
| `{{LINEAR_PROJECT_URL}}` | Linear  | The Linear project URL | (a linear.app link) |
| `{{TEAM_NAME}}`          | Linear  | The Linear team name   | `Side projects`     |
| `{{TEAM_KEY}}`           | Linear  | The Linear team key    | `SIDEPRO`           |
| `{{REPO}}`               | GitHub  | `owner/repo`           | `pedrosousa13/hop`  |

`issue-tracker-linear.md` uses `{{PROJECT_NAME}}`, `{{LINEAR_PROJECT_URL}}`,
`{{TEAM_NAME}}` and `{{TEAM_KEY}}`. `issue-tracker-github.md` uses
`{{PROJECT_NAME}}` and `{{REPO}}`. `AGENTS.md` uses `{{TRACKER_NAME}}`,
`{{TRACKER_LOCATION}}` and `{{LABEL_SCOPE}}`. `docs/agents/triage-labels.md`
uses only `{{LABEL_SCOPE}}`. `docs/agents/domain.md` is fully generic and has
no placeholders.

## What the stamp is not, in this directory

Two pieces of the stamp aren't files a template can produce:

- **Triage labels**: the five canonical triage states plus the
  `Feature`/`Improvement`/`Bug` categories are created directly in the
  tracker, at the scope its adapter names, only where missing. A tracker
  whose adapter defines a priority label vocabulary (because it has no native
  priority field) has those created the same way, at the same time.
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
