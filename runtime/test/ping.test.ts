import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ping, pingPlan } from "../src/ping";
import type { HarnessName } from "../src/harness";

// ───── pingPlan: the pure decision

describe("pingPlan", () => {
  // The notifier is the only channel pi has, so it is not withheld from pi:
  // PRD §5 item 4 puts the fallback beneath the native channels so reaching
  // the maintainer never depends on one.
  test("pi with a notifier configured: the fallback fires, same as any harness", () => {
    expect(pingPlan("pi", "notify-me.sh")).toEqual({ k: "spawn", command: "notify-me.sh" });
  });

  test("pi with no notifier configured: pi-no-ping, its documented silence", () => {
    expect(pingPlan("pi", undefined)).toEqual({ k: "pi-no-ping" });
  });

  for (const harness of ["claude", "codex"] as HarnessName[]) {
    test(`${harness} with a notifier configured: spawn`, () => {
      expect(pingPlan(harness, "notify-me.sh")).toEqual({ k: "spawn", command: "notify-me.sh" });
    });

    test(`${harness} with no notifier configured: no-notifier-configured`, () => {
      expect(pingPlan(harness, undefined)).toEqual({ k: "no-notifier-configured" });
    });
  }
});

// ───── ping: the edge, in a scratch cwd

function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), "ping-test-"));
}

describe("ping", () => {
  test("pi with no notifier: pi-no-ping, no subprocess spawned", () => {
    const dir = scratchDir();
    try {
      expect(ping("pi", undefined, dir)).toEqual({ k: "pi-no-ping" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("no notifier configured: no-notifier-configured, no subprocess spawned", () => {
    const dir = scratchDir();
    try {
      expect(ping("claude", undefined, dir)).toEqual({ k: "no-notifier-configured" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a notifier that exits 0: pinged", () => {
    const dir = scratchDir();
    try {
      expect(ping("claude", "exit 0", dir)).toEqual({ k: "pinged" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a notifier that exits non-zero: reported as notifier-failed, not thrown", () => {
    const dir = scratchDir();
    try {
      const outcome = ping("codex", "echo 'boom' >&2; exit 3", dir);
      expect(outcome.k).toBe("notifier-failed");
      if (outcome.k === "notifier-failed") expect(outcome.why).toContain("boom");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a notifier command that does not exist: reported as notifier-failed, not thrown", () => {
    const dir = scratchDir();
    try {
      const outcome = ping("claude", "this-command-does-not-exist-anywhere-xyz", dir);
      expect(outcome.k).toBe("notifier-failed");
      if (outcome.k === "notifier-failed") expect(outcome.why.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a failed ping never throws — the call always returns", () => {
    const dir = scratchDir();
    try {
      expect(() => ping("claude", "exit 1", dir)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("ping: a configured notifier reaches the maintainer on pi too", () => {
  const dir = mkdtempSync(join(tmpdir(), "factory-ping-"));
  try {
    expect(ping("pi", "exit 0", dir)).toEqual({ k: "pinged" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
