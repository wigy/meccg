/**
 * @module le-5.test
 *
 * Card test: Carambor (le-5)
 * Type: minion-character
 * Effects: 1 (`character-tap-extra-mh-phase`)
 *
 * Card text:
 *   "Unique. May tap at the end of his company's movement/hazard phase to
 *    allow it to move to an additional site on the same turn. Another site
 *    card may be played and another movement/hazard phase immediately
 *    follows for his company. The new site path must contain at least one
 *    Wilderness [{w}]."
 *
 * Engine Support:
 * | # | Rule                                                            | Status      | Notes                                                          |
 * |---|-------------------------------------------------------------------|-------------|-----------------------------------------------------------------|
 * | 1 | Offers the tap when Carambor is untapped in the company          | IMPLEMENTED | `findCharacterTapExtraMHPhase` (no composition condition)       |
 * | 2 | An already-tapped Carambor offers nothing                        | IMPLEMENTED | untapped-status check in `findCharacterTapExtraMHPhase`         |
 * | 3 | Tapping Carambor grants an extra movement/hazard phase           | IMPLEMENTED | routes to the shared `extra-mh-move-offer` step                 |
 * | 4 | Destination offer restricted to sites with a Wilderness in path  | IMPLEMENTED | `requiresDestinationSitePathIncludes` filters `extraMHMoveDestinations` |
 * | 5 | Declining leaves the company untapped and finishes normally      | IMPLEMENTED | `pass` at `character-tap-mh-offer` → `finalizeCompanyMH`        |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, reduce, makeMHState,
  viableActions, viableFor,
  PLAYER_1, PLAYER_2,
  LEGOLAS, LORIEN,
  Phase,
} from '../test-helpers.js';
import { Alignment, CardStatus } from '../../index.js';
import type { CardDefinitionId, GameState, MovementHazardPhaseState } from '../../index.js';
import type { CharacterTapExtraMHPhaseAction, ExtraMHMoveAction } from '../../types/actions-movement-hazard.js';

const CARAMBOR = 'le-5' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;   // minion haven (Carambor's homesite)
const BAG_END = 'le-350' as CardDefinitionId;    // free-hold, nearestHaven Carn Dûm, sitePath includes wilderness
const ZARAK_DUM = 'le-417' as CardDefinitionId;  // ruins-and-lairs, nearestHaven Carn Dûm, sitePath = [shadow] (no wilderness)

/**
 * Build a movement/hazard `play-hazards` state for PLAYER_1's (Ringwraith)
 * company at Carn Dûm, with Carambor (at `status`) and both Bag End (has a
 * Wilderness in its site path) and Zarak Dûm (does not) reachable in the site
 * deck.
 */
function stateWithCarambor(status: CardStatus): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: CARN_DUM, characters: [{ defId: CARAMBOR, status }] }],
        hand: [],
        siteDeck: [BAG_END, ZARAK_DUM],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
    ],
  });
  return { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
}

/** Both players pass the play-hazards step, ending the company's M/H phase. */
function passToAdvance(state: GameState): GameState {
  const afterP1 = dispatch(state, { type: 'pass', player: PLAYER_1 });
  return dispatch(afterP1, { type: 'pass', player: PLAYER_2 });
}

