import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "bun:test";
import { OPEN_ISSUES_SHAPE } from "../conformance/fixture";

// ───── OPEN_ISSUES_SHAPE byte-identity
//
// Same mechanism as coderepo.test.ts's IMPLEMENT_SHAPE check: a shape
// mirroring a runtime type is enforced by comparing it, byte for byte,
// against the actual declaration in the source file it mirrors.

test("OPEN_ISSUES_SHAPE is byte-identical to tracker.ts's OpenIssuesAnswer declaration", () => {
  const source = readFileSync(join(import.meta.dir, "../src/tracker.ts"), "utf8");
  const match = source.match(/export type OpenIssuesAnswer = .*;\n/);
  if (!match) throw new Error("could not find the OpenIssuesAnswer declaration in tracker.ts");

  expect(OPEN_ISSUES_SHAPE).toBe(match[0].trimEnd());
});
