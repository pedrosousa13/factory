#!/usr/bin/env bash
# Factory's SessionStart wiring: every question to the user goes through
# the ask-structured skill. Dependent skills (grilling, triage, to-spec, tdd,
# ...) carry their own plain-text question formats; this keeps them from
# winning. PROTOCOL.md "## Asking the maintainer" is the contract.
cat <<'MSG'
Factory: whenever you are about to ask the user anything (a question, a clarification, a decision, an approval), first call the Skill tool with `factory:ask-structured` and ask in its shape: AskUserQuestion, researched recommendation first. This holds even when another skill tells you to ask in plain text; that skill decides what to ask, ask-structured decides how. The one exception is a mid-loop Ping in a Factory Loop Session, which ask-structured itself covers.
MSG
