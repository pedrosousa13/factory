// Pure answer-wait module (PRD §5 item 3, §3): the decision a headless ask
// makes after posting a question and pinging the maintainer, plus the
// operator-facing message for a re-ask-once-then-stop failure. No fs, no
// network, no clock reads — `now` always arrives as a parameter, because the
// runtime is the only durable timer any harness offers.

import type { Ask } from "./tracker";
import type { AskOutcome } from "./askloop";

// ───── the wait decision

/**
 * Headless and interactive asks both resolve to this type so a caller can't
 * forget to handle one of the paths. `A` is the shape of the answer itself
 * (e.g. Answer[K] from tracker.ts, or any other ask's answer type).
 */
export type WaitDecision<A> =
  | { k: "continue"; answer: A }
  | { k: "keep-waiting" }
  | { k: "park" };

// askedAt and now are ISO 8601 strings, the form journal.ts stores and
// tracker.ts's createdAt already uses, so the journaled value feeds this
// function unconverted. Parsing a string is not a clock read: the module
// still never asks what time it is.
export interface WaitInput<A> {
  askedAt: string; // journaled, so a crash/restart resumes the same window instead of a fresh one
  now: string; // the caller's current moment
  windowMinutes: number; // config.ts's answerWindowMinutes
  answered: A | null; // the polled ticket's answer, or null if none has arrived yet
}

/**
 * An answer is checked before the clock: a maintainer's answer wins even at
 * or past the deadline, because parking on an answer already given is the
 * worst outcome. Only once there is no answer does the deadline matter, and
 * the deadline is measured from `askedAt`, never from process start.
 *
 * An unparseable timestamp parks. The window cannot be measured, and the
 * question is already durable on the ticket, so parking loses nothing —
 * whereas waiting on a window that can never expire would hang the run.
 */
export function waitDecision<A>(input: WaitInput<A>): WaitDecision<A> {
  if (input.answered !== null) return { k: "continue", answer: input.answered };

  const askedAt = epochOf(input.askedAt);
  const now = epochOf(input.now);
  if (askedAt === null || now === null) return { k: "park" };

  const deadline = askedAt + input.windowMinutes * 60_000;
  if (now >= deadline) return { k: "park" };
  return { k: "keep-waiting" };
}

const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

/**
 * Epoch ms for a canonical UTC ISO timestamp, or null for anything else.
 *
 * Date.parse alone is too permissive to be the guard the caller needs: it
 * accepts a date with no time at all, and it silently rolls a nonexistent
 * calendar date over into the next month ("2026-02-30" becomes March 2)
 * rather than rejecting it, which would hand back a deadline measured from a
 * day that never happened. Both values here are written by this runtime in
 * the canonical Z form, so anything else is corruption and parks.
 */
function epochOf(text: string): number | null {
  if (!UTC_ISO.test(text)) return null;
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) return null;
  // A rolled-over date reformats to different components than it was given.
  if (new Date(ms).toISOString().slice(0, 19) !== text.slice(0, 19)) return null;
  return ms;
}

/** Interactive runs ask live and skip ping/wait/Park entirely — no clock involved. */
export function interactiveAnswer<A>(answer: A): WaitDecision<A> {
  return { k: "continue", answer };
}

// ───── the stop message

/**
 * Re-ask-once-then-stop (PRD §3): the message names the failed ask, both
 * whys from askloop.ts's `AskOutcome`, and any state the maintainer needs to
 * clean up by hand (e.g. a claim still held). `outstanding` is null when the
 * failed ask left nothing behind.
 */
export function stopMessage<K extends Ask["k"]>(
  ask: Ask & { k: K },
  outcome: Extract<AskOutcome<K>, { status: "failed" }>,
  outstanding: string | null,
): string {
  const [whyFirst, whySecond] = outcome.whys;
  return [
    `Ask failed after one retry: ${JSON.stringify(ask)}`,
    `First attempt: ${whyFirst}`,
    `Second attempt: ${whySecond}`,
    `Outstanding: ${outstanding ?? "no outstanding state"}`,
  ].join("\n");
}
