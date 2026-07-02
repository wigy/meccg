/**
 * @module rule-8.12-ss-step1-attacker-actions
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.12: Strike Step 1: Attacking Player Actions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Strike Sequence, Step 1 (Attacking Player Actions) - If the attack is taking place during their opponent's movement/hazard phase, the hazard player may take hazard actions that would affect the resolution of the strike, still counting against the company's hazard limit.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId, MovementHazardPhaseState } from '../../../index.js';
import {
  resetMint, dispatch, viableActions, makeMidStrikeHazardPlayState,
  findCharInstanceId,
  PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN,
} from '../../test-helpers.js';

// Dragon's Curse (td-16): the pool's only hazard permanent-event with a
// play-window { phase: 'combat', step: 'resolve-strike' } — the helper puts
// it in the hazard player's hand against a synthetic dragon strike.
const DRAGONS_CURSE = 'td-16' as CardDefinitionId;

describe('Rule 8.12 — Strike Step 1: Attacking Player Actions', () => {
  beforeEach(() => resetMint());

  test('a mid-strike hazard play is offered under the limit and counts against it', () => {
    // One hazard already played against the company (limit 2) — the
    // mid-strike Dragon's Curse play is still legal, and playing it raises
    // the company's played-hazard count to the limit.
    const state = makeMidStrikeHazardPlayState({ hazardsAlreadyPlayed: 1 });
    const [play] = viableActions(state, PLAYER_2, 'play-hazard');
    expect(play).toBeDefined();

    const after = dispatch(state, play.action);
    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(2);
    // The curse is attached to Aragorn.
    const aragornId = findCharInstanceId(after, RESOURCE_PLAYER, ARAGORN);
    expect(after.players[RESOURCE_PLAYER].characters[aragornId].hazards.some(
      h => h.definitionId === DRAGONS_CURSE,
    )).toBe(true);
    expect(after.players[HAZARD_PLAYER].hand).toHaveLength(0);
  });

  test('no mid-strike hazard play is offered once the company hazard limit is reached', () => {
    const state = makeMidStrikeHazardPlayState({ hazardsAlreadyPlayed: 2 });
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });
});
