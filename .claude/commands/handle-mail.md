Handle a mail message from the ai inbox by dispatching it to the appropriate skill based on its topic and keywords.

**IMPORTANT:** This skill must run to completion autonomously. Do NOT stop to ask the user for confirmation at any step. Complete ALL steps (dispatch, reply mail, review requests, status updates) without pausing.

**⚠️ MAIL API RULE:** Every call to `/api/system/mail` MUST pass `"recipients"` as a JSON **array** (e.g. `["wigy"]` or `["wigy", "karmi", "admin"]`). A bare string will be split into single-character usernames. This is a hard requirement — never use a string.

**⚠️ CARD IMAGE RULE:** To include a card image in mail, read the card definition's `image` field from the data JSON file and derive the proxy path. The `image` field is a GitHub URL like `https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/GlorfindelII.jpg` — extract the set (`tw`) and filename (`GlorfindelII.jpg`) and use `/cards/images/tw/GlorfindelII.jpg` as the image URL. The set is **lowercase** and the filename is **case-sensitive**. Never guess the filename — always read it from the card data.

The message ID argument is: $ARGUMENTS

If no message ID is given, list all messages in the ai inbox by running:
```
curl -s http://localhost:8080/api/mail/inbox -b "meccg-session=$(curl -s -X POST http://localhost:8080/api/login -H 'Content-Type: application/json' -d "{\"name\":\"ai\",\"password\":\"$(jq -r .masterKey ~/.meccg/secrets.json)\"}" -c - | grep meccg-session | awk '{print $NF}')"
```
Then stop and show the list so the user can pick one.

Follow these steps:

1. **Log in as ai:** Get a session cookie for the ai account:
   ```
   SESSION=$(curl -s -c - -X POST http://localhost:8080/api/login -H 'Content-Type: application/json' -d "{\"name\":\"ai\",\"password\":\"$(jq -r .masterKey ~/.meccg/secrets.json)\"}" | grep meccg-session | awk '{print $NF}')
   ```

2. **Fetch the message:** Read the full message from the ai inbox:
   ```
   curl -s http://localhost:8080/api/mail/inbox/<msg-id> -b "meccg-session=$SESSION"
   ```
   If not found, stop and report.

3. **Mark as processing:** Update the message status to `processing`:
   ```
   curl -s -X PUT http://localhost:8080/api/system/mail/ai/<msg-id> -H "Authorization: Bearer $(jq -r .masterKey ~/.meccg/secrets.json)" -H "Content-Type: application/json" -d '{"status":"processing"}'
   ```

