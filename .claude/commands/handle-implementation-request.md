Implement a feature based on an implementation plan received via mail. Read the plan, implement all changes, iterate until build/tests/lint pass, commit, push, and send a review request.

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
   If not found, stop and report. Extract the `body` (implementation plan), `from` (who requested it), `replyTo` (planning reply message ID), `subject`, and `keywords` (especially `originalMessageId` and `planningReplyId`).

3. **Mark as processing:** Update the message status to `processing`:
   ```
   curl -s -X PUT http://localhost:8080/api/system/mail/ai/<msg-id> -H "Authorization: Bearer $(jq -r .masterKey ~/.meccg/secrets.json)" -H "Content-Type: application/json" -d '{"status":"processing"}'
   ```

4. **Check out master:** Always start implementation from the master branch to avoid building on stale or unrelated branches:
   ```
   git checkout master && git pull
   ```

5. **Implement the feature:** The message body contains a full implementation plan (created by `/handle-planning-request`). Read and understand the plan, then implement all changes described in it:
   - Read the relevant source files mentioned in the plan
   - Make all code changes described in the implementation steps
   - Follow the project's coding conventions (see CLAUDE.md)
   - Ensure all new code has proper JSDoc documentation
   - Follow the server-side logging policy if adding engine code

6. **Iterate until green:** Run all four checks **in parallel** and fix any failures. Repeat until all pass:
   - `npm run build` — type-check (must pass)
   - `npm test` — rules tests (must all pass)
   - `npm run test:nightly` — card tests (must not introduce new failures)
   - `npm run lint` — linting (fix with `npm run lint:fix`)

   If a check fails, read the error output, fix the issue, and re-run. Keep iterating until all four pass cleanly.

7. **Commit and push:** Create a single commit with all changes and push to the remote:
   ```
   git add <changed-files>
   git commit -m "<descriptive message>

   Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
   git push
   ```
   Capture the commit hash from the output. The commit message should summarize what feature was implemented.

8. **Send review request to reviewers:** Send a mail to all reviewers (`["wigy", "karmi", "admin"]`) with a review request:
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
     "subject": "Review: <short feature description>",
     "body": "<markdown body>",
     "keywords": {
       "originalMessageId": "<originalMessageId from the implementation request keywords>",
       "implementationRequestId": "<msg-id of this implementation request>",
       "planningReplyId": "<planningReplyId from keywords>",
       "gitHash": "<commit hash>",
       "requestedBy": "<from field of the implementation request>"
     },
     "replyTo": "<msg-id>",
     "sentBy": "ai"
   }
   ```

   The body should contain:
   - A summary of what was implemented
   - A link to the GitHub commit: `https://github.com/wigy/meccg/commit/<gitHash>`
   - The list of files changed
   - The original implementation plan (quoted with `>` or in a details block)

   After sending, mark each reviewer's copy of the review message as `waiting`:
   ```
   curl -s -X PUT http://localhost:8080/api/system/mail/<reviewer>/<review-msg-id> -H "Authorization: Bearer $(jq -r .masterKey ~/.meccg/secrets.json)" -H "Content-Type: application/json" -d '{"status":"waiting"}'
   ```
   Do this for each reviewer: `wigy`, `karmi`, `admin`.

9. **Mark as processed:** Update the message status to `processed` with `success: true`:
   ```
   curl -s -X PUT http://localhost:8080/api/system/mail/ai/<msg-id> -H "Authorization: Bearer $(jq -r .masterKey ~/.meccg/secrets.json)" -H "Content-Type: application/json" -d '{"status":"processed","success":true}'
   ```

10. **Report:** Summarize what happened — which feature was implemented, the commit hash, and that the review request was sent.

If any step fails unexpectedly (implementation too complex, tests can't be fixed after multiple attempts, etc.), mark the message as processed with `success: false` and send a reply mail to the requester explaining what went wrong:
```json
{
  "recipients": ["<from>"],
  "sender": "ai",
  "from": "<displayName from ~/.meccg/players/ai/info.json>",
  "topic": "feature-reply",
  "subject": "Implementation Failed: <original subject>",
  "body": "<explanation of what went wrong>",
  "keywords": { "originalMessageId": "<msg-id>" },
  "replyTo": "<msg-id>",
  "sentBy": "ai"
}
```
