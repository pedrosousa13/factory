// Pure config module: parsing/validating `.factory/config.json` and resolving
// effective settings. No fs, no process, no I/O — callers pass in the raw
// string and any detected environment facts.

import { LOCK_PATH, JOURNAL_PATH } from "./paths";

export { LOCK_PATH, JOURNAL_PATH };

// ───── config shape

export type TrackerKind = "github" | "linear" | "local";
export type MergePolicy = "squash" | "merge" | "rebase" | "human";
export type MergeMethod = "squash" | "merge" | "rebase";

export interface FactoryConfig {
  stampVersion: string;
  tracker: { kind: TrackerKind; repo?: string };
  merge: { policy: MergePolicy; method?: MergeMethod };
  attackSurface: boolean;
  maxWorkers?: number;
  answerWindowMinutes?: number;
  contextBudget?: number;
  notifierCommand?: string;
  trackerTokenVar?: string;
}

export type ParseResult =
  | { ok: true; config: FactoryConfig }
  | { ok: false; errors: string[] };

// ───── detected environment facts

export interface Detected {
  defaultBranch: string;
  // notificationChannel is a derived setting (PRD §3): it returns here once
  // a real detection spec exists for it. No edge fabricates one yet.
}

// ───── effective settings

export type SettingSource = "config" | "default" | "detected";

export interface Effective<T> {
  value: T;
  source: SettingSource;
}

export interface EffectiveSettings {
  stampVersion: Effective<string>;
  tracker: Effective<FactoryConfig["tracker"]>;
  mergePolicy: Effective<MergePolicy>;
  mergeMethod?: Effective<MergeMethod>;
  attackSurface: Effective<boolean>;
  maxWorkers: Effective<number>;
  answerWindowMinutes: Effective<number>;
  contextBudget?: Effective<number>;
  notifierCommand?: Effective<string>;
  trackerTokenVar?: Effective<string>;
  defaultBranch: Effective<string>;
  // notificationChannel: returns here once it derives from a real detection
  // spec (PRD §3).
  lockPath: string;
  journalPath: string;
}

const MAX_WORKERS_DEFAULT = 1;
// v1 used 15 minutes; kept as a provisional default until the answer-window
// value is revisited at a later slice (PRD §3).
const ANSWER_WINDOW_MINUTES_DEFAULT = 15;

// ───── validation helpers

