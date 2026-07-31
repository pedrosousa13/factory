// Pure path constants. Fixed, gitignored, not configurable (PRD §3) — the
// single definition for literals that were previously duplicated across
// edges.ts, ratchet.ts, bin/config-show.ts, and config.ts.

export const CONFIG_PATH = ".factory/config.json";
export const LOCK_PATH = ".factory/run.lock";
export const JOURNAL_PATH = ".factory/journal.json";
