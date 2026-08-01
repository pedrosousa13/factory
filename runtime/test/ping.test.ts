import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

// The question a real ping carries. Any non-empty string works for the
// outcome tests; the contract test below is the one that reads it back.
const MSG = "Which auth flow should T-7 use?";

describe("ping", () => {
  test("pi with no notifier: pi-no-ping, no subprocess spawned", () => {
    const dir = scratchDir();
    try {
      expect(ping("pi", undefined, dir, MSG)).toEqual({ k: "pi-no-ping" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("no notifier configured: no-notifier-configured, no subprocess spawned", () => {
    const dir = scratchDir();
    try {
      expect(ping("claude", undefined, dir, MSG)).toEqual({ k: "no-notifier-configured" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a notifier that exits 0: pinged", () => {
    const dir = scratchDir();
    try {
      expect(ping("claude", "exit 0", dir, MSG)).toEqual({ k: "pinged" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a notifier that exits non-zero: reported as notifier-failed, not thrown", () => {
    const dir = scratchDir();
    try {
      const outcome = ping("codex", "echo 'boom' >&2; exit 3", dir, MSG);
      expect(outcome.k).toBe("notifier-failed");
      if (outcome.k === "notifier-failed") expect(outcome.why).toContain("boom");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a notifier command that does not exist: reported as notifier-failed, not thrown", () => {
    const dir = scratchDir();
    try {
      const outcome = ping("claude", "this-command-does-not-exist-anywhere-xyz", dir, MSG);
      expect(outcome.k).toBe("notifier-failed");
      if (outcome.k === "notifier-failed") expect(outcome.why.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a failed ping never throws — the call always returns", () => {
    const dir = scratchDir();
    try {
      expect(() => ping("claude", "exit 1", dir, MSG)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("ping: a configured notifier reaches the maintainer on pi too", () => {
  const dir = mkdtempSync(join(tmpdir(), "factory-ping-"));
  try {
    expect(ping("pi", "exit 0", dir, MSG)).toEqual({ k: "pinged" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ───── the invocation contract

// FACTORY_NOTIFY_MESSAGE is the one contract between Factory and a notifier
// command: the hook (hooks/factory-notify.sh) already sets it, and this
// module now sets the same key, so a maintainer writes one notifier that
// works from either side. Passing nothing left the question unreachable.
test("ping puts the question in FACTORY_NOTIFY_MESSAGE for the notifier to read", () => {
  const dir = mkdtempSync(join(tmpdir(), "factory-ping-env-"));
  try {
    const outcome = ping("claude", 'printf %s "$FACTORY_NOTIFY_MESSAGE" > seen.txt', dir, MSG);
    expect(outcome).toEqual({ k: "pinged" });
    expect(readFileSync(join(dir, "seen.txt"), "utf8")).toBe(MSG);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
