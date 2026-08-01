import { test, expect } from "bun:test";
import { parseConfig, effective, LOCK_PATH, JOURNAL_PATH } from "../src/config";
import type { Detected } from "../src/config";
import { mergeDecision } from "../src/agentwork";

// ───── parseConfig: valid input

test("parses the full PRD example config", () => {
  const raw = JSON.stringify({
    stampVersion: "2.0.0",
    tracker: { kind: "github", repo: "owner/name" },
    merge: { policy: "human" },
    attackSurface: true,
  });

  const result = parseConfig(raw);

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.config).toEqual({
      stampVersion: "2.0.0",
      tracker: { kind: "github", repo: "owner/name" },
      merge: { policy: "human" },
      attackSurface: true,
    });
  }
});

test("absent optional keys are fine — no defaults are required in the file", () => {
  const raw = JSON.stringify({
    stampVersion: "2.0.0",
    tracker: { kind: "local" },
    merge: { policy: "squash" },
    attackSurface: false,
  });

  const result = parseConfig(raw);

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.config.maxWorkers).toBeUndefined();
    expect(result.config.answerWindowMinutes).toBeUndefined();
    expect(result.config.contextBudget).toBeUndefined();
    expect(result.config.notifierCommand).toBeUndefined();
    expect(result.config.trackerTokenVar).toBeUndefined();
    expect(result.config.merge.method).toBeUndefined();
    expect(result.config.tracker.repo).toBeUndefined();
  }
});

test("parses optional keys when present", () => {
  const raw = JSON.stringify({
    stampVersion: "2.0.0",
    tracker: { kind: "linear" },
    merge: { policy: "squash", method: "rebase" },
    attackSurface: false,
    maxWorkers: 4,
    answerWindowMinutes: 30,
    contextBudget: 100000,
    notifierCommand: "notify-send",
    trackerTokenVar: "LINEAR_TOKEN",
  });

  const result = parseConfig(raw);

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.config.maxWorkers).toBe(4);
    expect(result.config.answerWindowMinutes).toBe(30);
    expect(result.config.contextBudget).toBe(100000);
    expect(result.config.notifierCommand).toBe("notify-send");
    expect(result.config.trackerTokenVar).toBe("LINEAR_TOKEN");
    expect(result.config.merge.method).toBe("rebase");
  }
});

// ───── parseConfig: each always-ask key missing gets its own error

test("missing stampVersion is its own error", () => {
  const raw = JSON.stringify({
    tracker: { kind: "github", repo: "owner/name" },
    merge: { policy: "human" },
    attackSurface: true,
  });

  const result = parseConfig(raw);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain("stampVersion: required");
  }
});

test("missing tracker entirely is its own error", () => {
  const raw = JSON.stringify({
    stampVersion: "2.0.0",
    merge: { policy: "human" },
    attackSurface: true,
  });

  const result = parseConfig(raw);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain("tracker: required");
  }
});

test("tracker present but missing kind is its own error", () => {
  const raw = JSON.stringify({
    stampVersion: "2.0.0",
    tracker: {},
    merge: { policy: "human" },
    attackSurface: true,
  });

  const result = parseConfig(raw);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain("tracker.kind: required");
  }
});

test("missing merge entirely reports merge.policy as required", () => {
  const raw = JSON.stringify({
    stampVersion: "2.0.0",
    tracker: { kind: "github", repo: "owner/name" },
    attackSurface: true,
  });

  const result = parseConfig(raw);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain("merge.policy: required");
  }
});

test("merge present but missing policy is its own error", () => {
  const raw = JSON.stringify({
    stampVersion: "2.0.0",
    tracker: { kind: "github", repo: "owner/name" },
    merge: {},
    attackSurface: true,
  });

  const result = parseConfig(raw);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain("merge.policy: required");
  }
});

test("missing attackSurface is its own error", () => {
  const raw = JSON.stringify({
    stampVersion: "2.0.0",
    tracker: { kind: "github", repo: "owner/name" },
    merge: { policy: "human" },
  });

  const result = parseConfig(raw);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain("attackSurface: required");
  }
});

// ───── parseConfig: all errors collected, never first-only

test("collects every missing always-ask key in one call", () => {
  const raw = JSON.stringify({});

  const result = parseConfig(raw);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain("stampVersion: required");
    expect(result.errors).toContain("tracker: required");
    expect(result.errors).toContain("merge.policy: required");
    expect(result.errors).toContain("attackSurface: required");
    expect(result.errors.length).toBe(4);
  }
});

