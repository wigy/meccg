Handle a feature planning request by reading the feature description, creating an implementation plan, and sending it to the admin for review.

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
   If not found, stop and report. Extract the `body` (feature description), `from` (who forwarded it), `replyTo` (original feature request message ID), and `subject`.

3. **Mark as processing:** Update the message status to `processing`:
   ```
   curl -s -X PUT http://localhost:8080/api/system/mail/ai/<msg-id> -H "Authorization: Bearer $(jq -r .masterKey ~/.meccg/secrets.json)" -H "Content-Type: application/json" -d '{"status":"processing"}'
   ```

4. **Create an implementation plan:** Using the feature description from the message body, analyze the codebase and create a detailed implementation plan. The plan should include:
   - **Summary** of what the feature does and why it's needed
   - **Affected files** — which files need to be created or modified
   - **Implementation steps** — ordered list of concrete changes to make
   - **Testing considerations** — what rules tests or card tests would verify the feature
   - **Risks or open questions** — anything that needs clarification

   Use the Explore agent or read relevant source files to understand the current architecture and where the feature fits in.

5. **Send the plan to admin:** Send a mail to `admin` with the implementation plan:
   ```
   curl -s -X POST http://localhost:8080/api/system/mail -H "Authorization: Bearer $(jq -r .masterKey ~/.meccg/secrets.json)" -H "Content-Type: application/json" -d '<json>'
   ```

   JSON structure:
   ```json
   {
     "recipients": ["admin"],
     "sender": "ai",
     "from": "<displayName from ~/.meccg/players/ai/info.json>",
     "topic": "feature-planning-reply",
     "subject": "Implementation Plan: <original subject>",
     "body": "<markdown plan>",
     "keywords": {
       "originalMessageId": "<replyTo from the planning request, i.e. the original feature request ID>",
       "planningRequestId": "<msg-id of this planning request>",
       "requestedBy": "<from field of the planning request>"
     },
     "replyTo": "<msg-id>",
     "sentBy": "ai"
   }
   ```

   The body should be well-formatted markdown containing:
   - The original feature request text (quoted with `>`)
   - The full implementation plan

6. **Mark as processed:** Update the message status to `processed` with `success: true`:
   ```
   curl -s -X PUT http://localhost:8080/api/system/mail/ai/<msg-id> -H "Authorization: Bearer $(jq -r .masterKey ~/.meccg/secrets.json)" -H "Content-Type: application/json" -d '{"status":"processed","success":true}'
   ```

7. **Report:** Summarize what happened — which message was processed and that the plan was sent to admin.

If any step fails unexpectedly, mark the message as processed with `success: false` and report the error.
