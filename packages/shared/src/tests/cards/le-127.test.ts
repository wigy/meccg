/**
 * @module le-127.test
 *
 * Card test: News of Doom (le-127)
 * Type: hazard-event (short), unique
 *
 * "Unique. Each player makes a roll for each faction he has in play.
 *  Discard any faction if its result is 2 or 3, or if its result plus
 *  that player's unused general influence is less than 10. Remove News
 *  of Doom from the game."
 *
 * Unlike Muster Disperses (le-126/tw-67), which is `play-target: "faction"`
 * and rolls for a single chosen faction, News of Doom carries no play-target
 * at all — it is played as a single untargeted hazard action and sweeps
 * EVERY faction currently in play for BOTH players (`multi-faction-check`).
 * Each faction's owner rolls independently; a raw roll of 2 or 3 always
 * discards regardless of unused general influence (`alwaysFailRolls`), and
 * a raw roll plus unused GI below 10 discards too. The card itself is
 * removed from the game (`play-flag: "remove-from-game"`) rather than
 * sitting in the discard pile.
 *
 * Tests verify:
 * 1. Playable during M/H as a single untargeted action (not one per faction)
 * 2. Resolving enqueues one dice-check per faction in play, across both players
 * 3. A faction survives when roll + unused GI >= 10 (and roll isn't 2/3)
 * 4. A faction is discarded when roll + unused GI < 10
 * 5. A faction is discarded on a raw roll of 2 or 3 even with huge unused GI
 * 6. The card is removed from the game (out-of-play pile, not discard pile)
 * 7. With no factions in play, the card still resolves and is removed from
 *    the game — no dice-checks are enqueued
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, resetMint, makeWildernessMHState,
  resolveChain,
  handCardId, companyIdAt, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, reduce, Phase, CardStatus, GENERAL_INFLUENCE } from '../../index.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId, PlayHazardAction, ResolveDiceCheckAction } from '../../index.js';

const NEWS_OF_DOOM = 'le-127' as CardDefinitionId;

// Minion sites
const MORIA_MINION = 'le-392' as CardDefinitionId;   // shadow-hold
const MINAS_MORGUL = 'le-390' as CardDefinitionId;   // minion haven

// Minion characters
const LIEUTENANT_OF_DOL_GULDUR = 'le-21' as CardDefinitionId; // mind 9
const GORBAG = 'le-11' as CardDefinitionId;                    // mind 6
const TROS_HESNEF = 'le-46' as CardDefinitionId;               // mind 2

// Minion factions
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId;
const ORCS_OF_MORIA = 'le-278' as CardDefinitionId;

const factionOfP1: CardInPlay = {
  instanceId: 'faction-p1-goblins' as CardInstanceId,
  definitionId: GOBLINS_OF_GOBLIN_GATE,
  status: CardStatus.Untapped,
};
const factionOfP2: CardInPlay = {
  instanceId: 'faction-p2-orcs' as CardInstanceId,
  definitionId: ORCS_OF_MORIA,
  status: CardStatus.Untapped,
};

function baseState(overrides: {
  p1Characters: readonly CardDefinitionId[];
  p2Characters: readonly CardDefinitionId[];
  p1CardsInPlay?: readonly CardInPlay[];
  p2CardsInPlay?: readonly CardInPlay[];
}) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA_MINION, characters: [...overrides.p1Characters] }],
        hand: [],
        siteDeck: [MINAS_MORGUL],
        cardsInPlay: overrides.p1CardsInPlay ? [...overrides.p1CardsInPlay] : [],
      },
      {
        id: PLAYER_2,
        companies: [{ site: MINAS_MORGUL, characters: [...overrides.p2Characters] }],
        hand: [NEWS_OF_DOOM],
        siteDeck: [MORIA_MINION],
        cardsInPlay: overrides.p2CardsInPlay ? [...overrides.p2CardsInPlay] : [],
      },
    ],
  });
}

describe('News of Doom (le-127)', () => {
  beforeEach(() => resetMint());

  test('playable during M/H as a single untargeted action, regardless of faction count', () => {
    const state = baseState({
      p1Characters: [LIEUTENANT_OF_DOL_GULDUR],
      p2Characters: [TROS_HESNEF],
      p1CardsInPlay: [factionOfP1],
      p2CardsInPlay: [factionOfP2],
    });
    const gameState = { ...state, phaseState: makeWildernessMHState() };

    const actions = computeLegalActions(gameState, PLAYER_2);
    const playActions = actions.filter(
      a => a.viable && a.action.type === 'play-hazard'
        && a.action.cardInstanceId === handCardId(gameState, HAZARD_PLAYER),
    );
    expect(playActions).toHaveLength(1);
    expect((playActions[0].action as PlayHazardAction).targetFactionInstanceId).toBeUndefined();
  });

  test('resolving enqueues one dice-check per faction, across both players', () => {
    const state = baseState({
      p1Characters: [LIEUTENANT_OF_DOL_GULDUR],
      p2Characters: [TROS_HESNEF],
      p1CardsInPlay: [factionOfP1],
      p2CardsInPlay: [factionOfP2],
    });
    const gameState = { ...state, phaseState: makeWildernessMHState() };

    const hazardId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const result = reduce(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: hazardId,
      targetCompanyId: companyId,
    });
    expect(result.error).toBeUndefined();

    const afterChain = resolveChain(result.state);
    const checks = afterChain.pendingResolutions.filter(r => r.kind.type === 'dice-check');
    expect(checks).toHaveLength(2);

    const p1Check = checks.find(r => r.actor === PLAYER_1)!;
    const p2Check = checks.find(r => r.actor === PLAYER_2)!;
    expect(p1Check).toBeDefined();
    expect(p2Check).toBeDefined();
    if (p1Check.kind.type === 'dice-check') {
      expect(p1Check.kind.targetInstanceId).toBe(factionOfP1.instanceId);
      expect(p1Check.kind.threshold).toBe(10);
      expect(p1Check.kind.alwaysFailRolls).toEqual([2, 3]);
    }
    if (p2Check.kind.type === 'dice-check') {
      expect(p2Check.kind.targetInstanceId).toBe(factionOfP2.instanceId);
      expect(p2Check.kind.threshold).toBe(10);
    }

    // The card is removed from the game immediately — before either faction
    // check resolves — rather than sitting in the discard pile.
    expect(afterChain.players[1].discardPile.some(c => c.instanceId === hazardId)).toBe(false);
    expect(afterChain.players[1].outOfPlayPile.some(c => c.instanceId === hazardId)).toBe(true);
  });

  test('faction survives when roll + unused GI >= 10 and roll is not 2 or 3', () => {
    const state = baseState({
      p1Characters: [LIEUTENANT_OF_DOL_GULDUR], // mind 9 → unused GI 11
      p2Characters: [TROS_HESNEF],
      p1CardsInPlay: [factionOfP1],
    });
    const gameState = { ...state, phaseState: makeWildernessMHState() };
    expect(GENERAL_INFLUENCE - gameState.players[0].generalInfluenceUsed).toBe(11);

    const hazardId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const result = reduce(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: hazardId,
      targetCompanyId: companyId,
    });
    const afterChain = resolveChain(result.state);

    const rollAction = computeLegalActions(afterChain, PLAYER_1)
      .find(a => a.viable && a.action.type === 'resolve-dice-check')!;
    expect(rollAction).toBeDefined();

    // Roll 4 (not 2/3): 4 + 11 = 15 >= 10 → survives.
    const afterRoll = reduce({ ...afterChain, cheatRollTotal: 4 }, rollAction.action as ResolveDiceCheckAction);
    expect(afterRoll.error).toBeUndefined();
    expect(afterRoll.state.players[0].cardsInPlay.some(c => c.instanceId === factionOfP1.instanceId)).toBe(true);
  });

  test('faction discarded when roll + unused GI < 10', () => {
    const state = baseState({
      // Lieutenant of Dol Guldur (9) + Gorbag (6) = 15 GI used, unused = 5.
      p1Characters: [LIEUTENANT_OF_DOL_GULDUR, GORBAG],
      p2Characters: [TROS_HESNEF],
      p1CardsInPlay: [factionOfP1],
    });
    const gameState = { ...state, phaseState: makeWildernessMHState() };
    expect(GENERAL_INFLUENCE - gameState.players[0].generalInfluenceUsed).toBe(5);

    const hazardId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const result = reduce(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: hazardId,
      targetCompanyId: companyId,
    });
    const afterChain = resolveChain(result.state);

    const rollAction = computeLegalActions(afterChain, PLAYER_1)
      .find(a => a.viable && a.action.type === 'resolve-dice-check')!;

    // Roll 4 (not 2/3): 4 + 5 = 9 < 10 → discarded.
    const afterRoll = reduce({ ...afterChain, cheatRollTotal: 4 }, rollAction.action as ResolveDiceCheckAction);
    expect(afterRoll.error).toBeUndefined();
    expect(afterRoll.state.players[0].cardsInPlay.some(c => c.instanceId === factionOfP1.instanceId)).toBe(false);
    expect(afterRoll.state.players[0].discardPile.some(c => c.instanceId === factionOfP1.instanceId)).toBe(true);
  });

  test('faction discarded on a raw roll of 2 or 3, even with huge unused GI', () => {
    const state = baseState({
      p1Characters: [TROS_HESNEF], // mind 2 → unused GI 18
      p2Characters: [TROS_HESNEF],
      p1CardsInPlay: [factionOfP1],
    });
    const gameState = { ...state, phaseState: makeWildernessMHState() };
    expect(GENERAL_INFLUENCE - gameState.players[0].generalInfluenceUsed).toBe(18);

    const hazardId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const result = reduce(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: hazardId,
      targetCompanyId: companyId,
    });
    const afterChain = resolveChain(result.state);

    const rollAction = computeLegalActions(afterChain, PLAYER_1)
      .find(a => a.viable && a.action.type === 'resolve-dice-check')!;

    // Roll 2: 2 + 18 = 20 >= 10 by the threshold clause, but the raw-roll
    // clause ("result is 2 or 3") discards it regardless.
    const afterRoll = reduce({ ...afterChain, cheatRollTotal: 2 }, rollAction.action as ResolveDiceCheckAction);
    expect(afterRoll.error).toBeUndefined();
    expect(afterRoll.state.players[0].cardsInPlay.some(c => c.instanceId === factionOfP1.instanceId)).toBe(false);
    expect(afterRoll.state.players[0].discardPile.some(c => c.instanceId === factionOfP1.instanceId)).toBe(true);
  });

  test('with no factions in play, the card still resolves and is removed from the game', () => {
    const state = baseState({
      p1Characters: [LIEUTENANT_OF_DOL_GULDUR],
      p2Characters: [TROS_HESNEF],
    });
    const gameState = { ...state, phaseState: makeWildernessMHState() };

    const hazardId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const result = reduce(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: hazardId,
      targetCompanyId: companyId,
    });
    expect(result.error).toBeUndefined();

    const afterChain = resolveChain(result.state);
    expect(afterChain.pendingResolutions.filter(r => r.kind.type === 'dice-check')).toHaveLength(0);
    expect(afterChain.players[1].outOfPlayPile.some(c => c.instanceId === hazardId)).toBe(true);
    expect(afterChain.players[1].discardPile.some(c => c.instanceId === hazardId)).toBe(false);
  });
});
