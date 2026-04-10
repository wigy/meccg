Investigate and fix a bug based on a bug report received via mail. Read the report, find the game log, diagnose the issue, implement a fix, iterate until build/tests/lint pass, commit, and push. **Do not send any mail or update any message status** — `bin/handle-mail` is the sole sender; you only do the work and emit a structured result block on stdout.

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
   If not found, stop and emit a `success: false` result block. Extract the `body` (bug description), `from` (who reported it), `subject`, and `keywords`.

3. **Extract bug details:** Read the message body carefully. Look for:
   - **Game ID** — needed to find the game log
   - **Sequence number** — the state sequence where the problem occurred
   - **Description** of what went wrong (expected vs actual behavior)
   Note these details for the investigation.

4. **Investigate the bug:** Use the investigation process from `/investigate`:

   a. **Load card data:** Read `~/.meccg/logs/games/<gameId>-cards.json` to get instance-to-definition mappings and card definitions used in the game.

   b. **Verify card definitions:** Compare the definitions of cards relevant to the reported problem against the current card data in `packages/shared/src/data/`. If the game was played with stale definitions (e.g. missing DSL effects), the root cause may be data staleness.

   c. **Load the game log:** Read `~/.meccg/logs/games/<gameId>.jsonl`. Each line is a state snapshot:
      ```
      { "ts", "event": "state", "stateSeq": N, "reason": "action-type", "action": <full action>, "turn", "phase", "step", "activePlayer", "state": <GameState> }
      ```

   d. **Find the problem state:** Locate the state entry at or near the reported sequence number. Examine the state to confirm the reported problem.

   e. **Trace backwards:** Walk backwards through stateSeq values to find the transition where the bug was introduced. Compare consecutive states to identify what changed.

   f. **Resolve card identities:** Use the cards file to translate instance IDs (e.g. `"i-42"`) to card names. Always report card names, not raw IDs.

   g. **Identify root cause:** Based on the state transitions, determine which reducer handler or phase handler has the bug. Cross-reference with:
      - Phase handlers in `packages/shared/src/engine/legal-actions/`
      - Reducer in `packages/shared/src/engine/reducer.ts`
      - Any relevant DSL effect handlers

5. **Validate the bug against the log AND the rules:** Before proceeding to a fix, you must independently confirm two things: (a) the report describes something that actually happened in *this* game save, and (b) what the report claims is wrong is in fact wrong per the official rules. Do not skip either check.

   a. **Tight game-save correspondence.** The bug report must relate tightly to the specific game log identified by the report's game ID:
      - The reported `gameId` must match a real log file at `~/.meccg/logs/games/<gameId>.jsonl`. If it does not, stop.
      - The reported sequence number (or surrounding range) must exist in that log. If it does not, stop.
      - The cards, players, phase, step, and actions named in the report must actually appear in the state at (or near) that sequence. Resolve instance IDs via `<gameId>-cards.json` and verify by name — do not accept the report's framing on faith.
      - If the report references behavior that the log does not actually show (wrong card, wrong player, wrong phase, action never taken, state never reached), the report is **not corroborated by this save**. Stop and emit `success: false` with a `reply.body` explaining exactly what the log shows instead.

   b. **Rules validation against CoE rules and CRF 22.** Even if the log matches the report, the reported behavior might actually be *correct* per the rules. Before calling it a bug, verify the claim against the authoritative sources:
      - **CoE rules:** Read the relevant section(s) of `docs/coe-rules.md` for the phase/step/mechanic involved. Quote the rule that supposedly was violated.
      - **CRF 22 errata and rulings:** Consult <https://meccg.com/rules/collected-rulings-and-errata-crf/crf-22/card-errata-and-rulings/> for any card-specific errata or rulings that affect the cards involved in the reported situation. CRF 22 frequently overrides or clarifies plain card text — a "bug" may simply be the engine correctly applying a CRF ruling the reporter was unaware of.
      - If both the CoE rules and CRF 22 say the engine's behavior was actually correct, **do NOT proceed with a code fix**. Emit `success: false` with `reply.body` citing the specific rule / CRF ruling that justifies the observed behavior.
      - Only proceed to step 6 if (a) the log corroborates the report AND (b) the rules + CRF 22 confirm the observed behavior is genuinely incorrect.

   This double validation prevents speculative code changes based on misread saves or misunderstood rules.

6. **Check out master:** Always start from the master branch to avoid building on stale or unrelated branches:
   ```
   git checkout master && git pull
   ```

