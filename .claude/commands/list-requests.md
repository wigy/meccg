List all incoming requests in the AI user's inbox.

Follow these steps:

1. **Log in as ai:** Get a session cookie for the ai account:
   ```
   SESSION=$(curl -s -c - -X POST http://localhost:8080/api/login -H 'Content-Type: application/json' -d "{\"name\":\"ai\",\"password\":\"$(jq -r .masterKey ~/.meccg/secrets.json)\"}" | grep meccg-session | awk '{print $NF}')
   ```

2. **Fetch the inbox:** List all messages in the ai inbox:
   ```
   curl -s http://localhost:8080/api/mail/inbox -b "meccg-session=$SESSION"
   ```

3. **Filter to requests only:** From the message list, keep only messages whose topic ends in `-request` (e.g. `card-request`, `certification-request`, `feature-request`, `bug-report`, `feature-planning-request`, `feature-implementation-request`, `bug-fix-request`).

4. **Display a summary table** sorted by timestamp ascending (oldest first):

   ```
   | # | Status     | Topic                  | Subject                          | From   | Date       |
   |---|------------|------------------------|----------------------------------|--------|------------|
   | 1 | new        | card-request           | wigy requested card "Orcrist"    | wigy   | 2026-03-28 |
   | 2 | processing | certification-request  | wigy requested cert for "Glamdring" | wigy | 2026-03-29 |
   ```

5. **Show totals** by status (e.g. "3 new, 1 processing, 2 processed") and by topic (e.g. "2 card-request, 1 certification-request, 3 feature-request").

6. If there are no request messages, report that the AI inbox has no pending requests.
