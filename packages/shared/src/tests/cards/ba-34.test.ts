/**
 * @module ba-34.test
 *
 * Card test: Elven Rope (ba-34)
 * Type: hero-resource-item (minor)
 *
 * "Tap Elven Rope and a ranger bearer during your organization phase to
 *  allow his company to move an additional region. Instead of eliminating a
 *  creature the bearer's company defeated (with a normal prowess less than
 *  11), you may place the creature's card with Elven Rope. Discard the
 *  creature if Elven Rope's bearer becomes wounded. If stored with a
 *  creature, the creature stays with Elven Rope and you receive three
 *  miscellaneous marshalling points. Otherwise, the creature has no effect
 *  on play."
 *
 * Effects:
 *   1. grant-action "extra-region-movement" — cost tap self-and-bearer, when
 *      bearer is a ranger with no planned movement / extra region distance
 *      yet this turn; apply increment-company-extra-region-distance +1.
 *   2. creature-storage — maxNormalProwess 11, marshallingPoints 3.
 *
 * Engine support:
 * | # | Feature                                          | Status      |
 * |---|---------------------------------------------------|-------------|
 * | 1 | Tap item+ranger bearer for +1 region movement      | IMPLEMENTED |
 * | 2 | Store a defeated creature (prowess < 11) on item   | IMPLEMENTED |
 * | 3 | Discard stored creature when bearer wounded        | IMPLEMENTED |
 * | 4 | +3 misc MP while a creature is stored              | IMPLEMENTED |
 * | 5 | Ineligible creature (prowess >= 11) not offered     | IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  LORIEN, MORIA, MINAS_TIRITH,
  viableActions, viableFor,
  CardStatus,
  dispatch, executeAction,
  makeMHState,
  findCharInstanceId, companyIdAt,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  assertEveryInstanceReachable,
} from '../test-helpers.js';
import { resolveInstanceId, Race } from '../../index.js';
import type { ActivateGrantedAction, CombatState, CardDefinitionId, CardInstanceId, StoreCreatureInItemAction } from '../../index.js';

const ELVEN_ROPE = 'ba-34' as CardDefinitionId;
// Orc-guard: prowess 8 (< 11, storage-eligible), race orc.
const ORC_GUARD = 'tw-072' as CardDefinitionId;
// Scorba: prowess 12 (>= 11, storage-ineligible), race drake.
const SCORBA = 'td-63' as CardDefinitionId;

describe('Elven Rope (ba-34)', () => {
  beforeEach(() => resetMint());

  // ── Ability 1: extra-region-movement (tap self-and-bearer, ranger only) ──

  function orgState(bearerDefId: CardDefinitionId = ARAGORN) {
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: bearerDefId, items: [ELVEN_ROPE] }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
  }

  test('extra-region-movement is offered for a ranger bearer with untapped item and bearer', () => {
    const state = orgState(ARAGORN);
    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const extraActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'extra-region-movement');
    expect(extraActions).toHaveLength(1);
  });

  test('extra-region-movement is NOT offered for a non-ranger bearer', () => {
    // Legolas: warrior/diplomat, not a ranger.
    const state = orgState(LEGOLAS);
    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const extraActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'extra-region-movement');
    expect(extraActions).toHaveLength(0);
  });

  test('extra-region-movement is NOT offered once the company has planned movement', () => {
    const state = orgState(ARAGORN);
    const moveActions = viableActions(state, PLAYER_1, 'plan-movement');
    expect(moveActions.length).toBeGreaterThan(0);
    const afterMove = dispatch(state, moveActions[0].action);

    const actions = viableActions(afterMove, PLAYER_1, 'activate-granted-action');
    const extraActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'extra-region-movement');
    expect(extraActions).toHaveLength(0);
  });

  test('extra-region-movement is NOT offered a second time once the company already has extra region distance', () => {
    const state = orgState(ARAGORN);
    const actions1 = viableActions(state, PLAYER_1, 'activate-granted-action');
    const extra1 = actions1.find(ea => (ea.action as ActivateGrantedAction).actionId === 'extra-region-movement')!;
    const afterFirst = dispatch(state, extra1.action);
    expect(afterFirst.players[RESOURCE_PLAYER].companies[0].extraRegionDistance).toBe(1);

    const actions2 = viableActions(afterFirst, PLAYER_1, 'activate-granted-action');
    const extra2 = actions2.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'extra-region-movement');
    expect(extra2).toHaveLength(0);
  });

  test('activating extra-region-movement taps BOTH Elven Rope and its ranger bearer', () => {
    const state = orgState(ARAGORN);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const itemInstanceId = state.players[RESOURCE_PLAYER].characters[aragornId].items[0].instanceId;

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const extra = actions.find(ea => (ea.action as ActivateGrantedAction).actionId === 'extra-region-movement')!;
    const next = dispatch(state, extra.action);

    expect(next.players[RESOURCE_PLAYER].characters[aragornId].status).toBe(CardStatus.Tapped);
    const item = next.players[RESOURCE_PLAYER].characters[aragornId].items.find(i => i.instanceId === itemInstanceId);
    expect(item?.status).toBe(CardStatus.Tapped);
  });

  test('extra-region-movement is NOT offered when Elven Rope itself is already tapped', () => {
    const state = orgState(ARAGORN);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const char = state.players[RESOURCE_PLAYER].characters[aragornId];
    const tappedItemState = {
      ...state,
      players: state.players.map((p, i) => i !== RESOURCE_PLAYER ? p : {
        ...p,
        characters: {
          ...p.characters,
          [aragornId as string]: { ...char, items: char.items.map(it => ({ ...it, status: CardStatus.Tapped })) },
        },
      }) as unknown as typeof state.players,
    };

    const actions = viableActions(tappedItemState, PLAYER_1, 'activate-granted-action');
    const extraActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'extra-region-movement');
    expect(extraActions).toHaveLength(0);
  });

  // ── Ability 2: creature-storage ──

  /** Build a combat state where the bearer's company just defeated a creature
   *  (all strikes succeeded) and is about to enter finalizeCombat's body
   *  check against the creature, mirroring Rule 8.37's trophy-offer test
   *  fixture but with a hero company bearing Elven Rope. */
  function makeStorageOfferState(creatureDefId: CardDefinitionId) {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [ELVEN_ROPE] }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const itemInstanceId = base.players[RESOURCE_PLAYER].characters[aragornId].items[0].instanceId;
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const creatureInstance = {
      instanceId: 'storage-creature-inst' as CardInstanceId,
      definitionId: creatureDefId,
      status: CardStatus.Untapped,
    };
    const stateWithCreature = {
      ...base,
      players: base.players.map((p, i) =>
        i === HAZARD_PLAYER ? { ...p, cardsInPlay: [...p.cardsInPlay, creatureInstance] } : p,
      ) as unknown as typeof base.players,
    };

    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: creatureInstance.instanceId },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 8,
      creatureBody: 5,
      creatureRace: Race.Orc,
      strikeAssignments: [{ characterId: aragornId, excessStrikes: 0, resolved: true, result: 'success' }],
      currentStrikeIndex: 0,
      phase: 'body-check',
      assignmentPhase: 'done',
      bodyCheckTarget: 'creature',
      detainment: false,
    };

    return {
      state: { ...stateWithCreature, phaseState: makeMHState(), combat, cheatRollTotal: 12 },
      aragornId,
      itemInstanceId,
      creatureInstanceId: creatureInstance.instanceId,
    };
  }

  test('creature-storage-offer phase is entered when the defeated creature has normal prowess < 11', () => {
    const { state, itemInstanceId, creatureInstanceId } = makeStorageOfferState(ORC_GUARD);

    const [bodyCheckAction] = viableActions(state, PLAYER_1, 'body-check-roll');
    const afterBodyCheck = dispatch(state, bodyCheckAction.action);

    expect(afterBodyCheck.combat?.phase).toBe('creature-storage-offer');
    expect(afterBodyCheck.combat?.creatureStorageEligibleItems).toContain(itemInstanceId);

    // Legal actions: one store-creature-in-item per eligible item + pass for
    // the defender; nothing for the attacker (mirrors trophy-offer's
    // stall-prevention shape).
    const storeActions = viableActions(afterBodyCheck, PLAYER_1, 'store-creature-in-item');
    expect(storeActions).toHaveLength(1);
    expect(storeActions[0].action).toMatchObject({
      type: 'store-creature-in-item',
      player: PLAYER_1,
      itemInstanceId,
      creatureInstanceId,
    });
    expect(viableActions(afterBodyCheck, PLAYER_1, 'pass')).toHaveLength(1);
    expect(viableFor(afterBodyCheck, PLAYER_2)).toHaveLength(0);
  });

  test('creature-storage-offer is NOT entered when the defeated creature has normal prowess >= 11', () => {
    const { state } = makeStorageOfferState(SCORBA);

    const [bodyCheckAction] = viableActions(state, PLAYER_1, 'body-check-roll');
    const afterBodyCheck = dispatch(state, bodyCheckAction.action);

    // Combat finalizes normally — no storage offer, creature scored via kill pile.
    expect(afterBodyCheck.combat).toBeNull();
    expect(afterBodyCheck.players[RESOURCE_PLAYER].killPile.some(c => c.definitionId === SCORBA)).toBe(true);
  });

  test('storing the creature moves it from the kill pile onto the item and scores +3 misc MP', () => {
    const { state, itemInstanceId, creatureInstanceId, aragornId } = makeStorageOfferState(ORC_GUARD);
    const [bodyCheckAction] = viableActions(state, PLAYER_1, 'body-check-roll');
    const afterBodyCheck = dispatch(state, bodyCheckAction.action);
    const miscBefore = afterBodyCheck.players[RESOURCE_PLAYER].marshallingPoints.misc;

    const [storeAction] = viableActions(afterBodyCheck, PLAYER_1, 'store-creature-in-item');
    const afterStore = dispatch(afterBodyCheck, storeAction.action as StoreCreatureInItemAction);

    expect(afterStore.combat).toBeNull();
    expect(afterStore.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === creatureInstanceId)).toBe(false);
    const item = afterStore.players[RESOURCE_PLAYER].characters[aragornId].items.find(i => i.instanceId === itemInstanceId);
    expect(item?.storedCreature?.instanceId).toBe(creatureInstanceId);
    expect(afterStore.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(miscBefore + 3);

    // No-disappear invariant: the creature now lives only on the item.
    expect(resolveInstanceId(afterStore, creatureInstanceId)).toBe(ORC_GUARD);
    assertEveryInstanceReachable(afterStore);
  });

  test('declining the storage offer leaves the creature in the kill pile, scored normally', () => {
    const { state, creatureInstanceId } = makeStorageOfferState(ORC_GUARD);
    const [bodyCheckAction] = viableActions(state, PLAYER_1, 'body-check-roll');
    const afterBodyCheck = dispatch(state, bodyCheckAction.action);

    const afterPass = dispatch(afterBodyCheck, { type: 'pass', player: PLAYER_1 });

    expect(afterPass.combat).toBeNull();
    expect(afterPass.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === creatureInstanceId)).toBe(true);
  });

  test('the stored creature is released to the hazard player\'s discard pile — and the MP bonus stops — when the bearer is wounded', () => {
    const { state, itemInstanceId, creatureInstanceId, aragornId } = makeStorageOfferState(ORC_GUARD);
    const [bodyCheckAction] = viableActions(state, PLAYER_1, 'body-check-roll');
    const afterBodyCheck = dispatch(state, bodyCheckAction.action);
    const [storeAction] = viableActions(afterBodyCheck, PLAYER_1, 'store-creature-in-item');
    const stored = dispatch(afterBodyCheck, storeAction.action as StoreCreatureInItemAction);
    expect(stored.players[RESOURCE_PLAYER].marshallingPoints.misc).toBeGreaterThanOrEqual(3);

    // A fresh attack wounds Aragorn: he loses a strike (prowess 6 + roll 2 =
    // 8 < strike prowess 12), then the character body check (roll 3 <= body
    // 9) confirms he survives wounded rather than being eliminated.
    const woundCombat: CombatState = {
      attackSource: { type: 'creature', instanceId: 'wound-creature-inst' as CardInstanceId },
      companyId: companyIdAt(stored, RESOURCE_PLAYER),
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 12,
      creatureBody: null,
      creatureRace: Race.Orc,
      strikeAssignments: [],
      currentStrikeIndex: 0,
      phase: 'assign-strikes',
      assignmentPhase: 'defender',
      bodyCheckTarget: null,
      detainment: false,
    };
    const readyForWound = {
      ...stored,
      players: stored.players.map((p, i) => i === HAZARD_PLAYER
        ? { ...p, cardsInPlay: [...p.cardsInPlay, { instanceId: 'wound-creature-inst' as CardInstanceId, definitionId: ORC_GUARD, status: CardStatus.Untapped }] }
        : p) as unknown as typeof stored.players,
      phaseState: makeMHState(),
      combat: woundCombat,
    };

    let s = dispatch(readyForWound, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);
    s = executeAction(s, PLAYER_2, 'body-check-roll', 3);

    expect(s.combat).toBeNull();
    // Aragorn survives, wounded, still in play.
    expect(s.players[RESOURCE_PLAYER].characters[aragornId]).toBeDefined();

    // The stored creature is released from the item...
    const item = s.players[RESOURCE_PLAYER].characters[aragornId].items.find(i => i.instanceId === itemInstanceId);
    expect(item?.storedCreature).toBeUndefined();
    // ...to the hazard player's discard pile...
    expect(s.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === creatureInstanceId)).toBe(true);
    // ...and the misc MP bonus is gone.
    expect(s.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(0);

    // No-disappear invariant holds through the release too.
    expect(resolveInstanceId(s, creatureInstanceId)).toBe(ORC_GUARD);
    assertEveryInstanceReachable(s);
  });
});
