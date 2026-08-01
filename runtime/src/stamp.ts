// Pure stamp-detection module (PRD §6 "Detection"; PROTOCOL.md:84-98): which
// of the three stamp states a repo is in. Deciding whether a v2 stamp is
// stale, current, or newer is preflight.ts's job, not this module's — this
// only says which kind of stamp is there. No fs, no process, no I/O.

// ───── the states

export type StampState =
  | { k: "v2"; version: string }
  | { k: "legacy-v1" }
  | { k: "unstamped" };

export type StampFacts = {
  // From .factory/config.json. Null when the file is absent, unparseable, or
  // carries no stampVersion — all three mean "no usable v2 config".
  configVersion: string | null;
  // Full text of docs/agents/issue-tracker.md, or null when absent.
  adapterDoc: string | null;
};

// ───── the legacy marker

// PROTOCOL.md:90-92 names this exact heading as the legacy v1 signature: an
// adapter doc carrying it predates config.json. A doc without it is not a v1
// stamp at all — PROTOCOL.md:94-98 sends that repo to /factory-adopt.
export const LOOP_SECTION_HEADING = "## Factory loop operations";

// Anchored to the start of a line so prose mentioning the phrase does not
// count as carrying the section.
const LOOP_SECTION_RE = new RegExp(`^${LOOP_SECTION_HEADING}\\s*$`, "m");

// ───── detection

export function detectStamp(facts: StampFacts): StampState {
  if (facts.configVersion !== null) return { k: "v2", version: facts.configVersion };
  if (facts.adapterDoc !== null && LOOP_SECTION_RE.test(facts.adapterDoc)) return { k: "legacy-v1" };
  return { k: "unstamped" };
}
