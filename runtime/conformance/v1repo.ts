/**
 * v1-stamp fixture — a throwaway copy of THIS repo carrying exactly the
 * pieces that make it a legacy v1 stamp and the ones migration touches
 * (docs/agents/, AGENTS.md, CONTEXT.md, .gitignore), with a real git history
 * and a local bare "origin" so a non-interactive push check can pass without
 * ever touching the network. Modelled on coderepo.ts's mkCodeRepo/rmCodeRepo.
 *
 * The fixture's v1-ness comes from a checked-in snapshot of the adapter doc
 * (v1-adapter-doc.snapshot.md, see below) plus stripping .factory/ from the
 * copy — not from this repo's own current state, so migrating this repo for
 * real cannot break the fixture. The migration this fixture feeds runs only
 * against the copy this module makes; the real repo is never written to.
 *
 * bun v1repo.ts up|down [root]
 *
 * THROWAWAY, with one exception: the shared migration-host material at the
 * bottom is imported by both bin/migrate.ts and the sweep's slice-6 checks,
 * so a drift here would silently fork what each host tests.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gatherStampFacts, ADAPTER_DOC_PATH } from "../src/edges";
import { detectStamp } from "../src/stamp";
import { ROLE_TABLE, type RoleImpl } from "../src/roles";
import type { MergePolicy } from "../src/config";

// v1-adapter-doc.snapshot.md is this repo's own docs/agents/issue-tracker.md
// as it read while the repo itself was still v1-stamped. The fixture's
// v1-ness comes from that snapshot plus dropping .factory/ below — not from
// this repo's current state — so a later migration of this repo cannot break
// the fixture.
const V1_ADAPTER_DOC_SNAPSHOT_PATH = join(import.meta.dir, "v1-adapter-doc.snapshot.md");

// ───────────────────────────────────────────────────────────────── paths

// v1repo.ts lives at runtime/conformance/ — two levels below the repo root.
const REPO_ROOT = join(import.meta.dir, "../..");

// The files that make a repo a v1 stamp (docs/agents/issue-tracker.md's
// legacy heading) and the ones the v1-to-v2 step's docs/agents rules touch —
// not the whole repo, and never .git, node_modules, .superpowers, or runtime/
// (the fixture needs the stamp, not this repo's own history or tooling).
const COPIED_PATHS = ["docs/agents", "AGENTS.md", "CONTEXT.md", ".gitignore"];

// ──────────────────────────────────────────────────────────────────── git

function git(args: string[], cwd: string): void {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdin: "ignore", stdout: "ignore", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
  }
}

// ────────────────────────────────────────────────────────────── mk/rm v1repo

/**
 * Copies this repo's stamp-carrying files into a fresh mkdtempSync directory,
 * commits them under a local git identity, and wires a local bare "origin" so
 * preflight's non-interactive push check can succeed without any network
 * call. Asserts the copy really is a legacy v1 stamp — detectStamp must
 * return {k:"legacy-v1"} — and throws otherwise: a fixture that silently
 * stopped being v1 would make every downstream migration check vacuous.
 *
 * Everything after mkdtempSync runs inside a try that removes the partial
 * directory before rethrowing. The caller cannot clean this one up itself:
 * a throw happens before the `{ root }` return, so the caller's own `root`
 * is still undefined and its `finally` guard has no path to remove. Every
 * `git()` call can throw, not only the v1 assertion at the end.
 */
export function mkV1Repo(): { root: string } {
  const root = mkdtempSync(join(tmpdir(), "factory-v1repo-"));

  try {
    for (const rel of COPIED_PATHS) {
      const src = join(REPO_ROOT, rel);
      if (existsSync(src)) cpSync(src, join(root, rel), { recursive: true });
    }

    // The fixture's v1-ness must not depend on this repo's own current
    // state: pin the adapter doc to the snapshot and strip any .factory/
    // the copy picked up (it will exist once this repo itself migrates).
    writeFileSync(join(root, ADAPTER_DOC_PATH), readFileSync(V1_ADAPTER_DOC_SNAPSHOT_PATH));
    rmSync(join(root, ".factory"), { recursive: true, force: true });

    git(["init", "-b", "main"], root);
    git(["config", "user.email", "v1repo@factory.local"], root);
    git(["config", "user.name", "Factory V1Repo Fixture"], root);
    git(["add", ...COPIED_PATHS.filter((rel) => existsSync(join(root, rel)))], root);
    git(["commit", "-m", "Initial commit"], root);

    // A local bare remote, nested inside root (never `git add`ed, so it never
    // enters the tracked tree) — git push --dry-run needs somewhere real to
    // talk to, and this is real git talking to real git, just never over the
    // network, so preflight's push check can pass at zero cost.
    const bare = join(root, ".origin-bare");
    git(["init", "--bare", bare], root);
    git(["remote", "add", "origin", bare], root);

    const state = detectStamp(gatherStampFacts(root));
    if (state.k !== "legacy-v1") {
      throw new Error(`mkV1Repo: fixture is not a legacy v1 stamp (detectStamp returned ${JSON.stringify(state)})`);
    }

    return { root };
  } catch (err) {
    rmV1Repo(root);
    throw err;
  }
}

