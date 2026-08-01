import { test, expect } from "bun:test";
import { PLANNING_LABELS, PLANNING_PREFIXES, isPlanningArtifact } from "../src/planning";

test("every label the PRD names is a planning artifact", () => {
  for (const label of PLANNING_LABELS) {
    expect(isPlanningArtifact([label])).toBe(true);
  }
});

test("the six labels the PRD names are exactly these", () => {
  expect([...PLANNING_LABELS].sort()).toEqual([
    "planning:prd",
    "wayfinder:grilling",
    "wayfinder:map",
    "wayfinder:prototype",
    "wayfinder:research",
    "wayfinder:task",
  ]);
});

test("a new artifact kind inherits the exclusion by naming itself in the namespace", () => {
  expect(isPlanningArtifact(["wayfinder:whatever-comes-next"])).toBe(true);
  expect(isPlanningArtifact(["planning:spec"])).toBe(true);
});

test("ordinary work labels are not planning artifacts", () => {
  expect(isPlanningArtifact([])).toBe(false);
  expect(isPlanningArtifact(["Bug", "P1", "needs-info", "ready-for-human"])).toBe(false);
});

test("one namespace label among many makes the whole issue a planning artifact", () => {
  expect(isPlanningArtifact(["Bug", "wayfinder:map"])).toBe(true);
});

test("a label that merely contains a prefix mid-string is not a planning artifact", () => {
  expect(isPlanningArtifact(["not-wayfinder:map"])).toBe(false);
  expect(isPlanningArtifact(["replanning:prd"])).toBe(false);
});
