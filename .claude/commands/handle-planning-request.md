Handle a feature planning request by reading the feature description and producing an implementation plan. **Do not send any mail or update any message status** — `bin/handle-mail` is the sole sender; you only do the work and emit a structured result block on stdout.

**IMPORTANT:** This skill must run to completion autonomously. Do NOT stop to ask the user for confirmation at any step.

## Working-tree contract — read before doing anything

This skill only reads the codebase to produce a plan — it should not edit any source files. `git status --porcelain` must print nothing when your turn ends.

If you edited a file by mistake, or created scratch files during the analysis, revert/delete them before ending the turn (`git checkout -- .` for modifications; `rm` for new files).

If you end the turn with uncommitted changes, `bin/handle-mail` overrides your result block, reports the job as failed, and run-ai refuses to handle any further mail until a human cleans up. Do not leave leftovers — they block every subsequent AI request, not just yours.

## Result-block contract — also read

The `===HANDLE_MAIL_RESULT_BEGIN===`…`===HANDLE_MAIL_RESULT_END===` block (step 5 below) is MANDATORY on every run, success or failure. It is how `bin/handle-mail` decides what reply to send. If you skip it, the requester gets a generic "handler did not produce structured output" error instead of a meaningful reply. On the failure path, use `"success": false` and put the explanation in `reply.body`.

The message ID argument is: $ARGUMENTS

Follow these steps:

1. **Log in as ai (read-only):** First resolve the lobby URL and master key from the environment, so this works both for local co-located runs and for remote workers talking to a hosted lobby:
   ```
   BASE_URL="${MECCG_LOBBY_URL:-http://localhost:8080}"; BASE_URL="${BASE_URL%/}"
   MASTER_KEY="${MECCG_MASTER_KEY:-$(jq -r .masterKey ~/.meccg/secrets.json)}"
   ```
   Then get a session cookie for the ai account:
   ```
   SESSION=$(curl -s -c - -X POST "$BASE_URL/api/login" -H 'Content-Type: application/json' -d "{\"name\":\"ai\",\"password\":\"$MASTER_KEY\"}" | grep meccg-session | awk '{print $NF}')
   ```

2. **Fetch the message:** Read the full message from the ai inbox:
   ```
   curl -s "$BASE_URL/api/mail/inbox/<msg-id>" -b "meccg-session=$SESSION"
   ```
   If not found, stop and emit a `success: false` result block. Extract the `body` (feature description), `from` (who forwarded it — typically `admin`), `replyTo` (original feature request message ID), and `subject`.

3. **Track down the original requestor:** Planning requests are forwarded by `admin` from a feature-request that originally lives in admin's inbox. The `replyTo` field is the ID of that original feature-request. Read it directly from the filesystem (the ai user has no API access to admin's inbox):
   ```
   jq -r '.from' ~/.meccg/players/admin/mail/inbox/<replyTo>.json
   ```
   This gives you the username of the person who actually filed the feature request — that user is the one who must be billed for the planning work. Save it as `originalRequestor`. If the file does not exist or has no `from` field, fall back to the forwarder (`from` of the planning request) and note it in the report.

4. **Create an implementation plan:** Using the feature description from the message body, analyze the codebase and create a detailed implementation plan. The plan should include:
   - **Summary** of what the feature does and why it's needed
   - **Affected files** — which files need to be created or modified
   - **Implementation steps** — ordered list of concrete changes to make
   - **Testing considerations** — what rules tests or card tests would verify the feature
   - **Risks or open questions** — anything that needs clarification

   Use the Explore agent or read relevant source files to understand the current architecture and where the feature fits in.

5. **Emit the structured result block:** As the **last** thing you output, print exactly one block in the form below. `bin/handle-mail` will parse the JSON between the markers and use it to send the reply mail (with credits/time footer). Do not call `/api/system/mail` or `/api/system/mail/.../<msg-id>` anywhere in this skill.

   ```
   ===HANDLE_MAIL_RESULT_BEGIN===
   {
     "success": true,
     "summary": "<one-line summary of what was planned>",
     "reply": {
       "recipient": "admin",
       "topic": "feature-planning-reply",
       "subject": "Implementation Plan: <original subject>",
       "body": "<full markdown body — quoted original feature request followed by the implementation plan>",
       "keywords": {
         "originalMessageId": "<replyTo from the planning request, i.e. the original feature request ID>",
         "planningRequestId": "<msg-id of this planning request>",
         "requestedBy": "<from field of the planning request — usually admin>",
         "originalRequestor": "<username of the original feature-request author, looked up in step 3 — bin/handle-mail bills this user for the planning work>"
       }
     }
   }
   ===HANDLE_MAIL_RESULT_END===
   ```

   - Set `"success": false` if you could not produce a usable plan, and put the explanation in `reply.body`.
   - The `reply.body` field is a JSON string — escape newlines as `\n` and quotes as `\"`.
   - Do **not** print anything after `===HANDLE_MAIL_RESULT_END===`.

6. **Report:** Briefly summarize what happened (one or two lines) **before** the result block, so the run log is readable. Mention who the original requestor is so the billing target is visible in the log. The result block must still be the final output.
