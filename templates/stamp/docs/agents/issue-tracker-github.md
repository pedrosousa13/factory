# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues on **{{REPO}}**.

Use the `gh` CLI for all operations. Pass `-R {{REPO}}` explicitly on every
call rather than relying on the current directory's remote — a session that
runs from a worktree, a subdirectory, or another clone stays correct.

## Conventions

- **Create an issue**: `gh issue create -R {{REPO}} --title "..." --body
  "..."`. Title in imperative mood; use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <n> -R {{REPO}} --json
  title,body,labels,milestone,state,stateReason,comments` — `comments` is a
  `--json` field, so one call returns the body and the discussion together.
- **List issues**: `gh issue list -R {{REPO}} --state open --limit 500 --json
  number,title,labels,milestone,createdAt`, plus `--label` / `--milestone`
  filters as needed. `--limit` defaults to 30; pass it on every listing.
- **Comment**: `gh issue comment <n> -R {{REPO}} --body "..."`.
- **Apply / remove labels**: `gh issue edit <n> -R {{REPO}} --add-label
  "..."` / `--remove-label "..."`.
- **Close**: `gh issue close <n> -R {{REPO}} --reason completed` (resolved)
  or `--reason "not planned"` (wontfix).

## When a skill says "publish to the issue tracker"

Create a GitHub issue on {{REPO}}.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <n> -R {{REPO}} --json
title,body,labels,milestone,state,stateReason,comments`.

## Factory loop operations

GitHub's answer to each row of the tracker contract in `PROTOCOL.md`, the
Factory plugin's own protocol document — a session with the Factory
installed can find it, and one without it has no use for this section — one
bullet per row. A `/factory` Loop Session needs every one of them.

- **Reachability**: `gh auth status` resolves the `gh` CLI and confirms it
  is authenticated; `gh repo view {{REPO}} --json name` confirms the
  **{{REPO}}** repo exists and is visible to this account.
- **Queue listing**: `gh issue list -R {{REPO}} --state open --label
  ready-for-agent --milestone <n-or-title> --limit 500 --json
  number,title,labels,milestone,createdAt`. `--milestone` accepts either a
  milestone number or its title; drop the flag entirely for an unscoped
  run. `--limit` is not optional: `gh issue list` fetches 30 by default, so
  a Queue longer than that loses everything past the cap with no error, and
  because the order below is applied to whatever came back, the issue that
  should have been picked can simply be absent. Unstarted means the issue
  does **not** carry `in-progress` — GitHub has no started state, so the
  label stands in for one (see "Where a label is weaker than a field"
  below). Treat the result as a set of candidates to confirm, not as fact:
  the listing lags label writes, and each candidate is re-checked
  individually before it is picked.
- **Queue order**: the `P0`–`P3` labels, highest first — **`P0` (Urgent) >
  `P1` (High) > `P2` (Medium) > `P3` (Low) > no priority label** — ties
  broken by the oldest `createdAt`. Both the labels and `createdAt` come
  back on the same listing call, so ordering costs no extra call.
- **State: started**: `gh issue edit <n> -R {{REPO}} --add-label
  in-progress --add-assignee @me` — one call, which is what makes pickup
  atomic. GitHub issues have only `OPEN` and `CLOSED`, so `in-progress` is
  the started state.
- **State: completed / canceled**: `gh issue close <n> -R {{REPO}} --reason
  completed` for landed work, which reads back as `state=CLOSED`,
  `stateReason=COMPLETED`. Wontfix is two calls, because `gh issue close`
  has no label flag: `gh issue edit <n> -R {{REPO}} --add-label wontfix`,
  then `gh issue close <n> -R {{REPO}} --reason "not planned"`, which reads
  back as `state=CLOSED`, `stateReason=NOT_PLANNED`. The reason is what
  distinguishes the two — a closed issue with no reason is
  indistinguishable from either.
- **Park**: `gh issue edit <n> -R {{REPO}} --remove-label ready-for-agent
  --remove-label in-progress --add-label needs-info`. The issue stays
  **open**: Park returns work to an unstarted state, it does not close it.
  Removing `in-progress` is the unstarted half of the Park and is not
  optional — an issue left carrying it never re-enters the Queue even once
  it is re-labeled `ready-for-agent`.
- **Blocking**: GitHub's native **sub-issues**. Link one with `gh issue
  edit <parent> -R {{REPO}} --add-sub-issue <child>`; read them back with
  `gh issue view <n> -R {{REPO}} --json subIssues,subIssuesSummary`:

  ```json
  {"subIssues":{"nodes":[{"number":2,"state":"OPEN","title":"...",
                          "url":"..."}],
                "totalCount":1},
   "subIssuesSummary":{"completed":0,"percentCompleted":0,"total":1}}
  ```

  **Direction matters.** A sub-issue is a *child* of its parent, and the
  child **blocks** the parent: an issue is blocked while any of its
  sub-issues is still `OPEN`. Equivalently, `subIssuesSummary.completed <
  subIssuesSummary.total` means blocked. Issues filed from a plan also
  carry a `Blocked by #N` line in the body, the form `/to-tickets` writes;
  where that line is present, an open issue it names blocks this one too.
  `gh issue list` returns neither, so each candidate needs its own `gh
  issue view` — check them one at a time, in Queue order, and stop at the
  first unblocked one.
