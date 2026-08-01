import { test, expect } from "bun:test";
import { renderJournal, parseJournal } from "../src/journal";
import type { JournalRecord } from "../src/journal";

// ───── fixtures

const withQuestion: JournalRecord = {
  ticket: "43",
  branch: "slice/43-ask-park-recovery",
  step: "implement",
  openQuestion: { text: "which flag should this use?", askedAt: "2026-08-01T12:00:00.000Z" },
  workers: ["w1", "w2"],
};

const withoutQuestion: JournalRecord = {
  ticket: "43",
  branch: "slice/43-ask-park-recovery",
  step: "verify",
  openQuestion: null,
  workers: [],
};

// ───── round trip

test("round trip: a record with an open question survives render then parse unchanged", () => {
  const result = parseJournal(renderJournal(withQuestion));

  expect(result.ok).toBe(true);
  if (result.ok) expect(result.record).toEqual(withQuestion);
});

test("round trip: a record with no open question survives render then parse unchanged", () => {
  const result = parseJournal(renderJournal(withoutQuestion));

  expect(result.ok).toBe(true);
  if (result.ok) expect(result.record).toEqual(withoutQuestion);
});

test("round trip: askedAt survives as the exact same string, not reparsed into a Date", () => {
  const result = parseJournal(renderJournal(withQuestion));

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.record.openQuestion?.askedAt).toBe("2026-08-01T12:00:00.000Z");
    expect(typeof result.record.openQuestion?.askedAt).toBe("string");
  }
});

// ───── forward compatibility

test("extra unknown fields are ignored, same rule as agentwork.ts's checkAgent", () => {
  const raw = JSON.stringify({ ...withoutQuestion, futureField: "something new" });

  const result = parseJournal(raw);

  expect(result.ok).toBe(true);
  if (result.ok) expect(result.record).toEqual(withoutQuestion);
});

// ───── tolerance: every corruption path reads back as no-journal, none throw

test("absent (empty string) reads back as no-journal", () => {
  expect(parseJournal("")).toEqual({ ok: false });
});

test("whitespace-only text reads back as no-journal", () => {
  expect(parseJournal("   \n\t  ")).toEqual({ ok: false });
});

test("malformed JSON reads back as no-journal", () => {
  expect(parseJournal("{ not valid json")).toEqual({ ok: false });
});

test("valid JSON that is an array reads back as no-journal", () => {
  expect(parseJournal("[]")).toEqual({ ok: false });
});

test("valid JSON that is a number reads back as no-journal", () => {
  expect(parseJournal("42")).toEqual({ ok: false });
});

test("valid JSON that is a string reads back as no-journal", () => {
  expect(parseJournal('"hello"')).toEqual({ ok: false });
});

test("valid JSON null reads back as no-journal", () => {
  expect(parseJournal("null")).toEqual({ ok: false });
});

test("an object missing ticket reads back as no-journal", () => {
  const { ticket, ...rest } = withoutQuestion;
  expect(parseJournal(JSON.stringify(rest))).toEqual({ ok: false });
});

test("an object missing branch reads back as no-journal", () => {
  const { branch, ...rest } = withoutQuestion;
  expect(parseJournal(JSON.stringify(rest))).toEqual({ ok: false });
});

test("an object missing step reads back as no-journal", () => {
  const { step, ...rest } = withoutQuestion;
  expect(parseJournal(JSON.stringify(rest))).toEqual({ ok: false });
});

test("an object missing openQuestion reads back as no-journal", () => {
  const { openQuestion, ...rest } = withoutQuestion;
  expect(parseJournal(JSON.stringify(rest))).toEqual({ ok: false });
});

test("an object missing workers reads back as no-journal", () => {
  const { workers, ...rest } = withoutQuestion;
  expect(parseJournal(JSON.stringify(rest))).toEqual({ ok: false });
});

test("ticket of the wrong type reads back as no-journal", () => {
  expect(parseJournal(JSON.stringify({ ...withoutQuestion, ticket: 43 }))).toEqual({ ok: false });
});

test("branch of the wrong type reads back as no-journal", () => {
  expect(parseJournal(JSON.stringify({ ...withoutQuestion, branch: null }))).toEqual({
    ok: false,
  });
});

test("step of the wrong type reads back as no-journal", () => {
  expect(parseJournal(JSON.stringify({ ...withoutQuestion, step: 7 }))).toEqual({ ok: false });
});

test("workers of the wrong type (not an array) reads back as no-journal", () => {
  expect(parseJournal(JSON.stringify({ ...withoutQuestion, workers: "w1" }))).toEqual({
    ok: false,
  });
});

test("workers containing a non-string element reads back as no-journal", () => {
  expect(parseJournal(JSON.stringify({ ...withoutQuestion, workers: ["w1", 2] }))).toEqual({
    ok: false,
  });
});

test("openQuestion that is not an object (and not null) reads back as no-journal", () => {
  expect(parseJournal(JSON.stringify({ ...withoutQuestion, openQuestion: "soon" }))).toEqual({
    ok: false,
  });
});

test("openQuestion missing askedAt reads back as no-journal", () => {
  expect(
    parseJournal(JSON.stringify({ ...withoutQuestion, openQuestion: { text: "which flag?" } })),
  ).toEqual({ ok: false });
});

test("openQuestion missing text reads back as no-journal", () => {
  expect(
    parseJournal(
      JSON.stringify({ ...withoutQuestion, openQuestion: { askedAt: "2026-08-01T12:00:00.000Z" } }),
    ),
  ).toEqual({ ok: false });
});

test("openQuestion.askedAt of the wrong type reads back as no-journal", () => {
  expect(
    parseJournal(
      JSON.stringify({
        ...withoutQuestion,
        openQuestion: { text: "which flag?", askedAt: 12345 },
      }),
    ),
  ).toEqual({ ok: false });
});

test("an openQuestion whose text is the wrong type reads as no journal", () => {
  const text = JSON.stringify({
    ticket: "43",
    branch: "43-ask-park",
    step: "implement",
    openQuestion: { text: 5, askedAt: "2026-08-01T10:00:00.000Z" },
    workers: ["worker-1"],
  });

  expect(parseJournal(text)).toEqual({ ok: false });
});

test("deeply nested garbage in a field reads as no journal rather than throwing", () => {
  let nested: unknown = "bottom";
  for (let i = 0; i < 500; i++) nested = [nested];
  const text = JSON.stringify({
    ticket: "43",
    branch: "43-ask-park",
    step: "implement",
    openQuestion: nested,
    workers: ["worker-1"],
  });

  expect(parseJournal(text)).toEqual({ ok: false });
});
