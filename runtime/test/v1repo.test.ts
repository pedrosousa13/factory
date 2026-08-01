import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { mkV1Repo, rmV1Repo } from "../conformance/v1repo";
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

test("mkV1Repo's adapter doc carries no tracker marker", () => {
  root = mkV1Repo().root;
  const doc = readFileSync(join(root, ADAPTER_DOC_PATH), "utf8");
  expect(readMarker(doc)).toBe("missing-marker");
});
