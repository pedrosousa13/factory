# Factory v1 workflow baseline

Status: baseline for [Chart harness-neutral Factory v2](https://github.com/pedrosousa13/factory/issues/24)

Audit date: 2026-07-31
Source revision: `8026043` (`main`)
Research ticket: [Audit the current Factory workflow and establish its baseline](https://github.com/pedrosousa13/factory/issues/25)

## Purpose

This note records the Factory v1 behavior that Factory v2 must preserve or correct. It also defines initial characterization scenarios.

The audit uses these primary sources:

- The protocol, which declares itself the source of truth ([PROTOCOL.md:1-9](../../PROTOCOL.md#L1-L9)).
- The three shipped skills in `skills/`.
- The stamp templates in `templates/stamp/`.
- The Factory glossary and ADR ([CONTEXT.md](../../CONTEXT.md), [ADR-0001](../adr/0001-interactive-loop-session.md)).
- The active GitHub map and its child tickets.
- Direct checks of the repository, GitHub, `gh`, and installed skill paths.

No executable runtime, test suite, package manifest, or CI workflow exists in this revision. Factory v1 is a set of Claude Code instructions and templates.

## Current workflow

### Control model

A maintainer starts one interactive Loop Session. The session works through the Queue until the Queue is empty or the Context Budget is spent. ADR-0001 chooses this model so a maintainer can answer a question while the session keeps its context ([ADR-0001](../adr/0001-interactive-loop-session.md)).

The Queue is the only work source. The session must not create work when the Queue is empty ([PROTOCOL.md:165-218](../../PROTOCOL.md#L165-L218)). Planning creates work in separate interactive sessions ([README.md:7-23](../../README.md#L7-L23)).

The current implementation relies on an agent to interpret Markdown. No program validates transitions, locks a Queue item, writes a journal, or enforces invariants.

### Installation and Preflight

Factory v1 ships only as a Claude Code plugin. The package contains a Claude marketplace manifest, a plugin manifest, and Claude skill files ([`.claude-plugin/marketplace.json`](../../.claude-plugin/marketplace.json), [`.claude-plugin/plugin.json`](../../.claude-plugin/plugin.json)).

Preflight checks the tracker, `gh`, four skills, two Superpowers skills, and stale Claude skill symlinks. It runs all checks and reports all failures before it stops ([PROTOCOL.md:11-68](../../PROTOCOL.md#L11-L68)).

The current machine has Superpowers but does not have `~/.claude/skills/review`. Thus, a conforming v1 Loop Session must stop during Preflight on this machine. No published Factory copy was present in the Claude plugin cache during this audit.

### Project stamp

A Project has one tracker adapter in `docs/agents/issue-tracker.md`. The protocol defines required tracker operations. The adapter defines tracker-specific commands ([PROTOCOL.md:86-120](../../PROTOCOL.md#L86-L120)).

The stamp also defines labels, milestones, agent docs, scratch storage, and a GitHub remote. The protocol requires a private GitHub remote over SSH ([PROTOCOL.md:560-575](../../PROTOCOL.md#L560-L575)).

`/factory-new` creates a local repository, a tracker, labels, a stamp, an initial commit, and a private GitHub remote. It creates no issues. It then starts a Planning Session ([skills/factory-new/SKILL.md:92-203](../../skills/factory-new/SKILL.md#L92-L203)).

`/factory-adopt` detects a tracker, merges the stamp without overwriting existing content, and triages open work in approved batches. A second run must make no changes ([skills/factory-adopt/SKILL.md:41-318](../../skills/factory-adopt/SKILL.md#L41-L318)).

### Session start and Queue selection

Session start uses this order:

1. Inspect the working tree and the Pause note.
2. Resume a verified interrupted issue before any Handoff work.
3. Consume the newest Handoff after the resumed issue reaches a boundary.
4. Ask for a Queue scope when milestones exist.
5. Start Queue selection.

The source defines this order in [PROTOCOL.md:123-158](../../PROTOCOL.md#L123-L158).

Queue selection applies these rules:

1. Keep open, unstarted issues with `ready-for-agent`.
2. Apply the Queue scope.
3. Sort by priority, then by oldest creation time.
4. Check blockers in that order.
5. Pick the first unblocked issue.

A specific milestone scope also includes issues without a milestone. This fail-open rule prevents unassigned work from becoming stranded ([PROTOCOL.md:165-186](../../PROTOCOL.md#L165-L186)).

An empty scoped Queue reports actual milestone progress and open issue counts. It does not report that the milestone is complete ([PROTOCOL.md:187-218](../../PROTOCOL.md#L187-L218)).

### Pickup, implementation, and landing

Pickup assigns the issue, moves it to a started state, comments with the branch, and writes a Pause note ([PROTOCOL.md:223-232](../../PROTOCOL.md#L223-L232)).

A branch starts from the latest default branch. Superpowers TDD subagents implement all work except a one-line change. The issue body and comments form the implementation brief ([PROTOCOL.md:233-250](../../PROTOCOL.md#L233-L250)).

The landing gate requires available tests, available type checks, and a Standards plus Spec review. The session then creates and merges a pull request, completes the issue, and removes the Pause note ([PROTOCOL.md:252-274](../../PROTOCOL.md#L252-L274)).

### Questions and recovery

A maintainer-only question sends a push notification and starts a background 15-minute timer. An answer refreshes the Pause note. No answer causes a Park ([PROTOCOL.md:290-329](../../PROTOCOL.md#L290-L329)).

Park commits and pushes the branch. It posts the question, changes tracker state and labels, removes the Pause note, and returns to Queue selection.

The Pause note stores one in-progress issue in `.scratch/pause-note.md`. A new session must verify it against Git and the tracker before it resumes work ([PROTOCOL.md:336-392](../../PROTOCOL.md#L336-L392)).

A Handoff stores boundary-only context in `.scratch/handoffs/`. The next session consumes it once and moves it to an archive ([PROTOCOL.md:394-417](../../PROTOCOL.md#L394-L417)).

Both recovery files are under `.scratch/`, which the stamp ignores in Git. They survive a local session restart but not a clean clone or another machine.

### Planning and governance

Wayfinder maps and tickets are planning artifacts. They have `wayfinder:*` labels and never enter the Queue ([PROTOCOL.md:476-498](../../PROTOCOL.md#L476-L498)).

Adoption skips these artifacts. It does not add category, state, priority, or milestone data to them ([skills/factory-adopt/SKILL.md:321-345](../../skills/factory-adopt/SKILL.md#L321-L345)).

Every normal open issue has one category, one triage state, and one milestone when milestones exist. GitHub issues also have one priority label ([skills/factory-adopt/SKILL.md:332-402](../../skills/factory-adopt/SKILL.md#L332-L402)).

Projects with an attack surface get one OWASP sweep issue for each applicable milestone. The maintainer can record a durable decline ([PROTOCOL.md:500-557](../../PROTOCOL.md#L500-L557)).

## Behavior to preserve

| ID | Behavior | Reason and source |
| --- | --- | --- |
| P01 | Keep planning separate from execution. | The Queue contains approved work only. An empty Queue never creates work ([PROTOCOL.md:165-218](../../PROTOCOL.md#L165-L218)). |
| P02 | Keep one tracker per Project behind a tracker adapter. | The protocol defines capabilities, not tracker commands ([PROTOCOL.md:86-120](../../PROTOCOL.md#L86-L120)). |
| P03 | Keep deterministic Queue order. | Priority sorts first. Creation time breaks ties. Blockers are checked in that order. |
| P04 | Keep fail-open milestone scope. | A milestone scope includes work without a milestone ([PROTOCOL.md:179-181](../../PROTOCOL.md#L179-L181)). |
| P05 | Keep explicit tracker state mirroring. | Pickup, Park, completion, and cancellation must have durable tracker state. |
| P06 | Keep one branch and pull request per issue. | Parked work stays off the default branch. The landing gate protects the default branch. |
| P07 | Keep test, type-check, and review gates where applicable. | These checks define landing readiness ([PROTOCOL.md:252-266](../../PROTOCOL.md#L252-L266)). |
| P08 | Keep fail-safe maintainer questions. | The session must not guess when only the maintainer can decide. |
| P09 | Keep resumable local recovery. | A verified Pause note resumes interrupted work. A Handoff transfers boundary context. |
| P10 | Keep planning artifacts outside triage and the Queue. | Maps, PRDs, and decision tickets must not become implementation work. |
| P11 | Keep non-destructive Adoption. | Adoption checks first, reports changes, requires batch approval, and preserves Project labels. |
| P12 | Keep new-Project and Adoption flows idempotent. | Repeat use must not duplicate repositories, tracker entities, labels, or stamp content. |
| P13 | Keep domain docs and ADRs as durable vocabulary and decisions. | The stamp tells agents to use these files before code exploration. |
| P14 | Keep milestone and security-sweep governance. | Planning and Adoption must enforce the same issue invariants. |
| P15 | Keep Git and the tracker as durable truth. | Local state can help recovery but cannot replace these systems. This is also an accepted v2 map constraint. |

## Behavior to correct

### C01: The Factory Project names the wrong active tracker

The committed adapter and `AGENTS.md` say that Factory issues live in Linear ([docs/agents/issue-tracker.md:1-8](../agents/issue-tracker.md#L1-L8), [AGENTS.md:5-13](../../AGENTS.md#L5-L13)). The active map and ticket are GitHub issues. The repository has a complete GitHub adapter template but does not use it for itself.

This contradiction caused an agent to stop when Linear tools were unavailable, although the requested ticket was reachable through GitHub. Factory v2 must use explicit Project settings and must validate them against active tracker artifacts.

### C02: GitHub milestone scoping violates the protocol

The protocol includes no-milestone issues in a selected milestone scope ([PROTOCOL.md:179-181](../../PROTOCOL.md#L179-L181)). The GitHub adapter lists only `--milestone <n-or-title>` for a scoped Queue ([issue-tracker-github.md:44-55](../../templates/stamp/docs/agents/issue-tracker-github.md#L44-L55)). That command excludes issues without a milestone.

The runtime must combine both candidate sets before it sorts and checks blockers.

### C03: GitHub branch identity is not deterministic

The adapter says to trim a title slug to “a few words” ([issue-tracker-github.md:130-138](../../templates/stamp/docs/agents/issue-tracker-github.md#L130-L138)). Different agents can choose different lengths. This conflicts with the requirement that every session derives the same branch.

Factory v2 needs one exact branch-name algorithm or a stored branch identity.

### C04: The SSH stamp invariant is not enforceable through Adoption

The protocol requires an SSH remote ([PROTOCOL.md:568](../../PROTOCOL.md#L568)). Adoption leaves an existing remote unchanged, even when it uses HTTPS ([skills/factory-adopt/SKILL.md:267-281](../../skills/factory-adopt/SKILL.md#L267-L281)). This repository currently uses an HTTPS `origin`.

Factory v2 must either accept HTTPS or require an approved migration. It must not declare both states valid.

### C05: “Fail loudly, change nothing” does not cover partial builds

`/factory-new` promises no change after a failed check ([skills/factory-new/SKILL.md:25-49](../../skills/factory-new/SKILL.md#L25-L49)). After checks pass, the build performs many local and remote side effects. A later failure can leave a directory, repository, tracker project, labels, or commit behind. The cleanup section also states that full rollback can require manual work ([skills/factory-new/SKILL.md:222-232](../../skills/factory-new/SKILL.md#L222-L232)).

Factory v2 must journal each side effect and support resume or explicit cleanup. It must not imply transactionality that it cannot provide.

### C06: GitHub queries silently cap large Projects

The GitHub adapter uses `--limit 500` for Queue, count, and map queries ([issue-tracker-github.md:44-55](../../templates/stamp/docs/agents/issue-tracker-github.md#L44-L55), [issue-tracker-github.md:111-120](../../templates/stamp/docs/agents/issue-tracker-github.md#L111-L120)). A Project with more than 500 matching issues gets incomplete data.

Factory v2 must paginate or report a hard limit before it selects work.

### C07: Recovery state is local and disposable

The Pause note and Handoffs live under the ignored `.scratch/` directory. This works for one local clone. It does not support a new machine, a clean clone, or a different harness host.

Factory v2 must keep the journal disposable. It must also reconstruct authoritative state from Git and the tracker, as the map requires.

### C08: Required services have no executable capability checks

The protocol names “push notification,” mid-turn answers, background timer completion, context usage, subagents, and skill discovery. It does not define interfaces for these capabilities ([PROTOCOL.md:290-303](../../PROTOCOL.md#L290-L303), [PROTOCOL.md:394-417](../../PROTOCOL.md#L394-L417)).

Factory v2 must expose each capability through a harness adapter. It must define fallback behavior when a capability is absent.

### C09: Superpowers is mandatory in v1

Preflight and implementation require two Superpowers skills ([PROTOCOL.md:54-62](../../PROTOCOL.md#L54-L62), [PROTOCOL.md:233-250](../../PROTOCOL.md#L233-L250)). The v2 map makes Superpowers optional and names Matt TDD as the fallback.

Factory v2 must characterize both paths and report which path it selected.

### C10: The protocol has no executable transition or invariant enforcement

Markdown says that pickup is atomic, labels are singular, transitions have an order, and Handoffs are consumed once. Agents execute separate tool calls and filesystem writes. A failure can stop between those calls.

Factory v2 needs an executable state machine with idempotent transition handlers. It must detect and reconcile partially applied transitions.

### C11: Stamp upgrades have no version identity

Adoption compares files to current templates. It recognizes byte matches and sections that appear missing ([skills/factory-adopt/SKILL.md:214-253](../../skills/factory-adopt/SKILL.md#L214-L253)). It cannot identify the installed stamp version or apply an ordered migration.

Factory v2 needs a versioned stamp and an approved, idempotent migration path.

### C12: Tracker contracts mix planning and autonomous execution

The current tracker contract serves Queue work. Wayfinder adds a second optional section for planning. Matt-compatible planning instructions can exist without safe autonomous transition semantics.

Factory v2 must separate planning capabilities from the validated execution contract. This requirement comes from the v2 map.

### C13: Merge policy is fixed and incomplete

The protocol prescribes auto-merge on green or immediate squash merge when no required checks exist ([PROTOCOL.md:260-269](../../PROTOCOL.md#L260-L269)). It does not ask the Project for a merge policy. It also does not define a safe result for protected or ambiguous changes.

Factory v2 must ask during setup and fail safe to human approval.

### C14: Concurrent sessions have no coordinator lease

The current model assumes at most one issue in flight locally. Assignment or a GitHub label acts as a claim, but no owner renews or expires that claim. Worktree isolation and worker limits do not exist.

Factory v2 must add one coordinator lease, bounded workers, and isolated worktrees, as required by the map.

### C15: Root documentation and templates can drift

The stamp templates are the declared source of stamp content ([templates/README.md:1-12](../../templates/README.md#L1-L12)). Factory’s own `docs/agents/triage-labels.md` is an older Linear-specific copy. It lacks the current generic, GitHub, milestone, and security-sweep sections.

Factory v2 must test generated stamps and the self-hosted Project against one versioned schema.

## Portability constraints

| Constraint | Current coupling | v2 boundary |
| --- | --- | --- |
| Distribution | `.claude-plugin` manifests only | Thin Claude Code, Codex, and Pi packages over one runtime |
| Paths | `~/.claude/skills/*` and `${CLAUDE_PLUGIN_ROOT}` | Harness-specific skill discovery and package-root resolution |
| Delegation | Claude and Superpowers skill names | A runtime TDD interface with Superpowers and Matt TDD implementations |
| Tool discovery | Linear MCP names and `ToolSearch` | Tracker adapter initialization and capability validation |
| Interaction | Mid-turn user answers and push notifications | Interactive and headless run modes |
| Timeouts | A background shell `sleep` | A runtime clock and durable deadline state |
| Context | Approximate 40 percent model context | Harness-reported budget or a documented fallback |
| Recovery | Ignored local Markdown files | Disposable journal plus Git and tracker reconciliation |
| GitHub | `gh`, authenticated host state, GitHub-only remote | A Git service boundary, while the first release still targets GitHub remotes |
| Tracker | GitHub CLI or Linear MCP instructions | Separate planning and execution tracker contracts |
| Concurrency | One working tree and one Pause note | Coordinator lease, worker leases, and isolated worktrees |
| Policy | Fixed squash and auto-merge behavior | Project merge policy with human approval fallback |

## Compatibility obligations for Factory v2

The v2 map already fixes these release obligations:

1. One release supports Claude Code, Codex, and Pi.
2. All three adapters use one shared TypeScript runtime.
3. Contract scenarios prove behavioral parity across adapters.
4. GitHub and Linear remain the initial tracker adapters.
5. A Project chooses its tracker and merge policy.
6. Planning works with Matt-compatible tracker instructions.
7. Autonomous execution requires a validated Factory execution contract.
8. Superpowers remains preferred but optional.
9. Matt TDD is the fallback when Superpowers is absent.
10. Interactive empty-Queue runs can offer planning after an explanation.
11. Headless empty-Queue runs report and stop.
12. Git and the tracker remain durable truth.
13. A disposable local journal helps recovery but is not authoritative.
14. One coordinator lease manages bounded workers in isolated worktrees.
15. Protected or ambiguous changes require human approval.
16. Existing Projects use an approved, versioned, idempotent migration.
17. PRDs, maps, and decision tickets never enter the implementation Queue.
18. The final PRD and README compare v1 and v2 behavior against this baseline.

Source: [Chart harness-neutral Factory v2](https://github.com/pedrosousa13/factory/issues/24), Destination and Notes.

## Initial characterization scenarios

These scenarios define the first parity suite. “Preserve” scenarios lock intended v1 behavior. “Correct” scenarios reproduce a known defect first, then define the v2 result.

### Preflight and setup

#### S01 — report all Preflight failures (preserve)

**Given** multiple required capabilities are absent
**When** a run performs Preflight
**Then** it reports every failure and makes no Project change

#### S02 — reject an unstamped Project (preserve)

**Given** the tracker adapter is absent or lacks loop operations
**When** a run starts
**Then** it tells the maintainer to use Adoption and does not select work

#### S03 — create a new Project once (preserve)

**Given** a valid unused Project name and approved settings
**When** setup completes
**Then** one local repository, one remote, one tracker target, one label set, and one stamp exist
**And** setup creates no implementation issue

#### S04 — resume a partial setup (correct)

**Given** setup stopped after a remote side effect
**When** setup starts again
**Then** it detects the journaled side effect and resumes without duplication

#### S05 — migrate a stamp by version (correct)

**Given** a Project has an older supported stamp
**When** the maintainer approves migration
**Then** the ordered migration runs once
**And** a second run makes no change

### Queue selection

#### S06 — select deterministically (preserve)

**Given** several agent-ready issues with different priorities, ages, and blockers
**When** the runtime selects work
**Then** it sorts priority high to low and age old to new
**And** it selects the first unblocked issue

#### S07 — include unassigned work in milestone scope (correct)

**Given** one agent-ready issue in milestone A and one without a milestone
**When** the Queue scope is milestone A
**Then** both issues enter the candidate set before sorting

#### S08 — handle more than 500 candidates (correct)

**Given** more than 500 matching issues
**When** the tracker adapter lists the Queue
**Then** it returns all pages or stops with an explicit limit error

#### S09 — trust a fresh candidate read (preserve)

**Given** a tracker list contains stale state
**When** the runtime considers a candidate
**Then** it reads that issue again and skips it if it is no longer eligible

#### S10 — report an empty scoped Queue accurately (preserve)

**Given** no unblocked agent-ready work remains in the selected milestone
**When** Queue selection ends
**Then** the runtime reports current progress and open-state counts
**And** it does not claim that the milestone is complete

#### S11 — do not invent work (preserve)

**Given** an empty Queue
**When** the run reaches Queue selection
**Then** a headless run reports and stops
**And** an interactive run can offer a separate Planning Session

### Claims and execution

#### S12 — claim once across workers (correct)

**Given** two workers see the same eligible issue
**When** both try to claim it
**Then** only one lease and tracker claim succeeds

#### S13 — derive one branch identity (correct)

**Given** two harnesses claim the same issue at different times
**When** each resolves the branch identity
**Then** both get the same exact branch name

#### S14 — start from the latest default branch (preserve)

**Given** an issue has no existing work branch
**When** implementation starts
**Then** the runtime updates the default branch and creates an isolated worktree branch

#### S15 — select the TDD implementation (correct)

**Given** Superpowers is available
**When** implementation starts
**Then** the runtime selects Superpowers TDD

**Given** Superpowers is unavailable and Matt TDD is available
**When** implementation starts
**Then** the runtime selects Matt TDD without failing Preflight

#### S16 — enforce the landing gate (preserve)

**Given** implementation is complete
**When** any configured test, type check, or review has an unresolved failure
**Then** the runtime does not merge the branch or complete the issue

#### S17 — apply Project merge policy (correct)

**Given** all landing checks pass
**When** policy permits automatic merge
**Then** the runtime merges with the configured method

**Given** policy is absent, protected, or ambiguous
**When** all landing checks pass
**Then** the runtime requests human approval and does not merge

### Questions, Park, and recovery

#### S18 — Park an unanswered question (preserve)

**Given** implementation needs a maintainer decision
**When** the interactive deadline expires without an answer
**Then** the runtime stores branch work, comments the question, and Parks the issue
**And** it continues at the next issue boundary

#### S19 — reconcile an interrupted transition (correct)

**Given** the process stopped after a branch push but before tracker Park state
**When** a new run starts
**Then** the runtime compares the journal, Git, and tracker
**And** it completes or reverses the transition idempotently

#### S20 — recover without the local journal (correct)

**Given** a clean clone has no `.scratch/` files
**And** Git and the tracker show an in-progress issue and branch
**When** a run starts
**Then** it reconstructs the issue state or asks for a decision
**And** it does not start unrelated work

#### S21 — consume a Handoff once (preserve)

**Given** a verified Handoff exists at an issue boundary
**When** a new run consumes it
**Then** later Queue iterations do not consume it again

### Planning, Adoption, and parity

#### S22 — exclude planning artifacts (preserve)

**Given** open maps, PRDs, or decision tickets share the tracker
**When** triage or Queue selection runs
**Then** none receives implementation labels or enters the Queue

#### S23 — preserve Project content during Adoption (preserve)

**Given** a Project has custom agent docs and domain labels
**When** Adoption proposes a stamp and triage batch
**Then** it shows conflicts and changes before it writes
**And** it changes only approved content

#### S24 — separate tracker capability levels (correct)

**Given** a tracker supports issue creation but not atomic claims
**When** planning validates the tracker
**Then** planning can continue

**When** autonomous execution validates the same tracker
**Then** execution stops with the missing capability

#### S25 — prove harness parity (correct)

**Given** the same Project fixture and adapter contract
**When** Claude Code, Codex, and Pi run each contract scenario
**Then** they produce the same runtime transitions and durable artifacts

## Comparison axes for the final deliverable

The final v1-to-v2 comparison must use these axes:

1. Distribution and installation.
2. Protocol ownership and executable enforcement.
3. Interactive and headless operation.
4. Queue selection and tracker parity.
5. Claims, leases, concurrency, and worktree isolation.
6. TDD and review delegation.
7. Notifications, questions, and Park behavior.
8. Recovery and durable truth.
9. Setup, Adoption, settings, and stamp migration.
10. Merge policy and protected changes.
11. Planning-artifact isolation.
12. Tests, contract scenarios, and release gates.
