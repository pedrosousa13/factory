/**
 * Harness adapters — promoted from the parity slice's conformance prototype.
 *
 * Spawns each CLI headless with a prompt, waits for it, and returns the
 * agent's final message text untouched — only the CLI's own envelope is
 * unwrapped (claude's JSON result field, codex's/pi's JSONL final message).
 * Content inside that text (JSON or otherwise) is the host loop's problem.
 *
 * bun harness.ts claude|codex|pi   — smoke test
 */

// ──────────────────────────────────────────────────────────────────── types

export type HarnessName = "claude" | "codex" | "pi";
export type HarnessRun = { raw: string; ms: number; exit: number };

// ─────────────────────────────────────────────────────────────────── spawn

function spawn(cmd: string[], cwd: string): { stdout: string; stderr: string; exit: number; ms: number } {
  const start = performance.now();
  const proc = Bun.spawnSync(cmd, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const ms = Math.round(performance.now() - start);
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exit: proc.exitCode, ms };
}

// ──────────────────────────────────────────────────────────────────── claude

function runClaude(prompt: string, cwd: string): HarnessRun {
  const { stdout, stderr, exit, ms } = spawn(
    [
      "claude",
      "-p",
      prompt,
      "--output-format",
      "json",
      "--permission-mode",
      "dontAsk",
      "--allowed-tools",
      "Read,Edit,Write,Glob,Grep,Bash",
    ],
    cwd,
  );
  let envelope: unknown;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new Error(`claude: stdout was not JSON (exit ${exit}): ${stdout || stderr}`);
  }
  const result = (envelope as { result?: unknown }).result;
  if (typeof result !== "string") throw new Error(`claude: envelope had no string "result" field: ${stdout}`);
  return { raw: result, ms, exit };
}

// ───────────────────────────────────────────────────────────────────── codex

function runCodex(prompt: string, cwd: string): HarnessRun {
  const { stdout, stderr, exit, ms } = spawn(
    ["codex", "exec", prompt, "--json", "--skip-git-repo-check", "--sandbox", "workspace-write"],
    cwd,
  );
  let raw: string | undefined;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    if (event.type === "item.completed" && event.item?.type === "agent_message") raw = event.item.text;
  }
  if (raw === undefined) throw new Error(`codex: no agent_message item in JSONL stream (exit ${exit}): ${stderr}`);
  return { raw, ms, exit };
}

// ──────────────────────────────────────────────────────────────────────── pi

function runPi(prompt: string, cwd: string): HarnessRun {
  const { stdout, stderr, exit, ms } = spawn(["pi", "-p", prompt, "--mode", "json"], cwd);
  let raw: string | undefined;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    if (event.type === "message_end" && event.message?.role === "assistant") {
      raw = event.message.content
        .filter((c: { type: string }) => c.type === "text")
        .map((c: { text: string }) => c.text)
        .join("");
    }
  }
  if (raw === undefined) throw new Error(`pi: no assistant message_end in JSONL stream (exit ${exit}): ${stderr}`);
  return { raw, ms, exit };
}

// ────────────────────────────────────────────────────────────────── dispatch

export function runHarness(name: HarnessName, prompt: string, cwd: string): HarnessRun {
  if (name === "claude") return runClaude(prompt, cwd);
  if (name === "codex") return runCodex(prompt, cwd);
  return runPi(prompt, cwd);
}

// ──────────────────────────────────────────────────────────────────────── main

if (import.meta.main) {
  const name = process.argv[2] as HarnessName | undefined;
  if (name === "claude" || name === "codex" || name === "pi") {
    const run = runHarness(name, 'Reply with exactly the JSON {"ok":true} and nothing else.', import.meta.dir);
    console.log(JSON.stringify(run));
  } else if (name !== undefined) {
    console.error("usage: bun harness.ts claude|codex|pi");
    process.exit(1);
  }
}
