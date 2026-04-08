Handle a feature planning request by reading the feature description and producing an implementation plan. **Do not send any mail or update any message status** — `bin/handle-mail` is the sole sender; you only do the work and emit a structured result block on stdout.

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
   If not found, stop and emit a `success: false` result block. Extract the `body` (feature description), `from` (who forwarded it), `replyTo` (original feature request message ID), and `subject`.

3. **Create an implementation plan:** Using the feature description from the message body, analyze the codebase and create a detailed implementation plan. The plan should include:
   - **Summary** of what the feature does and why it's needed
   - **Affected files** — which files need to be created or modified
   - **Implementation steps** — ordered list of concrete changes to make
   - **Testing considerations** — what rules tests or card tests would verify the feature
   - **Risks or open questions** — anything that needs clarification

   Use the Explore agent or read relevant source files to understand the current architecture and where the feature fits in.

4. **Emit the structured result block:** As the **last** thing you output, print exactly one block in the form below. `bin/handle-mail` will parse the JSON between the markers and use it to send the reply mail (with credits/time footer). Do not call `/api/system/mail` or `/api/system/mail/.../<msg-id>` anywhere in this skill.

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
         "requestedBy": "<from field of the planning request>"
       }
     }
   }
   ===HANDLE_MAIL_RESULT_END===
   ```

   - Set `"success": false` if you could not produce a usable plan, and put the explanation in `reply.body`.
   - The `reply.body` field is a JSON string — escape newlines as `\n` and quotes as `\"`.
   - Do **not** print anything after `===HANDLE_MAIL_RESULT_END===`.

5. **Report:** Briefly summarize what happened (one or two lines) **before** the result block, so the run log is readable. The result block must still be the final output.