7. **Find relevant test file:** Before fixing, check if there is an existing test that covers the rule or card involved:
   - If the bug is about a **game rule**, look in `packages/shared/src/tests/rules/` for a test file covering the relevant CoE rule section. Check for `test.todo()` entries that match the broken rule.
   - If the bug is about a **card's special ability**, look in `packages/shared/src/tests/cards/` for a test file for that card (named by card ID, e.g. `tw-156.test.ts`).
   - Note the file path (or absence) for step 9.

8. **Fix the bug:** Implement the fix in the source code:
   - Read the relevant source files
   - Make the minimal code changes needed to fix the bug
   - Follow the project's coding conventions (see CLAUDE.md)
   - Ensure new code has proper JSDoc documentation where needed
   - Follow the server-side logging policy if modifying engine code

9. **Add a regression test:** Write a test that reproduces the exact scenario from the bug report and would fail without the fix:
   - If an existing test file was found in step 7, add the test there (convert a `test.todo()` if one matches, otherwise add a new `test()` block).
   - If no existing file covers this case, create a new test file in the appropriate directory (`rules/` or `cards/`).
   - The test should set up the game state that triggered the bug (using helpers from `test-helpers.ts`), then assert that the engine now produces the correct legal actions or state.
   - Keep the test focused on the specific bug — one scenario, clear assertion.
   - All helpers go in `test-helpers.ts`, not in the test file itself.

10. **Iterate until green:** Run all four checks **in parallel** and fix any failures. Repeat until all pass:
   - `npm run build` — type-check (must pass)
   - `npm test` — rules tests (must all pass)
   - `npm run test:nightly` — card tests (must not introduce new failures)
   - `npm run lint` — linting (fix with `npm run lint:fix`)

   If a check fails, read the error output, fix the issue, and re-run. Keep iterating until all four pass cleanly.

11. **Create a branch, commit, push, and open a PR:** Work on a dedicated branch and open a pull request — never push bug fixes directly to master.
   ```
   git checkout -b fix/<short-slug>
   git add <changed-files>
   git commit -m "<descriptive message>

   Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
   git push -u origin fix/<short-slug>
   ```
   Then create a pull request:
   ```
   gh pr create --title "<short bug fix description>" --body "<markdown body — bug summary, root cause, fix, test added>"
   ```
   Capture the commit hash and PR URL from the output. The commit message should summarize the bug fix.

12. **Emit the structured result block:** As the **last** thing you output, print exactly one block in the form below. `bin/handle-mail` will parse the JSON between the markers and use it to send the bug-reply mail (with credits/time footer) and the review request to admins. Do not call `/api/system/mail` or `/api/system/mail/.../<msg-id>` anywhere in this skill.

   ```
   ===HANDLE_MAIL_RESULT_BEGIN===
   {
     "success": true,
     "summary": "<one-line summary of the fix>",
     "reply": {
       "topic": "bug-reply",
       "subject": "Fixed: <original subject>",
       "body": "<markdown body — thanks for the report, summary of the fix, link to PR: <prUrl>>",
       "keywords": {
         "originalMessageId": "<msg-id>",
         "gitHash": "<commit hash>",
         "prUrl": "<PR URL from gh pr create>",
         "gameId": "<game ID>"
       }
     },
     "review": {
       "topic": "review-request",
       "recipients": ["wigy", "karmi", "admin"],
       "subject": "Review: <short bug fix description>",
       "body": "<markdown body — bug summary, root cause, fix summary, files changed, PR link>",
       "keywords": {
         "originalMessageId": "<msg-id of the bug report>",
         "bugReportId": "<msg-id>",
         "gitHash": "<commit hash>",
         "prUrl": "<PR URL>",
         "reportedBy": "<from field of the bug report>",
         "gameId": "<game ID>"
       }
     }
   }
   ===HANDLE_MAIL_RESULT_END===
   ```

   - If the bug cannot be reproduced from the log or you cannot fix it, set `"success": false`, omit the `review` field, and put the explanation in `reply.body` (with subject `"Unable to fix: <original subject>"`).
   - The `body` fields are JSON strings — escape newlines as `\n` and quotes as `\"`.
   - Do **not** print anything after `===HANDLE_MAIL_RESULT_END===`.

13. **Report:** Briefly summarize what happened (one or two lines) **before** the result block, so the run log is readable. The result block must still be the final output.
