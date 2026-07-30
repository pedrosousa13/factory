---
name: factory-new
description: Bootstrap a brand-new Factory Project end-to-end — repo under ~/apps/<name>, private GitHub remote, an issue tracker (GitHub Issues by default, or Linear), full Factory stamp, triage labels — then starts a Planning Session. Use when the user runs /factory-new <name> to start a project from scratch.
---

# /factory-new — bootstrap a Project

You are bootstrapping a new Factory Project. The conventions you are stamping
are specified elsewhere, not here:

**Read `${CLAUDE_PLUGIN_ROOT}/PROTOCOL.md`'s "The stamp" table and
`${CLAUDE_PLUGIN_ROOT}/templates/README.md` in full before doing anything else.**
`${CLAUDE_PLUGIN_ROOT}/templates/stamp/` is the single source of stamp content. You fill in its
placeholders and write the result — you never hand-write AGENTS.md,
docs/agents/, or .gitignore content yourself. If a placeholder value isn't
known at the point you need it, stop rather than improvise one.

This skill creates exactly one repo, one tracker project where the chosen
tracker needs a separate one (Linear; GitHub has none — the repo is the
tracker), and (where missing) labels. It creates zero issues. It ends by
moving the maintainer into a Planning Session — grilling → PRD → issue
slices — because that is the only place new work gets created (see
`${CLAUDE_PLUGIN_ROOT}/CONTEXT.md`).

## Preflight — fail loudly, change nothing

Run `${CLAUDE_PLUGIN_ROOT}/PROTOCOL.md`'s "## Preflight" section first, in
full — accumulate every failure there rather than stopping at the first, per
its own instruction. `gh` authentication is defined once, there, and is not
repeated below. Its tracker-reachable check does not apply here — this
skill runs before `~/apps/<name>` exists, so there is no
`docs/agents/issue-tracker.md` to read yet; the file this skill writes in
"Apply the stamp" below *is* what that check will read on every later run of
`/factory` or `/factory-adopt` in this repo.

Then run every check below before touching the filesystem, git, GitHub, or
the tracker chosen next. The skill makes no changes until every check in this
section, "Choose a tracker", and — when the maintainer picks Linear —
"Derive the Linear project name" has passed. These are the checks that don't
depend on the tracker choice or the confirmed project name; the duplicate-
Linear-project check runs later, once both are confirmed, so an override
can't slip past it.

1. `<name>` is required. Reject if missing.
2. `<name>` must be kebab-case: lowercase letters, digits, and single hyphens
   between words (`^[a-z0-9]+(-[a-z0-9]+)*$`). Reject anything else — no
   spaces, no underscores, no leading/trailing hyphen, no uppercase.
3. `~/apps/<name>` must not already exist. Stop if it does.

If any check — from the shared Preflight or the list above — fails, report
every failure found, across both, together, and stop. Do not partially
proceed.

## Choose a tracker

Ask the maintainer which issue tracker this Project uses — the same question
`/setup-matt-pocock-skills`'s Section A asks, and for the same reason: skills
need to know whether to call Linear's MCP tools or `gh issue create`. Default
posture: **GitHub**. That skill proposes GitHub or GitLab by reading an
existing `git remote`; here there is nothing to read — `/factory-new` runs
before `~/apps/<name>` exists, so no remote can point anywhere yet, and
there's no "propose what the remote points at" half to apply. Offer
GitHub / Linear / Other (GitLab, local markdown, or anything else),
defaulting to GitHub absent a preference. Asking this is not a change to
anything, so it's fine to do before any check below.

GitHub and Linear are the two trackers this skill can actually stamp:
`${CLAUDE_PLUGIN_ROOT}/templates/README.md`'s file mapping ships exactly one
`issue-tracker-<tracker>.md` and one `AGENTS-<tracker>.md` template for
each — the Tracker adapter and its `AGENTS.md`, per
`${CLAUDE_PLUGIN_ROOT}/PROTOCOL.md`'s tracker contract. GitLab, local
markdown, and anything else are legitimate answers, but this skill cannot
stamp a template that doesn't exist. If the maintainer picks one of those,
say so plainly and stop: name `docs/agents/issue-tracker.md` as the file
they need to write against the tracker contract (plus an `AGENTS.md` to
match), and do not create the repo, or anything else, in the meantime. Per
the Hard rules below, failing loudly and stopping beats half-creating a repo
with no tracker.

