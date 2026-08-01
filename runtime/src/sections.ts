// Pure section module (skills/factory-adopt/SKILL.md:229-257): classifies one
// already-stamped document against the rendered template it came from, so
// migration can retrofit conventions added since the stamp without
// re-litigating a file the maintainer already accepted. Three outcomes —
// identical, lacking whole sections the template carries, or differing in a way
// only the maintainer can judge. No fs, no process, no clock: callers pass in
// the two texts they already have.
//
// Position is load-bearing. SKILL.md:236-241 requires an approved insertion to
// leave the file byte-identical to the rendered template, so the next run lands
// in the "matches" case and the migration stops nagging. Appending at the end
// would reorder sections and re-surface a whole-file diff on every later run.
// That is why `applyMissing` rebuilds the document from the template's section
// order instead of splicing by string offset.

// ───── the shapes

export type Section = {
  /** The raw heading line, right-trimmed. Empty for content before the first heading. */
  heading: string;
  /** 1-6 for an ATX heading; 0 for content before the first heading. */
  level: number;
  /** Everything from after the heading line up to the next heading. */
  body: string;
};

/**
 * A template section, the index it occupies in the template's section order, and
 * what applying it does to the current document. The two are different offers to
 * the maintainer, so a consumer must not print them with one wording:
 *
 * - `insert` — the document lacks this section entirely; applying adds it.
 * - `replace` — the document has this section but lacks the tracker marker
 *   inside it (SKILL.md:249-253); applying swaps the template's version in for
 *   the one already there. A consumer that splices sections itself must drop the
 *   section being replaced, or it emits the heading twice.
 */
export type PositionedSection = Section & { index: number; k: "insert" | "replace" };

export type DocDiff =
  | { k: "matches" }
  | { k: "missing-sections"; missing: PositionedSection[] }
  | { k: "other-difference"; detail: string };

// ───── parsing

const HEADING_RE = /^ {0,3}(#{1,6})(?:\s.*)?$/;
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Splits a document at its headings. A `#` inside a fenced code block is not a
 * heading, so fence state is tracked while walking the lines. The H1's section
 * carries everything before the next heading — which is how the one-line
 * tracker marker (`<!-- factory:tracker kind=... -->`, immediately after the
 * H1) rides along with it rather than needing a rule of its own.
 */
export function parseSections(text: string): Section[] {
  const lines = text.split("\n");
  const found: { at: number; level: number }[] = [];
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const opened = line.match(FENCE_OPEN_RE);
    if (opened) {
      fence = opened[1];
      continue;
    }
    const heading = line.match(HEADING_RE);
    if (heading) found.push({ at: i, level: heading[1].length });
  }

  const sections: Section[] = [];
  const preamble = lines.slice(0, found.length === 0 ? lines.length : found[0].at).join("\n");
  if (preamble.trim() !== "") sections.push({ heading: "", level: 0, body: preamble });

  for (let h = 0; h < found.length; h++) {
    const start = found[h].at;
    const end = h + 1 < found.length ? found[h + 1].at : lines.length;
    sections.push({
      heading: lines[start].trimEnd(),
      level: found[h].level,
      body: lines.slice(start + 1, end).join("\n"),
    });
  }
  return sections;
}

/** A fence closes on a run of its own character, at least as long as the opener. */
function closesFence(line: string, fence: string): boolean {
  const run = line.trim();
  if (run.length < fence.length) return false;
  for (const ch of run) if (ch !== fence[0]) return false;
  return true;
}

// ───── the three-way diff

/**
 * Compares a stamped document against its rendered template.
 *
 * `missing-sections` is the narrow case SKILL.md:235-253 describes: the current
 * document's headings are a subsequence of the template's, and every shared
 * section either matches or lacks nothing but the tracker marker — the signature
 * of a repo stamped by an older Factory. Anything else is an `other-difference`:
 * show it, never overwrite.
 *
 * An `other-difference`'s `detail` names every section that differs, and then
 * every section that merely lacks the tracker marker. The maintainer's three
 * offers (SKILL.md:254-256) apply to the whole document, so a `detail` that
 * named one section would hide the rest behind whichever choice they made. A
 * document whose headings do not line up at all returns earlier and names the
 * stray section instead: with no mapping there is nothing to compare section
 * by section.
 */
export function diffDoc(current: string, rendered: string): DocDiff {
  const cur = parseSections(current);
  const tpl = parseSections(rendered);

  const lined = mapHeadings(cur, tpl);
  if (!lined.ok) {
    return {
      k: "other-difference",
      detail: `carries ${label(lined.stray)}, which the template does not carry at that position`,
    };
  }
  const mapped = lined.mapped;

  // Template indices whose current counterpart is there but lacks the tracker
  // marker — the one sub-section retrofit SKILL.md:249-253 licenses by name.
  const markerless = new Set<number>();
  // Every section the maintainer has to judge, and every section that merely
  // lacks the marker. The loop runs to the end rather than returning on the
  // first difference: a document can differ in one section AND lack the
  // marker in another, and naming only the first leaves the maintainer to
  // choose keep-mine and then find preflight still red on `missing-marker`
  // with nothing in the report pointing at it.
  const differing: string[] = [];
  const markerNotes: string[] = [];
  for (let i = 0; i < cur.length; i++) {
    const want = tpl[mapped[i]];
    if (sameBody(cur[i].body, want.body)) continue;
    if (lacksOnlyMarker(cur[i].body, want.body)) {
      markerless.add(mapped[i]);
      markerNotes.push(`${label(want)} lacks the tracker marker`);
      continue;
    }
    differing.push(`${label(want)} differs from the template`);
  }
  // Classification is unchanged: one genuine difference is what makes this an
  // other-difference (SKILL.md:244). A document whose only finding is a
  // missing marker still takes the `replace` retrofit below. The marker notes
  // ride along in `detail` only when some other section already sent the
  // document here.
  if (differing.length > 0) {
    return { k: "other-difference", detail: [...differing, ...markerNotes].join("; ") };
  }

  const present = new Set(mapped);
  const missing: PositionedSection[] = [];
  for (let t = 0; t < tpl.length; t++) {
    if (!present.has(t)) missing.push({ ...tpl[t], index: t, k: "insert" });
    else if (markerless.has(t)) missing.push({ ...tpl[t], index: t, k: "replace" });
  }
  if (missing.length === 0) return { k: "matches" };
  return { k: "missing-sections", missing };
}

