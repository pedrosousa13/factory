# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

**The label set is tracker-dependent.** The eight labels on this page's first
two tables — five triage states plus three categories — are universal: every
Project carries them whatever its tracker, created at stamp time. The
wayfinder labels below apply on every tracker too, but are created lazily,
not at stamp time. Everything after them exists only on trackers that need
it, and is spelled out as such.

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

## Wayfinder labels

The `/wayfinder` skill charts planning maps on this tracker: a map issue
labeled `wayfinder:map`, and decision tickets labeled `wayfinder:research`,
`wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`. These are
scoped the same way as the state labels above, created lazily the first
time a map is charted here.

An issue carrying any `wayfinder:*` label is a **planning artifact, not a
work item**: it sits outside the triage state machine, carries no state
label, no category label, and no milestone, and a triage sweep skips it
entirely rather than bringing it up to the invariant. It never carries
`ready-for-agent`, so it can never enter a Loop Session's Queue. How this
tracker expresses the map, its tickets, blocking, and the frontier is in
`docs/agents/issue-tracker.md`, under "Wayfinding operations".

The reserved planning namespace is every label that starts with
`wayfinder:` or `planning:`. Today that is `wayfinder:map`,
`wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`,
`wayfinder:task`, and `planning:prd`. The match is on the prefix, so a new
artifact kind inherits the exclusion by naming itself in the namespace.

## Labels that stand in for a missing field

The eight labels in the first two tables are universal. Two further groups exist **only** where
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

## Security sweeps

`PROTOCOL.md` defines the security-sweep issue and says when a milestone
carries one. The two label rules a sweep follows are here.

A sweep skips every issue in the reserved planning namespace above. A
wayfinder map or a PRD never touches the attack surface, so a sweep never
treats one as though it did.

Findings a sweep files are ordinary issues labeled `needs-triage`, never
planning artifacts. A sweep never mints a `wayfinder:` or `planning:`
label.
