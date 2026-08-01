// Pure migration-planning module (PRD #39 §6 "Steps"; PROTOCOL.md:610-643
// "Migration"): composes stamp.ts's detection and sections.ts's per-doc diff
// into the versioned step chain, and the v1-to-v2 step itself. No fs, no
// process, no clock: a step here receives the facts and texts a caller
// already gathered and returns what should be written — a later, impure
// module hosts it at the edge (writes config.json, applies the retrofitted
// doc).
//
// Idempotency is what makes migration safe to interrupt (PROTOCOL.md:620-623):
// a step recomputes its diff from the facts on disk every time, so a repeat
// run against an already-migrated repo finds nothing pending, and a crash
// mid-migration is repaired by simply running the same step again on the
// next run rather than needing to resume from where it stopped.

import { STAMP_VERSION } from "./version";
import type { StampState } from "./stamp";
import { diffDoc, applyMissing, type DocDiff } from "./sections";
import type { TrackerKind, MergePolicy } from "./config";
import { compareStamp } from "./preflight";

// ───── the versioned step chain

/** One entry in the migration chain (PROTOCOL.md:615-618): v1 to v2, and —
 * once a later slice defines it — v2 to v3 and beyond. `version` is the
 * stampVersion the step brings the repo to. */
export type MigrationStep = { k: "v1-to-v2"; version: string };

const ALL_STEPS: MigrationStep[] = [{ k: "v1-to-v2", version: STAMP_VERSION }];

/**
 * Every registered step whose version is strictly newer than the repo's and
 * no newer than the plugin's. A repo already at or ahead of the plugin's
 * version gets none back — ahead is the block PROTOCOL.md:641-642 describes
 * ("the plugin never downgrades files"), not a downgrade to run in reverse.
 */
export function pendingSteps(repoVersion: string, pluginVersion: string): MigrationStep[] {
  return ALL_STEPS.filter(
    (step) => compareStamp(step.version, repoVersion) > 0 && compareStamp(step.version, pluginVersion) <= 0,
  );
}

/**
 * Bridges `detectStamp`'s output into the version string `pendingSteps`
 * compares against. A legacy v1 stamp carries no version of its own — the
 * chain simply starts there, at "1.0.0". An unstamped repo has no migration
 * to run at all (PROTOCOL.md:94-98 sends it to the adopt skill instead), so
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

// PROTOCOL.md:628-629: detected from the H1 only, case-insensitively — never
// guessed from the rest of the document.
const TRACKER_H1_RE = /^#\s+Issue tracker:\s*(Linear|GitHub)\s*$/i;

function detectTrackerFromH1(adapterDoc: string): TrackerKind | null {
  const h1 = adapterDoc.trimStart().split("\n", 1)[0] ?? "";
  const match = h1.match(TRACKER_H1_RE);
  return match ? (match[1].toLowerCase() as TrackerKind) : null;
}

/**
 * What the v1-to-v2 step needs to ask (PROTOCOL.md:628-632): the tracker is
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

// ───── planning

export interface MigrationPlanInput {
  /** Current text of docs/agents/issue-tracker.md. */
  adapterDoc: string;
  /** The v2 template for the same tracker, placeholders already filled by
   * the caller — this module does no rendering of its own. */
  renderedAdapterDoc: string;
}

export interface MigrationPlan {
  /** sections.ts's verdict on the adapter doc against its template —
   * "matches" both when nothing is pending and when a pending step finds
   * nothing left to retrofit; either way the idempotent case. */
  docDiff: DocDiff;
  /** The adapter doc's content after retrofitting the sections `docDiff`
   * names, or null when there is nothing to retrofit. */
  retrofittedDoc: string | null;
  questions: MigrationQuestion[];
  detectedTracker: TrackerKind | null;
  /** Whether a pending step needs config.json written. */
  writesConfig: boolean;
}

const NOTHING_PENDING: MigrationPlan = {
  docDiff: { k: "matches" },
  retrofittedDoc: null,
  questions: [],
  detectedTracker: null,
  writesConfig: false,
};

/**
 * One combined plan for every pending step (PROTOCOL.md:615-618): a single
 * diff, a single set of questions, one approval — never one per step, no
 * matter how many steps are pending. `steps` is normally `pendingSteps`'s
 * own output; the chain having exactly one member today doesn't change the
 * shape a caller with several pending steps gets back.
 */
export function planMigration(steps: MigrationStep[], input: MigrationPlanInput): MigrationPlan {
  if (!steps.some((step) => step.k === "v1-to-v2")) return NOTHING_PENDING;

  const docDiff = diffDoc(input.adapterDoc, input.renderedAdapterDoc);
  const retrofittedDoc = docDiff.k === "missing-sections" ? applyMissing(input.adapterDoc, docDiff.missing) : null;
  const { detectedTracker, questions } = v1ToV2Questions(input.adapterDoc);

  return { docDiff, retrofittedDoc, questions, detectedTracker, writesConfig: true };
}

// ───── rendering v1-to-v2's config.json

export interface V1ToV2Answers {
  tracker: TrackerKind;
  merge: MergePolicy;
  attackSurface: boolean;
}

/**
 * The v1-to-v2 step's config.json content (PROTOCOL.md:631-632): exactly the
 * four fields a v1 repo can now answer. `stampVersion` always comes from
 * `STAMP_VERSION` — never a literal, so a future version bump here can't
 * drift from the constant the rest of the runtime checks against.
 */
export function renderV1ToV2Config(answers: V1ToV2Answers): string {
  const config = {
    stampVersion: STAMP_VERSION,
    tracker: { kind: answers.tracker },
    merge: { policy: answers.merge },
    attackSurface: answers.attackSurface,
  };
  return JSON.stringify(config, null, 2) + "\n";
}
