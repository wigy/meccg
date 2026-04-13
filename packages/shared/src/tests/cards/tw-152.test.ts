/**
 * @module tw-152.test
 *
 * Card test: Frodo (tw-152)
 * Type: hero-character
 * Effects: 2 (play-restriction home-site-only, mp-modifier -2 on elimination)
 *
 * "Unique. Unless he is one of the starting characters, he may only be
 *  brought into play at his home site. All of his corruption checks are
 *  modified by +4. -2 marshalling points if eliminated."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  FRODO, ARAGORN, LEGOLAS,
  GLAMDRING,
  RIVENDELL, LORIEN,
  buildTestState, resetMint, pool, mint,
  viablePlayCharacterActions,
  findCharInstanceId,
  enqueueTransferCorruptionCheck,
  dispatch,
} from '../test-helpers.js';
import { computeLegalActions, Phase } from '../../index.js';
import type { CharacterCard, CardInstanceId } from '../../index.js';
import { BAG_END } from '../../card-ids.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Frodo (tw-152)', () => {
  beforeEach(() => resetMint());

  test('card definition has correct stats and effects', () => {
    const def = pool[FRODO as string] as CharacterCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hero-character');
    expect(def.name).toBe('Frodo');
    expect(def.race).toBe('hobbit');
    expect(def.unique).toBe(true);
    expect(def.prowess).toBe(1);
    expect(def.body).toBe(9);
    expect(def.mind).toBe(5);
    expect(def.directInfluence).toBe(1);
    expect(def.marshallingPoints).toBe(2);
    expect(def.corruptionModifier).toBe(4);
    expect(def.homesite).toBe('Bag End');
    expect(def.effects).toHaveLength(2);
    expect(def.effects![0]).toEqual({
      type: 'play-flag',
      flag: 'home-site-only',
      when: { $not: { reason: 'starting-character' } },
    });
    expect(def.effects![1]).toEqual({
      type: 'mp-modifier',
      value: -2,
      when: { reason: 'elimination' },
    });
  });

  test('corruption check modifier is +4 from corruptionModifier field', () => {
    // Set up Frodo in play with an item that gives corruption points,
    // then trigger a corruption check via pending check in organization phase.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: FRODO, items: [GLAMDRING] }] }],
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

    const frodoId = findCharInstanceId(state, 0, FRODO);
    // Mint a fake transferred item ID to trigger pending corruption check
    const fakeItemId = mint();
    const withPending = enqueueTransferCorruptionCheck(state, PLAYER_1, frodoId, fakeItemId);

    const actions = computeLegalActions(withPending, PLAYER_1);
    const ccAction = actions.find(a => a.viable && a.action.type === 'corruption-check');
    expect(ccAction).toBeDefined();

    // Frodo has Glamdring (2 CP), corruptionModifier +4
    // need = CP + 1 - modifier = 2 + 1 - 4 = -1
    // Any roll passes (min dice roll 2 > -1)
    const cc = ccAction!.action as { corruptionModifier: number; need: number };
    expect(cc.corruptionModifier).toBe(4);
    expect(cc.need).toBeLessThanOrEqual(2); // easy pass with +4 modifier
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
          hand: [FRODO],
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

    // All viable play-character actions should be at Bag End (from site deck)
    for (const action of viable) {
      const siteInst = state.players[0].siteDeck.find(c => c.instanceId === action.atSite);
      expect(siteInst).toBeDefined();
      const siteDef = state.cardPool[siteInst!.definitionId as string];
      expect((siteDef as { name: string }).name).toBe('Bag End');
    }
  });

  test('cannot be played at a haven (home-site-only restriction)', () => {
    // Frodo is in hand, only havens available (no Bag End in site deck)
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [FRODO],
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
    // Even though there are havens available, Frodo cannot be played there
    expect(viable).toHaveLength(0);
  });

  test('cannot be played at haven even when company is at a haven', () => {
    // Frodo in hand, Aragorn at Rivendell — Frodo should NOT be playable
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [FRODO],
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

  test('home-site-only flag has condition excluding starting characters', () => {
    // The flag's when clause excludes the "starting-character" reason,
    // so starting characters bypass it (placed at haven during setup).
    const def = pool[FRODO as string] as CharacterCard;
    const flag = def.effects!.find(e => e.type === 'play-flag');
    expect(flag).toBeDefined();
    expect(flag!.when).toEqual({ $not: { reason: 'starting-character' } });
  });

  test('-2 marshalling points when eliminated', () => {
    // Use a minimal state with no characters in play to isolate the MP effect
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [],
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

    // Manually place Frodo in the eliminated pile
    const frodoInst = { instanceId: 'inst-frodo-elim' as CardInstanceId, definitionId: FRODO };
    const withElim = {
      ...state,
      players: [
        {
          ...state.players[0],
          outOfPlayPile: [frodoInst],
        },
        state.players[1],
      ] as typeof state.players,
    };

    // Trigger a recompute by running a pass action in organization
    const nextState = dispatch(withElim, { type: 'pass', player: PLAYER_1 });

    // Frodo in eliminated pile contributes -2 character MP
    expect(nextState.players[0].marshallingPoints.character).toBe(-2);
  });
});
