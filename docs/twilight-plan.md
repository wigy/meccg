# Twilight (tw-106) Implementation Plan

Twilight is a hazard short-event that can also be played as a resource. It cancels and discards one environment card (in play or declared earlier in the same chain of effects). It does not count against the hazard limit.

## Card Properties

- **Card type:** `hazard-event`, `eventType: 'short'`
- **Environment:** Yes
- **Unique:** No (3 copies per deck)
- **Special rules:**
  1. Cancel & discard one environment (in play or in same chain)
  2. Playable as a resource (dual-alignment)
  3. Does not count against hazard limit

## 1. New Action Type: `play-short-event` (DONE)

Twilight (and future resource short-events) needs an action that works across multiple phases. Unlike `play-permanent-event` (adds to `eventsInPlay`) or `play-hazard` (initiates a chain), a resource short-event resolves immediately: cancel an environment, then discard itself.

```typescript
// actions.ts
interface PlayShortEventAction {
  type: 'play-short-event';
  player: PlayerId;
  cardInstanceId: CardInstanceId;      // the Twilight card
  targetInstanceId?: CardInstanceId;   // the environment to cancel
}
```

## 2. Card Data: Tag Twilight's Special Properties (DONE)

```json
{
  "id": "tw-106",
  "cardType": "hazard-event",
  "eventType": "short",
  "effects": [
    { "type": "play-restriction", "rule": "playable-as-resource" },
    { "type": "play-restriction", "rule": "no-hazard-limit" },
    {
      "type": "on-event",
      "event": "resolve",
      "apply": { "action": "cancel-and-discard" },
      "target": "environment"
    }
  ]
}
```

The DSL tags drive the engine:
- `playable-as-resource` tells legal-actions code to offer it during resource windows
- `no-hazard-limit` tells the hazard counter to skip it

## 3. Legal Actions: `organization.ts` (DONE)

Add `playShortEventActions()` after `playPermanentEventActions()`:

```typescript
function playShortEventActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = state.players.find(p => p.id === playerId)!;
  const actions: EvaluatedAction[] = [];

  for (const cardInstanceId of player.hand) {
    const inst = state.instanceMap[cardInstanceId];
    const def = state.cardPool[inst.definitionId];

    // Only hazard short-events with "playable-as-resource" effect
    if (def.cardType !== 'hazard-event' || def.eventType !== 'short') continue;
    if (!def.effects?.some(e =>
      e.type === 'play-restriction' && e.rule === 'playable-as-resource'
    )) continue;

    // Find targetable environments in eventsInPlay
    const envTargets = state.eventsInPlay.filter(e => {
      const eDef = state.cardPool[e.definitionId];
      return (eDef as { keywords?: readonly string[] }).keywords?.includes('environment');
    });
    // Also check chain entries if chain is active (for "declared in same chain")

    if (envTargets.length === 0) {
      actions.push({
        action: { type: 'not-playable', player: playerId, cardInstanceId },
        viable: false, reason: 'No environment to cancel',
      });
      continue;
    }

    // One action per targetable environment
    for (const target of envTargets) {
      actions.push({
        action: {
          type: 'play-short-event', player: playerId,
          cardInstanceId, targetInstanceId: target.instanceId,
        },
        viable: true,
      });
    }
  }
  return actions;
}
```

Wire it into the main org function (around line 815) and add instances to the `evaluatedInstances` exclusion set so they don't get marked `not-playable`.

## 4. Phase Whitelist: `phases.ts` (DONE — Organization only)

Added `'play-short-event'` to `LEGAL_ACTIONS_BY_PHASE` for Organization phase.
Still TODO for M/H and Site phases:
- **MovementHazard** (either player, Twilight is playable during any player's turn)
- **Site** (resource player)

## 5. Reducer: Handle `play-short-event` (DONE)

Handler `handlePlayShortEvent` added to the reducer:
1. Removes Twilight from hand → player's discard pile
2. Removes target environment from `eventsInPlay` → owner's discard pile
3. Dispatched from the organization phase (and will be reachable from other phases once their legal-actions are wired up)

## 6. Keywords (DONE)

Cards now have an optional `keywords` array on all card type interfaces. The CoE rules
define "keyword" as a word on a card used to determine whether it is affected by certain
effects (rule 807). "Environment" is a keyword (rule 781), as are "weapon", "armor",
"helmet", "corruption", "detainment", "spawn", etc.

Keywords have been added to card data:
- **Environment:** tw-28 (Doors of Night), tw-106 (Twilight), tw-243 (Gates of Morning), tw-335 (Sun)
- **Weapon:** tw-244 (Glamdring), tw-333 (Sting), tw-206 (Dagger of Westernesse), le-299 (Black Mace), le-342 (Saw-toothed Blade)
- **Armor:** tw-345 (The Mithril-coat)
- **Helmet:** le-313 (High Helm)

The legal-actions code should check `def.keywords?.includes('environment')` instead of
parsing the text field. Keywords are displayed on the zoomed card preview in the web client.

## Key Architectural Decisions

- **Twilight during organization doesn't need a chain** -- it's a resource action, not a hazard response. The chain is only for the M/H phase.
- **Target selection is mandatory** -- the player must choose which environment to cancel. The UI shows one action per valid target.
- **`playable-as-resource`** is the DSL flag that gates cross-alignment playability. The engine checks it, not the card type.
