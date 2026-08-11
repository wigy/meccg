/**
 * @module le-134.test
 *
 * Card test: River (le-134)
 * Type: hazard-event (short, targets the active company)
 * Effects: 2 (play-target site, on-event company-arrives-at-site → sequence of
 *             add-constraint site-phase-do-nothing + add-constraint
 *             granted-action cancel-river, scope:company-site-phase)
 *
 * "Playable on a site. A company moving to this site this turn must do
 *  nothing during its site phase. A ranger in such a company may tap to
 *  cancel this effect, even at the start of his company's site phase."
 *
 * Engine Support:
 * | # | Feature                                  | Status      | Notes                                  |
 * |---|------------------------------------------|-------------|----------------------------------------|
 * | 1 | Adds do-nothing-unless-ranger constraint | IMPLEMENTED | chain-reducer applyShortEventArrivalTrigger |
 * | 2 | Ranger may tap to cancel                 | IMPLEMENTED | constraint granted-action emits cancel-constraint action |
 *
 * Regression: this card's data previously encoded the ranger-cancel option
 * as a `cancelWhen` field on the `site-phase-do-nothing` add-constraint
 * effect — a property no code in the engine ever reads (unlike its twin
 * tw-84, which uses the supported `sequence` + `granted-action` shape).
 * Playing the card only ever installed the plain `site-phase-do-nothing`
 * restriction, with no accompanying `granted-action` constraint, so the
 * affected company was locked into `pass` for the whole site phase with no
 * way to tap a ranger to cancel it (bug report: "cannot tap gildor to
 * discard river only effect possible was skip site phase"). This test plays
 * the card through `reduce()` end-to-end so it exercises the real card data,
 * not a synthetic constraint fixture.
 *
 * Certified: 2026-04-08
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  makeMHState,
  companyIdAt, handCardId, HAZARD_PLAYER, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const RIVER_LE = 'le-134' as CardDefinitionId;

describe('River (le-134)', () => {
  beforeEach(() => resetMint());

  test('playing River through reduce adds both the restriction and the ranger-cancel grant', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [RIVER_LE], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const moriaCard = base.players[RESOURCE_PLAYER].siteDeck[0];
    const baseWithDest = {
      ...base,
      players: [
        {
          ...base.players[RESOURCE_PLAYER],
          companies: [{
            ...base.players[RESOURCE_PLAYER].companies[0],
            destinationSite: { instanceId: moriaCard.instanceId, definitionId: moriaCard.definitionId, status: CardStatus.Untapped },
          }],
        },
        base.players[HAZARD_PLAYER],
      ] as typeof base.players,
    };

    const stateAtPlayHazards = { ...baseWithDest, phaseState: makeMHState() };
    const riverInstance = handCardId(stateAtPlayHazards, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtPlayHazards, RESOURCE_PLAYER);

    const playResult = reduce(stateAtPlayHazards, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: riverInstance,
      targetCompanyId,
    });
    expect(playResult.error).toBeUndefined();

    // Resolve the chain (both players pass priority).
    let current = playResult.state;
    for (let i = 0; i < 10 && current.chain !== null; i++) {
      const r = reduce(current, { type: 'pass-chain-priority', player: current.chain.priority });
      if (r.error) break;
      current = r.state;
    }
    expect(current.chain).toBeNull();

    // Both River-sourced constraints must be present: the do-nothing
    // restriction AND the granted-action that lets a ranger cancel it.
    const riverConstraints = current.activeConstraints.filter(c => c.source === riverInstance);
    const kinds = riverConstraints.map(c => c.kind.type).sort();
    expect(kinds).toEqual(['granted-action', 'site-phase-do-nothing']);

    const grant = riverConstraints.find(c => c.kind.type === 'granted-action')!;
    if (grant.kind.type === 'granted-action') {
      expect(grant.kind.action).toBe('cancel-river');
    }
  });
});
