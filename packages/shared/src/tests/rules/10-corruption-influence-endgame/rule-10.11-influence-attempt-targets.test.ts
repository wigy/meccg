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
  viableActions, PLAYER_1,
  ARAGORN, LEGOLAS, GIMLI, BILBO,
  GWAIHIR,
  MORIA, LORIEN,
} from '../../test-helpers.js';
import type { OpponentInfluenceAttemptAction } from '../../test-helpers.js';

describe('Rule 10.11 — Influence Attempt Target Conditions', () => {
  test('character at same site is a valid target', () => {
    const state = buildTargetState({ p1Site: MORIA, p2Site: MORIA });
    const actions = viableActions(state, PLAYER_1, 'opponent-influence-attempt') as { action: OpponentInfluenceAttemptAction }[];
    expect(actions.length).toBeGreaterThan(0);
    const legolasId = findCharInstanceId(state, 1, LEGOLAS);
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
    const legolasId = findCharInstanceId(state, 1, LEGOLAS);
    const gimliId = findCharInstanceId(state, 1, GIMLI);
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
    const aragornId = findCharInstanceId(state, 0, ARAGORN);
    const bilboId = findCharInstanceId(state, 0, BILBO);
    const legolasId = findCharInstanceId(state, 1, LEGOLAS);
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
    const withAlly = attachAllyToChar(state, 1, LEGOLAS, GWAIHIR);
    const actions = viableActions(withAlly, PLAYER_1, 'opponent-influence-attempt') as { action: OpponentInfluenceAttemptAction }[];
    // Should have actions targeting the ally (Gwaihir)
    const allyActions = actions.filter(a => a.action.targetKind === 'ally');
    expect(allyActions.length).toBeGreaterThan(0);
  });

  // The remaining target kinds (faction, item) are blocked on engine work:
  // OpponentInfluenceAttemptAction.targetKind currently supports only
  // 'character' | 'ally'. Once the legal-action computer enumerates
  // faction- and item-typed targets, these can be exercised here.
  test.todo('faction: playable site target');
  test.todo('item: same site + no permanent-event + reveal identical item');
});
