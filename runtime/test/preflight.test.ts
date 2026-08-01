import { test, expect } from "bun:test";
import { preflight, compareStamp } from "../src/preflight";
import type { PreflightFacts } from "../src/preflight";
import type { FactoryConfig } from "../src/config";
import { ROLE_TABLE } from "../src/roles";
import { LOOP_SECTION_HEADING } from "../src/stamp";

// ───── shared fixtures

const goodConfig: FactoryConfig = {
  stampVersion: "2.0.0",
  tracker: { kind: "github", repo: "owner/name" },
  merge: { policy: "human" },
  attackSurface: true,
};

function greenFacts(): PreflightFacts {
  return {
    config: { ok: true, config: goodConfig },
    adapterMarker: { kind: "github" },
    trackerReachable: { result: "ok" },
    pushCheck: { ok: true, detail: "push ok" },
    stampVersion: { repo: "2.0.0", plugin: "2.0.0" },
    stampFacts: { configVersion: "2.0.0", adapterDoc: null },
    availableRoles: ROLE_TABLE.map((r) => r.preferred.name),
  };
}

function facts(overrides: Partial<PreflightFacts> = {}): PreflightFacts {
  return { ...greenFacts(), ...overrides };
}

// ───── green path

test("all sources agree and everything checks out: ok", () => {
  const result = preflight(greenFacts());
  expect(result).toEqual({ ok: true });
});

// ───── trackerReachable "not-asked"

test("'not-asked' on an otherwise clean board is itself a failure", () => {
  const facts = greenFacts();
  facts.trackerReachable = "not-asked";
  const result = preflight(facts);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failures.length).toBe(1);
  expect(result.failures[0].what).toMatch(/never checked/);
});

test("'not-asked' is excused when config is invalid — that failure already explains it", () => {
  const facts = greenFacts();
  facts.config = { ok: false, errors: ["attackSurface: required"] };
  facts.trackerReachable = "not-asked";
  const result = preflight(facts);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failures.length).toBe(1);
  expect(result.failures[0].what).toMatch(/attackSurface/);
});

test("'not-asked' is excused when config.json is missing entirely", () => {
  const facts = greenFacts();
  facts.config = "missing-file";
  facts.trackerReachable = "not-asked";
  const result = preflight(facts);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failures.length).toBe(1);
  expect(result.failures[0].what).toMatch(/not stamped for v2/);
});

test("'not-asked' is excused when the adapter doc is missing entirely", () => {
  const facts = greenFacts();
  facts.adapterMarker = "missing-file";
  facts.trackerReachable = "not-asked";
  const result = preflight(facts);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failures.length).toBe(1);
  expect(result.failures[0].what).toMatch(/not stamped for the loop/);
});

test("'not-asked' is excused when the adapter marker is missing", () => {
  const facts = greenFacts();
  facts.adapterMarker = "missing-marker";
  facts.trackerReachable = "not-asked";
  const result = preflight(facts);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failures.length).toBe(1);
  expect(result.failures[0].what).toMatch(/no machine-readable marker/);
});

test("'not-asked' is excused when config vs adapter marker disagree", () => {
  const facts = greenFacts();
  facts.adapterMarker = { kind: "linear" };
  facts.trackerReachable = "not-asked";
  const result = preflight(facts);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failures.length).toBe(1);
  expect(result.failures[0].what).toContain("github");
  expect(result.failures[0].what).toContain("linear");
});

// ───── each single failure

test("invalid config produces one failure per parse error", () => {
  const facts = greenFacts();
  facts.config = { ok: false, errors: ["stampVersion: required", "tracker: required"] };
  const result = preflight(facts);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failures.length).toBe(2);
  for (const failure of result.failures) {
    expect(failure.what).toMatch(/required/);
    expect(failure.why.length).toBeGreaterThan(0);
    expect(failure.fix.length).toBeGreaterThan(0);
  }
});

