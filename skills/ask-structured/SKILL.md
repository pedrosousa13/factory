---
name: ask-structured
description: Ask the user whatever questions you need, as structured questions with researched recommendations. Use whenever you are about to ask the user a question, a clarification, or a decision mid-task.
---

When you need something from the user, ask it as a structured question with a researched recommendation. This is not an interview: ask only what you need to keep working, then carry on.

## Research before you ask

Finding _facts_ is your job, never the user's. Before asking, look up what the question depends on: the code, the docs, `GLOSSARY.md` and ADRs if the repo has them, the issue tracker, upstream documentation. Dispatch sub-agents for bulk lookups (Haiku for retrieval). If the lookup answers the question, don't ask it.

Ask only what is genuinely the user's to decide: intent, preference, priority, a tradeoff with no clear winner, an outward-facing or hard-to-reverse action. A choice with a conventional default isn't one; take the default and say so.

**Mid-loop in a Factory Loop Session (from pickup until the Queue runs out), don't ask through the tool.** A structured question blocks with no timeout and would stall the loop. Ping instead, per `PROTOCOL.md`'s "Ping and Park", with the options and recommendation in the text format below. The Triage pass at an issue boundary asks nothing at all.

Every recommendation rests on that research. A recommendation you can't back with evidence is a guess; say so in its description.

## Ask through the structured-question tool

In Claude Code, that is `AskUserQuestion`. Batch the questions that don't depend on each other, up to four per call. A question that depends on an open answer waits for a later call. For each question:

- **Header**: a short chip label, 12 characters or fewer.
- **Options**: 2–4, mutually exclusive. Each description says what the option means and what it costs.
- **Recommended option first**, its label ending in `(Recommended)`. Its description gives the reason and names the evidence: a file and line, a doc, an issue.
  On a multiSelect question, label each option you recommend.
- **No "Other" option.** The tool adds its own free-text escape.
- **Previews** only when the user must compare concrete artifacts side by side (code shapes, layouts, configs), and only on single-select questions.
- **multiSelect** only when the choices are genuinely not exclusive.

**Without a structured tool** (Codex, Pi, or any harness that lacks one), fall back to the `grilling` skill's text format: number each question, follow it with `➡️` and the recommendation, and word it so "yes" accepts the recommendation.

## After the answer

The decision is the user's. Never apply a recommendation before the user picks it. Act on the answer and continue the task; don't turn one question into a round of follow-ups unless the answer opened a real new decision.