test("collects unrelated errors together: unknown key, bad enum, missing key", () => {
  const raw = JSON.stringify({
    stampVersion: "2.0.0",
    tracker: { kind: "github", repo: "owner/name" },
    merge: { policy: "sqash" },
    attackSurface: true,
    bogus: true,
  });

  const result = parseConfig(raw);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain("bogus: unknown key");
    expect(result.errors).toContain(`merge.policy: "sqash" is not squash|merge|rebase|human`);
    expect(result.errors.length).toBe(2);
  }
});

// ───── parseConfig: unknown keys are errors

test("rejects an unknown top-level key", () => {
  const raw = JSON.stringify({
    stampVersion: "2.0.0",
    tracker: { kind: "github", repo: "owner/name" },
    merge: { policy: "human" },
    attackSurface: true,
    typoKey: "oops",
  });

  const result = parseConfig(raw);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain("typoKey: unknown key");
  }
});

test("rejects an unknown nested key under tracker and merge", () => {
  const raw = JSON.stringify({
    stampVersion: "2.0.0",
    tracker: { kind: "github", repo: "owner/name", extra: "oops" },
    merge: { policy: "human", extra: "oops" },
    attackSurface: true,
  });

  const result = parseConfig(raw);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain("tracker.extra: unknown key");
    expect(result.errors).toContain("merge.extra: unknown key");
  }
});

// ───── parseConfig: bad enum values are path-named

test("bad tracker.kind is path-named", () => {
  const raw = JSON.stringify({
    stampVersion: "2.0.0",
    tracker: { kind: "jira" },
    merge: { policy: "human" },
    attackSurface: true,
  });

  const result = parseConfig(raw);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain(`tracker.kind: "jira" is not github|linear|local`);
  }
});

test("bad merge.policy is path-named with the exact message shape", () => {
  const raw = JSON.stringify({
    stampVersion: "2.0.0",
    tracker: { kind: "github", repo: "owner/name" },
    merge: { policy: "sqash" },
    attackSurface: true,
  });

  const result = parseConfig(raw);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain(`merge.policy: "sqash" is not squash|merge|rebase|human`);
  }
});

test("bad merge.method is path-named", () => {
  const raw = JSON.stringify({
    stampVersion: "2.0.0",
    tracker: { kind: "github", repo: "owner/name" },
    merge: { policy: "human", method: "octopus" },
    attackSurface: true,
  });

  const result = parseConfig(raw);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain(`merge.method: "octopus" is not squash|merge|rebase`);
  }
});

// ───── parseConfig: malformed input

test("invalid JSON is a single error", () => {
  const result = parseConfig("{ not json");

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toMatch(/invalid JSON/);
  }
});

test("a JSON array at the top level is rejected", () => {
  const result = parseConfig("[]");

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain("config: must be a JSON object");
  }
});

// ───── parseConfig: type-mismatch branches

function baseValid(): Record<string, unknown> {
  return {
    stampVersion: "2.0.0",
    tracker: { kind: "github", repo: "owner/name" },
    merge: { policy: "human" },
    attackSurface: true,
  };
}

test("non-string stampVersion is rejected with JSON.stringify quoting", () => {
  const result = parseConfig(JSON.stringify({ ...baseValid(), stampVersion: 2 }));

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain("stampVersion: 2 is not a string");
  }
});

test("non-string tracker.repo is rejected", () => {
  const result = parseConfig(
    JSON.stringify({ ...baseValid(), tracker: { kind: "github", repo: 123 } }),
  );

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain("tracker.repo: 123 is not a string");
  }
});

test("non-string notifierCommand is rejected", () => {
  const result = parseConfig(JSON.stringify({ ...baseValid(), notifierCommand: 42 }));

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain("notifierCommand: 42 is not a string");
  }
});

test("non-string trackerTokenVar is rejected", () => {
  const result = parseConfig(JSON.stringify({ ...baseValid(), trackerTokenVar: false }));

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain("trackerTokenVar: false is not a string");
  }
});

test("non-boolean attackSurface is rejected", () => {
  const result = parseConfig(JSON.stringify({ ...baseValid(), attackSurface: "yes" }));

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain('attackSurface: "yes" is not a boolean');
  }
});

test("non-number maxWorkers is rejected", () => {
  const result = parseConfig(JSON.stringify({ ...baseValid(), maxWorkers: "3" }));

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain('maxWorkers: "3" is not a number');
  }
});

