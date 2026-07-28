# The factory loop runs as an interactive session, not a headless daemon

The Factory could run fully autonomously (a shell loop spawning headless `claude -p` sessions per issue, or scheduled cloud agents). We chose a long-lived *interactive* Loop Session instead, because the core requirement is "ping me in real time when the AI has a question" — and only an interactive session can block on a question with its working context still loaded. Headless runs can only park an issue as `needs-info` and move on, turning every question into a full shelve/resume cycle.

## Consequences

- Someone must start/resume the loop (`/factory`) after a handoff or reboot; the factory is idle when no terminal is open.
- The park mechanism (block ~15 min → post question to Linear → `needs-info` → continue) is the escape hatch that keeps an unanswered question from stalling the loop, and it is also exactly what a headless mode would need — so specific well-specified issues can graduate to headless execution later without changing the model.
