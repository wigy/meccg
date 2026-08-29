/**
 * @module tw-202 — Bridge
 *
 * Hero resource short-event (`grant-extra-mh-phase`, requiring the moving
 * company's destination to be a Haven — any `SiteType.Haven` site, no
 * alignment restriction). Card text: "Playable at the end of the
 * movement/hazard phase on a company that moved to a Haven [{H}]. That
 * company may move to an additional site on the same turn. Another site card
 * may be played and a movement/hazard phase immediately follows for that
 * company."
 *
 * Shares its engine machinery with Forced March (le-185) — see that card's
 * test for the underlying `grant-extra-mh-phase` mechanics (chain-of-effects
 * timing, `extraMHPhasePending`, the `extra-mh-move-offer` step). These tests
 * confirm Bridge's own play gate (any Haven, not just a Darkhaven) and that
 * the extra-move offer/accept/decline flow works end-to-end for it.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, makeMHState, resetMint, dispatch, resolveChain, viableFor,
  Phase, PLAYER_1, PLAYER_2,
} from '../test-helpers.js';
import { LORIEN, LEGOLAS, RIVENDELL, ETTENMOORS_HERO } from '../../index.js';
import type { CardDefinitionId, GameState, MovementHazardPhaseState } from '../../index.js';
import type { ExtraMHMoveAction } from '../../types/actions-movement-hazard.js';

const BRIDGE = 'tw-202' as CardDefinitionId;
const CAMETH_BRIN = 'tw-379' as CardDefinitionId;    // border-hold, nearestHaven Rivendell — reachable from Rivendell
const GOBLIN_GATE = 'tw-398' as CardDefinitionId;    // shadow-hold (NOT a Haven)

/**
 * Build an M/H play-hazards state where PLAYER_1's company is moving from
 * Ettenmoors to `destination`, with Bridge in hand and one further site
 * (Cameth Brin) reachable from Rivendell in the site deck.
 */
function movingTo(destination: CardDefinitionId) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: ETTENMOORS_HERO, characters: [LEGOLAS], destinationSite: destination }],
        hand: [BRIDGE],
        siteDeck: [CAMETH_BRIN],
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

/** Reach the `extra-mh-move-offer` step: play Bridge, then both players pass
 *  so the move to Rivendell commits and the extra phase is offered. */
function offeredExtraMove() {
  let state: GameState = { ...movingTo(RIVENDELL), phaseState: makeMHState({ activeCompanyIndex: 0 }) };
  const bridgeInst = state.players[0].hand.find(c => c.definitionId === BRIDGE)!.instanceId;
  state = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: bridgeInst }));
  state = dispatch(state, { type: 'pass', player: PLAYER_1 });
  state = dispatch(state, { type: 'pass', player: PLAYER_2 });
  return state;
}

describe('tw-202 — Bridge', () => {
  beforeEach(() => resetMint());

  test('is playable during play-hazards on a company moving to a Haven', () => {
    const state = { ...movingTo(RIVENDELL), phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const bridgeInst = state.players[0].hand.find(c => c.definitionId === BRIDGE)!.instanceId;

    const plays = viableFor(state, PLAYER_1)
      .map(a => a.action)
      .filter(a => a.type === 'play-short-event' && a.cardInstanceId === bridgeInst);
    expect(plays.length).toBe(1);
  });

  test('is NOT playable when the company is moving to a non-Haven site', () => {
    const state = { ...movingTo(GOBLIN_GATE), phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const bridgeInst = state.players[0].hand.find(c => c.definitionId === BRIDGE)!.instanceId;

    const plays = viableFor(state, PLAYER_1)
      .map(a => a.action)
      .filter(a => a.type === 'play-short-event' && a.cardInstanceId === bridgeInst);
    expect(plays.length).toBe(0);
  });

  test('resolving Bridge flags the company for an extra M/H phase and discards the card', () => {
    const state = { ...movingTo(RIVENDELL), phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const bridgeInst = state.players[0].hand.find(c => c.definitionId === BRIDGE)!.instanceId;

    const after = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: bridgeInst }));

    expect(after.players[0].companies[0].extraMHPhasePending).toBe(true);
    expect(after.players[0].hand.some(c => c.instanceId === bridgeInst)).toBe(false);
    expect(after.players[0].discardPile.some(c => c.instanceId === bridgeInst)).toBe(true);
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
    // The move to Rivendell has committed.
    expect(company.currentSite?.definitionId).toBe(RIVENDELL);
    expect(company.extraMHPhasePending).toBeFalsy();

    // Cameth Brin (reachable from Rivendell, still in the site deck) is
    // offered as an extra destination, plus the option to decline.
    const camethBrinInst = offered.players[0].siteDeck.find(s => s.definitionId === CAMETH_BRIN)!;
    const actions = viableFor(offered, PLAYER_1).map(a => a.action);
    const extraMoves = actions.filter((a): a is ExtraMHMoveAction => a.type === 'extra-mh-move');
    expect(extraMoves.some(a => a.destinationSite === camethBrinInst.instanceId)).toBe(true);
    expect(actions.some(a => a.type === 'pass')).toBe(true);
  });

  test('accepting the extra move re-enters a fresh movement/hazard phase at the new destination', () => {
    const offered = offeredExtraMove();
    const companyId = offered.players[0].companies[0].id;
    const camethBrinInst = offered.players[0].siteDeck.find(s => s.definitionId === CAMETH_BRIN)!;

    const moved = dispatch(offered, {
      type: 'extra-mh-move',
      player: PLAYER_1,
      companyId,
      destinationSite: camethBrinInst.instanceId,
    });
    const mh = moved.phaseState as MovementHazardPhaseState;

    // A new movement/hazard phase begins: destination set, its site drawn from
    // the deck, and per-phase state reset (hazard count back to zero).
    expect(mh.step).toBe('reveal-new-site');
    expect(moved.players[0].companies[0].destinationSite?.definitionId).toBe(CAMETH_BRIN);
    expect(moved.players[0].siteDeck.some(s => s.definitionId === CAMETH_BRIN)).toBe(false);
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
