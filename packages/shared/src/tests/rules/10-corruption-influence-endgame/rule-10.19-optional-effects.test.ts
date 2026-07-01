/**
 * @module rule-10.19-optional-effects
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.19: Optional Effects
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If an action has optional effects (e.g. playing a card that says "alternatively"), the player who declared the action must choose which effect(s) and any corresponding active conditions to implement upon declaration, and cannot change those choices later during resolution.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase } from '../../../index.js';
import type { CardDefinitionId, GameState, PlayHazardAction } from '../../../index.js';
import {
  buildTestState, resetMint, makeMHState, recomputeDerived,
  viableActions, dispatch, resolveChain,
  handCardId, findCharInstanceId, getCharacter, companyIdAt,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, MORIA, LORIEN, MINAS_TIRITH, RIVENDELL,
} from '../../test-helpers.js';

// Weariness of the Heart (le-149): "alternatively" card with two mutually
// exclusive play-options ("prowess": -1 prowess until EOT; "corruption": a
// corruption check) — see tests/cards/le-149.test.ts for full coverage.
const WEARINESS_OF_THE_HEART = 'le-149' as CardDefinitionId;

function buildWeariness(): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [WEARINESS_OF_THE_HEART], siteDeck: [RIVENDELL] },
    ],
  });
  return { ...base, phaseState: makeMHState() };
}

describe('Rule 10.19 — Optional Effects', () => {
  beforeEach(() => resetMint());

  test('the option is chosen upon declaration — offered as distinct actions, not a resolution-time choice', () => {
    const state = buildWeariness();
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const actions = viableActions(state, PLAYER_2, 'play-hazard')
      .map(a => a.action as unknown as PlayHazardAction)
      .filter(a => a.targetCharacterId === aragornId);

    // Both alternatives are already fully-formed, independently declarable
    // actions — the option isn't a separate step deferred to resolution.
    expect(actions.map(a => a.optionId).sort()).toEqual(['corruption', 'prowess']);
  });

  test('the declared option is the only one that resolves — no later switch to the other', () => {
    const state = buildWeariness();
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const cardId = handCardId(state, HAZARD_PLAYER);
    const baseProwess = getCharacter(recomputeDerived(state), RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess;

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId: companyId,
      targetCharacterId: aragornId,
      optionId: 'prowess',
    } as unknown as PlayHazardAction);
    const resolved = resolveChain(afterPlay);

    // The declared "prowess" option resolved (effective prowess reduced)...
    expect(getCharacter(resolved, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(baseProwess - 1);
    // ...and the other option ("corruption") never fires — no pending
    // corruption check was created by resolving this instance.
    expect(resolved.pendingResolutions.some(r => r.kind.type === 'corruption-check')).toBe(false);
  });
});
