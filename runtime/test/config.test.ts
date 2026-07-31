import { test, expect } from "bun:test";
import { parseConfig, effective, LOCK_PATH, JOURNAL_PATH } from "../src/config";
import type { Detected } from "../src/config";

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
    expect(result.errors).toContain("merge.policy: 'sqash' is not squash|merge|rebase|human");
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
    expect(result.errors).toContain("tracker.kind: 'jira' is not github|linear|local");
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
    expect(result.errors).toContain("merge.policy: 'sqash' is not squash|merge|rebase|human");
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
    expect(result.errors).toContain("merge.method: 'octopus' is not squash|merge|rebase");
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

// ───── effective(): source tagging

const detected: Detected = {
  defaultBranch: "main",
  harnessKind: "claude-code",
  notificationChannel: "claude-code-notification-hook",
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
  // No PRD placeholder exists yet for these — omitted rather than invented.
  expect(settings.mergeMethod).toBeUndefined();
  expect(settings.contextBudget).toBeUndefined();
  expect(settings.notifierCommand).toBeUndefined();
  expect(settings.trackerTokenVar).toBeUndefined();
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
  expect(settings.notificationChannel).toEqual({
    value: "claude-code-notification-hook",
    source: "detected",
  });
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
