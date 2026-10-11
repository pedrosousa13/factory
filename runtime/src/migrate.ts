// Pure migration-planning module (PRD #39 §6 "Steps"; PROTOCOL.md "## Migration"):
// composes stamp.ts's detection and sections.ts's per-doc diff
// into the versioned step chain, and the v1-to-v2 step itself. No fs, no
// process, no clock: a step here receives the facts and texts a caller
// already gathered and returns what should be written — a later, impure
// module hosts it at the edge (writes config.json, applies the retrofitted
// doc).
//
// Idempotency is what makes migration safe to interrupt (PROTOCOL.md "## Migration",
// "Idempotent by design"):
// a step recomputes its diff from the facts on disk every time, so a repeat
// run against an already-migrated repo finds nothing pending, and a crash
// mid-migration is repaired by simply running the same step again on the
// next run rather than needing to resume from where it stopped.
//
// That repair holds only if the host writes in one order: documents FIRST —
// the adapter doc, and v2-to-v3's glossary `git mv` — config.json LAST.
// config.json is the stamp, so it is the step's single commit point — a
// crash before it leaves the repo at legacy-v1 and the whole step re-runs,
// and the retrofit is itself idempotent (a second diffDoc over an
// already-retrofitted doc returns "matches", and a second rename plan over
// an already-renamed glossary returns no renames — see `renamePair` below).
// The reverse order strands a repo stamped v2 whose doc (or glossary file)
// was never retrofitted, and nothing downstream can see it: this module
// reports no pending steps and asserts docDiff "matches" for a doc that does
// not match. Recomputing the diff anyway would not save it — a recomputed
// diff cannot tell a crashed migration apart from a maintainer who edited
// the doc afterwards. The order is the fix. Both hosts follow it
// (bin/migrate.ts, conformance/sweep.ts).

import { STAMP_VERSION } from "./version";
import type { StampState } from "./stamp";
import { diffDoc, applyMissing, type DocDiff } from "./sections";
import type { TrackerKind, MergePolicy } from "./config";
import { compareStamp } from "./preflight";

// ───── the versioned step chain

/** One entry in the migration chain (PROTOCOL.md "## Migration", "Steps"): v1 to v2,
 * v2 to v3, and beyond as later slices define them. `version` is the
 * stampVersion the step brings the repo to. */
export type MigrationStep = { k: "v1-to-v2"; version: string } | { k: "v2-to-v3"; version: string };

// A step's `version` is a literal on purpose. The rule "never hardcode
// 2.0.0 — STAMP_VERSION is the single source of truth" is about the version
// this plugin stamps at *now*; a step's target is a historical fact, fixed
// when that step shipped. Binding this entry to STAMP_VERSION makes it read
// as the v1-to-v2 step to "whatever the current version is": bump
// STAMP_VERSION to 3.0.0 without adding a v2-to-v3 entry and every 2.0.0
// repo is offered the v1-to-v2 step, whose config render carries four
// fields and drops the rest. STAMP_VERSION stays in use everywhere it
// genuinely means "the version this plugin stamps at" — see
// renderV1ToV2Config below.
const ALL_STEPS: MigrationStep[] = [
  { k: "v1-to-v2", version: "2.0.0" },
  { k: "v2-to-v3", version: "3.0.0" },
];

/**
 * Every registered step whose version is strictly newer than the repo's and
 * no newer than the plugin's, in version order. A repo already at or ahead of
 * the plugin's version gets none back — ahead is the block PROTOCOL.md "## Migration"
 * describes ("the plugin never downgrades files"), not a downgrade to run in
 * reverse.
 *
 * The sort is what makes "applies each step in order" a property of the
 * versions rather than of how someone typed `ALL_STEPS`.
 */
export function pendingSteps(repoVersion: string, pluginVersion: string): MigrationStep[] {
  return ALL_STEPS.filter(
    (step) => compareStamp(step.version, repoVersion) > 0 && compareStamp(step.version, pluginVersion) <= 0,
  ).sort((a, b) => compareStamp(a.version, b.version));
}