describe('Carambor (le-5)', () => {
  beforeEach(() => resetMint());

  test('offers the tap when Carambor is untapped in the company', () => {
    const state = passToAdvance(stateWithCarambor(CardStatus.Untapped));
    const mh = state.phaseState as MovementHazardPhaseState;
    expect(mh.step).toBe('character-tap-mh-offer');

    const tapActions = viableActions(state, PLAYER_1, 'character-tap-extra-mh-phase');
    expect(tapActions.length).toBe(1);
    expect(viableActions(state, PLAYER_1, 'pass').length).toBe(1);
  });

  test('does NOT offer the tap when Carambor is already tapped', () => {
    const state = passToAdvance(stateWithCarambor(CardStatus.Tapped));
    // No qualifying offer — the lone company finalizes straight to the Site phase.
    expect(state.phaseState.phase).toBe(Phase.Site);
  });

  test('tapping Carambor taps him and advances to the shared extra-mh-move-offer step, offering only Wilderness-path destinations', () => {
    const offered = passToAdvance(stateWithCarambor(CardStatus.Untapped));
    const caramborId = offered.players[0].companies[0].characters[0];
    const companyId = offered.players[0].companies[0].id;

    const tapAction: CharacterTapExtraMHPhaseAction = {
      type: 'character-tap-extra-mh-phase',
      player: PLAYER_1,
      companyId,
      characterInstanceId: caramborId,
    };
    const tapped = dispatch(offered, tapAction);
    const mh = tapped.phaseState as MovementHazardPhaseState;

    expect(mh.step).toBe('extra-mh-move-offer');
    expect(tapped.players[0].characters[caramborId].status).toBe(CardStatus.Tapped);

    const bagEndInst = tapped.players[0].siteDeck.find(s => s.definitionId === BAG_END)!;
    const zarakDumInst = tapped.players[0].siteDeck.find(s => s.definitionId === ZARAK_DUM)!;
    const extraMoves = viableActions(tapped, PLAYER_1, 'extra-mh-move')
      .map(ea => ea.action as ExtraMHMoveAction);

    // Bag End's site path contains a Wilderness — offered. Zarak Dûm's does
    // not — excluded, even though it is otherwise reachable from Carn Dûm.
    expect(extraMoves.some(a => a.destinationSite === bagEndInst.instanceId)).toBe(true);
    expect(extraMoves.some(a => a.destinationSite === zarakDumInst.instanceId)).toBe(false);
    expect(viableActions(tapped, PLAYER_1, 'pass').length).toBe(1);
  });

  test('accepting the extra move re-enters a fresh movement/hazard phase at the new destination', () => {
    const offered = passToAdvance(stateWithCarambor(CardStatus.Untapped));
    const caramborId = offered.players[0].companies[0].characters[0];
    const companyId = offered.players[0].companies[0].id;

    const tapped = dispatch(offered, {
      type: 'character-tap-extra-mh-phase', player: PLAYER_1, companyId, characterInstanceId: caramborId,
    });
    const bagEndInst = tapped.players[0].siteDeck.find(s => s.definitionId === BAG_END)!;

    const moved = dispatch(tapped, {
      type: 'extra-mh-move', player: PLAYER_1, companyId, destinationSite: bagEndInst.instanceId,
    });
    const mh = moved.phaseState as MovementHazardPhaseState;

    expect(mh.step).toBe('reveal-new-site');
    expect(moved.players[0].companies[0].destinationSite?.definitionId).toBe(BAG_END);
    expect(mh.hazardsPlayedThisCompany).toBe(0);
  });

  test('rejects an extra-mh-move to a site without a Wilderness in its path even if forged directly', () => {
    const offered = passToAdvance(stateWithCarambor(CardStatus.Untapped));
    const caramborId = offered.players[0].companies[0].characters[0];
    const companyId = offered.players[0].companies[0].id;

    const tapped = dispatch(offered, {
      type: 'character-tap-extra-mh-phase', player: PLAYER_1, companyId, characterInstanceId: caramborId,
    });
    const zarakDumInst = tapped.players[0].siteDeck.find(s => s.definitionId === ZARAK_DUM)!;

    const result = reduce(tapped, {
      type: 'extra-mh-move', player: PLAYER_1, companyId, destinationSite: zarakDumInst.instanceId,
    });

    // The move is rejected — the reducer re-derives the same Wilderness-path
    // filter server-side, not just at the legal-action layer.
    expect(result.error).toBeDefined();
    expect((result.state.phaseState as MovementHazardPhaseState).step).toBe('extra-mh-move-offer');
    expect(result.state.players[0].companies[0].destinationSite?.definitionId).not.toBe(ZARAK_DUM);
  });

  test('declining the tap finishes the company and advances to the Site phase', () => {
    const offered = passToAdvance(stateWithCarambor(CardStatus.Untapped));
    expect((offered.phaseState as MovementHazardPhaseState).step).toBe('character-tap-mh-offer');

    const declined = dispatch(offered, { type: 'pass', player: PLAYER_1 });
    expect(declined.phaseState.phase).toBe(Phase.Site);

    // Carambor stays untapped — the player declined to use him.
    const caramborId = offered.players[0].companies[0].characters[0];
    expect(declined.players[0].characters[caramborId]?.status).toBe(CardStatus.Untapped);
  });

  test('viableFor never offers a play against the untapped-Carambor gate once tapped', () => {
    const state = passToAdvance(stateWithCarambor(CardStatus.Tapped));
    // Finalizes straight through — no character-tap-mh-offer step reachable.
    const actions = viableFor(state, PLAYER_1).map(a => a.action);
    expect(actions.some(a => a.type === 'character-tap-extra-mh-phase')).toBe(false);
  });
});
