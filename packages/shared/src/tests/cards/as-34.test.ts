/**
 * @module as-34.test
 *
 * Card test: Power Built by Waiting (as-34)
 * Type: hazard-event (permanent)
 * Effects: 3
 *
 * Text:
 *   "Tap during a company's movement/hazard phase to increase the hazard
 *    limit against that company by one. This card does not untap during
 *    your untap phase. You may use two against a company's hazard limit
 *    to untap this card."
 *
 * Effects:
 * | # | Effect Type            | Status | Notes                                          |
 * |---|------------------------|--------|------------------------------------------------|
 * | 1 | tap-for-hazard-limit   | OK     | tap card → +1 hazard limit; does not cost limit |
 * | 2 | no-auto-untap          | OK     | card stays tapped through owner's untap phase   |
 * | 3 | untap-by-hazard-limit  | OK     | spend 2 hazard limit to untap this card         |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  viableActions,
  dispatch,
  addCardInPlay,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { currentHazardLimit } from '../../engine/reducer-movement-hazard.js';
import {
  Phase, Alignment, CardStatus,
  computeLegalActions,
} from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState, MovementHazardPhaseState } from '../../index.js';

const POWER_BUILT_BY_WAITING = 'as-34' as CardDefinitionId;

function buildState(cardStatus: CardStatus, mhOverrides?: Partial<MovementHazardPhaseState>): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: MORIA, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [RIVENDELL],
      },
    ],
  });

  const withCard = addCardInPlay(base, HAZARD_PLAYER, POWER_BUILT_BY_WAITING);

  let stateWithStatus = withCard;
  if (cardStatus !== CardStatus.Untapped) {
    const p2 = withCard.players[HAZARD_PLAYER];
    const updatedCip = p2.cardsInPlay.map(c =>
      c.definitionId === POWER_BUILT_BY_WAITING ? { ...c, status: cardStatus } : c,
    );
    const updatedP2 = { ...p2, cardsInPlay: updatedCip };
    const players = [withCard.players[RESOURCE_PLAYER], updatedP2] as typeof withCard.players;
    stateWithStatus = { ...withCard, players };
  }

  const mhState = makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0, ...mhOverrides });
  return { ...stateWithStatus, phaseState: mhState };
}

function getCardInstId(state: GameState): CardInstanceId {
  const card = state.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === POWER_BUILT_BY_WAITING);
  if (!card) throw new Error('as-34 not in P2 cardsInPlay');
  return card.instanceId;
}

function getTargetCompanyId(state: GameState) {
  return state.players[RESOURCE_PLAYER].companies[0].id;
}

describe('Power Built by Waiting (as-34)', () => {
  beforeEach(() => resetMint());

  // ─── tap-for-hazard-limit ─────────────────────────────────────────────────

  test('offers tap-hazard-card-for-limit when card is untapped', () => {
    const state = buildState(CardStatus.Untapped);
    const actions = viableActions(state, PLAYER_2, 'tap-hazard-card-for-limit');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as { cardInstanceId: string }).cardInstanceId).toBe(getCardInstId(state));
    expect((actions[0].action as { targetCompanyId: string }).targetCompanyId).toBe(getTargetCompanyId(state));
  });

  test('tap-hazard-card-for-limit is non-viable when card is already tapped', () => {
    const state = buildState(CardStatus.Tapped);
    const actions = computeLegalActions(state, PLAYER_2);
    const tapActions = actions.filter(a => a.action.type === 'tap-hazard-card-for-limit');
    expect(tapActions.length).toBeGreaterThan(0);
    expect(tapActions.every(a => !a.viable)).toBe(true);
  });

  test('tapping adds a hazard-limit-modifier +1 constraint on the target company', () => {
    const state = buildState(CardStatus.Untapped);
    const compId = getTargetCompanyId(state);

    const next = dispatch(state, {
      type: 'tap-hazard-card-for-limit',
      player: PLAYER_2,
      cardInstanceId: getCardInstId(state),
      targetCompanyId: compId,
    });

    const constraint = next.activeConstraints.find(
      c => c.kind.type === 'hazard-limit-modifier' && c.target.kind === 'company' && c.target.companyId === compId,
    );
    expect(constraint).toBeDefined();
    expect((constraint!.kind as { type: string; value: number }).value).toBe(1);
  });

  test('tapping increases the running hazard limit by 1', () => {
    const state = buildState(CardStatus.Untapped);
    const compId = getTargetCompanyId(state);
    const mhState = state.phaseState as MovementHazardPhaseState;
    const limitBefore = currentHazardLimit(state, mhState, compId);

    const next = dispatch(state, {
      type: 'tap-hazard-card-for-limit',
      player: PLAYER_2,
      cardInstanceId: getCardInstId(state),
      targetCompanyId: compId,
    });

    const mhAfter = next.phaseState as MovementHazardPhaseState;
    expect(currentHazardLimit(next, mhAfter, compId)).toBe(limitBefore + 1);
  });

  test('tapping card sets its status to tapped', () => {
    const state = buildState(CardStatus.Untapped);
    const instId = getCardInstId(state);

    const next = dispatch(state, {
      type: 'tap-hazard-card-for-limit',
      player: PLAYER_2,
      cardInstanceId: instId,
      targetCompanyId: getTargetCompanyId(state),
    });

    const card = next.players[HAZARD_PLAYER].cardsInPlay.find(c => c.instanceId === instId);
    expect(card?.status).toBe(CardStatus.Tapped);
  });

  test('tapping does not increment hazardsPlayedThisCompany', () => {
    const state = buildState(CardStatus.Untapped);
    const mhBefore = state.phaseState as MovementHazardPhaseState;

    const next = dispatch(state, {
      type: 'tap-hazard-card-for-limit',
      player: PLAYER_2,
      cardInstanceId: getCardInstId(state),
      targetCompanyId: getTargetCompanyId(state),
    });

    const mhAfter = next.phaseState as MovementHazardPhaseState;
    expect(mhAfter.hazardsPlayedThisCompany).toBe(mhBefore.hazardsPlayedThisCompany);
  });

  // ─── no-auto-untap ────────────────────────────────────────────────────────

  test('card does not untap during the owner untap phase', () => {
    const base = buildTestState({
      activePlayer: PLAYER_2,
      phase: Phase.Untap,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const withCard = addCardInPlay(base, HAZARD_PLAYER, POWER_BUILT_BY_WAITING);
    const p2 = withCard.players[HAZARD_PLAYER];
    const tappedCip = p2.cardsInPlay.map(c =>
      c.definitionId === POWER_BUILT_BY_WAITING ? { ...c, status: CardStatus.Tapped } : c,
    );
    const state: GameState = {
      ...withCard,
      players: [withCard.players[RESOURCE_PLAYER], { ...p2, cardsInPlay: tappedCip }] as typeof withCard.players,
    };

    const next = dispatch(state, { type: 'untap', player: PLAYER_2 });

    const card = next.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === POWER_BUILT_BY_WAITING);
    expect(card?.status).toBe(CardStatus.Tapped);
  });

  // ─── untap-by-hazard-limit ───────────────────────────────────────────────

  test('offers pay-hazard-limit-to-untap-card when card is tapped and 2+ limit remain', () => {
    // Limit 4, 1 played → 3 remaining ≥ 2 cost
    const state = buildState(CardStatus.Tapped, { hazardsPlayedThisCompany: 1 });
    const actions = viableActions(state, PLAYER_2, 'pay-hazard-limit-to-untap-card');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as { cardInstanceId: string }).cardInstanceId).toBe(getCardInstId(state));
  });

  test('pay-hazard-limit-to-untap-card is non-viable when remaining limit < 2', () => {
    // Limit 4, 3 played → 1 remaining < 2 cost
    const state = buildState(CardStatus.Tapped, { hazardsPlayedThisCompany: 3 });
    const actions = computeLegalActions(state, PLAYER_2);
    const untapActions = actions.filter(a => a.action.type === 'pay-hazard-limit-to-untap-card');
    expect(untapActions.length).toBeGreaterThan(0);
    expect(untapActions.every(a => !a.viable)).toBe(true);
  });

  test('pay-hazard-limit-to-untap-card is non-viable when card is untapped', () => {
    const state = buildState(CardStatus.Untapped);
    const actions = computeLegalActions(state, PLAYER_2);
    const untapActions = actions.filter(a => a.action.type === 'pay-hazard-limit-to-untap-card');
    expect(untapActions.every(a => !a.viable)).toBe(true);
  });

  test('paying hazard limit to untap sets card status to Untapped', () => {
    const state = buildState(CardStatus.Tapped, { hazardsPlayedThisCompany: 0 });
    const instId = getCardInstId(state);

    const next = dispatch(state, {
      type: 'pay-hazard-limit-to-untap-card',
      player: PLAYER_2,
      cardInstanceId: instId,
      targetCompanyId: getTargetCompanyId(state),
    });

    const card = next.players[HAZARD_PLAYER].cardsInPlay.find(c => c.instanceId === instId);
    expect(card?.status).toBe(CardStatus.Untapped);
  });

  test('paying hazard limit to untap increments hazardsPlayedThisCompany by 2', () => {
    const state = buildState(CardStatus.Tapped, { hazardsPlayedThisCompany: 0 });
    const mhBefore = state.phaseState as MovementHazardPhaseState;

    const next = dispatch(state, {
      type: 'pay-hazard-limit-to-untap-card',
      player: PLAYER_2,
      cardInstanceId: getCardInstId(state),
      targetCompanyId: getTargetCompanyId(state),
    });

    const mhAfter = next.phaseState as MovementHazardPhaseState;
    expect(mhAfter.hazardsPlayedThisCompany).toBe(mhBefore.hazardsPlayedThisCompany + 2);
  });

  test('tapping then paying to untap brings card back to untapped', () => {
    // Full workflow: start untapped → tap for limit → now tapped → pay 2 limit to untap
    const state = buildState(CardStatus.Untapped, { hazardsPlayedThisCompany: 0 });
    const compId = getTargetCompanyId(state);
    const instId = getCardInstId(state);

    // Step 1: tap for hazard limit
    const afterTap = dispatch(state, {
      type: 'tap-hazard-card-for-limit',
      player: PLAYER_2,
      cardInstanceId: instId,
      targetCompanyId: compId,
    });

    const cardAfterTap = afterTap.players[HAZARD_PLAYER].cardsInPlay.find(c => c.instanceId === instId);
    expect(cardAfterTap?.status).toBe(CardStatus.Tapped);

    // Limit is now 5 (4 base + 1 from tap), 0 played → 5 remaining ≥ 2 cost
    const untapAction = viableActions(afterTap, PLAYER_2, 'pay-hazard-limit-to-untap-card');
    expect(untapAction).toHaveLength(1);

    // Step 2: pay 2 hazard limit to untap
    const afterUntap = dispatch(afterTap, {
      type: 'pay-hazard-limit-to-untap-card',
      player: PLAYER_2,
      cardInstanceId: instId,
      targetCompanyId: compId,
    });

    const cardAfterUntap = afterUntap.players[HAZARD_PLAYER].cardsInPlay.find(c => c.instanceId === instId);
    expect(cardAfterUntap?.status).toBe(CardStatus.Untapped);

    const mhFinal = afterUntap.phaseState as MovementHazardPhaseState;
    expect(mhFinal.hazardsPlayedThisCompany).toBe(2);
  });
});
