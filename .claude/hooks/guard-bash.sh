#!/usr/bin/env bash
# PreToolUse hook for Bash. Exit 2 blocks the command and shows stderr to Claude.
#   - .env and .env.operator hold production secrets: no command may name them.
#     (.env.example is fine.) The Read deny rules in settings.json cover the file tools.
#   - Commands that discard uncommitted work (checkout of paths, restore other
#     than --staged, reset --hard, stash, clean) are refused while the working
#     tree has changes. A
#     `git checkout --` once emptied a new file whose index copy was blank.
#   - This repo has no formatter. Running prettier (prettier, npx/npm exec/pnpm dlx
#     prettier) is refused: an agent once ran `npx prettier` and had to undo four
#     reformatted files. A command that only mentions it (grep prettier) is fine.
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

# prettier as a command word: first, after ; & | ( or after npx, npm exec, pnpm, yarn or bunx.
if matches '(^\s*|[;&|(]\s*|\b(npx|bunx|npm\s+exec|pnpm(\s+(dlx|exec))?|yarn(\s+dlx)?)\s+(--?\S+\s+)*)(\S*/)?prettier(@\S*)?(\s|$)'; then
  echo "Blocked: this repo has no formatter. Match the surrounding code's formatting by hand." >&2
  exit 2
fi
