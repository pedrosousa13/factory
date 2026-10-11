// Edge module (fs/git allowed, thin fact-gathering). No pure logic lives
// here — this only reads disk and shells out to git, and hands the results
// to the pure modules (config.ts, marker.ts, preflight.ts) that decide what
// they mean.

import { existsSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { parseConfig, type ParseResult } from "./config";
import { readMarker } from "./marker";
import { STAMP_VERSION } from "./version";
import { CONFIG_PATH } from "./paths";
import { ROLE_TABLE } from "./roles";
import type { AdapterMarker, PreflightFacts, PushCheck, StampVersion, TrackerReachable } from "./preflight";
import type { StampFacts } from "./stamp";
import type { GlossaryFacts, GlossaryRename } from "./migrate";

export { CONFIG_PATH };
export const ADAPTER_DOC_PATH = "docs/agents/issue-tracker.md";

// ───── config

function gatherConfig(repoRoot: string): "missing-file" | ParseResult {
  const path = join(repoRoot, CONFIG_PATH);
  if (!existsSync(path)) return "missing-file";
  return parseConfig(readFileSync(path, "utf8"));
}

// ───── adapter marker

// Shared with gatherStampFacts below, which needs the full text rather than
// the parsed marker readMarker throws the rest of it away to produce.
function readAdapterDoc(repoRoot: string): string | null {
  const path = join(repoRoot, ADAPTER_DOC_PATH);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function gatherAdapterMarker(repoRoot: string): AdapterMarker {
  const doc = readAdapterDoc(repoRoot);
  return doc === null ? "missing-file" : readMarker(doc);
}

// ───── glossary files (migrate.ts's v2-to-v3 step: the rename input and the
// rename itself)

const CONTEXT_MD_PATH = "CONTEXT.md";
const CONTEXT_MAP_MD_PATH = "CONTEXT-MAP.md";
const GLOSSARY_MD_PATH = "GLOSSARY.md";
const GLOSSARY_MAP_MD_PATH = "GLOSSARY-MAP.md";

/** Which of the four glossary file names exist on disk — migrate.ts's
 * planMigration decides what, if anything, to do with these; this function
 * only reads. */
export function gatherGlossaryFacts(repoRoot: string): GlossaryFacts {
  return {
    contextMd: existsSync(join(repoRoot, CONTEXT_MD_PATH)),
    contextMapMd: existsSync(join(repoRoot, CONTEXT_MAP_MD_PATH)),
    glossaryMd: existsSync(join(repoRoot, GLOSSARY_MD_PATH)),
    glossaryMapMd: existsSync(join(repoRoot, GLOSSARY_MAP_MD_PATH)),
  };
}

// Whether `path` is tracked by git — decided up front, with its own call,
// rather than by trying `git mv` and catching a failure: a bare catch there
// cannot tell "untracked, fall back to a plain rename" apart from any other
// failure (a corrupt index, an index.lock left behind by another process),
// and silently falling back on the latter would turn a `git mv` that should
// have thrown into an untracked, unstaged rename. `git ls-files
// --error-unmatch` exits non-zero exactly when the path isn't in the index.
function isTracked(repoRoot: string, path: string): boolean {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", path], {
      cwd: repoRoot,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Performs migrate.ts's planned renames with `git mv`, so the rename itself
 * lands in the repo's history the same way a maintainer running it by hand
 * would. Falls back to a plain fs rename when the file isn't tracked yet
 * (a fresh fixture, or a maintainer who never `git add`ed the glossary) —
 * `git mv` refuses an untracked path outright rather than renaming it.
 *
 * Throws if the destination already exists: `renameSync` overwrites on
 * POSIX, and `git mv` overwrites too with `-f`, which this call never
 * passes, but checking first means the untracked, fs-rename branch below
 * can't silently clobber a file either. migrate.ts's `glossaryRenames`
 * never plans a rename onto an existing destination, so this is a guard
 * against a caller that bypasses it, not a case this module expects to hit.
 *
 * `git mv` failing on a tracked path is left to throw — no catch around that
 * call swallows it into the fs-rename fallback, which `isTracked` above
 * exists precisely to make unnecessary.
 */
export function applyGlossaryRenames(repoRoot: string, renames: GlossaryRename[]): void {
  for (const { from, to } of renames) {
    if (existsSync(join(repoRoot, to))) {
      throw new Error(`applyGlossaryRenames: destination "${to}" already exists — refusing to overwrite it`);
    }
    if (isTracked(repoRoot, from)) {
      execFileSync("git", ["mv", from, to], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
    } else {
      renameSync(join(repoRoot, from), join(repoRoot, to));
    }
  }
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

// ───── stamp facts (stamp.ts's detectStamp input)

// parseConfig (config.ts) never throws — JSON.parse errors and shape errors
// both come back as `{ ok: false, errors }` — so no try/catch is needed here;
// "missing-file", ok:false, and an ok:true config with no stampVersion field
// all collapse to null, same rule as gatherStampVersion above.
export function gatherStampFacts(repoRoot: string): StampFacts {
  const config = gatherConfig(repoRoot);
  return {
    configVersion: config !== "missing-file" && config.ok ? config.config.stampVersion : null,
    adapterDoc: readAdapterDoc(repoRoot),
  };
}

// ───── planning-role implementations

const SKILLS_DIR = ".claude/skills";
const PLUGIN_CACHE_DIR = ".claude/plugins/cache";

// PROTOCOL.md "## Preflight: prerequisites, not the stamp", the dependent-skills
// check: read the `~/.claude/skills/` path itself — a missing or broken
// symlink there leaves the skill unavailable even if the source exists.
// existsSync follows symlinks, so a broken one reads as absent, which is what
// we want.
function skillInstalled(home: string, name: string): boolean {
  return existsSync(join(home, SKILLS_DIR, name));
}

// A directory listing where "nothing here" and "can't tell" both mean the
// same thing to a caller walking the plugin cache: no entries. existsSync
// alone isn't enough to guard readdirSync — it passes for a path that exists
// as a file, not a directory, and readdirSync then throws. Preflight's
// contract is to collect every failure and report them together, so a walk
// that can throw would crash preflight instead of just finding nothing.
function safeReaddir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

// PROTOCOL.md "## Preflight: prerequisites, not the stamp", the superpowers
// check: a plugin skill has no `~/.claude/skills/` path. It
// unpacks to
// `<home>/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/<skill>`,
// and both the marketplace and the version differ per machine — the protocol
// says the check must not care which marketplace it came from — so walk those
// two levels instead of naming them.
function pluginInstalled(home: string, id: string): boolean {
  const [pluginName, skillName] = id.split(":");
  if (pluginName === undefined || skillName === undefined) return false;

  const cache = join(home, PLUGIN_CACHE_DIR);

  for (const marketplace of safeReaddir(cache)) {
    const versions = join(cache, marketplace, pluginName);
    for (const version of safeReaddir(versions)) {
      if (existsSync(join(versions, version, "skills", skillName))) return true;
    }
  }
  return false;
}

export function gatherAvailableRoles(home: string): string[] {
  const names = new Set<string>();
  for (const spec of ROLE_TABLE) {
    for (const impl of [spec.preferred, spec.fallback]) {
      if (impl === null) continue;
      const found = impl.k === "plugin" ? pluginInstalled(home, impl.name) : skillInstalled(home, impl.name);
      if (found) names.add(impl.name);
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
    stampFacts: gatherStampFacts(repoRoot),
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
