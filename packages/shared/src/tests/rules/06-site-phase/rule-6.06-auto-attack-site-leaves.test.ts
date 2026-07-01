/**
 * @module rule-6.06-auto-attack-site-leaves
 *
 * CoE Rules — Section 6: Site Phase
 * Rule 6.06: Auto-Attack Continues if Site Leaves Play
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Once combat for an automatic-attack is initiated, the site is not an active condition of the attack; ongoing combat that was initiated from an automatic-attack will continue even if the site leaves play or the automatic-attack is otherwise removed from the site.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildSitePhaseState, resetMint,
  setupAutoAttackStep, continueAutoAttackCombat, findCharInstanceId,
  ARAGORN, MORIA,
  dispatch, PLAYER_1,
} from '../../test-helpers.js';
import { CardStatus } from '../../../types/common.js';

describe('Rule 6.06 — Auto-Attack Continues if Site Leaves Play', () => {
  beforeEach(() => resetMint());

  test('combat resolves normally after the site leaves the company mid-combat', () => {
    // MORIA has 1 auto-attack: Orcs, 4 strikes, 7 prowess.
    const state = buildSitePhaseState({ site: MORIA, characters: [ARAGORN] });
    const readyState = setupAutoAttackStep(state);
    const afterPass = dispatch(readyState, { type: 'pass', player: PLAYER_1 });

    expect(afterPass.combat).not.toBeNull();
    const originalSiteInstanceId = afterPass.combat!.attackSource.type === 'automatic-attack'
      ? afterPass.combat!.attackSource.siteInstanceId
      : null;
    expect(originalSiteInstanceId).not.toBeNull();

    // Simulate the site leaving play mid-combat: the company's currentSite
    // is cleared (as if the site were destroyed/returned). The already-
    // initiated combat carries its own snapshot of strikes/prowess/race and
    // never re-derives them from the site, so it must be unaffected.
    const siteLeftState = {
      ...afterPass,
      players: [
        { ...afterPass.players[0], companies: [{ ...afterPass.players[0].companies[0], currentSite: null }] },
        afterPass.players[1],
      ] as typeof afterPass.players,
    };

    const result = continueAutoAttackCombat(siteLeftState, [{ characterDefId: ARAGORN, roll: 12 }]);
    expect(result.error).toBeUndefined();

    // Combat fully resolved and finalized despite the missing site — no
    // error, no stall, and the defending character came through untouched
    // by the missing `currentSite` reference.
    expect(result.state.combat).toBeNull();
    const aragornId = findCharInstanceId(result.state, 0, ARAGORN);
    expect(result.state.players[0].characters[aragornId].status).toBe(CardStatus.Tapped);
  });
});
