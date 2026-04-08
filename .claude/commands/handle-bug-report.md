Investigate and fix a bug based on a bug report received via mail. Read the report, find the game log, diagnose the issue, implement a fix, iterate until build/tests/lint pass, commit, and push. **Do not send any mail or update any message status** — `bin/handle-mail` is the sole sender; you only do the work and emit a structured result block on stdout.

**IMPORTANT:** This skill must run to completion autonomously. Do NOT stop to ask the user for confirmation at any step.

The message ID argument is: $ARGUMENTS

Follow these steps:

1. **Log in as ai (read-only):** Get a session cookie for the ai account so you can fetch the message:
   ```
   SESSION=$(curl -s -c - -X POST http://localhost:8080/api/login -H 'Content-Type: application/json' -d "{\"name\":\"ai\",\"password\":\"$(jq -r .masterKey ~/.meccg/secrets.json)\"}" | grep meccg-session | awk '{print $NF}')
   ```

2. **Fetch the message:** Read the full message from the ai inbox:
   ```
   curl -s http://localhost:8080/api/mail/inbox/<msg-id> -b "meccg-session=$SESSION"
   ```
   If not found, stop and emit a `success: false` result block. Extract the `body` (bug description), `from` (who reported it), `subject`, and `keywords`.

3. **Extract bug details:** Read the message body carefully. Look for:
   - **Game ID** — needed to find the game log
   - **Sequence number** — the state sequence where the problem occurred
   - **Description** of what went wrong (expected vs actual behavior)
   Note these details for the investigation.

4. **Investigate the bug:** Use the investigation process from `/investigate`:

   a. **Load card data:** Read `~/.meccg/logs/games/<gameId>-cards.json` to get instance-to-definition mappings and card definitions used in the game.

   b. **Verify card definitions:** Compare the definitions of cards relevant to the reported problem against the current card data in `packages/shared/src/data/`. If the game was played with stale definitions (e.g. missing DSL effects), the root cause may be data staleness.

   c. **Load the game log:** Read `~/.meccg/logs/games/<gameId>.jsonl`. Each line is a state snapshot:
      ```
      { "ts", "event": "state", "stateSeq": N, "reason": "action-type", "action": <full action>, "turn", "phase", "step", "activePlayer", "state": <GameState> }
      ```

   d. **Find the problem state:** Locate the state entry at or near the reported sequence number. Examine the state to confirm the reported problem.

   e. **Trace backwards:** Walk backwards through stateSeq values to find the transition where the bug was introduced. Compare consecutive states to identify what changed.

   f. **Resolve card identities:** Use the cards file to translate instance IDs (e.g. `"i-42"`) to card names. Always report card names, not raw IDs.

   g. **Identify root cause:** Based on the state transitions, determine which reducer handler or phase handler has the bug. Cross-reference with:
      - Phase handlers in `packages/shared/src/engine/legal-actions/`
      - Reducer in `packages/shared/src/engine/reducer.ts`
      - Any relevant DSL effect handlers

5. **Validate the bug against the log:** Before proceeding to a fix, confirm that the game log evidence actually supports the reported bug:
   - The problem described in the report must be visible in the game log state transitions
   - If the log does not show the reported issue (e.g. the states look correct, the reported sequence number doesn't exist, or the behavior in the log matches expected rules), **do NOT proceed with a code fix**
   - Instead, emit a `success: false` result block with `reply.body` explaining that the game log was analyzed but does not corroborate the reported issue, including what was actually observed in the log
   - This prevents making speculative code changes based on misunderstandings or reports that don't match reality

6. **Fix the bug:** Implement the fix in the source code:
   - Read the relevant source files
   - Make the minimal code changes needed to fix the bug
   - Follow the project's coding conventions (see CLAUDE.md)
   - Ensure new code has proper JSDoc documentation where needed
   - Follow the server-side logging policy if modifying engine code

7. **Iterate until green:** Run all four checks **in parallel** and fix any failures. Repeat until all pass:
   - `npm run build` — type-check (must pass)
   - `npm test` — rules tests (must all pass)
   - `npm run test:nightly` — card tests (must not introduce new failures)
   - `npm run lint` — linting (fix with `npm run lint:fix`)

   If a check fails, read the error output, fix the issue, and re-run. Keep iterating until all four pass cleanly.

8. **Commit and push:** Create a single commit with all changes and push to the remote:
   ```
   git add <changed-files>
   git commit -m "<descriptive message>

   Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
   git push
   ```
   Capture the commit hash from the output. The commit message should summarize the bug fix.

9. **Emit the structured result block:** As the **last** thing you output, print exactly one block in the form below. `bin/handle-mail` will parse the JSON between the markers and use it to send the bug-reply mail (with credits/time footer) and the review request to admins. Do not call `/api/system/mail` or `/api/system/mail/.../<msg-id>` anywhere in this skill.

   ```
   ===HANDLE_MAIL_RESULT_BEGIN===
   {
     "success": true,
     "summary": "<one-line summary of the fix>",
     "reply": {
       "topic": "bug-reply",
       "subject": "Fixed: <original subject>",
       "body": "<markdown body — thanks for the report, summary of the fix, link to https://github.com/wigy/meccg/commit/<gitHash>>",
       "keywords": {
         "originalMessageId": "<msg-id>",
         "gitHash": "<commit hash>",
         "gameId": "<game ID>"
       }
     },
     "review": {
       "topic": "review-request",
       "recipients": ["wigy", "karmi", "admin"],
       "subject": "Review: <short bug fix description>",
       "body": "<markdown body — bug summary, root cause, fix summary, files changed, commit link>",
       "keywords": {
         "originalMessageId": "<msg-id of the bug report>",
         "bugReportId": "<msg-id>",
         "gitHash": "<commit hash>",
         "reportedBy": "<from field of the bug report>",
         "gameId": "<game ID>"
       }
     }
   }
   ===HANDLE_MAIL_RESULT_END===
   ```

   - If the bug cannot be reproduced from the log or you cannot fix it, set `"success": false`, omit the `review` field, and put the explanation in `reply.body` (with subject `"Unable to fix: <original subject>"`).
   - The `body` fields are JSON strings — escape newlines as `\n` and quotes as `\"`.
   - Do **not** print anything after `===HANDLE_MAIL_RESULT_END===`.

10. **Report:** Briefly summarize what happened (one or two lines) **before** the result block, so the run log is readable. The result block must still be the final output.
