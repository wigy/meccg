# Deck Validation — Spec

## Goal

Provide a `validateDeck(deck, pool)` function that returns a list of structured
errors. Each error carries a **section** field so callers can route it to the
correct panel of the deck editor UI, and a human-readable message for display
in the text log or tooltip.

## Error Shape

```typescript
interface DeckValidationError {
  /** Which part of the deck this error belongs to. */
  section: DeckSection;
  /** Human-readable explanation of the violation. */
  message: string;
  /**
   * The card ID that triggered the error, if applicable.
   * Absent for structural/count errors that don't point to a single card.
   */
  card?: CardDefinitionId;
}

type DeckSection =
  | 'general'    // structural / missing section
  | 'characters' // play deck characters section (and pool characters)
  | 'resources'  // play deck resources section
  | 'hazards'    // play deck hazards section
  | 'sites'      // location deck
  | 'pool'       // starting pool (non-character cards)
  | 'sideboard'; // sideboard
```

## Function Signature

```typescript
/**
 * Validate a DeckList against CoE deck-construction rules.
 *
 * @param deck  The deck to validate.
 * @param pool  Card definition lookup keyed by CardDefinitionId.
 * @returns     Array of structured errors. Empty array → deck is valid.
 */
export function validateDeck(
  deck: DeckList,
  pool: Readonly<Record<string, CardDefinition>>,
): DeckValidationError[];
```

## Rules Checked

Each rule maps to one or more error objects. The table shows the section each
error is reported under so the deck editor can highlight the right panel.

| Rule  | Section     | Condition checked                                                              |
|-------|-------------|--------------------------------------------------------------------------------|
| 1.03  | general     | `deck.sites` array present                                                     |
| 1.03  | general     | `deck.pool` array present                                                      |
| 1.03  | general     | `deck.sideboard` array present                                                 |
| 1.03  | general     | `deck.deck` object present                                                     |
| 1.03  | characters  | `deck.deck.characters` array present                                           |
| 1.03  | hazards     | `deck.deck.hazards` array present                                              |
| 1.03  | resources   | `deck.deck.resources` array present                                            |
| 1.08  | characters  | Hero deck avatar characters must have `race === 'wizard'`                      |
| 1.09  | characters  | Hero deck non-avatar characters must have `cardType === 'hero-character'`      |
|       |             | (agents exempt — they count as hazards for hero decks)                        |
| 1.10  | resources   | Hero deck resources must be `hero-resource-*` or `minion-resource-item`        |
| 1.11  | characters  | Minion deck avatar characters must have `race === 'ringwraith'`                |
| 1.12  | characters  | Minion deck non-avatar characters must have `cardType === 'minion-character'`  |
| 1.13  | resources   | Minion deck resources must be `minion-resource-*` or `hero-resource-item`      |
| 1.24  | sites       | Non-haven sites must appear at most once in the location deck                  |
| 1.26  | sites       | Hero location deck: sites must be `hero-site` or `balrog-site`                 |
| 1.27  | sites       | Minion location deck: sites must be `minion-site` or `balrog-site`             |
| 1.30  | resources   | Play deck resources: 30 ≤ count ≤ 50                                           |
| 1.30  | hazards     | Play deck: at least 12 creatures in hazards (full creature cards only)         |
| 1.30  | characters  | Play deck: at most 10 non-avatar characters                                    |
| 1.31  | sideboard   | Sideboard: at most 30 cards (Short Game max)                                   |

### Notes on `characters` section scope

Rules 1.09 and 1.12 apply to both `deck.deck.characters` **and** `deck.pool`
(characters can live in either). When an error is found in `deck.pool`, the
section is still reported as `'characters'` because the pool and characters
panel are managed together in the editor.

## Export

`validateDeck` is exported from `packages/shared/src/index.ts` so game-server
and lobby-server can both import it without circular dependencies.

`DeckValidationError` and `DeckSection` are exported as types from the same
entry point.

## Deck Editor Integration

The editor UI groups cards into panels that correspond directly to `DeckSection`
values. When `validateDeck` returns errors:

- Errors with a `section` value render inline in that panel (e.g. a red badge
  on the Resources panel header showing the count of resource errors).
- If `card` is set, the specific row for that card is highlighted in the panel.
- `'general'` errors appear in a top-level banner above all panels.

## Text Log Integration (Game Server)

When a player submits a deck that fails validation, the game server must log
**all** errors to both players' text logs before rejecting the deck:

```text
Deck validation failed for Alice (5 errors):
  [characters] hero deck: avatar "tw-001" (Gandalf) must be a Wizard (race is "ringwraith")
  [resources]  play deck: only 24 resources (min 30)
  [hazards]    play deck: only 8 creatures in hazards (min 12)
  [sites]      hero deck: site "le-001" (Minas Morgul) has cardType "minion-site" — must be hero-site or balrog-site
  [sideboard]  sideboard: 35 cards (max 30 for Short Game)
```

The section label in square brackets is the `section` field. Message text is
the `message` field verbatim.

## Tests

Each rule in the table above gets its own `test()` block in
`packages/shared/src/tests/rules/01-deck-construction/`. Tests build a minimal
deliberately-invalid deck fixture, call `validateDeck`, and assert:

1. The returned array is non-empty.
2. The error has the expected `section`.
3. The error `message` contains a meaningful substring (not an exact match —
   enough to identify the violated rule).
4. A matching valid deck returns an empty array.

Sample fixture shape for an invalid deck (no card database required for
structural tests):

```typescript
const deck: DeckList = {
  id: 'test-deck',
  name: 'Test',
  alignment: 'hero',
  pool: [],
  sideboard: [],
  sites: [],
  deck: {
    characters: [],
    hazards: [],
    resources: [],
  },
};
```

For tests that check card-type rules, load the real card pool via
`loadCardPool()` and reference real card IDs known to violate the rule.
