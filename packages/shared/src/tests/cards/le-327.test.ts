/**
 * @module le-327.test
 *
 * Card test: The Oracle's Ring (le-327)
 * Type: minion-resource-item (subtype: special)
 * Corruption: 2, Marshalling Points: 3
 * Keywords: ring, spirit-ring
 *
 * "Spirit Ring. Playable only with a gold ring and after a test indicates a
 *  Spirit Ring. -2 to bearer's mind (minimum of 1). +4 to bearer's direct
 *  influence. Cannot be duplicated on a given character."
 *
 * Engine support:
 * | # | Feature                                          | Status      | Notes                                             |
 * |---|--------------------------------------------------|-------------|---------------------------------------------------|
 * | 1 | -2 to bearer's mind (minimum of 1)               | IMPLEMENTED | stat-modifier mind -2 with min:1 floor            |
 * | 2 | +4 to bearer's direct influence (unconditional)  | IMPLEMENTED | stat-modifier direct-influence +4                 |
 * | 3 | Playable via gold ring test (spirit-ring keyword)| IMPLEMENTED | ring-play-offer checks card keywords for category |
 * | 4 | Cannot be duplicated on a given character        | IMPLEMENTED | duplication-limit scope:character; ring-play-offer|
 * |   |                                                  |             | also checks this limit before offering the ring   |
 *
 * Fixture alignment: minion (ringwraith) — uses minion characters and sites
 * from the LE set.
 *
 * Character fixtures:
 *   - GORBAG      (le-11): orc, mind 6, DI 0
 *   - SHAGRAT     (le-39): orc, mind 6, DI 0
 *   - ORC_VETERAN (le-35): orc, mind 2, DI 0 (used for the min-1 floor)
 *
 * Site fixtures:
 *   - DOL_GULDUR   (le-367): haven (minion)
 *   - MINAS_MORGUL (le-390): haven (minion)
 *   - ETTENMOORS   (le-373): ruins-and-lairs
 *   - BANDIT_LAIR  (le-351): ruins-and-lairs
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  attachItemToChar, addCardToHand,
  charIdAt, viableActions, RESOURCE_PLAYER,
  getCharacter,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';
import { Alignment } from '../../index.js';
import { enqueueResolution } from '../../engine/pending.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const ORACLES_RING = 'le-327' as CardDefinitionId;

// Minion character fixtures — declared locally per card-ids.ts constants policy
const GORBAG = 'le-11' as CardDefinitionId;       // orc, mind 6, DI 0
const SHAGRAT = 'le-39' as CardDefinitionId;      // orc, mind 6, DI 0
const ORC_VETERAN = 'le-35' as CardDefinitionId;  // orc, mind 2, DI 0 (non-unique)

// Minion site fixtures
const DOL_GULDUR = 'le-367' as CardDefinitionId;    // haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // haven
const ETTENMOORS = 'le-373' as CardDefinitionId;    // ruins-and-lairs
const BANDIT_LAIR = 'le-351' as CardDefinitionId;   // ruins-and-lairs

describe("The Oracle's Ring (le-327)", () => {
  beforeEach(() => resetMint());

  // ─── Effect: -2 to bearer's mind (minimum of 1) ──────────────────────────

  test('bearer mind is reduced by 2 while ring is held (Gorbag 6 → 4)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [BANDIT_LAIR] },
      ],
    });

    // No mind modifier without the ring → effective mind is left unset (printed 6).
    expect(getCharacter(base, RESOURCE_PLAYER, GORBAG).effectiveStats.mind).toBeUndefined();

    const withRing = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, GORBAG, ORACLES_RING));
    expect(getCharacter(withRing, RESOURCE_PLAYER, GORBAG).effectiveStats.mind).toBe(4);
  });

  test("mind floor keeps the bearer's mind at a minimum of 1 (Orc Veteran 2 → 1, not 0)", () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ORC_VETERAN] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [BANDIT_LAIR] },
      ],
    });

    const withRing = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ORC_VETERAN, ORACLES_RING));
    // 2 - 2 = 0, clamped up to the minimum of 1.
    expect(getCharacter(withRing, RESOURCE_PLAYER, ORC_VETERAN).effectiveStats.mind).toBe(1);
  });

  // ─── Effect: +4 to bearer's direct influence ─────────────────────────────

  test('bearer gains +4 effective direct influence while ring is held (Gorbag 0 → 4)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [{ defId: GORBAG, items: [ORACLES_RING] }] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [BANDIT_LAIR] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, GORBAG).effectiveStats.directInfluence).toBe(4);
  });

  test('direct influence not increased when ring is not held (Gorbag stays at 0)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [BANDIT_LAIR] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, GORBAG).effectiveStats.directInfluence).toBe(0);
  });

  // ─── Playability: ring-play-offer offers the ring when spirit-ring eligible ─

  test('ring is offered in ring-play-offer when spirit-ring is in eligible categories', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [BANDIT_LAIR] },
      ],
    });

    const gorbagId = charIdAt(base, RESOURCE_PLAYER);
    const withRing = addCardToHand(base, RESOURCE_PLAYER, ORACLES_RING);
    const withOffer = enqueueResolution(withRing, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Site },
      kind: {
        type: 'ring-play-offer',
        characterInstanceId: gorbagId,
        eligibleCategories: ['spirit-ring'],
        rollTotal: 9,
        storedPlacement: false,
      },
    });

    const playActions = viableActions(withOffer, PLAYER_1, 'play-ring-after-test');
    expect(playActions).toHaveLength(1);
  });

  test('ring is NOT offered in ring-play-offer when spirit-ring is not in eligible categories', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [BANDIT_LAIR] },
      ],
    });

    const gorbagId = charIdAt(base, RESOURCE_PLAYER);
    const withRing = addCardToHand(base, RESOURCE_PLAYER, ORACLES_RING);
    const withOffer = enqueueResolution(withRing, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Site },
      kind: {
        type: 'ring-play-offer',
        characterInstanceId: gorbagId,
        eligibleCategories: ['magic-ring'],
        rollTotal: 3,
        storedPlacement: false,
      },
    });

    // Only eligible category is magic-ring; The Oracle's Ring is spirit-ring → not offered
    const playActions = viableActions(withOffer, PLAYER_1, 'play-ring-after-test');
    expect(playActions).toHaveLength(0);
  });

  // ─── Duplication-limit: cannot be duplicated on a given character ─────────

  test('ring-play-offer does NOT offer the ring for a character who already bears one', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [BANDIT_LAIR] },
      ],
    });

    const gorbagId = charIdAt(base, RESOURCE_PLAYER);
    const withAttached = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, ORACLES_RING);
    const withInHand = addCardToHand(withAttached, RESOURCE_PLAYER, ORACLES_RING);
    const withOffer = enqueueResolution(withInHand, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Site },
      kind: {
        type: 'ring-play-offer',
        characterInstanceId: gorbagId,
        eligibleCategories: ['spirit-ring'],
        rollTotal: 9,
        storedPlacement: false,
      },
    });

    // Gorbag already has one Oracle's Ring → a second one must not be offered
    const playActions = viableActions(withOffer, PLAYER_1, 'play-ring-after-test');
    expect(playActions).toHaveLength(0);
  });

  test('duplication allows the ring on a different character while the first already bears one', () => {
    const ORC_CAPTAIN = 'le-31' as CardDefinitionId; // non-unique, avoids uniqueness conflict
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: DOL_GULDUR, characters: [GORBAG, SHAGRAT] },
          ],
          hand: [],
          siteDeck: [ETTENMOORS],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [ORC_CAPTAIN] }], hand: [], siteDeck: [BANDIT_LAIR] },
      ],
    });

    const shagratId = charIdAt(base, RESOURCE_PLAYER, 0, 1);
    const withGorbagRing = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, ORACLES_RING);
    const withInHand = addCardToHand(withGorbagRing, RESOURCE_PLAYER, ORACLES_RING);
    // Offer targets Shagrat (not Gorbag), so the duplication on Gorbag is irrelevant
    const withOffer = enqueueResolution(withInHand, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Site },
      kind: {
        type: 'ring-play-offer',
        characterInstanceId: shagratId,
        eligibleCategories: ['spirit-ring'],
        rollTotal: 9,
        storedPlacement: false,
      },
    });

    // Shagrat has no Oracle's Ring → the second copy can be offered for Shagrat
    const playActions = viableActions(withOffer, PLAYER_1, 'play-ring-after-test');
    expect(playActions).toHaveLength(1);
  });
});
