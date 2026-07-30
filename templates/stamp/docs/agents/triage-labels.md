# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

These exist as {{LABEL_SCOPE}}.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

## Category labels

Alongside its state label, every issue gets exactly one category label. These also exist as {{LABEL_SCOPE}}:

| Label         | Meaning                              |
| ------------- | ------------------------------------ |
| `Feature`     | New capability                       |
| `Improvement` | Enhancement to existing behavior     |
| `Bug`         | Something is wrong                   |

Use these exact names — not `enhancement`, not lowercase `bug`.

## Priority

Queue order is part of the tracker contract, not the triage vocabulary. A
tracker with a native priority field uses it; one without defines a label
vocabulary to supply the ordering instead — in which case those labels form a
fourth axis alongside category, state, and milestone, and are created
alongside the canonical labels above. Which case this Project is in, and the
exact vocabulary if it needs one, is in `docs/agents/issue-tracker.md`.

## Milestones

Alongside its category and state labels, every open issue also carries
exactly one milestone — a third axis, and never a label: a field the tracker
carries natively. How this Project's tracker lists milestones and sets one on
an issue is in `docs/agents/issue-tracker.md`. Per-axis, exactly like the two
above: assigning a milestone must not disturb the category label, the state
label, or this Project's own domain labels.

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
