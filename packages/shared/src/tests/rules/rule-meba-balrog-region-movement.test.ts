/**
 * CoE rule 1.4.B1 / MEBA — Balrog movement across mixed-alignment sites.
 *
 * A Balrog player's location deck mixes minion (Ringwraith-alignment) sites
 * with their own `balrog`-alignment sites (rule 1.4.B1: "A Balrog player's
 * location deck may include one copy of each minion site other than..."), and
 * the player's companies stand on and move between both. The movement map
 * must therefore index minion sites for a Balrog player too, not just
 * `balrog` sites — mirroring the equivalent Fallen-wizard fix (see
 * rule-mewh-fw-region-movement.test.ts).
 *
 * Regression: a Balrog company at Moria (ba-93) with a declared destination
 * of the minion site Isengard (le-384, 3 regions away) found no legal
 * declare-path action during the movement/hazard phase's reveal-new-site
 * step, because the movement map only indexed `balrog`-alignment sites for a
 * Balrog player. Rule 5.04 then silently negated the "illegal" movement,
 * returning Isengard to the location deck and leaving the company stuck at
 * Moria — even though organization-phase plan-movement had accepted Isengard
 * as a destination (that offering path reads each candidate site's own
 * `.region` field directly and isn't affected by the movement-map bug).
 * Reported for game msrlp98a-o890m7 at seq 160.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';
import {
  buildTestState, resetMint, makeMHState, viableActions, dispatch, Phase,
  PLAYER_1, PLAYER_2,
  LORIEN,
} from '../test-helpers.js';

const MORIA_BALROG = 'ba-93' as CardDefinitionId;    // balrog-site haven, Redhorn Gate
const ISENGARD_MINION = 'le-384' as CardDefinitionId; // minion ruins-and-lairs, Gap of Isen (3 regions from Redhorn Gate)
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId;  // non-unique Orc, no avatar movement locks

describe('CoE 1.4.B1 / MEBA — Balrog mixed-alignment region movement', () => {
  beforeEach(() => resetMint());

  test('Balrog company at a balrog site can declare a region path to a minion site', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: MORIA_BALROG, characters: [CROOK_LEGGED_ORC], destinationSite: ISENGARD_MINION }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const state = { ...built, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false, maxRegionDistance: 4 }) };

    // Before the fix: no declare-path action was found (minion sites were
    // excluded from the Balrog movement map), so only rule 5.04's negating
    // 'pass' was offered.
    const declareActions = viableActions(state, PLAYER_1, 'declare-path');
    expect(declareActions.length).toBeGreaterThan(0);
    expect(declareActions.some(a => a.action.type === 'declare-path' && a.action.movementType === 'region')).toBe(true);

    const after = dispatch(state, declareActions[0].action);
    const company = after.players[0].companies[0];
    expect(company.destinationSite?.definitionId).toBe(ISENGARD_MINION);
  });
});
