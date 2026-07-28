# Issue tracker: Linear

Issues and PRDs for this repo live in Linear: project **Factory** on the
**Side projects** team (key `SIDEPRO`).
https://linear.app/side-projects-p/project/factory-99c50a0b88d2

Use the Linear MCP tools (`mcp__linear-server__*`). If their schemas are
deferred, load them with ToolSearch first.

## Conventions

- **Create an issue**: `save_issue` with `team: "Side projects"` and
  `project: "Factory"`. Title in imperative mood; body as Markdown with
  literal newlines (no escape sequences).
- **Read an issue**: `get_issue` (accepts `SIDEPRO-123` identifiers);
  `list_comments` for the discussion.
- **List issues**: `list_issues` filtered by `project: "Factory"`, plus
  `state` / `label` filters as needed.
- **Comment**: `save_comment` on the issue.
- **Apply / remove labels**: `save_issue` with `addLabels` / `removeLabels`.
- **Close**: `save_issue` setting `state` to `Done` (resolved) or
  `Canceled` (wontfix).

## When a skill says "publish to the issue tracker"

Create a Linear issue in the Factory project.

## When a skill says "fetch the relevant ticket"

Call `get_issue` with the issue identifier, then `list_comments`.

## If Linear is unreachable

Say so and stop. Don't silently fall back to another tracker or local files.
