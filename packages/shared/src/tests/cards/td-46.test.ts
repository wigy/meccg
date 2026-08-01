/**
 * @module td-46.test
 *
 * Card test: Many Sorrows Befall (td-46)
 * Type: hazard-event (short), unique — two mutually-exclusive modes
 *
 * Text:
 *   "Unique. Forces the discard of one resource long-event. Alternatively,
 *    can target and cancel one resource short-event declared earlier in the
 *    same chain of effects (i.e., before the resource short-event resolves)."
 *
 * Card shape (effects):
 *   1. play-option `discard-resource-long-event` (untargeted, candidates
 *      `opponent-in-play`): `move` select target, in-play → discard, filtered
 *      to hero/minion-resource-event cards with eventType "long". Played as
 *      a normal hazard short-event during the M/H hazard-play step, target
 *      declared at play time (as-35 precedent), no cost, counts against the
 *      hazard limit as normal.
 *   2. on-event self-enters-play → cancel-chain-entry (select: target,
 *      filter: target.cardType hero/minion-resource-event, target.eventType
 *      short): a chain-response mode reusing the Ire of the East (wh-24)
 *      machinery, minus the alignment restriction and the "remove from
 *      game" / "no hazard limit" clauses wh-24 carries (neither is in this
 *      card's text).
 *
 * Engine Support:
 * | # | Feature                                                       | Status      |
 * |---|----------------------------------------------------------------|-------------|
 * | 1 | Untargeted play-option candidates drawn from the OPPONENT's    | IMPLEMENTED |
 * |   | cardsInPlay (`candidates: "opponent-in-play"`, new)             |             |
 * | 2 | move select:target from:in-play to:discard, filtered by        | IMPLEMENTED |
 * |   | cardType/eventType, resolved via the untargeted play-option    |             |
 * |   | apply path                                                      |             |
 * | 3 | Cancel a chain entry matched by a generic filter condition      | IMPLEMENTED |
 * | 4 | Filter on target cardType ($in) / eventType, no declarer        | IMPLEMENTED |
 * |   | restriction                                                     |             |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, RIVENDELL, DARK_QUARRELS, ORC_PATROL,
  makeMHState, addCardInPlay, recomputeDerived,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt, dispatch, expectInDiscardPile,
  resolveChain, RESOURCE_PLAYER, HAZARD_PLAYER,
  findHandCardId, expectNotInHand,
  viableActions, viableActionsForHandCard, firstAction,
} from '../test-helpers.js';
import type {
  CardDefinitionId, GameState, PlayHazardAction, PlayShortEventAction,
  CancelAttackAction, MovementHazardPhaseState,
} from '../../index.js';
import { RegionType, SiteType } from '../../index.js';

const MANY_SORROWS_BEFALL = 'td-46' as CardDefinitionId;
const A_SHORT_REST = 'td-95' as CardDefinitionId;   // hero-resource-event, long — mode 1 target
const LAGDUF = 'le-18' as CardDefinitionId;          // minion warrior, orc — hazard player's own company
const MORIA_MINION = 'le-392' as CardDefinitionId;   // shadow-hold

const DISCARD_MODE = 'discard-resource-long-event';

describe('Many Sorrows Befall (td-46)', () => {
  beforeEach(() => resetMint());

  // ── Mode 1: forces the discard of one resource long-event ──────────────────

  function mode1BaseState(): GameState {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [MANY_SORROWS_BEFALL], siteDeck: [MORIA_MINION] },
      ],
    });
    return recomputeDerived({ ...state, phaseState: makeMHState() });
  }

  function discardPlays(state: GameState): PlayHazardAction[] {
    return viableActions(state, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.optionId === DISCARD_MODE);
  }

  test('not offered when the opponent has no resource long-event in play', () => {
    expect(discardPlays(mode1BaseState())).toHaveLength(0);
  });

  test('offered, targeting the resource long-event in the opponent cards in play', () => {
    const state = recomputeDerived(addCardInPlay(mode1BaseState(), RESOURCE_PLAYER, A_SHORT_REST));
    const target = state.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === A_SHORT_REST)!;
    const plays = discardPlays(state);
    expect(plays).toHaveLength(1);
    expect(plays[0].optionTargetInstanceId).toBe(target.instanceId);
  });

  test('not offered for a long-event sitting in the hazard player own cards in play', () => {
    const state = recomputeDerived(addCardInPlay(mode1BaseState(), HAZARD_PLAYER, A_SHORT_REST));
    expect(discardPlays(state)).toHaveLength(0);
  });

  test('not offered for a resource short-event in play (must be a long-event)', () => {
    const state = recomputeDerived(addCardInPlay(mode1BaseState(), RESOURCE_PLAYER, DARK_QUARRELS));
    expect(discardPlays(state)).toHaveLength(0);
  });

  test('discards the targeted long-event to its owner discard pile; counts against the hazard limit', () => {
    const state = recomputeDerived(addCardInPlay(mode1BaseState(), RESOURCE_PLAYER, A_SHORT_REST));
    const target = state.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === A_SHORT_REST)!;
    const before = (state.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany;
    const play = discardPlays(state)[0];

    const after = resolveChain(dispatch(state, play));

    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === target.instanceId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === target.instanceId)).toBe(true);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === MANY_SORROWS_BEFALL)).toBe(true);
    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(before + 1);
  });

  // ── Mode 2: cancel a resource short-event on the chain, before it resolves ─

  const MH_PATH = {
    activeCompanyIndex: 0,
    resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
    resolvedSitePathNames: ['Hithaeglir', 'Eryn Vorn'],
    destinationSiteType: SiteType.ShadowHold,
    destinationSiteName: 'Moria',
  } as const;

  function mode2BaseState(): GameState {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [DARK_QUARRELS], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [ORC_PATROL, MANY_SORROWS_BEFALL], siteDeck: [MORIA_MINION] },
      ],
    });
    return { ...base, phaseState: makeMHState(MH_PATH) };
  }

  test('cancels a resource short-event declared earlier on the chain — the attack it would have canceled survives', () => {
    const stateAtMH = mode2BaseState();
    const msbId = findHandCardId(stateAtMH, HAZARD_PLAYER, MANY_SORROWS_BEFALL);
    const dqId = findHandCardId(stateAtMH, RESOURCE_PLAYER, DARK_QUARRELS);
    const orcId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);

    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );
    expect(combatState.combat).not.toBeNull();

    // Resource player declares Dark Quarrels (a resource short-event) to
    // cancel the Orc attack — chain opens, hazard player gets priority.
    const cancelAction = firstAction<CancelAttackAction>(combatState, PLAYER_1, 'cancel-attack');
    const afterQuarrels = dispatch(combatState, cancelAction);
    expect(afterQuarrels.chain).not.toBeNull();
    expect(afterQuarrels.chain!.priority).toBe(PLAYER_2);

    // Many Sorrows Befall is a viable chain response targeting the Dark
    // Quarrels entry, declared earlier in the same chain of effects.
    const msbPlays = viableActionsForHandCard(afterQuarrels, PLAYER_2, 'play-short-event', HAZARD_PLAYER, MANY_SORROWS_BEFALL)
      .map(ea => ea.action as PlayShortEventAction);
    expect(msbPlays).toHaveLength(1);
    const dqEntry = afterQuarrels.chain!.entries.find(e => e.card?.definitionId === DARK_QUARRELS)!;
    expect(msbPlays[0].targetInstanceId).toBe(dqEntry.card!.instanceId);

    const afterMsb = dispatch(afterQuarrels, msbPlays[0]);
    expect(afterMsb.chain!.entries).toHaveLength(2);

    // Chain resolves LIFO: Many Sorrows Befall negates Dark Quarrels before
    // it resolves, so the Orc attack survives.
    const resolved = resolveChain(afterMsb);
    expect(resolved.chain).toBeNull();
    expect(resolved.combat).not.toBeNull();

    // Dark Quarrels goes to its owner's discard; Many Sorrows Befall (no
    // "remove from game" clause on this card) also lands in a discard pile,
    // not out-of-play.
    expectInDiscardPile(resolved, RESOURCE_PLAYER, dqId);
    expectNotInHand(resolved, HAZARD_PLAYER, msbId);
    expect(resolved.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === msbId)).toBe(true);
    expect(resolved.players[HAZARD_PLAYER].outOfPlayPile.some(c => c.instanceId === msbId)).toBe(false);
  });

  test('not offered while no chain is live', () => {
    const stateAtMH = mode2BaseState();
    const orcId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    // Combat is active but no chain is open — Many Sorrows Befall targets
    // only entries "declared earlier in the same chain of effects".
    expect(combatState.chain).toBeNull();
    expect(viableActionsForHandCard(combatState, PLAYER_2, 'play-short-event', HAZARD_PLAYER, MANY_SORROWS_BEFALL))
      .toHaveLength(0);
  });

  test('control: without Many Sorrows Befall, Dark Quarrels resolves and cancels the attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [DARK_QUARRELS], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [ORC_PATROL], siteDeck: [MORIA_MINION] },
      ],
    });
    const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH) };

    const orcId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    const cancelAction = firstAction<CancelAttackAction>(combatState, PLAYER_1, 'cancel-attack');
    const resolved = resolveChain(dispatch(combatState, cancelAction));

    expect(resolved.chain).toBeNull();
    expect(resolved.combat).toBeNull();
  });
});
