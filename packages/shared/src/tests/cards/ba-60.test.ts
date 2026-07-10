/**
 * @module ba-60 — Gangways over the Fire
 *
 * Balrog-specific permanent resource-event (`extra-under-deeps-mh-phase` +
 * `starting-company-placement` + `duplication-limit` game). While it is in
 * play, each of the Balrog player's *moving* companies may, at the end of its
 * movement/hazard phase, attempt another Under-deeps movement to a site it has
 * not used this turn — a new site card is played and a fresh movement/hazard
 * phase immediately follows. The Under-deeps roll for each such extra phase is
 * penalised by the number of complete movement/hazard phases the company has
 * already taken this turn (first extra move at −1, and so on).
 *
 * These tests drive the engine: a company that finishes its M/H phase with
 * Gangways in play is offered the `gangways-offer` step; accepting re-enters an
 * Under-deeps movement/hazard phase with the cumulative roll penalty applied;
 * passing finalizes the company.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, makeMHState, addCardInPlay, resetMint, dispatch, viableFor,
  Phase, PLAYER_1, PLAYER_2,
} from '../test-helpers.js';
import { Alignment, LORIEN, LEGOLAS } from '../../index.js';
import type { CardDefinitionId, MovementHazardPhaseState } from '../../index.js';
import type { GangwaysExtraMoveAction, DeclarePathAction } from '../../types/actions-movement-hazard.js';

// BA cards (single-use, declared locally per project convention).
const GANGWAYS = 'ba-60' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;                 // minion character (mind 6)
const THE_UNDER_LEAS = 'ba-102' as CardDefinitionId;        // Under-deeps; adj The Iron-deeps(6)
const THE_IRON_DEEPS = 'ba-91' as CardDefinitionId;         // Under-deeps; adjacent to The Under-leas

/** Build an M/H state where a Balrog company sits, moved, at an Under-deeps
 *  site with Gangways in play and one adjacent Under-deeps site in the deck,
 *  and the resource player has already passed play-hazards. Dispatching the
 *  hazard player's pass ends the company's M/H phase. */
function readyToFinish() {
  let state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: THE_UNDER_LEAS, characters: [GORBAG] }],
        hand: [],
        siteDeck: [THE_IRON_DEEPS],
        playDeck: [],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [],
        playDeck: [],
      },
    ],
  });
  // The company moved this turn (it is at the Under-deeps site it reached).
  state = {
    ...state,
    players: [
      { ...state.players[0], companies: [{ ...state.players[0].companies[0], moved: true }] },
      state.players[1],
    ] as typeof state.players,
  };
  state = addCardInPlay(state, 0, GANGWAYS);
  state = { ...state, phaseState: makeMHState({ activeCompanyIndex: 0, resourcePlayerPassed: true }) };
  return state;
}

describe('ba-60 — Gangways over the Fire', () => {
  beforeEach(() => resetMint());

  test('a moving company that finishes its M/H phase is offered another Under-deeps movement', () => {
    const state = readyToFinish();
    const companyId = state.players[0].companies[0].id;

    const after = dispatch(state, { type: 'pass', player: PLAYER_2 });
    const mh = after.phaseState as MovementHazardPhaseState;

    expect(mh.phase).toBe(Phase.MovementHazard);
    expect(mh.step).toBe('gangways-offer');
    // One completed phase recorded (drives the −1 roll penalty next), and the
    // current site is recorded as used so it is not re-offered.
    expect(mh.gangwaysPhaseCounts?.[companyId as string]).toBe(1);
    expect(mh.gangwaysSitesUsed?.[companyId as string]).toContain(
      state.players[0].companies[0].currentSite!.definitionId,
    );

    const ironDeepsInst = after.players[0].siteDeck.find(s => s.definitionId === THE_IRON_DEEPS)!;
    const actions = viableFor(after, PLAYER_1);
    const extraMoves = actions
      .map(a => a.action)
      .filter((a): a is GangwaysExtraMoveAction => a.type === 'gangways-extra-move');
    expect(extraMoves.some(a => a.destinationSite === ironDeepsInst.instanceId)).toBe(true);
    // The player may also decline.
    expect(actions.some(a => a.action.type === 'pass')).toBe(true);
  });

  test('accepting sets up another Under-deeps M/H phase with the cumulative roll penalty', () => {
    const offered = dispatch(readyToFinish(), { type: 'pass', player: PLAYER_2 });
    const companyId = offered.players[0].companies[0].id;
    const ironDeepsInst = offered.players[0].siteDeck.find(s => s.definitionId === THE_IRON_DEEPS)!;

    const moved = dispatch(offered, {
      type: 'gangways-extra-move',
      player: PLAYER_1,
      companyId,
      destinationSite: ironDeepsInst.instanceId,
    });
    const mhMoved = moved.phaseState as MovementHazardPhaseState;

    // Re-entered the phase for another move: destination set, site drawn.
    expect(mhMoved.step).toBe('reveal-new-site');
    expect(moved.players[0].companies[0].destinationSite?.definitionId).toBe(THE_IRON_DEEPS);
    expect(moved.players[0].siteDeck.some(s => s.definitionId === THE_IRON_DEEPS)).toBe(false);

    // Only Under-deeps movement is offered; declaring it enters the roll step.
    const declare = viableFor(moved, PLAYER_1)
      .map(a => a.action)
      .find((a): a is DeclarePathAction => a.type === 'declare-path');
    expect(declare?.movementType).toBe('under-deeps');

    const rolling = dispatch(moved, declare!);
    const mhRoll = rolling.phaseState as MovementHazardPhaseState;
    expect(mhRoll.step).toBe('under-deeps-roll');
    // Base roll from The Under-leas → The Iron-deeps is 6; +1 penalty for the
    // one complete M/H phase already taken this turn → 7.
    expect(mhRoll.underDeepsRollRequired).toBe(7);
  });

  test('declining finishes the company and advances to the Site phase', () => {
    const offered = dispatch(readyToFinish(), { type: 'pass', player: PLAYER_2 });
    expect((offered.phaseState as MovementHazardPhaseState).step).toBe('gangways-offer');

    const done = dispatch(offered, { type: 'pass', player: PLAYER_1 });
    // The only company is now handled → the M/H phase ends and the Site phase begins.
    expect(done.phaseState.phase).toBe(Phase.Site);
  });
});
