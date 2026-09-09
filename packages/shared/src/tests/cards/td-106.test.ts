/**
 * @module td-106.test
 *
 * Card test: Dragon's Hunger (td-106)
 * Type: hero-resource-event (short)
 * Alignment: wizard
 * Effects: 1
 *   1. force-opponent-discard — match: hazard-creature, sources: [hand],
 *      hazardLimitReduction: 1, fallbackRevealHand: true,
 *      fallbackCancelAttack: true, when: enemy.race in [dragon, drake]
 *
 * Text:
 *   "Playable on a Dragon or Drake attack. If one is available, opponent
 *    must discard a hazard creature from his hand; this reduces the
 *    company's hazard limit by one. Otherwise, the attack is canceled and
 *    the opponent must reveal his hand."
 *
 * "Opponent" is the attacking (hazard) player — the mirror image of the
 * hazard-phase force-opponent-discard cards (Rolled down to the Sea wh-29),
 * whose "opponent" is the resource player. Resolved immediately as a
 * combat-window short event (no chain), like its TD sibling Alert the Folk
 * (td-97).
 *
 * Engine Support:
 * | # | Rule                                                          | Status      |
 * |---|----------------------------------------------------------------|-------------|
 * | 1 | Playable only while facing a Dragon or Drake attack           | IMPLEMENTED |
 * | 2 | NOT offered outside combat (combat-only)                      | IMPLEMENTED |
 * | 3 | NOT offered against a non-Dragon/Drake attack                 | IMPLEMENTED |
 * | 4 | Opponent has a hazard creature in hand → forced discard,      | IMPLEMENTED |
 * |   | opponent's choice among hazard-creature cards only            |             |
 * | 5 | Forced discard reduces the company's hazard limit by one      | IMPLEMENTED |
 * | 6 | Attack is NOT canceled when a hazard creature is discarded    | IMPLEMENTED |
 * | 7 | No hazard creature available → attack is canceled             | IMPLEMENTED |
 * | 8 | No hazard creature available → opponent's hand is revealed    | IMPLEMENTED |
 * | 9 | No card ever disappears (discard/reveal bookkeeping correct)  | IMPLEMENTED |
 *
 * Playable: YES
 * Certified: 2026-09-08
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, GIMLI, RIVENDELL, LORIEN, MORIA,
  buildTestState, resetMint, makeMHState,
  findHandCardId, companyIdAt,
  viableActions, dispatch,
  expectInDiscardPile,
  assertEveryInstanceReachable,
} from '../test-helpers.js';
import { Phase, CardStatus, Race, computeLegalActions } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CombatState, GameState,
  ForceDiscardCardAction,
} from '../../index.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──

/** Dragon's Hunger — the card under test. */
const DRAGONS_HUNGER = 'td-106' as CardDefinitionId;

/** Cave-drake (tw-020) — race "dragon", hazard-creature. */
const CAVE_DRAKE = 'tw-020' as CardDefinitionId;
/** Land-drake (td-40) — race "drake", hazard-creature. */
const LAND_DRAKE = 'td-40' as CardDefinitionId;
/** Orc-patrol (tw-074) — race "orc", not a Dragon/Drake attack. */
const ORC_PATROL = 'tw-074' as CardDefinitionId;

/** Build an M/H-phase base state; `hazardHand` is the attacking (opponent) player's hand. */
function baseState(hazardHand: CardDefinitionId[]): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }],
        hand: [DRAGONS_HUNGER],
        siteDeck: [MORIA],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [] }],
        hand: hazardHand,
        siteDeck: [MORIA],
      },
    ],
  });
}

/**
 * Overwrites `state` with a live combat: `creatureDefId` (of race `race`)
 * attacks PLAYER_1's company, played by PLAYER_2. Mirrors the manual combat
 * construction used by Alert the Folk's own test (td-97).
 */
function attackWith(state: GameState, creatureDefId: CardDefinitionId, race: Race): GameState {
  const creatureInstanceId = 'creature-1' as CardInstanceId;
  const hazardPlayer = state.players[HAZARD_PLAYER];
  const players = [
    state.players[RESOURCE_PLAYER],
    {
      ...hazardPlayer,
      cardsInPlay: [
        ...hazardPlayer.cardsInPlay,
        { instanceId: creatureInstanceId, definitionId: creatureDefId, status: CardStatus.Untapped },
      ],
    },
  ] as unknown as typeof state.players;

  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: creatureInstanceId },
    companyId: companyIdAt(state, RESOURCE_PLAYER),
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess: 9,
    creatureBody: null,
    creatureRace: race,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: 'defender',
    bodyCheckTarget: null,
    detainment: false,
  };
  return { ...state, players, phaseState: makeMHState(), combat };
}

