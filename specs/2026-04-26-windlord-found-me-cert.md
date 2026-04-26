# The Windlord Found Me (dm-164) Certification Plan

**Date:** 2026-04-26
**Card:** The Windlord Found Me (dm-164) — hero-resource-event (permanent), 3 misc MPs
**Branch:** `certify-dm-164-windlord-found-me`

## Card Text

> Playable at an untapped Isengard, Shadow-hold [{S}], or Dark-hold [{D}] during the
> site phase. Tap the site. The company faces an Orc attack (4 strikes with 9 prowess).
> Afterwards, a character may tap and place this card under him. If you do not place
> this card with a character after the attack, discard it. That character may not untap
> until after this card is stored in a Haven [{H}] during the organization phase. When
> this card is stored, and if your Wizard is not already in play, you may search your
> play deck or discard pile for a Wizard and play him at that Haven [{H}] (does not
> count towards the one character per turn limit). Cannot be duplicated by a given
> player. Cannot be included in a Fallen-wizard's deck.

## Already Implemented

The following rules are covered by existing DSL machinery (same pattern as Rescue Prisoners, tw-315):

| Rule | Effect | Status |
|------|--------|--------|
| Orc attack on play | `trigger-attack-on-play` | ✓ (reuse tw-315 pattern, values: Orc/4/9) |
| Discard if all tapped after attack | `trigger-attack-on-play` built-in | ✓ |
| Bearer cannot untap until stored | `bearer-cannot-untap` active constraint | ✓ |
| Constraint cleared when stored | `handleStoreItem` sweeps constraint | ✓ |
| Playable at untapped site | default (no `tapped-site-only` flag needed) | ✓ |
| Site tapped on play | automatic site-tap in chain-reducer | ✓ |
| Storable at Haven | `storable-at` with `siteTypes: ["haven"]` | ✓ |
| 3 MPs when stored | `storable-at: marshallingPoints: 3` | ✓ |
| Attaches to a character | `play-target: character` | ✓ |

## Missing Rules — Requires New Engine Work

| # | Rule | What's Missing |
|---|------|----------------|
| 1 | Playable at Isengard (ruins-and-lairs) OR Shadow-hold OR Dark-hold | `$or` filter in `play-target` site — condition-matcher supports `$or` but needs verification against `siteDef` context |
| 2 | Cannot be duplicated by a given player | `duplication-limit` scope `"player"` — not yet handled in `site.ts` |
| 3 | On store: fetch Wizard from deck/discard, play at Haven | No `on-store` trigger, no wizard-search pending resolution, no action/reducer |

---

## Implementation Steps

### Step 1 — Update card data JSON

**File:** `packages/shared/src/data/dm-resources.json`

Add effects to `dm-164`:

```json
"effects": [
  {
    "type": "play-target",
    "target": "site",
    "filter": {
      "$or": [
        { "siteType": { "$in": ["dark-hold", "shadow-hold"] } },
        { "name": "Isengard" }
      ]
    }
  },
  {
    "type": "play-target",
    "target": "character"
  },
  {
    "type": "storable-at",
    "siteTypes": ["haven"],
    "marshallingPoints": 3
  },
  {
    "type": "duplication-limit",
    "scope": "player",
    "max": 1
  },
  {
    "type": "trigger-attack-on-play",
    "creatureType": "Orc",
    "strikes": 4,
    "prowess": 9
  },
  {
    "type": "fetch-wizard-on-store"
  }
]
```

Isengard (`tw-404`) is a `ruins-and-lairs` site; matching by name is the correct approach since
the condition-matcher already supports `$or` and evaluates against the site definition object
(which has both `name` and `siteType` fields).

### Step 2 — Add `FetchWizardOnStoreEffect` DSL type

**File:** `packages/shared/src/types/effects.ts`

```typescript
/**
 * When present on a resource permanent event that carries `storable-at`,
 * storing the card at a haven triggers a wizard-search window for the
 * resource player — if and only if their Wizard is not already in play.
 *
 * The player may search their play deck or discard pile for any Wizard
 * and play him at the storing Haven. This does not count toward the
 * one-character-per-turn limit.
 *
 * Example: The Windlord Found Me (dm-164).
 */
export interface FetchWizardOnStoreEffect extends EffectBase {
  readonly type: 'fetch-wizard-on-store';
}
```

Add `FetchWizardOnStoreEffect` to the `CardEffect` union.

Update `docs/card-effects-dsl.md` with a new section documenting `fetch-wizard-on-store`.

### Step 3 — Add player-scoped duplication limit to `site.ts`

**File:** `packages/shared/src/engine/legal-actions/site.ts`

After the existing `scope: "game"` check and before the `scope: "site"` check, add:

