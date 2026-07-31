import { test, expect } from "bun:test";
import { askWithRetry, buildPrompt, extractJson, type Runner } from "../src/askloop";
import type { Ask } from "../src/tracker";

const ask: Ask = { k: "tracker.reachable" };
const prompt = "Can this project's tracker be reached right now?";

// ───── buildPrompt

test("buildPrompt: assembles question + phrasebook + shape + reply instruction", () => {
  const p = buildPrompt("Q?", "PHRASEBOOK", "SHAPE");
  expect(p).toContain("Q?");
  expect(p).toContain("PHRASEBOOK");
  expect(p).toContain("SHAPE");
  expect(p).toContain("Reply with ONLY that JSON, no prose.");
});

// ───── extractJson

test("extractJson: strips a wrapping code fence", () => {
  const raw = '```json\n{"result":"ok"}\n```';
  expect(extractJson(raw)).toEqual({ result: "ok" });
});

test("extractJson: pulls the first balanced JSON value out of surrounding prose", () => {
  const raw = 'Sure thing! Here is the answer: {"result":"ok"} — hope that helps.';
  expect(extractJson(raw)).toEqual({ result: "ok" });
});

test("extractJson: no { in the reply returns null", () => {
  expect(extractJson("no json here at all")).toBe(null);
});

test("extractJson: unbalanced braces return null", () => {
  expect(extractJson('{"result": "ok"')).toBe(null);
});

// ───── askWithRetry

test("askWithRetry: valid on the first try", () => {
  const runner: Runner = () => ({ raw: '{"result":"ok"}', ms: 1, exit: 0 });
  const result = askWithRetry(runner, ask, prompt);
  expect(result.status).toBe("valid-first-try");
  if (result.status === "failed") throw new Error("unexpected failed status");
  expect(result.answer).toEqual({ result: "ok" });
});

test("askWithRetry: garbled first reply then a valid re-ask; the re-ask prompt carries the first why", () => {
  const seenPrompts: string[] = [];
  const runner: Runner = (p) => {
    seenPrompts.push(p);
    if (seenPrompts.length === 1) return { raw: "not json at all", ms: 1, exit: 0 };
    return { raw: '{"result":"ok"}', ms: 1, exit: 0 };
  };
  const result = askWithRetry(runner, ask, prompt);
  expect(result.status).toBe("valid-after-reask");
  if (result.status === "failed") throw new Error("unexpected failed status");
  expect(result.answer).toEqual({ result: "ok" });
  expect(seenPrompts.length).toBe(2);
  expect(seenPrompts[1]).toContain("Your previous reply was invalid: could not extract JSON from response");
});

test("askWithRetry: garbled twice returns failed, carrying both whys", () => {
  let call = 0;
  const runner: Runner = () => {
    call++;
    return { raw: call === 1 ? "still not json" : '{"result":"nonsense"}', ms: 1, exit: 0 };
  };
  const result = askWithRetry(runner, ask, prompt);
  expect(result.status).toBe("failed");
  if (result.status !== "failed") throw new Error("unexpected non-failed status");
  expect(result.whys.length).toBe(2);
  expect(result.whys[0]).toMatch(/could not extract JSON/);
  expect(result.whys[1]).toMatch(/result/);
});

test("askWithRetry: no JSON in either reply fails with both whys reporting extraction failure", () => {
  const runner: Runner = () => ({ raw: "nope, no json", ms: 1, exit: 0 });
  const result = askWithRetry(runner, ask, prompt);
  expect(result.status).toBe("failed");
  if (result.status !== "failed") throw new Error("unexpected non-failed status");
  expect(result.whys[0]).toMatch(/could not extract JSON/);
  expect(result.whys[1]).toMatch(/could not extract JSON/);
});

test("askWithRetry: a runner that throws is treated as an invalid reply, not a crash", () => {
  const runner: Runner = () => {
    throw new Error("harness exploded");
  };
  const result = askWithRetry(runner, ask, prompt);
  expect(result.status).toBe("failed");
  if (result.status !== "failed") throw new Error("unexpected non-failed status");
  expect(result.whys[0]).toContain("harness exploded");
  expect(result.whys[1]).toContain("harness exploded");
});
