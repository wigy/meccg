/**
 * @module tw-108.test
 *
 * Card test: Wake of War (tw-108)
 * Type: hazard-event (long)
 * Effects: 5 (duplication-limit, 4 stat-modifiers)
 *
 * "The number of strikes and prowess of each Wolf, Spider, and Animal attack
 *  are each increased by one (by two for Wolf attacks if Doors of Night is in
 *  play). Cannot be duplicated."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  reduce,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint, buildSitePhaseState, makeMHState,
  addP2CardsInPlay, setupAutoAttackStep,
  Phase,
  viableActions,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, MovementHazardPhaseState, CardDefinitionId } from '../../index.js';
import { ISENGARD, DOORS_OF_NIGHT } from '../../index.js';

const WAKE_OF_WAR = 'tw-108' as CardDefinitionId;

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Wake of War (tw-108)', () => {
  beforeEach(() => resetMint());

  const wowInPlay: CardInPlay = {
    instanceId: 'wow-1' as CardInstanceId,
    definitionId: WAKE_OF_WAR,
    status: CardStatus.Untapped,
  };

  test('Wolves auto-attack prowess increased by +1', () => {
    // Isengard: Wolves — 3 strikes, 7 prowess
    // With Wake of War: 7 + 1 = 8 prowess
    const state = setupAutoAttackStep(addP2CardsInPlay(buildSitePhaseState({ site: ISENGARD }), [wowInPlay]));

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikeProwess).toBe(8);
  });

  test('Wolves auto-attack strikes increased by +1', () => {
    // Isengard: Wolves — 3 strikes, 7 prowess
    // With Wake of War: 3 + 1 = 4 strikes
    const state = setupAutoAttackStep(addP2CardsInPlay(buildSitePhaseState({ site: ISENGARD }), [wowInPlay]));

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikesTotal).toBe(4);
  });

  test('Wolves get +2 prowess and strikes with Doors of Night in play', () => {
    // Isengard: Wolves — 3 strikes, 7 prowess
    // With Wake of War + Doors of Night: 7 + 2 = 9 prowess, 3 + 2 = 5 strikes
    const donInPlay: CardInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };

    const state = setupAutoAttackStep(addP2CardsInPlay(buildSitePhaseState({ site: ISENGARD }), [wowInPlay, donInPlay]));

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikeProwess).toBe(9);
    expect(result.state.combat!.strikesTotal).toBe(5);
  });

  test('Orc auto-attack unaffected by Wake of War', () => {
    // Moria: Orcs — 4 strikes, 7 prowess
    // Wake of War only affects Wolf, Spider, Animal — Orcs should be unchanged
    const state = setupAutoAttackStep(addP2CardsInPlay(buildSitePhaseState({ site: MORIA }), [wowInPlay]));

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikeProwess).toBe(7);
    expect(result.state.combat!.strikesTotal).toBe(4);
  });

  test('cannot be duplicated (duplication-limit scope game max 1)', () => {
    // Place Wake of War in play, then try to play another from hand
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [WAKE_OF_WAR], siteDeck: [MINAS_TIRITH], cardsInPlay: [wowInPlay] },
      ],
    });

    const mhState: MovementHazardPhaseState = makeMHState({
      hazardsPlayedThisCompany: 0,
      hazardLimit: 4,
    });
    const readyState = { ...state, phaseState: mhState };

    const actions = viableActions(readyState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('without Wake of War: Wolves auto-attack unchanged', () => {
    // Isengard: Wolves — 3 strikes, 7 prowess (baseline, no Wake of War)
    const state = setupAutoAttackStep(buildSitePhaseState({ site: ISENGARD }));

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikeProwess).toBe(7);
    expect(result.state.combat!.strikesTotal).toBe(3);
  });
});