- **Milestone**: a GitHub **milestone** on the issue, not a label. Create
  one with `gh api repos/{{REPO}}/milestones -f title=... -f
  description=...`; list a repo's milestones with `gh api --paginate
  "repos/{{REPO}}/milestones?state=all&per_page=100"`, which returns them
  in GitHub's own order, stable between runs. Both halves of that query
  are load-bearing: the endpoint returns only open milestones by default
  and pages at 30, and the milestone menu is supposed to show *every*
  milestone in the Project — a stable menu shape matters more than hiding
  the closed or the empty ones. Set one with `gh issue create --milestone
  <n-or-title>` at creation, or `gh issue edit <n> -R {{REPO}} --milestone
  <n-or-title>` afterwards. Read a milestone's completion with `gh api
  repos/{{REPO}}/milestones/<n>` and its `open_issues` / `closed_issues`
  counts — GitHub reports no percentage, so compute one from the pair.
- **Milestone issue counts**: one listing per state label: `gh issue list
  -R {{REPO}} --state open --milestone <n> --label <state-label> --limit
  500 --json number --jq 'length'`, run once for `ready-for-human`, once
  for `needs-info`, and once for `ready-for-agent`. `--jq` counts
  client-side, over whatever the listing already fetched, so `--limit` is
  the real ceiling on the count: leave it off and the default of 30 pins
  every larger milestone at exactly 30, and the empty-Queue report states
  a wrong number without any sign that it did. This is deliberately not a
  re-count of the Queue, which sees only `ready-for-agent`. The blocked
  figure is the `ready-for-agent` count narrowed to those with an
  unfinished blocker, by the same per-issue check as **Blocking** above.
- **Read an issue**: `gh issue view <n> -R {{REPO}} --json
  title,body,labels,milestone,state,stateReason,comments` — one call.
  `comments` is a valid `--json` field and returns each comment's author,
  body and timestamp, so the body and the whole discussion come back
  together. `gh issue view <n> -R {{REPO}} --comments` renders the same
  discussion for a human to read, but a session working from the issue
  needs only the `--json` call.
- **Comment**: `gh issue comment <n> -R {{REPO}} --body "..."`. Body as
  Markdown; use a heredoc so newlines stay literal.
- **Branch name**: GitHub supplies none, so it is a convention this repo
  derives: `<user>/issue-<number>-<slug>`, where `<user>` is the
  maintainer's GitHub login and `<slug>` is the issue title lowercased,
  non-alphanumerics collapsed to single hyphens, trimmed to a few words —
  e.g. `pedrosousa13/issue-42-add-the-github-adapter`. Nothing stores it,
  so every session that touches the issue must derive it the same way from
  the same title, and a session resuming an issue looks for that branch
  rather than inventing a new one.
- **State verification**: `gh issue view <n> -R {{REPO}} --json
  state,stateReason,labels,milestone` returns the issue's current state.
  Fetch it fresh when verifying a Pause note's claim — never compare
  against a value read earlier in the session.

## Reachability

What the Factory's Preflight checks: `gh` resolves and is authenticated,
and the **{{REPO}}** repo exists and is visible — `gh auth status`, then
`gh repo view {{REPO}} --json name`.

## If GitHub is unreachable

Say so and stop. Don't silently fall back to another tracker or local files.

## Where a label is weaker than a field

Linear-shaped trackers carry state and priority as native fields; GitHub
carries them as labels, which nothing validates. Three invariants can
therefore break. Each has a resolution rule, so two sessions over identical
state still behave the same.

- **Two priority labels on one issue.** Nothing stops `P0` and `P2` both
  being applied. Rule: **highest wins** — `P0` beats `P1` beats `P2` beats
  `P3`. Ordering stays deterministic no matter how many priority labels an
  issue carries, and no session has to stop and ask.
- **`in-progress` is enforced by nothing.** A session that dies mid-issue
  leaves the label behind; nothing removes it. Rule: `in-progress` on an
  issue with no matching branch (see **Branch name** above) is a **stale
  marker to verify, not a fact to trust** — the same posture `PROTOCOL.md`'s
  Pause note section takes toward an interrupted state. Verify against the
  branch and the Pause note; if neither backs it up, the issue was never
  really started.
- **`gh issue list` lags label writes.** Verified against a real repo:
  freshly created issues were missing from a filtered listing for tens of
  seconds, and an issue kept appearing in a `--label ready-for-agent`
  listing for about a minute after that label was removed. `gh issue view`
  on the same issue was correct immediately, every time. Rule: **the
  listing is a hint; the per-candidate `gh issue view` is the authority.**
  Queue selection already confirms each candidate individually for the
  blocker check — that same confirmation must also re-check that the
  candidate still carries `ready-for-agent`, still lacks `in-progress`, and
  is still open, and skip it otherwise. Without that re-check, a Loop
  Session that Parks an issue and immediately re-runs Queue selection
  re-picks the issue it just Parked, Parks it again, and loops forever.
