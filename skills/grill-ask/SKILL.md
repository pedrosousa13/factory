---
name: grill-ask
description: Grill the user relentlessly about a plan, decision, or idea, one round of structured questions at a time, each with a researched recommendation. Use when the user wants to stress-test their thinking through structured questions rather than free text.
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round, then wait for the user's answers before the next round.

## Research before you ask

Finding _facts_ is your job, never the user's. Before a round, find what each frontier question depends on: the code, the docs, `GLOSSARY.md` and ADRs if the repo has them, the issue tracker, upstream documentation. Dispatch sub-agents for the lookups (Haiku for bulk retrieval), asking for raw excerpts with `file:line` locations. Never ask the user for a fact you could look up.

Don't block on research: a running lookup is an unsettled prerequisite. Only the questions downstream of it wait for it; ask the rest of the frontier now.

Every recommendation rests on that research. A recommendation you can't back with evidence is a guess; say so in its description.

## Ask through the structured-question tool

In Claude Code, that is `AskUserQuestion`. One call holds up to four questions; a frontier of more than four takes several calls in a row. For each question:

- **Header**: a short chip label, 12 characters or fewer.
- **Options**: 2–4, mutually exclusive. Each description says what the option means and what it costs.
- **Recommended option first**, its label ending in `(Recommended)`. Its description gives the reason and names the evidence: a file and line, a doc, an issue.
- **No "Other" option.** The tool adds its own free-text escape.
- **Previews** only when the user must compare concrete artifacts side by side (code shapes, layouts, configs), and only on single-select questions.
- **multiSelect** only when the choices are genuinely not exclusive.

A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

**Without a structured tool** (Codex, Pi, or any harness that lacks one), fall back to the `grilling` skill's text format: number each question, follow it with `➡️` and the recommendation, and word it so "yes" accepts the recommendation.

## Between rounds

Each round's answers reshape the tree: settled decisions push the frontier outward and unblock questions that depended on them. An "Other" answer may open branches you hadn't mapped; research them before the next round. Recompute the frontier and ask again.

The _decisions_ are the user's. Never apply a recommendation before the user picks it.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
