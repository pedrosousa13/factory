// Edge module (fs/git allowed, thin fact-gathering). No pure logic lives
// here — this only reads disk and shells out to git, and hands the results
// to the pure modules (config.ts, marker.ts, preflight.ts) that decide what
// they mean.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { parseConfig, type ParseResult } from "./config";
import { readMarker } from "./marker";
import { STAMP_VERSION } from "./version";
import type { AdapterMarker, PreflightFacts, PushCheck, StampVersion, TrackerReachable } from "./preflight";

export const CONFIG_PATH = ".factory/config.json";
export const ADAPTER_DOC_PATH = "docs/agents/issue-tracker.md";

// ───── config

function gatherConfig(repoRoot: string): ParseResult {
  const path = join(repoRoot, CONFIG_PATH);
  if (!existsSync(path)) {
    return { ok: false, errors: [`${CONFIG_PATH}: not found — this repo is not stamped for the loop`] };
  }
  return parseConfig(readFileSync(path, "utf8"));
}

// ───── adapter marker

function gatherAdapterMarker(repoRoot: string): AdapterMarker {
  const path = join(repoRoot, ADAPTER_DOC_PATH);
  if (!existsSync(path)) return "missing-file";
  return readMarker(readFileSync(path, "utf8"));
}

// ───── push check ("push, not transport": only that a non-interactive push
// is possible — see preflight.ts)

function gatherPushCheck(repoRoot: string): PushCheck {
  try {
    const stdout = execFileSync("git", ["push", "--dry-run", "origin", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return { ok: true, detail: stdout.trim() || "non-interactive push to origin succeeded (dry run)" };
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    const detail = (e.stderr ?? "").trim() || e.message;
    return { ok: false, detail };
  }
}

// ───── stamp version

function gatherStampVersion(config: ParseResult): StampVersion {
  return { repo: config.ok ? config.config.stampVersion : null, plugin: STAMP_VERSION };
}

// ───── gatherPreflightFacts

export interface GatherOpts {
  // Needs a harness run to ask; edges don't spawn agents, so the caller
  // decides how (or whether) this got asked and passes the result in.
  trackerReachable: TrackerReachable;
}

export function gatherPreflightFacts(repoRoot: string, opts: GatherOpts): PreflightFacts {
  const config = gatherConfig(repoRoot);
  return {
    config,
    adapterMarker: gatherAdapterMarker(repoRoot),
    trackerReachable: opts.trackerReachable,
    pushCheck: gatherPushCheck(repoRoot),
    stampVersion: gatherStampVersion(config),
  };
}

// ───── detectActor

export type ActorResult =
  | { actor: string; source: "git-user.email" | "git-user.name" }
  | { error: string };

function gitConfigValue(repoRoot: string, key: string): string | null {
  try {
    const value = execFileSync("git", ["config", key], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: process.env,
    }).trim();
    return value || null;
  } catch {
    return null;
  }
}

/** git config user.email, falling back to user.name; an error variant if neither is set. */
export function detectActor(repoRoot: string): ActorResult {
  const email = gitConfigValue(repoRoot, "user.email");
  if (email) return { actor: email, source: "git-user.email" };

  const name = gitConfigValue(repoRoot, "user.name");
  if (name) return { actor: name, source: "git-user.name" };

  return {
    error: "git config has neither user.email nor user.name set — Factory needs an actor identity to claim tickets",
  };
}
