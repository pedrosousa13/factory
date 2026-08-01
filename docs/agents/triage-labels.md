# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

These exist as team labels on the **Side projects** team in Linear.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

## Category labels

Alongside its state label, every issue gets exactly one category label. These also exist as team labels on **Side projects**:

| Label         | Meaning                              |
| ------------- | ------------------------------------ |
| `Feature`     | New capability                       |
| `Improvement` | Enhancement to existing behavior     |
| `Bug`         | Something is wrong                   |

Use these exact names — not `enhancement`, not lowercase `bug`.

## Wayfinder labels

The `/wayfinder` skill charts planning maps on this tracker: a map issue
labeled `wayfinder:map`, and decision tickets labeled `wayfinder:research`,
`wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`. These also
exist as team labels on **Side projects**, created lazily the first time a
map is charted here.

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

## Security sweeps

`PROTOCOL.md` defines the security-sweep issue and says when a milestone
carries one. The two label rules a sweep follows are here.

A sweep skips every issue in the reserved planning namespace above. A
wayfinder map or a PRD never touches the attack surface, so a sweep never
treats one as though it did.

Findings a sweep files are ordinary issues labeled `needs-triage`, never
planning artifacts. A sweep never mints a `wayfinder:` or `planning:`
label.
