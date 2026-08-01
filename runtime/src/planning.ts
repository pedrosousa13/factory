// Pure planning-namespace module: the one predicate that keeps planning
// artifacts out of every work path (PRD §4 "One reserved planning namespace";
// PROTOCOL.md "## Wayfinder maps", which defines the namespace). Queue
// selection, triage, adoption, and security sweeps
// all skip an issue this returns true for. No fs, no process, no I/O.

// ───── the namespace

// Matching on prefix rather than on the six known labels is load-bearing: PRD
// §4 says "a new artifact kind inherits the exclusion by naming itself
// correctly", which a literal-string match would not give it.
export const PLANNING_PREFIXES: string[] = ["wayfinder:", "planning:"];

// The six the PRD names today. Documentation and regression input — the
// predicate does not read this list.
export const PLANNING_LABELS: string[] = [
  "wayfinder:map",
  "wayfinder:research",
  "wayfinder:prototype",
  "wayfinder:grilling",
  "wayfinder:task",
  "planning:prd",
];

// ───── the predicate

// True when any label sits in the reserved namespace. An issue this covers is
// a planning artifact, not a work item: no category, no state, no priority, no
// milestone, never `ready-for-agent`, never a Queue candidate, and skipped by
// triage, adoption, and security sweeps.
export function isPlanningArtifact(labels: string[]): boolean {
  return labels.some((label) => PLANNING_PREFIXES.some((prefix) => label.startsWith(prefix)));
}
