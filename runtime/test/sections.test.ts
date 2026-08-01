import { test, expect } from "bun:test";
import { parseSections, diffDoc, applyMissing } from "../src/sections";

const TEMPLATE = `# Issue tracker: GitHub

<!-- factory:tracker kind=github -->

Intro prose.

## Conventions

Conventions body.

## Wayfinding operations

Wayfinding body.

## Reachability

Reachability body.
`;

// ───── parseSections

test("parseSections splits a document at its headings", () => {
  const got = parseSections(TEMPLATE);
  expect(got.map((s) => s.heading)).toEqual([
    "# Issue tracker: GitHub",
    "## Conventions",
    "## Wayfinding operations",
    "## Reachability",
  ]);
});

test("parseSections keeps each section's body with it", () => {
  const got = parseSections(TEMPLATE);
  expect(got[1].body).toContain("Conventions body.");
  expect(got[1].body).not.toContain("Wayfinding body.");
});

test("parseSections records heading level", () => {
  const got = parseSections(TEMPLATE);
  expect(got[0].level).toBe(1);
  expect(got[1].level).toBe(2);
});

test("parseSections does not treat a hash inside a fenced code block as a heading", () => {
  const doc = "# Title\n\n```sh\n# not a heading\n```\n\n## Real\n\nbody\n";
  expect(parseSections(doc).map((s) => s.heading)).toEqual(["# Title", "## Real"]);
});

// ───── diffDoc: matches

test("a file identical to the rendered template matches", () => {
  expect(diffDoc(TEMPLATE, TEMPLATE)).toEqual({ k: "matches" });
});

test("a file differing only in trailing whitespace still matches", () => {
  expect(diffDoc(TEMPLATE + "\n\n", TEMPLATE)).toEqual({ k: "matches" });
});

// ───── diffDoc: missing sections

test("a file lacking one whole section reports exactly that section", () => {
  const current = TEMPLATE.replace(/## Wayfinding operations\n\nWayfinding body\.\n\n/, "");
  const got = diffDoc(current, TEMPLATE);
  expect(got.k).toBe("missing-sections");
  if (got.k !== "missing-sections") throw new Error("unreachable");
  expect(got.missing.map((s) => s.heading)).toEqual(["## Wayfinding operations"]);
});

test("a file lacking two whole sections reports both, not just the first", () => {
  let current = TEMPLATE.replace(/## Wayfinding operations\n\nWayfinding body\.\n\n/, "");
  current = current.replace(/## Reachability\n\nReachability body\.\n/, "");
  const got = diffDoc(current, TEMPLATE);
  if (got.k !== "missing-sections") throw new Error("expected missing-sections");
  expect(got.missing.map((s) => s.heading)).toEqual(["## Wayfinding operations", "## Reachability"]);
});

test("a missing section carries the index it must be inserted at, not appended", () => {
  const current = TEMPLATE.replace(/## Wayfinding operations\n\nWayfinding body\.\n\n/, "");
  const got = diffDoc(current, TEMPLATE);
  if (got.k !== "missing-sections") throw new Error("expected missing-sections");
  // Wayfinding sits third in the template, after the H1 and Conventions.
  expect(got.missing[0].index).toBe(2);
});

// ───── diffDoc: other differences

test("a file with edited prose inside a shared section is an other-difference", () => {
  const current = TEMPLATE.replace("Conventions body.", "The maintainer rewrote this.");
  expect(diffDoc(current, TEMPLATE).k).toBe("other-difference");
});

test("a file carrying an extra section the template lacks is an other-difference", () => {
  const current = TEMPLATE + "\n## Local extra\n\nMaintainer's own section.\n";
  expect(diffDoc(current, TEMPLATE).k).toBe("other-difference");
});

test("an other-difference says what differs, so the maintainer can judge it", () => {
  const current = TEMPLATE.replace("Conventions body.", "The maintainer rewrote this.");
  const got = diffDoc(current, TEMPLATE);
  if (got.k !== "other-difference") throw new Error("expected other-difference");
  expect(got.detail).toContain("Conventions");
});

// ───── applyMissing round-trip: the property the whole design rests on

test("applying the missing sections leaves the file byte-identical to the template", () => {
  const current = TEMPLATE.replace(/## Wayfinding operations\n\nWayfinding body\.\n\n/, "");
  const got = diffDoc(current, TEMPLATE);
  if (got.k !== "missing-sections") throw new Error("expected missing-sections");
  expect(applyMissing(current, got.missing)).toBe(TEMPLATE);
});

test("after applying, a second diff reports matches — the run converges", () => {
  const current = TEMPLATE.replace(/## Reachability\n\nReachability body\.\n/, "");
  const first = diffDoc(current, TEMPLATE);
  if (first.k !== "missing-sections") throw new Error("expected missing-sections");
  const applied = applyMissing(current, first.missing);
  expect(diffDoc(applied, TEMPLATE)).toEqual({ k: "matches" });
});

test("applying two missing sections at once still converges", () => {
  let current = TEMPLATE.replace(/## Wayfinding operations\n\nWayfinding body\.\n\n/, "");
  current = current.replace(/## Reachability\n\nReachability body\.\n/, "");
  const got = diffDoc(current, TEMPLATE);
  if (got.k !== "missing-sections") throw new Error("expected missing-sections");
  expect(diffDoc(applyMissing(current, got.missing), TEMPLATE)).toEqual({ k: "matches" });
});

// ───── the marker special case

test("a doc missing only the tracker marker reports it as a missing section, not a whole-file diff", () => {
  const current = TEMPLATE.replace("<!-- factory:tracker kind=github -->\n\n", "");
  const got = diffDoc(current, TEMPLATE);
  expect(got.k).toBe("missing-sections");
});

test("inserting the missing marker puts it immediately after the H1", () => {
  const current = TEMPLATE.replace("<!-- factory:tracker kind=github -->\n\n", "");
  const got = diffDoc(current, TEMPLATE);
  if (got.k !== "missing-sections") throw new Error("expected missing-sections");
  expect(applyMissing(current, got.missing)).toBe(TEMPLATE);
});
