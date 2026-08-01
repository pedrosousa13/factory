import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { mkV1Repo, REACHABLE_SHAPE, rmV1Repo } from "../conformance/v1repo";
import { gatherStampFacts, ADAPTER_DOC_PATH, CONFIG_PATH } from "../src/edges";
import { detectStamp } from "../src/stamp";
import { readMarker } from "../src/marker";

// Proves the fixture is real (task-8 brief, Step 2): a fixture that silently
// stopped being v1 would make every downstream migration check vacuous, so
// this asserts the three facts that make it v1 in the first place — not just
// that mkV1Repo() didn't throw.

let root: string | undefined;

afterEach(() => {
  if (root !== undefined) {
    rmV1Repo(root);
    root = undefined;
  }
});

test("mkV1Repo produces a directory detectStamp calls legacy-v1", () => {
  root = mkV1Repo().root;
  const state = detectStamp(gatherStampFacts(root));
  expect(state).toEqual({ k: "legacy-v1" });
});

test("mkV1Repo's fixture carries no .factory/config.json", () => {
  root = mkV1Repo().root;
  expect(existsSync(join(root, CONFIG_PATH))).toBe(false);
});

// The fixture's v1-ness must not depend on the source repo's current state
// (task-10 brief): mkV1Repo() always strips .factory/ from the copy and
// always overwrites the copy's adapter doc with the checked-in snapshot, so
// this stays true even after this repo itself migrates and grows a real
// .factory/config.json and a rewritten adapter doc.
test("mkV1Repo's copy carries no .factory/ directory at all", () => {
  root = mkV1Repo().root;
  expect(existsSync(join(root, ".factory"))).toBe(false);
});

test("mkV1Repo's adapter doc carries no tracker marker", () => {
  root = mkV1Repo().root;
  const doc = readFileSync(join(root, ADAPTER_DOC_PATH), "utf8");
  expect(readMarker(doc)).toBe("missing-marker");
});

test("mkV1Repo's adapter doc is byte-identical to the checked-in v1 snapshot", () => {
  root = mkV1Repo().root;
  const copied = readFileSync(join(root, ADAPTER_DOC_PATH));
  const snapshot = readFileSync(join(import.meta.dir, "../conformance/v1-adapter-doc.snapshot.md"));
  expect(copied.equals(snapshot)).toBe(true);
});

// ───── REACHABLE_SHAPE drift guard
//
// REACHABLE_SHAPE is now shared conformance material (bin/migrate.ts and
// sweep.ts both hand it to a harness), like IMPLEMENT_SHAPE
// (coderepo.test.ts) and OPEN_ISSUES_SHAPE (fixture.test.ts) — both pinned
// against the runtime type they mirror so a drift there can't silently ship.
// Those two are byte-identical to their source declaration; REACHABLE_SHAPE
// isn't (it omits the leading "export " so the prompt text itself doesn't
// carry it), so a literal toBe() can't be the check here. Comparing field
// *names* only would still miss a field that keeps its name but changes
// type (e.g. `why: string` narrowed to `why: "auth" | "network"`) — a guard
// shipped that way in slice 5 and had to be tightened. So this compares each
// variant's full "field: type" pairs, not just which names are present.

function variantFields(unionText: string): string[][] {
  return unionText
    .split("|")
    .map((variant) => variant.trim().replace(/^\{/, "").replace(/\}$/, ""))
    .map((body) =>
      body
        .split(";")
        .map((field) => field.trim())
        .filter((field) => field !== "")
        .sort(),
    );
}

test("REACHABLE_SHAPE's variants match tracker.ts's ReachableAnswer by field name and type", () => {
  const source = readFileSync(join(import.meta.dir, "../src/tracker.ts"), "utf8");
  const match = source.match(/export type ReachableAnswer = (.*);\n/);
  if (!match) throw new Error("could not find the ReachableAnswer declaration in tracker.ts");

  const shapeMatch = REACHABLE_SHAPE.match(/^type ReachableAnswer = (.*);$/);
  if (!shapeMatch) throw new Error("REACHABLE_SHAPE is not a ReachableAnswer alias — update this test's parsing");

  expect(variantFields(shapeMatch[1])).toEqual(variantFields(match[1]));
});
