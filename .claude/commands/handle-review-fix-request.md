Address review comments on a pull request. Read the review feedback, fix the issues on the existing PR branch, push new commits, and emit a new review request. **Do not send any mail or update any message status** — `bin/handle-mail` is the sole sender; you only do the work and emit a structured result block on stdout.

**IMPORTANT:** This skill must run to completion autonomously. Do NOT stop to ask the user for confirmation at any step.

## Working-tree contract — read before doing anything

You MUST leave the repo working tree CLEAN when your turn ends. `git status --porcelain` must print nothing.

- **Success path:** every edit is committed on the existing PR branch and pushed. Tree clean.
- **Failure path:** if you cannot address the review — comments are ambiguous, fix requires architectural changes you can't make, tests won't pass, etc. — you MUST revert all edits before ending the turn: `git checkout -- .` and delete any new files/directories you created. Then emit the result block with `"success": false`.

If you end the turn with uncommitted changes, `bin/handle-mail` overrides your result block, reports the job as failed, and run-ai refuses to handle any further mail until a human cleans up. Do not leave leftovers — they block every subsequent AI request, not just yours.

## Result-block contract — also read

The `===HANDLE_MAIL_RESULT_BEGIN===`…`===HANDLE_MAIL_RESULT_END===` block (step 9 below) is MANDATORY on every run, success or failure. It is how `bin/handle-mail` decides what reply to send. If you skip it, the requester gets a generic "handler did not produce structured output" error instead of a meaningful reply. On the failure path, use `"success": false`, omit `review`, and put the explanation in `reply.body`.

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
   If not found, stop and emit a `success: false` result block. Extract the `body` (review comments and original review), `from` (who declined), `subject`, and `keywords` (especially `prUrl`, `reviewedBy`, `reviewRequestId`, and any `originalMessageId`, `gitHash`).

3. **Understand the review feedback:** Parse the message body which contains:
   - **Review Comments** — the reviewer's feedback on what needs to change
   - **Original Review** — the original review-request body with context about what was implemented

4. **Check out the PR branch:** Use the PR URL from keywords to find the branch:
   ```
   gh pr view <prUrl> --json headRefName -q '.headRefName'
   ```
   Then check out that branch and pull latest:
   ```
   git checkout <branch> && git pull
   ```

5. **Read the PR diff and comments:** Understand what was changed in the PR:
   ```
   gh pr diff <prUrl>
   ```
   Also check for any GitHub PR review comments:
   ```
   gh pr view <prUrl> --json reviews,comments
   ```

6. **Fix the issues:** Based on the review comments, make the necessary code changes:
   - Read the relevant source files
   - Address each review comment
   - Follow the project's coding conventions (see CLAUDE.md)
   - Ensure new code has proper JSDoc documentation where needed
   - Follow the server-side logging policy if modifying engine code

7. **Iterate until green:** Run all four checks **in parallel** and fix any failures. Repeat until all pass:
   - `npm run build` — type-check (must pass)
   - `npm test` — rules tests (must all pass)
   - `npm run test:nightly` — card tests (must not introduce new failures)
   - `npm run lint` — linting (fix with `npm run lint:fix`)

   If a check fails, read the error output, fix the issue, and re-run. Keep iterating until all four pass cleanly.

8. **Commit and push:** Create a new commit on the existing branch — never amend or rebase:
   ```
   git add <changed-files>
   git commit -m "Address review comments: <brief description>

   Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
   git push
   ```
   Capture the new commit hash from the output.

9. **Emit the structured result block:** As the **last** thing you output, print exactly one block in the form below. `bin/handle-mail` will parse the JSON between the markers and use it to send a reply and a new review request to admins. Do not call `/api/system/mail` or `/api/system/mail/.../<msg-id>` anywhere in this skill.

   ```
   ===HANDLE_MAIL_RESULT_BEGIN===
   {
     "success": true,
     "summary": "<one-line summary of the fixes>",
     "reply": {
       "topic": "feature-reply",
       "subject": "Review fixes applied: <short description>",
       "body": "<markdown body — summary of what was fixed in response to review>",
       "keywords": {
         "originalMessageId": "<originalMessageId from keywords if present>",
         "reviewRequestId": "<reviewRequestId from keywords>",
         "gitHash": "<new commit hash>",
         "prUrl": "<PR URL from keywords>"
       }
     },
     "review": {
       "topic": "review-request",
       "recipients": ["wigy", "karmi", "admin"],
       "subject": "Re-review: <short description>",
       "body": "<markdown body — what was changed since last review, what review comments were addressed, PR link>",
       "keywords": {
         "originalMessageId": "<originalMessageId from keywords if present>",
         "reviewRequestId": "<reviewRequestId from keywords>",
         "gitHash": "<new commit hash>",
         "prUrl": "<PR URL>"
       }
     }
   }
   ===HANDLE_MAIL_RESULT_END===
   ```

   - If you cannot fix the issues (e.g., the review comments are unclear or require architectural changes you cannot make), set `"success": false`, omit the `review` field, and put the explanation in `reply.body`.
   - The `body` fields are JSON strings — escape newlines as `\n` and quotes as `\"`.
   - Do **not** print anything after `===HANDLE_MAIL_RESULT_END===`.

10. **Report:** Briefly summarize what happened (one or two lines) **before** the result block, so the run log is readable. The result block must still be the final output.
