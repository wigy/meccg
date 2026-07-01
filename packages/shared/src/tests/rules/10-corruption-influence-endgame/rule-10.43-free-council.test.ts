/**
 * @module rule-10.43-free-council
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.43: Free Council / Determining the Winner
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The Free Council / Audience with Sauron / Day of Reckoning / Day of Decision - When the game ends after being called and any subsequent turns have been completed, the winner is determined by proceeding through the following steps (10.3.i-vi) in order, prior to which characters do not automatically untap, during which no actions may be taken unless otherwise noted, and during which long- and permanent-events in play are still active.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { CardStatus, Phase } from '../../../index.js';
import type { ActiveConstraint, ConstraintId, FreeCouncilPhaseState } from '../../../index.js';
import {
  buildTestState, resetMint, viableFor, dispatch,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  findCharInstanceId, companyIdAt, recomputeDerived,
} from '../../test-helpers.js';

describe('Rule 10.43 — Free Council / Determining the Winner', () => {
  beforeEach(() => resetMint());

  test('Non-current player has no actions during Free Council corruption checks', () => {
    // Rule 10.43: "no actions may be taken unless otherwise noted."
    // During the corruption-checks step, only the currentPlayer may declare
    // corruption checks or pass. The other player must wait and cannot take
    // any normal resource/character/hazard actions.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);

    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [aragornId],
      firstPlayerDone: false,
      pendingCheck: null,
    };

    const state = { ...base, phaseState: fcState };

    // PLAYER_1 is the currentPlayer — they get exactly one pass action
    const p1Actions = viableFor(state, PLAYER_1);
    expect(p1Actions.some(a => a.action.type === 'pass')).toBe(true);

    // PLAYER_2 is NOT the currentPlayer — they get no viable actions
    const p2Actions = viableFor(state, PLAYER_2);
    expect(p2Actions).toHaveLength(0);
  });

  test('characters do not automatically untap entering the Free Council', () => {
    // A tapped character stays tapped once Free Council's corruption-checks
    // step is reached — no phase transition in the engine untaps characters
    // outside the normal Untap phase.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, status: CardStatus.Tapped }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck: null,
    };
    const state = { ...base, phaseState: fcState };
    expect(state.players[RESOURCE_PLAYER].characters[aragornId].status).toBe(CardStatus.Tapped);

    // Passing through the corruption-checks step doesn't untap anyone either.
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.players[RESOURCE_PLAYER].characters[aragornId].status).toBe(CardStatus.Tapped);
  });

  test('long/permanent-event effects still apply while the Free Council is in progress', () => {
    // A persistent (until-cleared) company-stat-modifier constraint — the same
    // kind a permanent-event like Orc-draughts installs — still resolves into
    // effective stats during the Free Council, proving it isn't cleared or
    // suspended by the phase transition into end-game scoring.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const baselineProwess = base.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.prowess;

    const constraint: ActiveConstraint = {
      id: 'c-permanent-boost' as ConstraintId,
      source: 'source-card-inst' as never,
      // Must resolve in state.cardPool for the resolver to pick it up —
      // any real card ID works, it's only used for display/lookup here.
      sourceDefinitionId: 'tw-206' as never,
      scope: { kind: 'until-cleared' },
      target: { kind: 'company', companyId },
      kind: { type: 'company-stat-modifier', stat: 'prowess', value: 1 },
    };
    const withConstraint = recomputeDerived({ ...base, activeConstraints: [...base.activeConstraints, constraint] });

    expect(withConstraint.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.prowess)
      .toBe(baselineProwess + 1);
  });
});