/**
 * Bridges `detectStamp`'s output into the version string `pendingSteps`
 * compares against. A legacy v1 stamp carries no version of its own — the
 * chain simply starts there, at "1.0.0". An unstamped repo has no migration
 * to run at all (PROTOCOL.md "## Prerequisites: a stamped Project repo" sends it to the adopt
 * skill instead), so
 * it reads as null rather than guessing a version that would wrongly offer
 * the v1-to-v2 step to a repo that was never adopted.
 */
export function repoVersionOf(state: StampState): string | null {
  switch (state.k) {
    case "v2":
      return state.version;
    case "legacy-v1":
      return "1.0.0";
    case "unstamped":
      return null;
  }
}

// ───── the v1-to-v2 step's questions

export type MigrationQuestion =
  | { k: "tracker" } // only present when the H1 detection below fails — the step asks cold
  | { k: "merge-policy" }
  | { k: "attack-surface" };

export interface V1ToV2Questions {
  /** The tracker read off the legacy doc's H1, offered for one-tap
   * confirmation rather than folded into `questions` — confirming a
   * detected value is a different interaction than asking cold. Null when
   * the H1 matched neither known tracker; `questions` then carries a
   * `"tracker"` entry so the step asks after all. */
  detectedTracker: TrackerKind | null;
  questions: MigrationQuestion[];
}

// PROTOCOL.md "## Migration", the v1-to-v2 step: detected from the H1 only,
// case-insensitively — never
// guessed from the rest of the document.
const TRACKER_H1_RE = /^#\s+Issue tracker:\s*(Linear|GitHub)\s*$/i;

function detectTrackerFromH1(adapterDoc: string): TrackerKind | null {
  const h1 = adapterDoc.trimStart().split("\n", 1)[0] ?? "";
  const match = h1.match(TRACKER_H1_RE);
  return match ? (match[1].toLowerCase() as TrackerKind) : null;
}

/**
 * What the v1-to-v2 step needs to ask (PROTOCOL.md "## Migration"): the tracker is
 * detected and offered for confirmation, never asked cold when detection
 * succeeds; merge policy and attack surface have no v1 record at all, so
 * they are always asked fresh, with no default.
 */
export function v1ToV2Questions(adapterDoc: string): V1ToV2Questions {
  const detectedTracker = detectTrackerFromH1(adapterDoc);
  const questions: MigrationQuestion[] = [];
  if (detectedTracker === null) questions.push({ k: "tracker" });
  questions.push({ k: "merge-policy" }, { k: "attack-surface" });
  return { detectedTracker, questions };
}

// ───── the v2-to-v3 step: the glossary rename
//
// Upstream mattpocock/skills renamed the domain-glossary file CONTEXT.md to
// GLOSSARY.md (and CONTEXT-MAP.md to GLOSSARY-MAP.md); the Factory's skills
// now only look for the new names. v2-to-v3's job is `git mv` for whichever
// of the two pairs is present — a plan, not a write: this module has no fs,
// so it only says which renames the facts call for.

/** One rename v2-to-v3 wants performed, old path to new path. */
export type GlossaryRename = { from: string; to: string };

/** Which of the four glossary file names exist on disk, gathered by the host
 * (bin/migrate.ts, conformance/sweep.ts) — this module stays pure and never
 * reads fs itself. */
export interface GlossaryFacts {
  contextMd: boolean;
  contextMapMd: boolean;
  glossaryMd: boolean;
  glossaryMapMd: boolean;
}

const NO_GLOSSARY_FILES: GlossaryFacts = {
  contextMd: false,
  contextMapMd: false,
  glossaryMd: false,
  glossaryMapMd: false,
};

/**
 * One pair's rename decision, idempotent by construction: the new name
 * already there and the old one gone means a previous run (or a repo that
 * never had the old name) already did this, so nothing is pending; neither
 * name existing means the glossary is created lazily and there is nothing to
 * rename yet; both existing is a conflict this module refuses to resolve by
 * overwriting — it surfaces as a blocking item for the maintainer instead.
 */
