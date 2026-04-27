/**
 * @module rule-6.20-end-of-site-phase
 *
 * CoE Rules — Section 6: Site Phase
 * Rule 6.20: End of Site Phases
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Once the resource player declares that they are done taking actions during a company's site phase, that company's site phase ends. Once all site phases have ended, any remaining on-guard cards are returned to the hazard player's hand.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, makeSitePhase, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  ORC_PATROL,
} from '../../test-helpers.js';
import type { CardInstanceId } from '../../../index.js';

describe('Rule 6.20 — End of Site Phases', () => {
  beforeEach(() => resetMint());

  test('Site phase ends when resource player declares done; remaining on-guard cards returned to hazard player hand', () => {
    // PLAYER_1 has one company at Moria. An on-guard card (ORC_PATROL) was placed
    // on the company by PLAYER_2. When PLAYER_1 passes during play-resources,
    // all companies are handled and the on-guard card must return to PLAYER_2's hand.

    const ogInstanceId = 'og-orc-patrol' as CardInstanceId;
    const ogCard = { instanceId: ogInstanceId, definitionId: ORC_PATROL, revealed: false };

    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    // Attach the on-guard card to PLAYER_1's company
    const company = base.players[RESOURCE_PLAYER].companies[0];
    const stateWithOG = {
      ...base,
      phaseState: makeSitePhase({ step: 'play-resources', activeCompanyIndex: 0 }),
      players: [
        {
          ...base.players[RESOURCE_PLAYER],
          companies: [{ ...company, onGuardCards: [ogCard] }],
        },
        base.players[HAZARD_PLAYER],
      ] as typeof base.players,
    };

    // Verify on-guard card is on the company
    expect(stateWithOG.players[RESOURCE_PLAYER].companies[0].onGuardCards).toHaveLength(1);
    expect(stateWithOG.players[HAZARD_PLAYER].hand).toHaveLength(0);

    // Resource player passes → company site phase ends → all companies done → advance to EoT
    const afterPass = dispatch(stateWithOG, { type: 'pass', player: PLAYER_1 });

    // On-guard card must have returned to hazard player's hand
    expect(afterPass.players[HAZARD_PLAYER].hand.some(c => c.instanceId === ogInstanceId)).toBe(true);
    // Company's on-guard list must be cleared
    expect(afterPass.players[RESOURCE_PLAYER].companies[0]?.onGuardCards ?? []).toHaveLength(0);
    // Phase advanced to End-of-Turn
    expect(afterPass.phaseState.phase).toBe(Phase.EndOfTurn);
  });
});
