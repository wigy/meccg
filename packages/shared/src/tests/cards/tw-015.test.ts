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
  buildTestState, resetMint, makeMHState,
  reduce, pool, resolveChain, findCharInstanceId,
  viableActions,
} from '../test-helpers.js';
import { computeLegalActions, Phase, RegionType, SiteType, CardStatus } from '../../index.js';
import type { CreatureCard, MovementHazardPhaseState, GameState } from '../../index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a state with Barrow-wight in P2's hand, ready to play as a hazard
 * during M/H play-hazards step. P1 has Aragorn at Moria.
 */
function buildBarrowWightState(characters: Parameters<typeof buildTestState>[0]['players'][0]['companies'][0]['characters'] = [ARAGORN]) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA, characters }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [BARROW_WIGHT],
        siteDeck: [RIVENDELL],
      },
    ],
  });

  const mhState = makeMHState({
    resolvedSitePath: [RegionType.Shadow],
    resolvedSitePathNames: ['Imlad Morgul'],
    destinationSiteType: SiteType.ShadowHold,
    destinationSiteName: 'Moria',
  });
  return { ...state, phaseState: mhState };
}

/** Play Barrow-wight and resolve chain to get into combat. */
function playBarrowWight(state: GameState) {
  const bwId = state.players[1].hand[0].instanceId;
  const companyId = state.players[0].companies[0].id;
  const result = reduce(state, {
    type: 'play-hazard',
    player: PLAYER_2,
    cardInstanceId: bwId,
    targetCompanyId: companyId,
    keyedBy: { method: 'region-type' as const, value: 'shadow' },
  });
  expect(result.error).toBeUndefined();
  return resolveChain(result.state);
}

/** Assign the single strike to Aragorn. */
function assignStrikeToAragorn(state: GameState) {
  const actions = viableActions(state, PLAYER_1, 'assign-strike');
  expect(actions.length).toBeGreaterThan(0);
  const result = reduce(state, actions[0].action);
  expect(result.error).toBeUndefined();
  return result.state;
}

/** Get and execute a viable action of the given type. */
function doAction(state: GameState, player: typeof PLAYER_1, actionType: string, roll?: number) {
  const s = roll !== undefined ? { ...state, cheatRollTotal: roll } : state;
  const actions = viableActions(s, player, actionType);
  expect(actions.length).toBeGreaterThan(0);
  // For resolve-strike, prefer the non-tap variant (stay untapped for lower prowess)
  let action = actions[0].action;
  if (actionType === 'resolve-strike') {
    const noTap = actions.find(a => 'tapToFight' in a.action && !a.action.tapToFight);
    if (noTap) action = noTap.action;
  }
  const result = reduce(s, action);
  expect(result.error).toBeUndefined();
  return result.state;
}

/**
 * Wound Aragorn: low strike roll → wounded, then body check pass → survives.
 * Returns state with pending wound corruption checks.
 */
