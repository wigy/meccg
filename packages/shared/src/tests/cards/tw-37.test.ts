/**
 * @module tw-37.test
 *
 * Card test: Ghosts (tw-37)
 * Type: hazard-creature
 * Race: Undead. Three strikes at prowess 9.
 * Effects: 1 (on-event: character-wounded-by-self → force corruption check -1)
 *
 * "Undead. Three strikes. After attack, each character wounded by Ghosts
 *  makes a corruption check modified by -1."
 *
 * Keyed to: Shadow-land [{s}] or Dark-domain [{d}] region types,
 *           or Shadow-hold [{S}] or Dark-hold [{D}] site types.
 *
 * Multi-strike combat flow: after all strikes are assigned, the engine enters
 * choose-strike-order so the defender picks which assigned strike resolves
 * next. When only one unresolved strike remains it is auto-selected.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, FARAMIR,
  GLAMDRING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeShadowMHState,
  findCharInstanceId,
  playCreatureHazardAndResolve, executeAction,
  handCardId, companyIdAt, dispatch,
  viableActions, viableFor, RESOURCE_PLAYER, HAZARD_PLAYER,
  expectCharStatus, expectCharNotInPlay,
} from '../test-helpers.js';
import { Phase, CardStatus } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const GHOSTS = 'tw-37' as CardDefinitionId;
const SHADOW_KEYING = { method: 'region-type' as const, value: 'shadow' };

describe('Ghosts (tw-37)', () => {
  beforeEach(() => resetMint());

  test('combat initiates with 3 strikes and 9 prowess', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [GHOSTS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeShadowMHState() };

    const ghostsId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, ghostsId, companyId, SHADOW_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(3);
    expect(afterChain.combat!.strikeProwess).toBe(9);
    expect(afterChain.combat!.attackSource.type).toBe('creature');
  });

  test('wounded character gets corruption check with -1 modifier', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS, GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FARAMIR] }], hand: [GHOSTS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeShadowMHState() };

    const ghostsId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, ghostsId, companyId, SHADOW_KEYING);

    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(afterChain, RESOURCE_PLAYER, LEGOLAS);
    const gimliId = findCharInstanceId(afterChain, RESOURCE_PLAYER, GIMLI);

    // Assign all 3 strikes before resolving (triggers choose-strike-order)
    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: gimliId });

    // Defender picks ARAGORN (index 0) first
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    // ARAGORN (prowess 6): roll 2 → 2+(6-3)=5 < 9 → wounded; body roll 5 ≤ 9 → survives
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);
    s = executeAction(s, PLAYER_2, 'body-check-roll', 5);
    // 2 unresolved → choose-strike-order again; picks LEGOLAS (index 1)
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    // LEGOLAS wins (roll 12)
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);
    // Last strike (GIMLI) auto-selected → resolve directly
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);
    expect(s.combat).toBeNull();

    // Only ARAGORN (wounded) should have a pending corruption check with -1 modifier
    const pending = s.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.modifier).toBe(-1);
    expect(pending[0].kind.characterId).toBe(aragornId);

    const viable = viableFor(s, PLAYER_1);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('corruption-check');
  });

  test('corruption check passes with high roll — wounded character stays', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS, GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FARAMIR] }], hand: [GHOSTS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeShadowMHState() };

    const ghostsId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, ghostsId, companyId, SHADOW_KEYING);

    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(afterChain, RESOURCE_PLAYER, LEGOLAS);
    const gimliId = findCharInstanceId(afterChain, RESOURCE_PLAYER, GIMLI);

    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: gimliId });
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);
    s = executeAction(s, PLAYER_2, 'body-check-roll', 5);
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);

    const ccAction = viableActions(s, PLAYER_1, 'corruption-check')[0].action;

    // ARAGORN has 0 CP; roll 12 → 12-1=11 > 0 → passes
    const ccState = dispatch({ ...s, cheatRollTotal: 12 }, ccAction);

    expect(ccState.pendingResolutions).toHaveLength(0);
    expectCharStatus(ccState, RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
  });

  test('corruption check fails — wounded character discarded', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING] }, LEGOLAS, GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FARAMIR] }], hand: [GHOSTS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeShadowMHState() };

    const ghostsId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, ghostsId, companyId, SHADOW_KEYING);

    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(afterChain, RESOURCE_PLAYER, LEGOLAS);
    const gimliId = findCharInstanceId(afterChain, RESOURCE_PLAYER, GIMLI);

    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: gimliId });
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);
    s = executeAction(s, PLAYER_2, 'body-check-roll', 5);
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);

    const ccAction = viableActions(s, PLAYER_1, 'corruption-check')[0].action;

    // ARAGORN has GLAMDRING (2 CP); roll 2 → 2-1=1, not > 2 → fails
    const ccState = dispatch({ ...s, cheatRollTotal: 2 }, ccAction);

    expect(ccState.pendingResolutions).toHaveLength(0);
    expectCharNotInPlay(ccState, RESOURCE_PLAYER, aragornId);
  });

  test('character that wins strike does not get corruption check', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS, GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FARAMIR] }], hand: [GHOSTS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeShadowMHState() };

    const ghostsId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, ghostsId, companyId, SHADOW_KEYING);

    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(afterChain, RESOURCE_PLAYER, LEGOLAS);
    const gimliId = findCharInstanceId(afterChain, RESOURCE_PLAYER, GIMLI);

    // Assign all 3 strikes; all characters win with roll 12
    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: gimliId });
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);
    expect(s.combat).toBeNull();

    // No pending corruption-check resolutions — nobody was wounded
    expect(s.pendingResolutions).toHaveLength(0);
  });

  test('hazard player has no actions during wound corruption check', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS, GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FARAMIR] }], hand: [GHOSTS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeShadowMHState() };

    const ghostsId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, ghostsId, companyId, SHADOW_KEYING);

    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(afterChain, RESOURCE_PLAYER, LEGOLAS);
    const gimliId = findCharInstanceId(afterChain, RESOURCE_PLAYER, GIMLI);

    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: gimliId });
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);
    s = executeAction(s, PLAYER_2, 'body-check-roll', 5);
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);

    expect(viableFor(s, PLAYER_2)).toHaveLength(0);
  });
});