test("missing config file: dedicated failure, distinct from per-field parse errors", () => {
  const facts = greenFacts();
  facts.config = "missing-file";
  const result = preflight(facts);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failures.length).toBe(1);
  expect(result.failures[0].what).toMatch(/not stamped for v2/);
  expect(result.failures[0].fix).toBe("run /factory-adopt (safe to re-run) to create .factory/config.json");
});

test("missing adapter file: not stamped for the loop", () => {
  const facts = greenFacts();
  facts.adapterMarker = "missing-file";
  const result = preflight(facts);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failures.length).toBe(1);
  expect(result.failures[0].what).toMatch(/not stamped for the loop/);
});

test("missing adapter marker: not stamped for the loop, distinct from missing file", () => {
  const facts = greenFacts();
  facts.adapterMarker = "missing-marker";
  const result = preflight(facts);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failures.length).toBe(1);
  expect(result.failures[0].what).toMatch(/not stamped for the loop/);
  expect(result.failures[0].what).toMatch(/no machine-readable marker/);
});

test("config tracker.kind vs adapter marker kind mismatch: three-source contradiction", () => {
  const facts = greenFacts();
  facts.adapterMarker = { kind: "linear" };
  const result = preflight(facts);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failures.length).toBe(1);
  expect(result.failures[0].what).toContain("github");
  expect(result.failures[0].what).toContain("linear");
});

test("tracker unreachable carries its why", () => {
  const facts = greenFacts();
  facts.trackerReachable = { result: "unreachable", why: "gh auth token expired" };
  const result = preflight(facts);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failures.length).toBe(1);
  expect(result.failures[0].why).toBe("gh auth token expired");
});

test("push check failed carries its detail", () => {
  const facts = greenFacts();
  facts.pushCheck = { ok: false, detail: "no credential helper configured" };
  const result = preflight(facts);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failures.length).toBe(1);
  expect(result.failures[0].why).toBe("no credential helper configured");
});

// ───── multi-failure collection

test("config bad AND tracker unreachable AND push fail all collect in one report", () => {
  const facts = greenFacts();
  facts.config = { ok: false, errors: ["attackSurface: required"] };
  facts.trackerReachable = { result: "unreachable", why: "no token" };
  facts.pushCheck = { ok: false, detail: "push blocked" };

  const result = preflight(facts);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failures.length).toBe(3);
  expect(result.failures.some((f) => f.what.includes("attackSurface"))).toBe(true);
  expect(result.failures.some((f) => f.why === "no token")).toBe(true);
  expect(result.failures.some((f) => f.why === "push blocked")).toBe(true);
});

// ───── stale vs newer stamp

test("repo stamp older than plugin: migration pending, blocks execution only", () => {
  const facts = greenFacts();
  facts.stampVersion = { repo: "1.0.0", plugin: "2.0.0" };
  const result = preflight(facts);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failures.length).toBe(1);
  expect(result.failures[0].what).toMatch(/older/);
  expect(result.failures[0].blocksExecutionOnly).toBe(true);
});

test("repo stamp newer than plugin: update-the-plugin failure, also blocksExecutionOnly", () => {
  const facts = greenFacts();
  facts.stampVersion = { repo: "3.0.0", plugin: "2.0.0" };
  const result = preflight(facts);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failures.length).toBe(1);
  expect(result.failures[0].what).toMatch(/newer/);
  expect(result.failures[0].fix).toMatch(/update the Factory plugin/);
  expect(result.failures[0].blocksExecutionOnly).toBe(true);
});

test("unstamped repo (no config, no legacy adapter doc): treated as older than the plugin; fix names /factory-adopt", () => {
  const facts = greenFacts();
  facts.stampVersion = { repo: null, plugin: "2.0.0" };
  facts.stampFacts = { configVersion: null, adapterDoc: null };
  const result = preflight(facts);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failures.length).toBe(1);
  expect(result.failures[0].fix).toMatch(/\/factory-adopt/);
  expect(result.failures[0].fix).not.toMatch(/\/factory-migrate/);
  expect(result.failures[0].fix).toMatch(/stamp this repo/);
  expect(result.failures[0].blocksExecutionOnly).toBe(true);
});