export function rmV1Repo(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

// ───── shared v1-to-v2 migration-host material
//
// Single source for what bin/migrate.ts and the sweep's slice-6 checks both
// need identical: the real template values this repo renders to (established
// before this task ran — see task-8-brief.md), the tracker-reachable ask
// (reused rather than re-declared — it is the same probe sweep.ts already
// asks against the local markdown tracker fixture), and the merge-policy /
// attack-surface answers a v1 repo has no record of, which this host must
// actually supply.

const TEMPLATE_PATH = join(REPO_ROOT, "templates/stamp/docs/agents/issue-tracker-linear.md");

// This repo's own real values. Rendering the template with these leaves zero
// leftover placeholders (verified before this task started).
export const REPO_TEMPLATE_VALUES = {
  PROJECT_NAME: "Factory",
  TEAM_NAME: "Side projects",
  TEAM_KEY: "SIDEPRO",
  LINEAR_PROJECT_URL: "https://linear.app/side-projects-p/project/factory-99c50a0b88d2",
} as const;

/** This repo's own Linear adapter template, rendered with its real values —
 * migrate.ts's planMigration input, and the text an adopt-theirs choice
 * writes when the fixture's doc has genuinely drifted from it. */
export function renderRealLinearAdapterDoc(): string {
  let text = readFileSync(TEMPLATE_PATH, "utf8");
  for (const [key, value] of Object.entries(REPO_TEMPLATE_VALUES)) {
    text = text.replaceAll(`{{${key}}}`, value);
  }
  return text;
}

// The v1-to-v2 step's two fresh questions carry no default (PROTOCOL.md "## Migration")
// — the host answers as the maintainer would, not as a harness would, so
// no ask is dispatched for either. "squash" matches this repo's own history
// (`git log --merges` returns nothing — every merge here already lands as a
// single commit); attackSurface false is the conservative starting point
// until a real triage sweep opts a milestone in.
export const CHOSEN_MERGE_POLICY: MergePolicy = "squash";
export const CHOSEN_ATTACK_SURFACE = false;

// The tracker-reachable ask — shared with sweep.ts's own reachable check
// (which asks this identical question against the same local markdown
// tracker fixture, conformance/fixture.ts) so the post-migration preflight's
// trackerReachable fact comes from one real, cheap harness call rather than
// live tracker credentials neither host has.
export const TRACKER_REACHABLE_QUESTION = "Can this project's tracker be reached right now?";
export const REACHABLE_SHAPE = `type ReachableAnswer = { result: "ok" } | { result: "unreachable"; why: string };`;

// ───── a fully populated skills/plugin home
//
// Every planning role's preferred AND fallback implementation installed, so
// resolveRoles (src/roles.ts) returns zero failures. Unlike planning.ts's own
// mkSkillsHome, which deliberately omits one implementation to exercise the
// fallback path, migration's preflight needs a clean board to prove the
// stamp itself, not planning-role resolution.

function installRoleImpl(home: string, impl: RoleImpl): void {
  if (impl.k === "plugin") {
    const [pluginName, skillName] = impl.name.split(":");
    mkdirSync(join(home, ".claude", "plugins", "cache", "test-marketplace", pluginName, "0.0.0", "skills", skillName), {
      recursive: true,
    });
  } else {
    mkdirSync(join(home, ".claude", "skills", impl.name), { recursive: true });
  }
}

export function mkFullSkillsHome(): { home: string } {
  const home = mkdtempSync(join(tmpdir(), "factory-migrate-skills-"));
  for (const spec of ROLE_TABLE) {
    installRoleImpl(home, spec.preferred);
    if (spec.fallback !== null) installRoleImpl(home, spec.fallback);
  }
  return { home };
}

export function rmSkillsHome(home: string): void {
  rmSync(home, { recursive: true, force: true });
}

// ──────────────────────────────────────────────────────────────────────── main

if (import.meta.main) {
  const cmd = process.argv[2];
  if (cmd === "up") {
    const { root } = mkV1Repo();
    console.log(`up: created v1 repo at ${root}`);
  } else if (cmd === "down") {
    const root = process.argv[3];
    if (!root) {
      console.error("usage: bun v1repo.ts down <root>");
      process.exit(1);
    }
    rmV1Repo(root);
    console.log(`down: removed ${root}`);
  } else {
    console.error("usage: bun v1repo.ts up|down [root]");
    process.exit(1);
  }
}