const TRACKER_KINDS = ["github", "linear", "local"] as const;
const MERGE_POLICIES = ["squash", "merge", "rebase", "human"] as const;
const MERGE_METHODS = ["squash", "merge", "rebase"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function enumError(path: string, value: unknown, allowed: readonly string[]): string {
  return `${path}: ${JSON.stringify(value)} is not ${allowed.join("|")}`;
}

function typeError(path: string, value: unknown, expected: string): string {
  return `${path}: ${JSON.stringify(value)} is not a ${expected}`;
}

function checkUnknownKeys(
  obj: Record<string, unknown>,
  known: readonly string[],
  pathPrefix: string,
  errors: string[],
): void {
  for (const key of Object.keys(obj)) {
    if (!known.includes(key)) {
      errors.push(`${pathPrefix}${key}: unknown key`);
    }
  }
}

// ───── parseConfig

const TOP_LEVEL_KEYS = [
  "stampVersion",
  "tracker",
  "merge",
  "attackSurface",
  "maxWorkers",
  "answerWindowMinutes",
  "contextBudget",
  "notifierCommand",
  "trackerTokenVar",
] as const;

const TRACKER_KEYS = ["kind", "repo"] as const;
const MERGE_KEYS = ["policy", "method"] as const;

export function parseConfig(raw: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return { ok: false, errors: [`config: invalid JSON (${(err as Error).message})`] };
  }

  if (!isPlainObject(data)) {
    return { ok: false, errors: ["config: must be a JSON object"] };
  }

  const errors: string[] = [];
  checkUnknownKeys(data, TOP_LEVEL_KEYS, "", errors);

  // stampVersion
  let stampVersion: string | undefined;
  if (!("stampVersion" in data)) {
    errors.push("stampVersion: required");
  } else if (typeof data.stampVersion !== "string") {
    errors.push(typeError("stampVersion", data.stampVersion, "string"));
  } else {
    stampVersion = data.stampVersion;
  }

  // tracker
  let tracker: FactoryConfig["tracker"] | undefined;
  if (!("tracker" in data)) {
    errors.push("tracker: required");
  } else if (!isPlainObject(data.tracker)) {
    errors.push("tracker: must be an object");
  } else {
    const t = data.tracker;
    checkUnknownKeys(t, TRACKER_KEYS, "tracker.", errors);

    let kind: TrackerKind | undefined;
    if (!("kind" in t)) {
      errors.push("tracker.kind: required");
    } else if (!isOneOf(t.kind, TRACKER_KINDS)) {
      errors.push(enumError("tracker.kind", t.kind, TRACKER_KINDS));
    } else {
      kind = t.kind;
    }

    let repo: string | undefined;
    if ("repo" in t) {
      if (typeof t.repo !== "string") {
        errors.push(typeError("tracker.repo", t.repo, "string"));
      } else {
        repo = t.repo;
      }
    }

    if (kind !== undefined) {
      tracker = repo !== undefined ? { kind, repo } : { kind };
    }
  }

  // merge
  // The always-ask key is `merge.policy`, not `merge` itself (`merge.method` is a
  // separate, not-yet-defaulted setting per PRD §3) — so a wholly absent `merge`
  // is reported as a missing `merge.policy`, deliberately asymmetric with the
  // `tracker: required` case above where the whole object is the always-ask unit.
  let merge: FactoryConfig["merge"] | undefined;
  if (!("merge" in data)) {
    errors.push("merge.policy: required");
  } else if (!isPlainObject(data.merge)) {
    errors.push("merge: must be an object");
  } else {
    const m = data.merge;
    checkUnknownKeys(m, MERGE_KEYS, "merge.", errors);

    let policy: MergePolicy | undefined;
    if (!("policy" in m)) {
      errors.push("merge.policy: required");
    } else if (!isOneOf(m.policy, MERGE_POLICIES)) {
      errors.push(enumError("merge.policy", m.policy, MERGE_POLICIES));
    } else {
      policy = m.policy;
    }

    let method: MergeMethod | undefined;
    if ("method" in m) {
      if (!isOneOf(m.method, MERGE_METHODS)) {
        errors.push(enumError("merge.method", m.method, MERGE_METHODS));
      } else {
        method = m.method;
      }
    }

    if (policy !== undefined) {
      merge = method !== undefined ? { policy, method } : { policy };
    }
  }

  // attackSurface
  let attackSurface: boolean | undefined;
  if (!("attackSurface" in data)) {
    errors.push("attackSurface: required");
  } else if (typeof data.attackSurface !== "boolean") {
    errors.push(typeError("attackSurface", data.attackSurface, "boolean"));
  } else {
    attackSurface = data.attackSurface;
  }

  // maxWorkers (optional)
  let maxWorkers: number | undefined;
  if ("maxWorkers" in data) {
    if (typeof data.maxWorkers !== "number") {
      errors.push(typeError("maxWorkers", data.maxWorkers, "number"));
    } else {
      maxWorkers = data.maxWorkers;
    }
  }

  // answerWindowMinutes (optional)
  let answerWindowMinutes: number | undefined;
  if ("answerWindowMinutes" in data) {
    if (typeof data.answerWindowMinutes !== "number") {
      errors.push(typeError("answerWindowMinutes", data.answerWindowMinutes, "number"));
    } else {
      answerWindowMinutes = data.answerWindowMinutes;
    }
  }

  // contextBudget (optional)
  let contextBudget: number | undefined;
  if ("contextBudget" in data) {
    if (typeof data.contextBudget !== "number") {
      errors.push(typeError("contextBudget", data.contextBudget, "number"));
    } else {
      contextBudget = data.contextBudget;
    }
  }

  // notifierCommand (optional)
  let notifierCommand: string | undefined;
  if ("notifierCommand" in data) {
    if (typeof data.notifierCommand !== "string") {
      errors.push(typeError("notifierCommand", data.notifierCommand, "string"));
    } else {
      notifierCommand = data.notifierCommand;
    }
  }

  // trackerTokenVar (optional)
  let trackerTokenVar: string | undefined;
  if ("trackerTokenVar" in data) {
    if (typeof data.trackerTokenVar !== "string") {
      errors.push(typeError("trackerTokenVar", data.trackerTokenVar, "string"));
    } else {
      trackerTokenVar = data.trackerTokenVar;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const config: FactoryConfig = {
    stampVersion: stampVersion!,
    tracker: tracker!,
    merge: merge!,
    attackSurface: attackSurface!,
    ...(maxWorkers !== undefined ? { maxWorkers } : {}),
    ...(answerWindowMinutes !== undefined ? { answerWindowMinutes } : {}),
    ...(contextBudget !== undefined ? { contextBudget } : {}),
    ...(notifierCommand !== undefined ? { notifierCommand } : {}),
    ...(trackerTokenVar !== undefined ? { trackerTokenVar } : {}),
  };

  return { ok: true, config };
}

// ───── effective

export function effective(config: FactoryConfig, detected: Detected): EffectiveSettings {
  const settings: EffectiveSettings = {
    stampVersion: { value: config.stampVersion, source: "config" },
    tracker: { value: config.tracker, source: "config" },
    mergePolicy: { value: config.merge.policy, source: "config" },
    attackSurface: { value: config.attackSurface, source: "config" },
    maxWorkers:
      config.maxWorkers !== undefined
        ? { value: config.maxWorkers, source: "config" }
        : { value: MAX_WORKERS_DEFAULT, source: "default" },
    answerWindowMinutes:
      config.answerWindowMinutes !== undefined
        ? { value: config.answerWindowMinutes, source: "config" }
        : { value: ANSWER_WINDOW_MINUTES_DEFAULT, source: "default" },
    defaultBranch: { value: detected.defaultBranch, source: "detected" },
    lockPath: LOCK_PATH,
    journalPath: JOURNAL_PATH,
  };

  // mergeMethod always resolves: an explicit config value wins; absent with
  // an auto policy (squash/merge/rebase) defaults the method to that policy
  // (an auto policy IS a method preference); absent with policy "human"
  // defaults to "squash" (mirrors agentwork.ts's mergeDecision).
  if (config.merge.method !== undefined) {
    settings.mergeMethod = { value: config.merge.method, source: "config" };
  } else if (config.merge.policy === "human") {
    settings.mergeMethod = { value: "squash", source: "default" };
  } else {
    settings.mergeMethod = { value: config.merge.policy, source: "default" };
  }

  // contextBudget: this slice's decision on the PRD's TBD is that the budget
  // is off unless the maintainer sets one — so an unset key means no budget,
  // and the row is omitted rather than showing an invented placeholder.
  // Parse support stays; no enforcement lives here.
  if (config.contextBudget !== undefined) {
    settings.contextBudget = { value: config.contextBudget, source: "config" };
  }
  if (config.notifierCommand !== undefined) {
    settings.notifierCommand = { value: config.notifierCommand, source: "config" };
  }
  if (config.trackerTokenVar !== undefined) {
    settings.trackerTokenVar = { value: config.trackerTokenVar, source: "config" };
  }

  return settings;
}
