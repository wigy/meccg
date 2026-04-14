/**
 * @module tw-61.test
 *
 * Card test: Minions Stir (tw-61)
 * Type: hazard-event (long)
 * Effects: 7 (duplication-limit, 6 stat-modifiers)
 *
 * "The number of strikes and prowess of each Orc and Troll attack are each
 *  increased by one (by two for Orc attacks if Doors of Night is in play).
 *  Cannot be duplicated."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, P1_COMPANY,
  reduce,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint, buildSitePhaseState, makeMHState,
  addP2CardsInPlay, setupAutoAttackStep,
  Phase,
  handCardId,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, MovementHazardPhaseState, CardDefinitionId } from '../../index.js';
import { ETTENMOORS_HERO, ISENGARD, DOORS_OF_NIGHT } from '../../index.js';

const MINIONS_STIR = 'tw-61' as CardDefinitionId;

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Minions Stir (tw-61)', () => {
  beforeEach(() => resetMint());

  const msInPlay: CardInPlay = {
    instanceId: 'ms-1' as CardInstanceId,
    definitionId: MINIONS_STIR,
    status: CardStatus.Untapped,
  };

  test('Orc auto-attack prowess increased by +1', () => {
    // Moria: Orcs — 4 strikes, 7 prowess
    // With Minions Stir: 7 + 1 = 8 prowess
    const state = setupAutoAttackStep(addP2CardsInPlay(buildSitePhaseState({ site: MORIA }), [msInPlay]));

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikeProwess).toBe(8);
  });

  test('Orc auto-attack strikes increased by +1', () => {
    // Moria: Orcs — 4 strikes, 7 prowess
    // With Minions Stir: 4 + 1 = 5 strikes
    const state = setupAutoAttackStep(addP2CardsInPlay(buildSitePhaseState({ site: MORIA }), [msInPlay]));

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikesTotal).toBe(5);
  });

  test('Orcs get +2 prowess and strikes with Doors of Night in play', () => {
    // Moria: Orcs — 4 strikes, 7 prowess
    // With Minions Stir + Doors of Night: 7 + 2 = 9 prowess, 4 + 2 = 6 strikes
    const donInPlay: CardInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };

    const state = setupAutoAttackStep(addP2CardsInPlay(buildSitePhaseState({ site: MORIA }), [msInPlay, donInPlay]));

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikeProwess).toBe(9);
    expect(result.state.combat!.strikesTotal).toBe(6);
  });

  test('Troll auto-attack prowess increased by +1', () => {
    // Ettenmoors: Trolls — 1 strike, 9 prowess
    // With Minions Stir: 9 + 1 = 10 prowess
    const state = setupAutoAttackStep(addP2CardsInPlay(buildSitePhaseState({ site: ETTENMOORS_HERO }), [msInPlay]));

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikeProwess).toBe(10);
  });

  test('Troll auto-attack strikes increased by +1', () => {
    // Ettenmoors: Trolls — 1 strike, 9 prowess
    // With Minions Stir: 1 + 1 = 2 strikes
    const state = setupAutoAttackStep(addP2CardsInPlay(buildSitePhaseState({ site: ETTENMOORS_HERO }), [msInPlay]));

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikesTotal).toBe(2);
  });

  test('Trolls NOT boosted extra by Doors of Night', () => {
    // Ettenmoors: Trolls — 1 strike, 9 prowess
    // With Minions Stir + Doors of Night: still only +1 (9+1=10 prowess, 1+1=2 strikes)
    const donInPlay: CardInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };

    const state = setupAutoAttackStep(addP2CardsInPlay(buildSitePhaseState({ site: ETTENMOORS_HERO }), [msInPlay, donInPlay]));

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikeProwess).toBe(10);
    expect(result.state.combat!.strikesTotal).toBe(2);
  });

  test('Wolf auto-attack unaffected by Minions Stir', () => {
    // Isengard: Wolves — 3 strikes, 7 prowess
    // Minions Stir only affects Orc and Troll — Wolves should be unchanged
    const state = setupAutoAttackStep(addP2CardsInPlay(buildSitePhaseState({ site: ISENGARD }), [msInPlay]));

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikeProwess).toBe(7);
    expect(result.state.combat!.strikesTotal).toBe(3);
  });

  test('cannot be duplicated (duplication-limit scope game max 1)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [MINIONS_STIR], siteDeck: [MINAS_TIRITH], cardsInPlay: [msInPlay] },
      ],
    });

    const mhState: MovementHazardPhaseState = makeMHState({
      hazardsPlayedThisCompany: 0,
      hazardLimit: 4,
    });
    const readyState = { ...state, phaseState: mhState };

    const msHandId = handCardId(readyState, 1);
    const result = reduce(readyState, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: msHandId, targetCompanyId: P1_COMPANY });
    expect(result.error).toBe('Minions Stir cannot be duplicated');
  });

  test('without Minions Stir: Orc auto-attack unchanged', () => {
    // Moria: Orcs — 4 strikes, 7 prowess (baseline, no Minions Stir)
    const state = setupAutoAttackStep(buildSitePhaseState({ site: MORIA }));

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikeProwess).toBe(7);
    expect(result.state.combat!.strikesTotal).toBe(4);
  });
});
