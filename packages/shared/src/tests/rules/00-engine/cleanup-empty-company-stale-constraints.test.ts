/**
 * @module cleanup-empty-company-stale-constraints.test
 *
 * Regression: `cleanupEmptyCompanies` dropped a dissolved company from
 * `player.companies` without also dropping any `activeConstraints` still
 * targeting that company's ID. Company IDs are index-based and recycled by
 * `nextCompanyId` once the dissolved slot is gone from the array, so a later
 * split/merge can reissue the exact same ID for an unrelated company — which
 * then silently inherits the stale constraint.
 *
 * Bug report: River (le-134/tw-84) was played against a company that lost
 * its last character (body-check kill) later in the same movement/hazard
 * phase. The resulting `site-phase-do-nothing` + `granted-action`
 * constraints were never consumed (the dissolved company never reaches a
 * site phase) and lingered in `activeConstraints`. Turns later, a
 * `split-company` reused the freed company ID, and the new company
 * inherited River's restriction and ranger-cancel grant out of nowhere,
 * before it had even declared a destination for the turn.
 */

import { describe, test, expect } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, MORIA, LORIEN,
  buildTestState,
} from '../../test-helpers.js';
import { Phase } from '../../../index.js';
import { cleanupEmptyCompanies } from '../../../engine/reducer-utils.js';
import { addConstraint } from '../../../engine/pending.js';

describe('cleanupEmptyCompanies drops stale constraints on a dissolved company', () => {
  test('removes activeConstraints targeting a company that just lost its last character', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });

    const company = state.players[RESOURCE_PLAYER].companies[0];
    const riverInstance = state.players[HAZARD_PLAYER].companies[0].characters[0];

    const withRiver = addConstraint(
      addConstraint(state, {
        source: riverInstance,
        sourceDefinitionId: 'le-134',
        scope: { kind: 'company-site-phase', companyId: company.id },
        target: { kind: 'company', companyId: company.id },
        kind: { type: 'site-phase-do-nothing' },
      } as never),
      {
        source: riverInstance,
        sourceDefinitionId: 'le-134',
        scope: { kind: 'company-site-phase', companyId: company.id },
        target: { kind: 'company', companyId: company.id },
        kind: {
          type: 'granted-action',
          action: 'cancel-river',
          cost: { tap: 'character' },
          apply: { type: 'remove-constraint', select: 'constraint-source' },
        },
      } as never,
    );

    expect(withRiver.activeConstraints).toHaveLength(2);

    // The company's sole character is eliminated (e.g. a body check), leaving it empty.
    const emptied = {
      ...withRiver,
      players: [
        { ...withRiver.players[0], companies: [{ ...company, characters: [] }] },
        withRiver.players[1],
      ],
    } as typeof withRiver;

    const result = cleanupEmptyCompanies(emptied);

    expect(result.players[RESOURCE_PLAYER].companies).toHaveLength(0);
    expect(result.activeConstraints.filter(c => c.target.kind === 'company' && c.target.companyId === company.id)).toHaveLength(0);
  });
});
