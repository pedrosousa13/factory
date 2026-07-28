# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

**The label set is tracker-dependent.** The eight labels on this page's first
two tables — five triage states plus three categories — are universal: every
Project carries them whatever its tracker. Anything below them exists only on
trackers that need it, and is spelled out as such.

These labels live wherever this repo's tracker scopes labels — a team, an
organization, the repo itself. `docs/agents/issue-tracker.md` names the
tracker, and so the scope.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

## Category labels

Alongside its state label, every issue gets exactly one category label. These are scoped the same way as the state labels above:

| Label         | Meaning                              |
| ------------- | ------------------------------------ |
| `Feature`     | New capability                       |
| `Improvement` | Enhancement to existing behavior     |
| `Bug`         | Something is wrong                   |

Use these exact names — not `enhancement`, not lowercase `bug`.

## Labels that stand in for a missing field

The eight labels above are universal. Two further groups exist **only** where
the tracker has no native field for what they express — which is to say on
GitHub, whose issues have no started state and no priority. Where the tracker
does carry those as fields, these labels must not be created: the field is the
source of truth, and a label beside it is a second, unenforced one.

`docs/agents/issue-tracker.md` says which case this repo is in. If it names a
tracker with native state and priority fields, ignore the rest of this
section.

**Started state.** One label, orthogonal to everything above — it is not a
triage state, and an issue carrying it still carries exactly one of the five:

| Label         | Meaning                                            |
| ------------- | -------------------------------------------------- |
| `in-progress` | A session has picked this issue up and is on it    |

**Priority.** Exactly one per issue, and what makes the Queue's order
deterministic. Highest first; an issue with none sorts last:

| Label | Priority |
| ----- | -------- |
| `P0`  | Urgent   |
| `P1`  | High     |
| `P2`  | Medium   |
| `P3`  | Low      |

"Exactly one" is the invariant, not a guarantee — nothing enforces it when
priority is a label. `docs/agents/issue-tracker.md` carries the resolution
rule for an issue that ends up carrying two.

## Milestones

Alongside its category and state labels, every open issue also carries
exactly one milestone — a third axis, and never a triage label: a tracker
field, or whatever that tracker offers in its place.
`docs/agents/issue-tracker.md` names the mechanism. Per-axis, exactly like
the two above: assigning a milestone must not disturb the category label,
the state label, or this Project's own domain labels.

If this Project has no milestones defined yet, the invariant doesn't apply
until they exist — milestone names are a maintainer decision, made once, not
invented by an agent sweep.

The maintainer may decline a milestone for a specific issue. That decision is
recorded as a comment on the issue carrying this exact line:

**Milestone: declined by the maintainer.**

An issue carrying that line is left alone rather than re-proposed. Detection
is that line and nothing else — a comment merely discussing milestones is not
a decline. If the record is ambiguous or absent, treat the issue as **not**
declined and propose a milestone again: re-asking costs one approval, while
wrongly inferring a decline drops an issue out of the invariant silently and
permanently.
