Investigate how an illegal or unexpected game state arose by analyzing a game log.

The argument is a description of the problem: $ARGUMENTS

## Data Source

Game logs consist of two files per game in `~/.meccg/logs/games/`:

- **`{gameId}.jsonl`** — JSONL state log. Each line is a state snapshot after an action:
  ```
  { "ts", "event": "state", "stateSeq": N, "reason": "action-type", "action": <full action>, "turn", "phase", "step", "activePlayer", "state": <GameState without cardPool and instanceMap> }
  ```
  The `action` field contains the complete action that caused the transition (e.g. `{ "type": "play-character", "player": "p1", "cardInstanceId": "i-42", "companyId": "c-1" }`). It is absent for non-action entries like `new-game`, `undo`, and `restore`.
  The `state` object omits `cardPool` and `instanceMap` — these are static within a game and stored in the cards file.

- **`{gameId}-cards.json`** — Static game data written once at game start. Contains:
  - `instances`: compact instance-to-definition mapping (`{ "i-0": "tw-156", ... }`)
  - `cards`: card definitions used in this game (`{ "tw-156": { ... }, ... }`)
  To resolve a card instance: look up `instances[instanceId]` to get the definition ID, then `cards[definitionId]` for the full card.

- **Do NOT use save files** (`~/.meccg/saves/`). Always use game logs — they contain the complete history.
- If the user provides a game ID, open `~/.meccg/logs/games/{gameId}.jsonl` directly.
- If no game ID is given, list available logs in `~/.meccg/logs/games/` sorted by modification time and ask which one to investigate.

## Investigation Process

1. **Verify card definitions**: Before anything else, load `{gameId}-cards.json` and compare the definitions of cards relevant to the reported problem against the current card data in `packages/shared/src/data/`. If the game was played with stale definitions (e.g. missing DSL effects that have since been added), the root cause is data staleness, not an engine bug. Report the discrepancy and stop.

2. **Load the log**: Read the JSONL file. Each line is one state snapshot. Parse all entries to build the full timeline.

3. **Identify the problem state**: Based on the user's description, find the state entry (by stateSeq, turn, phase, or scanning for the condition) where the problem is visible.

4. **Trace backwards**: Walk backwards through stateSeq values to find the transition where the illegal state was introduced. Compare consecutive states to identify what changed.

5. **Resolve card identities**: The state uses `CardInstanceId` values (e.g. `"i-42"`). To find what card an instance is:
   - Look up `state.instanceMap["i-42"].definitionId` to get the card definition ID (e.g. `"tw-156"`)
   - Look up `state.cardPool["tw-156"]` to get the card name and stats
   - Always report card names, not raw IDs, when presenting findings

6. **Load static data**: Read `{gameId}-cards.json`. Use `instances[instanceId]` to get the definition ID, then `cards[definitionId]` for the card's name, stats, and text.

7. **Report findings**: Present a clear timeline showing:
   - The action sequence that led to the problem (stateSeq, reason, what changed)
   - Which state transition introduced the issue
   - The relevant game state details (phase, player, cards involved)
   - A hypothesis for the root cause (which reducer/handler likely has the bug)

## Key State Fields to Inspect

- `state.phaseState` — current phase, step, and phase-specific bookkeeping
- `state.players[N].companies` — company membership, sites, movement
- `state.players[N].characters` — characters in play with items, stats, status
- `state.players[N].hand / playDeck / discardPile` — card zones
- `state.instanceMap` — resolves instance IDs to card definitions
- `state.turnNumber` — which turn
- `state.reverseActions` — reverse actions accumulated this phase
- `state.pendingEffects` — queued effects

## Tips

- Game logs can be large. Start by scanning `reason` and `phase` fields to narrow down the relevant range before loading full states.
- When comparing two consecutive states, focus on the diff — what moved between zones, what stats changed, what phase state changed.
- If the problem involves legal actions, load the state into `computeLegalActions()` mentally by checking the phase handler in `packages/server/src/engine/legal-actions/`.
- Cross-reference with the reducer handler in `packages/server/src/engine/reducer.ts` to understand how the action was processed.
