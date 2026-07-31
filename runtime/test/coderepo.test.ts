import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "bun:test";
import { CLEAR_BRIEF, IMPLEMENT_SHAPE, implementPrompt, mkCodeRepo, rmCodeRepo, VAGUE_BRIEF } from "../conformance/coderepo";

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
