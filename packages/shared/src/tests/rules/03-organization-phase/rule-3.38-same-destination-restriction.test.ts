/**
 * @module rule-3.38-same-destination-restriction
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.38: Same Destination Restriction
 *
 * Source: docs/coe-rules.txt
 *
 * RULING:
 * Two companies cannot declare movement from the same site of origin to
 * the same new site during the same organization phase.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce, dispatch,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, FRODO,
  LORIEN, MORIA, MINAS_TIRITH, RIVENDELL,
  viableActions,
} from '../../test-helpers.js';
import type { GameState, PlanMovementAction } from '../../../index.js';

describe('Rule 3.38 — Same Destination Restriction', () => {
  beforeEach(() => resetMint());

  test('second company at the same origin cannot target the same in-play destination', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [
            // Two companies at Lorien (shared origin) and a third at Moria
            // so Moria is a rule-3.39 sibling-shared candidate.
            { site: LORIEN, characters: [ARAGORN] },
            { site: LORIEN, characters: [LEGOLAS] },
            { site: MORIA, characters: [FRODO] },
          ],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [GIMLI] }], hand: [], siteDeck: [] },
      ],
    });

    // buildTestState mints a fresh site instance per company. In real game
    // state two companies at the same site share the instance; replicate
    // that by reusing company 0's currentSite for company 1.
    const sharedLorien = built.players[0].companies[0].currentSite!;
    const state: GameState = {
      ...built,
      players: [
        {
          ...built.players[0],
          companies: built.players[0].companies.map((c, i) =>
            i === 1 ? { ...c, currentSite: sharedLorien } : c,
          ),
        },
        built.players[1],
      ],
    };

    const moriaInstanceId = state.players[0].companies[2].currentSite!.instanceId;
    const firstLorienId = state.players[0].companies[0].id;
    const secondLorienId = state.players[0].companies[1].id;

    // Plan movement for the first Lorien company to Moria (sibling-shared destination).
    const plans = viableActions(state, PLAYER_1, 'plan-movement');
    const firstToMoria = plans.find(ea => {
      const a = ea.action as PlanMovementAction;
      return a.companyId === firstLorienId && a.destinationSite === moriaInstanceId;
    });
    expect(firstToMoria).toBeDefined();

    const afterFirst = dispatch(state, firstToMoria!.action);

    // Legal actions filter: the second Lorien company must not see Moria offered.
    const plansAfter = viableActions(afterFirst, PLAYER_1, 'plan-movement');
    const secondToMoria = plansAfter.find(ea => {
      const a = ea.action as PlanMovementAction;
      return a.companyId === secondLorienId && a.destinationSite === moriaInstanceId;
    });
    expect(secondToMoria).toBeUndefined();

    // Reducer guard: constructing the action directly must still be rejected.
    const directAction: PlanMovementAction = {
      type: 'plan-movement',
      player: PLAYER_1,
      companyId: secondLorienId,
      destinationSite: moriaInstanceId,
    };
    const rejected = reduce(afterFirst, directAction);
    expect(rejected.error).toBeDefined();
    expect(rejected.error).toMatch(/2\.II\.7\.1|same origin/i);
  });

  test('a company at a different origin may still target the same in-play destination', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: LORIEN, characters: [ARAGORN] }, // origin A
            { site: MORIA, characters: [FRODO] },    // in-play destination
          ],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [GIMLI] }], hand: [], siteDeck: [] },
      ],
    });

    const moriaInstanceId = state.players[0].companies[1].currentSite!.instanceId;
    const lorienCompanyId = state.players[0].companies[0].id;

    // Lorien → Moria via sibling in-play: legal.
    const plans = viableActions(state, PLAYER_1, 'plan-movement');
    const lorienToMoria = plans.find(ea => {
      const a = ea.action as PlanMovementAction;
      return a.companyId === lorienCompanyId && a.destinationSite === moriaInstanceId;
    });
    expect(lorienToMoria).toBeDefined();
  });
});
