/**
 * @module tw-335.test
 *
 * Card test: Sun (tw-335)
 * Type: hero-resource-event (long, environment)
 * Effects: 4 (duplication-limit, 3 stat-modifiers)
 *
 * "Environment. The prowess of each Dúnadan is modified by +1.
 *  Additionally, if Gates of Morning is in play, the prowess of each
 *  automatic-attack and hazard creature is modified by -1 and the prowess
 *  of each Man and Dúnadan is modified by +1. Cannot be duplicated."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  Phase,
  ARAGORN, LEGOLAS, BARD_BOWMAN,
  SUN, GATES_OF_MORNING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  baseProwess,
  buildTestState, resetMint, buildSitePhaseState,
  playLongEventAndResolve, viableActions,
  handCardId, dispatch, getCharacter, pushCardInPlay,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, CharacterCard, GameState, SitePhaseState } from '../../index.js';
import { ISENGARD } from '../../index.js';

describe('Sun (tw-335)', () => {
  beforeEach(() => resetMint());

  test('Dúnadan prowess +1 when Sun is in play', () => {
    // Aragorn is a dunadan — should get +1 prowess from Sun
    // Legolas is an elf — should be unaffected
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SUN], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const sunInstanceId = handCardId(state, 0);
    const s = playLongEventAndResolve(state, PLAYER_1, sunInstanceId);

    expect(getCharacter(s, 0, ARAGORN).effectiveStats.prowess).toBe(baseProwess(ARAGORN) + 1);
    expect(getCharacter(s, 1, LEGOLAS).effectiveStats.prowess).toBe(baseProwess(LEGOLAS));
  });

  test('with Gates of Morning: Man and Dúnadan prowess +1 additional', () => {
    // Sun alone: Dúnadan +1, Man +0
    // Sun + Gates of Morning: Dúnadan +2, Man +1
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, BARD_BOWMAN] }], hand: [SUN], siteDeck: [MORIA], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const sunInstanceId = handCardId(state, 0);
    const s = playLongEventAndResolve(state, PLAYER_1, sunInstanceId);

    // Aragorn (dunadan): +1 unconditional + +1 with GoM = +2
    expect(getCharacter(s, 0, ARAGORN).effectiveStats.prowess).toBe(baseProwess(ARAGORN) + 2);
    // Bard Bowman (man): +1 with GoM
    expect(getCharacter(s, 0, BARD_BOWMAN).effectiveStats.prowess).toBe(baseProwess(BARD_BOWMAN) + 1);
    // Legolas (elf): unaffected
    expect(getCharacter(s, 1, LEGOLAS).effectiveStats.prowess).toBe(baseProwess(LEGOLAS));
  });

  test('affects opponent characters too', () => {
    const sunInPlay: CardInPlay = {
      instanceId: 'sun-pre' as CardInstanceId,
      definitionId: SUN,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA], cardsInPlay: [sunInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Pass to trigger recomputeDerived
    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });

    // P2's Aragorn (dunadan) should get +1 from P1's Sun
    expect(getCharacter(s, 1, ARAGORN).effectiveStats.prowess).toBe(baseProwess(ARAGORN) + 1);
  });

  test('body and direct influence are not modified', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SUN], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const sunInstanceId = handCardId(state, 0);
    const s = playLongEventAndResolve(state, PLAYER_1, sunInstanceId);

    const aragornDef = pool[ARAGORN as string] as CharacterCard;
    const stats = getCharacter(s, 0, ARAGORN).effectiveStats;
    expect(stats.body).toBe(aragornDef.body);
    expect(stats.directInfluence).toBe(aragornDef.directInfluence);
  });

  test('cannot be duplicated (duplication-limit scope game max 1)', () => {
    const sunInPlay: CardInPlay = {
      instanceId: 'sun-pre' as CardInstanceId,
      definitionId: SUN,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SUN], siteDeck: [MORIA], cardsInPlay: [sunInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-long-event');
    expect(actions).toHaveLength(0);
  });

  test('cannot be duplicated when opponent has a copy in play', () => {
    const sunInPlay: CardInPlay = {
      instanceId: 'sun-opp' as CardInstanceId,
      definitionId: SUN,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SUN], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [sunInPlay] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-long-event');
    expect(actions).toHaveLength(0);
  });

  // Isengard has Wolves automatic attack: 3 strikes, 7 prowess. Sun's
  // all-attacks -1 modifier only applies while Gates of Morning is out.
  test.each([
    { label: 'with Gates of Morning: -1 applied', withGoM: true, expectedProwess: 6 },
    { label: 'without Gates of Morning: unchanged', withGoM: false, expectedProwess: 7 },
  ])('$label', ({ withGoM, expectedProwess }) => {
    const sunInPlay: CardInPlay = {
      instanceId: 'sun-1' as CardInstanceId,
      definitionId: SUN,
      status: CardStatus.Untapped,
    };
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const initial = buildSitePhaseState({ site: ISENGARD });
    const sitePhase = initial.phaseState;
    let state: GameState = pushCardInPlay(initial, 0, sunInPlay);
    if (withGoM) state = pushCardInPlay(state, 0, gomInPlay);

    const autoAttackState: SitePhaseState = {
      ...sitePhase,
      step: 'automatic-attacks',
      siteEntered: false,
      automaticAttacksResolved: 0,
    };
    const readyState = { ...state, phaseState: autoAttackState };

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(3);
    expect(nextState.combat!.strikeProwess).toBe(expectedProwess);
  });
});
