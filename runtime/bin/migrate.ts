#!/usr/bin/env bun
// Edge entry (bun, fs allowed): the v1-to-v2 migration host loop, slice 6's
// capability end to end against a real copy of THIS repo's own v1 stamp
// (conformance/v1repo.ts's mkV1Repo) — detects the fixture as v1, plans the
// migration, confirms the detected tracker, supplies the two answers a v1
// repo has no record of, applies the plan (writing config.json and resolving
// the adapter doc per the maintainer's offer), then runs a full preflight
// against the migrated copy and shows it green at the current version.
// Verifies every claim against the fixture's own files on disk, never
// against a plan field or an agent's say-so. Prints an honest per-step
// scoreboard and exits non-zero on any failure. Removes the v1 repo fixture
// and the local markdown tracker fixture on every path.
//
// bun migrate.ts [claude|codex|pi]   — defaults to claude
//
// THROWAWAY: no tests, no error handling beyond what keeps it runnable.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { down, up } from "../conformance/fixture";
import {
  CHOSEN_ATTACK_SURFACE,
  CHOSEN_MERGE_POLICY,
  mkFullSkillsHome,
  mkV1Repo,
  REACHABLE_SHAPE,
  renderRealLinearAdapterDoc,
  rmSkillsHome,
  rmV1Repo,
  TRACKER_REACHABLE_QUESTION,
} from "../conformance/v1repo";
import { ADAPTER_DOC_PATH, CONFIG_PATH, gatherPreflightFacts, gatherStampFacts } from "../src/edges";
import { runHarness, type HarnessName } from "../src/harness";
import { askWithRetry, buildPrompt, type Runner } from "../src/askloop";
import { detectStamp } from "../src/stamp";
import { pendingSteps, planMigration, renderV1ToV2Config, repoVersionOf } from "../src/migrate";
import { preflight, type TrackerReachable } from "../src/preflight";
import { STAMP_VERSION } from "../src/version";

const DIR = import.meta.dir;
const PHRASEBOOK_PATH = join(DIR, "../conformance/phrasebook.md");
// The tracker-reachable ask below reuses the local markdown tracker fixture
// (conformance/fixture.ts's up()), so it runs with the same cwd sweep.ts
// itself uses for that exact ask — the fixture's tracker/tickets/ directory
// sits directly under conformance/, matching the phrasebook's literal
// relative path. Asking from runtime/bin instead (this file's own DIR) gives
// a harness with Bash/Glob access a mismatch to notice — this repo's own
// docs/agents/issue-tracker.md names Linear, so a harness asked to judge
// "reachable right now" from there searches wider, finds the fixture is
// elsewhere, and correctly (but unhelpfully, for this smoke test) reports it
// as not this project's own tracker.
const CONFORMANCE_DIR = join(DIR, "../conformance");

// ───────────────────────────────────────────────────────────────── scoreboard

type Step = { name: string; status: string; ok: boolean; note?: string };

function step(name: string, status: string, ok: boolean, note?: string): Step {
  return { name, status, ok, note };
}

