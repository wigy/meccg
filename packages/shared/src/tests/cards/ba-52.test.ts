/**
 * @module ba-52.test
 *
 * Card test: Challenge the Power (ba-52)
 * Type: minion-resource-event (permanent, balrog alignment)
 * Effects:
 *   1. play-target: character (the avatar) bearing The One Ring
 *   2. on-event: self-enters-play → win-condition-roll — on play, roll 2d6
 *      (+1 per sage in his company, +1 per other Challenge the Power in play):
 *      <7 eliminates the avatar; 7–8 discards this card; 9–10 keep (the card's
 *      2 MP stand for "gain 2 marshalling points"); >10 wins the game
 *      (CoE rule 10.39).
 *
 * Card text: "Balrog specific. Playable on The Balrog if he bears The One
 * Ring. Make a roll adding one for each sage in his company and for each other
 * Challenge the Power in play. If the result is: less than 7, The Balrog is
 * eliminated; 7 or 8, discard this card; 9 or 10, you gain 2 marshalling
 * points and The One Ring affects The Balrog; greater than 10, you win the
 * game."
 *
 * NOTE: The Balrog avatar character is not yet present in the card dataset, so
 * these tests stand in a ringwraith avatar (mind = null) in a balrog-aligned
 * player to exercise the shared win-condition-roll mechanism and recording.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, LORIEN, MORIA,
  resetMint, buildTestState, attachItemToChar, findCharInstanceId, handCardId,
  playPermanentEventAndResolve, viableActions,
  Phase, Alignment, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, GameOverPhaseState, GameState, SitePhaseState } from '../../index.js';

const CHALLENGE_THE_POWER = 'ba-52' as CardDefinitionId;
const THE_ONE_RING = 'tw-347' as CardDefinitionId;
const BALROG_STAND_IN = 'le-50' as CardDefinitionId; // ringwraith avatar (mind null) standing in for The Balrog
const MORIA_MINION = 'le-392' as CardDefinitionId;
const ARAGORN = 'tw-120' as CardDefinitionId;

/** Build a site-phase state with the balrog avatar (optionally bearing the Ring) and ba-52 in hand. */
const balrogSiteState = (opts: { withRing: boolean }): GameState => {
  let state: GameState = buildTestState({
    phase: Phase.Site,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Balrog,
        companies: [{ site: MORIA_MINION, characters: [BALROG_STAND_IN] }],
        hand: [CHALLENGE_THE_POWER],
        siteDeck: [MORIA],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: LORIEN, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MORIA],
      },
    ],
  });
  if (opts.withRing) {
    state = attachItemToChar(state, RESOURCE_PLAYER, BALROG_STAND_IN, THE_ONE_RING);
  }
  const sitePhaseState: SitePhaseState = {
    phase: Phase.Site,
    step: 'play-resources',
    activeCompanyIndex: 0,
    handledCompanyIds: [],
    siteEntered: true,
    resourcePlayed: false,
    minorItemAvailable: false,
    hoardBountyAvailable: false,
    thoroughSearchAvailable: false,
    declaredAgentAttack: null,
    automaticAttacksResolved: 0,
    awaitingOnGuardReveal: false,
    pendingResourceAction: null,
    opponentInteractionThisTurn: null,
    pendingOpponentInfluence: null,
  };
  return { ...state, phaseState: sitePhaseState };
};

/** Play ba-52 on the avatar and resolve the chain with a forced roll total. */
const playWithRoll = (state: GameState, roll: number): GameState => {
  const avatarId = findCharInstanceId(state, RESOURCE_PLAYER, BALROG_STAND_IN);
  const cardId = handCardId(state, RESOURCE_PLAYER);
  return playPermanentEventAndResolve({ ...state, cheatRollTotal: roll }, PLAYER_1, cardId, avatarId);
};

describe('Challenge the Power (ba-52)', () => {
  beforeEach(() => resetMint());

  test('not playable on the avatar without The One Ring', () => {
    const state = balrogSiteState({ withRing: false });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('playable on the avatar bearing The One Ring', () => {
    const state = balrogSiteState({ withRing: true });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBeGreaterThanOrEqual(1);
  });

  test('roll > 10 wins the game', () => {
    const after = playWithRoll(balrogSiteState({ withRing: true }), 12);

    expect(after.phaseState.phase).toBe(Phase.GameOver);
    const go = after.phaseState as GameOverPhaseState;
    expect(go.winner).toBe(PLAYER_1);
    expect(go.winReason.kind).toBe('one-ring');
    if (go.winReason.kind === 'one-ring') {
      expect(go.winReason.alignment).toBe(Alignment.Balrog);
      expect(go.winReason.card).toBe(CHALLENGE_THE_POWER);
    }
  });

  test('roll 7–8 discards the card (no win, avatar survives)', () => {
    const state = balrogSiteState({ withRing: true });
    const avatarId = findCharInstanceId(state, RESOURCE_PLAYER, BALROG_STAND_IN);
    const after = playWithRoll(state, 8);

    expect(after.phaseState.phase).not.toBe(Phase.GameOver);
    const avatar = after.players[RESOURCE_PLAYER].characters[avatarId];
    expect(avatar).toBeDefined();
    expect(avatar?.items.some(i => i.definitionId === CHALLENGE_THE_POWER)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === CHALLENGE_THE_POWER)).toBe(true);
  });

  test('roll < 7 eliminates the avatar (no win)', () => {
    const state = balrogSiteState({ withRing: true });
    const avatarId = findCharInstanceId(state, RESOURCE_PLAYER, BALROG_STAND_IN);
    const after = playWithRoll(state, 6);

    expect(after.phaseState.phase).not.toBe(Phase.GameOver);
    expect(after.players[RESOURCE_PLAYER].characters[avatarId]).toBeUndefined();
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === avatarId)).toBe(true);
  });

  test('roll 9–10 keeps the card in play (gain 2 MP)', () => {
    const state = balrogSiteState({ withRing: true });
    const avatarId = findCharInstanceId(state, RESOURCE_PLAYER, BALROG_STAND_IN);
    const after = playWithRoll(state, 10);

    expect(after.phaseState.phase).not.toBe(Phase.GameOver);
    const avatar = after.players[RESOURCE_PLAYER].characters[avatarId];
    expect(avatar?.items.some(i => i.definitionId === CHALLENGE_THE_POWER)).toBe(true);
    // The card's 2 misc MP stand for "gain 2 marshalling points".
    expect(after.players[RESOURCE_PLAYER].marshallingPoints.misc).toBeGreaterThanOrEqual(2);
  });
});