test("non-number answerWindowMinutes is rejected", () => {
  const result = parseConfig(JSON.stringify({ ...baseValid(), answerWindowMinutes: "15" }));

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain('answerWindowMinutes: "15" is not a number');
  }
});

test("non-number contextBudget is rejected", () => {
  const result = parseConfig(JSON.stringify({ ...baseValid(), contextBudget: null }));

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain("contextBudget: null is not a number");
  }
});

test("a null tracker is rejected as not-an-object", () => {
  const result = parseConfig(JSON.stringify({ ...baseValid(), tracker: null }));

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain("tracker: must be an object");
  }
});

test("an array tracker is rejected as not-an-object", () => {
  const result = parseConfig(JSON.stringify({ ...baseValid(), tracker: ["github"] }));

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain("tracker: must be an object");
  }
});

test("a null merge is rejected as not-an-object", () => {
  const result = parseConfig(JSON.stringify({ ...baseValid(), merge: null }));

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain("merge: must be an object");
  }
});

test("an array merge is rejected as not-an-object", () => {
  const result = parseConfig(JSON.stringify({ ...baseValid(), merge: ["human"] }));

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain("merge: must be an object");
  }
});

test("an enum value given as an array is quoted with JSON.stringify, not mistaken for a valid string", () => {
  const result = parseConfig(
    JSON.stringify({ ...baseValid(), merge: { policy: ["squash"] } }),
  );

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain(
      'merge.policy: ["squash"] is not squash|merge|rebase|human',
    );
    // Guards against the String(value) bug where String(["squash"]) === "squash",
    // which would render as the misleading `'squash' is not squash|merge|...`.
    expect(result.errors).not.toContain("merge.policy: 'squash' is not squash|merge|rebase|human");
  }
});

// ───── effective(): source tagging

const detected: Detected = {
  defaultBranch: "main",
};

