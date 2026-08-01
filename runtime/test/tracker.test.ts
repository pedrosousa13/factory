import { test, expect } from "bun:test";
import { check } from "../src/tracker";

// ───── tracker.setReady
//
// Park's fourth step. No other ask touches the agent-ready label, so without
// this one a Parked ticket would keep advertising itself as ready to work.

test("check accepts a well-formed setReady answer", () => {
  const result = check({ k: "tracker.setReady", issue: "T-1", ready: false }, { result: "ok" });

  expect(result).toEqual({ ok: true, answer: { result: "ok" } });
});

test("check rejects a setReady answer whose result is not ok", () => {
  const result = check({ k: "tracker.setReady", issue: "T-1", ready: false }, { result: "done" });

  expect(result.ok).toBe(false);
});

test("check rejects a setReady answer that is not an object", () => {
  expect(check({ k: "tracker.setReady", issue: "T-1", ready: true }, "ok").ok).toBe(false);
});
