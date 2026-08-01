// Edge module (subprocess spawn allowed): the notifier fallback PRD §5 item
// 4 describes sitting beneath each harness's native channel — "the run
// calls the Project's notifier as a subprocess."
//
// Out of scope, deliberately: Claude Code's Notification hook and Codex's
// `notify` are configuration OF the harness (set up outside this runtime,
// firing from the harness process itself), not something Factory spawns —
// there is nothing for this module to do for either beyond leaving them
// alone. This module owns only the one channel that is Factory's own:
// running `notifierCommand` as a subprocess, with the question in
// `FACTORY_NOTIFY_MESSAGE` — the same key `hooks/factory-notify.sh` sets, so
// the two paths share one contract instead of each inventing its own.
//
// A missed or failed ping never loses the question — the ticket comment is
// the durable record (PRD §5 item 4) — so this can't be allowed to fail the
// run. That's structural, not a convention: `ping` below has no throwing
// path, only a closed outcome the caller records and moves on from.

import type { HarnessName } from "./harness";

// ───── the pure decision: whether a ping is even attempted

export type PingPlan =
  | { k: "spawn"; command: string }
  | { k: "no-notifier-configured" }
  | { k: "pi-no-ping" };

/**
 * The notifier fallback applies to every harness, pi included. PRD §5 item 4
 * puts it "beneath the native channels" precisely so that reaching the
 * maintainer never depends on one: "Factory does not rely on `notify` or on
 * an example extension to reach the maintainer." Pi's documented no-ping
 * state describes its native channel — pi ships none — which makes the
 * configured notifier the only channel pi has, not one to withhold from it.
 * So pi-no-ping is what a pi run reports when no notifier is configured, and
 * a configured notifier fires for pi exactly as it does for the others.
 */
export function pingPlan(harness: HarnessName, notifierCommand: string | undefined): PingPlan {
  if (notifierCommand !== undefined) return { k: "spawn", command: notifierCommand };
  return harness === "pi" ? { k: "pi-no-ping" } : { k: "no-notifier-configured" };
}

// ───── the edge: actually running it

export type PingOutcome =
  | { k: "pinged" }
  | { k: "no-notifier-configured" }
  | { k: "notifier-failed"; why: string }
  | { k: "pi-no-ping" };

/** The one contract between Factory and a notifier command: the message
 * arrives in this environment variable, and the command reads it from there.
 * `hooks/factory-notify.sh` sets the same key for Claude Code's Notification
 * hook, so a maintainer writes one notifier that works from either side. */
export const NOTIFY_MESSAGE_ENV = "FACTORY_NOTIFY_MESSAGE";

/**
 * Runs `notifierCommand` (a shell command line, same as a maintainer would
 * type it) as a subprocess in `cwd`, per pingPlan's decision, with `message`
 * in `FACTORY_NOTIFY_MESSAGE`. Every failure mode — non-zero exit, a command
 * that doesn't exist, spawn itself throwing — is caught and reported as
 * `notifier-failed`, never thrown.
 *
 * `message` is a parameter rather than something this module composes: the
 * question belongs to the caller that asked it, and a pure-ish edge module
 * that invented its own text would put a second wording of the question in
 * the tree.
 */
export function ping(
  harness: HarnessName,
  notifierCommand: string | undefined,
  cwd: string,
  message: string,
): PingOutcome {
  const plan = pingPlan(harness, notifierCommand);
  if (plan.k !== "spawn") return plan;

  try {
    const proc = Bun.spawnSync(["sh", "-c", plan.command], {
      cwd,
      env: { ...process.env, [NOTIFY_MESSAGE_ENV]: message },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    });
    if (proc.exitCode === 0) return { k: "pinged" };
    const stderr = proc.stderr.toString().trim();
    return { k: "notifier-failed", why: stderr || `notifier exited ${proc.exitCode}` };
  } catch (err) {
    return { k: "notifier-failed", why: (err as Error).message };
  }
}
