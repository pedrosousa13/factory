import { test, expect } from "bun:test";
import {
  pendingSteps,
  repoVersionOf,
  v1ToV2Questions,
  planMigration,
  renderV1ToV2Config,
  type MigrationStep,
} from "../src/migrate";
import { LOOP_SECTION_HEADING } from "../src/stamp";
import { STAMP_VERSION } from "../src/version";
import { parseConfig } from "../src/config";

const LINEAR_V1_DOC = `# Issue tracker: Linear

Some prose.

## Conventions

Conventions body.

${LOOP_SECTION_HEADING}

How the loop talks to this tracker.
`;

const LINEAR_V1_DOC_MISSING_CONVENTIONS = `# Issue tracker: Linear

Some prose.

${LOOP_SECTION_HEADING}

How the loop talks to this tracker.
`;

const GITHUB_V1_DOC = `# Issue tracker: GitHub

Some prose.

${LOOP_SECTION_HEADING}

How the loop talks to this tracker.
`;

const UNRECOGNISED_V1_DOC = `# Issue tracker: Jira

Some prose.

${LOOP_SECTION_HEADING}

How the loop talks to this tracker.
`;

// ───── pendingSteps

test("pendingSteps returns exactly the v1-to-v2 step when the repo is at v1", () => {
  expect(pendingSteps("1.0.0", STAMP_VERSION)).toEqual([{ k: "v1-to-v2", version: STAMP_VERSION }]);
});

test("pendingSteps returns none when the repo is already at the plugin's version", () => {
  expect(pendingSteps(STAMP_VERSION, STAMP_VERSION)).toEqual([]);
});

test("pendingSteps returns none when the repo is newer than the plugin — the block, not a downgrade", () => {
  expect(pendingSteps("99.0.0", STAMP_VERSION)).toEqual([]);
});

// ───── repoVersion

test("repoVersion reads a v2 stamp's own version", () => {
  expect(repoVersionOf({ k: "v2", version: "1.5.0" })).toBe("1.5.0");
});

test("repoVersion treats a legacy v1 stamp as version 1.0.0, the chain's starting point", () => {
  expect(repoVersionOf({ k: "legacy-v1" })).toBe("1.0.0");
});

test("repoVersion returns null for an unstamped repo — it needs adopt, not migration", () => {
  expect(repoVersionOf({ k: "unstamped" })).toBeNull();
});

// ───── v1ToV2Questions: tracker detection

test("a Linear H1 is detected", () => {
  expect(v1ToV2Questions(LINEAR_V1_DOC).detectedTracker).toBe("linear");
});

test("a GitHub H1 is detected", () => {
  expect(v1ToV2Questions(GITHUB_V1_DOC).detectedTracker).toBe("github");
});

test("detection is case-insensitive", () => {
  const doc = `# issue tracker: LINEAR\n\nprose\n`;
  expect(v1ToV2Questions(doc).detectedTracker).toBe("linear");
});

test("an unrecognised H1 yields no detection, and the step asks cold", () => {
  const q = v1ToV2Questions(UNRECOGNISED_V1_DOC);
  expect(q.detectedTracker).toBeNull();
  expect(q.questions).toEqual([{ k: "tracker" }, { k: "merge-policy" }, { k: "attack-surface" }]);
});

// ───── v1ToV2Questions: exactly two questions, no defaults

test("a detected tracker is offered for confirmation, not folded into the two fresh questions", () => {
  const q = v1ToV2Questions(LINEAR_V1_DOC);
  expect(q.questions).toEqual([{ k: "merge-policy" }, { k: "attack-surface" }]);
});

test("neither the merge-policy nor the attack-surface question carries a default", () => {
  const q = v1ToV2Questions(LINEAR_V1_DOC);
  for (const question of q.questions) {
    expect("default" in question).toBe(false);
  }
});

// ───── planMigration: idempotency

test("planMigration against an already-migrated repo (no pending steps) has no file changes and no questions", () => {
  const plan = planMigration(pendingSteps(STAMP_VERSION, STAMP_VERSION), {
    adapterDoc: LINEAR_V1_DOC,
    renderedAdapterDoc: LINEAR_V1_DOC,
  });
  expect(plan.docDiff).toEqual({ k: "matches" });
  expect(plan.retrofittedDoc).toBeNull();
  expect(plan.questions).toEqual([]);
  expect(plan.writesConfig).toBe(false);
});

// ───── planMigration: wires sections.ts's diff and apply

test("planMigration retrofits a doc missing a whole section, using sections.ts's diff and apply", () => {
  const plan = planMigration(pendingSteps("1.0.0", STAMP_VERSION), {
    adapterDoc: LINEAR_V1_DOC_MISSING_CONVENTIONS,
    renderedAdapterDoc: LINEAR_V1_DOC,
  });
  expect(plan.docDiff.k).toBe("missing-sections");
  expect(plan.retrofittedDoc).toBe(LINEAR_V1_DOC);
  expect(plan.writesConfig).toBe(true);
  expect(plan.detectedTracker).toBe("linear");
  expect(plan.questions).toEqual([{ k: "merge-policy" }, { k: "attack-surface" }]);
});

// ───── planMigration: one combined plan for several pending steps

test("a combined plan over several pending steps still returns one plan, not one per step", () => {
  const steps: MigrationStep[] = [
    { k: "v1-to-v2", version: STAMP_VERSION },
    { k: "v1-to-v2", version: STAMP_VERSION },
  ];
  const plan = planMigration(steps, {
    adapterDoc: LINEAR_V1_DOC_MISSING_CONVENTIONS,
    renderedAdapterDoc: LINEAR_V1_DOC,
  });
  expect(Array.isArray(plan)).toBe(false);
  expect(plan.questions).toEqual([{ k: "merge-policy" }, { k: "attack-surface" }]);
});

// ───── renderV1ToV2Config

test("renderV1ToV2Config writes exactly the four fields a v1 repo can answer, stampVersion from STAMP_VERSION", () => {
  const content = renderV1ToV2Config({ tracker: "linear", merge: "squash", attackSurface: true });
  const parsed = JSON.parse(content);
  expect(Object.keys(parsed).sort()).toEqual(["attackSurface", "merge", "stampVersion", "tracker"]);
  expect(parsed.stampVersion).toBe(STAMP_VERSION);
});

test("renderV1ToV2Config's output parses as a valid config", () => {
  const content = renderV1ToV2Config({ tracker: "github", merge: "human", attackSurface: false });
  const result = parseConfig(content);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  expect(result.config).toEqual({
    stampVersion: STAMP_VERSION,
    tracker: { kind: "github" },
    merge: { policy: "human" },
    attackSurface: false,
  });
});