function renamePair(from: string, to: string, fromExists: boolean, toExists: boolean): {
  rename: GlossaryRename | null;
  conflict: GlossaryRename | null;
} {
  if (fromExists && toExists) return { rename: null, conflict: { from, to } };
  if (fromExists && !toExists) return { rename: { from, to }, conflict: null };
  return { rename: null, conflict: null };
}

function glossaryRenames(facts: GlossaryFacts): { renames: GlossaryRename[]; conflicts: GlossaryRename[] } {
  const pairs = [
    renamePair("CONTEXT.md", "GLOSSARY.md", facts.contextMd, facts.glossaryMd),
    renamePair("CONTEXT-MAP.md", "GLOSSARY-MAP.md", facts.contextMapMd, facts.glossaryMapMd),
  ];
  return {
    renames: pairs.map((p) => p.rename).filter((r): r is GlossaryRename => r !== null),
    conflicts: pairs.map((p) => p.conflict).filter((c): c is GlossaryRename => c !== null),
  };
}

// ───── planning

export interface MigrationPlanInput {
  /** Current text of docs/agents/issue-tracker.md.
   *
   * One doc, one template: a v1-to-v2-shaped signature. A second step that
   * touches a different template file, or several, forces this pair open into
   * a per-file collection. Left as is until a second step exists to shape it. */
  adapterDoc: string;
  /** The v2 template for the same tracker, placeholders already filled by
   * the caller — this module does no rendering of its own. */
  renderedAdapterDoc: string;
  /** Which glossary files exist on disk — v2-to-v3's rename input. Omitted
   * (or all false) is read the same as "neither name exists", which is
   * harmless when no v2-to-v3 step is pending and simply plans no rename
   * when one is. */
  glossaryFiles?: GlossaryFacts;
}

export interface MigrationPlan {
  /** sections.ts's verdict on the adapter doc against its template. A pending
   * step computes it. With no pending step there is no doc to compare against
   * a template, so `NOTHING_PENDING` below asserts "matches" rather than
   * computing it — see the note there. */
  docDiff: DocDiff;
  /** The adapter doc's content after retrofitting the sections `docDiff`
   * names, or null when there is nothing to retrofit. */
  retrofittedDoc: string | null;
  questions: MigrationQuestion[];
  detectedTracker: TrackerKind | null;
  /** Whether a pending step needs config.json written. */
  writesConfig: boolean;
  /** v2-to-v3's `git mv` plan: empty when no v2-to-v3 step is pending, when
   * neither old name exists, or when the maintainer already finished the
   * rename on a previous run. */
  renames: GlossaryRename[];
  /** v2-to-v3 pairs where both the old and new name exist — never
   * auto-resolved, surfaced here as a blocking item instead. Empty in every
   * other case. */
  glossaryConflicts: GlossaryRename[];
}

// `docDiff: "matches"` here is asserted, not computed: with no pending step
// this module never calls diffDoc at all. The assertion is only as true as
// the write order above — a host that wrote config.json before the adapter
// doc and then crashed leaves a repo whose stamp says v2 and whose doc was
// never retrofitted, and every later run lands here and reports "matches"
// for a doc that does not match.
const NOTHING_PENDING: MigrationPlan = {
  docDiff: { k: "matches" },
  retrofittedDoc: null,
  questions: [],
  detectedTracker: null,
  writesConfig: false,
  renames: [],
  glossaryConflicts: [],
};

/**
 * One combined plan for every pending step (PROTOCOL.md "## Migration", "Steps"): a single
 * diff, a single set of questions, one approval — never one per step, no
 * matter how many steps are pending. `steps` is normally `pendingSteps`'s own
 * output; a v1 repo's chain carries both v1-to-v2 and v2-to-v3 and still
 * gets back this one shape, not two plans glued together.
 */