test("legacy v1 repo (no config, adapter doc carries the loop section): fix names /factory-migrate and says the repo is legacy v1", () => {
  const facts = greenFacts();
  facts.stampVersion = { repo: null, plugin: "2.0.0" };
  facts.stampFacts = {
    configVersion: null,
    adapterDoc: `# Issue tracker\n\n${LOOP_SECTION_HEADING}\n\nlegacy loop content\n`,
  };
  const result = preflight(facts);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failures.length).toBe(1);
  expect(result.failures[0].fix).toMatch(/\/factory-migrate/);
  expect(result.failures[0].fix).not.toMatch(/\/factory-adopt/);
  expect(result.failures[0].fix).toMatch(/legacy v1/);
  expect(result.failures[0].blocksExecutionOnly).toBe(true);
});

test("a legacy v1 repo's three failures: config and marker name factory-adopt, the stale stamp names factory-migrate", () => {
  // Before task 7: config missing said adopt, missing marker said adopt, and
  // the stale stamp also said adopt (no migration entry point existed yet).
  // Now that /factory-migrate exists, the stale-stamp failure names it while
  // the other two — which are about files, not the stamp version — still
  // name /factory-adopt (safe to re-run).
  const facts = greenFacts();
  facts.config = "missing-file";
  facts.adapterMarker = "missing-marker";
  facts.stampVersion = { repo: null, plugin: "2.0.0" };
  facts.stampFacts = {
    configVersion: null,
    adapterDoc: `# Issue tracker\n\n${LOOP_SECTION_HEADING}\n\nlegacy loop content\n`,
  };
  const result = preflight(facts);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failures.length).toBe(3);
  const adoptFixes = result.failures.filter((f) => /^run \/factory-adopt \(safe to re-run\) to /.test(f.fix));
  const migrateFixes = result.failures.filter((f) => /^run \/factory-migrate to /.test(f.fix));
  expect(adoptFixes.length).toBe(2);
  expect(migrateFixes.length).toBe(1);
  expect(migrateFixes[0].fix).toMatch(/legacy v1/);
});

test("no fix names an entry point the plugin does not ship — no 'migration step' to run", () => {
  // Nothing applies a migration yet (PROTOCOL.md "## Migration", issue #50),
  // so no failure may tell a maintainer to run one.
  const cases: (() => PreflightFacts)[] = [
    () => {
      const f = greenFacts();
      f.stampVersion = { repo: "1.0.0", plugin: "2.0.0" };
      f.stampFacts = { configVersion: "1.0.0", adapterDoc: null };
      return f;
    },
    () => {
      const f = greenFacts();
      f.stampVersion = { repo: null, plugin: "2.0.0" };
      f.stampFacts = {
        configVersion: null,
        adapterDoc: `# Issue tracker\n\n${LOOP_SECTION_HEADING}\n\nlegacy loop content\n`,
      };
      return f;
    },
    () => {
      const f = greenFacts();
      f.config = "missing-file";
      f.adapterMarker = "missing-marker";
      f.stampVersion = { repo: null, plugin: "2.0.0" };
      f.stampFacts = {
        configVersion: null,
        adapterDoc: `# Issue tracker\n\n${LOOP_SECTION_HEADING}\n\nlegacy loop content\n`,
      };
      return f;
    },
  ];

  for (const build of cases) {
    const result = preflight(build());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    for (const failure of result.failures) {
      expect(failure.fix).not.toMatch(/migration step/i);
    }
  }
});

