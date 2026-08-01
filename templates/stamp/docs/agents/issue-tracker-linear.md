# Issue tracker: Linear

<!-- factory:tracker kind=linear -->

Issues and PRDs for this repo live in Linear: project **{{PROJECT_NAME}}** on
the **{{TEAM_NAME}}** team (key `{{TEAM_KEY}}`).
{{LINEAR_PROJECT_URL}}

Use the Linear MCP tools (`mcp__linear-server__*`). If their schemas are
deferred, load them with ToolSearch first.

## Conventions

- **Create an issue**: `save_issue` with `team: "{{TEAM_NAME}}"` and
  `project: "{{PROJECT_NAME}}"`. Title in imperative mood; body as Markdown
  with literal newlines (no escape sequences).
- **Read an issue**: `get_issue` (accepts `{{TEAM_KEY}}-123` identifiers);
  `list_comments` for the discussion.
- **List issues**: `list_issues` filtered by `project: "{{PROJECT_NAME}}"`,
  plus `state` / `label` filters as needed.
- **Comment**: `save_comment` on the issue.
- **Apply / remove labels**: `save_issue` with `addLabels` / `removeLabels`.
- **Close**: `save_issue` setting `state` to `Done` (resolved) or
  `Canceled` (wontfix).

## When a skill says "publish to the issue tracker"

Create a Linear issue in the {{PROJECT_NAME}} project.

## When a skill says "fetch the relevant ticket"

Call `get_issue` with the issue identifier, then `list_comments`.

## Factory loop operations

Linear's answer to each row of the tracker contract in `PROTOCOL.md`, the
Factory plugin's own protocol document — a session with the Factory
installed can find it, and one without it has no use for this section — one
bullet per row. A `/factory` Loop Session needs every one of them.

- **Reachability**: `list_teams` both resolves the Linear MCP tools and
  confirms the **{{TEAM_NAME}}** team exists; `list_projects` filtered to
  that team confirms the **{{PROJECT_NAME}}** project does.
- **Queue listing**: `list_issues` filtered by
  `project: "{{PROJECT_NAME}}"` and `label: "ready-for-agent"`, keeping only
  issues in an unstarted state (**Todo** or **Backlog**). `list_issues` has
  **no milestone filter** — apply the milestone scope client-side on
  `projectMilestone`, a field `list_issues` already returns, rather than
  querying per milestone.
- **Queue order**: Linear's own priority, highest first —
  **Urgent > High > Medium > Low > No priority** — ties broken by the
  oldest `createdAt`. Both fields come back on `list_issues`, so ordering
  costs no extra call.
- **State: started**: `save_issue` setting `state` to **In Progress**, in
  the same call that sets `assignee` — one call is what makes pickup atomic.
- **State: completed / canceled**: `save_issue` setting `state` to **Done**
  for landed work, **Canceled** for wontfix.
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
- **Milestone issue counts**: a second `list_issues` filtered by
  `project: "{{PROJECT_NAME}}"`, scoped to the milestone client-side on
  `projectMilestone`, with no `ready-for-agent` filter and no state filter
  — every issue in the milestone, open or closed — bucketed by state:
  **started** is Linear's own **In Progress**; **done** and **canceled**
  are Linear's own **Done** and **Canceled**; among the rest (**Todo** or
  **Backlog**), a `needs-info` label makes the issue **parked**, its
  absence makes it **unstarted**.
- **Open issues**: `list_issues` filtered by `project: "{{PROJECT_NAME}}"`
  and Linear's open states (everything but **Done** and **Canceled**), with
  no `ready-for-agent` filter, scoped to the milestone client-side on
  `projectMilestone` where one is given — drop that filter entirely for an
  unscoped call. Full ticket facts per issue, whatever labels it carries
  and whether or not it is ready: `state` derived as under **Milestone
  issue counts** above, `blockedBy` from the same per-issue `get_issue`
  check as **Blocking**, `claimedBy` from `assignee`.
- **Read an issue**: `get_issue` (accepts `{{TEAM_KEY}}-123` identifiers)
  for the body, then `list_comments` for the discussion — `get_issue` does
  not return comments, so reading an issue in full is always both calls.
- **Comment**: `save_comment` on the issue. Body as Markdown with literal
  newlines.
- **Branch name**: `gitBranchName` on the issue — the branch name Linear
  suggests. It is stable for the life of the issue, and using it is what
  makes Linear attach the branch and its PR back to the issue.
- **State verification**: `get_issue` returns the issue's current `state`.
  Fetch it fresh when verifying a Pause note's claim — never compare
  against a value read earlier in the session.

## Wayfinding operations

Linear's answer to what the `/wayfinder` skill (`~/.claude/skills/wayfinder`)
needs from a tracker. Wayfinder maps and their tickets are planning
artifacts, not work items: they carry `wayfinder:*` labels in place of the
triage axes, never `ready-for-agent`, so they can never enter a Loop
Session's Queue ("Wayfinder maps" in `PROTOCOL.md`, the Factory plugin's
own protocol document — not a file in this repo; "Wayfinder labels" in
`docs/agents/triage-labels.md`).

- **The map**: an ordinary issue in the **{{PROJECT_NAME}}** project labeled
  `wayfinder:map`. Find a Project's maps with `list_issues` filtered by
  `project: "{{PROJECT_NAME}}"` and `label: "wayfinder:map"`.
- **Labels**: `wayfinder:map`, `wayfinder:research`, `wayfinder:prototype`,
  `wayfinder:grilling`, `wayfinder:task` — team labels on
  **{{TEAM_NAME}}**, created lazily by the first charting session:
  `list_issue_labels` first, then `create_issue_label` only for the names
  that are missing — with `teamId` set (resolve it via `list_teams`), or the
  label lands workspace-scoped. Never create a label you haven't first
  confirmed is missing.
- **Child tickets**: `save_issue` with `parentId` set to the map — Linear's
  native parent/sub-issue relation.
- **Blocking**: Linear's native relations — `save_issue` with `blockedBy` /
  `blocks` (append-only), wired in a second pass once every ticket has an
  identifier. Read them back with `get_issue` `includeRelations: true`: a
  ticket is blocked while any `blockedBy` relation points at an issue that
  is not **Done** or **Canceled**.
- **Frontier**: `list_issues` with `parentId` set to the map and
  `orderBy: "createdAt"`, keeping tickets in an unstarted state (**Todo**
  or **Backlog**) with no assignee, walked oldest-first — a stable order,
  so two sessions over identical state pick the same frontier ticket; the
  default `updatedAt` order shifts with every edit. `list_issues` does not
  return relations, so confirm each candidate unblocked with its own
  `get_issue` — the same per-candidate check the loop's **Blocking** bullet
  uses.
- **Claim**: `save_issue` setting `assignee: "me"` — the assignee is the
  claim; an open, unassigned ticket is unclaimed.
- **Resolve**: post the resolution with `save_comment`, then `save_issue`
  setting `state` to **Done**. A ticket ruled out of scope closes as
  **Canceled** instead — resolved and ruled-out stay distinguishable, the
  same way landed and wontfix do.

## Reachability

What the Factory's Preflight checks: the Linear MCP tools resolve, and both
the **{{TEAM_NAME}}** team and the **{{PROJECT_NAME}}** project exist —
`list_teams`, then `list_projects` filtered to that team.

## If Linear is unreachable

Say so and stop. Don't silently fall back to another tracker or local files.
