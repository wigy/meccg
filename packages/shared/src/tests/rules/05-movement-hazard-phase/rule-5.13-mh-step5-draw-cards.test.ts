/**
 * @module rule-5.13-mh-step5-draw-cards
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.13: Step 5: Draw Cards
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Movement/Hazard Phase, Step 5 (Draw Cards) - If the company is moving, both players simultaneously draw cards based on the new site if moving to one of the resource player's non-haven sites OR based on the site of origin if moving to one of the resource player's haven sites:
 * • The resource player may draw up to the number in the lighter box in the bottom-left of the site card, so long as the moving company contains an avatar or a character with mind three or greater. If the company does, the resource player must draw at least one card (unless an effect would reduce the number drawn to less than one).
 * • The hazard player may draw up to the number in the darker box in the bottom-left of the site card, and must draw at least one card (unless an effect would reduce the number drawn to less than one).
 * No other actions can be taken during this step, which happens immediately and is considered synonymous with revealing the site.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, makeMHState, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS, EOWYN,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../../test-helpers.js';
import { CardStatus } from '../../../index.js';
import type { MovementHazardPhaseState } from '../../../index.js';

describe('Rule 5.13 — Step 5: Draw Cards', () => {
  beforeEach(() => resetMint());

  test('If moving, both players draw cards based on site card; resource player needs avatar or mind>=3 character', () => {
    // ARAGORN has mind=9 → eligible to draw
    const baseWithAragorn = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA, MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const company = baseWithAragorn.players[RESOURCE_PLAYER].companies[0];
    const moriaSite = baseWithAragorn.players[RESOURCE_PLAYER].siteDeck.find(c => c.definitionId === MORIA)!;

    const stateMoving = {
      ...baseWithAragorn,
      phaseState: makeMHState({ step: 'order-effects', activeCompanyIndex: 0 }),
      players: [
        {
          ...baseWithAragorn.players[RESOURCE_PLAYER],
          companies: [{
            ...company,
            destinationSite: { instanceId: moriaSite.instanceId, definitionId: moriaSite.definitionId, status: CardStatus.Untapped },
            siteOfOrigin: company.currentSite!.instanceId,
          }],
        },
        baseWithAragorn.players[1],
      ] as typeof baseWithAragorn.players,
    };

    // Pass order-effects → transitions to draw-cards with MORIA draw values
    const afterPass = dispatch(stateMoving, { type: 'pass', player: PLAYER_1 });
    const mhState = afterPass.phaseState as MovementHazardPhaseState;

    // MORIA has resourceDraws=2, hazardDraws=3; Aragorn is eligible (mind=9 >= 3)
    expect(mhState.step).toBe('draw-cards');
    expect(mhState.resourceDrawMax).toBe(2);
    expect(mhState.hazardDrawMax).toBe(3);

    // ÉOWYN has mind=2, not eligible → resource player cannot draw
    const baseWithEowyn = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [EOWYN] }], hand: [], siteDeck: [MORIA, MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const company2 = baseWithEowyn.players[RESOURCE_PLAYER].companies[0];
    const moriaSite2 = baseWithEowyn.players[RESOURCE_PLAYER].siteDeck.find(c => c.definitionId === MORIA)!;

    const stateMovingEowyn = {
      ...baseWithEowyn,
      phaseState: makeMHState({ step: 'order-effects', activeCompanyIndex: 0 }),
      players: [
        {
          ...baseWithEowyn.players[RESOURCE_PLAYER],
          companies: [{
            ...company2,
            destinationSite: { instanceId: moriaSite2.instanceId, definitionId: moriaSite2.definitionId, status: CardStatus.Untapped },
            siteOfOrigin: company2.currentSite!.instanceId,
          }],
        },
        baseWithEowyn.players[1],
      ] as typeof baseWithEowyn.players,
    };

    const afterPassEowyn = dispatch(stateMovingEowyn, { type: 'pass', player: PLAYER_1 });
    const mhStateEowyn = afterPassEowyn.phaseState as MovementHazardPhaseState;

    // Éowyn has mind=2 < 3 → resource player cannot draw (resourceDrawMax=0)
    expect(mhStateEowyn.step).toBe('draw-cards');
    expect(mhStateEowyn.resourceDrawMax).toBe(0);
    // Hazard player always draws regardless of resource company composition
    expect(mhStateEowyn.hazardDrawMax).toBe(3);
  });

  test('A company eliminated during step 4 draws nothing and the phase continues to hazards', () => {
    // There is no company left to draw "based on the new site", because there
    // is no new site and no one to arrive at it. An ahunt attack resolved in
    // step 4 can kill every character in the moving company, and the company
    // goes with its last character — so step 5 opens addressing a company that
    // is not there. It is not moving, so it draws nothing, exactly as a
    // stationary company does, and the phase carries on to step 7.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA, MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    // The company was moving to Moria when it was wiped out; `activeCompanyIndex`
    // still addresses slot 0, which no longer exists.
    const eliminated = {
      ...base,
      phaseState: makeMHState({ step: 'order-effects', activeCompanyIndex: 0 }),
      players: [
        { ...base.players[RESOURCE_PLAYER], companies: [] },
        base.players[1],
      ] as typeof base.players,
    };

    const after = dispatch(eliminated, { type: 'pass', player: PLAYER_1 });
    const mhState = after.phaseState as MovementHazardPhaseState;

    expect(mhState.step).toBe('play-hazards');
  });
});
