#!/usr/bin/env bash
# PreToolUse hook for Bash. Exit 2 blocks the command and shows stderr to Claude.
#   - .env and .env.operator hold production secrets: no command may name them.
#     (.env.example is fine.) The Read deny rules in settings.json cover the file tools.
#   - Commands that discard uncommitted work (checkout of paths, restore other
#     than --staged, reset --hard, stash, clean) are refused while the working
#     tree has changes. A
#     `git checkout --` once emptied a new file whose index copy was blank.
set -euo pipefail

input=$(cat)
matches() { jq -e --arg re "$1" '(.tool_input.command // "") | test($re)' <<<"$input" >/dev/null; }

if matches '(^|[^\w.-])\.env(\.operator)?(?![\w.-])'; then
  echo "Blocked: .env and .env.operator hold secrets and stay unread. Use .env.example for variable names, or ask the user." >&2
  exit 2
fi

discard='\bgit\s+(-C\s+\S+\s+)?(restore\b(?![^;&|]*--staged)|clean\b|stash(?!\s+(list|show)\b)|reset\b[^;&|]*--hard|checkout\b[^;&|]*(\s--(\s|$)|\s\.(\s|$)|\s(-f|--force)\b))'
if matches "$discard"; then
  cwd=$(jq -r '.cwd // "."' <<<"$input")
  if [[ -n "$(git -C "$cwd" status --porcelain 2>/dev/null)" ]]; then
    echo "Blocked: this git command can discard uncommitted work, and the working tree has changes (git status). Ask the user before discarding anything." >&2
    exit 2
  fi
fi