export function planMigration(steps: MigrationStep[], input: MigrationPlanInput): MigrationPlan {
  // Exhaustive over MigrationStep's tags, so declaring a v3-to-v4 variant is
  // a compile error here rather than a chain of [v3-to-v4] quietly reporting
  // "nothing pending".
  let hasV1ToV2 = false;
  let hasV2ToV3 = false;
  for (const step of steps) {
    // Switched on the tag in a local, not on `step` itself: MigrationStep is
    // a genuine union now, so TypeScript already narrows `step` in a
    // default arm — switching on the tag keeps the two arms reading
    // identically, and the never-assignment below still catches a third
    // variant added without a case here.
    const tag = step.k;
    switch (tag) {
      case "v1-to-v2":
        hasV1ToV2 = true;
        break;
      case "v2-to-v3":
        hasV2ToV3 = true;
        break;
      default: {
        const unhandled: never = tag;
        throw new Error(`planMigration: unhandled migration step "${String(unhandled)}"`);
      }
    }
  }
  if (!hasV1ToV2 && !hasV2ToV3) return NOTHING_PENDING;

  const docDiff = diffDoc(input.adapterDoc, input.renderedAdapterDoc);
  const retrofittedDoc = docDiff.k === "missing-sections" ? applyMissing(input.adapterDoc, docDiff.missing) : null;

  // v1-to-v2 is the only step with questions of its own — tracker detection,
  // merge policy, attack surface. v2-to-v3 asks no new questions: the
  // glossary rename is derived entirely from facts already on disk.
  const { detectedTracker, questions } = hasV1ToV2
    ? v1ToV2Questions(input.adapterDoc)
    : { detectedTracker: null, questions: [] };

  const { renames, conflicts } = hasV2ToV3
    ? glossaryRenames(input.glossaryFiles ?? NO_GLOSSARY_FILES)
    : { renames: [], conflicts: [] };

  return {
    docDiff,
    retrofittedDoc,
    questions,
    detectedTracker,
    writesConfig: true,
    renames,
    glossaryConflicts: conflicts,
  };
}

// ───── rendering v1-to-v2's config.json

export interface V1ToV2Answers {
  tracker: TrackerKind;
  /** The `owner/name` slug, on github only — derived from the git remote, the
   * way /factory-adopt derives it, never asked for. Optional because linear
   * has no use for it and a legacy repo may not resolve one. */
  repo?: string;
  merge: MergePolicy;
  attackSurface: boolean;
}

/**
 * The v1-to-v2 step's config.json content (PROTOCOL.md "## Migration"): exactly the
 * four fields a v1 repo can now answer. `stampVersion` always comes from
 * `STAMP_VERSION` — never a literal, so a future version bump here can't
 * drift from the constant the rest of the runtime checks against.
 *
 * `tracker.repo` rides inside `tracker`, so it is not a fifth field: the
 * top-level key set is the same four either way. It is written on github
 * only, and only when the caller resolved one — linear scopes issues by
 * project and team, so a repo slug there would be a value nothing reads.
 */
export function renderV1ToV2Config(answers: V1ToV2Answers): string {
  const writeRepo = answers.tracker === "github" && answers.repo !== undefined;
  const config = {
    stampVersion: STAMP_VERSION,
    tracker: writeRepo ? { kind: answers.tracker, repo: answers.repo } : { kind: answers.tracker },
    merge: { policy: answers.merge },
    attackSurface: answers.attackSurface,
  };
  return JSON.stringify(config, null, 2) + "\n";
}

// ───── rendering v2-to-v3's config.json

/**
 * The v2-to-v3 step's config.json content (PROTOCOL.md "## Migration"): bumps
 * `stampVersion` to `STAMP_VERSION` and preserves every other field
 * verbatim — including `notifierCommand` and any key this module doesn't
 * know about. Unlike `renderV1ToV2Config`, which synthesizes a config.json
 * from four freshly-answered fields because a v1 repo has none yet, a v2
 * repo already has a config; the only field v2-to-v3 touches is the version
 * number itself.
 *
 * Parses the raw JSON directly rather than through `parseConfig`:
 * `parseConfig` rejects unknown top-level keys, and preserving anything
 * unknown is exactly what this function promises instead. Reassigning an
 * existing key's value keeps its position in `JSON.stringify`'s output, so
 * the rest of the file's field order survives untouched.
 */
export function renderStampBump(existingConfigText: string): string {
  const config = JSON.parse(existingConfigText) as Record<string, unknown>;
  config.stampVersion = STAMP_VERSION;
  return JSON.stringify(config, null, 2) + "\n";
}
