/**
 * @module td-107.test
 *
 * Card test: Dragon-feuds (td-107)
 * Type: hero-resource-event (short), non-unique, 0 MP.
 *
 * Text:
 *   "Playable during the organization phase. For the rest of the turn, you
 *    may discard a Dragon or Drake hazard creature from your hand to cancel a
 *    Dragon or Drake attack against any of your companies."
 *
 * Effects:
 *   1. play-window (organization).
 *   2. on-event self-enters-play → add-constraint `discard-to-cancel-attack`
 *      (scope turn, target player), `constraintWhen` `enemy.race` in
 *      [dragon, drake] (the attack), `discardFilter` hazard-creature of race
 *      dragon/drake (the hand card paid). While the constraint lives,
 *      `cancelAttackActions` offers a `cancel-attack` (`mode:
 *      "discard-from-hand"`) per qualifying hand card; dispatching it discards
 *      that card and cancels the attack immediately. The grant is not consumed.
 *
 * Rule coverage:
 * | # | Rule                                                              | Status      |
 * |---|-------------------------------------------------------------------|-------------|
 * | 1 | Playable during the organization phase                            | IMPLEMENTED |
 * | 2 | NOT playable outside the organization phase (e.g. in combat)      | IMPLEMENTED |
 * | 3 | Playing it installs a turn-scoped grant; card is discarded        | IMPLEMENTED |
 * | 4 | Grant offers discarding a Dragon / Drake hazard creature from hand | IMPLEMENTED |
 * | 5 | Non-Dragon/Drake hand cards are not offered as the cost           | IMPLEMENTED |
 * | 6 | Only Dragon or Drake attacks can be canceled                      | IMPLEMENTED |
 * | 7 | Discarding cancels the attack and moves the card to discard       | IMPLEMENTED |
 * | 8 | "Against any of your companies" — works for every company, and    | IMPLEMENTED |
 * |   | against a Dragon automatic-attack too                             |             |
 * | 9 | "For the rest of the turn" — reusable for a later attack          | IMPLEMENTED |
 * |10 | Without Dragon-feuds played, no such cancellation exists          | IMPLEMENTED |
 *
 * Playable: YES
 * Certified: 2026-10-01
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  ARAGORN, LEGOLAS, GIMLI, RIVENDELL, LORIEN, MORIA,
  buildTestState, resetMint, makeMHState,
  findHandCardId, viableActions, dispatch, resolveChain,
  expectInDiscardPile,
} from '../test-helpers.js';
import { Phase, Race } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CombatState, GameState,
  CancelAttackAction, PlayShortEventAction,
} from '../../index.js';

const DRAGON_FEUDS = 'td-107' as CardDefinitionId;
/** Cave-drake (tw-020) — hazard creature, race "dragon". */
const CAVE_DRAKE = 'tw-020' as CardDefinitionId;
/** Land-drake (td-40) — hazard creature, race "drake". */
const LAND_DRAKE = 'td-40' as CardDefinitionId;
/** Orc-patrol (tw-074) — hazard creature, race "orc". */
const ORC_PATROL = 'tw-074' as CardDefinitionId;

/** P1 (hero) has two companies; `hand` is P1's hand. Organization phase. */
function orgState(hand: CardDefinitionId[]): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }, { site: LORIEN, characters: [GIMLI] }], hand, siteDeck: [MORIA] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
    ],
  });
}

/** Play Dragon-feuds from P1's hand during the organization phase. */
function playFeuds(state: GameState): GameState {
  const inst = findHandCardId(state, RESOURCE_PLAYER, DRAGON_FEUDS);
  const play = viableActions(state, PLAYER_1, 'play-short-event')
    .map(ea => ea.action as PlayShortEventAction)
    .find(a => a.cardInstanceId === inst);
  expect(play).toBeDefined();
  return resolveChain(dispatch(state, play!));
}

/**
 * Put P1's company #`companyIndex` under attack by a `race` attacker, in the
 * pre-strike cancel window. `auto` makes it a site automatic-attack instead
 * of a played hazard creature.
 */
function underAttack(state: GameState, race: Race, companyIndex = 0, auto = false): GameState {
  const company = state.players[RESOURCE_PLAYER].companies[companyIndex];
  const combat: CombatState = {
    attackSource: auto
      ? { type: 'automatic-attack', siteInstanceId: company.currentSite!.instanceId, attackIndex: 0 }
      : { type: 'creature', instanceId: 'attacker-1' as CardInstanceId },
    companyId: company.id,
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess: 12,
    creatureBody: null,
    creatureRace: race,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: 'defender',
    bodyCheckTarget: null,
    detainment: false,
  };
  return { ...state, phaseState: makeMHState(), combat };
}

/** Viable discard-from-hand cancel-attack actions for P1. */
function discardCancels(state: GameState): CancelAttackAction[] {
  return viableActions(state, PLAYER_1, 'cancel-attack')
    .map(ea => ea.action as CancelAttackAction)
    .filter(a => a.mode === 'discard-from-hand');
}

