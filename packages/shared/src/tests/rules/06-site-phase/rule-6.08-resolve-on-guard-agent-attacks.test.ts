/**
 * @module rule-6.08-resolve-on-guard-agent-attacks
 *
 * CoE Rules — Section 6: Site Phase
 * Rule 6.08: Step 4: Resolve On-Guard/Agent Attacks
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Entering a Site, Step 4 (Resolving On-Guard and/or Agent Attacks) - If the hazard player previously declared any on-guard creature or agent hazard attacks during this site phase, those attacks are initiated and resolved in an order chosen by the resource player, with each proceeding immediately in the chosen order.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, makeSitePhase, placeOnGuard, resolveChain, viableActions,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  MORIA, LORIEN,
  BARROW_WIGHT,
} from '../../test-helpers.js';
import { Phase } from '../../../index.js';

describe('Rule 6.08 — Step 4: Resolve On-Guard/Agent Attacks', () => {
  beforeEach(() => resetMint());

  test('On-guard creature attacks resolved via resource player passes in resolve-attacks step', () => {
    // After hazard player passes declare-agent-attack (no agent attack), step is resolve-attacks.
    // Resource player passes to initiate each revealed on-guard creature.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const { state: withOG } = placeOnGuard(base, RESOURCE_PLAYER, 0, BARROW_WIGHT, { revealed: true });
    const testState = { ...withOG, phaseState: makeSitePhase({ step: 'resolve-attacks', siteEntered: true }) };

    // Resource player passes → on-guard creature enters chain
    const afterPass = dispatch(testState, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.chain).not.toBeNull();

    // After chain resolves, combat is initiated
    const afterChain = resolveChain(afterPass);
    expect(afterChain.combat).not.toBeNull();
  });

  test('when no revealed on-guard creatures remain, resource player pass advances to play-resources', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const testState = { ...base, phaseState: makeSitePhase({ step: 'resolve-attacks', siteEntered: true }) };

    const afterPass = dispatch(testState, { type: 'pass', player: PLAYER_1 });
    expect((afterPass.phaseState as { step: string }).step).toBe('play-resources');

    // Resource player has actions in play-resources
    const resourceActions = viableActions(afterPass, PLAYER_1, 'pass');
    expect(resourceActions.length).toBeGreaterThan(0);
  });
});