function woundAragorn(state: GameState) {
  const assigned = assignStrikeToAragorn(state);
  // Strike roll 2: Aragorn prowess 6-3=3 + 2 = 5 < 12 → wounded
  const afterStrike = doAction(assigned, PLAYER_1, 'resolve-strike', 2);
  // Body check: opponent (P2) rolls. Roll 5 ≤ body 9 → survives wounded
  const bodyPlayer = afterStrike.combat?.attackingPlayerId ?? PLAYER_2;
  const afterBody = doAction(afterStrike, bodyPlayer, 'body-check-roll', 5);
  expect(afterBody.combat).toBeNull();
  return afterBody;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Barrow-wight (tw-015)', () => {
  beforeEach(() => resetMint());

  test('card definition has correct stats and on-event effect', () => {
    const def = pool[BARROW_WIGHT as string] as CreatureCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hazard-creature');
    expect(def.name).toBe('Barrow-wight');
    expect(def.race).toBe('undead');
    expect(def.strikes).toBe(1);
    expect(def.prowess).toBe(12);
    expect(def.body).toBeNull();
    expect(def.killMarshallingPoints).toBe(1);
    expect(def.effects).toBeDefined();
    expect(def.effects).toHaveLength(1);
    expect(def.effects![0]).toEqual({
      type: 'on-event',
      event: 'character-wounded-by-self',
      apply: { type: 'force-check', check: 'corruption', modifier: -2 },
      target: 'wounded-character',
    });
  });

  test('combat initiates with 1 strike and 12 prowess', () => {
    const state = buildBarrowWightState();
    const afterChain = playBarrowWight(state);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(12);
    expect(afterChain.combat!.attackSource.type).toBe('creature');
  });

  test('wounded character gets corruption check with -2 modifier', () => {
    const state = buildBarrowWightState();
    const afterChain = playBarrowWight(state);
    const afterWound = woundAragorn(afterChain);

    // Wound corruption check should be pending in M/H phase state
    const mhState = afterWound.phaseState as MovementHazardPhaseState;
    expect(mhState.pendingWoundCorruptionChecks).toHaveLength(1);
    expect(mhState.pendingWoundCorruptionChecks[0].modifier).toBe(-2);

    const aragornId = findCharInstanceId(afterWound, 0, ARAGORN);
    expect(mhState.pendingWoundCorruptionChecks[0].characterId).toBe(aragornId);

    // Legal actions should offer corruption-check
    const actions = computeLegalActions(afterWound, PLAYER_1);
    const viable = actions.filter(a => a.viable);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('corruption-check');
  });

  test('corruption check passes with high roll — character stays', () => {
    const state = buildBarrowWightState();
    const afterChain = playBarrowWight(state);
    const afterWound = woundAragorn(afterChain);

    const actions = computeLegalActions(afterWound, PLAYER_1);
    const ccAction = actions.find(a => a.viable && a.action.type === 'corruption-check')!.action;

    // Aragorn has 0 CP, modifier -2. Roll 12 passes easily.
    const ccResult = reduce({ ...afterWound, cheatRollTotal: 12 }, ccAction);
    expect(ccResult.error).toBeUndefined();

    const mhState = ccResult.state.phaseState as MovementHazardPhaseState;
    expect(mhState.pendingWoundCorruptionChecks).toHaveLength(0);

    const aragornId = findCharInstanceId(ccResult.state, 0, ARAGORN);
    expect(ccResult.state.players[0].characters[aragornId as string]).toBeDefined();
    expect(ccResult.state.players[0].characters[aragornId as string].status).toBe(CardStatus.Inverted);
  });

  test('corruption check fails — character discarded', () => {
    // Give Aragorn items so he has corruption points
    const state = buildBarrowWightState([{ defId: ARAGORN, items: [GLAMDRING, DAGGER_OF_WESTERNESSE] }]);
    const afterChain = playBarrowWight(state);
    const afterWound = woundAragorn(afterChain);

    const actions = computeLegalActions(afterWound, PLAYER_1);
    const ccAction = actions.find(a => a.viable && a.action.type === 'corruption-check')!.action;

    // Aragorn has Glamdring (2 CP) + Dagger (1 CP) = 3 CP, modifier -2
    // Roll 2 + (-2) = 0, not > 3 → fail
    const ccResult = reduce({ ...afterWound, cheatRollTotal: 2 }, ccAction);
    expect(ccResult.error).toBeUndefined();

    const mhStateAfter = ccResult.state.phaseState as MovementHazardPhaseState;
    expect(mhStateAfter.pendingWoundCorruptionChecks).toHaveLength(0);
    const aragornId = findCharInstanceId(afterWound, 0, ARAGORN);
    expect(ccResult.state.players[0].characters[aragornId as string]).toBeUndefined();
  });

  test('character that wins strike does not get corruption check', () => {
    const state = buildBarrowWightState();
    const afterChain = playBarrowWight(state);
    const assigned = assignStrikeToAragorn(afterChain);

    // High roll: prowess 6-3=3 + roll 10 = 13 > 12 → character wins
    const afterStrike = doAction(assigned, PLAYER_1, 'resolve-strike', 10);
    // Barrow-wight has no body → combat finalizes immediately
    expect(afterStrike.combat).toBeNull();

    const mhState = afterStrike.phaseState as MovementHazardPhaseState;
    expect(mhState.pendingWoundCorruptionChecks).toHaveLength(0);
  });

  test('hazard player has no actions during wound corruption check', () => {
    const state = buildBarrowWightState();
    const afterChain = playBarrowWight(state);
    const afterWound = woundAragorn(afterChain);

    const hazardActions = computeLegalActions(afterWound, PLAYER_2);
    expect(hazardActions.filter(a => a.viable)).toHaveLength(0);
  });
});