4. **Dispatch based on topic:** Look at the message `topic` and `keywords` fields to determine what action to take:

   - **`card-request`**: The keywords should contain `cardName`, `deckId`, and `userName`. Use the **Agent tool** (not the Skill tool) to run the `/handle-card-request` skill with `<cardName> <deckId>` as arguments — read `.claude/commands/handle-card-request.md`, substitute `$ARGUMENTS` with `<cardName> <deckId>`, and pass the full content as the agent prompt. After it completes:
     - If the card was successfully added: mark success, send a reply mail to the requesting user. Include the card image using markdown image syntax `![Card Name](image-url)` (the image URL is in the card definition's `image` field, proxied through `/cards/images/<set>/<filename>`), followed by the full card definition JSON in a fenced code block. Add the `gitHash` from the card request report to the reply mail keywords.
     - Then send a **review request** to all admins (`["wigy", "karmi", "admin"]`) with status `waiting`:
       - `topic`: `"review-request"`
       - `subject`: `"Review: <card name> added"`
       - `body`: summary of the change with the card image `![Card Name](image-url)`, a link to the GitHub commit: `https://github.com/wigy/meccg/commit/<gitHash>`, plus the full card JSON in a code block
       - `keywords`: include `cardName`, `cardId`, `gitHash`, `userName` (original requester)
       - `replyTo`: the original message ID
       - Mark the review message status as `waiting` after sending:
         ```
         curl -s -X PUT http://localhost:8080/api/system/mail/<admin>/<review-msg-id> -H "Authorization: Bearer ..." -H "Content-Type: application/json" -d '{"status":"waiting"}'
         ```
         Do this for each admin recipient.
     - If it failed: mark failure, send a failure reply mail to the requesting user.

   - **`certification-request`**: The keywords should contain `cardId`. Use the **Agent tool** (not the Skill tool) to run the `/handle-certify-card` skill — read `.claude/commands/handle-certify-card.md`, substitute `$ARGUMENTS` with the `cardId` value, and pass the full content as the agent prompt. ⚠️ **The agent MUST create a branch and open a PR** (step 14 in handle-certify-card.md) — never commit directly to master. Include this instruction explicitly in the agent prompt: "You MUST create a branch named `certify-<cardId>-<card-slug>`, commit there, push, and open a PR. Do NOT commit to master." After it completes:
     - If certification passed: mark success, send reply mail (include the PR URL). Then send a **review request** to all admins (`["wigy", "karmi", "admin"]`) with status `waiting`:
       - `topic`: `"review-request"`
       - `subject`: `"Review: <card name> certified"`
       - `body`: summary of the certification result with the card image `![Card Name](image-url)`, a link to the PR (e.g. `https://github.com/wigy/meccg/pull/<number>`), plus the certification status table
       - `keywords`: include `cardName`, `cardId`, `gitHash`, `prUrl`, `userName` (original requester)
       - `replyTo`: the original message ID
       - Mark the review message status as `waiting` after sending (same as for card-request).
     - If certification failed or card has unimplemented effects: mark failure, send reply mail.

   - **`feature-planning-request`**: Use the **Agent tool** (not the Skill tool) to run the `/handle-planning-request` skill — read `.claude/commands/handle-planning-request.md`, substitute `$ARGUMENTS` with the message ID, and pass the full content as the agent prompt. After it completes:
     - If the plan was sent successfully: mark success.
     - If it failed: mark failure, send a reply mail explaining the error.

   - **`feature-implementation-request`**: Use the **Agent tool** (not the Skill tool) to run the `/handle-implementation-request` skill — read `.claude/commands/handle-implementation-request.md`, substitute `$ARGUMENTS` with the message ID, and pass the full content as the agent prompt. After it completes:
     - If the feature was implemented and pushed: mark success.
     - If it failed: mark failure, send a reply mail explaining the error.

   - **`bug-report`**: Use the **Agent tool** (not the Skill tool) to run the `/handle-bug-report` skill — read `.claude/commands/handle-bug-report.md`, substitute `$ARGUMENTS` with the message ID, and pass the full content as the agent prompt. After it completes:
     - If the bug was fixed and pushed: mark success.
     - If it failed: mark failure, send a reply mail explaining the error.

   - **`feature-request`** or **`bug-fix-request`**: These cannot be automatically handled. Mark as processed with `success: false`. Send a reply mail to the sender explaining that this type of request requires manual attention.

   - **Any other topic or missing keywords**: Mark as processed with `success: false`. Send a reply mail explaining the message could not be processed.

5. **Send reply mail:** After processing, send a reply mail to the original requester (from the `userName` keyword, or if not present, use the `from` field of the original message). This is the **only** notification mechanism — do not use `/api/system/notify`. Use the system mail API with this exact JSON structure:
   ```json
   {
     "recipients": ["<userName>"],
     "sender": "ai",
     "from": "<displayName from ~/.meccg/players/ai/info.json>",
     "topic": "<reply-topic>",
     "subject": "<subject>",
     "body": "<markdown body>",
     "keywords": { "originalMessageId": "<msg-id>", ... },
     "replyTo": "<msg-id>",
     "sentBy": "ai"
   }
   ```
   ⚠️ **`recipients` MUST be a JSON array** (e.g. `["wigy"]`). A bare string like `"wigy"` will be split into characters `["w","i","g","y"]` and send mail to wrong users.

   Send via:
   ```
   curl -s -X POST http://localhost:8080/api/system/mail -H "Authorization: Bearer $(jq -r .masterKey ~/.meccg/secrets.json)" -H "Content-Type: application/json" -d '<json>'
   ```
   Fields:
   - `recipients`: JSON array of player names — **always `["name"]`, never `"name"`**
   - `sender`: `"ai"`
   - `from`: read `displayName` from `~/.meccg/players/ai/info.json` (e.g. `"Eru Ilúvatar"`)
   - `topic`: the matching reply topic (e.g. `card-request` -> `card-reply`, `certification-request` -> `certification-reply`)
   - `subject`: reference the original subject
   - `body`: markdown summary of what was done or why it failed
   - `keywords`: copy relevant keywords from the original message, add `originalMessageId` pointing to the handled message ID
   - `replyTo`: the original message ID being handled (this links the reply to the request)
   - `sentBy`: `"ai"` (saves a copy to ai's sent folder)

6. **Mark as processed:** Update the message status to `processed` with the appropriate `success` value:
   ```
   curl -s -X PUT http://localhost:8080/api/system/mail/ai/<msg-id> -H "Authorization: Bearer $(jq -r .masterKey ~/.meccg/secrets.json)" -H "Content-Type: application/json" -d '{"status":"processed","success":true}'
   ```

7. **Report:** Summarize what happened — which message was processed, what action was taken, whether it succeeded, and what reply was sent.

If any step fails unexpectedly, mark the message as processed with `success: false` and report the error.
