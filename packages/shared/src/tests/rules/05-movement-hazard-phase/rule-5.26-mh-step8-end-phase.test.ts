/**
 * @module rule-5.26-mh-step8-end-phase
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.26: Step 8: End the Company M/H Phase
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Movement/Hazard Phase, Step 8 (End the Company's Movement/Hazard Phase) - A company's movement-hazard phase ends when both players declare that they are done taking actions. Any passive conditions initiated by the end of the phase are declared and resolved in an order chosen by the resource player. Then if no other companies have declared unresolved movement to this company's site of origin, the site of origin is immediately discarded if it was tapped and not a haven site for its player, or returned to the resource player's location deck if it was untapped or a haven site for its player. Both players then immediately reset their hands by drawing or discarding to their base hand size. No other action can be taken during this step unless it is specifically allowed at the end of the movement/hazard phase.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, makeMHState, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  LORIEN, HENNETH_ANNUN, MINAS_TIRITH,
} from '../../test-helpers.js';
import { CardStatus } from '../../../index.js';
import type { GameState } from '../../../index.js';

describe('Rule 5.26 — Step 8: End the Company M/H Phase', () => {
  beforeEach(() => resetMint());

  test.todo('Phase ends when both players done; site of origin handled; both players reset hands to base hand size');

  test('company arriving at a new site owns the site card even if it previously did not', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: MINAS_TIRITH, characters: [ARAGORN] },
          ],
          hand: [],
          siteDeck: [HENNETH_ANNUN],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });

    const company = built.players[0].companies[0];
    const hennethSite = built.players[0].siteDeck.find(
      c => c.definitionId === HENNETH_ANNUN,
    )!;

    const state: GameState = {
      ...built,
      phaseState: makeMHState({
        activeCompanyIndex: 0,
        resourcePlayerPassed: false,
        hazardPlayerPassed: false,
      }),
      players: [
        {
          ...built.players[0],
          companies: [{
            ...company,
            siteCardOwned: false,
            destinationSite: { instanceId: hennethSite.instanceId, definitionId: hennethSite.definitionId, status: CardStatus.Untapped },
            siteOfOrigin: company.currentSite!.instanceId,
          }],
          siteDeck: built.players[0].siteDeck,
        },
        built.players[1],
      ],
    };

    const afterResourcePass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const afterBothPass = dispatch(afterResourcePass, { type: 'pass', player: PLAYER_2 });

    const arrivedCompany = afterBothPass.players[0].companies[0];
    expect(arrivedCompany.currentSite?.definitionId).toBe(HENNETH_ANNUN);
    expect(arrivedCompany.siteCardOwned).toBe(true);
  });
});
