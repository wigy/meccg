# Rescue Prisoners (tw-315) Certification Plan

**Date:** 2026-04-26  
**Card:** Rescue Prisoners (tw-315) — hero-resource-event (permanent)  
**Branch:** `certify-tw-315-rescue-prisoners`

## Card Text

> Playable at an already tapped Dark-hold [{D}] or Shadow-hold [{S}] during the
> site phase. The company faces a Spider attack (2 strikes with 7 prowess). If no
> characters are untapped after the attack, discard Rescue Prisoners. Otherwise,
> you may tap 1 character in the company and put Rescue Prisoners under his
> control. No marshalling points are received and that character may not untap
> until Rescue Prisoners is stored at a Haven [{H}], Border-hold [{B}], or
> Free-hold [{F}] during his organization phase. Cannot be duplicated at a given site.

## Already Implemented

The following rules are already supported and tested:

| Rule | Effect | Status |
|------|--------|--------|
| Playable at tapped dark-hold/shadow-hold only | `play-target` (site) + `play-flag: tapped-site-only` | ✓ |
| Attaches to a character | `play-target` (character) | ✓ |
| Cannot duplicate at same site | `duplication-limit` (scope: site, max: 1) | ✓ |
| Storable at haven/border-hold/free-hold | `storable-at` | ✓ |
| 0 MPs while attached, 2 MPs when stored | `marshallingPoints: 0` + `storable-at: marshallingPoints: 2` | ✓ |

## Missing Rules (test.todo in tw-315.test.ts)

Three rules require new engine support:

1. **Spider attack on play** — the company faces a Spider attack (2 strikes, prowess 7) immediately when the card's chain entry resolves.
2. **Discard if all tapped** — if no characters are untapped after the attack, the card is discarded instead of remaining attached.
3. **Bearer cannot untap** — the character bearing the card may not untap during the untap phase until the card is stored.

## Implementation Steps

### Step 1 — Add `ForcedAttackEffect` DSL type

**File:** `packages/shared/src/types/effects.ts`

New interface (add to `CardEffect` union):

```typescript
/**
 * When this resource permanent event resolves, the active company immediately
 * faces a synthetic creature attack with the given statistics.
 *
 * If `discardIfAllTapped` is true and no characters are untapped after combat,
 * the card is discarded rather than remaining attached.
 *
 * Example: Rescue Prisoners (tw-315) — Spider, 2 strikes, prowess 7.
 */
export interface ForcedAttackEffect extends EffectBase {
  readonly type: 'forced-attack';
  readonly race: string;
  readonly strikes: number;
  readonly prowess: number;
  readonly discardIfAllTapped?: boolean;
}
```

### Step 2 — Add `PreventUntapEffect` DSL type

**File:** `packages/shared/src/types/effects.ts`

```typescript
/**
 * When present on a resource permanent event attached to a character,
 * the bearer cannot untap during the untap phase until this card is
 * removed (e.g. stored during organization phase).
 *
 * Example: Rescue Prisoners (tw-315).
 */
export interface PreventUntapEffect extends EffectBase {
  readonly type: 'prevent-untap';
}
```

### Step 3 — Add `resource-play-triggered` attack source variant

**File:** `packages/shared/src/types/state-combat.ts`

Extend the `AttackSource` discriminated union:

```typescript
| {
    readonly type: 'resource-play-triggered';
    /** Card instance whose forced-attack effect triggered this combat. */
    readonly cardInstanceId: CardInstanceId;
    /** Character the card is attaching to. */
    readonly bearerInstanceId: CardInstanceId;
  }
```

### Step 4 — Handle `forced-attack` in `resolvePermanentEvent`

**File:** `packages/shared/src/engine/chain-reducer.ts`

After the card is attached to the target character (chain entry resolved), check for a `forced-attack` effect on the resolved card definition. If found, build a `CombatState` and set it on the returned state:

- `attackSource.type`: `'resource-play-triggered'`
- `companyId`: the active company
- `defendingPlayerId`: the player who played the card
- `strikesTotal`: effect's `strikes`
- `strikeProwess`: effect's `prowess`
- `creatureRace`: effect's `race`
- `combat.phase`: `'assign-strikes'`

