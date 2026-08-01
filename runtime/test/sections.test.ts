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

test("an other-difference names every differing section, not just the first", () => {
  const current = TEMPLATE.replace("Conventions body.", "Rewritten one.").replace(
    "Reachability body.",
    "Rewritten two.",
  );
  const got = diffDoc(current, TEMPLATE);
  if (got.k !== "other-difference") throw new Error("expected other-difference");
  expect(got.detail).toContain("Conventions");
  expect(got.detail).toContain("Reachability");
});

test("an other-difference also reports a missing tracker marker, which keep-mine would otherwise strand", () => {
  // The real fixture's shape: one drifted section plus an H1 section with no
  // marker. Reporting only the drift leaves a maintainer who chooses
  // keep-mine with preflight red on `missing-marker` and nothing naming it.
  const current = TEMPLATE.replace("<!-- factory:tracker kind=github -->\n\n", "").replace(
    "Wayfinding body.",
    "The maintainer rewrote this.",
  );
  const got = diffDoc(current, TEMPLATE);
  if (got.k !== "other-difference") throw new Error("expected other-difference");
  expect(got.detail).toContain("Wayfinding operations");
  expect(got.detail).toContain("tracker marker");
});

test("a document lacking only the tracker marker is still a retrofit, not an other-difference", () => {
  // The classification is unchanged by the reporting fix above.
  const current = TEMPLATE.replace("<!-- factory:tracker kind=github -->\n\n", "");
  const got = diffDoc(current, TEMPLATE);
  if (got.k !== "missing-sections") throw new Error("expected missing-sections");
  expect(got.missing.map((s) => s.k)).toEqual(["replace"]);
  expect(applyMissing(current, got.missing)).toBe(TEMPLATE);
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

// ───── the marker is the only sub-section retrofit (SKILL.md:244, :249-253)

test("a line the maintainer deleted from a section they still have is an other-difference", () => {
  // Not an omission an older stamp left behind — a deletion they chose, so they
  // keep the choice to adopt, keep theirs, or merge by hand.
  const current = TEMPLATE.replace("Conventions body.\n\n", "");
  expect(diffDoc(current, TEMPLATE).k).toBe("other-difference");
});

test("a whole paragraph deleted from a shared section is still an other-difference", () => {
  const withProse = TEMPLATE.replace(
    "Conventions body.",
    "Conventions body.\n\nA second paragraph.\n\nA third paragraph.",
  );
  const current = withProse.replace("A second paragraph.\n\n", "");
  expect(diffDoc(current, withProse).k).toBe("other-difference");
});

test("a section the document lacks entirely is an insert", () => {
  const current = TEMPLATE.replace(/## Wayfinding operations\n\nWayfinding body\.\n\n/, "");
  const got = diffDoc(current, TEMPLATE);
  if (got.k !== "missing-sections") throw new Error("expected missing-sections");
  expect(got.missing.map((s) => s.k)).toEqual(["insert"]);
});

test("a section present but lacking the marker is a replace, not an insert", () => {
  // The document already carries this heading — calling it missing would tell
  // the maintainer a falsehood, and splicing it in would emit the H1 twice.
  const current = TEMPLATE.replace("<!-- factory:tracker kind=github -->\n\n", "");
  const got = diffDoc(current, TEMPLATE);
  if (got.k !== "missing-sections") throw new Error("expected missing-sections");
  expect(got.missing.map((s) => s.k)).toEqual(["replace"]);
});

// ───── applyMissing does not crash on a partial list

test("applying only some of the missing sections returns a document instead of throwing", () => {
  let current = TEMPLATE.replace(/## Wayfinding operations\n\nWayfinding body\.\n\n/, "");
  current = current.replace(/## Reachability\n\nReachability body\.\n/, "");
  const got = diffDoc(current, TEMPLATE);
  if (got.k !== "missing-sections") throw new Error("expected missing-sections");
  const applied = applyMissing(current, [got.missing[1]]);
  expect(applied).toContain("## Reachability");
  expect(applied).not.toContain("## Wayfinding operations");
});
