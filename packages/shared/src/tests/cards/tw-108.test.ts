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
  PLAYER_1, PLAYER_2, P1_COMPANY,
  reduce,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint, buildSitePhaseState, makeMHState,
  Phase,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, SitePhaseState, MovementHazardPhaseState } from '../../index.js';
import { ISENGARD, WAKE_OF_WAR, DOORS_OF_NIGHT } from '../../index.js';

// ─── Helpers ─────────────���────────────────────────────────────────────────────

/** Pre-place Wake of War in the hazard player's cardsInPlay. */
function placeWakeOfWar(
  state: ReturnType<typeof buildSitePhaseState>,
): ReturnType<typeof buildSitePhaseState> {
  const wowInPlay: CardInPlay = {
    instanceId: 'wow-1' as CardInstanceId,
    definitionId: WAKE_OF_WAR,
    status: CardStatus.Untapped,
  };
  const players = state.players.map((p, i) =>
    i === 1 ? { ...p, cardsInPlay: [...p.cardsInPlay, wowInPlay] } : p,
  ) as [typeof state.players[0], typeof state.players[1]];
  return { ...state, players };
}

/** Set up the automatic-attacks step for a given state. */
function setupAutoAttack(state: ReturnType<typeof buildSitePhaseState>) {
  const autoAttackState: SitePhaseState = {
    ...state.phaseState,
    step: 'automatic-attacks',
    siteEntered: false,
    automaticAttacksResolved: 0,
  };
  return { ...state, phaseState: autoAttackState };
}

// ─── Tests ────────────────────────────────────��───────────────────────────────

describe('Wake of War (tw-108)', () => {
  beforeEach(() => resetMint());

  test('Wolves auto-attack prowess increased by +1', () => {
    // Isengard: Wolves — 3 strikes, 7 prowess
    // With Wake of War: 7 + 1 = 8 prowess
    const state = setupAutoAttack(placeWakeOfWar(buildSitePhaseState({ site: ISENGARD })));

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikeProwess).toBe(8);
  });

  test('Wolves auto-attack strikes increased by +1', () => {
    // Isengard: Wolves — 3 strikes, 7 prowess
    // With Wake of War: 3 + 1 = 4 strikes
    const state = setupAutoAttack(placeWakeOfWar(buildSitePhaseState({ site: ISENGARD })));

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

    const base = buildSitePhaseState({ site: ISENGARD });
    const wowInPlay: CardInPlay = {
      instanceId: 'wow-1' as CardInstanceId,
      definitionId: WAKE_OF_WAR,
      status: CardStatus.Untapped,
    };
    const players = base.players.map((p, i) =>
      i === 1 ? { ...p, cardsInPlay: [...p.cardsInPlay, wowInPlay, donInPlay] } : p,
    ) as [typeof base.players[0], typeof base.players[1]];
    const state = setupAutoAttack({ ...base, players });

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikeProwess).toBe(9);
    expect(result.state.combat!.strikesTotal).toBe(5);
  });

  test('Orc auto-attack unaffected by Wake of War', () => {
    // Moria: Orcs — 4 strikes, 7 prowess
    // Wake of War only affects Wolf, Spider, Animal — Orcs should be unchanged
    const state = setupAutoAttack(placeWakeOfWar(buildSitePhaseState({ site: MORIA })));

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikeProwess).toBe(7);
    expect(result.state.combat!.strikesTotal).toBe(4);
  });

  test('cannot be duplicated (duplication-limit scope game max 1)', () => {
    // Place Wake of War in play, then try to play another from hand
    const wowInPlay: CardInPlay = {
      instanceId: 'wow-1' as CardInstanceId,
      definitionId: WAKE_OF_WAR,
      status: CardStatus.Untapped,
    };

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

    const wowHandId = readyState.players[1].hand[0].instanceId;
    const result = reduce(readyState, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: wowHandId, targetCompanyId: P1_COMPANY });
    expect(result.error).toBe('Wake of War cannot be duplicated');
  });

  test('without Wake of War: Wolves auto-attack unchanged', () => {
    // Isengard: Wolves — 3 strikes, 7 prowess (baseline, no Wake of War)
    const state = setupAutoAttack(buildSitePhaseState({ site: ISENGARD }));

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikeProwess).toBe(7);
    expect(result.state.combat!.strikesTotal).toBe(3);
  });
});