describe('Dragon-feuds (td-107)', () => {
  beforeEach(() => resetMint());

  test('playable during the organization phase; installs a turn-scoped player grant and is discarded', () => {
    const state = orgState([DRAGON_FEUDS, CAVE_DRAKE]);
    const feudsId = findHandCardId(state, RESOURCE_PLAYER, DRAGON_FEUDS);
    const after = playFeuds(state);

    expectInDiscardPile(after, RESOURCE_PLAYER, feudsId);
    const grant = after.activeConstraints.find(c => c.kind.type === 'discard-to-cancel-attack');
    expect(grant).toBeDefined();
    expect(grant!.scope.kind).toBe('turn');
    expect(grant!.target).toEqual({ kind: 'player', playerId: PLAYER_1 });
  });

  test('NOT playable outside the organization phase (e.g. while facing a Dragon attack)', () => {
    const state = underAttack(orgState([DRAGON_FEUDS, CAVE_DRAKE]), Race.Dragon);
    const feudsId = findHandCardId(state, RESOURCE_PLAYER, DRAGON_FEUDS);
    const plays = viableActions(state, PLAYER_1, 'play-short-event')
      .filter(ea => (ea.action as PlayShortEventAction).cardInstanceId === feudsId);
    expect(plays).toHaveLength(0);
    expect(discardCancels(state)).toHaveLength(0);
  });

  test('no discard-to-cancel option exists when Dragon-feuds was not played', () => {
    const state = underAttack(orgState([CAVE_DRAKE, LAND_DRAKE]), Race.Dragon);
    expect(discardCancels(state)).toHaveLength(0);
  });

  test('facing a Dragon attack: offers discarding each Dragon/Drake hazard creature, never an Orc', () => {
    const played = playFeuds(orgState([DRAGON_FEUDS, CAVE_DRAKE, LAND_DRAKE, ORC_PATROL]));
    const state = underAttack(played, Race.Dragon);
    const caveId = findHandCardId(state, RESOURCE_PLAYER, CAVE_DRAKE);
    const landId = findHandCardId(state, RESOURCE_PLAYER, LAND_DRAKE);

    const offered = discardCancels(state).map(a => a.cardInstanceId);
    expect(offered.sort()).toEqual([caveId, landId].sort());
  });

  test('a Drake attack can be canceled too', () => {
    const played = playFeuds(orgState([DRAGON_FEUDS, CAVE_DRAKE]));
    const state = underAttack(played, Race.Drake);
    expect(discardCancels(state)).toHaveLength(1);
  });

  test('a non-Dragon/Drake attack (Orc) cannot be canceled', () => {
    const played = playFeuds(orgState([DRAGON_FEUDS, CAVE_DRAKE, LAND_DRAKE]));
    const state = underAttack(played, Race.Orc);
    expect(discardCancels(state)).toHaveLength(0);
  });

  test('no option when no Dragon/Drake hazard creature is in hand', () => {
    const played = playFeuds(orgState([DRAGON_FEUDS, ORC_PATROL]));
    const state = underAttack(played, Race.Dragon);
    expect(discardCancels(state)).toHaveLength(0);
  });

  test('discarding the creature cancels the attack and moves it to the discard pile', () => {
    const played = playFeuds(orgState([DRAGON_FEUDS, CAVE_DRAKE]));
    const state = underAttack(played, Race.Dragon);
    const caveId = findHandCardId(state, RESOURCE_PLAYER, CAVE_DRAKE);

    const [cancel] = discardCancels(state);
    expect(cancel.cardInstanceId).toBe(caveId);
    const after = resolveChain(dispatch(state, cancel));

    expect(after.combat).toBeNull();
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === caveId)).toBe(false);
    expectInDiscardPile(after, RESOURCE_PLAYER, caveId);
  });

  test('works for any of your companies, and against a Dragon automatic-attack', () => {
    const played = playFeuds(orgState([DRAGON_FEUDS, CAVE_DRAKE]));
    const state = underAttack(played, Race.Dragon, 1, true);
    const [cancel] = discardCancels(state);
    expect(cancel).toBeDefined();

    const after = resolveChain(dispatch(state, cancel));
    expect(after.combat).toBeNull();
  });

  test('for the rest of the turn: the grant survives a use and cancels a later attack', () => {
    const played = playFeuds(orgState([DRAGON_FEUDS, CAVE_DRAKE, LAND_DRAKE]));
    const first = underAttack(played, Race.Dragon, 0);
    const afterFirst = resolveChain(dispatch(first, discardCancels(first)[0]));
    expect(afterFirst.combat).toBeNull();
    expect(afterFirst.activeConstraints.some(c => c.kind.type === 'discard-to-cancel-attack')).toBe(true);

    const second = underAttack(afterFirst, Race.Drake, 1);
    const remaining = discardCancels(second);
    expect(remaining).toHaveLength(1);
    const afterSecond = resolveChain(dispatch(second, remaining[0]));
    expect(afterSecond.combat).toBeNull();
    expect(afterSecond.players[RESOURCE_PLAYER].hand).toHaveLength(0);
  });
});
