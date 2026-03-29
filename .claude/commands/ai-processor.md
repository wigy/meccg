Process the AI inbox queue: list all pending messages and handle the oldest one.

**IMPORTANT:** Process exactly ONE message, then stop. Do NOT loop or continue to the next message. After `/handle-mail` completes and you have reported the result, you are DONE.

Follow these steps:

1. **Log in as ai:** Get a session cookie for the ai account:
   ```
   SESSION=$(curl -s -c - -X POST http://localhost:8080/api/login -H 'Content-Type: application/json' -d "{\"name\":\"ai\",\"password\":\"$(jq -r .masterKey ~/.meccg/secrets.json)\"}" | grep meccg-session | awk '{print $NF}')
   ```

2. **Fetch the inbox:** List all messages in the ai inbox:
   ```
   curl -s http://localhost:8080/api/mail/inbox -b "meccg-session=$SESSION"
   ```

3. **Display the list:** Show all messages in a table with columns: ID, status, topic, subject, from, and timestamp. Sort by timestamp ascending (oldest first).

4. **If the inbox is empty**, report that there are no messages to process and stop.

5. **Pick the oldest message:** Select the message with the earliest timestamp that has status `new` or `read` (skip messages that are already `processing`, `processed`, `waiting`, or `approved`). If no unprocessed messages remain, report that all messages have been handled and stop.

6. **Run /handle-mail:** Invoke the `/handle-mail` skill with the selected message ID as the argument.

7. **Report:** After `/handle-mail` completes, summarize what was processed and the result.