describe("Dragon's Hunger (td-106)", () => {
  beforeEach(() => resetMint());

  // ── Rule 2: combat-only — not offered outside combat ───────────────────

  test('not playable as a short event outside combat', () => {
    const state = baseState([ORC_PATROL]);
    const actions = computeLegalActions(state, PLAYER_1);
    const cardInstance = findHandCardId(state, RESOURCE_PLAYER, DRAGONS_HUNGER);

    const shortEvent = actions.find(
      a => a.viable && a.action.type === 'play-short-event' &&
        a.action.cardInstanceId === cardInstance,
    );
    expect(shortEvent).toBeUndefined();
  });

  // ── Rule 1: offered when facing a Dragon attack ────────────────────────

  test('offered when facing a Dragon attack (Cave-drake)', () => {
    const state = attackWith(baseState([ORC_PATROL]), CAVE_DRAKE, Race.Dragon);
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(actions.length).toBeGreaterThan(0);
  });

  // ── Rule 1: offered when facing a Drake attack ─────────────────────────

  test('offered when facing a Drake attack (Land-drake)', () => {
    const state = attackWith(baseState([ORC_PATROL]), LAND_DRAKE, Race.Drake);
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(actions.length).toBeGreaterThan(0);
  });

  // ── Rule 3: NOT offered against a non-Dragon/Drake attack ──────────────

  test('NOT offered when facing an Orc attack', () => {
    const state = attackWith(baseState([ORC_PATROL]), ORC_PATROL, Race.Orc);
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(actions).toHaveLength(0);
  });

  // ── Rules 4, 5, 6: opponent has a hazard creature → forced discard, hazard-limit -1, attack continues ──

  test('opponent holding a hazard creature must discard it; hazard limit reduced by one; attack continues', () => {
    const state = attackWith(baseState([ORC_PATROL, GIMLI]), CAVE_DRAKE, Race.Dragon);
    const eventInstance = findHandCardId(state, RESOURCE_PLAYER, DRAGONS_HUNGER);
    const orcPatrolId = findHandCardId(state, HAZARD_PLAYER, ORC_PATROL);
    const gimliId = findHandCardId(state, HAZARD_PLAYER, GIMLI);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const afterPlay = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: eventInstance,
    });

    // The attack is not canceled — combat is still active.
    expect(afterPlay.combat).not.toBeNull();

    // A force-discard-card pending resolution is enqueued for the opponent,
    // listing only the hazard-creature (not the non-hazard-creature card).
    const pending = afterPlay.pendingResolutions.find(r => r.kind.type === 'force-discard-card');
    expect(pending).toBeDefined();
    expect(pending!.actor).toBe(PLAYER_2);
    const candidates = (pending!.kind as { candidateInstanceIds: readonly CardInstanceId[] }).candidateInstanceIds;
    expect(candidates).toEqual([orcPatrolId]);
    expect(candidates).not.toContain(gimliId);

    // Hazard limit against the company is reduced by one (scoped to its M/H phase).
    const hazardLimitConstraints = afterPlay.activeConstraints.filter(c => c.kind.type === 'hazard-limit-modifier');
    expect(hazardLimitConstraints).toHaveLength(1);
    const constraint = hazardLimitConstraints[0];
    if (constraint.kind.type === 'hazard-limit-modifier') {
      expect(constraint.kind.value).toBe(-1);
    }
    expect(constraint.scope.kind).toBe('company-mh-phase');
    expect(constraint.target.kind).toBe('company');
    if (constraint.target.kind === 'company') {
      expect(constraint.target.companyId).toBe(companyId);
    }

    // Resolving the discard: the opponent chooses the hazard creature (only
    // one candidate is offered), moving it from hand to their discard pile.
    const discardActions = viableActions(afterPlay, PLAYER_2, 'force-discard-card');
    expect(discardActions).toHaveLength(1);
    expect((discardActions[0].action as ForceDiscardCardAction).cardInstanceId).toBe(orcPatrolId);

    const resolved = dispatch(afterPlay, discardActions[0].action);
    expect(resolved.players[HAZARD_PLAYER].hand.some(c => c.instanceId === orcPatrolId)).toBe(false);
    expect(resolved.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === orcPatrolId)).toBe(true);
    // The non-hazard-creature hand card is untouched.
    expect(resolved.players[HAZARD_PLAYER].hand.some(c => c.instanceId === gimliId)).toBe(true);
    // The event card itself is discarded.
    expectInDiscardPile(resolved, RESOURCE_PLAYER, DRAGONS_HUNGER);
    assertEveryInstanceReachable(resolved);
  });

  // ── Rules 7, 8: no hazard creature available → attack canceled + hand revealed ──

  test('opponent with no hazard creature: attack is canceled and hand is revealed', () => {
    const state = attackWith(baseState([GIMLI]), CAVE_DRAKE, Race.Dragon);
    const eventInstance = findHandCardId(state, RESOURCE_PLAYER, DRAGONS_HUNGER);
    const gimliId = findHandCardId(state, HAZARD_PLAYER, GIMLI);

    const afterPlay = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: eventInstance,
    });

    // No discard resolution — nothing to discard.
    expect(afterPlay.pendingResolutions.some(r => r.kind.type === 'force-discard-card')).toBe(false);
    // No hazard-limit reduction either (the reduction only follows a forced discard).
    expect(afterPlay.activeConstraints.some(c => c.kind.type === 'hazard-limit-modifier')).toBe(false);
    // The opponent's hand is revealed.
    expect(afterPlay.revealedInstances[gimliId]).toBe(GIMLI);
    expect(afterPlay.players[HAZARD_PLAYER].hand.some(c => c.instanceId === gimliId)).toBe(true);
    // The attack is canceled.
    expect(afterPlay.combat).toBeNull();
    // The event card itself is discarded.
    expectInDiscardPile(afterPlay, RESOURCE_PLAYER, DRAGONS_HUNGER);
    assertEveryInstanceReachable(afterPlay);
  });
});
