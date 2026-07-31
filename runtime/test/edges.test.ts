import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectActor, gatherPreflightFacts } from "../src/edges";
import { STAMP_VERSION } from "../src/version";

// ───── isolation from the host's own git identity
//
// Plain `git config <key>` reads the merged local+global+system config, and
// the fallback/error paths below only make sense if there is genuinely no
// global identity to fall back to — regardless of what's set on whatever
// machine runs this test. GIT_CONFIG_GLOBAL/GIT_CONFIG_SYSTEM=/dev/null (git
// >= 2.32) blanks both out for the duration of the test, leaving only
// whatever the test itself writes into the scratch repo's local config.

let prevGlobal: string | undefined;
let prevSystem: string | undefined;

beforeEach(() => {
  prevGlobal = process.env.GIT_CONFIG_GLOBAL;
  prevSystem = process.env.GIT_CONFIG_SYSTEM;
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_SYSTEM = "/dev/null";
});

afterEach(() => {
  if (prevGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = prevGlobal;
  if (prevSystem === undefined) delete process.env.GIT_CONFIG_SYSTEM;
  else process.env.GIT_CONFIG_SYSTEM = prevSystem;
});

// ───── scratch repo helper

function scratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "edges-test-"));
  execFileSync("git", ["init", "-q", "."], { cwd: dir });
  return dir;
}

function setLocalConfig(repoRoot: string, key: string, value: string): void {
  execFileSync("git", ["config", key, value], { cwd: repoRoot });
}

// ───── detectActor

describe("detectActor", () => {
  test("reads git user.email when set locally", () => {
    const dir = scratchRepo();
    try {
      setLocalConfig(dir, "user.email", "dev@example.com");
      expect(detectActor(dir)).toEqual({ actor: "dev@example.com", source: "git-user.email" });
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("falls back to user.name when user.email is unset", () => {
    const dir = scratchRepo();
    try {
      setLocalConfig(dir, "user.name", "Dev Person");
      expect(detectActor(dir)).toEqual({ actor: "Dev Person", source: "git-user.name" });
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("prefers user.email over user.name when both are set", () => {
    const dir = scratchRepo();
    try {
      setLocalConfig(dir, "user.email", "dev@example.com");
      setLocalConfig(dir, "user.name", "Dev Person");
      expect(detectActor(dir)).toEqual({ actor: "dev@example.com", source: "git-user.email" });
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("reports an error when neither user.email nor user.name is set", () => {
    const dir = scratchRepo();
    try {
      const result = detectActor(dir);
      expect(result).toHaveProperty("error");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

// ───── gatherPreflightFacts

const ADAPTER_DOC_WITH_MARKER = ["# Issue tracker: GitHub", "", "<!-- factory:tracker kind=github -->", ""].join(
  "\n",
);

function writeConfig(repoRoot: string, stampVersion = STAMP_VERSION): void {
  mkdirSync(join(repoRoot, ".factory"), { recursive: true });
  writeFileSync(
    join(repoRoot, ".factory", "config.json"),
    JSON.stringify({
      stampVersion,
      tracker: { kind: "github", repo: "owner/name" },
      merge: { policy: "human" },
      attackSurface: true,
    }),
  );
}

function writeAdapterDoc(repoRoot: string): void {
  mkdirSync(join(repoRoot, "docs", "agents"), { recursive: true });
  writeFileSync(join(repoRoot, "docs", "agents", "issue-tracker.md"), ADAPTER_DOC_WITH_MARKER);
}

describe("gatherPreflightFacts", () => {
  test("missing config.json: config reports an honest not-found error, no crash", () => {
    const dir = scratchRepo();
    try {
      const facts = gatherPreflightFacts(dir, { trackerReachable: "not-asked" });
      expect(facts.config.ok).toBe(false);
      if (facts.config.ok) return;
      expect(facts.config.errors.some((e) => e.includes(".factory/config.json"))).toBe(true);
      expect(facts.adapterMarker).toBe("missing-file");
      expect(facts.stampVersion).toEqual({ repo: null, plugin: STAMP_VERSION });
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("valid config + marker: parses config, reads the adapter marker, fills stampVersion from config", () => {
    const dir = scratchRepo();
    try {
      writeConfig(dir, "2.0.0");
      writeAdapterDoc(dir);
      const facts = gatherPreflightFacts(dir, { trackerReachable: { result: "ok" } });

      expect(facts.config.ok).toBe(true);
      expect(facts.adapterMarker).toEqual({ kind: "github" });
      expect(facts.trackerReachable).toEqual({ result: "ok" });
      expect(facts.stampVersion).toEqual({ repo: "2.0.0", plugin: STAMP_VERSION });
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("no origin remote: the push check honestly fails, with a detail, no network attempted", () => {
    const dir = scratchRepo();
    try {
      writeConfig(dir);
      writeAdapterDoc(dir);
      const facts = gatherPreflightFacts(dir, { trackerReachable: "not-asked" });

      expect(facts.pushCheck.ok).toBe(false);
      expect(facts.pushCheck.detail.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("trackerReachable is passed through untouched — edges never spawn a harness themselves", () => {
    const dir = scratchRepo();
    try {
      const reachable = { result: "unreachable" as const, why: "no token" };
      const facts = gatherPreflightFacts(dir, { trackerReachable: reachable });
      expect(facts.trackerReachable).toEqual(reachable);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
