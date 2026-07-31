/**
 * Ask loop — reusable ask/validate/retry machinery, harness-agnostic.
 *
 * Lifted from runtime/conformance/sweep.ts's proven L2 conformance machinery
 * so an L1 caller can exercise it with a fake `Runner` (no harness CLI spawned)
 * as well as a real one. Pure: the module spawns nothing itself — callers
 * inject how a prompt actually gets answered.
 *
 * One shared prompt template (question + phrasebook + answer shape + "reply
 * with ONLY that JSON"), answers validated with `check()` from ./tracker,
 * exactly one re-ask on a malformed or thrown reply. The failed outcome
 * carries both whys — the first (what made the original reply invalid) and
 * the second (what made the re-ask invalid too) — because the runtime's stop
 * message needs both.
 */

import { check, type Ask, type Answer } from "./tracker";

// ──────────────────────────────────────────────────────────────────── types

/** How a prompt actually gets answered. The module spawns nothing itself.
 * Only `raw` is read here; a HarnessRun satisfies this structurally. */
export type Runner = (prompt: string) => { raw: string };

export type AskStatus = "valid-first-try" | "valid-after-reask" | "failed";

export type AskOutcome<K extends Ask["k"]> =
  | { status: "valid-first-try" | "valid-after-reask"; answer: Answer[K] }
  | { status: "failed"; whys: [string, string] };

// ───────────────────────────────────────────────────────────────── prompt

/** The one shared template: question + phrasebook + exact answer shape + "reply with ONLY that JSON". */
export function buildPrompt(question: string, phrasebook: string, shapeText: string): string {
  return [question, "", phrasebook, "", shapeText, "", "Reply with ONLY that JSON, no prose."].join("\n");
}

// ─────────────────────────────────────────────────────────── extract + validate

/** Strip a wrapping code fence if present, then take the first balanced {...} value. Null if none found or unparseable. */
export function extractJson(raw: string): unknown | null {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────── ask + reask

/** One ask, one run. Runner exceptions (e.g. a malformed CLI envelope) count as an invalid reply, not a crash. */
export function askOnce(
  runner: Runner,
  ask: Ask,
  prompt: string,
): { ok: true; answer: Answer[Ask["k"]] } | { ok: false; why: string } {
  let raw: string;
  try {
    raw = runner(prompt).raw;
  } catch (e) {
    return { ok: false, why: `harness threw: ${(e as Error).message}` };
  }

  const parsed = extractJson(raw);
  if (parsed === null) return { ok: false, why: "could not extract JSON from response" };

  return check(ask, parsed);
}

/** One ask, exactly one re-ask on failure, with the checker's why appended to the re-ask prompt. */
export function askWithRetry<K extends Ask["k"]>(
  runner: Runner,
  ask: Ask & { k: K },
  prompt: string,
): AskOutcome<K> {
  const r1 = askOnce(runner, ask, prompt);
  if (r1.ok) return { status: "valid-first-try", answer: r1.answer as Answer[K] };

  const reaskPrompt = `${prompt}\n\nYour previous reply was invalid: ${r1.why}\nReply again with ONLY the corrected JSON, no prose.`;
  const r2 = askOnce(runner, ask, reaskPrompt);
  if (r2.ok) return { status: "valid-after-reask", answer: r2.answer as Answer[K] };

  return { status: "failed", whys: [r1.why, r2.why] };
}
