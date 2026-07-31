# Harness integration capabilities

Status: research input for [Chart harness-neutral Factory v2](https://github.com/pedrosousa13/factory/issues/24)

Audit date: 2026-07-31
Research ticket: [Research Claude Code, Codex, and Pi integration capabilities](https://github.com/pedrosousa13/factory/issues/30)

Harness revisions examined:

| Harness | Revision | Evidence |
| --- | --- | --- |
| Claude Code | Documentation as published on 2026-07-31. Version markers in the docs reach v2.1.219. | [code.claude.com/docs](https://code.claude.com/docs/en/overview) |
| Codex | `rust-v0.146.0`, released 2026-07-29. Local binary reports `codex-cli 0.145.0` (observed). | [openai/codex releases](https://github.com/openai/codex/releases) |
| Pi | `@earendil-works/pi-coding-agent` 0.83.0, published 2026-07-29. Local binary reports `0.83.0` (observed). | [earendil-works/pi](https://github.com/earendil-works/pi) |

## Purpose

Factory v2 ships one shared TypeScript runtime with three harness adapters. The baseline records that the v1 protocol names required services but defines no interface for them, and that Factory v2 must expose each service through a harness adapter with a defined fallback ([factory-v2-baseline C08](./factory-v2-baseline.md)). This note establishes what each harness actually provides.

The audit uses these primary sources:

- Claude Code and the Claude Agent SDK: [code.claude.com/docs](https://code.claude.com/docs/en/overview).
- Codex: [developers.openai.com/codex](https://developers.openai.com/codex/cli) and the [openai/codex](https://github.com/openai/codex) repository. The repository `docs/*.md` files are now stubs that redirect to the hosted documentation.
- Pi: the [earendil-works/pi](https://github.com/earendil-works/pi) repository, the `docs/` directory shipped inside the npm package, and the package manifest.
- Direct checks of the local Claude Code, Codex, and Pi installations on the audit machine.

Every claim below carries a link to the source that owns it. Where a capability exists in a local installation but no vendor document describes it, the note marks it **observed-only**. Factory must not depend on observed-only behavior.

## What the runtime needs

The runtime prototype is a pure reducer. It performs no I/O and reads no clock. Hosts perform effects and return results as `ok` or `err` events ([prototype/runtime-state-machine](https://github.com/pedrosousa13/factory/tree/prototype/runtime-state-machine)). The `Effect` union therefore defines the adapter contract. These effects need harness capabilities rather than plain shell access:

| Effect | Capability it needs |
| --- | --- |
| `host.preflight` | Skill and plugin enumeration, plus an existence check |
| `host.ask` | A mid-run maintainer question with a deadline |
| `host.approval` | A mid-run maintainer decision |
| `host.report`, `host.offerPlanning` | Interactive and headless output |
| `agent.implement`, `agent.check` | Subagent dispatch that returns a closed variant, never prose |
| `tick` | A clock and a durable deadline |
| everything else | Subprocess execution under a permission model |

`agent.implement` returns `ImplementResult`, which is `done`, `question`, or `failed`. `agent.check` returns `{ pass: boolean }`. The reducer switches on these tags. It never parses prose. Structured output is therefore the load-bearing capability in this study.

## Capability matrix

Legend:

- **stable** — the vendor documents the interface and does not mark it experimental, preview, or deprecated.
- **unstable** — documented, but marked experimental or preview, or specified only by an example rather than a contract, or subject to a recent breaking change.
- **observed-only** — present in the local installation, no primary source found.
- **absent** — no such capability. The source either denies it or is silent.

| ID | Capability | Claude Code | Codex | Pi |
| --- | --- | --- | --- | --- |
| K01 | Installation and package root | stable — [plugins](https://code.claude.com/docs/en/plugins), [`${CLAUDE_PLUGIN_ROOT}`](https://code.claude.com/docs/en/plugins-reference) | stable — [plugins](https://developers.openai.com/codex/plugins); no package-root variable found | stable — [pi packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md) |
| K02 | Enumerate skills and check one exists | stable — `slash_commands` in [`system/init`](https://code.claude.com/docs/en/agent-sdk/slash-commands) | absent for skills; stable for plugins — [`codex plugin list --json`](https://developers.openai.com/codex/cli/reference) | stable — RPC [`get_commands`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md) |
| K03 | Invoke a named skill | stable — `/name` works in `-p` mode ([headless](https://code.claude.com/docs/en/headless)) | unstable — `$name` and `/skills` are interactive; no documented headless form ([skills](https://developers.openai.com/codex/build-skills)) | stable — `/skill:name` ([skills](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)) |
| K04 | Subagent dispatch with its own context | stable — [subagents](https://code.claude.com/docs/en/sub-agents) | stable as a feature, prompt-driven as an interface — [`features.multi_agent`](https://developers.openai.com/codex/config-file/config-reference), [subagents](https://developers.openai.com/codex/agent-configuration/subagents) | absent from core by design — [design principles](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/usage.md) |
| K05 | Schema-validated structured output | stable at the run boundary, absent per subagent — [structured outputs](https://code.claude.com/docs/en/agent-sdk/structured-outputs) | unstable — schema is requested, not enforced ([non-interactive mode](https://developers.openai.com/codex/non-interactive-mode)) | absent — no schema surface documented ([JSON mode](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/json.md)) |
| K06 | Push notification to the maintainer | stable — [Notification hook](https://code.claude.com/docs/en/hooks) | stable, but fires only at turn end — [`notify`](https://developers.openai.com/codex/config-file/config-advanced) | absent from core; example extension only ([notify.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/notify.ts)) |
| K07 | Mid-run question with a deadline | stable, fixed windows — [`askUserQuestionTimeout`](https://code.claude.com/docs/en/tools-reference) | unstable — `tool/requestUserInput` with `autoResolutionMs` is experimental ([app-server](https://developers.openai.com/codex/app-server)) | unstable — `ctx.ui` with `{ timeout }`, and unavailable in headless modes ([extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)) |
| K08 | Durable background timer | absent — [background Bash](https://code.claude.com/docs/en/tools-reference) only | absent — [scheduling is not in the CLI](https://developers.openai.com/codex/automations) | absent — no timer API documented |
| K09 | Context-budget reporting | stable — `context_window.remaining_percentage` ([status line](https://code.claude.com/docs/en/statusline)) | unstable — per-turn usage only; no remaining figure in `codex exec` ([non-interactive mode](https://developers.openai.com/codex/non-interactive-mode)) | stable inside an extension — [`ctx.getContextUsage()`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md) |
| K10 | Headless run, session id, resume | stable — [headless](https://code.claude.com/docs/en/headless), [sessions](https://code.claude.com/docs/en/sessions) | stable — [`codex exec`](https://developers.openai.com/codex/non-interactive-mode), [SDK](https://github.com/openai/codex/tree/main/sdk/typescript) | stable, and also an in-process SDK — [SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md) |
| K11 | Permission model | stable — [permission modes](https://code.claude.com/docs/en/permission-modes) | stable — sandbox and approval axes ([approvals and security](https://developers.openai.com/codex/agent-approvals-security)) | absent by design — [security](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md) |
| K12 | Layered project and user config | stable — [settings](https://code.claude.com/docs/en/settings) | stable — [config reference](https://developers.openai.com/codex/config-file/config-reference) | stable, but no machine-readable schema ([settings](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md)) |

One caveat qualifies every Pi cell. Pi is at `0.x` and ships breaking changes inside minor releases. Release 0.83.0 carries a `### Breaking Changes` section ([CHANGELOG](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/CHANGELOG.md)). No stability policy, SemVer statement, or 1.0 plan was found in the repository, the shipped `docs/`, or the package manifest. "Stable" in the Pi column means "documented as a supported interface today", not "guaranteed across releases".

## Claude Code

### K01 Installation and package root

A plugin is a directory with `.claude-plugin/plugin.json`. Marketplaces distribute plugins and are catalogued by `.claude-plugin/marketplace.json` ([plugins](https://code.claude.com/docs/en/plugins), [marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)).

The package root resolves through a documented variable. The plugins reference lists `${CLAUDE_PLUGIN_ROOT}` as "Absolute path to the plugin's installation directory", and states that the value "changes when the plugin updates" and must not hold state. A separate `${CLAUDE_PLUGIN_DATA}` variable exists for writable plugin state ([plugins reference](https://code.claude.com/docs/en/plugins-reference)). Factory's disposable journal can live under `${CLAUDE_PLUGIN_DATA}`.

Version pinning uses semver ranges in a `dependencies` array. The documentation states that the version field "accepts any expression supported by Node's `semver` package" ([plugin dependencies](https://code.claude.com/docs/en/plugin-dependencies)).

A plugin can add executables to the Bash tool's `PATH` through a `bin/` directory, and can declare MCP servers through `.mcp.json` at the plugin root ([plugins](https://code.claude.com/docs/en/plugins)).

### K02 and K03 Skill enumeration and invocation

Enumeration is documented and machine-readable. The SDK page states: "The Claude Agent SDK provides information about available slash commands in the system initialization message", and the sample reads `message.slash_commands` from the `system` message with subtype `init`. The list "Includes built-in commands plus bundled skills and your custom commands" ([SDK slash commands](https://code.claude.com/docs/en/agent-sdk/slash-commands)). The same `system/init` event appears in the CLI `--output-format stream-json` stream ([headless](https://code.claude.com/docs/en/headless)).

Preflight can therefore test membership of a name in `slash_commands`. This satisfies the v1 Preflight requirement to check that named skills exist.

Skill search paths and precedence are documented: enterprise overrides personal, personal overrides project, and plugin skills use a `plugin-name:skill-name` namespace that cannot collide ([skills](https://code.claude.com/docs/en/skills)).

Invocation works in headless mode. The headless page states that user-invoked skills and custom commands "work in `-p` mode: include `/skill-name` in the prompt string and Claude Code expands it before running" ([headless](https://code.claude.com/docs/en/headless)).

### K04 Subagent dispatch

Subagents are Markdown files with YAML frontmatter, loaded from `.claude/agents/` and `~/.claude/agents/`, or passed as JSON with `--agents` ([subagents](https://code.claude.com/docs/en/sub-agents)). Supported frontmatter includes `model`, `tools`, `disallowedTools`, `permissionMode`, `maxTurns`, `skills`, `effort`, and `isolation`.

Two fields matter for Factory. `model` accepts `sonnet`, `opus`, `haiku`, `fable`, a full model ID, or `inherit`. `isolation: worktree` runs the subagent "in a temporary git worktree, giving it an isolated copy of the repository branched by default from your default branch". That maps directly onto the map's requirement for isolated worktrees.

### K05 Structured output

This is the only harness that validates output against a schema.

At the run boundary the SDK accepts an `outputFormat` option of `{ type: "json_schema", schema }`. The documentation states: "the SDK validates the output against it, re-prompting on mismatch. If validation does not succeed within the retry limit, the result is an error instead of structured data." The validated value arrives in `message.structured_output`, and failure surfaces as result subtype `error_max_structured_output_retries` ([structured outputs](https://code.claude.com/docs/en/agent-sdk/structured-outputs)).

The CLI has the same capability: `--output-format json` with `--json-schema`, with the value in the `structured_output` field ([headless](https://code.claude.com/docs/en/headless)).

**There is no per-subagent output schema.** The subagent frontmatter reference lists no schema or output-format field ([subagents](https://code.claude.com/docs/en/sub-agents)). A subagent spawned through the Agent tool returns prose to the parent. Validation is available only at the boundary of a top-level `query()` or `claude -p` run.

Two limits are worth recording. The SDK validates against JSON Schema draft-07 and rejects schemas that declare a newer version. The `format` keyword is accepted as an annotation and is not enforced ([structured outputs](https://code.claude.com/docs/en/agent-sdk/structured-outputs)).

### K06 Push notifications

The Notification hook fires when Claude Code sends a notification. Documented matchers include `permission_prompt`, `idle_prompt`, `agent_needs_input`, and `agent_completed`. A hook of `type: "command"` can run any program ([hooks](https://code.claude.com/docs/en/hooks)).

Factory can therefore route a push notification through a Notification hook command, or call its own notifier directly from a Bash effect. No built-in push channel exists. No primary source was found for a `preferredNotifChannel` setting; the settings page does not contain it.

### K07 Mid-run question with a deadline

The `AskUserQuestion` tool asks the maintainer a multiple-choice question. The tools reference states: "Questions stay open until you answer them. If you want a question you leave unanswered to eventually close and let Claude continue without you, set the `askUserQuestionTimeout` setting to `60s`, `5m`, or `10m`" ([tools reference](https://code.claude.com/docs/en/tools-reference)).

Three constraints follow, and all three matter for the Park behavior:

1. The allowed values are `60s`, `5m`, and `10m`. Factory's v1 window is 15 minutes ([factory-v2-baseline](./factory-v2-baseline.md)). That value is not expressible.
2. The timeout is a user setting, not a per-call argument. The runtime cannot vary the deadline per question.
3. On timeout the dialog "submits any options you'd already selected and tells Claude you may be away from your keyboard, so Claude proceeds on its own judgment". It does not return a distinct "no answer" result. The same page states the timeout "applies only to `AskUserQuestion`'s multiple-choice questions; permission prompts, including plan approval, never auto-resolve on idle."

Under `dontAsk` permission mode, `AskUserQuestion` "is denied even when an allow rule matches" ([headless](https://code.claude.com/docs/en/headless)). A locked-down headless run therefore cannot ask.

### K08 Background timers

The Bash tool accepts `run_in_background: true`, and `BashOutput` polls a running command ([tools reference](https://code.claude.com/docs/en/tools-reference)). This is a process, not a durable deadline. In `-p` mode a background shell "is terminated about five seconds after Claude has returned its final result and stdin has closed" ([headless](https://code.claude.com/docs/en/headless)).

The `/loop` scheduled-task feature repeats a whole session on a schedule. It is not a within-run timer ([scheduled tasks](https://code.claude.com/docs/en/scheduled-tasks)).

No durable in-run timer exists.

### K09 Context-budget reporting

The status line receives a JSON object on stdin containing a `context_window` object. Documented fields include `total_input_tokens`, `total_output_tokens`, `context_window_size`, `used_percentage`, and `remaining_percentage`, plus a top-level `exceeds_200k_tokens` boolean ([status line](https://code.claude.com/docs/en/statusline)).

This is the strongest context-budget channel of the three harnesses. It replaces the v1 approximation of "40 percent model context". Two caveats: the values "may be `null` early in the session", and the channel pushes to a configured shell command rather than offering a pull API.

The SDK also reports per-message `usage` and a cumulative total on the result message ([cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking)).

### K10 Subprocess and session mechanics

`claude -p` runs non-interactively. `--output-format` accepts `text`, `json`, and `stream-json`. `--continue` resumes the most recent conversation and `--resume <session-id>` resumes a named one. `--fork-session` branches ([headless](https://code.claude.com/docs/en/headless)).

Sessions persist to local transcript files and survive process exit ([sessions](https://code.claude.com/docs/en/sessions)). Resuming an ended session in `-p` mode "errors and exits with code 1, so a script doesn't read the ended run as a success" ([tools reference](https://code.claude.com/docs/en/tools-reference)).

`--bare` skips discovery of hooks, skills, plugins, MCP servers, and CLAUDE.md. The documentation calls it "the recommended mode for scripted and SDK calls" ([headless](https://code.claude.com/docs/en/headless)). Factory must not use `--bare` for a run that needs skill discovery, because bare mode never loads skills.

On SIGTERM, Claude Code aborts the turn, terminates the Bash process tree, runs `SessionEnd` hooks, and exits with code 143 ([headless](https://code.claude.com/docs/en/headless)). That gives the adapter a defined shutdown path for a coordinator lease.

### K11 Permission model

Permission modes are `default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, and `plan` ([subagents](https://code.claude.com/docs/en/sub-agents), [permission modes](https://code.claude.com/docs/en/permission-modes)). Settings carry `permissions.allow`, `permissions.ask`, and `permissions.deny` rules ([settings](https://code.claude.com/docs/en/settings)). The SDK adds a `canUseTool` callback, and the `PreToolUse` hook can return `permissionDecision` of `allow`, `deny`, `ask`, or `defer` ([hooks](https://code.claude.com/docs/en/hooks)).

Two things cannot be auto-approved. Writes to protected paths "are never auto-approved except in `bypassPermissions` mode", and even under `bypassPermissions`, removals targeting the filesystem root or home directory "still prompt as a circuit breaker against model error" ([permission modes](https://code.claude.com/docs/en/permission-modes)).

`dontAsk` is the mode designed for autonomous runs. It "denies anything not in your `permissions.allow` rules or the read-only command set, which is useful for locked-down CI runs" ([headless](https://code.claude.com/docs/en/headless)).

### K12 Config

Precedence is managed settings, then command line arguments, then `.claude/settings.local.json`, then `.claude/settings.json`, then `~/.claude/settings.json` ([settings](https://code.claude.com/docs/en/settings)). A plugin can ship a `settings.json` at its root ([plugins](https://code.claude.com/docs/en/plugins)). No primary source was found describing how plugin-contributed settings merge across scopes.

## Codex

### K01 Installation and package root

Codex installs through an install script, `npm install -g @openai/codex`, or `brew install --cask codex` ([CLI](https://developers.openai.com/codex/cli)). The repository also publishes a DotSlash file so a project can pin an exact CLI version in source control ([install](https://github.com/openai/codex/blob/main/docs/install.md)).

Codex has a plugin system. A plugin is "an installable package that can include skills, an MCP server, or both", and its manifest is `.codex-plugin/plugin.json` ([build plugins](https://developers.openai.com/codex/build-plugins)). A plugin can also carry hooks ([plugins](https://developers.openai.com/codex/plugins)). Marketplaces are added with `codex plugin marketplace add`, which "accepts GitHub shorthand such as `owner/repo` or `owner/repo@ref`" and supports `--ref` to pin a Git ref ([CLI reference](https://developers.openai.com/codex/cli/reference)).

**No package-root variable was found.** Nothing equivalent to `${CLAUDE_PLUGIN_ROOT}` appears in the plugin documentation. The on-disk layout `~/.codex/plugins/cache/<marketplace>/<plugin>/` is **observed-only**.

### K02 and K03 Skill enumeration and invocation

Codex implements the same open Agent Skills standard. "A skill is a directory with a `SKILL.md` file plus optional scripts and references. The `SKILL.md` file must include `name` and `description`" ([build skills](https://developers.openai.com/codex/build-skills)).

Discovery scans six scopes: `$CWD/.agents/skills`, `$CWD/../.agents/skills`, `$REPO_ROOT/.agents/skills`, `$HOME/.agents/skills`, `/etc/codex/skills`, and bundled system skills. Symlinked skill folders are followed.

**Skill enumeration is absent.** There is no `codex skills` subcommand and no documented machine-readable skill listing. `/skills` is an interactive picker. Plugin enumeration, by contrast, is stable and scriptable: `codex plugin list --json` "prints `installed` and `available` arrays" with `pluginId`, `name`, `version`, `installed`, and `enabled` ([CLI reference](https://developers.openai.com/codex/cli/reference)).

Invocation is `$name` in a prompt or the `/skills` picker; implicit invocation happens when the task matches the skill `description` ([build skills](https://developers.openai.com/codex/build-skills)). No primary source documents invoking a named skill from `codex exec`.

One capacity limit matters for a Factory install: the initial skill list "uses at most 2% of the model's context window, or 8,000 characters when the context window is unknown", and Codex "may omit some skills from the initial list and show a warning".

### K04 Subagent dispatch

Codex has a documented multi-agent system. The config reference describes `features.multi_agent` as enabling "multi-agent collaboration tools (`spawn_agent`, `send_input`, `resume_agent`, `wait_agent`, and `close_agent`) (stable; on by default)" ([config reference](https://developers.openai.com/codex/config-file/config-reference)).

Custom agents are standalone TOML files under `~/.codex/agents/` or `.codex/agents/`, and each must define `name`, `description`, and `developer_instructions`. An agent file can set `model`, `model_reasoning_effort`, and `sandbox_mode` ([subagents](https://developers.openai.com/codex/agent-configuration/subagents)).

The interface is the problem, not the feature. Dispatch is prompt-driven: "Ask for subagents or parallel agent work directly." The same page instructs authors to "Return summaries from subagents instead of raw intermediate output." There is no documented programmatic call that dispatches a named subagent and returns its result.

A deterministic alternative exists. `codex mcp-server` exposes a `codex` tool that runs a full session with `prompt`, `model`, `sandbox`, `approval-policy`, and `developer-instructions` parameters, plus a `codex-reply` tool that continues a thread by `threadId` ([MCP server](https://developers.openai.com/codex/mcp-server)). The TypeScript SDK offers the same shape in-process through `startThread` and `resumeThread`.

### K05 Structured output

`codex exec --output-schema <FILE>` takes "Path to a JSON Schema file describing the model's final response shape". The documentation says: "If you need structured data for downstream steps, use `--output-schema` to request a final response that conforms to a JSON Schema" ([non-interactive mode](https://developers.openai.com/codex/non-interactive-mode)).

The verb is *request*. No primary source states that the schema is enforced or validated. The SDK exposes the same option as `outputSchema` on a turn ([SDK README](https://github.com/openai/codex/blob/main/sdk/typescript/README.md)).

The result arrives as a string. The checked-in item type says: "Response from the agent. Either natural-language text or JSON when structured output is requested", and the `text` field is typed `string` ([items.ts](https://github.com/openai/codex/blob/main/sdk/typescript/src/items.ts)). The consumer must parse it. The SDK's only pre-flight check is that the supplied schema "must be a plain JSON object" ([outputSchemaFile.ts](https://github.com/openai/codex/blob/main/sdk/typescript/src/outputSchemaFile.ts)).

**No primary source was found** for schema enforcement, a validation error path, a retry on invalid output, or a non-zero exit code when the final message violates the schema.

What is stable is the envelope. `--json` makes stdout a JSON Lines stream with event types `thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.*`, and `error` ([non-interactive mode](https://developers.openai.com/codex/non-interactive-mode)). The event and item unions are pinned by checked-in TypeScript types generated from the Rust source ([events.ts](https://github.com/openai/codex/blob/main/sdk/typescript/src/events.ts)).

### K06 Push notifications

`notify` runs an external program. The advanced-config page states: "Use `notify` to trigger an external program whenever Codex emits supported events (currently only `agent-turn-complete`)." The program receives one JSON argument in `argv[1]` with fields `type`, `thread-id`, `turn-id`, `cwd`, `input-messages`, and `last-assistant-message` ([config advanced](https://developers.openai.com/codex/config-file/config-advanced)).

Two constraints matter. The single supported event fires at turn end, so `notify` cannot alert the maintainer at an arbitrary point mid-run. And `notify` is one of the keys Codex "ignores ... when they appear in a project-local `.codex/config.toml`" ([config reference](https://developers.openai.com/codex/config-file/config-reference)), so a Project cannot configure it.

### K07 Mid-run question with a deadline

The app-server protocol documents `tool/requestUserInput`, which prompts the user with one to three short questions for a tool call. It is marked **experimental**. Request params include `autoResolutionMs` as an integer millisecond timeout or `null`, and "When present, host clients can resolve the prompt automatically after that interval if the user doesn't answer" ([app-server](https://developers.openai.com/codex/app-server)).

The deadline is advisory. The embedding client enforces it, not Codex.

A second channel is MCP elicitation, through `mcpServer/elicitation/request`. No timeout is documented for it, and `approval_policy.granular.mcp_elicitations` controls whether such prompts "are allowed to surface instead of being auto-rejected" ([config reference](https://developers.openai.com/codex/config-file/config-reference)).

**For `codex exec` there is no question mechanism at all.** The documented CI posture is `--sandbox read-only --ask-for-approval never` ([approvals and security](https://developers.openai.com/codex/agent-approvals-security)).

### K08 Background timers

"Codex CLI doesn't provide the Scheduled management interface. Use ChatGPT web or the desktop app to create and manage scheduled tasks" ([automations](https://developers.openai.com/codex/automations)).

Background terminals exist, with `/ps` and `/stop`, and a `background_terminal_max_timeout` poll window that defaults to 300000 ms ([CLI reference](https://developers.openai.com/codex/cli/reference), [config reference](https://developers.openai.com/codex/config-file/config-reference)). These are processes, not deadlines. No durable timer exists.

### K09 Context-budget reporting

The `turn.completed` event carries a `usage` object with `input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`, and `reasoning_output_tokens` ([events.ts](https://github.com/openai/codex/blob/main/sdk/typescript/src/events.ts)). The config keys `model_context_window` and `model_auto_compact_token_limit` describe the window and the compaction threshold ([config reference](https://developers.openai.com/codex/config-file/config-reference)).

**No remaining-context figure is exposed by `codex exec`.** `/status` shows "remaining context capacity" in the TUI ([CLI reference](https://developers.openai.com/codex/cli/reference)), and the app-server emits `thread/tokenUsage/updated`, but no primary source documents that notification's payload.

An experimental in-run budget exists: `features.rollout_budget.enabled` with `limit_tokens` and `reminder_interval_tokens`. The config reference marks it "under development and off by default".

### K10 Subprocess and session mechanics

`codex exec` is the non-interactive entry point. The first JSONL event is `thread.started`, whose `thread_id` "Can be used to resume the thread later". Resumption is `codex exec resume --last` or `codex exec resume <SESSION_ID>`. `--ephemeral` suppresses rollout files ([non-interactive mode](https://developers.openai.com/codex/non-interactive-mode)).

By default Codex "requires commands to run inside a Git repository to prevent destructive changes", overridable with `--skip-git-repo-check`. If an MCP server marked `required = true` fails to initialize, `codex exec` exits with an error rather than continuing.

The TypeScript SDK is `@openai/codex-sdk`. It "wraps the `codex` CLI from `@openai/codex`. It spawns the CLI and exchanges JSONL events over stdin/stdout", and exposes `startThread`, `resumeThread`, `run`, and `runStreamed` ([SDK README](https://github.com/openai/codex/blob/main/sdk/typescript/README.md)). Thread options include `model`, `sandboxMode`, `approvalPolicy`, `modelReasoningEffort`, `workingDirectory`, and `skipGitRepoCheck` ([threadOptions.ts](https://github.com/openai/codex/blob/main/sdk/typescript/src/threadOptions.ts)).

The rollout file layout under `~/.codex/sessions/YYYY/MM/DD/` is **observed-only**.

### K11 Permission model

Two orthogonal axes: "Sandbox mode: What Codex can do technically ... Approval policy: When Codex must ask you before it executes an action" ([approvals and security](https://developers.openai.com/codex/agent-approvals-security)).

Sandbox modes are `read-only`, `workspace-write`, and `danger-full-access`. Approval policies are `untrusted`, `on-request`, `never`, or a `granular` table. The config reference states that "`on-failure` is deprecated; use `on-request` for interactive runs or `never` for non-interactive runs" ([config reference](https://developers.openai.com/codex/config-file/config-reference)). `--full-auto` is a deprecated compatibility flag.

One class of action always requires approval: "Destructive app/MCP tool calls always require approval when the tool advertises a destructive annotation, even if it also advertises other hints" ([approvals and security](https://developers.openai.com/codex/agent-approvals-security)). **No primary source was found** for a list of shell commands that can never be auto-approved.

Codex also has a full hooks system behind `features.hooks`, with eleven events including `PreToolUse`, `PermissionRequest`, `SubagentStart`, and `SubagentStop`. A `PreToolUse` hook can block a call with `permissionDecision: "deny"`. Hooks require explicit trust, recorded against the hook's content hash ([hooks](https://developers.openai.com/codex/hooks)).

### K12 Config

"User-level configuration lives in `~/.codex/config.toml`. You can also add project-scoped overrides in `.codex/config.toml` files. Codex loads project-scoped config files only when you trust the project." Codex walks from the project root to the working directory, and "the closest file to your working directory wins" ([config advanced](https://developers.openai.com/codex/config-file/config-advanced)).

Overrides use `-c key=value`, where "`--config` values are parsed as TOML", so string values need inner quotes.

Two flags help an adapter validate what it wrote. `--strict-config` errors out "when config.toml contains fields that are not recognized by this version of Codex", and `--ignore-user-config` isolates a run from the user layer (observed in `codex exec --help`; `--ignore-user-config` is also documented, `--strict-config` is observed-only).

A recent breaking change affects profiles. "In Codex 0.134.0 and later, `--profile` no longer reads `[profiles.profile-name]` from `config.toml`, and the top-level `profile = "profile-name"` selector is no longer supported." Profiles are now separate `~/.codex/<name>.config.toml` files.

`AGENTS.md` discovery is a documented three-step chain, merged root-down, capped by `project_doc_max_bytes` at 32 KiB by default ([AGENTS.md](https://developers.openai.com/codex/agent-configuration/agents-md)).

## Pi

Pi is `pi` by Mario Zechner, repository [earendil-works/pi](https://github.com/earendil-works/pi), npm package `@earendil-works/pi-coding-agent`, MIT licensed. The local installation resolves `pi` to `@earendil-works/pi-coding-agent/dist/cli.js` and reports version 0.83.0 (observed). The user's shared agent instructions name the same three harnesses ([~/.agents/AGENTS.md](https://github.com/earendil-works/pi)). The Factory repository itself does not mention Pi anywhere.

Pi's design philosophy explains most of the gaps below. The usage guide states that Pi "intentionally does not include built-in MCP, sub-agents, permission popups, plan mode, to-dos, or background bash. You can build or install those workflows as extensions or packages" ([usage](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/usage.md)).

### K01 Installation and package root

Pi installs with `npm install -g --ignore-scripts @earendil-works/pi-coding-agent` ([quickstart](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/quickstart.md)).

Third parties distribute "pi packages", which "bundle extensions, skills, prompt templates, and themes so you can share them through npm or git. A package can declare resources in `package.json` under the `pi` key, or use conventional directories" ([packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)).

Installation accepts pinned specs: `pi install npm:@foo/bar@1.0.0`, `pi install git:github.com/user/repo@v1`, and local paths. "Versioned specs are pinned and skipped by package updates."

Package roots resolve to `~/.pi/agent/npm/` for user installs and `.pi/npm/` for project installs, with parallel `git/` trees for Git sources.

One rule constrains a shared TypeScript runtime directly. Packages that import Pi's core modules must "list them in `peerDependencies` with a `"*"` range and do not bundle them", covering `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `typebox`. Pi "loads packages with separate module roots, so separate installs do not collide or share modules."

### K02 and K03 Skill enumeration and invocation

Pi implements the Agent Skills standard ([skills](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)). It loads skills from `~/.pi/agent/skills/`, `~/.agents/skills/`, project `.pi/skills/`, project `.agents/skills/` in the working directory and ancestors, package `skills/` directories, a `skills` array in settings, and repeatable `--skill <path>` flags.

Cross-harness reuse is explicitly supported. The documentation shows adding `~/.claude/skills` and `~/.codex/skills` to the `skills` settings array.

Enumeration is documented and machine-readable, through RPC mode. The `get_commands` command returns "available commands (extension commands, prompt templates, and skills)". Each entry carries `name`, `description`, `source` of `extension`, `prompt`, or `skill`, `location`, and `path` ([RPC](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)). Built-in TUI commands are excluded.

There is no CLI flag that lists skills. `pi list` lists packages only. A Preflight check therefore needs `--mode rpc`, the in-process SDK, or a scan of the documented directories.

Skills "register as `/skill:name` commands", and arguments after the command "are appended to the skill content as `User: <args>`".

### K04 Subagent dispatch

**Absent from core, by explicit design** ([usage](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/usage.md)).

Pi ships a reference implementation as an example extension. It states: "Delegate tasks to specialized subagents with isolated context windows ... Each subagent runs in a separate `pi` process" ([subagent example](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/subagent/README.md)). Agents are Markdown files with `name`, `description`, `tools`, and `model` frontmatter, loaded from `~/.pi/agent/agents/*.md` and, when enabled, `.pi/agents/*.md`.

The dispatch itself is a subprocess spawn. The example builds the argument list `["--mode", "json", "-p", "--no-session"]` and appends `--model` and `--tools` per agent ([index.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/subagent/index.ts)). That is the pattern a Factory adapter should adopt rather than vendoring the example.

### K05 Structured output

Pi has a documented event stream and no documented schema surface.

`pi --mode json` "Outputs all session events as JSON lines to stdout. Useful for integrating pi into other tools or custom UIs." The first line is a session header, followed by `agent_start`, `turn_start`, `message_start`, `message_update`, `message_end`, `turn_end`, and `agent_end` ([JSON mode](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/json.md)). RPC mode adds typed request and response envelopes ([RPC](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)).

Extension tools declare parameters with TypeBox, which produces JSON Schema for the tool call ([extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)). A tool result carries a `details` field for "Arbitrary structured details", and a `terminate` hint that lets the agent stop on a tool call ([structured-output example](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/structured-output.ts)).

What is missing is decisive:

- No top-level response format or per-run output schema.
- No forced tool call, so the model can simply decline to emit the structured tool.
- `terminate` is documented as a hint that fires only when every result in the batch sets it.
- A `ConstrainedSamplingConfig` type exists in the source, supporting `{ type: "json_schema"; strict: "prefer" | "require" }` ([types.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/types.ts)), but it is **undocumented**. The shipped `docs/` directory contains no occurrence of "structured output", "JSON schema", or `constrainedSampling`.

The reliable contract today is: run `pi --mode json -p`, parse the JSONL, and read the terminal message. That is exactly what Pi's own subagent example does.

### K06 Push notifications

No built-in mechanism and no webhook are documented. An example extension sends terminal notifications over OSC 777, OSC 99, or a Windows toast, triggered on the `agent_end` event ([notify.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/notify.ts)).

RPC mode forwards notifications to the host. The `notify` method is "Fire-and-forget, no response expected", with `notifyType` of `info`, `warning`, or `error` ([RPC](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)). For an embedding runtime this is the practical channel: the notification arrives as a stdout JSON line and the host decides what to do with it.

One hazard is worth recording. The `notify.ts` example writes its escape sequence to `process.stdout`. A Factory adapter that consumes `--mode json` must not load an extension that does this, because the sequence lands in the middle of the JSONL stream.

### K07 Mid-run question with a deadline

Extensions prompt the user through `ctx.ui`, with `select`, `confirm`, `input`, and `notify` ([extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)).

A deadline is a first-class option. The timed-dialog example passes `{ timeout: 5000 }` to `ctx.ui.confirm` and `{ timeout: 10000 }` to `ctx.ui.select`, and also demonstrates an `AbortSignal` form ([timed-confirm.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/timed-confirm.ts)). With the option form a timeout is indistinguishable from a user cancel; the signal form distinguishes them.

The blocking constraint is `ctx.hasUI`, documented as "`true` in TUI and RPC modes. `false` in print mode (`-p`) and JSON mode" ([extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)). The mode a programmatic runtime would naturally choose, `--mode json -p`, cannot ask a question. Asking requires `--mode rpc`, where the question is forwarded to the host over the Extension UI Protocol.

This capability is documented only through examples, not a specified contract, so it is recorded as unstable.

### K08 Background timers

No timer, scheduler, or clock API is documented. Background bash is explicitly excluded from core ([usage](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/usage.md)).

Extensions are ordinary Node modules, so `setTimeout` works, but `ExtensionAPI` exposes no timer surface. The documented bash environment variables are `PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`, and `PI_REASONING_LEVEL` — none carries a time value ([environment variables](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/environment-variables.md)).

### K09 Context-budget reporting

`ctx.getContextUsage()` "Returns current context usage for the active model. Uses last assistant usage when available, then estimates tokens for trailing messages" ([extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)). The shape is `{ tokens: number | null; contextWindow: number; percent: number | null }` ([types.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts)).

Two caveats: the function itself can return `undefined`, and `tokens` can be `null` right after compaction. There is no `remaining` field; the caller subtracts. The API is an extension API, so a plain `pi --mode json -p` consumer must derive usage from the per-message `Usage` totals in the stream.

### K10 Subprocess and session mechanics

This is Pi's strongest area, and the only harness of the three that offers a genuinely in-process TypeScript API.

The SDK "provides programmatic access to pi's agent capabilities. Use it to embed pi in other applications, build custom interfaces, or integrate with automated workflows", and ships inside the main package. The entry points are `createAgentSession`, `ModelRuntime`, and `SessionManager`, and `AgentSession` exposes `prompt`, `steer`, `followUp`, `subscribe`, `compact`, `abort`, `dispose`, `sessionId`, and `sessionFile` ([SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)).

Sessions "auto-save to `~/.pi/agent/sessions/`, organized by working directory. Each session is a JSONL file with a tree structure." Flags include `-c` to continue, `-r` to browse, `--session <path|id>`, `--fork <path|id>`, and `--no-session` ([sessions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sessions.md)).

One flag is directly useful for idempotent recovery: `--session-id <id>` uses an "exact project session ID, creating it if missing". That lets an adapter derive a session identity from the issue rather than discovering one.

The SDK documents a footgun worth carrying into the adapter: `runtime.session` is replaced by some operations, event subscriptions attach to a specific `AgentSession`, and extensions must be re-bound after replacement.

### K11 Permission model

**Absent by design, and the vendor says so plainly.** The README states: "Pi does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it. If you need stronger boundaries, containerize or sandbox Pi" ([README](https://github.com/earendil-works/pi/blob/main/README.md)).

The security document repeats it: "Pi does not include a built-in sandbox ... A partial in-process sandbox would be easy to misunderstand as a security boundary" ([security](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md)).

Project trust is not a permission model. "Project trust controls whether pi loads project-local settings, resources, packages, and extensions. It is not a sandbox and it does not restrict what the model can ask tools to do."

For autonomous runs the relevant sentence is: "Non-interactive modes (`-p`, `--mode json`, and `--mode rpc`) do not show a trust prompt. Without an applicable saved trust decision, `defaultProjectTrust: "ask"` and `"never"` ignore such resources, while `"always"` trusts them. Use `--approve`/`-a` or `--no-approve`/`-na` to override project trust for one run."

Run-scoped tool gating exists as allow and deny lists: `--tools`, `--exclude-tools`, `--no-builtin-tools`, and `--no-tools` ([usage](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/usage.md)). Per-call gating is do-it-yourself through the `tool_call` event, which an extension can block. Pi ships `permission-gate.ts`, `protected-paths.ts`, and a `sandbox/` example as reference implementations.

**No primary source was found** for a list of operations that cannot be auto-approved. There is no such list, because there is no approval layer.

### K12 Config

"Pi uses JSON settings files with project settings overriding global settings", at `~/.pi/agent/settings.json` and `.pi/settings.json`. Nested objects merge. "Paths in `~/.pi/agent/settings.json` resolve relative to `~/.pi/agent`. Paths in `.pi/settings.json` resolve relative to `.pi`" ([settings](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md)).

The keys a Factory package needs are `packages`, `extensions`, `skills`, `prompts`, `themes`, and `enableSkillCommands`. Arrays support glob patterns and `!` exclusions.

**No machine-readable schema exists.** There is no `$schema` key and no published JSON Schema file for `settings.json`. Validation is prose tables and examples. A runtime that writes `.pi/settings.json` has no checkable contract.

## What is stable across all three

These capabilities are documented and non-experimental in every harness, so the runtime can depend on them:

| ID | Shared capability | Claude Code | Codex | Pi |
| --- | --- | --- | --- | --- |
| S01 | Headless run with a machine-readable event stream | `claude -p --output-format stream-json` | `codex exec --json` | `pi --mode json -p` |
| S02 | A session identity emitted by the run, and resumption by that identity | `session_id`, `--resume` | `thread.started.thread_id`, `codex exec resume` | `PI_SESSION_ID`, `--session-id` |
| S03 | Per-sub-run model selection | subagent `model` frontmatter | agent TOML `model`, SDK `model` | `--model` |
| S04 | Skills as `SKILL.md` directories on the Agent Skills standard | [skills](https://code.claude.com/docs/en/skills) | [build skills](https://developers.openai.com/codex/build-skills) | [skills](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md) |
| S05 | Layered user and project configuration with documented precedence | `settings.json` | `config.toml` | `settings.json` |
| S06 | Third-party package distribution with version or ref pinning | semver `dependencies` | marketplace `@ref` | `npm:pkg@ver`, `git:repo@ref` |

S04 has a useful consequence. Codex and Pi both read `~/.agents/skills`, and Pi can be pointed at `~/.claude/skills` and `~/.codex/skills` through its `skills` setting. One Factory skill tree can serve all three harnesses.

## Fallbacks for absent or unstable capabilities

Each fallback below is what Factory v2 should do when the capability is not available. Every fallback uses only capabilities in the stable table above.

| ID | Gap | Where | Fallback |
| --- | --- | --- | --- |
| F01 | No schema-validated output from a subagent | all three; Claude Code validates only at the run boundary | Dispatch every `agent.*` effect as its own top-level headless run, not as an in-session subagent. Use `--json-schema` on Claude Code and `--output-schema` on Codex as a hint. Validate the parsed result inside the runtime against the `ImplementResult` union in every case, and treat a parse or validation failure as `{ result: "failed" }`. Never trust the harness to have validated. |
| F02 | No schema surface at all | Pi | Register a Factory extension tool whose TypeBox parameters are the result variant, and read `details` from the tool result. Because Pi cannot force a tool call, also accept a terminal JSON message as a second channel, and fall back to `{ result: "failed" }` when neither arrives. |
| F03 | No skill enumeration | Codex | Scan the six documented skill directories for `SKILL.md` and read the `name` field. Use `codex plugin list --json` for anything shipped as a plugin. Record the check as directory-based in the Preflight report so a failure is diagnosable. `codex debug prompt-input` renders the model-visible prompt as JSON and may carry the skill list, but this was not verified; see Q03. |
| F04 | No headless skill invocation | Codex | Do not invoke Codex skills by name. Inline the instruction text into the sub-run prompt. Keep the skill as the source of truth and read it from disk. |
| F05 | No deterministic subagent dispatch | Codex prompt-driven, Pi absent | Spawn a nested run instead of asking the harness to delegate. Codex: `codex exec` or the SDK `startThread` with per-thread `model` and `sandboxMode`. Pi: `pi --mode json -p --no-session --model X --tools Y`, which is the pattern Pi's own example uses. |
| F06 | No durable background timer | all three | The runtime owns the deadline. Store `deadlineAt` as absolute state, as the prototype already does, and let the host emit `tick` events from its own loop. Never delegate the deadline to the harness. This gap is uniform, so it needs no per-harness branch. |
| F07 | Mid-run question cannot meet the v1 15-minute window | Claude Code allows only `60s`, `5m`, `10m` | Do not use the harness timeout as the Park deadline. Ask without a harness timeout and let the runtime `tick` drive the Park. Set `answerWindowMs` from Project settings, and keep the harness question open until the runtime decides. |
| F08 | No mid-run question in the headless path | Codex `exec`, Pi `-p` and `--mode json` | Treat these paths as headless in the runtime's own sense: when `caps.notify` is false or the mode is headless, Park immediately rather than ask, which is the behavior the prototype already encodes. For an interactive Pi run, use `--mode rpc` and forward the question to the host. |
| F09 | Notification cannot fire mid-run | Codex `notify` fires only at turn end | Do not use `notify` for maintainer questions. Call the Project's notifier directly from a subprocess effect. Keep `notify` for end-of-turn signalling only. |
| F10 | No notification mechanism in core | Pi | Same as F09. The adapter calls the Project's notifier as a subprocess. In `--mode rpc` the adapter can additionally forward a `notify` message to the host. |
| F11 | No remaining-context figure | Codex | Compute the remaining budget as `model_context_window` minus the running total of `usage` from `turn.completed` events. Report it as an estimate. Do not rely on `features.rollout_budget.*`, which is documented as under development. |
| F12 | Context usage only inside an extension | Pi | The adapter runs as a Pi extension and calls `ctx.getContextUsage()`. When Factory runs as a plain subprocess consumer instead, derive usage from the `Usage` totals in the JSONL stream and treat `tokens: null` as unknown rather than zero. |
| F13 | No permission model | Pi | Do not claim a permission boundary that does not exist. Restrict the tool surface with `--tools`, require an explicit `--approve` decision for project-local resources, and record in the Project settings that isolation is the maintainer's responsibility. Factory's own gates — the landing gate and human merge approval — remain the only enforced controls. |
| F14 | No package-root variable | Codex | Resolve the package root from the location of the adapter's own module at load time. Do not assume `~/.codex/plugins/cache/...`, which is observed-only. |
| F15 | No config schema | Pi | Factory validates `.pi/settings.json` against its own schema before writing, and writes only the documented keys it needs. |

## Consequences for the runtime interface

1. **The `agent.*` seam must be a process boundary, not an in-session subagent.** This is the single strongest finding. Only Claude Code validates structured output, and only at the boundary of a top-level run. Codex requests a schema without enforcing it. Pi has no schema surface. F01 therefore applies to all three, and the runtime must own validation. The prototype's decision to keep judgment behind a closed variant set survives this study, but the adapter, not the harness, is what guarantees the closure.
2. **The clock stays in the runtime.** No harness offers a durable deadline. F06 makes this uniform rather than a per-harness difference, which simplifies the adapter contract.
3. **Preflight must branch on skill enumeration.** Claude Code and Pi answer the question directly. Codex cannot. The Preflight effect should report *how* it checked, so an operator can tell a real absence from an unverifiable one.
4. **Headless is the common denominator, and it is well supported.** All three offer a headless run, a machine-readable stream, a session identity, and resumption. The v2 requirement that headless empty-Queue runs report and stop is achievable everywhere.
5. **Pi cannot supply a permission boundary.** Factory must not present Pi as offering equivalent containment. The map's requirement that protected or ambiguous changes fail safe to human approval remains satisfiable, because Factory enforces that itself, but the tool-level boundary is absent.
6. **Superpowers already ships multi-harness manifests.** The installed Superpowers plugin on the audit machine carries `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, and `.kimi-plugin/plugin.json` side by side (observed-only). Factory's own package can follow the same shape, and the shared `~/.agents/skills` path in S04 makes one skill tree serve all three.

## Open questions

These could not be decided from available primary sources. Each needs a later ticket or an experiment.

| ID | Question | Why it is undecided |
| --- | --- | --- |
| Q01 | Does Codex validate `--output-schema` output in any way? | The documentation says "request". No page describes enforcement, a validation error, a retry, or a non-zero exit on mismatch. Only an experiment against a deliberately unsatisfiable schema can settle it. |
| Q02 | What is the payload of Codex `thread/tokenUsage/updated`? | The app-server page names the notification but documents no fields. |
| Q03 | Can a Codex skill be invoked by name from `codex exec`, and does `codex debug prompt-input` list installed skills? | Documented invocation is `$name` in an interactive prompt and the `/skills` picker. No headless form is documented, and no source denies it either. The `debug prompt-input` output could not be captured completely, because Codex subcommands other than `exec` require a TTY (observed). |
| Q04 | Does Pi's `constrainedSampling` work, and with which providers? | The type exists in the source and is wired through the tool definition, but the shipped documentation contains no occurrence of it. Depending on it would violate the rule against undocumented behavior. |
| Q05 | Do Claude Code plugin-contributed settings merge or override across scopes? | The plugins page states a plugin may ship `settings.json`, but no page describes precedence against user, project, or local settings. |
| Q06 | Is there a supported way to give a Claude Code subagent an output schema? | The subagent frontmatter reference lists no such field. F01 routes around the question, but a future field would simplify the adapter. |
| Q07 | What is Pi's compatibility policy? | No SemVer statement, stability declaration, or 1.0 plan was found. Release 0.83.0 ships breaking changes in a minor bump. Factory must decide which Pi version range it supports and how it detects a break. |
