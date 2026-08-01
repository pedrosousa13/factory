import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "bun:test";
import { MILESTONE_COUNTS_SHAPE, OPEN_ISSUES_SHAPE, TICKET_FACTS_SHAPE } from "../conformance/fixture";

const TRACKER_SOURCE = readFileSync(join(import.meta.dir, "../src/tracker.ts"), "utf8");

// ───── OPEN_ISSUES_SHAPE byte-identity
//
// Same mechanism as coderepo.test.ts's IMPLEMENT_SHAPE check: a shape
// mirroring a runtime type is enforced by comparing it, byte for byte,
// against the actual declaration in the source file it mirrors.

test("OPEN_ISSUES_SHAPE is byte-identical to tracker.ts's OpenIssuesAnswer declaration", () => {
  const match = TRACKER_SOURCE.match(/export type OpenIssuesAnswer = .*;\n/);
  if (!match) throw new Error("could not find the OpenIssuesAnswer declaration in tracker.ts");

  expect(OPEN_ISSUES_SHAPE).toBe(match[0].trimEnd());
});

// ───── TICKET_FACTS_SHAPE and MILESTONE_COUNTS_SHAPE drift guards
//
// The same mechanism — read the declaration out of tracker.ts and compare —
// but these two cannot be byte-identical to it. Both are written for an agent
// reading a prompt: they spell each union out inline instead of naming the
// type, and they carry comments the type does not. So compare what they
// actually mirror: the field names in source order, and every union member.

function objectBody(typeName: string): string {
  const match = TRACKER_SOURCE.match(new RegExp(`export type ${typeName} = \\{[\\s\\S]*?\\n\\};`));
  if (!match) throw new Error(`could not find the ${typeName} object declaration in tracker.ts`);
  return match[0];
}

function aliasLine(typeName: string): string {
  const match = TRACKER_SOURCE.match(new RegExp(`export type ${typeName} = .*;`));
  if (!match) throw new Error(`could not find the ${typeName} declaration in tracker.ts`);
  return match[0];
}

/** Field names of a two-space-indented object body, in source order. Comment lines carry none. */
function fieldNames(body: string): string[] {
  return [...body.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
}

/** Every double-quoted string in a snippet, in source order. */
function quoted(text: string): string[] {
  return [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function fieldLine(shape: string, field: string): string {
  const line = shape.split("\n").find((l) => l.trimStart().startsWith(`${field}:`));
  if (line === undefined) throw new Error(`the shape has no ${field} field`);
  return line;
}

test("TICKET_FACTS_SHAPE names tracker.ts's TicketFacts fields, all of them, in order", () => {
  expect(fieldNames(TICKET_FACTS_SHAPE)).toEqual(fieldNames(objectBody("TicketFacts")));
});

test("TICKET_FACTS_SHAPE's inlined unions match the types they stand in for", () => {
  expect(quoted(fieldLine(TICKET_FACTS_SHAPE, "urgency"))).toEqual(quoted(aliasLine("Urgency")));
  expect(quoted(fieldLine(TICKET_FACTS_SHAPE, "state"))).toEqual(quoted(aliasLine("IssueState")));
});

test("MILESTONE_COUNTS_SHAPE asks for a count of every IssueState, and nothing else", () => {
  // The answer is keyed by IssueState, not by the open subset — a narrowing
  // back to OpenState must fail here rather than reach a live tracker.
  expect(aliasLine("MilestoneCountsAnswer")).toContain("Record<IssueState, number>");

  const keys = [...MILESTONE_COUNTS_SHAPE.matchAll(/(\w+): number/g)].map((m) => m[1]);
  expect(keys).toEqual(quoted(aliasLine("IssueState")));
});
