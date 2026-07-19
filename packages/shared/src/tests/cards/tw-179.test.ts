/**
 * @module tw-179.test
 *
 * Card test: Robin Smallburrow (tw-179)
 * Type: hero-character (hobbit, scout, prowess 1 / body 9 / mind 3)
 * Effects: 2 (check-modifier corruption +2, play-flag home-site-only)
 *
 * "Unique. Unless he is one of the starting characters, he may only be
 *  brought into play at his home site. All of his corruption checks are
 *  modified by +2."
 *
 * Same shape as Frodo (tw-152) minus the elimination mp-modifier: the
 * home-site-only play-flag confines him to Bag End when played from hand,
 * and the +2 corruption check-modifier softens his corruption checks.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  GLAMDRING,
  RIVENDELL, LORIEN,
  buildTestState, resetMint, mint,
  viablePlayCharacterActions,
  findCharInstanceId,
  enqueueTransferCorruptionCheck,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';
import { BAG_END } from '../../card-ids.js';

const ROBIN = 'tw-179' as CardDefinitionId;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Robin Smallburrow (tw-179)', () => {
  beforeEach(() => resetMint());

  test('corruption check modifier is +2 from check-modifier effect', () => {
    // Robin in play carrying Glamdring (2 CP); trigger a corruption check
    // and confirm the pending resolution carries the +2 modifier.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ROBIN, items: [GLAMDRING] }] }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const robinId = findCharInstanceId(state, RESOURCE_PLAYER, ROBIN);
    const fakeItemId = mint();
    const withPending = enqueueTransferCorruptionCheck(state, PLAYER_1, robinId, fakeItemId);

    const actions = computeLegalActions(withPending, PLAYER_1);
    const ccAction = actions.find(a => a.viable && a.action.type === 'corruption-check');
    expect(ccAction).toBeDefined();

    // Robin has Glamdring (1 CP), check-modifier +2
    // need = CP + 1 - modifier = 1 + 1 - 2 = 0 → any dice roll passes.
    const cc = ccAction!.action as { corruptionModifier: number; need: number };
    expect(cc.corruptionModifier).toBe(2);
    expect(cc.need).toBe(0);
  });

  test('can be played at Bag End (homesite)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [ROBIN],
          siteDeck: [BAG_END],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable.length).toBeGreaterThan(0);

    // Every viable play-character action must be at Bag End (from site deck).
    for (const action of viable) {
      const siteInst = state.players[0].siteDeck.find(c => c.instanceId === action.atSite);
      expect(siteInst).toBeDefined();
      const siteDef = state.cardPool[siteInst!.definitionId];
      expect((siteDef as { name: string }).name).toBe('Bag End');
    }
  });

  test('cannot be played at a haven in the site deck (home-site-only restriction)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [ROBIN],
          siteDeck: [RIVENDELL, LORIEN],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    // Havens are available but Robin may only be played at his home site.
    expect(viable).toHaveLength(0);
  });

  test('cannot be played at a haven even where the company already sits', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [ROBIN],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable).toHaveLength(0);
  });
});
