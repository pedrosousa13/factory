# Tracker phrasebook: local markdown

Factory asks in neutral words; this file says how THIS tracker expresses each one; the
agent brings its own file tools.

## Identity

- a ticket = a file `tracker/tickets/<id>.md`; its id = the filename stem (e.g. `T-1`)
- reachable = the `tracker/tickets/` directory exists and is readable

## Translations

| Factory says       | local markdown says                                                    |
| ------------------- | ----------------------------------------------------------------------- |
| claimed by X        | frontmatter `claimedBy: X`                                              |
| unclaimed           | frontmatter `claimedBy: null`                                           |
| release a claim     | set `claimedBy: null` — its own act, not implied by any state change    |
| ready               | frontmatter `ready: true`                                               |
| urgency P0..P3      | frontmatter `urgency: P0`..`urgency: P3`; `urgency: none` for none      |
| unstarted           | frontmatter `state: unstarted`                                          |
| started             | frontmatter `state: started`                                            |
| parked              | frontmatter `state: parked`                                             |
| done                | frontmatter `state: done`                                               |
| canceled            | frontmatter `state: canceled`                                           |
| milestone           | frontmatter `milestone:` field                                          |
| blocked by          | frontmatter `blockedBy:` list of ids; blocking while any listed ticket's own file has `state` not in done/canceled |
| queue order         | P0 > P1 > P2 > P3 > none, ties oldest `createdAt` first                 |
| a comment           | appended text at the end of the ticket's body, under the ticket's own heading |
| milestone list      | the distinct `milestone` values across all ticket files, in first-seen order across `tracker/tickets/` sorted by filename |
| a ticket's body     | the markdown text below the frontmatter's closing `---`                |

## Warnings (the tracker's sharp edges, still command-free)

- re-read a ticket's file before acting on a listing made earlier — another actor may
  have edited it since
- edit only the frontmatter field the act names; leave everything else, including field
  order, formatting, and the body, byte-identical
- `blockedBy` blocking status is derived, not stored on the blocker: re-check each listed
  id's own `state` field rather than trusting a cached view
- a claim and a state change are separate acts: claiming a ticket does not set
  `state: started` on its own, and finishing work does not clear `claimedBy` on its own
