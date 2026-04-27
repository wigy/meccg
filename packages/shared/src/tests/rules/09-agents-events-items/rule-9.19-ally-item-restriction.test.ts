/**
 * @module rule-9.19-ally-item-restriction
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.19: Allies Cannot Bear Items
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Allies cannot bear nor use items.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildSitePhaseState, attachAllyToChar, resetMint, viableActions,
  findCharInstanceId,
  PLAYER_1,
  ARAGORN, GWAIHIR, DAGGER_OF_WESTERNESSE, MORIA,
  RESOURCE_PLAYER,
} from '../../test-helpers.js';
import type { PlayHeroResourceAction } from '../../../types/actions-site.js';

describe('Rule 9.19 — Allies Cannot Bear Items', () => {
  beforeEach(() => resetMint());

  test('Allies cannot bear nor use items', () => {
    // Aragorn is at Moria (shadow-hold, allows minor items) with Gwaihir
    // attached as an ally. A Dagger of Westernesse (minor item) is in hand.
    // The only valid bearer must be Aragorn; the engine must never offer the
    // ally (Gwaihir) as an item attachment target.
    const base = buildSitePhaseState({
      site: MORIA,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const state = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GWAIHIR);

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const itemPlays = viableActions(state, PLAYER_1, 'play-hero-resource') as { action: PlayHeroResourceAction }[];
    const daggers = itemPlays.filter(a =>
      state.players[RESOURCE_PLAYER].hand.some(
        c => c.instanceId === a.action.cardInstanceId,
      ),
    );

    // The item play should be offered with Aragorn as bearer
    expect(daggers.some(a => a.action.attachToCharacterId === aragornId)).toBe(true);

    // Gwaihir (ally) must never appear as an attachToCharacterId
    const gwaihirInPlay = Object.values(state.players[RESOURCE_PLAYER].characters)
      .flatMap(ch => ch.allies)
      .find(a => a.definitionId === GWAIHIR);
    expect(gwaihirInPlay).toBeDefined();
    expect(daggers.some(a => a.action.attachToCharacterId === gwaihirInPlay!.instanceId)).toBe(false);
  });
});