The chain entry is already marked resolved before this combat state is set. After combat ends, `finalizeCombat` returns to the enclosing site-phase state (`play-resources` step).

### Step 5 — Handle `discardIfAllTapped` in `finalizeCombat`

**File:** `packages/shared/src/engine/reducer-combat.ts`

After clearing `combat: null`, when `combat.attackSource.type === 'resource-play-triggered'`:

1. Look up the `ForcedAttackEffect` on the card definition.
2. If `discardIfAllTapped === true`, check the defending company for any untapped character.
3. If none untapped → remove the card from the bearer's `items` array and add it to the player's `discardPile`.
4. If at least one untapped → leave the card attached (combat is over, card stays in play).

### Step 6 — Modify `performUntap` to respect `prevent-untap`

**File:** `packages/shared/src/engine/reducer-untap.ts`

In the character untap loop, before setting `newStatus = CardStatus.Untapped` for a tapped character, scan the character's `items` for any card definition carrying a `prevent-untap` effect:

```typescript
if (ch.status === CardStatus.Tapped) {
  const hasPrevention = ch.items.some(item => {
    const itemDef = state.cardPool[item.definitionId as string];
    return itemDef && 'effects' in itemDef &&
      (itemDef.effects as readonly CardEffect[])?.some(e => e.type === 'prevent-untap');
  });
  if (!hasPrevention) {
    newStatus = CardStatus.Untapped;
  } else {
    logDetail(`Untap: skipping ${key} — prevent-untap from attached card`);
  }
}
```

Prevention lifts automatically when the card is stored (removed from `items`).

### Step 7 — Update card data JSON

**File:** `packages/shared/src/data/tw-resources.json`

Add to `tw-315` effects:

```json
{ "type": "forced-attack", "race": "spiders", "strikes": 2, "prowess": 7, "discardIfAllTapped": true },
{ "type": "prevent-untap" }
```

### Step 8 — Update DSL documentation

**File:** `docs/card-effects-dsl.md`

Add entries for `forced-attack` and `prevent-untap`, including examples, fields, and implementation location.

### Step 9 — Complete card test

**File:** `packages/shared/src/tests/cards/tw-315.test.ts`

Replace the three `test.todo` entries with real assertions:

**A. Spider attack fires on play**  
Play the card, pass chain priority for both players, verify `state.combat` is set with `strikesTotal: 2`, `strikeProwess: 7`, `creatureRace: 'spiders'`.

**B. Discard if all tapped after attack**  
Drive the combat with all characters taking tapped strikes; after finalization, verify the card moved from the bearer's `items` to `discardPile`.

**C. Bearer cannot untap**  
Build an untap-phase state with Rescue Prisoners attached (status tapped); apply the `untap` action; verify bearer remains tapped.

### Step 10 — Pre-push verification

Run in parallel:

1. `npm run build`
2. `npx vitest run packages/shared/src/tests/cards/tw-315.test.ts`
3. `npm test`
4. `npm run lint`
5. `npm run test:nightly`

Fix any failures, then open the PR.

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| `forced-attack` as a DSL effect type | Card-specific reducer branches are unmaintainable; any future resource card that deals a forced attack on play reuses this for free |
| `discardIfAllTapped` as a field on `ForcedAttackEffect` | Semantically part of the same play-triggered attack mechanic; a separate `PendingResolution` kind would be over-engineering |
| `prevent-untap` read directly off attached items in `performUntap` | Avoids ActiveConstraint placement/removal bookkeeping; the card leaving `items` (on store) removes the prevention automatically |
| `resource-play-triggered` attack source variant | Allows `finalizeCombat` to detect and handle the post-combat discard-if-tapped logic without touching existing combat branches |

## Dependency Order

Steps 1–3 (type additions) can be done in parallel.  
Step 4 depends on Steps 1 and 3.  
Step 5 depends on Steps 1, 3, and 4.  
Step 6 depends on Step 2.  
Step 7 depends on Steps 1 and 2.  
Step 8 depends on all above.  
Step 9 (tests) depends on all above.
