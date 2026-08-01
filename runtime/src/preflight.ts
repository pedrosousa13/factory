// Pure preflight-verdict module: validates config, the adapter marker, and
// the live tracker against each other, plus the push check and the stamp
// version (PRD §3 "Preflight validates three sources against each other",
// "Push, not transport"; PRD §6 "A stale stamp blocks autonomous execution
// only"). No fs, no process, no I/O — callers gather the facts and pass them
// in; this module only turns facts into a verdict.

import type { ParseResult } from "./config";
import { resolveRoles } from "./roles";
import { detectStamp, type StampFacts } from "./stamp";

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
  config: "missing-file" | ParseResult;
  adapterMarker: AdapterMarker;
  trackerReachable: TrackerReachable;
  pushCheck: PushCheck;
  stampVersion: StampVersion;
  // Raw stamp facts (config version + adapter doc text), gathered by edges.ts
  // and never pre-decided there — this module calls detectStamp itself, once,
  // and every "this repo is not stamped" failure branches off that one
  // verdict. It is what tells a legacy v1 repo apart from a genuinely
  // unstamped one, which `stampVersion.repo` alone cannot do.
  stampFacts: StampFacts;
  // Which planning-role implementations the host found installed. Gathered by
  // edges.ts — this module stays pure and only decides what the list means.
  availableRoles: string[];
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

  // One stamp verdict for the whole report. A legacy v1 repo collects three
  // "not stamped" failures at once — no config.json, no adapter marker, stale
  // stamp — and every one of them branches off this single value, so the
  // maintainer reads one story instead of three unrelated instructions.
  // Computing it once also drops a standing assumption: the stale-stamp check
  // used to read `stampVersion.repo === null` as "unstamped or legacy v1",
  // which only holds because edges.ts derives that field and
  // stampFacts.configVersion from the same expression. stampFacts is the one
  // input that decides which stamp a repo carries.
  const stamp = detectStamp(facts.stampFacts);

  // What a "this repo is not stamped" failure tells the maintainer to run.
  // A legacy v1 stamp routes to /factory-migrate (the stale-stamp branch
  // below); everything unstamped routes here, to /factory-adopt, which is
  // safe to re-run (PROTOCOL.md:97), writes .factory/config.json at the
  // current stamp version, and uses the same section rules migration does.
  //
  // A repo that already carries a stamp also carries files, so its fixes say
  // /factory-adopt will not clobber them. A never-adopted repo has nothing to
  // reassure, so it does not get the aside.
  const adopt = (task: string): string =>
    stamp.k === "unstamped" ? `run /factory-adopt to ${task}` : `run /factory-adopt (safe to re-run) to ${task}`;

  // config: missing entirely gets its own dedicated failure, like
  // adapterMarker's "missing-file" below — field-level parse/validation
  // errors keep the generic per-error wrapper.
  if (facts.config === "missing-file") {
    failures.push({
      what: ".factory/config.json is missing — repo is not stamped for v2",
      why: "the runtime reads .factory/config.json to resolve the tracker, merge policy, and attack-surface settings before any work starts",
      fix: adopt("create .factory/config.json"),
    });
  } else if (!facts.config.ok) {
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
      fix: adopt("install the tracker adapter doc"),
    });
  } else if (facts.adapterMarker === "missing-marker") {
    failures.push({
      what: "the tracker adapter doc has no machine-readable marker — repo is not stamped for the loop",
      why: "prose edits to the adapter doc must not be able to silently change which tracker the loop trusts",
      fix: adopt("rewrite the adapter doc with its marker"),
    });
  }

  // three-source contradiction: config.json's tracker.kind must agree with
  // the adapter doc's marker.
  const adapterKind = typeof facts.adapterMarker === "object" ? facts.adapterMarker.kind : null;
  const parsedConfig = facts.config !== "missing-file" && facts.config.ok ? facts.config.config : null;
  const trackerMismatch = parsedConfig !== null && adapterKind !== null && adapterKind !== parsedConfig.tracker.kind;
  if (trackerMismatch && parsedConfig !== null) {
    const configKind = parsedConfig.tracker.kind;
    failures.push({
      what: `config.json declares tracker "${configKind}" but the adapter doc marker declares "${adapterKind}"`,
      why: "the three preflight sources (config, adapter marker, live tracker) must agree on which tracker the loop uses; a mismatch means the run cannot trust any of them",
      fix: `run /factory-adopt to regenerate the adapter doc for "${configKind}", or correct tracker.kind in .factory/config.json to "${adapterKind}"`,
    });
  }

  // live tracker reachability. "not-asked" means the host never ran the
  // check at all. That is excused only when another collected failure
  // already explains why the edge couldn't ask — an invalid config, or an
  // adapter marker that's missing or mismatched. On an otherwise clean
  // board, "not-asked" is itself a failure: the loop must not silently
  // skip confirming the tracker is reachable.
  if (facts.trackerReachable === "not-asked") {
    const excused =
      facts.config === "missing-file" ||
      !facts.config.ok ||
      facts.adapterMarker === "missing-file" ||
      facts.adapterMarker === "missing-marker" ||
      trackerMismatch;
    if (!excused) {
      failures.push({
        what: "tracker reachability was never checked",
        why: "preflight must confirm the tracker is reachable before the loop starts, and nothing else on the board explains why that check didn't run",
        fix: "re-run preflight with a host that asks the tracker-reachable question",
      });
    }
  } else if (facts.trackerReachable.result === "unreachable") {
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
    // Branches on `stamp`, the same verdict the two failures above used —
    // never on `stampVersion.repo === null`, which cannot tell a legacy v1
    // repo from a never-adopted one. One arm per StampState tag.
    const task =
      stamp.k === "v2"
        ? "bring the repo stamp up to date"
        : stamp.k === "legacy-v1"
          ? "carry this legacy v1 repo to the current stamp"
          : "stamp this repo";
    failures.push({
      what: `repo stamp "${facts.stampVersion.repo ?? "none"}" is older than the installed plugin "${facts.stampVersion.plugin}"`,
      why: "a stale stamp means the repo's config and docs may not match what this plugin version expects",
      fix:
        stamp.k === "legacy-v1"
          ? "run /factory-migrate to bring this legacy v1 stamp to the current version, then re-run preflight"
          : `${adopt(task)}, then re-run preflight`,
      blocksExecutionOnly: true,
    });
  } else if (cmp > 0) {
    failures.push({
      what: `repo stamp "${facts.stampVersion.repo}" is newer than the installed plugin "${facts.stampVersion.plugin}"`,
      why: "the installed plugin predates this stamp version and cannot guarantee it understands the repo's config and docs",
      fix: `update the Factory plugin to a version that supports stamp "${facts.stampVersion.repo}" or newer`,
      blocksExecutionOnly: true,
    });
  }

  // PRD §4: each role resolves at preflight, preferred then fallback. A role
  // with no available implementation stops the run, like any other missing
  // prerequisite — collected, never reported alone (PROTOCOL.md:21-24).
  failures.push(...resolveRoles(facts.availableRoles).failures);

  if (failures.length > 0) {
    return { ok: false, failures };
  }
  return { ok: true };
}
