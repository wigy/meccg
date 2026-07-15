/**
 * @module le-185 — Forced March
 *
 * Minion resource short-event (`grant-extra-mh-phase`, requiring the moving
 * company's destination to be a Darkhaven — a `haven` of `ringwraith`
 * alignment). Card text: "Playable at the end of the movement/hazard phase on a
 * company that moved to a Darkhaven [{DH}]. The company may move to an
 * additional site this turn. Another site card may be played and another
 * movement/hazard phase immediately follows for that company."
 *
 * These tests drive the engine end-to-end: the event is offered only when the
 * active company is moving to a Darkhaven; resolving it flags the company; once
 * its move to the Darkhaven commits (both players pass play-hazards), the
 * company is offered the dedicated `extra-mh-move-offer` step, where the active
 * player either sends it on another movement (re-entering a fresh M/H phase at
 * `reveal-new-site`) or passes to finish the company.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, makeMHState, resetMint, dispatch, viableFor,
  Phase, PLAYER_1, PLAYER_2,
} from '../test-helpers.js';
import { Alignment, LORIEN, LEGOLAS } from '../../index.js';
import type { CardDefinitionId, GameState, MovementHazardPhaseState } from '../../index.js';
import type { ExtraMHMoveAction } from '../../types/actions-movement-hazard.js';

const FORCED_MARCH = 'le-185' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;               // minion character (mind 6)
const ETTENMOORS = 'le-373' as CardDefinitionId;          // origin (R&L, nearestHaven Carn Dûm)
const CARN_DUM = 'le-359' as CardDefinitionId;            // Darkhaven (haven, ringwraith)
const WHITE_TOWERS = 'le-412' as CardDefinitionId;        // R&L, nearestHaven Carn Dûm → reachable
const GOBLIN_GATE = 'le-378' as CardDefinitionId;         // shadow-hold (NOT a Darkhaven)

/**
 * Build an M/H play-hazards state where PLAYER_1's (Ringwraith) company is
 * moving from Ettenmoors to `destination`, with Forced March in hand and one
 * further site (The White Towers) reachable from Carn Dûm in the site deck.
 */
function movingTo(destination: CardDefinitionId) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: ETTENMOORS, characters: [GORBAG], destinationSite: destination }],
        hand: [FORCED_MARCH],
        siteDeck: [WHITE_TOWERS],
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
}

/** Reach the `extra-mh-move-offer` step: play Forced March, then both players
 *  pass so the move to Carn Dûm commits and the extra phase is offered. */
function offeredExtraMove() {
  let state: GameState = { ...movingTo(CARN_DUM), phaseState: makeMHState({ activeCompanyIndex: 0 }) };
  const fmInst = state.players[0].hand.find(c => c.definitionId === FORCED_MARCH)!.instanceId;
  state = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: fmInst });
  state = dispatch(state, { type: 'pass', player: PLAYER_1 });
  state = dispatch(state, { type: 'pass', player: PLAYER_2 });
  return state;
}

describe('le-185 — Forced March', () => {
  beforeEach(() => resetMint());

  test('is playable during play-hazards on a company moving to a Darkhaven', () => {
    const state = { ...movingTo(CARN_DUM), phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const fmInst = state.players[0].hand.find(c => c.definitionId === FORCED_MARCH)!.instanceId;

    const plays = viableFor(state, PLAYER_1)
      .map(a => a.action)
      .filter(a => a.type === 'play-short-event' && a.cardInstanceId === fmInst);
    expect(plays.length).toBe(1);
  });

  test('is NOT playable when the company is moving to a non-Darkhaven site', () => {
    const state = { ...movingTo(GOBLIN_GATE), phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const fmInst = state.players[0].hand.find(c => c.definitionId === FORCED_MARCH)!.instanceId;

    const plays = viableFor(state, PLAYER_1)
      .map(a => a.action)
      .filter(a => a.type === 'play-short-event' && a.cardInstanceId === fmInst);
    expect(plays.length).toBe(0);
  });

  test('resolving Forced March flags the company for an extra M/H phase and discards the card', () => {
    const state = { ...movingTo(CARN_DUM), phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const fmInst = state.players[0].hand.find(c => c.definitionId === FORCED_MARCH)!.instanceId;

    const after = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: fmInst });

    expect(after.players[0].companies[0].extraMHPhasePending).toBe(true);
    expect(after.players[0].hand.some(c => c.instanceId === fmInst)).toBe(false);
    expect(after.players[0].discardPile.some(c => c.instanceId === fmInst)).toBe(true);
    // Still in the play-hazards step — the extra phase is granted only after the
    // current move commits.
    expect((after.phaseState as MovementHazardPhaseState).step).toBe('play-hazards');
  });

  test('after the move commits, the company is offered another movement to an additional site', () => {
    const offered = offeredExtraMove();
    const mh = offered.phaseState as MovementHazardPhaseState;
    const company = offered.players[0].companies[0];

    expect(mh.phase).toBe(Phase.MovementHazard);
    expect(mh.step).toBe('extra-mh-move-offer');
    // The move to the Darkhaven has committed.
    expect(company.currentSite?.definitionId).toBe(CARN_DUM);
    expect(company.extraMHPhasePending).toBeFalsy();

    // The White Towers (reachable from Carn Dûm, still in the site deck) is
    // offered as an extra destination, plus the option to decline.
    const whiteTowersInst = offered.players[0].siteDeck.find(s => s.definitionId === WHITE_TOWERS)!;
    const actions = viableFor(offered, PLAYER_1).map(a => a.action);
    const extraMoves = actions.filter((a): a is ExtraMHMoveAction => a.type === 'extra-mh-move');
    expect(extraMoves.some(a => a.destinationSite === whiteTowersInst.instanceId)).toBe(true);
    expect(actions.some(a => a.type === 'pass')).toBe(true);
  });

  test('accepting the extra move re-enters a fresh movement/hazard phase at the new destination', () => {
    const offered = offeredExtraMove();
    const companyId = offered.players[0].companies[0].id;
    const whiteTowersInst = offered.players[0].siteDeck.find(s => s.definitionId === WHITE_TOWERS)!;

    const moved = dispatch(offered, {
      type: 'extra-mh-move',
      player: PLAYER_1,
      companyId,
      destinationSite: whiteTowersInst.instanceId,
    });
    const mh = moved.phaseState as MovementHazardPhaseState;

    // A new movement/hazard phase begins: destination set, its site drawn from
    // the deck, and per-phase state reset (hazard count back to zero).
    expect(mh.step).toBe('reveal-new-site');
    expect(moved.players[0].companies[0].destinationSite?.definitionId).toBe(WHITE_TOWERS);
    expect(moved.players[0].siteDeck.some(s => s.definitionId === WHITE_TOWERS)).toBe(false);
    expect(mh.hazardsPlayedThisCompany).toBe(0);

    // The company can declare a path to the additional site.
    const declare = viableFor(moved, PLAYER_1)
      .map(a => a.action)
      .find(a => a.type === 'declare-path');
    expect(declare).toBeDefined();
  });

  test('declining the extra move finishes the company and advances to the Site phase', () => {
    const offered = offeredExtraMove();
    expect((offered.phaseState as MovementHazardPhaseState).step).toBe('extra-mh-move-offer');

    const done = dispatch(offered, { type: 'pass', player: PLAYER_1 });
    // The only company is now handled → the M/H phase ends and the Site phase begins.
    expect(done.phaseState.phase).toBe(Phase.Site);
  });
});
