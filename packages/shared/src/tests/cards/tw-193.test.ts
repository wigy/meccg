/**
 * @module tw-193.test
 *
 * Card test: Army of the Dead (tw-193)
 * Type: hero-resource-faction
 * Effects: 1
 *
 * "Unique. Playable at Vale of Erech. May only be played by Aragorn II on the
 *  same turn that he plays Paths of the Dead. May not be influenced by an
 *  opponent."
 *
 * Effects tested:
 * 1. `requiredInfluencerName: "Aragorn II"` — only Aragorn II is offered as an
 *    influencer, even when another untapped character is in the same company.
 * 2. play-condition `active-company` — the faction is not playable unless the
 *    company's `specialMovement` is `"paths-of-the-dead"` (set only while the
 *    company used the special movement granted by Paths of the Dead tw-302
 *    this turn; cleared at end of turn).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN,
  buildSitePhaseState, resetMint,
  findCharInstanceId, findHandCardId, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { InfluenceAttemptAction, CardDefinitionId } from '../../index.js';

const ARMY_OF_THE_DEAD = 'tw-193' as CardDefinitionId;
const FORLONG = 'tw-151' as CardDefinitionId;
const VALE_OF_ERECH = 'tw-434' as CardDefinitionId;

describe('Army of the Dead (tw-193)', () => {
  beforeEach(() => resetMint());

  test('only Aragorn II is offered as an influencer, even with another untapped character in the company', () => {
    const base = buildSitePhaseState({
      characters: [ARAGORN, FORLONG],
      site: VALE_OF_ERECH,
      hand: [ARMY_OF_THE_DEAD],
    });
    const state = {
      ...base,
      players: [
        { ...base.players[0], companies: [{ ...base.players[0].companies[0], specialMovement: 'paths-of-the-dead' as const }] },
        base.players[1],
      ] as typeof base.players,
    };

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const forlongId = findCharInstanceId(state, RESOURCE_PLAYER, FORLONG);
    const cardInstance = findHandCardId(state, RESOURCE_PLAYER, ARMY_OF_THE_DEAD);

    const influenceActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .filter(a => a.factionInstanceId === cardInstance);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);
    expect(influenceActions.every(a => a.influencingCharacterId === aragornId)).toBe(true);
    expect(influenceActions.some(a => a.influencingCharacterId === forlongId)).toBe(false);
  });

  test('not playable when the company has not used Paths of the Dead special movement this turn', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN, FORLONG],
      site: VALE_OF_ERECH,
      hand: [ARMY_OF_THE_DEAD],
    });
    const cardInstance = findHandCardId(state, RESOURCE_PLAYER, ARMY_OF_THE_DEAD);

    const influenceActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .filter(a => a.factionInstanceId === cardInstance);

    expect(influenceActions).toHaveLength(0);
  });
});
