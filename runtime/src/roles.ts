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

// One role's two implementations can live in two different places, so an
// implementation names its kind as well as itself:
//
//   "skill"  — installed at `<home>/.claude/skills/<name>`, the dependent-skills
//              check in PROTOCOL.md "## Preflight: prerequisites, not the
//              stamp". This is how the Matt Pocock skills install, as symlinks.
//   "plugin" — a plugin skill, addressed by its `<plugin>:<skill>` id, the
//              superpowers check in the same Preflight section. Superpowers
//              ships this way and is never
//              installed at `~/.claude/skills/<name>`, so looking for it there
//              can only ever report it absent.
//
// Detecting either one is the caller's job — see edges.ts. This module only
// says which kind each implementation is.
export type RoleImpl = { k: "skill" | "plugin"; name: string };

export type RoleSpec = {
  role: RoleName;
  // The PRD's own wording for the role, used in failure text the maintainer reads.
  label: string;
  preferred: RoleImpl;
  // null means the PRD's "—": no alternative exists, so an absent preferred
  // implementation stops the run. Resolved with the maintainer on 2026-08-01.
  fallback: RoleImpl | null;
  // Implement is an execution role. A missing TDD implementation stops
  // autonomous execution but must not stop planning (PRD §6). The other six
  // roles genuinely block everything.
  blocksExecutionOnly?: true;
};

const skill = (name: string): RoleImpl => ({ k: "skill", name });
const plugin = (name: string): RoleImpl => ({ k: "plugin", name });

export const ROLE_TABLE: RoleSpec[] = [
  { role: "interrogate", label: "Interrogate", preferred: skill("grilling"), fallback: null },
  { role: "model-domain", label: "Model the domain", preferred: skill("domain-modeling"), fallback: null },
  { role: "chart-map", label: "Chart a map", preferred: skill("wayfinder"), fallback: null },
  { role: "write-spec", label: "Write the spec", preferred: skill("to-prd"), fallback: skill("to-spec") },
  { role: "slice-issues", label: "Slice into issues", preferred: skill("to-issues"), fallback: skill("to-tickets") },
  { role: "triage", label: "Triage", preferred: skill("triage"), fallback: null },
  {
    role: "implement",
    label: "Implement",
    preferred: plugin("superpowers:test-driven-development"),
    fallback: skill("tdd"),
    blocksExecutionOnly: true,
  },
];

// ───── resolution

export type RoleSelection = { role: RoleName; selected: string; via: "preferred" | "fallback" };

export type RoleResolution = { resolved: RoleSelection[]; failures: Failure[] };

// Preferred first, then fallback, then a failure. Every unresolvable role is
// reported — a maintainer who installs one skill only to meet the next missing
// one on the following run is the failure Preflight exists to prevent
// (PROTOCOL.md "## Preflight: prerequisites, not the stamp").
// How the maintainer installs each kind. A plugin skill has no
// ~/.claude/skills/ path at all, so pointing there would send them looking in
// a directory the check never reads (same section, the superpowers check).
function installFix(impl: RoleImpl): string {
  const [pluginName] = impl.name.split(":");
  return impl.k === "plugin"
    ? `Install the "${pluginName}" plugin, from any marketplace.`
    : `Install "${impl.name}" into ~/.claude/skills/ and check the symlink resolves.`;
}

export function resolveRoles(available: string[]): RoleResolution {
  const have = new Set(available);
  const resolved: RoleSelection[] = [];
  const failures: Failure[] = [];

  for (const spec of ROLE_TABLE) {
    if (have.has(spec.preferred.name)) {
      resolved.push({ role: spec.role, selected: spec.preferred.name, via: "preferred" });
      continue;
    }
    if (spec.fallback !== null && have.has(spec.fallback.name)) {
      resolved.push({ role: spec.role, selected: spec.fallback.name, via: "fallback" });
      continue;
    }
    const failure: Failure = {
      what: `Planning role "${spec.label}" has no available implementation`,
      why:
        spec.fallback === null
          ? `The role resolves only to "${spec.preferred.name}", which is not installed, and the role has no fallback.`
          : `Neither "${spec.preferred.name}" nor its fallback "${spec.fallback.name}" is installed.`,
      fix: installFix(spec.preferred),
    };
    if (spec.blocksExecutionOnly) failure.blocksExecutionOnly = true;
    failures.push(failure);
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
