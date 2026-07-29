/**
 * @module rule-10.11-influence-attempt-targets
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.11: Influence Attempt Target Conditions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Additionally, the following conditions must also be true depending on the type of card being influenced:
 * • Ally - The resource player's character is at the same site as the ally being influenced.
 * • Character - The resource player's character is at the same site as the character being influenced.
 * • Faction - The resource player's character is at a site where the faction is playable.
 * • Item - The resource player's character is at the same site as the item being influenced, the item being influenced does not have a permanent-event played on it, AND the resource player must reveal an identical item card in their hand (of any alignment).
 * When declaring an influence attempt against an ally, character, or faction, the resource player may reveal an identical resource card in their hand (of any alignment), even if that player wouldn't be able to play the card following the influence attempt.
 */

import { describe, test, expect } from 'vitest';
import {
  buildTargetState, findCharInstanceId, attachAllyToChar,
  addCardInPlay, pushCardInPlay, mint, CardStatus,
  viableActions, PLAYER_1,
  ARAGORN, LEGOLAS, GIMLI, BILBO,
  GWAIHIR, DAGGER_OF_WESTERNESSE,
  MORIA, LORIEN, BREE, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../../test-helpers.js';
import type { OpponentInfluenceAttemptAction, CardDefinitionId } from '../../test-helpers.js';

describe('Rule 10.11 — Influence Attempt Target Conditions', () => {
  test('character at same site is a valid target', () => {
    const state = buildTargetState({ p1Site: MORIA, p2Site: MORIA });
    const actions = viableActions(state, PLAYER_1, 'opponent-influence-attempt') as { action: OpponentInfluenceAttemptAction }[];
    expect(actions.length).toBeGreaterThan(0);
    const legolasId = findCharInstanceId(state, HAZARD_PLAYER, LEGOLAS);
    expect(actions.some(a => a.action.targetInstanceId === legolasId)).toBe(true);
  });

  test('character at different site is NOT a valid target', () => {
    // P1 at Moria, P2 at Lorien — different sites
    const state = buildTargetState({ p1Site: MORIA, p2Site: LORIEN });
    const actions = viableActions(state, PLAYER_1, 'opponent-influence-attempt');
    expect(actions).toHaveLength(0);
  });

  test('multiple opponent characters at same site generate separate actions', () => {
    const state = buildTargetState({
      p1Site: MORIA,
      p2Site: MORIA,
      p2Chars: [LEGOLAS, GIMLI],
    });
    const actions = viableActions(state, PLAYER_1, 'opponent-influence-attempt') as { action: OpponentInfluenceAttemptAction }[];
    const legolasId = findCharInstanceId(state, HAZARD_PLAYER, LEGOLAS);
    const gimliId = findCharInstanceId(state, HAZARD_PLAYER, GIMLI);
    // Should have actions targeting both Legolas and Gimli (without reveal)
    expect(actions.some(a => a.action.targetInstanceId === legolasId && !a.action.revealedCardInstanceId)).toBe(true);
    expect(actions.some(a => a.action.targetInstanceId === gimliId && !a.action.revealedCardInstanceId)).toBe(true);
  });

  test('multiple untapped influencers generate separate actions per target', () => {
    const state = buildTargetState({
      p1Site: MORIA,
      p2Site: MORIA,
      p1Chars: [ARAGORN, BILBO],
    });
    const actions = viableActions(state, PLAYER_1, 'opponent-influence-attempt') as { action: OpponentInfluenceAttemptAction }[];
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const legolasId = findCharInstanceId(state, HAZARD_PLAYER, LEGOLAS);
    // Both Aragorn and Bilbo should be able to target Legolas
    expect(actions.some(a => a.action.influencingCharacterId === aragornId && a.action.targetInstanceId === legolasId)).toBe(true);
    expect(actions.some(a => a.action.influencingCharacterId === bilboId && a.action.targetInstanceId === legolasId)).toBe(true);
  });

  test('identical card in hand generates reveal variant with mind treated as 0', () => {
    // P1 has Legolas in hand (identical to P2's Legolas)
    const state = buildTargetState({
      p1Site: MORIA,
      p2Site: MORIA,
      p1Hand: [LEGOLAS],
    });
    const actions = viableActions(state, PLAYER_1, 'opponent-influence-attempt') as { action: OpponentInfluenceAttemptAction }[];
    // Should have both a reveal variant and a no-reveal variant
    const noReveal = actions.filter(a => !a.action.revealedCardInstanceId);
    const withReveal = actions.filter(a => a.action.revealedCardInstanceId !== undefined);
    expect(noReveal.length).toBeGreaterThan(0);
    expect(withReveal.length).toBeGreaterThan(0);
    // Reveal variant explanation should mention mind = 0
    expect(withReveal[0].action.explanation).toContain('mind treated as 0');
  });

  test('ally at same site is a valid target', () => {
    // P2 has Legolas with ally Gwaihir at Moria, P1 has Aragorn at Moria
    const state = buildTargetState({ p1Site: MORIA, p2Site: MORIA });
    const withAlly = attachAllyToChar(state, HAZARD_PLAYER, LEGOLAS, GWAIHIR);
    const actions = viableActions(withAlly, PLAYER_1, 'opponent-influence-attempt') as { action: OpponentInfluenceAttemptAction }[];
    // Should have actions targeting the ally (Gwaihir)
    const allyActions = actions.filter(a => a.action.targetKind === 'ally');
    expect(allyActions.length).toBeGreaterThan(0);
  });

  test('faction: playable site target', () => {
    // P1 (Aragorn) is at Bree. P2 has Rangers of the North in play.
    // Rangers of the North is playable at Bree, so P1 can attempt to re-influence it.
    const RANGERS = 'tw-311' as CardDefinitionId;
    const state = buildTargetState({ p1Site: BREE, p2Site: LORIEN });
    const withFaction = addCardInPlay(state, HAZARD_PLAYER, RANGERS);

    const actions = viableActions(withFaction, PLAYER_1, 'opponent-influence-attempt') as { action: OpponentInfluenceAttemptAction }[];
    const factionActions = actions.filter(a => a.action.targetKind === 'faction');
    expect(factionActions.length).toBeGreaterThan(0);
    const aragornId = findCharInstanceId(withFaction, RESOURCE_PLAYER, ARAGORN);
    expect(factionActions.some(a => a.action.influencingCharacterId === aragornId)).toBe(true);
  });

  test('item: same site + no permanent-event + reveal identical item', () => {
    // P2's Legolas bears the Dagger of Westernesse at Moria; P1's Aragorn is at
    // the same site and holds an identical Dagger to reveal.
    const state = buildTargetState({
      p1Site: MORIA,
      p2Site: MORIA,
      p2Chars: [{ defId: LEGOLAS, items: [DAGGER_OF_WESTERNESSE] }],
      p1Hand: [DAGGER_OF_WESTERNESSE],
    });
    const legolasId = findCharInstanceId(state, HAZARD_PLAYER, LEGOLAS);
    const daggerId = state.players[HAZARD_PLAYER].characters[legolasId].items[0].instanceId;
    const revealId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const itemActions = (viableActions(state, PLAYER_1, 'opponent-influence-attempt') as { action: OpponentInfluenceAttemptAction }[])
      .filter(a => a.action.targetKind === 'item');
    expect(itemActions).toHaveLength(1);
    // The reveal is mandatory for an item, so the one action carries it.
    expect(itemActions[0].action.targetInstanceId).toBe(daggerId);
    expect(itemActions[0].action.revealedCardInstanceId).toBe(revealId);
  });

  test('item: not a valid target without an identical item in hand', () => {
    const state = buildTargetState({
      p1Site: MORIA,
      p2Site: MORIA,
      p2Chars: [{ defId: LEGOLAS, items: [DAGGER_OF_WESTERNESSE] }],
    });
    const itemActions = (viableActions(state, PLAYER_1, 'opponent-influence-attempt') as { action: OpponentInfluenceAttemptAction }[])
      .filter(a => a.action.targetKind === 'item');
    expect(itemActions).toHaveLength(0);
  });

  test('item: not a valid target while a permanent-event is played on it', () => {
    // Barrow-blade (dm-119) is played on the Dagger of Westernesse, binding to
    // it via `attachedToItem` — that shuts the item out as an influence target.
    const BARROW_BLADE = 'dm-119' as CardDefinitionId;
    const state = buildTargetState({
      p1Site: MORIA,
      p2Site: MORIA,
      p2Chars: [{ defId: LEGOLAS, items: [DAGGER_OF_WESTERNESSE] }],
      p1Hand: [DAGGER_OF_WESTERNESSE],
    });
    const legolasId = findCharInstanceId(state, HAZARD_PLAYER, LEGOLAS);
    const daggerId = state.players[HAZARD_PLAYER].characters[legolasId].items[0].instanceId;

    const blocked = pushCardInPlay(state, HAZARD_PLAYER, {
      instanceId: mint(),
      definitionId: BARROW_BLADE,
      status: CardStatus.Untapped,
      attachedToItem: daggerId,
    });
    const itemActions = (viableActions(blocked, PLAYER_1, 'opponent-influence-attempt') as { action: OpponentInfluenceAttemptAction }[])
      .filter(a => a.action.targetKind === 'item');
    expect(itemActions).toHaveLength(0);
  });

  test('item: at a different site is NOT a valid target', () => {
    const state = buildTargetState({
      p1Site: MORIA,
      p2Site: LORIEN,
      p2Chars: [{ defId: LEGOLAS, items: [DAGGER_OF_WESTERNESSE] }],
      p1Hand: [DAGGER_OF_WESTERNESSE],
    });
    expect(viableActions(state, PLAYER_1, 'opponent-influence-attempt')).toHaveLength(0);
  });
});
