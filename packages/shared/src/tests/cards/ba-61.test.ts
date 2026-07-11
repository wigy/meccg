/**
 * @module ba-61.test
 *
 * Card test: Great Fissure (ba-61)
 * Type: minion-resource-event (Short-event), Balrog specific, 0 MP.
 *
 * Card text:
 *   "Balrog specific. Target and cancel any effect (declared earlier in the
 *    same chain of effects) that would cancel an attack by The Balrog's company
 *    against an opponent's company. Alternatively, cancel an attack against a
 *    company at, or moving to or from, an Under-deeps site."
 *
 * Engine Support:
 * | # | Feature                                              | Status      | Notes                                             |
 * |---|------------------------------------------------------|-------------|---------------------------------------------------|
 * | 1 | Counter-cancel an opponent's cancel of the Balrog's  | IMPLEMENTED | cancel-chain-attack-cancel + counter-cancel-attack |
 * |   | company-vs-company attack (chain response)           |             | action (chain-reducer)                            |
 * | 2 | Cancel an attack against a company at / moving to or | IMPLEMENTED | cancel-attack with when { attack.atUnderDeeps }   |
 * |   | from an Under-deeps site                             |             |                                                   |
 *
 * "Balrog specific" is a deck-construction keyword with no play-time gate
 * (ba-45/ba-46 precedent).
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  makeSitePhase,
  mint,
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  MORIA,
  makeCancelWindowCombat,
  resolveChain,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type {
  CardDefinitionId,
  CombatState,
  CompanyId,
  CancelAttackAction,
  CounterCancelAttackAction,
} from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { reduce } from '../../engine/reducer.js';
import { initiateChain } from '../../engine/chain-reducer.js';

const GREAT_FISSURE = 'ba-61' as CardDefinitionId;
const THE_BALROG = 'ba-3' as CardDefinitionId;
const DROWNING_DEEPS = 'ba-89' as CardDefinitionId; // Under-deeps site (ruins-and-lairs, keyword under-deeps)
const DIVERSION = 'le-180' as CardDefinitionId; // costless cancel-attack card (opponent's chain entry)
const ORC_WARBAND = 'tw-074' as CardDefinitionId;

describe('Great Fissure (ba-61)', () => {
  beforeEach(() => resetMint());

  // ─── Mode A: counter-cancel the Balrog's company attack ───────────────────

  /**
   * Build a CvCC state: PLAYER_1 (Balrog) attacks PLAYER_2's company, then
   * PLAYER_2 declares a cancel-attack card on the chain. Priority returns to
   * PLAYER_1, who holds Great Fissure.
   */
  function buildCounterCancelState(opts: { attackerHasBalrog?: boolean } = {}) {
    const attacker = opts.attackerHasBalrog ?? true;
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: MORIA, characters: attacker ? [THE_BALROG] : [ORC_WARBAND] }],
          hand: [GREAT_FISSURE],
          siteDeck: [DROWNING_DEEPS],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MORIA, characters: [ORC_WARBAND] }],
          hand: [],
          siteDeck: [DROWNING_DEEPS],
        },
      ],
    });

    const attackingCompanyId = `company-${PLAYER_1 as string}-0` as CompanyId;
    const defendingCompanyId = `company-${PLAYER_2 as string}-0` as CompanyId;

    const combat: CombatState = {
      attackSource: { type: 'company-attack', attackingCompanyId },
      isCvCC: true,
      companyId: defendingCompanyId,
      defendingPlayerId: PLAYER_2,
      attackingPlayerId: PLAYER_1,
      strikesTotal: 1,
      strikeProwess: 0,
      creatureBody: null,
      strikeAssignments: [],
      currentStrikeIndex: 0,
      phase: 'assign-strikes',
      assignmentPhase: 'defender',
      bodyCheckTarget: null,
      detainment: false,
    };

    const withCombat = { ...base, combat, phaseState: makeSitePhase() };

    // PLAYER_2 (defender) declares a cancel-attack card on the chain.
    const diversionCard = { instanceId: mint(), definitionId: DIVERSION };
    const withChain = initiateChain(withCombat, PLAYER_2, diversionCard, { type: 'short-event' });

    return { state: withChain, diversionInstanceId: diversionCard.instanceId };
  }

  test('after opponent declares a cancel-attack, priority returns to the Balrog attacker', () => {
    const { state } = buildCounterCancelState();
    expect(state.chain!.priority).toBe(PLAYER_1);
  });

  test('counter-cancel-attack IS offered to the Balrog attacker against the opponent\'s cancel', () => {
    const { state, diversionInstanceId } = buildCounterCancelState();
    const fissureId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'counter-cancel-attack')
      .map(ea => ea.action as CounterCancelAttackAction);

    expect(actions.some(a => a.cardInstanceId === fissureId
      && a.targetInstanceId === diversionInstanceId)).toBe(true);
  });

  test('counter-cancel-attack is NOT offered when the attacking company lacks The Balrog', () => {
    const { state } = buildCounterCancelState({ attackerHasBalrog: false });

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'counter-cancel-attack');

    expect(actions).toHaveLength(0);
  });

  test('counter-cancel-attack is NOT offered to the defending (opponent) player', () => {
    const { state } = buildCounterCancelState();
    // Give the defender a copy in hand too — they still may not counter-cancel.
    const defenderCard = { instanceId: mint(), definitionId: GREAT_FISSURE };
    const withDefenderCard = {
      ...state,
      players: [
        state.players[RESOURCE_PLAYER],
        { ...state.players[HAZARD_PLAYER], hand: [defenderCard] },
      ] as unknown as typeof state.players,
    };

    // The defender does not have priority here, but even asking directly yields nothing.
    const actions = computeLegalActions(withDefenderCard, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'counter-cancel-attack');

    expect(actions).toHaveLength(0);
  });

  test('dispatching counter-cancel-attack negates the cancel, discards Great Fissure, flips priority', () => {
    const { state, diversionInstanceId } = buildCounterCancelState();
    const fissureId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const action: CounterCancelAttackAction = {
      type: 'counter-cancel-attack',
      player: PLAYER_1,
      cardInstanceId: fissureId,
      targetInstanceId: diversionInstanceId,
    };
    const result = reduce(state, action);
    expect(result.error).toBeUndefined();

    // The opponent's cancel-attack chain entry is negated.
    const entry = result.state.chain!.entries.find(e => e.card?.instanceId === diversionInstanceId);
    expect(entry?.negated).toBe(true);

    // Great Fissure left the Balrog player's hand for the discard pile.
    expect(result.state.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === fissureId)).toBe(false);
    expect(result.state.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === fissureId)).toBe(true);

    // Priority flipped to the opponent so they may respond.
    expect(result.state.chain!.priority).toBe(PLAYER_2);

    // Combat still active — the attack survives the negated cancel.
    expect(result.state.combat).not.toBeNull();
  });

  test('after resolution the negated cancel does not cancel the attack (combat survives)', () => {
    const { state, diversionInstanceId } = buildCounterCancelState();
    const fissureId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const afterCounter = reduce(state, {
      type: 'counter-cancel-attack',
      player: PLAYER_1,
      cardInstanceId: fissureId,
      targetInstanceId: diversionInstanceId,
    }).state;

    // Both players pass — the chain resolves. The negated Diversion never fires
    // its cancel-attack, so combat is still active afterward.
    const resolved = resolveChain(afterCounter);
    expect(resolved.chain).toBeNull();
    expect(resolved.combat).not.toBeNull();
  });

  // ─── Mode B: cancel an attack at / moving to-or-from an Under-deeps site ───

  /** Attack against PLAYER_1's company; Great Fissure sits in PLAYER_1's hand. */
  function buildUnderDeepsCancelState(opts: { site: CardDefinitionId; destinationSite?: CardDefinitionId }) {
    const base = buildTestState({
      activePlayer: PLAYER_2,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: opts.site, characters: [THE_BALROG], ...(opts.destinationSite ? { destinationSite: opts.destinationSite } : {}) }],
          hand: [GREAT_FISSURE],
          siteDeck: [DROWNING_DEEPS],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MORIA, characters: [ORC_WARBAND] }],
          hand: [],
          siteDeck: [DROWNING_DEEPS],
        },
      ],
    });
    return makeCancelWindowCombat(base, { creatureRace: 'orc', strikesTotal: 1 });
  }

  test('cancel-attack IS offered when the defending company is AT an Under-deeps site', () => {
    const state = buildUnderDeepsCancelState({ site: DROWNING_DEEPS });
    const fissureId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction);

    expect(actions.some(a => a.cardInstanceId === fissureId)).toBe(true);
  });

  test('cancel-attack IS offered when the defending company is MOVING TO an Under-deeps site', () => {
    const state = buildUnderDeepsCancelState({ site: MORIA, destinationSite: DROWNING_DEEPS });
    const fissureId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction);

    expect(actions.some(a => a.cardInstanceId === fissureId)).toBe(true);
  });

  test('cancel-attack IS offered when the defending company is MOVING FROM an Under-deeps site', () => {
    const state = buildUnderDeepsCancelState({ site: DROWNING_DEEPS, destinationSite: MORIA });
    const fissureId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction);

    expect(actions.some(a => a.cardInstanceId === fissureId)).toBe(true);
  });

  test('cancel-attack is NOT offered when the company is not at / moving to-or-from an Under-deeps site', () => {
    const state = buildUnderDeepsCancelState({ site: MORIA });
    const fissureId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction);

    expect(actions.some(a => a.cardInstanceId === fissureId)).toBe(false);
  });

  test('dispatching the Under-deeps cancel and resolving the chain cancels the attack', () => {
    const state = buildUnderDeepsCancelState({ site: DROWNING_DEEPS });
    const fissureId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const cancelAction = computeLegalActions(state, PLAYER_1)
      .map(ea => ea.action)
      .find((a): a is CancelAttackAction => a.type === 'cancel-attack'
        && a.cardInstanceId === fissureId);
    expect(cancelAction).toBeDefined();

    const afterCancel = reduce(state, cancelAction!);
    expect(afterCancel.error).toBeUndefined();

    // Great Fissure left hand (played onto the chain).
    expect(afterCancel.state.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === fissureId)).toBe(false);

    // Resolve the chain (both pass) — the cancel-attack fires and combat ends.
    const resolved = resolveChain(afterCancel.state);
    expect(resolved.combat).toBeNull();
  });
});