```typescript
// duplication-limit: scope "player" — one copy per player across all their characters
const playerDupLimit = eventDef.effects?.find(
  (e): e is DuplicationLimitEffect => e.type === 'duplication-limit' && e.scope === 'player'
);
if (playerDupLimit) {
  const copiesForPlayer = Object.values(player.characters).reduce(
    (count, ch) =>
      count +
      ch.items.filter(item => {
        const iDef = state.cardPool[item.definitionId as string];
        return iDef && iDef.name === eventDef.name;
      }).length,
    0,
  );
  if (copiesForPlayer >= playerDupLimit.max) {
    logDetail(`Permanent event ${eventDef.name}: cannot be duplicated by this player (${copiesForPlayer}/${playerDupLimit.max} held)`);
    actions.push({
      action: { type: 'not-playable', player: playerId, cardInstanceId },
      viable: false,
      reason: `${eventDef.name}: already held by this player`,
    });
    continue;
  }
}
```

### Step 4 — Add `wizard-search-on-store` pending resolution kind

**File:** `packages/shared/src/types/pending.ts`

Add to the `PendingResolutionKind` discriminated union:

```typescript
| {
    readonly type: 'wizard-search-on-store';
    /** The haven site instance ID where the wizard will be played. */
    readonly havenSiteInstanceId: CardInstanceId;
    /** The company at that haven (wizard joins this company). */
    readonly companyId: CardInstanceId;
  }
```

### Step 5 — Add `play-wizard-from-search` and `skip-wizard-search` action types

**File:** `packages/shared/src/types/actions-organization.ts` (or nearest actions file)

```typescript
/**
 * Resource player selects a Wizard from their play deck or discard pile
 * during a wizard-search-on-store resolution window (The Windlord Found Me).
 *
 * Playing the Wizard at the Haven does not count toward the one-character-per-turn limit.
 */
export interface PlayWizardFromSearchAction {
  readonly type: 'play-wizard-from-search';
  readonly player: PlayerId;
  readonly resolutionId: ResolutionId;
  /** Definition ID of the chosen Wizard. */
  readonly wizardDefinitionId: CardDefinitionId;
  /** Which pile the wizard comes from. */
  readonly source: 'play-deck' | 'discard-pile';
}

/** Skip the wizard-search window — no Wizard desired. */
export interface SkipWizardSearchAction {
  readonly type: 'skip-wizard-search';
  readonly player: PlayerId;
  readonly resolutionId: ResolutionId;
}
```

Add both to the `GameAction` union and export from `index.ts`.

### Step 6 — Trigger wizard-search in `handleStoreItem`

**File:** `packages/shared/src/engine/reducer-organization.ts`

At the end of `handleStoreItem`, after clearing `bearer-cannot-untap` constraints,
check for `fetch-wizard-on-store`:

```typescript
const fetchWizardEffect = itemDef && 'effects' in itemDef
  ? (itemDef.effects as CardEffect[]).find(e => e.type === 'fetch-wizard-on-store')
  : undefined;
if (fetchWizardEffect) {
  const wizardInPlay = state.players[playerIndex].characters
    ? Object.values(state.players[playerIndex].characters).some(ch => {
        const chDefId = resolveInstanceId(stateAfterCheck, ch.instanceId);
        const chDef = chDefId ? stateAfterCheck.cardPool[chDefId as string] : undefined;
        return chDef && 'race' in chDef && chDef.race === 'wizard';
      })
    : false;
  if (!wizardInPlay) {
    const companyId = findCharacterCompanyId(stateAfterCheck, playerIndex, charId);
    const havenSiteInstanceId = getCompanySiteInstanceId(stateAfterCheck, playerIndex, companyId);
    if (companyId && havenSiteInstanceId) {
      logDetail(`The Windlord Found Me: wizard not in play — opening wizard-search window`);
      stateAfterCheck = enqueueResolution(stateAfterCheck, {
        source: itemInstId,
        actor: action.player,
        scope: { kind: 'phase', phase: Phase.Organization },
        kind: { type: 'wizard-search-on-store', havenSiteInstanceId, companyId },
      });
    }
  } else {
    logDetail(`The Windlord Found Me: wizard already in play — skipping search window`);
  }
}
```

Add small helpers `findCharacterCompanyId` and `getCompanySiteInstanceId` locally in the file.

### Step 7 — Legal actions for `wizard-search-on-store`

**File:** `packages/shared/src/engine/legal-actions/organization-events.ts` (or `organization.ts`)

When the top pending resolution for the resource player is `wizard-search-on-store`:

1. For each Wizard definition ID in `player.playDeck`: emit `play-wizard-from-search` with `source: 'play-deck'`.
2. For each Wizard instance in `player.discardPile`: emit `play-wizard-from-search` with `source: 'discard-pile'`.
3. Always emit `skip-wizard-search`.