## Derive the Linear project name (Linear only)

Skip this section entirely if the maintainer picked GitHub above —
`{{REPO}}` is derived from the repo Build step 2 creates, not from anything
confirmed here.

Title-case `<name>` by splitting on hyphens and capitalizing each word:
`my-app` → `My App`. Show the maintainer the derived name and ask them to
confirm or override it — one question, not an interrogation. Use their
answer as `{{PROJECT_NAME}}` for the rest of this skill. Asking this
question is not a change to anything, so it's fine to do before the check
below.

Once the name is confirmed, check that no Linear project named
`{{PROJECT_NAME}}` already exists on the Side projects team — call
`list_projects` (filter to team "Side projects") before creating anything.
Stop if found. This is what makes re-running `/factory-new` on a name that
already has a project safe, even if the maintainer overrides the derived
name: no filesystem, git, GitHub, or Linear change happens until this check,
and every Preflight check above it, has passed.

## Build, in this order

The order matters, and it now differs by tracker. On Linear, the project is
an entity independent of the GitHub repo: it must exist before the stamp can
record its URL, and the stamp must exist before the initial commit. On
GitHub there is no separate project — the repo *is* the tracker — but the
repo must exist earlier than that, because GitHub labels are scoped to the
repo, and `{{REPO}}` isn't known until the repo exists, and both
`issue-tracker-github.md` and `AGENTS-github.md` need it before the stamp
can be applied. Steps 1, 4, 5, and 7 are the same regardless of tracker;
steps 2, 3, and 6 branch.

1. **Local repo**: `mkdir ~/apps/<name>`, then `git init -b main`.

