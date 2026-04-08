Implement a feature based on an implementation plan received via mail. Read the plan, implement all changes, iterate until build/tests/lint pass, commit, and push. **Do not send any mail or update any message status** — `bin/handle-mail` is the sole sender; you only do the work and emit a structured result block on stdout.

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
   If not found, stop and emit a `success: false` result block. Extract the `body` (implementation plan), `from` (who requested it), `replyTo` (planning reply message ID), `subject`, and `keywords` (especially `originalMessageId` and `planningReplyId`).

3. **Check out master:** Always start implementation from the master branch to avoid building on stale or unrelated branches:
   ```
   git checkout master && git pull
   ```

4. **Implement the feature:** The message body contains a full implementation plan (created by `/handle-planning-request`). Read and understand the plan, then implement all changes described in it:
   - Read the relevant source files mentioned in the plan
   - Make all code changes described in the implementation steps
   - Follow the project's coding conventions (see CLAUDE.md)
   - Ensure all new code has proper JSDoc documentation
   - Follow the server-side logging policy if adding engine code

5. **Iterate until green:** Run all four checks **in parallel** and fix any failures. Repeat until all pass:
   - `npm run build` — type-check (must pass)
   - `npm test` — rules tests (must all pass)
   - `npm run test:nightly` — card tests (must not introduce new failures)
   - `npm run lint` — linting (fix with `npm run lint:fix`)

   If a check fails, read the error output, fix the issue, and re-run. Keep iterating until all four pass cleanly.

6. **Commit and push:** Create a single commit with all changes and push to the remote:
   ```
   git add <changed-files>
   git commit -m "<descriptive message>

   Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
   git push
   ```
   Capture the commit hash from the output. The commit message should summarize what feature was implemented.

7. **Emit the structured result block:** As the **last** thing you output, print exactly one block in the form below. `bin/handle-mail` will parse the JSON between the markers and use it to send the reply mail (with credits/time footer) and the review request to admins. Do not call `/api/system/mail` or `/api/system/mail/.../<msg-id>` anywhere in this skill.

   ```
   ===HANDLE_MAIL_RESULT_BEGIN===
   {
     "success": true,
     "summary": "<one-line summary of what was implemented>",
     "reply": {
       "topic": "feature-reply",
       "subject": "Implemented: <short feature description>",
       "body": "<markdown body — summary of changes, list of files changed, link to https://github.com/wigy/meccg/commit/<gitHash>>",
       "keywords": {
         "originalMessageId": "<originalMessageId from the implementation request keywords>",
         "implementationRequestId": "<msg-id of this implementation request>",
         "gitHash": "<commit hash>"
       }
     },
     "review": {
       "topic": "review-request",
       "recipients": ["wigy", "karmi", "admin"],
       "subject": "Review: <short feature description>",
       "body": "<markdown body — summary, files changed, commit link, original plan in a quote/details block>",
       "keywords": {
         "originalMessageId": "<originalMessageId from keywords>",
         "implementationRequestId": "<msg-id>",
         "planningReplyId": "<planningReplyId from keywords>",
         "gitHash": "<commit hash>",
         "requestedBy": "<from field of the request>"
       }
     }
   }
   ===HANDLE_MAIL_RESULT_END===
   ```

   - If you cannot complete the implementation (tests can't be made to pass after multiple attempts, plan is too complex, etc.) set `"success": false`, omit the `review` field, and put the failure explanation in `reply.body`.
   - The `body` fields are JSON strings — escape newlines as `\n` and quotes as `\"`.
   - Do **not** print anything after `===HANDLE_MAIL_RESULT_END===`.

8. **Report:** Briefly summarize what happened (one or two lines) **before** the result block, so the run log is readable. The result block must still be the final output.
