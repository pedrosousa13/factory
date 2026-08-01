import { test, expect } from "bun:test";
import { ROLE_TABLE, resolveRoles, roleReport } from "../src/roles";

const ALL_PREFERRED = ROLE_TABLE.map((r) => r.preferred.name);

test("the role table is the PRD's seven roles in the PRD's order", () => {
  expect(ROLE_TABLE.map((r) => r.role)).toEqual([
    "interrogate",
    "model-domain",
    "chart-map",
    "write-spec",
    "slice-issues",
    "triage",
    "implement",
  ]);
});

test("every role resolves to its preferred implementation when all are installed", () => {
  const got = resolveRoles(ALL_PREFERRED);
  expect(got.failures).toEqual([]);
  expect(got.resolved.every((s) => s.via === "preferred")).toBe(true);
});

test("a role with a fallback resolves to it when the preferred one is absent", () => {
  const available = ALL_PREFERRED.filter((p) => p !== "to-prd").concat("to-spec");
  const got = resolveRoles(available);
  expect(got.failures).toEqual([]);
  const spec = got.resolved.find((s) => s.role === "write-spec");
  expect(spec).toEqual({ role: "write-spec", selected: "to-spec", via: "fallback" });
});

test("a role with no fallback fails preflight when its preferred implementation is absent", () => {
  const got = resolveRoles(ALL_PREFERRED.filter((p) => p !== "grilling"));
  expect(got.failures.length).toBe(1);
  expect(got.failures[0].what).toContain("Interrogate");
  expect(got.failures[0].fix.length).toBeGreaterThan(0);
});

test("a role whose preferred and fallback are both absent fails preflight", () => {
  const got = resolveRoles(ALL_PREFERRED.filter((p) => p !== "to-prd"));
  expect(got.failures.length).toBe(1);
  expect(got.failures[0].what).toContain("Write the spec");
  expect(got.failures[0].why).toContain("to-spec");
});

test("the implement role's failure blocks execution only — a missing TDD skill must not stop planning", () => {
  const got = resolveRoles(ALL_PREFERRED.filter((p) => p !== "superpowers:test-driven-development"));
  expect(got.failures.length).toBe(1);
  expect(got.failures[0].what).toContain("Implement");
  expect(got.failures[0].blocksExecutionOnly).toBe(true);
  // A plugin skill has no ~/.claude/skills/ path, so the fix must not name one.
  expect(got.failures[0].fix).toContain("superpowers");
  expect(got.failures[0].fix).not.toContain("~/.claude/skills/");
});

test("every other role's failure blocks the whole run, not execution alone", () => {
  for (const failure of resolveRoles([]).failures) {
    if (failure.what.includes("Implement")) continue;
    expect(failure.blocksExecutionOnly).toBeUndefined();
  }
});

test("every unresolvable role is reported, not just the first", () => {
  const got = resolveRoles([]);
  expect(got.failures.length).toBe(ROLE_TABLE.length);
  expect(got.resolved).toEqual([]);
});

test("the run reports which implementation it selected for every role", () => {
  const report = roleReport(resolveRoles(ALL_PREFERRED).resolved);
  for (const spec of ROLE_TABLE) {
    expect(report).toContain(spec.preferred.name);
  }
});

test("the report marks a fallback selection as a fallback", () => {
  const available = ALL_PREFERRED.filter((p) => p !== "to-issues").concat("to-tickets");
  const report = roleReport(resolveRoles(available).resolved);
  expect(report).toContain("to-tickets");
  expect(report).toContain("fallback");
});
