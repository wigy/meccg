Process the AI inbox queue: list all pending messages and handle the oldest one.

**IMPORTANT:** Process exactly ONE message, then stop. Do NOT loop or continue to the next message. After `/handle-mail` completes and you have reported the result, you are DONE.

Follow these steps:

**Logging:** At every numbered step below, print a short status line to stdout so the operator can follow progress in the terminal. Use the format `[ai-processor] <message>`. Always print before AND after long-running steps.

1. **Log in as ai:** Get a session cookie for the ai account:
   ```
   SESSION=$(curl -s -c - -X POST http://localhost:8080/api/login -H 'Content-Type: application/json' -d "{\"name\":\"ai\",\"password\":\"$(jq -r .masterKey ~/.meccg/secrets.json)\"}" | grep meccg-session | awk '{print $NF}')
   ```
   Print: `[ai-processor] Logged in as ai`

2. **Fetch the inbox:** List all messages in the ai inbox:
   ```
   curl -s http://localhost:8080/api/mail/inbox -b "meccg-session=$SESSION"
   ```
   Print: `[ai-processor] Inbox: <N> total messages, <M> unprocessed`

3. **Display the list:** Show all messages in a table with columns: ID, status, topic, subject, from, and timestamp. Sort by timestamp ascending (oldest first).

4. **If the inbox is empty**, print `[ai-processor] Inbox empty, nothing to do` and stop.

5. **Pick the oldest message:** Select the message with the earliest timestamp that has status `new` or `read` (skip messages that are already `processing`, `processed`, `waiting`, or `approved`). If no unprocessed messages remain, print `[ai-processor] All messages already handled` and stop. Otherwise print: `[ai-processor] Selected: "<subject>" from <from> (topic: <topic>, id: <msg-id>)`

6. **Run /handle-mail:** Print `[ai-processor] Dispatching to /handle-mail...` then use the **Agent tool** (not the Skill tool) to handle the message — read `.claude/commands/handle-mail.md`, substitute `$ARGUMENTS` with the selected message ID, and pass the full content as the agent prompt. Wait for the agent to complete.

7. **Report:** Print `[ai-processor] Done: <one-line summary of outcome>` then summarize what was processed and the result.
