// Pure marker module: reads the machine-readable tracker-kind marker the
// stamp writes into a tracker adapter doc (`<!-- factory:tracker kind=... -->`,
// immediately after the H1), and preflight reads back. No fs, no process,
// no I/O — callers pass in the file text they already read.

export type MarkerResult = { kind: string } | "missing-marker";

const MARKER_RE = /<!--\s*factory:tracker\s+kind=([\w-]+)\s*-->/;

/** Finds the marker anywhere in the text — surviving prose edits elsewhere. */
export function readMarker(fileText: string): MarkerResult {
  const match = fileText.match(MARKER_RE);
  if (!match) return "missing-marker";
  return { kind: match[1] };
}