function printSteps(steps: Step[]): void {
  const cols = ["step", "status", "ok?", "note"];
  const rows = steps.map((s) => [s.name, s.status, s.ok ? "yes" : "no", s.note ?? ""]);
  const widths = cols.map((c, i) => Math.max(c.length, ...rows.map((row) => row[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log("\n=== scoreboard ===");
  console.log(line(cols));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(line(row));
}

// ───────────────────────────────────────────────────────────────── argv

function parseHarness(argv: string[]): HarnessName {
  const name = argv[2];
  if (name === undefined) return "claude";
  if (name === "claude" || name === "codex" || name === "pi") return name;
  console.error("usage: bun migrate.ts [claude|codex|pi]");
  process.exit(1);
}

// ──────────────────────────────────────────────────────────────────── main

function main(): void {
  const harness = parseHarness(process.argv);
  const steps: Step[] = [];

  console.log(`\n=== v1-to-v2 migration (${harness}) ===`);

  // The local markdown tracker fixture — the one harness ask below (tracker
  // reachability, inside the final preflight) needs it. Unrelated to the v1
  // repo fixture itself; matches planning.ts's own up()/down() bracketing.
  up();

  let root: string | undefined;
  let home: string | undefined;

  try {
    // Both inside the try: mkV1Repo() throws on its own brief-mandated v1
    // assertion (v1repo.ts) if the fixture ever stopped being v1 — that
    // failure still has to reach the finally below, or the tracker fixture
    // up() just wrote is never removed and this mkdtemp call leaks.
    root = mkV1Repo().root;
    home = mkFullSkillsHome().home;

    // ── step 1: detect the fixture as v1, off its own files — not trusted
    // from mkV1Repo's internal assertion.
    const preState = detectStamp(gatherStampFacts(root));
    steps.push(step("detect v1 stamp", preState.k, preState.k === "legacy-v1", JSON.stringify(preState)));

    const repoVersion = repoVersionOf(preState);
    const chain = repoVersion === null ? [] : pendingSteps(repoVersion, STAMP_VERSION);
    const chainOk = chain.length === 1 && chain[0].k === "v1-to-v2";
    steps.push(step("pendingSteps", chain.map((s) => s.k).join(",") || "none", chainOk));

    // ── step 2: plan the migration — this repo's own template, rendered with
    // its real values, against the fixture's current adapter doc.
    const renderedAdapterDoc = renderRealLinearAdapterDoc();
    const currentAdapterDoc = readFileSync(join(root, ADAPTER_DOC_PATH), "utf8");
    const plan = planMigration(chain, { adapterDoc: currentAdapterDoc, renderedAdapterDoc });

    // ── step 3: confirm the detected tracker — expected "linear" (a stale
    // adapter doc relative to the real world, see GitHub #52, but correct for
    // what migration itself checks: the H1 the legacy doc actually carries).
    const trackerConfirmed = plan.detectedTracker === "linear";
    steps.push(
      step(
        "confirm detected tracker",
        plan.detectedTracker ?? "none (asked cold)",
        trackerConfirmed,
        trackerConfirmed ? undefined : `expected "linear", got ${JSON.stringify(plan.detectedTracker)}`,
      ),
    );

    // ── step 4: the two fresh questions — neither has a default, so the host
    // supplies real answers rather than defaulting either.
    const questionKinds = plan.questions.map((q) => q.k).sort();
    const questionsOk = JSON.stringify(questionKinds) === JSON.stringify(["attack-surface", "merge-policy"]);
    steps.push(
      step(
        "fresh questions",
        plan.questions.map((q) => q.k).join(",") || "none",
        questionsOk,
        `answered: merge=${CHOSEN_MERGE_POLICY}, attackSurface=${CHOSEN_ATTACK_SURFACE}`,
      ),
    );

    // ── step 5: apply — the adapter doc FIRST, config.json LAST. The order
    // is load-bearing, not stylistic: config.json is the stamp, so writing it
    // last makes it this step's single commit point. A crash before it leaves
    // the fixture at legacy-v1 and the whole step re-runs idempotently. The
    // reverse order strands a repo stamped v2 whose doc was never retrofitted,
    // which no later run can detect (see src/migrate.ts's header).
    let adapterAction: string;
    // The text this host means to leave on disk, whichever branch runs — the
    // row below is scored against the file, not against the branch taken.
    let adapterWanted: string;
    if (plan.docDiff.k === "other-difference") {
      // The maintainer's three offers on a genuine drift (SKILL.md:254-256)
      // are adopt-theirs / keep-mine / merge-by-hand. Shown, not silent: this
      // is the exact offer a maintainer would see before approving it. This
      // host plays maintainer and takes adopt-theirs.
      console.log(
        `  adapter doc offer: ${plan.docDiff.detail} — adopt-theirs / keep-mine / merge-by-hand; taking adopt-theirs`,
      );
      writeFileSync(join(root, ADAPTER_DOC_PATH), renderedAdapterDoc);
      adapterAction = "adopt-theirs";
      adapterWanted = renderedAdapterDoc;
    } else if (plan.docDiff.k === "missing-sections") {
      if (plan.retrofittedDoc === null) throw new Error("missing-sections diff carried no retrofittedDoc");
      writeFileSync(join(root, ADAPTER_DOC_PATH), plan.retrofittedDoc);
      adapterAction = "retrofit";
      adapterWanted = plan.retrofittedDoc;
    } else {
      adapterAction = "matches (no write needed)";
      adapterWanted = currentAdapterDoc;
    }
    // Scored against the fixture's own file, not hardcoded: this row is
    // evidence, and a row that always reads "yes" is evidence of nothing.
    const adapterApplied = readFileSync(join(root, ADAPTER_DOC_PATH), "utf8") === adapterWanted;
    steps.push(
      step(
        "apply adapter doc",
        `${plan.docDiff.k} -> ${adapterAction}`,
        adapterApplied,
        adapterApplied ? undefined : "adapter doc on disk does not match what this host wrote",
      ),
    );

    // config.json LAST — the step's single commit point (see step 5's note).
    mkdirSync(join(root, ".factory"), { recursive: true });
    const configText = renderV1ToV2Config({
      tracker: plan.detectedTracker ?? "linear",
      merge: CHOSEN_MERGE_POLICY,
      attackSurface: CHOSEN_ATTACK_SURFACE,
    });
    writeFileSync(join(root, CONFIG_PATH), configText);

    // The drift this run exists to exercise. A scoreboard row, not a bare
    // console.log: printing CONTRADICTION while the run still reports PASS
    // makes the scoreboard lie.
    const driftAsExpected = plan.docDiff.k === "other-difference";
    if (!driftAsExpected) {
      console.log(
        `  CONTRADICTION: expected docDiff.k "other-difference" (the Wayfinding-operations drift established before this run), got "${plan.docDiff.k}"`,
      );
    }
    steps.push(
      step(
        "expected drift",
        plan.docDiff.k,
        driftAsExpected,
        plan.docDiff.k === "other-difference" ? plan.docDiff.detail : `CONTRADICTION: expected "other-difference"`,
      ),
    );

    // ── verify against the fixture's own files on disk — never against the
    // plan's fields or any agent's say-so.
    const configOnDisk = JSON.parse(readFileSync(join(root, CONFIG_PATH), "utf8"));
    const configKeys = Object.keys(configOnDisk).sort().join(",");
    const configFieldsOk =
      configKeys === "attackSurface,merge,stampVersion,tracker" &&
      configOnDisk.stampVersion === STAMP_VERSION &&
      configOnDisk.tracker.kind === "linear" &&
      configOnDisk.merge.policy === CHOSEN_MERGE_POLICY &&
      configOnDisk.attackSurface === CHOSEN_ATTACK_SURFACE;
    steps.push(step("verify file: config.json", JSON.stringify(configOnDisk), configFieldsOk));

    const adapterDocOnDisk = readFileSync(join(root, ADAPTER_DOC_PATH), "utf8");
    const markerPresent = /<!--\s*factory:tracker\s+kind=linear\s*-->/.test(adapterDocOnDisk);
    steps.push(step("verify file: adapter doc marker", markerPresent ? "present" : "missing", markerPresent));

    const postState = detectStamp(gatherStampFacts(root));
    const noLongerLegacy = postState.k === "v2" && postState.version === STAMP_VERSION;
    steps.push(step("verify: detectStamp post-migration", JSON.stringify(postState), noLongerLegacy));

    // ── step 6: full preflight against the migrated copy, at the current
    // version. trackerReachable is the one live ask this whole host makes —
    // the same probe sweep.ts already runs against the same local markdown
    // tracker fixture, so this proves the real askWithRetry/harness path
    // without needing live tracker credentials neither host has.
    const phrasebook = readFileSync(PHRASEBOOK_PATH, "utf8");
    const runner: Runner = (prompt) => runHarness(harness, prompt, CONFORMANCE_DIR);
    const reachablePrompt = buildPrompt(TRACKER_REACHABLE_QUESTION, phrasebook, REACHABLE_SHAPE);
    const reachableOutcome = askWithRetry(runner, { k: "tracker.reachable" }, reachablePrompt);
    const trackerReachable: TrackerReachable =
      reachableOutcome.status !== "failed"
        ? reachableOutcome.answer
        : { result: "unreachable", why: `harness ask failed: ${reachableOutcome.whys[1]}` };
    steps.push(
      step(
        "tracker.reachable (harness ask)",
        reachableOutcome.status,
        trackerReachable.result === "ok",
        trackerReachable.result === "unreachable" ? trackerReachable.why : undefined,
      ),
    );

    const preflightFacts = gatherPreflightFacts(root, { trackerReachable, home });
    const verdict = preflight(preflightFacts);
    steps.push(
      step(
        "full preflight (post-migration)",
        verdict.ok ? "green" : "red",
        verdict.ok,
        verdict.ok ? undefined : JSON.stringify(verdict.failures.map((f) => f.what)),
      ),
    );

    const atCurrentVersion = preflightFacts.stampVersion.repo === STAMP_VERSION;
    steps.push(
      step(
        "preflight at current version",
        `repo=${preflightFacts.stampVersion.repo ?? "none"} plugin=${preflightFacts.stampVersion.plugin}`,
        atCurrentVersion,
      ),
    );

    printSteps(steps);
    const allOk = steps.every((s) => s.ok);
    console.log(`\noverall: ${allOk ? "PASS" : "FAIL"}`);
    if (!allOk) process.exitCode = 1;
  } finally {
    // Each only if it was actually created — mkFullSkillsHome() could throw
    // before home is assigned, or mkV1Repo() before root is, and only
    // whichever constructors actually ran need tearing down.
    if (home !== undefined) rmSkillsHome(home);
    if (root !== undefined) rmV1Repo(root);
    down();
  }
}

main();
