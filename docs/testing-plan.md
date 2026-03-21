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

## Implementation States

- **Implemented rules** (Setup, Untap) → real passing `test()` calls
- **Unimplemented rules** → `test.todo()` serving as a living specification
- Shows exactly what's left to build at any time via `npm test` output

## Card Tests (Nightly)

One test per card that has effects or special rules defined in its card data. Currently 41 cards have effects.

Each card test:
1. Builds a game state where the card's rules are triggered
2. Verifies the engine computes correct legal actions or stat modifications
3. Tests all conditions/branches in the card's effects

Card tests are tagged for nightly runs (separate vitest config or `describe.concurrent`).

## What Gets Deleted

All 10 existing test files (108 tests):
- `packages/server/src/tests/init.test.ts`
- `packages/server/src/tests/legal-actions.test.ts`
- `packages/server/src/tests/effects-resolver.test.ts`
- `packages/server/src/tests/effective-stats.test.ts`
- `packages/server/src/tests/recompute-derived.test.ts`
- `packages/shared/src/tests/condition-matcher.test.ts`
- `packages/shared/src/tests/rules-engine.test.ts`
- `packages/shared/src/tests/format.test.ts`
- `packages/shared/src/tests/card-images.test.ts`
- `packages/shared/src/tests/alignment-rules.test.ts`

The `test-helpers.ts` file is kept and enhanced with more flexible game state builders.
