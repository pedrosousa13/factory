import { test, expect } from "bun:test";
import { applyOverrides } from "../src/ratchet";
import type { FactoryConfig } from "../src/config";

// ───── fixtures

function baseConfig(overrides: Partial<FactoryConfig> = {}): FactoryConfig {
  return {
    stampVersion: "2.0.0",
    tracker: { kind: "github" },
    merge: { policy: "squash" },
    attackSurface: false,
    ...overrides,
  };
}

// ───── milestone / headless: always free

test("milestone and headless pass through with no refusal", () => {
  const result = applyOverrides(baseConfig(), { milestone: "M1", headless: true });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.merged.milestone).toBe("M1");
    expect(result.merged.headless).toBe(true);
  }
});

test("milestone and headless are free even alongside a merge policy at human", () => {
  const result = applyOverrides(baseConfig({ merge: { policy: "human" } }), {
    milestone: "M2",
    headless: false,
    merge: "human",
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.merged.milestone).toBe("M2");
    expect(result.merged.headless).toBe(false);
  }
});

// ───── merge: tightening allowed

test("merge=human over an auto policy is allowed", () => {
  const result = applyOverrides(baseConfig({ merge: { policy: "squash" } }), {
    merge: "human",
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.merged.mergePolicy).toBe("human");
  }
});

test("merge=human over an already-human policy is allowed (no-op)", () => {
  const result = applyOverrides(baseConfig({ merge: { policy: "human" } }), {
    merge: "human",
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.merged.mergePolicy).toBe("human");
  }
});

// ───── sweeps: tightening allowed

test("sweeps=true over a declined attack surface is allowed", () => {
  const result = applyOverrides(baseConfig({ attackSurface: false }), {
    sweeps: true,
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.merged.sweeps).toBe(true);
  }
});

test("sweeps=false over a declined attack surface is allowed (no-op)", () => {
  const result = applyOverrides(baseConfig({ attackSurface: false }), {
    sweeps: false,
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.merged.sweeps).toBe(false);
  }
});

// ───── merge: loosening refused

test("merge=squash over a human policy is refused, pointing at the committed config", () => {
  const result = applyOverrides(baseConfig({ merge: { policy: "human" } }), {
    merge: "squash",
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.refusals.length).toBe(1);
    expect(result.refusals[0]).toContain(".factory/config.json");
  }
});

test("merge=rebase over a human policy is refused", () => {
  const result = applyOverrides(baseConfig({ merge: { policy: "human" } }), {
    merge: "rebase",
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.refusals[0]).toContain(".factory/config.json");
  }
});

test("merge=rebase over a committed squash policy is refused (lateral)", () => {
  const result = applyOverrides(baseConfig({ merge: { policy: "squash" } }), {
    merge: "rebase",
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.refusals.length).toBe(1);
    expect(result.refusals[0]).toContain(".factory/config.json");
  }
});

test("merge=squash over a committed merge policy is refused (lateral)", () => {
  const result = applyOverrides(baseConfig({ merge: { policy: "merge" } }), {
    merge: "squash",
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.refusals.length).toBe(1);
    expect(result.refusals[0]).toContain(".factory/config.json");
  }
});

// ───── merge: equal-to-policy override allowed (no-op)

test("merge=squash over an already-squash policy is allowed (no-op)", () => {
  const result = applyOverrides(baseConfig({ merge: { policy: "squash" } }), {
    merge: "squash",
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.merged.mergePolicy).toBe("squash");
  }
});

// ───── sweeps: loosening refused

test("sweeps=false over a set attack surface is refused", () => {
  const result = applyOverrides(baseConfig({ attackSurface: true }), {
    sweeps: false,
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.refusals.length).toBe(1);
    expect(result.refusals[0]).toContain(".factory/config.json");
  }
});

// ───── multiple refusals collected

test("collects both a merge and a sweeps refusal in one call", () => {
  const result = applyOverrides(
    baseConfig({ merge: { policy: "human" }, attackSurface: true }),
    { merge: "squash", sweeps: false },
  );

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.refusals.length).toBe(2);
    expect(result.refusals.some((r) => r.includes("merge"))).toBe(true);
    expect(result.refusals.some((r) => r.includes("sweeps"))).toBe(true);
  }
});

// ───── no overrides at all

test("no overrides merges cleanly with committed policy and attack surface", () => {
  const result = applyOverrides(
    baseConfig({ merge: { policy: "human" }, attackSurface: true }),
    {},
  );

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.merged.mergePolicy).toBe("human");
    expect(result.merged.sweeps).toBe(true);
    expect(result.merged.milestone).toBeUndefined();
    expect(result.merged.headless).toBeUndefined();
  }
});
