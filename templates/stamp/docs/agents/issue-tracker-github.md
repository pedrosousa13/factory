# Issue tracker: GitHub Issues

Issues and PRDs for this repo live in GitHub Issues, on the **{{REPO}}**
repository — the Project **{{PROJECT_NAME}}**.
https://github.com/{{REPO}}/issues

Use the `gh` CLI. Every command below names the repo explicitly with
`--repo {{REPO}}`, so it works from any directory.

## The state model

GitHub issues are only `open` or `closed`, so the Factory's four states map
onto open/closed plus the **assignee** field:

| Factory state | GitHub |
| --- | --- |
| unstarted | open, no assignee |
| started | open, assigned to the maintainer |
| completed | closed with reason `completed` |
| canceled | closed with reason `not planned` |

The assignee is the started marker. That is what makes pickup atomic: a
single `gh issue edit --add-assignee` both claims the issue and moves it out
of the unstarted set, so there is no window where an issue is assigned but
still Queue-eligible.

## Priority

GitHub Issues has no priority field, so Queue order comes from a label
vocabulary — created alongside the canonical triage labels, as repository
labels on {{REPO}}:

| Label | Rank |
| --- | --- |
| `P0` | highest — urgent |
| `P1` | high |
| `P2` | medium |
| `P3` | low |

Exactly one `P` label per open issue. An issue carrying none sorts **last**,
after `P3` — the equivalent of Linear's "No priority". Ordering is `P0` →
`P1` → `P2` → `P3` → unlabeled, with ties broken by ascending issue number
(oldest first).

## Conventions

- **Create an issue**: `gh issue create --repo {{REPO}} --title "..." --body-file -`.
  Title in imperative mood; body as Markdown on stdin (a heredoc or a file —
  never an inline `--body` string, so newlines stay literal).
- **Read an issue**: `gh issue view <number> --repo {{REPO}} --json number,title,body,comments,labels,milestone,assignees,state,stateReason,createdAt`
  — one call returns the body *and* every comment, unlike trackers that need two.
- **List issues**: `gh issue list --repo {{REPO}} --state open --json number,title,labels,milestone,assignees,createdAt`,
  plus `--label` / `--milestone` filters as needed. Pass `--limit` above the
  default 30 when the Project has more open issues than that.
- **Comment**: `gh issue comment <number> --repo {{REPO}} --body-file -`.
- **Apply / remove labels**: `gh issue edit <number> --repo {{REPO}} --add-label "..." --remove-label "..."`.
- **Close**: `gh issue close <number> --repo {{REPO}} --reason completed`
  (resolved) or `--reason "not planned"` (wontfix).

## When a skill says "publish to the issue tracker"

Create a GitHub issue on {{REPO}}.

## When a skill says "fetch the relevant ticket"

`gh issue view <number> --repo {{REPO}} --json body,comments`.

## Factory loop operations

GitHub's answer to each row of the tracker contract in `PROTOCOL.md`, the
Factory plugin's own protocol document — a session with the Factory
installed can find it, and one without it has no use for this section — one
bullet per row. A `/factory` Loop Session needs every one of them.

- **Reachability**: `gh auth status` confirms the CLI is authenticated;
  `gh repo view {{REPO}} --json name,hasIssuesEnabled` confirms the repo
  exists and has its issue tracker turned on. A repo with
  `hasIssuesEnabled: false` is unreachable for this Project's purposes even
  though the repo resolves.
- **Queue listing**: `gh issue list --repo {{REPO}} --state open --label ready-for-agent --json number,title,labels,milestone,assignees,createdAt`,
  keeping only issues with an **empty `assignees` array** (the unstarted
  state, above). `--milestone` filters server-side when the Queue scope is a
  single milestone; the "(No milestone)" scope has no server-side filter, so
  apply it client-side on `milestone == null`.
- **Queue order**: the `P` label vocabulary above — `P0` > `P1` > `P2` >
  `P3` > unlabeled — with ties broken by the oldest `createdAt`. Both fields
  come back on `gh issue list`, so ordering costs no extra call. Issue number
  ascending is equivalent to `createdAt` ascending on GitHub and may be used
  instead.
- **State: started**: `gh issue edit <number> --repo {{REPO}} --add-assignee @me`
  — one call, which is what makes pickup atomic. There is no separate status
  field to set.
- **State: completed / canceled**: `gh issue close <number> --repo {{REPO}} --reason completed`
  for landed work, `--reason "not planned"` for wontfix. The reason is what
  distinguishes the two — a bare `gh issue close` defaults to `completed`
  and would silently record a wontfix as done.
- **Park**: `gh issue edit <number> --repo {{REPO}} --remove-assignee @me --remove-label ready-for-agent --add-label needs-info`
  — unassigning is what returns the issue to the unstarted state, so it must
  happen alongside the label swap, not instead of it.
- **Blocking**: `gh api repos/{{REPO}}/issues/<number>/dependencies/blocked_by`
  returns the issues this one is blocked by; the issue is blocked while any
  of them has `state` `open`. An empty array means unblocked. This is
  GitHub's native issue-dependency API — not a body convention — so a
  `## Blocked by` section written in prose is documentation for humans and
  is **not** what the loop checks.
- **Milestone**: GitHub's native milestone field. List with
  `gh api repos/{{REPO}}/milestones --jq '.[] | "\(.number) \(.title)"'`,
  ascending `number` (creation order, stable between runs); set with
  `gh issue edit <number> --repo {{REPO}} --milestone "<title>"`. Read a
  milestone's completion from its `open_issues` and `closed_issues` counts —
  `gh api repos/{{REPO}}/milestones/<milestone-number>`.
- **Milestone issue counts**: `gh issue list --repo {{REPO}} --state open --milestone "<title>" --json number,labels`,
  with no `ready-for-agent` filter, then bucketed by the triage label each
  issue carries. This is its own query, not a re-count of the Queue — the
  Queue listing above filters to `ready-for-agent` and so can only ever
  report zero for `needs-info` and `ready-for-human`.
- **Read an issue**: `gh issue view <number> --repo {{REPO}} --json body,comments`
  — body and comments in one call.
- **Comment**: `gh issue comment <number> --repo {{REPO}} --body-file -`.
  Body as Markdown on stdin with literal newlines.
- **Branch name**: `<number>-<slugified-title>` — GitHub's own convention,
  which is what makes GitHub link the branch and its PR back to the issue.
  Derive the slug from the title: lowercase, non-alphanumerics collapsed to
  single hyphens, trimmed. **If a branch matching `<number>-*` already
  exists** locally or on the remote, reuse it rather than deriving a new
  one — that is what keeps the name stable for the life of the issue even if
  its title is later edited.
- **State verification**: `gh issue view <number> --repo {{REPO}} --json state,stateReason,assignees,labels`
  reports the issue's current state. Fetch it fresh when verifying a Pause
  note's claim — never compare against a value read earlier in the session.

## Landing and PR linkage

Put `Closes #<number>` in the PR body so GitHub links the PR to the issue and
closes it on merge. The Landing gate's explicit close then confirms a state
GitHub has usually already applied — run it anyway, and set `--reason` on it,
because GitHub's auto-close always records `completed`.

## Reachability

What the Factory's Preflight checks: `gh` is authenticated, and the
**{{REPO}}** repository both exists and has issues enabled —
`gh auth status`, then `gh repo view {{REPO}} --json name,hasIssuesEnabled`.

## If GitHub is unreachable

Say so and stop. Don't silently fall back to another tracker or local files.
