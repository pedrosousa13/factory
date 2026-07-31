// Pure override-ratchet module: merges `--milestone`/`--headless`/`--merge`/
// `--sweeps` run overrides over committed config (PRD §3, "Run overrides
// ratchet toward safety only"). No fs, no process, no I/O.

import type { FactoryConfig, MergePolicy } from "./config";

// ───── config file named in refusals

const CONFIG_PATH = ".factory/config.json";

// ───── override shape

export interface RunOverrides {
  milestone?: string;
  headless?: boolean;
  merge?: MergePolicy;
  sweeps?: boolean;
}

// ───── merged result

export interface MergedRun {
  milestone?: string;
  headless?: boolean;
  mergePolicy: MergePolicy;
  sweeps: boolean;
}

export type ApplyResult =
  | { ok: true; merged: MergedRun }
  | { ok: false; refusals: string[] };

// ───── applyOverrides

export function applyOverrides(config: FactoryConfig, overrides: RunOverrides): ApplyResult {
  const refusals: string[] = [];

  // merge: tightening (any policy -> human) is always allowed; loosening
  // (human -> any non-human policy) is refused; a lateral swap between two
  // different auto policies (e.g. squash -> rebase) neither tightens nor
  // loosens, so it is refused too.
  let mergePolicy = config.merge.policy;
  if (overrides.merge !== undefined) {
    if (config.merge.policy === "human" && overrides.merge !== "human") {
      refusals.push(
        `--merge=${overrides.merge} loosens the committed "human" merge policy; ` +
          `edit and commit ${CONFIG_PATH} instead`,
      );
    } else if (
      config.merge.policy !== "human" &&
      overrides.merge !== "human" &&
      overrides.merge !== config.merge.policy
    ) {
      refusals.push(
        `--merge=${overrides.merge} is lateral to the committed "${config.merge.policy}" ` +
          `merge policy; run overrides ratchet toward safety only, and a lateral change ` +
          `neither tightens nor loosens, so it is not allowed; edit and commit ${CONFIG_PATH} instead`,
      );
    } else {
      mergePolicy = overrides.merge;
    }
  }

  // sweeps: turning sweeps on over a declined attack surface tightens the
  // run and is always allowed; turning sweeps off over a set attack surface
  // loosens it and is refused.
  let sweeps = config.attackSurface;
  if (overrides.sweeps !== undefined) {
    if (overrides.sweeps === false && config.attackSurface === true) {
      refusals.push(
        `--no-sweeps loosens the run below the committed attackSurface=true; ` +
          `edit and commit ${CONFIG_PATH} instead`,
      );
    } else {
      sweeps = overrides.sweeps;
    }
  }

  if (refusals.length > 0) {
    return { ok: false, refusals };
  }

  return {
    ok: true,
    merged: {
      ...(overrides.milestone !== undefined ? { milestone: overrides.milestone } : {}),
      ...(overrides.headless !== undefined ? { headless: overrides.headless } : {}),
      mergePolicy,
      sweeps,
    },
  };
}
