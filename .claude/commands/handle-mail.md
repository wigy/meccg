Handle a mail message from the ai inbox by dispatching it to the appropriate skill based on its topic and keywords.

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

   - **`card-request`**: The keywords should contain `cardName`, `deckId`, and `userName`. Run the `/handle-card-request` skill with `<cardName> <deckId>` as arguments. After it completes:
     - If the card was successfully added: mark success, send a reply mail to the requesting user.
     - If it failed: mark failure, send a failure reply mail to the requesting user.

   - **`certification-request`**: The keywords should contain `cardId`. Run the `/certify-card` skill with the `cardId` value. After it completes:
     - If certification passed: mark success, send reply mail.
     - If certification failed or card has unimplemented effects: mark failure, send reply mail.

   - **`feature-request`** or **`bug-fix-request`**: These cannot be automatically handled. Mark as processed with `success: false`. Send a reply mail to the sender explaining that this type of request requires manual attention.

   - **Any other topic or missing keywords**: Mark as processed with `success: false`. Send a reply mail explaining the message could not be processed.

5. **Send reply mail:** After processing, send a reply mail to the original requester (from the `userName` keyword, or if not present, use the `from` field of the original message). This is the **only** notification mechanism — do not use `/api/system/notify`. Use the system mail API:
   ```
   curl -s -X POST http://localhost:8080/api/system/mail -H "Authorization: Bearer $(jq -r .masterKey ~/.meccg/secrets.json)" -H "Content-Type: application/json" -d '<json>'
   ```
   The reply must have:
   - `recipients`: the original requester's name (from `userName` keyword or `from` field)
   - `sender`: `"ai"`
   - `from`: `"AI Assistant"`
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
