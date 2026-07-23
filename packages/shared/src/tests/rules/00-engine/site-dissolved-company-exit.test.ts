/**
 * @module site-dissolved-company-exit.test
 *
 * Regression from heuristic self-play (sim seed 30213): a company entered
 * its site and then every character died (automatic-attack strikes and
 * body checks), dissolving the company mid-site-phase while the phase
 * state still pointed at its slot (`step: 'play-resources'`,
 * `activeCompanyIndex` dangling). `playResourcesActions` returned an empty
 * list — no pass — so neither player had a viable action and the game
 * deadlocked.
 *
 * Engine invariant (see also the enter-or-skip guard): every legal-action
 * branch must always offer at least one action, and the reducer must
 * accept it. With the active company dissolved, `pass` is offered and
 * finishes the dissolved company's site-phase slot.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  viableActions, dispatch,
} from '../../test-helpers.js';
import { Phase } from '../../../index.js';
import type { GameState, SitePhaseState } from '../../../index.js';

describe('site phase: dissolved active company always has an exit (play-resources)', () => {
  beforeEach(() => resetMint());

  test('pass is offered and finishes the dissolved company slot', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // The company entered the site and then dissolved: remove the company
    // and its character, leaving the phase state pointing at its slot.
    const wiped: GameState = {
      ...base,
      players: [
        { ...base.players[0], companies: [], characters: {} },
        base.players[1],
      ],
    };
    const siteState: SitePhaseState = {
      phase: Phase.Site,
      step: 'play-resources',
      activeCompanyIndex: 0,
      handledCompanyIds: [],
      siteEntered: true,
      resourcePlayed: true,
      minorItemAvailable: true,
      hoardBountyAvailable: false,
      thoroughSearchAvailable: false,
      declaredAgentAttack: null,
      automaticAttacksResolved: 1,
      awaitingOnGuardReveal: false,
      pendingResourceAction: null,
      opponentInteractionThisTurn: null,
      pendingOpponentInfluence: null,
    };
    const state: GameState = { ...wiped, phaseState: siteState };

    // The active player must still have an exit: exactly a viable pass.
    const passes = viableActions(state, PLAYER_1, 'pass');
    expect(passes).toHaveLength(1);

    // The reducer accepts it and the dissolved slot is finished — with no
    // companies left, the site phase ends and the turn moves on.
    const after = dispatch(state, passes[0].action);
    expect(after.phaseState.phase).toBe(Phase.EndOfTurn);
  });
});
