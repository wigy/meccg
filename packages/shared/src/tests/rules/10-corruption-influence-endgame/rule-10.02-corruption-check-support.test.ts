/**
 * @module rule-10.02-corruption-check-support
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.02: Corruption Check Support
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A resource player may tap one or more other characters in the same company as a character upon which a corruption check has been declared but not yet resolved in order to apply a +1 modification to the corruption check roll for each character tapped in this way, which is resolved when the corruption check itself resolves.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableFor, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, BILBO, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  CardStatus,
} from '../../test-helpers.js';
import type { CardInstanceId, FreeCouncilPhaseState, GameState } from '../../../index.js';
import type { SupportCorruptionCheckAction } from '../../../types/actions-universal.js';
import { enqueueCorruptionCheck } from '../../../engine/pending.js';
import { dispatch } from '../../test-helpers.js';

describe('Rule 10.02 — Corruption Check Support', () => {
  beforeEach(() => resetMint());

  test('Tap other characters in same company for +1 to corruption check roll each', () => {
    // Bilbo and Aragorn are in the same company. A corruption check has been
    // declared for Bilbo (pendingCheck). The engine must offer Aragorn as a
    // supporter (support-corruption-check). When Aragorn is tapped, no support
    // is available.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BILBO, ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const bilboInstId = base.players[RESOURCE_PLAYER].companies[0].characters[0];
    const aragornInstId = base.players[RESOURCE_PLAYER].companies[0].characters[1];

    const fcStateWithPending: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck: {
        characterId: bilboInstId,
        corruptionPoints: 0,
        corruptionModifier: 4,
        possessions: [],
        need: -3,
        explanation: 'test',
        supportCount: 0,
      },
    };

    const state = { ...base, phaseState: fcStateWithPending };
    const supports = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'support-corruption-check') as { action: SupportCorruptionCheckAction }[];

    expect(supports.some(a => a.action.supportingCharacterId === aragornInstId)).toBe(true);

    // When Aragorn is already tapped, he cannot support
    const tappedAragorn = {
      ...state,
      players: [
        {
          ...state.players[RESOURCE_PLAYER],
          characters: {
            ...state.players[RESOURCE_PLAYER].characters,
            [aragornInstId as string]: {
              ...state.players[RESOURCE_PLAYER].characters[aragornInstId],
              status: CardStatus.Tapped,
            },
          },
        },
        state.players[1],
      ],
    } as typeof state;

    const tappedSupports = viableFor(tappedAragorn, PLAYER_1)
      .filter(a => a.action.type === 'support-corruption-check');
    expect(tappedSupports).toHaveLength(0);
  });
  test('support for any check in a selectable-order batch is accepted, whichever card queued it', () => {
    // Two checks queued in the same scope by different cards, the player free
    // to take them in either order (CoE 7.1.1) and allowed to tap in support.
    // Supports are offered for both, and the reducer must accept both — it
    // matched siblings by source card while the offer matched them by scope,
    // so the support for the second check was rejected (m/p bench games).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BILBO, ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const [bilbo, aragorn, legolas] = base.players[RESOURCE_PLAYER].companies[0].characters;
    const queue = (state: GameState, characterId: CardInstanceId, source: CardInstanceId) => enqueueCorruptionCheck(state, {
      source, actor: PLAYER_1, scope: { kind: 'phase', phase: Phase.Organization },
      characterId, reason: 'test', selectableOrder: true, allowSupport: true,
    });
    const state = queue(queue(base, bilbo, 'source-a' as CardInstanceId), aragorn, 'source-b' as CardInstanceId);

    const supports = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'support-corruption-check')
      .map(a => a.action as SupportCorruptionCheckAction);
    const forSecond = supports.find(a => a.targetCharacterId === aragorn && a.supportingCharacterId === legolas);
    expect(forSecond).toBeDefined();

    const after = dispatch(state, forSecond!);
    expect(after.players[RESOURCE_PLAYER].characters[legolas].status).toBe(CardStatus.Tapped);
  });
});
