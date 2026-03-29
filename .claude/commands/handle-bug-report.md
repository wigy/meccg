Investigate and fix a bug based on a bug report received via mail. Read the report, find the game log, diagnose the issue, implement a fix, iterate until build/tests/lint pass, commit, push, send review requests, and reply to the reporter.

**IMPORTANT:** This skill must run to completion autonomously. Do NOT stop to ask the user for confirmation at any step.

**Mail API RULE:** Every call to `/api/system/mail` MUST pass `"recipients"` as a JSON **array** (e.g. `["admin"]`). A bare string will be split into single-character usernames. This is a hard requirement.

The message ID argument is: $ARGUMENTS

Follow these steps:

1. **Log in as ai:** Get a session cookie for the ai account:
   ```
   SESSION=$(curl -s -c - -X POST http://localhost:8080/api/login -H 'Content-Type: application/json' -d "{\"name\":\"ai\",\"password\":\"$(jq -r .masterKey ~/.meccg/secrets.json)\"}" | grep meccg-session | awk '{print $NF}')
   ```

2. **Fetch the message:** Read the full message from the ai inbox:
   ```
   curl -s http://localhost:8080/api/mail/inbox/<msg-id> -b "meccg-session=$SESSION"
   ```
   If not found, stop and report. Extract the `body` (bug description), `from` (who reported it), `subject`, and `keywords`.

3. **Mark as processing:** Update the message status to `processing`:
   ```
   curl -s -X PUT http://localhost:8080/api/system/mail/ai/<msg-id> -H "Authorization: Bearer $(jq -r .masterKey ~/.meccg/secrets.json)" -H "Content-Type: application/json" -d '{"status":"processing"}'
   ```

4. **Extract bug details:** Read the message body carefully. Look for:
   - **Game ID** — needed to find the game log
   - **Sequence number** — the state sequence where the problem occurred
   - **Description** of what went wrong (expected vs actual behavior)
   Note these details for the investigation.

5. **Investigate the bug:** Use the investigation process from `/investigate`:

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

6. **Validate the bug against the log:** Before proceeding to a fix, confirm that the game log evidence actually supports the reported bug:
   - The problem described in the report must be visible in the game log state transitions
   - If the log does not show the reported issue (e.g. the states look correct, the reported sequence number doesn't exist, or the behavior in the log matches expected rules), **do NOT proceed with a code fix**
   - Instead, mark the message as processed with `success: false` and send a `bug-reply` to the reporter explaining that the game log was analyzed but does not corroborate the reported issue, including what was actually observed in the log
   - This prevents making speculative code changes based on misunderstandings or reports that don't match reality

7. **Fix the bug:** Implement the fix in the source code:
   - Read the relevant source files
   - Make the minimal code changes needed to fix the bug
   - Follow the project's coding conventions (see CLAUDE.md)
   - Ensure new code has proper JSDoc documentation where needed
   - Follow the server-side logging policy if modifying engine code

8. **Iterate until green:** Run all four checks **in parallel** and fix any failures. Repeat until all pass:
   - `npm run build` — type-check (must pass)
   - `npm test` — rules tests (must all pass)
   - `npm run test:nightly` — card tests (must not introduce new failures)
   - `npm run lint` — linting (fix with `npm run lint:fix`)

   If a check fails, read the error output, fix the issue, and re-run. Keep iterating until all four pass cleanly.

9. **Commit and push:** Create a single commit with all changes and push to the remote:
   ```
   git add <changed-files>
   git commit -m "<descriptive message>

   Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
   git push
   ```
   Capture the commit hash from the output. The commit message should summarize the bug fix.

10. **Send review request to reviewers:** Send a mail to all reviewers (`["wigy", "karmi", "admin"]`) with a review request:
   ```
   curl -s -X POST http://localhost:8080/api/system/mail -H "Authorization: Bearer $(jq -r .masterKey ~/.meccg/secrets.json)" -H "Content-Type: application/json" -d '<json>'
   ```

   JSON structure:
   ```json
   {
     "recipients": ["wigy", "karmi", "admin"],
     "sender": "ai",
     "from": "<displayName from ~/.meccg/players/ai/info.json>",
     "topic": "review-request",
     "subject": "Review: <short bug fix description>",
     "body": "<markdown body>",
     "keywords": {
       "originalMessageId": "<msg-id of the bug report>",
       "bugReportId": "<msg-id>",
       "gitHash": "<commit hash>",
       "reportedBy": "<from field of the bug report>",
       "gameId": "<game ID from the bug report>"
     },
     "replyTo": "<msg-id>",
     "sentBy": "ai"
   }
   ```

   The body should contain:
   - A summary of the bug and the fix
   - A link to the GitHub commit: `https://github.com/wigy/meccg/commit/<gitHash>`
   - The list of files changed
   - Root cause analysis (brief)

   After sending, mark each reviewer's copy of the review message as `waiting`:
   ```
   curl -s -X PUT http://localhost:8080/api/system/mail/<reviewer>/<review-msg-id> -H "Authorization: Bearer $(jq -r .masterKey ~/.meccg/secrets.json)" -H "Content-Type: application/json" -d '{"status":"waiting"}'
   ```
   Do this for each reviewer: `wigy`, `karmi`, `admin`.

11. **Send bug reply to reporter:** Send a `bug-reply` mail to the original reporter:
    ```json
    {
      "recipients": ["<from>"],
      "sender": "ai",
      "from": "<displayName from ~/.meccg/players/ai/info.json>",
      "topic": "bug-reply",
      "subject": "Fixed: <original subject>",
      "body": "<markdown body>",
      "keywords": {
        "originalMessageId": "<msg-id>",
        "gitHash": "<commit hash>",
        "gameId": "<game ID>"
      },
      "replyTo": "<msg-id>",
      "sentBy": "ai"
    }
    ```

    The body should contain:
    - An introduction thanking the reporter for the bug report
    - A summary of the changes made (same as in the review request)
    - A link to the GitHub commit

12. **Mark as processed:** Update the message status to `processed` with `success: true`:
    ```
    curl -s -X PUT http://localhost:8080/api/system/mail/ai/<msg-id> -H "Authorization: Bearer $(jq -r .masterKey ~/.meccg/secrets.json)" -H "Content-Type: application/json" -d '{"status":"processed","success":true}'
    ```

13. **Report:** Summarize what happened — what bug was fixed, the root cause, the commit hash, and that the review request and bug reply were sent.

If any step fails unexpectedly (bug too complex, tests can't be fixed after multiple attempts, etc.), mark the message as processed with `success: false` and send a `bug-reply` mail to the reporter explaining what went wrong:
```json
{
  "recipients": ["<from>"],
  "sender": "ai",
  "from": "<displayName from ~/.meccg/players/ai/info.json>",
  "topic": "bug-reply",
  "subject": "Unable to fix: <original subject>",
  "body": "<explanation of what was found and why it couldn't be fixed automatically>",
  "keywords": { "originalMessageId": "<msg-id>" },
  "replyTo": "<msg-id>",
  "sentBy": "ai"
}
```
