---
name: factory-new
description: Bootstrap a brand-new Factory Project end-to-end — repo under ~/apps/<name>, private GitHub remote, Linear project, full Factory stamp, triage labels — then starts a Planning Session. Use when the user runs /factory-new <name> to start a project from scratch.
---

# /factory-new — bootstrap a Project

You are bootstrapping a new Factory Project. The conventions you are stamping
are specified elsewhere, not here:

**Read `~/apps/factory/PROTOCOL.md`'s "The stamp" table and
`~/apps/factory/templates/README.md` in full before doing anything else.**
`templates/stamp/` is the single source of stamp content. You fill in its
placeholders and write the result — you never hand-write AGENTS.md,
docs/agents/, or .gitignore content yourself. If a placeholder value isn't
known at the point you need it, stop rather than improvise one.

This skill creates exactly one repo, one Linear project, and (where missing)
team labels. It creates zero Linear issues. It ends by moving the maintainer
into a Planning Session — grilling → PRD → issue slices — because that is the
only place new work gets created (see `CONTEXT.md`).

## Preflight — fail loudly, change nothing

Run every check below before touching the filesystem, git, GitHub, or Linear.
The skill makes no changes until every check in this section and the next
one ("Derive the Linear project name") has passed. These are the checks
that don't depend on the confirmed project name; the duplicate-Linear-
project check runs later, once the name is confirmed, so an override can't
slip past it.

1. `<name>` is required. Reject if missing.
2. `<name>` must be kebab-case: lowercase letters, digits, and single hyphens
   between words (`^[a-z0-9]+(-[a-z0-9]+)*$`). Reject anything else — no
   spaces, no underscores, no leading/trailing hyphen, no uppercase.
3. `~/apps/<name>` must not already exist. Stop if it does.
4. `gh auth status` must report a clean, authenticated state. Stop otherwise.

If any check fails, report exactly which one and stop. Do not partially
proceed.

## Derive the Linear project name

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

The order matters: the Linear project must exist before the stamp can record
its URL, and the stamp must exist before the initial commit.

1. **Local repo**: `mkdir ~/apps/<name>`, then `git init -b main`.

2. **Linear project**: `save_project` with `name: {{PROJECT_NAME}}`,
   `addTeams: ["Side projects"]`. Capture the returned project URL as
   `{{LINEAR_PROJECT_URL}}`. `{{TEAM_NAME}}` is `Side projects`, `{{TEAM_KEY}}`
   is `SIDEPRO` — both fixed, per PROTOCOL.md.

3. **Labels**: call `list_issue_labels` for the Side projects team first.
   Compare against the eight required team labels — the five triage states
   (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`,
   `wontfix`) and the three categories (`Feature`, `Improvement`, `Bug`) —
   and call `create_issue_label` only for names not already present. Never
   create a label you haven't first confirmed is missing.

4. **Apply the stamp**: for each row in `templates/README.md`'s file mapping,
   copy the template into the new repo at its mapped destination, substituting
   `{{PROJECT_NAME}}`, `{{LINEAR_PROJECT_URL}}`, `{{TEAM_NAME}}`, `{{TEAM_KEY}}`
   wherever they appear. Note: `templates/stamp/gitignore` has no leading dot
   in the templates tree on purpose — write its contents to `.gitignore` in
   the new repo, not `gitignore`. Domain docs (`CONTEXT.md`, `docs/adr/`) are
   created lazily by later work, not by this skill — do not create them here.

5. **Initial commit**: stage everything and commit. No AI attribution in the
   message.

6. **GitHub remote**: `gh repo create <name> --private --source=. --remote=origin --push`.
   Confirm afterwards that the `origin` remote is SSH (`git@github.com:...`),
   matching how `gh` is authenticated — not an `https://` URL. If it came
   out as `https://`, correct it with
   `git remote set-url origin git@github.com:<owner>/<name>.git` and
   re-verify. If it still isn't SSH after that, stop and report rather than
   continuing the build.

7. **Verify the stamp**: confirm `docs/agents/issue-tracker.md` exists at the
   repo root, then run `grep -rn '{{' . --exclude-dir=.git` from the repo
   root. It must return nothing — any hit is a placeholder the stamp failed
   to substitute, which means stopping and fixing it, not continuing. Scan
   the whole tree rather than a file list, so a template added later can't
   slip through unchecked. `docs/agents/issue-tracker.md`'s existence is
   exactly what `/factory` and `/factory-adopt` check to decide a repo is
   stamped, so this file matters more than the others.

## End state: start a Planning Session

Once the build steps above are verified, stop building and start a Planning
Session for `{{PROJECT_NAME}}`: grilling the maintainer's idea, then a PRD,
then slicing it into issues filed to the new Linear project as
`ready-for-agent`. Say plainly that `/factory-new` itself has created zero
issues — the Planning Session is the only place work gets created. Tell the
maintainer that once the Queue has issues, their next command is `/factory`.

## Hard rules

- Fail loudly and stop rather than half-create anything. A failed preflight
  check means no repo, no project, no labels, no commit — nothing.
- Never create a second Linear project for a name that already has one.
- Templates under `templates/stamp/` are the only source of stamp content.
  Never hand-write AGENTS.md, docs/agents/ files, or .gitignore inline.
- No AI attribution anywhere — not in commits, not in the PR (there is no PR
  here, but the rule still applies to the initial commit), not in the repo.
- Domain docs (`CONTEXT.md`, `docs/adr/`) are created lazily by later work
  (`/domain-modeling`), never by this skill.
- This skill creates zero Linear issues. Full stop.

## Cleanup / throwaway

A throwaway repo created to demo this skill cannot be fully torn down by the
agent. `gh repo delete` requires the `delete_repo` OAuth scope, which the
current `gh` token does not have — deleting the GitHub repo needs the
maintainer, done manually. The Linear MCP surface has no delete-project tool
either; `save_project` can set a project's `state` to cancel it, but cannot
delete it. Tearing down a throwaway is therefore a manual, maintainer-driven
step, not something this skill automates. This is a known limitation, not a
bug to work around.
