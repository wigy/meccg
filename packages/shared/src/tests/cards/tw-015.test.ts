/**
 * @module tw-015.test
 *
 * Card test: Barrow-wight (tw-015)
 * Type: hazard-creature
 * Effects: 1 (on-event: character-wounded-by-self → force corruption check -2)
 *
 * "Undead. One strike. After the attack, each character wounded by
 *  Barrow-wight makes a corruption check modified by -2."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  BARROW_WIGHT, GLAMDRING, DAGGER_OF_WESTERNESSE,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeShadowMHState,
  findCharInstanceId,
  playCreatureHazardAndResolve, runCreatureCombat,
  handCardId, companyIdAt, dispatch, expectCharStatus,
  viableActions, viableFor, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, CardStatus } from '../../index.js';
// ─── Constants ──────────────────────────────────────────────────────────────

const SHADOW_KEYING = { method: 'region-type' as const, value: 'shadow' };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Barrow-wight (tw-015)', () => {
  beforeEach(() => resetMint());


  test('combat initiates with 1 strike and 12 prowess', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BARROW_WIGHT], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeShadowMHState();
    const ready = { ...state, phaseState: mhState };

    const bwId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, bwId, companyId, SHADOW_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(12);
    expect(afterChain.combat!.attackSource.type).toBe('creature');
  });

  test('wounded character gets corruption check with -2 modifier', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BARROW_WIGHT], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeShadowMHState();
    const ready = { ...state, phaseState: mhState };

    const bwId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, bwId, companyId, SHADOW_KEYING);

    // Strike roll 2: Aragorn prowess 6-3=3 + 2 = 5 < 12 → wounded
    // Body check: roll 5 ≤ body 9 → survives wounded
    const afterWound = runCreatureCombat(afterChain, ARAGORN, 2, 5);
    expect(afterWound.combat).toBeNull();

    // A pending corruption-check resolution should be queued for P1
    // (Aragorn) with a -2 modifier from Barrow-wight's effect.
    const pending = afterWound.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.modifier).toBe(-2);

    const aragornId = findCharInstanceId(afterWound, RESOURCE_PLAYER, ARAGORN);
    expect(pending[0].kind.characterId).toBe(aragornId);

    const viable = viableFor(afterWound, PLAYER_1);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('corruption-check');
  });

  test('corruption check passes with high roll — character stays', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BARROW_WIGHT], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeShadowMHState() };

    const bwId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, bwId, companyId, SHADOW_KEYING);
    const afterWound = runCreatureCombat(afterChain, ARAGORN, 2, 5);

    const ccAction = viableActions(afterWound, PLAYER_1, 'corruption-check')[0].action;

    // Aragorn has 0 CP, modifier -2. Roll 12 passes easily.
    const ccState = dispatch({ ...afterWound, cheatRollTotal: 12 }, ccAction);

    expect(ccState.pendingResolutions).toHaveLength(0);

    expectCharStatus(ccState, RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
  });

  test('corruption check fails — character discarded', () => {
    // Give Aragorn items so he has corruption points
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING, DAGGER_OF_WESTERNESSE] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BARROW_WIGHT], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeShadowMHState() };

    const bwId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, bwId, companyId, SHADOW_KEYING);
    const afterWound = runCreatureCombat(afterChain, ARAGORN, 2, 5);

    const ccAction = viableActions(afterWound, PLAYER_1, 'corruption-check')[0].action;

    // Aragorn has Glamdring (2 CP) + Dagger (1 CP) = 3 CP, modifier -2
    // Roll 2 + (-2) = 0, not > 3 → fail
    const ccState = dispatch({ ...afterWound, cheatRollTotal: 2 }, ccAction);

    expect(ccState.pendingResolutions).toHaveLength(0);
    const aragornId = findCharInstanceId(afterWound, RESOURCE_PLAYER, ARAGORN);
    expect(ccState.players[0].characters[aragornId as string]).toBeUndefined();
  });

  test('character that wins strike does not get corruption check', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BARROW_WIGHT], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeShadowMHState() };

    const bwId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, bwId, companyId, SHADOW_KEYING);

    // High roll: prowess 6-3=3 + roll 10 = 13 > 12 → character wins
    // Barrow-wight has no body → combat finalizes immediately
    const afterStrike = runCreatureCombat(afterChain, ARAGORN, 10, null);
    expect(afterStrike.combat).toBeNull();

    // No pending corruption-check resolutions queued — character won.
    expect(afterStrike.pendingResolutions).toHaveLength(0);
  });

  test('hazard player has no actions during wound corruption check', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BARROW_WIGHT], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeShadowMHState() };

    const bwId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, bwId, companyId, SHADOW_KEYING);
    const afterWound = runCreatureCombat(afterChain, ARAGORN, 2, 5);

    expect(viableFor(afterWound, PLAYER_2)).toHaveLength(0);
  });
});
