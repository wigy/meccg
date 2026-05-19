/**
 * @module le-143.test
 *
 * Card test: Tidings of Bold Spies (le-143)
 * Type: hazard-event (short)
 *
 * Card text:
 *   "Playable on a company moving to a site with an automatic-attack. This card
 *    creates one or more attacks on the company, the total of which duplicates
 *    exactly (including modifications) all automatic-attacks at the site. These
 *    attacks must be faced immediately and are not considered automatic-attacks."
 *
 * Effects:
 *   1. play-restriction: only playable when destination site has at least one
 *      automatic-attack
 *   2. duplicate-site-auto-attacks: creates immediate combat attacks matching
 *      the site's auto-attacks exactly; attacks are NOT auto-attacks
 *
 * | # | Effect                             | Status | Notes                                        |
 * |---|------------------------------------|--------|----------------------------------------------|
 * | 1 | play-restriction (auto-attack site) | OK     | movement-hazard.ts only-at-site-with-auto-attack |
 * | 2 | duplicate-site-auto-attacks         | OK     | chain-reducer.ts + finalizeCombat in         |
 * |   |                                    |        | reducer-combat.ts; tidings-attacks-queue     |
 *
 * Playable: YES
 * CERTIFIED 2026-05-19
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  MORIA, RIVENDELL, LORIEN, MINAS_TIRITH,
  makeMHState,
  viableActions,
  playHazardAndResolve,
  P1_COMPANY,
  findCharInstanceId,
  dispatch,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const TIDINGS_OF_BOLD_SPIES = 'le-143' as CardDefinitionId;

/** Build a minimal M/H state with PLAYER_1 moving toward a named destination. */
function buildMovingState(destinationSite: CardDefinitionId, destinationSiteName: string, hand: CardDefinitionId[] = [TIDINGS_OF_BOLD_SPIES]) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite }], hand: [], siteDeck: [MORIA] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand, siteDeck: [MINAS_TIRITH] },
    ],
  });
  return {
    ...state,
    phaseState: makeMHState({
      hazardsPlayedThisCompany: 0,
      hazardLimitAtReveal: 4,
      destinationSiteName,
    }),
  };
}

describe('Tidings of Bold Spies (le-143)', () => {
  beforeEach(() => resetMint());

  // ─── Play restriction ─────────────────────────────────────────────────────

  test('offered against a moving company whose destination site has automatic-attacks', () => {
    // Moria (ruins-and-lairs) has 1 auto-attack (4 Orcs @ prowess 7)
    const state = buildMovingState(MORIA, 'Moria');
    const actions = viableActions(state, PLAYER_2, 'play-hazard');
    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0].action.type).toBe('play-hazard');
  });

  test('NOT offered against a moving company whose destination site has no automatic-attacks', () => {
    // Rivendell is a haven — no automatic attacks
    const state = buildMovingState(RIVENDELL, 'Rivendell');
    const actions = viableActions(state, PLAYER_2, 'play-hazard');
    // Should be non-viable (or absent entirely)
    const tidingsActions = actions.filter(a => {
      const card = state.players[1].hand.find(h => h.instanceId === (a.action as { cardInstanceId?: unknown }).cardInstanceId);
      return card?.definitionId === TIDINGS_OF_BOLD_SPIES;
    });
    expect(tidingsActions.every(a => !a.viable)).toBe(true);
  });

  // ─── Combat duplication ───────────────────────────────────────────────────

  test('creates combat immediately after resolving against a site with one auto-attack', () => {
    // Moria has one auto-attack: 4 Orcs @ prowess 7
    const state = buildMovingState(MORIA, 'Moria');
    const hazardPlayer = state.players[1];
    const tidings = hazardPlayer.hand.find(c => c.definitionId === TIDINGS_OF_BOLD_SPIES)!;
    const stateAfterPlay = playHazardAndResolve(state, PLAYER_2, tidings.instanceId, P1_COMPANY);

    expect(stateAfterPlay.combat).not.toBeNull();
    expect(stateAfterPlay.combat?.attackSource.type).toBe('tidings-attack');
  });

  test('created attack duplicates Moria auto-attack stats exactly (4 strikes, prowess 7)', () => {
    // Moria: creatureType Orcs, strikes 4, prowess 7
    const state = buildMovingState(MORIA, 'Moria');
    const hazardPlayer = state.players[1];
    const tidings = hazardPlayer.hand.find(c => c.definitionId === TIDINGS_OF_BOLD_SPIES)!;
    const stateAfterPlay = playHazardAndResolve(state, PLAYER_2, tidings.instanceId, P1_COMPANY);

    const combat = stateAfterPlay.combat;
    expect(combat).not.toBeNull();
    expect(combat?.strikesTotal).toBe(4);
    expect(combat?.strikeProwess).toBe(7);
    expect(combat?.creatureRace).toBe('orc'); // normalized from 'Orcs'
  });

  test('created attack is NOT an automatic-attack (attackSource type is tidings-attack)', () => {
    const state = buildMovingState(MORIA, 'Moria');
    const hazardPlayer = state.players[1];
    const tidings = hazardPlayer.hand.find(c => c.definitionId === TIDINGS_OF_BOLD_SPIES)!;
    const stateAfterPlay = playHazardAndResolve(state, PLAYER_2, tidings.instanceId, P1_COMPANY);

    // Must NOT be automatic-attack — auto-attack modifiers should not apply
    expect(stateAfterPlay.combat?.attackSource.type).not.toBe('automatic-attack');
    expect(stateAfterPlay.combat?.attackSource.type).toBe('tidings-attack');
  });

  test('after first attack is defeated, combat ends (single auto-attack site)', () => {
    // Moria has exactly 1 auto-attack — after resolving it, combat should be gone
    const state = buildMovingState(MORIA, 'Moria');
    const hazardPlayer = state.players[1];
    const tidings = hazardPlayer.hand.find(c => c.definitionId === TIDINGS_OF_BOLD_SPIES)!;
    let s = playHazardAndResolve(state, PLAYER_2, tidings.instanceId, P1_COMPANY);

    // Confirm combat is active with 4 strikes
    expect(s.combat?.strikesTotal).toBe(4);
    const aragornId = findCharInstanceId(s, 0, ARAGORN);

    // Assign all 4 strikes to Aragorn (assign-strike + excess)
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId, excess: true });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId, excess: true });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId, excess: true });

    // All strikes assigned — resolve them all (cheat roll: Aragorn prowess 6, need >7 → roll 12 succeeds)
    const chooseOrder = viableActions(s, PLAYER_1, 'choose-strike-order');
    if (chooseOrder.length > 0) s = dispatch(s, chooseOrder[0].action);
    // Resolve all 4 strikes with high rolls (success)
    for (let i = 0; i < 4; i++) {
      s = { ...s, cheatRollTotal: 12 };
      const resolveActs = viableActions(s, PLAYER_1, 'resolve-strike');
      if (resolveActs.length === 0) break;
      s = dispatch(s, resolveActs[0].action);
    }

    // After all strikes resolved, combat should be cleared (no more tidings attacks)
    expect(s.combat).toBeNull();
    // No tidings-attacks-queue constraint should remain
    const tidingsConstraint = s.activeConstraints.find(c => c.kind.type === 'tidings-attacks-queue');
    expect(tidingsConstraint).toBeUndefined();
  });
});