2. **Create the tracker entity**:
   - **Linear**: `save_project` with `name: {{PROJECT_NAME}}`,
     `addTeams: ["Side projects"]`. Capture the returned project URL as
     `{{LINEAR_PROJECT_URL}}`. `{{TEAM_NAME}}` is `Side projects`,
     `{{TEAM_KEY}}` is `SIDEPRO` — both fixed, per
     ${CLAUDE_PLUGIN_ROOT}/PROTOCOL.md.
   - **GitHub**: the repo must exist now — before any label (GitHub labels
     are repo-scoped) and before the stamp (`{{REPO}}` is one of its
     placeholders). Create it without pushing, since there's no commit yet
     to push: `gh repo create <name> --private` (omit `--source` and
     `--push` — both assume a commit that doesn't exist yet). Capture
     `{{REPO}}` with `gh repo view <name> --json nameWithOwner -q
     .nameWithOwner` (e.g. `pedrosousa13/my-app`). Wire it as `origin`
     yourself, over SSH — `gh repo create` without `--source` never touches
     the local repo, so nothing is wired until you do it:
     `git remote add origin git@github.com:{{REPO}}.git`. Nothing is pushed
     yet; step 6 below does that once there's a commit.

3. **Labels**:
   - **Linear**: call `list_issue_labels` for the Side projects team first.
     Compare against the eight required team labels — the five triage states
     (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`,
     `wontfix`) and the three categories (`Feature`, `Improvement`, `Bug`) —
     and call `create_issue_label` only for names not already present. Never
     create a label you haven't first confirmed is missing.
   - **GitHub**: call `gh label list -R {{REPO}}` first. Compare against
     thirteen repo labels — the same eight, plus `in-progress` and
     `P0`–`P3`, which exist only because GitHub issues have no started
     state and no priority field, and must never be created on Linear,
     which has both as native fields — and call `gh label create -R
     {{REPO}} <name>` only for names not already present. Never create a
     label you haven't first confirmed is missing.

4. **Apply the stamp**: for each row in
   `${CLAUDE_PLUGIN_ROOT}/templates/README.md`'s file mapping that matches
   the chosen tracker, copy the template into the new repo at its mapped
   destination, substituting whichever placeholders that template uses
   (`${CLAUDE_PLUGIN_ROOT}/templates/README.md`'s placeholder table) —
   `{{PROJECT_NAME}}`, `{{LINEAR_PROJECT_URL}}`, `{{TEAM_NAME}}`,
   `{{TEAM_KEY}}` on Linear; `{{REPO}}` on GitHub. Copy only the one
   `AGENTS-<tracker>.md` and the one `issue-tracker-<tracker>.md` template
   matching the tracker chosen above — never both. Note:
   `${CLAUDE_PLUGIN_ROOT}/templates/stamp/gitignore` has no leading dot
   in the templates tree on purpose — write its contents to `.gitignore` in
   the new repo, not `gitignore`. Domain docs (`CONTEXT.md`, `docs/adr/`) are
   created lazily by later work, not by this skill — do not create them here.

5. **Initial commit**: stage everything and commit. No AI attribution in the
   message.

6. **Finalize the remote**:
   - **Linear**: `gh repo create <name> --private --source=. --remote=origin
     --push`. The Linear project already exists independently of the repo
     (step 2), so nothing here needed the repo any earlier; this one call
     creates the GitHub repo and pushes the commit from step 5 together.
   - **GitHub**: `git push -u origin main`. The repo and `origin` already
     exist, wired in step 2; this is the first push, now that step 5 has
     given it something to push.

7. **Verify the remote and the stamp**: confirm the `origin` remote is SSH
   (`git@github.com:...`), matching how `gh` is authenticated — not an
   `https://` URL. If it came out as `https://`, correct it with
   `git remote set-url origin git@github.com:<owner>/<name>.git` and
   re-verify. If it still isn't SSH after that, stop and report rather than
   continuing the build. Then confirm `docs/agents/issue-tracker.md` exists
   at the repo root, then run `grep -rn '{{' . --exclude-dir=.git` from the
   repo root. It must return nothing — any hit is a placeholder the stamp
   failed to substitute, which means stopping and fixing it, not
   continuing. Scan
   the whole tree rather than a file list, so a template added later can't
   slip through unchecked. `docs/agents/issue-tracker.md`'s existence is
   exactly what `/factory` and `/factory-adopt` check to decide a repo is
   stamped, so this file matters more than the others.

## End state: start a Planning Session

Once the build steps above are verified, stop building and start a Planning
Session — for `{{PROJECT_NAME}}` on Linear, for `<name>` on GitHub (there is
no separate project name to derive): grilling the maintainer's idea, then a
PRD, then slicing it into issues filed to this Project's tracker as
`ready-for-agent`. Say plainly that `/factory-new` itself has created zero
issues — the Planning Session is the only place work gets created. Apply
`${CLAUDE_PLUGIN_ROOT}/PROTOCOL.md`'s "Security sweeps" convention from the
first issues onward: propose the attack-surface test's outcome to the
maintainer, and if the Project passes it, each milestone's slice includes
its security-sweep issue, wired blocked-by. Tell the maintainer that once
the Queue has issues, their next command is `/factory`.

## Hard rules

- Fail loudly and stop rather than half-create anything. A failed preflight
  check means no repo, no project, no labels, no commit — nothing.
- Never create a second Linear project for a name that already has one
  (Linear branch only — GitHub has no separate project entity to duplicate).
- Templates under `${CLAUDE_PLUGIN_ROOT}/templates/stamp/` are the only source of stamp content.
  Never hand-write AGENTS.md, docs/agents/ files, or .gitignore inline.
- No AI attribution anywhere — not in commits, not in the PR (there is no PR
  here, but the rule still applies to the initial commit), not in the repo.
- Domain docs (`CONTEXT.md`, `docs/adr/`) are created lazily by later work
  (`/domain-modeling`), never by this skill.
- This skill creates zero issues, on either tracker. Full stop.

## Cleanup / throwaway

A throwaway repo created to demo this skill cannot be fully torn down by the
agent. `gh repo delete` requires the `delete_repo` OAuth scope, which the
current `gh` token does not have — deleting the GitHub repo needs the
maintainer, done manually, on either tracker. On Linear there's a second
entity to consider: the Linear MCP surface has no delete-project tool
either; `save_project` can set a project's `state` to cancel it, but cannot
delete it. Tearing down a throwaway is therefore a manual, maintainer-driven
step, not something this skill automates. This is a known limitation, not a
bug to work around.
