# Testing Plan: Rules-as-Specification

## Philosophy

Delete all unit tests. Replace with two categories of tests that directly verify game correctness:

1. **Rules tests** — Every sentence in the official CoE rules becomes a test
2. **Card tests (nightly)** — One test per card that has special rules

All tests follow the same pattern: build a valid game state, check that the engine computes correct legal actions forward.

## Why This Works

- The engine is a pure reducer: `(state, action) → state` — no mocks, no side effects
- Legal actions are the engine's only output — if they're correct, the engine is correct
- Seeded RNG makes dice rolls deterministic — combat/corruption tests are reproducible
- If internal utilities break (condition matcher, formatting), the rules tests catch it

## Structure

```
packages/server/src/tests/
  rules/                              # Official CoE rules tests
    helpers/
      test-helpers.ts                 # Game state builders, constants
    01-getting-ready.test.ts          # Section 1: deck construction, draft, starting company
    02-untap-phase.test.ts            # Section 2.I
    03-organization-phase.test.ts     # Section 2.II
    04-long-event-phase.test.ts       # Section 2.III
    05-movement-hazard.test.ts        # Section 2.IV
    06-site-phase.test.ts             # Section 2.V
    07-end-of-turn.test.ts            # Section 2.VI
    08-combat.test.ts                 # Section 3
    09-agents.test.ts                 # Section 4
    10-events.test.ts                 # Section 5
    11-items-rings.test.ts            # Section 6
    12-corruption.test.ts             # Section 7
    13-influence.test.ts              # Section 8
    14-actions-timing.test.ts         # Section 9
    15-ending-game.test.ts            # Section 10
  cards/                              # Card-specific tests (nightly)
    tw-characters.test.ts
    tw-items.test.ts
    tw-creatures.test.ts
    le-characters.test.ts
    ...
```

## Rules Source

Official Council of Elrond rules: https://www.councilofelrond.org/rules/

Estimated scope from the rules document:
- Section 1 (Getting Ready): ~80 rules
- Section 2 (Turn Phases): ~120 rules
- Sections 3-11 (Combat, Agents, Events, Items, Corruption, Influence, Timing, Endgame): ~150-200 rules
- **Total: ~350-400 test cases**

## Test Pattern

Each rule becomes a test or test.todo:

```typescript
// [2.II.3.1] Haven companies unlimited size; non-haven companies maximum seven characters.
test('[2.II.3.1] non-haven company limited to 7 characters', () => {
  const state = buildState()
    .atSite(MORIA)                    // non-haven
    .withCompany(ARAGORN, LEGOLAS, GIMLI, FARAMIR, EOWYN, BEREGOND, BILBO) // 7 chars
    .inPhase(Phase.Organization)
    .build();

  const actions = getLegalActions(state, PLAYER_1);
  // Should NOT allow adding an 8th character to this company
  expect(actions.viable).not.toContainEqual(
    expect.objectContaining({ type: 'play-character', companyId: '...' })
  );
});

// [3.I.2] Not yet implemented
test.todo('[3.I.2] body check: attacker rolls 2d6, if > body character is eliminated');
```

## Progress Tracker

| # | File | Rules Section | Pass | Todo | Total | Status |
|---|------|--------------|------|------|-------|--------|
| 01 | `01-getting-ready.test.ts` | 1: Deck, draft, sites, hands, influence, initiative | 18 | 2 | 20 | Mostly done |
| 02 | `02-untap-phase.test.ts` | 2.I: Untap phase | 3 | 4 | 7 | Partial |
| 03 | `03-organization-phase.test.ts` | 2.II: Characters, companies, items, movement | 0 | 30 | 30 | Not started |
| 04 | `04-long-event-phase.test.ts` | 2.III: Long events | 0 | 3 | 3 | Not started |
| 05 | `05-movement-hazard-phase.test.ts` | 2.IV: Movement, hazards, on-guard | 0 | 29 | 29 | Not started |
| 06 | `06-site-phase.test.ts` | 2.V: Entering sites, playing resources | 0 | 24 | 24 | Not started |
| 07 | `07-end-of-turn.test.ts` | 2.VI: End of turn | 0 | 3 | 3 | Not started |
| 08 | `08-combat.test.ts` | 3: Strikes, prowess, body checks, detainment, CvCC | 0 | 45 | 45 | Not started |
| 09 | `09-agents.test.ts` | 4: Agent actions and reveal | 0 | 15 | 15 | Not started |
| 10 | `10-events.test.ts` | 5: Short/long/permanent events | 0 | 10 | 10 | Not started |
| 11 | `11-items-rings.test.ts` | 6: Items, rings, hoard | 0 | 12 | 12 | Not started |
| 12 | `12-corruption.test.ts` | 7: Corruption checks and cards | 0 | 14 | 14 | Not started |
| 13 | `13-influence.test.ts` | 8: Influence attempts | 0 | 17 | 17 | Not started |
| 14 | `14-actions-timing.test.ts` | 9: Actions, conditions, chains | 0 | 16 | 16 | Not started |
| 15 | `15-ending-game.test.ts` | 10: Free Council, MP tallying, endgame | 0 | 17 | 17 | Not started |
| | **TOTAL** | | **21** | **241** | **262** | **8% done** |

### Card Tests (Nightly)

| File | Cards | Pass | Todo | Status |
|------|-------|------|------|--------|
| `tw-characters.test.ts` | 17 cards with effects | 0 | 0 | Not started |
| `tw-items.test.ts` | 6 cards with effects | 0 | 0 | Not started |
| `tw-creatures.test.ts` | TBD | 0 | 0 | Not started |
| `tw-resources.test.ts` | 6 cards with effects | 0 | 0 | Not started |
| Other sets | TBD | 0 | 0 | Not started |

## Test Pattern

Each rule becomes a test or test.todo:

```typescript
// [2.II.3.1] Haven companies unlimited size; non-haven companies maximum seven characters.
test('[2.II.3.1] non-haven company limited to 7 characters', () => {
  const state = buildState()
    .atSite(MORIA)                    // non-haven
    .withCompany(ARAGORN, LEGOLAS, GIMLI, FARAMIR, EOWYN, BEREGOND, BILBO) // 7 chars
    .inPhase(Phase.Organization)
    .build();

  const actions = getLegalActions(state, PLAYER_1);
  // Should NOT allow adding an 8th character to this company
  expect(actions.viable).not.toContainEqual(
    expect.objectContaining({ type: 'play-character', companyId: '...' })
  );
});

// [3.I.2] Not yet implemented
test.todo('[3.I.2] body check: attacker rolls 2d6, if > body character is eliminated');
```
