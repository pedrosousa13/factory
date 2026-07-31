// Pure preflight-verdict module: validates config, the adapter marker, and
// the live tracker against each other, plus the push check and the stamp
// version (PRD §3 "Preflight validates three sources against each other",
// "Push, not transport"; PRD §6 "A stale stamp blocks autonomous execution
// only"). No fs, no process, no I/O — callers gather the facts and pass them
// in; this module only turns facts into a verdict.

import type { ParseResult } from "./config";

// ───── input facts

export type AdapterMarker = { kind: string } | "missing-file" | "missing-marker";

export type TrackerReachable =
  | { result: "ok" }
  | { result: "unreachable"; why: string }
  | "not-asked";

export interface PushCheck {
  ok: boolean;
  detail: string;
}

export interface StampVersion {
  repo: string | null;
  plugin: string;
}

export interface PreflightFacts {
  config: ParseResult;
  adapterMarker: AdapterMarker;
  trackerReachable: TrackerReachable;
  pushCheck: PushCheck;
  stampVersion: StampVersion;
}

// ───── verdict shape

// The protocol failure shape: what's missing, why the runtime needs it, the
// exact fix. `blocksExecutionOnly` marks a failure that stops autonomous
// execution but not planning (PRD §6).
export interface Failure {
  what: string;
  why: string;
  fix: string;
  blocksExecutionOnly?: true;
}

export type PreflightResult = { ok: true } | { ok: false; failures: Failure[] };

// ───── compareStamp

// Tiny hand-rolled semver-ish compare on "2.0.0"-style strings. Compares
// dotted numeric segments left to right; a missing or non-numeric segment
// counts as 0. No library.
export function compareStamp(a: string, b: string): -1 | 0 | 1 {
  const segments = (s: string): number[] => s.split(".").map((part) => parseInt(part, 10) || 0);
  const pa = segments(a);
  const pb = segments(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

// A repo with no stamp at all compares as older than any real version.
const UNSTAMPED = "0.0.0";

// ───── preflight

export function preflight(facts: PreflightFacts): PreflightResult {
  const failures: Failure[] = [];

  // config: one failure per parse/validation error.
  if (!facts.config.ok) {
    for (const err of facts.config.errors) {
      failures.push({
        what: err,
        why: "the runtime reads .factory/config.json to resolve the tracker, merge policy, and attack-surface settings before any work starts",
        fix: `edit .factory/config.json to fix: ${err}`,
      });
    }
  }

  // adapter marker: file or marker missing means the repo is not stamped
  // for the loop.
  if (facts.adapterMarker === "missing-file") {
    failures.push({
      what: "the tracker adapter doc is missing — repo is not stamped for the loop",
      why: "preflight reads the adapter doc's machine-readable marker to confirm the stamped tracker kind before the loop starts",
      fix: "run the Factory stamp/adopt skill to install the tracker adapter doc",
    });
  } else if (facts.adapterMarker === "missing-marker") {
    failures.push({
      what: "the tracker adapter doc has no machine-readable marker — repo is not stamped for the loop",
      why: "prose edits to the adapter doc must not be able to silently change which tracker the loop trusts",
      fix: "re-run the Factory stamp skill to rewrite the adapter doc with its marker",
    });
  }

  // three-source contradiction: config.json's tracker.kind must agree with
  // the adapter doc's marker.
  if (
    facts.config.ok &&
    typeof facts.adapterMarker === "object" &&
    facts.adapterMarker.kind !== facts.config.config.tracker.kind
  ) {
    const configKind = facts.config.config.tracker.kind;
    const markerKind = facts.adapterMarker.kind;
    failures.push({
      what: `config.json declares tracker "${configKind}" but the adapter doc marker declares "${markerKind}"`,
      why: "the three preflight sources (config, adapter marker, live tracker) must agree on which tracker the loop uses; a mismatch means the run cannot trust any of them",
      fix: `re-run the Factory stamp skill to regenerate the adapter doc for "${configKind}", or correct tracker.kind in .factory/config.json to "${markerKind}"`,
    });
  }

  // live tracker reachability.
  if (facts.trackerReachable !== "not-asked" && facts.trackerReachable.result === "unreachable") {
    failures.push({
      what: "the tracker is not reachable or not authenticated",
      why: facts.trackerReachable.why,
      fix: "authenticate the tracker outside Factory (Factory holds no secrets), then re-run preflight",
    });
  }

  // push, not transport: only that a non-interactive push is possible.
  if (!facts.pushCheck.ok) {
    failures.push({
      what: "a non-interactive push is not possible",
      why: facts.pushCheck.detail,
      fix: "configure non-interactive push access (HTTPS with `gh auth login`, or an SSH key that needs no passphrase prompt), then re-run preflight",
    });
  }

  // stamp version: stale blocks execution only; newer means the plugin
  // itself must be updated.
  const repoStamp = facts.stampVersion.repo ?? UNSTAMPED;
  const cmp = compareStamp(repoStamp, facts.stampVersion.plugin);
  if (cmp < 0) {
    failures.push({
      what: `repo stamp "${facts.stampVersion.repo ?? "none"}" is older than the installed plugin "${facts.stampVersion.plugin}"`,
      why: "a stale stamp means the repo's config and docs may not match what this plugin version expects",
      fix: "run the Factory migration step to bring the repo stamp up to date, then re-run preflight",
      blocksExecutionOnly: true,
    });
  } else if (cmp > 0) {
    failures.push({
      what: `repo stamp "${facts.stampVersion.repo}" is newer than the installed plugin "${facts.stampVersion.plugin}"`,
      why: "the installed plugin predates this stamp version and cannot guarantee it understands the repo's config and docs",
      fix: `update the Factory plugin to a version that supports stamp "${facts.stampVersion.repo}" or newer`,
    });
  }

  if (failures.length > 0) {
    return { ok: false, failures };
  }
  return { ok: true };
}