test("effective() tags config-provided values as config", () => {
  const parsed = parseConfig(
    JSON.stringify({
      stampVersion: "2.0.0",
      tracker: { kind: "github", repo: "owner/name" },
      merge: { policy: "human", method: "squash" },
      attackSurface: true,
      maxWorkers: 3,
      answerWindowMinutes: 20,
      contextBudget: 50000,
      notifierCommand: "notify-send",
      trackerTokenVar: "GH_TOKEN",
    }),
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;

  const settings = effective(parsed.config, detected);

  expect(settings.stampVersion).toEqual({ value: "2.0.0", source: "config" });
  expect(settings.tracker).toEqual({
    value: { kind: "github", repo: "owner/name" },
    source: "config",
  });
  expect(settings.mergePolicy).toEqual({ value: "human", source: "config" });
  expect(settings.mergeMethod).toEqual({ value: "squash", source: "config" });
  expect(settings.attackSurface).toEqual({ value: true, source: "config" });
  expect(settings.maxWorkers).toEqual({ value: 3, source: "config" });
  expect(settings.answerWindowMinutes).toEqual({ value: 20, source: "config" });
  expect(settings.contextBudget).toEqual({ value: 50000, source: "config" });
  expect(settings.notifierCommand).toEqual({ value: "notify-send", source: "config" });
  expect(settings.trackerTokenVar).toEqual({ value: "GH_TOKEN", source: "config" });
});

test("effective() tags absent optional values as default or omits them", () => {
  const parsed = parseConfig(
    JSON.stringify({
      stampVersion: "2.0.0",
      tracker: { kind: "local" },
      merge: { policy: "squash" },
      attackSurface: false,
    }),
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;

  const settings = effective(parsed.config, detected);

  expect(settings.maxWorkers).toEqual({ value: 1, source: "default" });
  expect(settings.answerWindowMinutes).toEqual({ value: 15, source: "default" });
  // mergeMethod always resolves now (default here: absent + auto policy
  // "squash" → method "squash"). contextBudget has no PRD default yet —
  // omitted rather than invented.
  expect(settings.mergeMethod).toEqual({ value: "squash", source: "default" });
  expect(settings.contextBudget).toBeUndefined();
  expect(settings.notifierCommand).toBeUndefined();
  expect(settings.trackerTokenVar).toBeUndefined();
});

// ───── effective(): mergeMethod default matrix

test("effective() defaults mergeMethod to the policy value for an auto policy (merge)", () => {
  const parsed = parseConfig(
    JSON.stringify({
      stampVersion: "2.0.0",
      tracker: { kind: "local" },
      merge: { policy: "merge" },
      attackSurface: false,
    }),
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;

  const settings = effective(parsed.config, detected);

  expect(settings.mergeMethod).toEqual({ value: "merge", source: "default" });
});

test("effective() defaults mergeMethod to the policy value for an auto policy (rebase)", () => {
  const parsed = parseConfig(
    JSON.stringify({
      stampVersion: "2.0.0",
      tracker: { kind: "local" },
      merge: { policy: "rebase" },
      attackSurface: false,
    }),
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;

  const settings = effective(parsed.config, detected);

  expect(settings.mergeMethod).toEqual({ value: "rebase", source: "default" });
});

test("effective() defaults mergeMethod to squash when policy is human and method is absent", () => {
  const parsed = parseConfig(
    JSON.stringify({
      stampVersion: "2.0.0",
      tracker: { kind: "local" },
      merge: { policy: "human" },
      attackSurface: false,
    }),
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;

  const settings = effective(parsed.config, detected);

  expect(settings.mergeMethod).toEqual({ value: "squash", source: "default" });
});

test("effective() keeps the explicit config method even when it differs from the policy", () => {
  const parsed = parseConfig(
    JSON.stringify({
      stampVersion: "2.0.0",
      tracker: { kind: "local" },
      merge: { policy: "human", method: "rebase" },
      attackSurface: false,
    }),
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;

  const settings = effective(parsed.config, detected);

  expect(settings.mergeMethod).toEqual({ value: "rebase", source: "config" });
});

test("effective() tags detected facts as detected", () => {
  const parsed = parseConfig(
    JSON.stringify({
      stampVersion: "2.0.0",
      tracker: { kind: "local" },
      merge: { policy: "squash" },
      attackSurface: false,
    }),
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;

  const settings = effective(parsed.config, detected);

  expect(settings.defaultBranch).toEqual({ value: "main", source: "detected" });
});

test("effective() reports the fixed lock and journal paths", () => {
  const parsed = parseConfig(
    JSON.stringify({
      stampVersion: "2.0.0",
      tracker: { kind: "local" },
      merge: { policy: "squash" },
      attackSurface: false,
    }),
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;

  const settings = effective(parsed.config, detected);

  expect(settings.lockPath).toBe(".factory/run.lock");
  expect(settings.journalPath).toBe(".factory/journal.json");
  expect(settings.lockPath).toBe(LOCK_PATH);
  expect(settings.journalPath).toBe(JOURNAL_PATH);
});

// ───── effective() feeding mergeDecision
//
// The policy and the method are separate settings, resolved here and consumed
// by agentwork.ts's mergeDecision. Nothing wires the two together yet (the
// reducer arrives in a later slice), so these pin the seam: what effective()
// resolves is what mergeDecision must act on.

test("a rebase method under a human policy reaches mergeDecision as rebase, not squash", () => {
  const parsed = parseConfig(
    JSON.stringify({
      stampVersion: "2.0.0",
      tracker: { kind: "local" },
      merge: { policy: "human", method: "rebase" },
      attackSurface: false,
    }),
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;

  const settings = effective(parsed.config, detected);
  const decision = mergeDecision(settings.mergePolicy.value, settings.mergeMethod?.value, "approved");

  expect(settings.mergeMethod).toEqual({ value: "rebase", source: "config" });
  expect(decision).toEqual({ k: "merge", method: "rebase" });
});

test("an absent method under a human policy reaches mergeDecision as squash", () => {
  const parsed = parseConfig(
    JSON.stringify({
      stampVersion: "2.0.0",
      tracker: { kind: "local" },
      merge: { policy: "human" },
      attackSurface: false,
    }),
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;

  const settings = effective(parsed.config, detected);
  const decision = mergeDecision(settings.mergePolicy.value, settings.mergeMethod?.value, "approved");

  expect(decision).toEqual({ k: "merge", method: "squash" });
});

test("an auto policy's method survives the trip through effective() into mergeDecision", () => {
  const parsed = parseConfig(
    JSON.stringify({
      stampVersion: "2.0.0",
      tracker: { kind: "local" },
      merge: { policy: "squash", method: "rebase" },
      attackSurface: false,
    }),
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;

  const settings = effective(parsed.config, detected);
  const decision = mergeDecision(settings.mergePolicy.value, settings.mergeMethod?.value, null);

  expect(decision).toEqual({ k: "merge", method: "rebase" });
});
