/**
 * @module td-154.test
 *
 * Card test: Star of High Hope (td-154)
 * Type: hero-resource-event (long, environment)
 * Effects: 2 stat-modifiers
 *
 * "Environment. The prowess of each Elf and Dúnadan is modified by +1
 *  (by +2 if Gates of Morning is in play)."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  Phase,
  ARAGORN, LEGOLAS, BARD_BOWMAN,
  GATES_OF_MORNING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  baseProwess,
  buildTestState, resetMint,
  playLongEventAndResolve, handCardId, getCharacter, dispatch, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId } from '../../index.js';

const STAR_OF_HIGH_HOPE = 'td-154' as CardDefinitionId;

describe('Star of High Hope (td-154)', () => {
  beforeEach(() => resetMint());

  test('Elf and Dúnadan prowess +1 when in play', () => {
    // Aragorn is a Dúnadan, Legolas is an Elf — both should get +1 prowess.
    // Bard Bowman is a Man — unaffected.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, BARD_BOWMAN] }], hand: [STAR_OF_HIGH_HOPE], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const cardInstanceId = handCardId(state, RESOURCE_PLAYER);
    const s = playLongEventAndResolve(state, PLAYER_1, cardInstanceId);

    expect(getCharacter(s, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(baseProwess(ARAGORN) + 1);
    expect(getCharacter(s, HAZARD_PLAYER, LEGOLAS).effectiveStats.prowess).toBe(baseProwess(LEGOLAS) + 1);
    expect(getCharacter(s, RESOURCE_PLAYER, BARD_BOWMAN).effectiveStats.prowess).toBe(baseProwess(BARD_BOWMAN));
  });

  test('with Gates of Morning: Elf and Dúnadan prowess +2', () => {
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [STAR_OF_HIGH_HOPE], siteDeck: [MORIA], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const cardInstanceId = handCardId(state, RESOURCE_PLAYER);
    const s = playLongEventAndResolve(state, PLAYER_1, cardInstanceId);

    expect(getCharacter(s, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(baseProwess(ARAGORN) + 2);
    expect(getCharacter(s, HAZARD_PLAYER, LEGOLAS).effectiveStats.prowess).toBe(baseProwess(LEGOLAS) + 2);
  });

  test('affects opponent characters too', () => {
    const cardInPlay: CardInPlay = {
      instanceId: 'shh-pre' as CardInstanceId,
      definitionId: STAR_OF_HIGH_HOPE,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA], cardsInPlay: [cardInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Pass to trigger recomputeDerived
    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });

    expect(getCharacter(s, HAZARD_PLAYER, ARAGORN).effectiveStats.prowess).toBe(baseProwess(ARAGORN) + 1);
  });
});
