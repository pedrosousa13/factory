// Pure planning-role module: the role table (PRD §4 "The protocol declares
// roles, not skill names"), its resolution at preflight preferred-then-
// fallback, and the selection report the run prints. No fs, no process, no
// I/O — the caller detects which implementations are installed and passes the
// list in.

import type { Failure } from "./preflight";

// ───── the table (PRD #39:243-251, verbatim)

export type RoleName =
  | "interrogate"
  | "model-domain"
  | "chart-map"
  | "write-spec"
  | "slice-issues"
  | "triage"
  | "implement";

export type RoleSpec = {
  role: RoleName;
  // The PRD's own wording for the role, used in failure text the maintainer reads.
  label: string;
  preferred: string;
  // null means the PRD's "—": no alternative exists, so an absent preferred
  // implementation stops the run. Resolved with the maintainer on 2026-08-01.
  fallback: string | null;
};

export const ROLE_TABLE: RoleSpec[] = [
  { role: "interrogate", label: "Interrogate", preferred: "grilling", fallback: null },
  { role: "model-domain", label: "Model the domain", preferred: "domain-modeling", fallback: null },
  { role: "chart-map", label: "Chart a map", preferred: "wayfinder", fallback: null },
  { role: "write-spec", label: "Write the spec", preferred: "to-prd", fallback: "to-spec" },
  { role: "slice-issues", label: "Slice into issues", preferred: "to-issues", fallback: "to-tickets" },
  { role: "triage", label: "Triage", preferred: "triage", fallback: null },
  { role: "implement", label: "Implement", preferred: "superpowers-tdd", fallback: "matt-tdd" },
];

// ───── resolution

export type RoleSelection = { role: RoleName; selected: string; via: "preferred" | "fallback" };

export type RoleResolution = { resolved: RoleSelection[]; failures: Failure[] };

// Preferred first, then fallback, then a failure. Every unresolvable role is
// reported — a maintainer who installs one skill only to meet the next missing
// one on the following run is the failure Preflight exists to prevent
// (PROTOCOL.md:21-24).
export function resolveRoles(available: string[]): RoleResolution {
  const have = new Set(available);
  const resolved: RoleSelection[] = [];
  const failures: Failure[] = [];

  for (const spec of ROLE_TABLE) {
    if (have.has(spec.preferred)) {
      resolved.push({ role: spec.role, selected: spec.preferred, via: "preferred" });
      continue;
    }
    if (spec.fallback !== null && have.has(spec.fallback)) {
      resolved.push({ role: spec.role, selected: spec.fallback, via: "fallback" });
      continue;
    }
    failures.push({
      what: `Planning role "${spec.label}" has no available implementation`,
      why:
        spec.fallback === null
          ? `The role resolves only to "${spec.preferred}", which is not installed, and the role has no fallback.`
          : `Neither "${spec.preferred}" nor its fallback "${spec.fallback}" is installed.`,
      fix: `Install "${spec.preferred}" into ~/.claude/skills/ and check the symlink resolves.`,
    });
  }

  return { resolved, failures };
}

// ───── the selection report

// PRD §4: "The run reports which one it selected." One line per role, so a
// maintainer can see a fallback took over without reading config.
export function roleReport(resolved: RoleSelection[]): string {
  const byRole = new Map(ROLE_TABLE.map((s) => [s.role, s]));
  return resolved
    .map((sel) => {
      const label = byRole.get(sel.role)?.label ?? sel.role;
      const via = sel.via === "fallback" ? " (fallback)" : "";
      return `  ${label}: ${sel.selected}${via}`;
    })
    .join("\n");
}
