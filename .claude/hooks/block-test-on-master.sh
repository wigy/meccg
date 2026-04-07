#!/usr/bin/env bash
# Block git commits that include test file changes on master branch.
# Used as a PreToolUse hook for Bash commands.
INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
echo "$CMD" | grep -qE '^git commit' || exit 0
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
[ "$BRANCH" = "master" ] || exit 0
STAGED_TESTS=$(git diff --cached --name-only -- 'packages/shared/src/tests/' 2>/dev/null | grep -E '\.test\.ts$')
[ -z "$STAGED_TESTS" ] && exit 0
echo '{"decision":"block","reason":"Test changes must go through a PR — create a branch first."}'
