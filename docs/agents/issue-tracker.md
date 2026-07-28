# Issue tracker: Linear

Issues and PRDs for this repo live in Linear: project **Factory** on
the **Side projects** team (key `SIDEPRO`).
https://linear.app/side-projects-p/project/factory-99c50a0b88d2

Use the Linear MCP tools (`mcp__linear-server__*`). If their schemas are
deferred, load them with ToolSearch first.

## Conventions

- **Create an issue**: `save_issue` with `team: "Side projects"` and
  `project: "Factory"`. Title in imperative mood; body as Markdown
  with literal newlines (no escape sequences).
- **Read an issue**: `get_issue` (accepts `SIDEPRO-123` identifiers);
  `list_comments` for the discussion.
- **List issues**: `list_issues` filtered by `project: "Factory"`,
  plus `state` / `label` filters as needed.
- **Comment**: `save_comment` on the issue.
- **Apply / remove labels**: `save_issue` with `addLabels` / `removeLabels`.
- **Close**: `save_issue` setting `state` to `Done` (resolved) or
  `Canceled` (wontfix).

## When a skill says "publish to the issue tracker"

Create a Linear issue in the Factory project.

## When a skill says "fetch the relevant ticket"

Call `get_issue` with the issue identifier, then `list_comments`.

## Factory loop operations

Linear's answer to each row of the tracker contract in the Factory's
`PROTOCOL.md` ("The tracker contract"), one bullet per
row. A `/factory` Loop Session needs every one of them.

- **Queue listing**: `list_issues` filtered by
  `project: "Factory"` and `label: "ready-for-agent"`, keeping only
  issues in an unstarted state (**Todo** or **Backlog**). `list_issues` has
  **no milestone filter** — apply the milestone scope client-side on
  `projectMilestone`, a field `list_issues` already returns, rather than
  querying per milestone.
- **Queue order**: Linear's own priority, highest first —
  **Urgent > High > Medium > Low > No priority** — ties broken by the
  oldest `createdAt`. Both fields come back on `list_issues`, so ordering
  costs no extra call.
- **State: started**: `save_issue` setting `state` to **In Progress**,
  in the same call that sets `assignee` — one call is what makes pickup
  atomic.
- **State: completed / canceled**: `save_issue` setting `state` to **Done** for
  landed work, **Canceled** for wontfix.
- **Park**: `save_issue` setting `state` back to **Todo**, with
  `removeLabels: ["ready-for-agent"]` and `addLabels: ["needs-info"]`.
- **Blocking**: `get_issue` with `includeRelations: true`; the issue is
  blocked while any `blockedBy` relation points at an issue that is not
  **Done** or **Canceled**. `list_issues` does not return relations, so
  each candidate needs its own `get_issue` — check them one at a time, in
  Queue order, and stop at the first unblocked one.
- **Milestone**: `projectMilestone` on the issue — a Linear project
  milestone, not a label. List with `list_milestones` for the project,
  ascending `sortOrder` (Linear's own milestone order, stable between
  runs); set with `save_issue`'s `milestone` parameter, against a milestone
  `list_milestones` returned. Read a milestone's completion with
  `get_milestone`'s `progress`.
- **Comment**: `save_comment` on the issue. Body as Markdown with literal
  newlines.
- **Branch name**: `gitBranchName` on the issue — the branch name Linear
  suggests. It is stable for the life of the issue, and using it is what
  makes Linear attach the branch and its PR back to the issue.
- **State verification**: `get_issue` returns the issue's current `state`.
  Fetch it fresh when verifying a Pause note's claim — never compare
  against a value read earlier in the session.

## Reachability

What the Factory's Preflight checks: the Linear MCP tools resolve, and both
the **Side projects** team and the **Factory** project exist —
`list_teams`, then `list_projects` filtered to that team.

## If Linear is unreachable

Say so and stop. Don't silently fall back to another tracker or local files.
