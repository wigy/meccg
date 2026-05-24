# Gold Ring Test Replacement — Feature Plan

**Date:** 2026-05-24
**Rules:** CoE Rules 9.21 (Gold Ring Test), 9.22 (Darkhaven Auto-Test)
**Companion certifications:** tw-266 Lesser Ring (PR #637), tw-274 Magic Ring of Stealth (PR #638)

---

## Rules Summary

### Rule 9.21 — Gold Ring Test (replacement step)

When a gold ring is tested the owner rolls 2d6, applies any modifiers, and
**may immediately play a special ring card from hand** whose category matches
the final roll result as listed on the gold ring card. The special ring replaces
the gold ring on the same character; the gold ring is discarded regardless of
whether a replacement was played.

Playing the special ring via a test:

- Counts as "playing an item."
- Is **not** restricted to the site phase.
- Does **not** tap a site.
- Does **not** require an untapped site or character.
- Can only replace with a ring of the **same alignment** as the gold ring
  (except for Fallen-wizard players, who may use any alignment).

### Rule 9.22 — Gold Ring Auto-Test at Darkhaven

Any gold ring stored at a Darkhaven is automatically tested at store time with
a **−2** modification. A special ring played as a result comes into play
**stored** (not attached to a character).

*Note: Rule 9.23 (Ringwraith/Balrog end-of-turn auto-test) is not in scope for
this plan.*

---

## Card Inventory

### Gold ring cards (source of test tables)

| ID | Name | Alignment | Certified | Notes |
|---|---|---|---|---|
| tw-196 | Beautiful Gold Ring | wizard | no | |
| tw-306 | Precious Gold Ring | wizard | no | |
| le-315 | The Least of Gold Rings | ringwraith | 2026-04-19 | Missing `ring-test-table` effect; must be added |
| le-311 | Gleaming Gold Ring | ringwraith | no | Special: may also search deck/discard for lesser-ring |

### Test tables

| Category | tw-196 Beautiful | tw-306 Precious | le-315 Least | le-311 Gleaming |
|---|---|---|---|---|
| `lesser-ring` | any (null–null) | any (null–null) | any (null–null) | any (null–null, +deck search) |
| `magic-ring` | 1–7 | 1–5 | 1–7 | 1–6 |
| `dwarven-ring` | 10–12+ | 8–12+ | 10–12+ | 9–12+ |
| `the-one-ring` | 12+ | 10–12+ | 12+ | — |
| `spirit-ring` | — | — | — | 10–12+ |

Multiple categories can match the same roll total; the player chooses which eligible
card to play (or plays none).

**Gleaming Gold Ring special rule:** when the test result is eligible for
`lesser-ring`, the player may search their play deck and/or discard pile for a
lesser-ring card to play (instead of being restricted to hand). This is encoded
as a `ring-test-search` modifier effect on the gold ring card.

### Special ring cards (eligible replacements)

| ID | Name | Category | Alignment | Certified |
|---|---|---|---|---|
| tw-266 | Lesser Ring | `lesser-ring` | wizard | no (PR #637) |
| le-324 | Minor Ring | `lesser-ring` | ringwraith | no |
| tw-274 | Magic Ring of Stealth | `magic-ring` | wizard | no (PR #638) |
| as-123 | Dwarven Ring of Thélor's Tribe | `dwarven-ring` | ringwraith | no |
| as-124 | Dwarven Ring of Thrár's Tribe | `dwarven-ring` | ringwraith | no |
| tw-347 | The One Ring | `the-one-ring` | wizard | no |
| *(none)* | Spirit Ring | `spirit-ring` | ringwraith | N/A — no cards in database |

All special rings must have their category added as a keyword in the JSON data.

### Ring-test modifier cards

| ID | Name | Effect | Alignment | Certified |
|---|---|---|---|---|
| tw-323 | Scroll of Isildur | +2 to gold-ring-test roll (already in effects) | wizard | 2026-04-13 |
| tw-156 | Gandalf | grants `test-gold-ring` tap action (already in effects) | wizard | 2026-04-07 |

The Scroll of Isildur modifier is already handled by the existing roll logic.
Gandalf's `test-gold-ring` grant-action currently rolls and discards without
triggering a ring-play-offer; it will need updating as a follow-on after the
mechanic is in place (not in scope for this plan — mark as TODO in effects).

### Sites with `auto-test-gold-ring` site-rule

| ID | Name | Alignment | Roll modifier |
|---|---|---|---|
| le-367 | Dol Guldur | ringwraith | −2 |
| le-390 | Minas Morgul | ringwraith | −2 |
| le-359 | Carn Dûm | ringwraith | −2 |
| ba-93 | Moria | balrog | −2 |
| ba-100 | The Under-gates | balrog | −2 |
| dm-39 | The Under-grottos (wizard version) | wizard | +2 |

These sites already trigger the `gold-ring-test` pending resolution via the
existing `auto-test-gold-ring` site-rule; they need no changes.

### Special site

| ID | Name | Notes |
|---|---|---|
| le-352 | Barad-dûr | Treated as Darkhaven during untap phase; any gold ring here auto-tested during site phase |

Barad-dûr is a minion site that is not typed as a Darkhaven but behaves as one
for ring-test purposes. Its handling may require explicit recognition in the
`goldRingAutoTestModifier` helper.

---

## Architecture

### 1. DSL effect types: `ring-test-table` and `ring-test-search`

Add two new `CardEffect` variants to `packages/shared/src/types/effects.ts`.

```typescript
export type RingCategory =
  | 'lesser-ring'
  | 'magic-ring'
  | 'dwarven-ring'
  | 'the-one-ring'
  | 'spirit-ring';

export interface RingTestTableEntry {
  readonly category: RingCategory;
  /** null means no lower bound ("any result" — covers negative totals from modifiers). */
  readonly min: number | null;
  /** null means no upper bound. */
  readonly max: number | null;
}

export interface RingTestTableEffect {
  readonly type: 'ring-test-table';
  readonly table: readonly RingTestTableEntry[];
}

/** Gleaming Gold Ring: when the roll result is eligible for this category,
 *  the player may search deck and/or discard pile instead of playing from hand. */
export interface RingTestSearchEffect {
  readonly type: 'ring-test-search';
  readonly category: RingCategory;
}
```

Add both to the `CardEffect` union and document them in `docs/card-effects-dsl.md`.

### 2. Ring category keyword on special ring cards

Add the appropriate category string to each special ring card's `keywords` array.

```json
// tw-266 — add "lesser-ring"
"keywords": ["ring", "lesser-ring"]

// le-324 — add "lesser-ring"
"keywords": ["ring", "lesser-ring"]

// tw-274 — add "magic-ring"
"keywords": ["ring", "magic-ring"]

// as-123, as-124 — add "dwarven-ring"
"keywords": ["ring", "dwarven-ring"]

// tw-347 — add "the-one-ring"
"keywords": ["ring", "the-one-ring"]
```

### 3. Track character in `gold-ring-test` pending resolution

Add `characterInstanceId` to the pending kind so the ring can be placed on the
correct bearer after the roll.

```typescript
// packages/shared/src/types/pending.ts — existing gold-ring-test kind

readonly type: 'gold-ring-test';
readonly goldRingInstanceId: CardInstanceId;
readonly rollModifier: number;
readonly characterInstanceId: CardInstanceId;  // NEW
```

Update both creation sites:

- `reducer-organization.ts:493` — store-item path (character tapping to store)
- `reducer-site.ts:1334` — site-phase play path (character that played the ring)

### 4. New pending resolution: `ring-play-offer`

Queued by `applyGoldRingTestResolution` after the roll, before dequeuing the
`gold-ring-test` resolution. Carries precomputed eligible categories so the
legal-actions handler does not need to re-read the discarded gold ring.

```typescript
// packages/shared/src/types/pending.ts

{
  readonly type: 'ring-play-offer';
  /** Character who bore the gold ring — receives the replacement ring. */
  readonly characterInstanceId: CardInstanceId;
  /** Categories matching the roll result. */
  readonly eligibleCategories: readonly RingCategory[];
  /** Categories for which deck/discard search is allowed (Gleaming Gold Ring). */
  readonly searchableCategories: readonly RingCategory[];
  /** Roll total (for log display). */
  readonly rollTotal: number;
  /** If true, the ring comes into play stored (Rule 9.22 Darkhaven path). */
  readonly storedPlacement: boolean;
}
```

### 5. New action: `play-ring-after-test`

```typescript
// packages/shared/src/types/actions-organization.ts

export interface PlayRingAfterTestAction {
  readonly type: 'play-ring-after-test';
  readonly player: PlayerId;
  /** Instance of the special ring to play, or null to skip. */
  readonly ringInstanceId: CardInstanceId | null;
}
```

For the Gleaming Gold Ring deck/discard search path, a separate action type may
be needed (`search-ring-after-test`) that triggers a deck-search flow. This is
deferred and noted in the data file as a TODO.

### 6. Legal-actions handler (pending.ts)

Add a `ringPlayOfferActions()` function:

1. Find the player's hand.
2. For each hand card: check it has a ring-category keyword that appears in
   `eligibleCategories`.
3. Check alignment: ring's alignment must match the gold ring's alignment.
   Fallen-wizard exception is not in scope — enforce alignment match for now.
4. Return one `play-ring-after-test` per eligible card, plus one pass option
   (`ringInstanceId: null`).

### 7. Reducer: `applyRingPlayOffer`

Add a handler in `pending-reducers.ts`:

1. Validate `action.type === 'play-ring-after-test'`.
2. If `ringInstanceId` is null: dequeue only — player skips.
3. Otherwise:
   a. Locate the ring instance in the player's hand (error if not found).
   b. Verify the ring has an eligible category keyword (server-side guard).
   c. Remove the ring from hand.
   d. If `storedPlacement`: attach ring to character in stored state.
      Else: attach ring to character normally.
   e. Dequeue the `ring-play-offer` resolution.
   f. Log a `card-played` game effect.

### 8. Update `applyGoldRingTestResolution`

After logging the roll and discarding the gold ring:

1. Look up the discarded ring card's `ring-test-table` effect from `state.cardPool`.
2. Compute `eligibleCategories` from the table using `rollTotal`.
3. Compute `searchableCategories` from any `ring-test-search` effects.
4. Always enqueue a `ring-play-offer` (even when hand has no matches — player
   still needs to explicitly pass to acknowledge the resolution).
5. Then dequeue `gold-ring-test`.

---

## Data Changes

### tw-196 — Beautiful Gold Ring

```json
"effects": [
  {
    "type": "ring-test-table",
    "table": [
      { "category": "lesser-ring", "min": null, "max": null },
      { "category": "magic-ring",  "min": 1,    "max": 7    },
      { "category": "dwarven-ring","min": 10,   "max": null },
      { "category": "the-one-ring","min": 12,   "max": null }
    ]
  }
]
```

### tw-306 — Precious Gold Ring

```json
"effects": [
  {
    "type": "ring-test-table",
    "table": [
      { "category": "lesser-ring", "min": null, "max": null },
      { "category": "magic-ring",  "min": 1,    "max": 5    },
      { "category": "dwarven-ring","min": 8,    "max": null },
      { "category": "the-one-ring","min": 10,   "max": null }
    ]
  }
]
```

### le-315 — The Least of Gold Rings *(already certified — add effect)*

```json
// Add to existing effects array alongside on-event and storable-at:
{
  "type": "ring-test-table",
  "table": [
    { "category": "lesser-ring", "min": null, "max": null },
    { "category": "magic-ring",  "min": 1,    "max": 7    },
    { "category": "dwarven-ring","min": 10,   "max": null },
    { "category": "the-one-ring","min": 12,   "max": null }
  ]
}
```

### le-311 — Gleaming Gold Ring

```json
"effects": [
  {
    "type": "ring-test-table",
    "table": [
      { "category": "lesser-ring", "min": null, "max": null },
      { "category": "magic-ring",  "min": 1,    "max": 6    },
      { "category": "dwarven-ring","min": 9,    "max": null },
      { "category": "spirit-ring", "min": 10,   "max": null }
    ]
  },
  {
    "type": "ring-test-search",
    "category": "lesser-ring"
  }
]
```

*Note: `spirit-ring` has no cards in the database yet. The effect is encoded for
completeness; the legal-actions handler will simply find no eligible cards.*

---

## Tests

### Rule 9.21 — `rule-9.21-gold-ring-test.test.ts`

Replace the existing todo with:

1. **Roll yields one eligible category, player plays matching ring** — Gold ring tested, roll matches one category, hand contains that ring; verify ring moves from hand to character, gold ring discarded.
2. **Roll yields multiple eligible categories, player chooses** — Roll matches both `lesser-ring` and `magic-ring`; verify both options offered, player can play either.
3. **Roll yields eligible category, player passes** — Player holds eligible ring but passes; verify gold ring discarded, hand unchanged.
4. **No eligible ring in hand** — Roll matches `magic-ring`, hand has no magic rings; verify only pass offered, gold ring still discarded.
5. **Roll total matches no table row** — Edge case; verify only pass offered, gold ring discarded.

### Rule 9.22 — `rule-9.22-gold-ring-darkhaven-test.test.ts`

1. **Darkhaven auto-test with −2** — Gold ring stored at Darkhaven; verify `gold-ring-test` enqueued with `rollModifier: -2`.
2. **Special ring from Darkhaven test comes into play stored** — Verify the placed ring has stored state on the character.

### tw-266 — `tw-266.test.ts` (PR #637)

Add:

- **Play via gold ring test** — Set up `ring-play-offer` pending with `lesser-ring` eligible; verify `play-ring-after-test` is legal and places ring on character.
- **Play condition enforced** — Verify Lesser Ring cannot be played via normal site-phase item play.

### tw-274 — `tw-274.test.ts` (PR #638)

Add:

- **Play via gold ring test** — Set up `ring-play-offer` pending with `magic-ring` eligible; verify `play-ring-after-test` is legal and places ring on character.
- **Play condition enforced** — Verify Magic Ring of Stealth cannot be played outside a gold ring test context.

### Additional card tests (certifiable after mechanic is in place)

| Card | Test file | Notes |
|---|---|---|
| tw-347 The One Ring | `tw-347.test.ts` | Play via ring-play-offer (`the-one-ring` eligible) |
| le-324 Minor Ring | `le-324.test.ts` | Play via ring-play-offer (`lesser-ring` eligible, ringwraith alignment) |
| as-123 Dwarven Ring of Thélor's Tribe | `as-123.test.ts` | Play via ring-play-offer (`dwarven-ring` eligible) |
| as-124 Dwarven Ring of Thrár's Tribe | `as-124.test.ts` | Same as as-123 |
| le-311 Gleaming Gold Ring | `le-311.test.ts` | ring-test-table + ring-test-search; spirit-ring slot has no eligible cards |

---

## PR Finalization Steps

### PR #637 — Lesser Ring (tw-266)

1. Push new commits on the existing branch (no rebase/amend).
2. Implement the full `ring-play-offer` mechanic (types, data, engine, legal actions, reducer).
3. Add `lesser-ring` keyword to tw-266 data; add `ring-test-table` to tw-306 (and tw-196).
4. Expand `tw-266.test.ts` with ring-play-offer and play-condition tests.
5. Update PR title/body to remove `NOT CERTIFIED`; mark card as certified.

### PR #638 — Magic Ring of Stealth (tw-274)

1. Push new commit on the existing branch, on top of (or after merging) the
   engine work from PR #637.
2. Add `magic-ring` keyword to tw-274 data.
3. Add play-via-test and play-condition tests to `tw-274.test.ts`.
4. Update PR title/body to remove `NOT CERTIFIED`; mark card as certified.

---

## Implementation Order

1. New types: `RingCategory`, `RingTestTableEffect`, `RingTestSearchEffect`,
   `ring-play-offer` pending kind, `PlayRingAfterTestAction`.
2. Data: add `ring-test-table` (and `ring-test-search` for le-311) effects to
   all four gold ring cards; add category keywords to all special ring cards.
3. Engine: add `characterInstanceId` to `gold-ring-test` pending kind; update
   both creation sites.
4. Engine: implement `ringPlayOfferActions()` in `legal-actions/pending.ts`.
5. Engine: implement `applyRingPlayOffer()` in `pending-reducers.ts`; update
   `applyGoldRingTestResolution` to enqueue it.
6. Tests: implement Rule 9.21 and 9.22 rule tests; extend tw-266 and tw-274
   card tests.
7. DSL docs: document `ring-test-table` and `ring-test-search` in
   `docs/card-effects-dsl.md`.
8. Finalize PR #637 and PR #638.
