/**
 * @module le-324.test
 *
 * Card test: Minor Ring (le-324)
 * Type: minion-resource-item (subtype: special)
 * Corruption: 1, Marshalling Points: 2
 * Keywords: ring, lesser-ring
 *
 * "Lesser Ring. Playable only with a gold ring and after a test indicates
 *  a Lesser Ring. +2 to direct influence. Cannot be duplicated on a given
 *  character."
 *
 * Engine support:
 * | # | Feature                                          | Status      | Notes                                             |
 * |---|--------------------------------------------------|-------------|---------------------------------------------------|
 * | 1 | +1 corruption point to bearer                    | IMPLEMENTED | itemDef.corruptionPoints summed in recomputeDerived|
 * | 2 | +2 to direct influence (unconditional)           | IMPLEMENTED | stat-modifier direct-influence +2                 |
 * | 3 | Playable via gold ring test (lesser-ring keyword)| IMPLEMENTED | ring-play-offer checks card keywords for category |
 * | 4 | Cannot be duplicated on a given character        | IMPLEMENTED | duplication-limit scope:character; ring-play-offer|
 * |   |                                                  |             | also checks this limit before offering the ring   |
 *
 * Fixture alignment: minion (ringwraith) — uses minion characters and sites
 * from the LE set.
 *
 * Character fixtures:
 *   - GORBAG  (le-11): orc, warrior+scout, DI 0
 *   - SHAGRAT (le-39): orc, warrior+ranger, DI 0
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

const MINOR_RING = 'le-324' as CardDefinitionId;

// Minion character fixtures — declared locally per card-ids.ts constants policy
const GORBAG = 'le-11' as CardDefinitionId;   // orc, warrior+scout, DI 0
const SHAGRAT = 'le-39' as CardDefinitionId;  // orc, warrior+ranger, DI 0

// Minion site fixtures
const DOL_GULDUR = 'le-367' as CardDefinitionId;    // haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // haven
const ETTENMOORS = 'le-373' as CardDefinitionId;    // ruins-and-lairs
const BANDIT_LAIR = 'le-351' as CardDefinitionId;   // ruins-and-lairs

describe('Minor Ring (le-324)', () => {
  beforeEach(() => resetMint());

  // ─── Effect: +1 corruption points on bearer ───────────────────────────────

  test('bearer gains +1 effective corruption points while ring is held', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [BANDIT_LAIR] },
      ],
    });

    expect(getCharacter(base, RESOURCE_PLAYER, GORBAG).effectiveStats.corruptionPoints).toBe(0);

    const withRing = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, GORBAG, MINOR_RING));
    expect(getCharacter(withRing, RESOURCE_PLAYER, GORBAG).effectiveStats.corruptionPoints).toBe(1);
  });

  // ─── Effect: +2 to direct influence ──────────────────────────────────────

  test('bearer gains +2 effective direct influence while ring is held (Gorbag 0 → 2)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [{ defId: GORBAG, items: [MINOR_RING] }] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [BANDIT_LAIR] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, GORBAG).effectiveStats.directInfluence).toBe(2);
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

  // ─── Playability: ring-play-offer offers the ring when lesser-ring eligible ─

  test('ring is offered in ring-play-offer when lesser-ring is in eligible categories', () => {
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
    const withRing = addCardToHand(base, RESOURCE_PLAYER, MINOR_RING);
    const withOffer = enqueueResolution(withRing, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Site },
      kind: {
        type: 'ring-play-offer',
        characterInstanceId: gorbagId,
        eligibleCategories: ['lesser-ring'],
        rollTotal: 5,
        storedPlacement: false,
      },
    });

    const playActions = viableActions(withOffer, PLAYER_1, 'play-ring-after-test');
    expect(playActions).toHaveLength(1);
  });

  test('ring is NOT offered in ring-play-offer when lesser-ring is not in eligible categories', () => {
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
    const withRing = addCardToHand(base, RESOURCE_PLAYER, MINOR_RING);
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

    // Only eligible category is magic-ring; Minor Ring is lesser-ring → not offered
    const playActions = viableActions(withOffer, PLAYER_1, 'play-ring-after-test');
    expect(playActions).toHaveLength(0);
  });

  // ─── Duplication-limit: cannot be duplicated on a given character ─────────

  test('ring-play-offer does NOT offer Minor Ring for character who already bears one', () => {
    // Gorbag already holds a Minor Ring; a second one is in hand.
    // The ring-play-offer targets Gorbag — the duplication-limit must
    // block the second copy from being offered.
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
    const withAttached = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, MINOR_RING);
    const withInHand = addCardToHand(withAttached, RESOURCE_PLAYER, MINOR_RING);
    const withOffer = enqueueResolution(withInHand, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Site },
      kind: {
        type: 'ring-play-offer',
        characterInstanceId: gorbagId,
        eligibleCategories: ['lesser-ring'],
        rollTotal: 5,
        storedPlacement: false,
      },
    });

    // Gorbag already has one Minor Ring → second one must not be offered
    const playActions = viableActions(withOffer, PLAYER_1, 'play-ring-after-test');
    expect(playActions).toHaveLength(0);
  });

  test('ring-play-offer DOES offer Minor Ring for character who does not bear one', () => {
    // Shagrat (PLAYER_1's second company or a company at a different site)
    // has no Minor Ring yet. The offer targets Gorbag who also has none.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: DOL_GULDUR, characters: [GORBAG] },
          ],
          hand: [],
          siteDeck: [ETTENMOORS],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [BANDIT_LAIR] },
      ],
    });

    const gorbagId = charIdAt(base, RESOURCE_PLAYER);
    const withInHand = addCardToHand(base, RESOURCE_PLAYER, MINOR_RING);
    const withOffer = enqueueResolution(withInHand, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Site },
      kind: {
        type: 'ring-play-offer',
        characterInstanceId: gorbagId,
        eligibleCategories: ['lesser-ring'],
        rollTotal: 5,
        storedPlacement: false,
      },
    });

    // Gorbag has no Minor Ring yet → offer is available
    const playActions = viableActions(withOffer, PLAYER_1, 'play-ring-after-test');
    expect(playActions).toHaveLength(1);
  });

  test('duplication allows Minor Ring on a different character while first character already bears one', () => {
    // Gorbag already has a Minor Ring. A ring-play-offer targets Shagrat
    // (who has no Minor Ring yet), so the second copy CAN be offered.
    // PLAYER_2 uses le-31 (Orc Captain, non-unique) to avoid a uniqueness
    // conflict with PLAYER_1's Shagrat.
    const ORC_CAPTAIN = 'le-31' as CardDefinitionId;
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
    const withGorbagRing = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, MINOR_RING);
    const withInHand = addCardToHand(withGorbagRing, RESOURCE_PLAYER, MINOR_RING);
    // Offer targets Shagrat (not Gorbag), so the duplication on Gorbag is irrelevant
    const withOffer = enqueueResolution(withInHand, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Site },
      kind: {
        type: 'ring-play-offer',
        characterInstanceId: shagratId,
        eligibleCategories: ['lesser-ring'],
        rollTotal: 5,
        storedPlacement: false,
      },
    });

    // Shagrat has no Minor Ring → second copy can be offered for Shagrat
    const playActions = viableActions(withOffer, PLAYER_1, 'play-ring-after-test');
    expect(playActions).toHaveLength(1);
  });
});
