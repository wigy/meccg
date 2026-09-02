/**
 * @module le-202 — Leg It Double Quick
 *
 * Minion resource short-event (`company-tap-characters` + `grant-extra-mh-phase`,
 * neither carrying a destination-type/alignment gate). Card text: "Playable at
 * the end of the movement/hazard phase on a moving company. Tap all untapped
 * characters in the company. The company may move to an additional site this
 * turn. Another site card may be played and another movement/hazard phase
 * immediately follows for that company."
 *
 * Unlike Forced March (le-185) — the Darkhaven-gated sibling — this card is
 * offered on ANY moving company regardless of destination, but costs tapping
 * every untapped character in the company before granting the extra phase.
 * These tests confirm the missing destination gate and the tap cost, then
 * reuse the shared `extra-mh-move-offer` flow already proven by le-185.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, makeMHState, resetMint, dispatch, resolveChain, viableFor,
  Phase, PLAYER_1, PLAYER_2,
  getCharacter, expectCharStatus,
} from '../test-helpers.js';
import { Alignment, CardStatus, LORIEN, LEGOLAS } from '../../index.js';
import type { CardDefinitionId, GameState, MovementHazardPhaseState } from '../../index.js';
import type { ExtraMHMoveAction } from '../../types/actions-movement-hazard.js';

const LEG_IT = 'le-202' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;               // minion character (mind 6)
const LAGDUF = 'le-18' as CardDefinitionId;                // minion character (mind 3, no Leader keyword)
const ETTENMOORS = 'le-373' as CardDefinitionId;          // origin (R&L, nearestHaven Carn Dûm)
const CARN_DUM = 'le-359' as CardDefinitionId;             // Darkhaven (haven, ringwraith)
const WHITE_TOWERS = 'le-412' as CardDefinitionId;         // R&L, nearestHaven Carn Dûm → reachable
const GOBLIN_GATE = 'le-378' as CardDefinitionId;          // shadow-hold (NOT a Darkhaven)

/**
 * Build an M/H play-hazards state where PLAYER_1's (Ringwraith) company is
 * moving from Ettenmoors to `destination`, with Leg It Double Quick in hand,
 * an untapped Gorbag and an already-tapped Lagduf in the company, and one
 * further site (The White Towers) reachable from Carn Dûm in the site deck.
 *
 * Lagduf carries no Leader keyword on purpose: Gorbag is already a Leader,
 * and a second one would make this a two-Leader company, which rule 3.26
 * (glossary "leader") confines to haven destinations — including on the
 * extra movement this card grants.
 */
function movingTo(destination: CardDefinitionId) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{
          site: ETTENMOORS,
          characters: [GORBAG, { defId: LAGDUF, status: CardStatus.Tapped }],
          destinationSite: destination,
        }],
        hand: [LEG_IT],
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

/** Reach the `extra-mh-move-offer` step: play Leg It Double Quick, then both
 *  players pass so the move to Carn Dûm commits and the extra phase is offered. */
function offeredExtraMove() {
  let state: GameState = { ...movingTo(CARN_DUM), phaseState: makeMHState({ activeCompanyIndex: 0 }) };
  const inst = state.players[0].hand.find(c => c.definitionId === LEG_IT)!.instanceId;
  state = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: inst }));
  state = dispatch(state, { type: 'pass', player: PLAYER_1 });
  state = dispatch(state, { type: 'pass', player: PLAYER_2 });
  return state;
}

describe('le-202 — Leg It Double Quick', () => {
  beforeEach(() => resetMint());

  test('is playable during play-hazards on a company moving to a non-Darkhaven site (no destination gate)', () => {
    const state = { ...movingTo(GOBLIN_GATE), phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const inst = state.players[0].hand.find(c => c.definitionId === LEG_IT)!.instanceId;

    const plays = viableFor(state, PLAYER_1)
      .map(a => a.action)
      .filter(a => a.type === 'play-short-event' && a.cardInstanceId === inst);
    expect(plays.length).toBe(1);
  });

  test('resolving taps every untapped character in the company, leaves already-tapped ones as-is, and flags the company for an extra M/H phase', () => {
    const state = { ...movingTo(CARN_DUM), phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const inst = state.players[0].hand.find(c => c.definitionId === LEG_IT)!.instanceId;
    expect(getCharacter(state, 0, GORBAG).status).toBe(CardStatus.Untapped);

    const after = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: inst }));

    expectCharStatus(after, 0, GORBAG, CardStatus.Tapped);
    expectCharStatus(after, 0, LAGDUF, CardStatus.Tapped);
    expect(after.players[0].companies[0].extraMHPhasePending).toBe(true);
    expect(after.players[0].hand.some(c => c.instanceId === inst)).toBe(false);
    expect(after.players[0].discardPile.some(c => c.instanceId === inst)).toBe(true);
    // Still in the play-hazards step — the extra phase is granted only after
    // the current move commits.
    expect((after.phaseState as MovementHazardPhaseState).step).toBe('play-hazards');
  });

  test('after the move commits, the company is offered another movement to an additional site', () => {
    const offered = offeredExtraMove();
    const mh = offered.phaseState as MovementHazardPhaseState;
    const company = offered.players[0].companies[0];

    expect(mh.phase).toBe(Phase.MovementHazard);
    expect(mh.step).toBe('extra-mh-move-offer');
    expect(company.currentSite?.definitionId).toBe(CARN_DUM);
    expect(company.extraMHPhasePending).toBeFalsy();

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

    expect(mh.step).toBe('reveal-new-site');
    expect(moved.players[0].companies[0].destinationSite?.definitionId).toBe(WHITE_TOWERS);
    expect(moved.players[0].siteDeck.some(s => s.definitionId === WHITE_TOWERS)).toBe(false);
    expect(mh.hazardsPlayedThisCompany).toBe(0);

    const declare = viableFor(moved, PLAYER_1)
      .map(a => a.action)
      .find(a => a.type === 'declare-path');
    expect(declare).toBeDefined();
  });

  test('declining the extra move finishes the company and advances to the Site phase', () => {
    const offered = offeredExtraMove();
    expect((offered.phaseState as MovementHazardPhaseState).step).toBe('extra-mh-move-offer');

    const done = dispatch(offered, { type: 'pass', player: PLAYER_1 });
    expect(done.phaseState.phase).toBe(Phase.Site);
  });
});
