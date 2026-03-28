Handle a card request by resolving the card from the authoritative CoE database and adding it to our card data files.

The request ID argument is: $ARGUMENTS

If no request ID is given, list all pending card requests by running:
```
curl -s http://localhost:8080/api/system/card-requests -H "Authorization: Bearer $(jq -r .masterKey ~/.meccg/secrets.json)"
```
Then stop and show the list so the user can pick one.

Follow these steps:

1. **Look up the request:** Fetch the request details:
   ```
   curl -s http://localhost:8080/api/system/card-requests/<id> -H "Authorization: Bearer $(jq -r .masterKey ~/.meccg/secrets.json)"
   ```
   This returns `{ player, request: { id, deckId, cardName, createdAt } }`. If not found, stop and report.

2. **Read the deck:** Read the deck file from `data/decks/<deckId>.json` to understand context (alignment, which section the card appears in: pool, characters, hazards, resources, or sites).

3. **Fetch from CoE database:** Fetch the card from the authoritative database:
   ```
   https://raw.githubusercontent.com/council-of-elrond-meccg/meccg-cards-database/master/cards.json
   ```
   Search all sets (TW, AS, LE, WH, BA, DM, TD) for a card whose `name.en` matches the requested card name. Use the deck alignment to disambiguate if multiple matches exist (e.g. hero vs minion sites). Note: card IDs in the database use uppercase set prefixes (e.g. "TW-120") but our data files use lowercase (e.g. "tw-120").

4. **Determine target file:** Based on the card type and set, determine which data file in `packages/shared/src/data/` to add to:
   - TW characters -> `tw-characters.json`
   - TW items -> `tw-items.json`
   - TW resources (factions, allies, events) -> `tw-resources.json`
   - TW creatures -> `tw-creatures.json`
   - TW hazard events -> `tw-hazards.json`
   - TW sites -> `tw-sites.json`
   - LE characters -> `le-characters.json`
   - LE resources -> `le-resources.json`
   - LE sites -> `le-sites.json`
   - AS characters -> `as-characters.json`
   - AS sites -> `as-sites.json`
   - WH resources -> `wh-resources.json`
   - WH sites -> `wh-sites.json`
   - BA characters -> `ba-characters.json`
   - BA sites -> `ba-sites.json`
   If no existing file matches, create a new one following the set prefix convention and add the import to `packages/shared/src/data/index.ts`.

5. **Build card definition:** Create a card definition JSON object matching the exact structure used in our existing data files. Map fields from the CoE database format:
   - `id`: lowercase set-number (e.g. "tw-120")
   - `name`: from `name.en`
   - `cardType`: derive from CoE `type`, `alignment`, and `attributes.subtype`
   - `image`: construct URL using the set's `imageBaseUrl` + card `image` field
   - Map all relevant stats (prowess, body, mind, skills, race, etc.)
   - For items: map subtype, prowessModifier, bodyModifier, corruptionPoints
   - For creatures: map strikes, prowess, body, keyedTo, killMarshallingPoints
   - For sites: map siteType, sitePath, nearestHaven, region, playableResources, automaticAttacks
   - `effects`: set to `[]` (effects require manual implementation)
   - `text`: from `text.en`, strip HTML tags

   IMPORTANT: Look at 2-3 existing entries in the target file to match the exact shape. Every field must be present.

6. **Add to data file:** Append the new card definition to the target JSON array file.

7. **Update deck file:** In `data/decks/<deckId>.json`, find the entry with matching `name` and set its `card` field to the new card definition ID. Do this for ALL deck files that contain this card name (not just the requesting deck).

8. **Add card ID constant:** If the card is likely to be referenced in game logic, add a constant to `packages/shared/src/card-ids.ts`.

9. **Verify:** Run `npx tsc --noEmit -p packages/shared/tsconfig.json` to ensure the new card data is valid.

10. **Notify players:** Send a notification to all online players:
    ```
    printf '{"message":"New card added: <card name>"}' | curl -s -X POST http://localhost:8080/api/system/notify -H "Authorization: Bearer $(jq -r .masterKey ~/.meccg/secrets.json)" -H "Content-Type: application/json" -d @-
    ```

11. **Move request:** Call the store function to move the request. Read `~/.meccg/players/<player-dir>/requests/cards.json`, remove the request entry, and append it (with `resolvedAt` timestamp and `explanation`) to `succeeded.json` or `failed.json` in the same directory.
    - On success: explanation should summarize what was added (card ID, card type, target file)
    - On failure: explanation should say why (not found in database, ambiguous match, missing required fields, etc.)

12. **Report:** Summarize what happened — card name, definition ID, which file it was added to, which decks were updated. On failure, report what went wrong and why.

If the card cannot be found in the CoE database or cannot be mapped to our format, move the request to `failed.json` with an explanation, notify players that the card request failed (include the card name and reason), and report the failure.