A Wizard is any card with `race === 'wizard'` in its card pool definition.

### Step 8 — Reducers for `play-wizard-from-search` / `skip-wizard-search`

**File:** `packages/shared/src/engine/reducer-organization.ts`

**`handlePlayWizardFromSearch`:**

1. Validate the resolution exists and is `wizard-search-on-store`.
2. Remove the resolution from `pendingResolutions`.
3. Mint or move the wizard instance:
   - `source: 'play-deck'`: remove the definition ID from `player.playDeck`; mint a fresh `CardInstance`.
   - `source: 'discard-pile'`: find and remove the instance from `player.discardPile`.
4. Add the wizard to `player.characters` (status: `Untapped`), placing them in the company at the haven.
5. **Do not increment** any `charactersPlayedThisTurn` counter — the card text explicitly exempts this from the per-turn character limit.
6. Log the wizard arrival.

**`handleSkipWizardSearch`:**

Simply remove the `wizard-search-on-store` resolution from `pendingResolutions` and return.

### Step 9 — Create card test

**File:** `packages/shared/src/tests/cards/dm-164.test.ts`

```typescript
describe('dm-164 The Windlord Found Me', () => {

  // A. Playable at dark-hold (site phase, untapped site)
  test('play-windlord-dark-hold', () => { ... });

  // B. Playable at shadow-hold
  test('play-windlord-shadow-hold', () => { ... });

  // C. Playable at Isengard (ruins-and-lairs, matched by name)
  test('play-windlord-isengard', () => { ... });

  // D. Not playable at tapped site
  test('not-playable-at-tapped-site', () => { ... });

  // E. Not playable at a different site type (e.g. free-hold)
  test('not-playable-at-free-hold', () => { ... });

  // F. Orc attack fires on play (combat state set)
  test('orc-attack-fires-on-play', () => { ... });

  // G. Card discarded if all characters tapped after attack
  test('discard-if-all-tapped-after-attack', () => { ... });

  // H. Bearer cannot untap while card is attached
  test('bearer-cannot-untap-while-attached', () => { ... });

  // I. Bearer can untap after card is stored at Haven
  test('bearer-can-untap-after-store', () => { ... });

  // J. Wizard-search window opens on store when no Wizard in play
  test('wizard-search-window-opens-on-store', () => { ... });

  // K. Wizard-search window does NOT open when Wizard already in play
  test('no-wizard-search-when-wizard-in-play', () => { ... });

  // L. play-wizard-from-search (from play deck) brings wizard into company
  test('play-wizard-from-deck', () => { ... });

  // M. play-wizard-from-search (from discard pile) brings wizard into company
  test('play-wizard-from-discard', () => { ... });

  // N. skip-wizard-search closes the window without placing wizard
  test('skip-wizard-search', () => { ... });

  // O. Cannot be duplicated by same player (already holds a copy)
  test('duplication-limit-per-player', () => { ... });

  // P. Two different players can each hold a copy
  test('different-players-can-each-hold-copy', () => { ... });
});
```

### Step 10 — Pre-push verification

Run in parallel:

1. `npm run build`
2. `npx vitest run packages/shared/src/tests/cards/dm-164.test.ts`
3. `npm test`
4. `npm run lint`
5. `npm run test:nightly`

Fix any failures, then open the PR.

---

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| `$or` site filter with name match for Isengard | Isengard is `ruins-and-lairs` — no siteType match possible; naming it directly is precise and self-documenting in the card JSON |
| `duplication-limit` scope `"player"` added to existing effect type | Avoids a new effect type; the scope field is already a string, and "player" is a natural extension |
| `fetch-wizard-on-store` as a dedicated DSL effect | The on-store wizard fetch is dm-164-specific but the primitive (`on-store` + search) may apply to future cards; making it DSL-declared avoids a hardcoded card-id branch |
| Wizard-search as a `pendingResolution` (not an immediate reducer side effect) | Keeps the org-phase sequential: corruption check resolves first, then wizard-search window opens; consistent with gold-ring-test pattern |
| No `charactersPlayedThisTurn` increment | Explicit card text exemption; checked in `handlePlayWizardFromSearch`, not in legal-action gating |
| `skip-wizard-search` as separate action | The player must actively pass; this keeps the UI explicit and consistent with other pending-resolution skips |

## Dependency Order

Step 1 (card data) can be written immediately but won't pass tests until Steps 2–8 are done.
Steps 2, 4, 5 (type additions) can be done in parallel.
Step 3 depends on Step 2 (type must exist for TypeScript to compile).
Step 6 depends on Steps 4 and 2.
Step 7 depends on Steps 4 and 5.
Step 8 depends on Steps 4 and 5.
Step 9 (tests) depends on all above.
Step 10 (verification) depends on Step 9.
