# Tracker phrasebook: GitHub

Factory asks in neutral words; this file says how THIS tracker expresses each one; the
agent brings its own tools.

## Identity

- a ticket = an issue on `<owner>/<repo>`; its id = the issue number
- reachable = the repo is visible and the agent is authenticated against it

## Translations

| Factory says       | GitHub says                                                          |
| ------------------- | --------------------------------------------------------------------- |
| claimed by X        | the issue's assignee is X                                             |
| unclaimed           | the issue has no assignee                                             |
| ready               | carries the `ready-for-agent` label                                   |
| urgency P0..P3      | labels `P0`..`P3`; no label = none                                    |
| unstarted           | open, `ready-for-agent`, no `in-progress` label                       |
| started             | carries the `in-progress` label                                      |
| parked              | `ready-for-agent` swapped for `needs-info`, claim released            |
| done                | closed as completed                                                  |
| canceled            | closed as not planned                                                |
| milestone           | the issue's milestone field                                           |
| blocked by          | a `Blocked by #N` line in the issue body; blocking while #N is open   |
| queue order         | P0 > P1 > P2 > P3 > none, ties oldest createdAt first                  |
| a comment           | a comment on the issue's timeline, appended in order                 |
| milestone list      | the repo's open milestones, in their configured (stable) order        |
| a ticket's body     | the issue's description                                              |

## Warnings (the tracker's sharp edges, still command-free)

- listings lag writes: confirm any candidate's claim/state on the ticket itself before
  acting on it
- listings are capped by default: ask for enough results that nothing is silently
  dropped
- "started" is a label, not a native state: treat label + assignee together as the claim
- closing an issue does not distinguish done from canceled on its own: the state reason
  (completed vs. not planned) carries that distinction
