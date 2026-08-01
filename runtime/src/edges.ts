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
import { CONFIG_PATH } from "./paths";
import { ROLE_TABLE } from "./roles";
import type { AdapterMarker, PreflightFacts, PushCheck, StampVersion, TrackerReachable } from "./preflight";

export { CONFIG_PATH };
export const ADAPTER_DOC_PATH = "docs/agents/issue-tracker.md";

// ───── config

function gatherConfig(repoRoot: string): "missing-file" | ParseResult {
  const path = join(repoRoot, CONFIG_PATH);
  if (!existsSync(path)) return "missing-file";
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

function gatherStampVersion(config: "missing-file" | ParseResult): StampVersion {
  return { repo: config !== "missing-file" && config.ok ? config.config.stampVersion : null, plugin: STAMP_VERSION };
}

// ───── planning-role implementations

const SKILLS_DIR = ".claude/skills";

// PROTOCOL.md:44-46: check the `~/.claude/skills/` path itself — a missing or
// broken symlink there leaves the skill unavailable even if the source exists.
// existsSync follows symlinks, so a broken one reads as absent, which is what
// we want.
function gatherAvailableRoles(home: string): string[] {
  const names = new Set<string>();
  for (const spec of ROLE_TABLE) {
    for (const impl of [spec.preferred, spec.fallback]) {
      if (impl !== null && existsSync(join(home, SKILLS_DIR, impl))) names.add(impl);
    }
  }
  return [...names];
}

// ───── gatherPreflightFacts

export interface GatherOpts {
  // Needs a harness run to ask; edges don't spawn agents, so the caller
  // decides how (or whether) this got asked and passes the result in.
  trackerReachable: TrackerReachable;
  // The maintainer's home directory. A parameter rather than a `process.env`
  // read so a test can point it at a fixture tree.
  home: string;
}

export function gatherPreflightFacts(repoRoot: string, opts: GatherOpts): PreflightFacts {
  const config = gatherConfig(repoRoot);
  return {
    config,
    adapterMarker: gatherAdapterMarker(repoRoot),
    trackerReachable: opts.trackerReachable,
    pushCheck: gatherPushCheck(repoRoot),
    stampVersion: gatherStampVersion(config),
    availableRoles: gatherAvailableRoles(opts.home),
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

/** git config user.email, falling back to user.name; an error variant if neither is set.
 * Known limitation (maintainer-accepted): git identity may differ from the
 * tracker's own login; the tracker phrasebook bridges that gap per adapter. */
export function detectActor(repoRoot: string): ActorResult {
  const email = gitConfigValue(repoRoot, "user.email");
  if (email) return { actor: email, source: "git-user.email" };

  const name = gitConfigValue(repoRoot, "user.name");
  if (name) return { actor: name, source: "git-user.name" };

  return {
    error: "git config has neither user.email nor user.name set — Factory needs an actor identity to claim tickets",
  };
}