/**
 * Maps each current section to the template section it corresponds to, by
 * heading, left to right. Fails when the current headings are not a subsequence
 * of the template's — an extra section, or a reordering — and names the section
 * that broke the match so the maintainer sees what to judge.
 */
function mapHeadings(
  cur: Section[],
  tpl: Section[],
): { ok: true; mapped: number[] } | { ok: false; stray: Section } {
  const mapped: number[] = [];
  let t = 0;
  for (const section of cur) {
    while (t < tpl.length && tpl[t].heading !== section.heading) t++;
    if (t >= tpl.length) return { ok: false, stray: section };
    mapped.push(t);
    t++;
  }
  return { ok: true, mapped };
}

function label(section: Section): string {
  return section.heading === "" ? "the content before the first heading" : `"${section.heading}"`;
}

/** Trailing whitespace is not a difference — SKILL.md compares content, not padding. */
function sameBody(a: string, b: string): boolean {
  return a.trimEnd() === b.trimEnd();
}

// The one-line marker the stamp writes immediately after the H1 of a tracker
// adapter doc. Same shape marker.ts reads, anchored to a whole line: only a
// line that is nothing but the marker can be retrofitted this way.
const TRACKER_MARKER_LINE = /^<!--\s*factory:tracker\s+kind=[\w-]+\s*-->$/;

/**
 * True when the only thing the body lacks is the tracker marker.
 *
 * This is deliberately narrow. SKILL.md:235 scopes the middle case to "lacking
 * whole sections the template carries" and SKILL.md:244 sends "any difference
 * beyond cleanly missing sections" to the general case. SKILL.md:249-253 carves
 * out exactly one sub-section exception, by name and by size — the tracker
 * marker, "rather than falling through to the whole-file diff below over one
 * absent line". A maintainer who deleted a label row, a bullet, or a paragraph
 * from a section they still have is not missing that section: calling it missing
 * would mislabel their edit as an omission and offer only add-or-not, when
 * SKILL.md:254-256 grants them adopt, keep theirs, or merge by hand.
 */
function lacksOnlyMarker(body: string, want: string): boolean {
  const absent = absentLines(contentLines(body), contentLines(want));
  if (absent === null || absent.length === 0) return false;
  return absent.every((line) => TRACKER_MARKER_LINE.test(line.trim()));
}

/**
 * The template lines the body does not carry, in template order, or null when
 * the body is not a subsequence of the template's — that is, when it carries a
 * line of its own rather than merely lacking some. Blank lines are ignored:
 * inserting a line brings its blank separators with it.
 */
function absentLines(have: string[], need: string[]): string[] | null {
  const absent: string[] = [];
  let h = 0;
  for (const line of need) {
    if (h < have.length && have[h] === line) {
      h++;
      continue;
    }
    absent.push(line);
  }
  return h === have.length ? absent : null;
}

function contentLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "");
}

// ───── applying the insertion

/**
 * Rebuilds the document in the template's section order, taking each section
 * from `missing` where the template supplies it and from the current document
 * everywhere else. Rebuilding rather than splicing is what makes the result
 * byte-identical to the rendered template, so a second `diffDoc` returns
 * `matches` and the run converges (SKILL.md:236-241).
 *
 * Precondition: `missing` is the whole list `diffDoc` returned for this same
 * document, since the indices are positions in the finished document and only
 * line up as a set. Applying a subset still returns a document — the remaining
 * sections land as near their template positions as the shorter document allows
 * — but it is not byte-identical to the template, so it will not converge.
 */
export function applyMissing(current: string, missing: PositionedSection[]): string {
  const cur = parseSections(current);
  const inserts = [...missing].sort((a, b) => a.index - b.index);
  const out: Section[] = [];
  let c = 0;
  let m = 0;

  while (c < cur.length || m < inserts.length) {
    // Take the template's section when its position falls due, and when the
    // current document has run out of sections to place before it.
    const due = m < inserts.length && (inserts[m].index <= out.length || c >= cur.length);
    if (due) {
      const next = inserts[m++];
      out.push({ heading: next.heading, level: next.level, body: next.body });
      // A replacement stands in for the section already there — step over it,
      // or the heading comes out twice.
      if (next.k === "replace" && c < cur.length) c++;
      continue;
    }
    out.push(cur[c++]);
  }
  return render(out);
}

function render(sections: Section[]): string {
  const parts = sections
    .map((s) => (s.heading === "" ? s.body : s.heading + "\n" + s.body).trimEnd())
    .filter((part) => part !== "");
  if (parts.length === 0) return "";
  return parts.join("\n\n") + "\n";
}
