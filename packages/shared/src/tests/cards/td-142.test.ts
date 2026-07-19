/**
 * @module td-142.test
 *
 * Card test: Nenseldë the Wingild (td-142)
 * Type: hero-resource-ally (unique, prowess null, body null, 2 ally MP,
 * playable at Dol Amroth)
 *
 * "Unique. Playable at Dol Amroth. May not be attacked. Tap Nenseldë to
 *  return one environment resource long-event or short-event from your
 *  discard pile to your hand. Discard Nenseldë if her company moves to a
 *  site that is not in: Belfalas, Bay of Belfalas, Anfalas, or Mouths of
 *  the Anduin."
 *
 * Rules tested:
 * 1. Playability — "Playable at Dol Amroth": offered at Dol Amroth (Belfalas),
 *    refused elsewhere (Rivendell).
 * 2. May not be attacked (play-flag: no-attack): Nenseldë is never offered as a
 *    strike target in either the defender or attacker strike-assignment window,
 *    while her bearer character remains targetable (protection is not blanket).
 * 3. Tap ability — tap Nenseldë (the ally) to fetch one environment long/short
 *    event from the discard pile into hand. Permanent environments (Gates of
 *    Morning) and non-environment events (Wizard's Laughter) are excluded.
 * 4. Discard-on-move — her company is discarded whenever it completes a move to
 *    a site outside {Belfalas, Bay of Belfalas, Anfalas, Mouths of the Anduin};
 *    she survives a move to any allowed-region site.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  Phase, CardStatus,
  ARAGORN, LEGOLAS,
  SUN, GATES_OF_MORNING, WIZARDS_LAUGHTER,
  DOL_AMROTH, LOND_GALEN, TOLFALAS, RIVENDELL, LORIEN, MINAS_TIRITH, MORIA,
  buildTestState, buildSitePhaseState, resetMint,
  viableActions, nonViableOfType, dispatch, findCharInstanceId,
  attachAllyToChar, makeMHState, makePlayDeck,
  makeCancelWindowCombat, assertEveryInstanceReachable, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type {
  ActivateGrantedAction, AssignStrikeAction, CombatState,
  CardDefinitionId, GameState,
} from '../../index.js';
import { computeLegalActions, RegionType } from '../../index.js';

const NENSELDE = 'td-142' as CardDefinitionId;
const STARS = 'tw-331' as CardDefinitionId;   // environment short-event

const FETCH_ACTION = 'nenselde-fetch-environment';

describe('Nenseldë the Wingild (td-142)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: playable only at Dol Amroth ───────────────────────────────────

  test('playable at Dol Amroth', () => {
    const state = buildSitePhaseState({ characters: [ARAGORN], site: DOL_AMROTH, hand: [NENSELDE] });
    const nenseldeInst = state.players[0].hand.find(c => c.definitionId === NENSELDE)!.instanceId;
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource')
      .filter(ea => (ea.action as { cardInstanceId: string }).cardInstanceId === (nenseldeInst as unknown as string));
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at any other site (Rivendell)', () => {
    const state = buildSitePhaseState({ characters: [ARAGORN], site: RIVENDELL, hand: [NENSELDE] });
    const nenseldeInst = state.players[0].hand.find(c => c.definitionId === NENSELDE)!.instanceId;
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource')
      .filter(ea => (ea.action as { cardInstanceId: string }).cardInstanceId === (nenseldeInst as unknown as string));
    expect(plays).toHaveLength(0);
    const blocked = nonViableOfType(computeLegalActions(state, PLAYER_1), 'not-playable')
      .find(a => (a.action as { cardInstanceId: string }).cardInstanceId === (nenseldeInst as unknown as string));
    expect(blocked?.reason).toContain('not playable');
  });

  // ─── Rule 2: may not be attacked (play-flag: no-attack) ─────────────────────

  test('Nenseldë is NOT offered as a strike target by the defending player', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, NENSELDE);
    const withCombat = makeCancelWindowCombat(withAlly, {
      creatureRace: 'orc',
      attackKeying: [RegionType.Wilderness],
      strikesTotal: 2,
    });

    const aragornId = findCharInstanceId(withCombat, RESOURCE_PLAYER, ARAGORN);
    const nenseldeInstanceId = withCombat.players[RESOURCE_PLAYER].characters[aragornId].allies[0].instanceId;

    const assignActions = computeLegalActions(withCombat, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'assign-strike')
      .map(ea => ea.action as AssignStrikeAction);

    // Nenseldë is excluded, but the bearer character is still a legal target
    // (the protection is specific to her, not the whole company).
    expect(assignActions.some(a => a.characterId === nenseldeInstanceId)).toBe(false);
    expect(assignActions.some(a => a.characterId === aragornId)).toBe(true);
  });

  test('Nenseldë is NOT offered as a strike target by the attacking player', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, NENSELDE);
    const withDefenderCombat = makeCancelWindowCombat(withAlly, {
      creatureRace: 'orc',
      attackKeying: [RegionType.Wilderness],
      strikesTotal: 2,
    });

    const aragornId = findCharInstanceId(withDefenderCombat, RESOURCE_PLAYER, ARAGORN);
    const nenseldeInstanceId = withDefenderCombat.players[RESOURCE_PLAYER].characters[aragornId].allies[0].instanceId;

    const combat: CombatState = {
      ...withDefenderCombat.combat!,
      strikeAssignments: [{ characterId: aragornId, excessStrikes: 0, resolved: false }],
      assignmentPhase: 'attacker',
    };
    const attackerState = { ...withDefenderCombat, combat };

    const assignActions = computeLegalActions(attackerState, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'assign-strike')
      .map(ea => ea.action as AssignStrikeAction);

    expect(assignActions.some(a => a.characterId === nenseldeInstanceId)).toBe(false);
  });

  // ─── Rule 3: tap to fetch an environment long/short event ───────────────────

  /** Organization-phase fixture: Nenseldë on Aragorn, with a configurable discard. */
  const tapFixture = (discard: CardDefinitionId[]): GameState => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_AMROTH, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
          discardPile: discard,
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    return attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, NENSELDE);
  };

  const tapAlly = (state: GameState): GameState => {
    const charId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const char = state.players[0].characters[charId];
    const allies = char.allies.map(a => a.definitionId === NENSELDE ? { ...a, status: CardStatus.Tapped } : a);
    const p0 = { ...state.players[0], characters: { ...state.players[0].characters, [charId as string]: { ...char, allies } } };
    return { ...state, players: [p0, state.players[1]] as typeof state.players };
  };

  const fetchActionsOf = (state: GameState) =>
    viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === FETCH_ACTION);

  test('the tap ability is offered while the ally is untapped', () => {
    expect(fetchActionsOf(tapFixture([SUN]))).toHaveLength(1);
  });

  test('the tap ability is NOT offered while the ally is already tapped', () => {
    expect(fetchActionsOf(tapAlly(tapFixture([SUN])))).toHaveLength(0);
  });

  test('activation taps the ally (not the bearer) and enqueues a to-hand fetch from the discard pile', () => {
    const state = tapFixture([SUN]);
    const after = dispatch(state, fetchActionsOf(state)[0].action);

    const aragornId = findCharInstanceId(after, RESOURCE_PLAYER, ARAGORN);
    const ally = after.players[0].characters[aragornId].allies.find(a => a.definitionId === NENSELDE)!;
    expect(ally.status).toBe(CardStatus.Tapped);
    expect(after.players[0].characters[aragornId].status).toBe(CardStatus.Untapped);

    expect(after.pendingEffects).toHaveLength(1);
    const effect = (after.pendingEffects[0] as { effect: { type: string; to?: string; source?: string[] } }).effect;
    expect(effect.type).toBe('fetch-to-deck');
    expect(effect.to).toBe('hand');
    expect(effect.source).toEqual(['discard-pile']);
  });

  test('only environment long/short events are offered; permanent envs and non-envs are excluded', () => {
    // SUN (env long) + STARS (env short) qualify; GATES_OF_MORNING (env
    // permanent) and WIZARDS_LAUGHTER (spell short) do not.
    const state = tapFixture([SUN, STARS, GATES_OF_MORNING, WIZARDS_LAUGHTER]);
    const after = dispatch(state, fetchActionsOf(state)[0].action);

    const fetchActions = computeLegalActions(after, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
    expect(fetchActions).toHaveLength(2);
    const offeredIds = new Set(fetchActions.map(a => (a.action as { cardInstanceId: string }).cardInstanceId));
    const idOf = (defId: CardDefinitionId) => after.players[0].discardPile.find(c => c.definitionId === defId)!.instanceId as unknown as string;
    expect(offeredIds.has(idOf(SUN))).toBe(true);
    expect(offeredIds.has(idOf(STARS))).toBe(true);
    expect(offeredIds.has(idOf(GATES_OF_MORNING))).toBe(false);
    expect(offeredIds.has(idOf(WIZARDS_LAUGHTER))).toBe(false);
  });

  test('fetching an environment event moves it from the discard pile to hand', () => {
    const state = tapFixture([SUN]);
    const after = dispatch(state, fetchActionsOf(state)[0].action);
    const sunInst = after.players[0].discardPile.find(c => c.definitionId === SUN)!.instanceId;
    const pick = computeLegalActions(after, PLAYER_1)
      .find(ea => ea.viable && ea.action.type === 'fetch-from-pile'
        && (ea.action as { cardInstanceId: string }).cardInstanceId === (sunInst as unknown as string))!;

    const afterFetch = dispatch(after, pick.action);
    expect(afterFetch.players[0].hand.some(c => c.definitionId === SUN)).toBe(true);
    expect(afterFetch.players[0].discardPile.some(c => c.definitionId === SUN)).toBe(false);
    expect(afterFetch.pendingEffects).toHaveLength(0);
    assertEveryInstanceReachable(afterFetch);
  });

  // ─── Rule 4: discard-on-move ────────────────────────────────────────────────

  /** MovementHazard fixture: Nenseldë's company at `origin`, moving to `destination`. */
  const movingState = (origin: CardDefinitionId, destination: CardDefinitionId): GameState => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: origin, characters: [ARAGORN] }], hand: [], siteDeck: [destination], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, NENSELDE);
    const destCard = withAlly.players[0].siteDeck[0];
    const p0 = {
      ...withAlly.players[0],
      companies: [{
        ...withAlly.players[0].companies[0],
        destinationSite: { instanceId: destCard.instanceId, definitionId: destCard.definitionId, status: CardStatus.Untapped },
      }],
    };
    return {
      ...withAlly,
      players: [p0, withAlly.players[1]] as typeof withAlly.players,
      phaseState: makeMHState({ activeCompanyIndex: 0 }),
    };
  };

  const completeMove = (state: GameState): GameState =>
    dispatch(dispatch(state, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });

  const hasNenselde = (state: GameState): boolean => {
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    return state.players[RESOURCE_PLAYER].characters[aragornId].allies.some(a => a.definitionId === NENSELDE);
  };

  test('discarded when her company moves to a disallowed site (Rivendell, region Rhudaur)', () => {
    const before = movingState(DOL_AMROTH, RIVENDELL);
    expect(hasNenselde(before)).toBe(true);
    const after = completeMove(before);
    expect(hasNenselde(after)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === NENSELDE)).toBe(true);
    assertEveryInstanceReachable(after);
  });

  test('NOT discarded when her company moves to Lond Galen (region Anfalas)', () => {
    const after = completeMove(movingState(DOL_AMROTH, LOND_GALEN));
    expect(hasNenselde(after)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === NENSELDE)).toBe(false);
  });

  test('NOT discarded when her company moves to Tolfalas (region Mouths of the Anduin)', () => {
    const after = completeMove(movingState(DOL_AMROTH, TOLFALAS));
    expect(hasNenselde(after)).toBe(true);
  });

  test('NOT discarded when her company moves to Dol Amroth (region Belfalas)', () => {
    const after = completeMove(movingState(LOND_GALEN, DOL_AMROTH));
    expect(hasNenselde(after)).toBe(true);
  });
});
