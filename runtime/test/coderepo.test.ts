import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "bun:test";
import {
  CHECK_SHAPE,
  CLEAR_BRIEF,
  CLEAR_BRIEF_BRANCH,
  CLEAR_BRIEF_COMMIT,
  CLEAR_BRIEF_MARKER,
  IMPLEMENT_SHAPE,
  implementPrompt,
  JOURNAL_CLAIM_BRANCH,
  JOURNAL_CLAIM_RECORD,
  journalClaimPrompt,
  JOURNAL_CLAIM_TICKET,
  mkCodeRepo,
  rmCodeRepo,
  VAGUE_BRIEF,
} from "../conformance/coderepo";

// ───── mkCodeRepo

test("mkCodeRepo creates greet.ts and check.ts, and bun check.ts exits 0", () => {
  const { root } = mkCodeRepo();
  try {
    expect(existsSync(join(root, "greet.ts"))).toBe(true);
    expect(existsSync(join(root, "check.ts"))).toBe(true);
    expect(existsSync(join(root, ".git"))).toBe(true);

    const proc = Bun.spawnSync(["bun", "check.ts"], { cwd: root, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    expect(proc.exitCode).toBe(0);
  } finally {
    rmCodeRepo(root);
  }
});

// ───── rmCodeRepo

test("rmCodeRepo removes the scratch repo", () => {
  const { root } = mkCodeRepo();
  expect(existsSync(root)).toBe(true);

  rmCodeRepo(root);

  expect(existsSync(root)).toBe(false);
});

// ───── implementPrompt

test("implementPrompt contains the shape and the ONLY-JSON instruction", () => {
  const prompt = implementPrompt(CLEAR_BRIEF);

  expect(prompt).toContain(CLEAR_BRIEF);
  expect(prompt).toContain(IMPLEMENT_SHAPE);
  expect(prompt).toContain("Reply with ONLY that JSON");
});

test("implementPrompt works for the vague brief too", () => {
  const prompt = implementPrompt(VAGUE_BRIEF);

  expect(prompt).toContain(VAGUE_BRIEF);
  expect(prompt).toContain(IMPLEMENT_SHAPE);
  expect(prompt).toContain("Reply with ONLY that JSON");
});

// ───── CLEAR_BRIEF ↔ what the hosts verify

// Both hosts verify the work against these three constants. If a constant
// ever stops appearing in the brief the agent is actually given, the hosts
// would assert something the agent was never asked to do.
test("CLEAR_BRIEF asks for the branch, commit message, and marker the hosts verify", () => {
  expect(CLEAR_BRIEF).toContain(CLEAR_BRIEF_BRANCH);
  expect(CLEAR_BRIEF).toContain(CLEAR_BRIEF_COMMIT);
  expect(CLEAR_BRIEF).toContain(CLEAR_BRIEF_MARKER);
});

// ───── IMPLEMENT_SHAPE byte-identity

test("IMPLEMENT_SHAPE is byte-identical to agentwork.ts's ImplementResult declaration", () => {
  const source = readFileSync(join(import.meta.dir, "../src/agentwork.ts"), "utf8");
  const match = source.match(/export type ImplementResult =\n(?:.*\n)*?.*?;\n/);
  if (!match) throw new Error("could not find the ImplementResult declaration in agentwork.ts");

  expect(IMPLEMENT_SHAPE).toBe(match[0].trimEnd());
});

// ───── CHECK_SHAPE byte-identity

test("CHECK_SHAPE is byte-identical to agentwork.ts's CheckResult declaration", () => {
  const source = readFileSync(join(import.meta.dir, "../src/agentwork.ts"), "utf8");
  const match = source.match(/export type CheckResult =\n?(?:.*\n)*?.*?;\n/);
  if (!match) throw new Error("could not find the CheckResult declaration in agentwork.ts");

  expect(CHECK_SHAPE).toBe(match[0].trimEnd());
});

// ───── journalClaimPrompt ↔ JOURNAL_CLAIM_RECORD

// The sweep checks readJournal's result against JOURNAL_CLAIM_RECORD's
// fields directly (not a re-typed literal), so what matters here is that the
// prompt actually asks for that same record — a drift between the two would
// void the L2 evidence.
test("journalClaimPrompt asks for the ticket, branch, and exact record readJournal is checked against", () => {
  const prompt = journalClaimPrompt();

  expect(prompt).toContain(JOURNAL_CLAIM_TICKET);
  expect(prompt).toContain(JOURNAL_CLAIM_BRANCH);
  expect(prompt).toContain(JSON.stringify(JOURNAL_CLAIM_RECORD, null, 2));
  expect(prompt).toContain("claim");
});
