#!/usr/bin/env bash
# Factory's Notification-hook wiring: relay the notification to the
# Project's own notifier, if the Project configured one. Silent no-op
# otherwise — Factory ships the wiring, never the push mechanism.
set -euo pipefail
command -v jq >/dev/null 2>&1 || exit 0
input=$(cat)
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
[ -n "$cwd" ] && [ -f "$cwd/.factory/config.json" ] || exit 0
notifier=$(jq -r '.notifierCommand // empty' "$cwd/.factory/config.json")
[ -n "$notifier" ] || exit 0
message=$(printf '%s' "$input" | jq -r '.message // "Factory needs attention"')
FACTORY_NOTIFY_MESSAGE="$message" sh -c "$notifier" || exit 0
