// Pure journal module: rendering/parsing `.factory/journal.json`, the
// runtime's one gitignored pointer file (PRD §5 item 8). No fs, no process,
// no clock reads — callers pass in the file text they already read (or
// didn't find) and get back a record.
//
// The journal is a hint, not truth: recovery checks it against the tracker
// and git, and rebuilds the same picture without it if it's missing or
// garbled. So parsing never throws — every unusable input reads back as
// "no-journal" instead.

import { JOURNAL_PATH } from "./paths";

export { JOURNAL_PATH };

export interface OpenQuestion {
  text: string;
  // ISO 8601 — a string, not a Date, so a crash mid-run can't lose it and a
  // later read can compare it against the answer window without re-parsing.
  askedAt: string;
}

export interface JournalRecord {
  ticket: string;
  branch: string;
  step: string;
  openQuestion: OpenQuestion | null;
  workers: string[];
}

export type ParseJournalResult = { ok: true; record: JournalRecord } | { ok: false };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOpenQuestion(value: unknown): value is OpenQuestion {
  return (
    isPlainObject(value) && typeof value.text === "string" && typeof value.askedAt === "string"
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** Renders a record to the journal file's text. Each step overwrites the file whole. */
export function renderJournal(record: JournalRecord): string {
  return JSON.stringify(record, null, 2) + "\n";
}

/**
 * Tolerant by design: absent/empty/whitespace text, invalid JSON, JSON that
 * isn't an object, and objects with missing or wrong-typed fields all read
 * back as `{ ok: false }` rather than throwing — a garbled hint file must
 * never stop a run. Extra unknown fields are ignored (same forward-compat
 * rule as agentwork.ts's checkAgent).
 */
export function parseJournal(text: string): ParseJournalResult {
  if (text.trim() === "") return { ok: false };

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false };
  }

  if (!isPlainObject(data)) return { ok: false };

  if (typeof data.ticket !== "string") return { ok: false };
  if (typeof data.branch !== "string") return { ok: false };
  if (typeof data.step !== "string") return { ok: false };
  if (!("openQuestion" in data)) return { ok: false };
  if (data.openQuestion !== null && !isOpenQuestion(data.openQuestion)) return { ok: false };
  if (!isStringArray(data.workers)) return { ok: false };

  return {
    ok: true,
    record: {
      ticket: data.ticket,
      branch: data.branch,
      step: data.step,
      openQuestion: data.openQuestion,
      workers: data.workers,
    },
  };
}