test("both stale and newer stamp failures carry blocksExecutionOnly; push-check failure does not", () => {
  const staleFacts = greenFacts();
  staleFacts.stampVersion = { repo: "1.0.0", plugin: "2.0.0" };
  const stale = preflight(staleFacts);
  expect(stale.ok).toBe(false);
  if (stale.ok) return;
  expect(stale.failures[0].blocksExecutionOnly).toBe(true);

  const newerFacts = greenFacts();
  newerFacts.stampVersion = { repo: "3.0.0", plugin: "2.0.0" };
  const newer = preflight(newerFacts);
  expect(newer.ok).toBe(false);
  if (newer.ok) return;
  expect(newer.failures[0].blocksExecutionOnly).toBe(true);

  const pushFailFacts = greenFacts();
  pushFailFacts.pushCheck = { ok: false, detail: "push blocked" };
  const pushFail = preflight(pushFailFacts);
  expect(pushFail.ok).toBe(false);
  if (pushFail.ok) return;
  expect(pushFail.failures[0].blocksExecutionOnly).toBeUndefined();
});

// ───── compareStamp

test("compareStamp: equal versions", () => {
  expect(compareStamp("2.0.0", "2.0.0")).toBe(0);
});

test("compareStamp: major difference", () => {
  expect(compareStamp("1.0.0", "2.0.0")).toBe(-1);
  expect(compareStamp("3.0.0", "2.0.0")).toBe(1);
});

test("compareStamp: minor/patch differences within the same major", () => {
  expect(compareStamp("2.1.0", "2.0.0")).toBe(1);
  expect(compareStamp("2.0.1", "2.0.0")).toBe(1);
  expect(compareStamp("2.0.0", "2.0.1")).toBe(-1);
});

test("compareStamp: differing segment counts treat missing segments as 0", () => {
  expect(compareStamp("2.0", "2.0.0")).toBe(0);
  expect(compareStamp("2", "2.0.0")).toBe(0);
  expect(compareStamp("2.1", "2.0.0")).toBe(1);
});

test("compareStamp does a full dotted compare, not major-only: a minor-ahead repo stamp diverges from its plugin", () => {
  // A major-only compare would call "2.5.0" and "2.3.0" equal (same major).
  // The full compare says 2.5.0 is newer, which is what preflight needs: a
  // repo stamped by a future plugin (say 2.5.0) must trigger the
  // update-the-plugin failure against an older-minor plugin (2.3.0), not
  // pass silently as "same version".
  expect(compareStamp("2.5.0", "2.3.0")).toBe(1);

  const facts = greenFacts();
  facts.stampVersion = { repo: "2.5.0", plugin: "2.3.0" };
  const result = preflight(facts);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failures.length).toBe(1);
  expect(result.failures[0].what).toMatch(/newer/);
  expect(result.failures[0].blocksExecutionOnly).toBe(true);
});

// ───── planning roles

test("preflight passes when every planning role resolves", () => {
  const got = preflight(facts({ availableRoles: ROLE_TABLE.map((r) => r.preferred.name) }));
  expect(got.ok).toBe(true);
});

test("a planning role with no available implementation fails preflight", () => {
  const got = preflight(facts({ availableRoles: [] }));
  expect(got.ok).toBe(false);
  if (got.ok) throw new Error("unreachable");
  expect(got.failures.some((f) => f.what.includes("Interrogate"))).toBe(true);
});

test("role failures join the other preflight failures rather than replacing them", () => {
  const got = preflight(facts({ config: "missing-file", availableRoles: [] }));
  expect(got.ok).toBe(false);
  if (got.ok) throw new Error("unreachable");
  expect(got.failures.some((f) => f.what.toLowerCase().includes("config"))).toBe(true);
  expect(got.failures.some((f) => f.what.includes("Interrogate"))).toBe(true);
});

test("a role resolving to its fallback does not fail preflight", () => {
  const available = ROLE_TABLE.map((r) => r.preferred.name).filter((p) => p !== "to-prd").concat("to-spec");
  const got = preflight(facts({ availableRoles: available }));
  expect(got.ok).toBe(true);
});
