// Pure section module (skills/factory-adopt/SKILL.md:229-257): classifies one
// already-stamped document against the rendered template it came from, so
// migration can retrofit conventions added since the stamp without
// re-litigating a file the maintainer already accepted. Three outcomes —
// identical, lacking whole chunks the template carries, or differing in a way
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

/** A template section plus the index it occupies in the template's section order. */
export type PositionedSection = Section & { index: number };

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
 * section either matches or lacks whole lines the template carries — the
 * signature of a repo stamped by an older Factory. Anything else is an
 * `other-difference`: show it, never overwrite.
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

  // Template indices whose current counterpart is there but incomplete — the
  // absent tracker marker inside an otherwise-untouched H1 section is this
  // case, and it takes the same path as a wholly absent section.
  const incomplete = new Set<number>();
  for (let i = 0; i < cur.length; i++) {
    const want = tpl[mapped[i]];
    if (sameBody(cur[i].body, want.body)) continue;
    if (lacksLines(cur[i].body, want.body)) {
      incomplete.add(mapped[i]);
      continue;
    }
    return {
      k: "other-difference",
      detail: `${label(want)} differs from the template beyond whole missing lines`,
    };
  }

  const present = new Set(mapped);
  const missing: PositionedSection[] = [];
  for (let t = 0; t < tpl.length; t++) {
    if (!present.has(t) || incomplete.has(t)) missing.push({ ...tpl[t], index: t });
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

/**
 * True when the body lacks whole lines the template's body carries and changes
 * nothing else — the within-a-section form of "missing sections". Blank lines
 * are ignored: inserting a block brings its blank separators with it.
 */
function lacksLines(body: string, want: string): boolean {
  const have = contentLines(body);
  const need = contentLines(want);
  if (have.length >= need.length) return false;
  let n = 0;
  for (const line of have) {
    while (n < need.length && need[n] !== line) n++;
    if (n >= need.length) return false;
    n++;
  }
  return true;
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
 */
export function applyMissing(current: string, missing: PositionedSection[]): string {
  const cur = parseSections(current);
  const inserts = [...missing].sort((a, b) => a.index - b.index);
  const out: Section[] = [];
  let c = 0;
  let m = 0;

  while (c < cur.length || m < inserts.length) {
    if (m < inserts.length && inserts[m].index <= out.length) {
      const next = inserts[m++];
      out.push({ heading: next.heading, level: next.level, body: next.body });
      // A section the template completes rather than adds carries the same
      // heading as the one it replaces — drop that one instead of duplicating it.
      if (c < cur.length && cur[c].heading === next.heading) c++;
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
