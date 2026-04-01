Handle a card request by resolving the card from the authoritative CoE database and adding it to our card data files.

The argument is a card name and deck ID in the format `<cardName> <deckId>`: $ARGUMENTS

Follow these steps:

1. **Read the deck:** Read the deck file from `data/decks/<deckId>.json` to understand context (alignment, which section the card appears in: pool, characters, hazards, resources, or sites).

2. **Fetch from CoE database:** Fetch the card from the authoritative database:
   ```
   https://raw.githubusercontent.com/council-of-elrond-meccg/meccg-cards-database/master/cards.json
   ```
   Search all sets (TW, AS, LE, WH, BA, DM, TD) for a card whose `name.en` matches the requested card name. Use the deck alignment to disambiguate if multiple matches exist (e.g. hero vs minion sites). Note: card IDs in the database use uppercase set prefixes (e.g. "TW-120") but our data files use lowercase (e.g. "tw-120").

3. **Determine target file:** Based on the card type and set, determine which data file in `packages/shared/src/data/` to add to:
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

4. **Build card definition:** Create a card definition JSON object matching the exact structure used in our existing data files. Map fields from the CoE database format:
   - `id`: lowercase set-number (e.g. "tw-120")
   - `name`: from `name.en`
   - `cardType`: derive from CoE `type`, `alignment`, and `attributes.subtype`
   - `image`: construct URL as `https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/{set}/{image}` where `{set}` is the lowercase set code and `{image}` is the card's `image` field. Do NOT use `imageBaseUrl` from the database — it uses jsDelivr which is incompatible with our image proxy.
   - Map all relevant stats (prowess, body, mind, skills, race, etc.)
   - For items: map subtype, prowessModifier, bodyModifier, corruptionPoints
   - For creatures: map strikes, prowess, body, keyedTo, killMarshallingPoints
   - For sites: map siteType, sitePath, nearestHaven, region, playableResources, automaticAttacks
   - `effects`: set to `[]` (effects require manual implementation)
   - `text`: from `text.en`, strip HTML tags

   IMPORTANT: Look at 2-3 existing entries in the target file to match the exact shape. Every field must be present.

5. **Add to data file:** Append the new card definition to the target JSON array file.

6. **Update deck files:** In `data/decks/<deckId>.json`, find the entry with matching `name` and set its `card` field to the new card definition ID. Do this for ALL deck files that contain this card name (not just the requesting deck). Also update player deck copies in `~/.meccg/players/*/decks/` — search all player directories for decks containing this card name and update them too.

7. **Add card ID constant:** If the card is likely to be referenced in game logic, add a constant to `packages/shared/src/card-ids.ts`.

8. **Verify:** Run `npx tsc --noEmit -p packages/shared/tsconfig.json` to ensure the new card data is valid.

9. **Commit and push:** Stage all changed files (card data, deck files) and create a commit:
   ```
   git add <changed files>
   git commit -m "Add <card name> (<card id>) from card request"
   git push
   ```
   Record the commit hash from the output — it will be included in the reply mail as `gitHash`.

10. **Report:** Summarize what happened — card name, definition ID, which file it was added to, which decks were updated, and the git commit hash. On failure, report what went wrong and why.

Note: Do NOT send notifications or update any request tracking. The caller (e.g. `/handle-mail`) is responsible for sending reply mail to the requesting player via the mailing system. The caller should include the `gitHash` from this step in the reply mail keywords.

If the card cannot be found in the CoE database or cannot be mapped to our format, report the failure with the reason.
