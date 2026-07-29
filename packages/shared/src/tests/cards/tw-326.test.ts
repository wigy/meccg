/**
 * @module tw-326.test
 *
 * Card test: Shadowfax (tw-326)
 * Type: hero-resource-ally
 * Effects: 1 (`ally-tap-extra-mh-phase`)
 *
 * Card text:
 *   "Unique. Playable at Edoras or Dunharrow. If his company has only one
 *    character or one character and a Hobbit at the end of the
 *    movement/hazard phase, tap Shadowfax to allow his company to
 *    immediately move again; an additional site card may be played and an
 *    additional movement/hazard phase follows for that company."
 *
 * Engine Support:
 * | # | Rule                                                        | Status      | Notes                                                |
 * |---|--------------------------------------------------------------|-------------|--------------------------------------------------------|
 * | 1 | Company of exactly one character qualifies                   | IMPLEMENTED | `company.characterCount: 1` branch of the condition    |
 * | 2 | Company of one character + a Hobbit qualifies                 | IMPLEMENTED | `count.hobbit` headcount + condition                   |
 * | 3 | Other company shapes do not qualify (no offer)                | IMPLEMENTED | condition fails → straight to `finalizeCompanyMH`      |
 * | 4 | Tapping Shadowfax grants an extra movement/hazard phase       | IMPLEMENTED | routes to the shared `extra-mh-move-offer` step         |
 * | 5 | Declining leaves the company untapped and finishes normally   | IMPLEMENTED | `pass` at `ally-tap-mh-offer` → `finalizeCompanyMH`     |
 * | 6 | An already-tapped Shadowfax offers nothing                    | IMPLEMENTED | tap-cost check in `findAllyTapExtraMHPhase`             |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, makeMHState,
  attachAllyToChar, viableActions,
  PLAYER_1, PLAYER_2,
  GANDALF, FRODO, SAM_GAMGEE, LEGOLAS,
  RIVENDELL, MORIA, LORIEN,
  RESOURCE_PLAYER,
  Phase,
} from '../test-helpers.js';
import { CardStatus } from '../../index.js';
import type { CardDefinitionId, GameState, MovementHazardPhaseState } from '../../index.js';
import type { AllyTapExtraMHPhaseAction, ExtraMHMoveAction } from '../../types/actions-movement-hazard.js';

const SHADOWFAX = 'tw-326' as CardDefinitionId;

/**
 * Build a movement/hazard `play-hazards` state for PLAYER_1's company (at
 * Rivendell, with Moria reachable in the site deck) with `characters` and an
 * untapped Shadowfax attached to the first character.
 */
function stateWithCompany(characters: readonly CardDefinitionId[]): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [...characters] }], hand: [], siteDeck: [MORIA] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
    ],
  });
  const withShadowfax = attachAllyToChar(base, RESOURCE_PLAYER, characters[0], SHADOWFAX);
  return { ...withShadowfax, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
}

/** Both players pass the play-hazards step, ending the company's M/H phase. */
function passToAdvance(state: GameState): GameState {
  const afterP1 = dispatch(state, { type: 'pass', player: PLAYER_1 });
  return dispatch(afterP1, { type: 'pass', player: PLAYER_2 });
}

describe('Shadowfax (tw-326)', () => {
  beforeEach(() => resetMint());

  test('offers the tap when the company has only one character', () => {
    const state = passToAdvance(stateWithCompany([GANDALF]));
    const mh = state.phaseState as MovementHazardPhaseState;
    expect(mh.step).toBe('ally-tap-mh-offer');

    const tapActions = viableActions(state, PLAYER_1, 'ally-tap-extra-mh-phase');
    expect(tapActions.length).toBe(1);
    expect(viableActions(state, PLAYER_1, 'pass').length).toBe(1);
  });

  test('offers the tap when the company is one character and a Hobbit', () => {
    const state = passToAdvance(stateWithCompany([GANDALF, FRODO]));
    const mh = state.phaseState as MovementHazardPhaseState;
    expect(mh.step).toBe('ally-tap-mh-offer');
    expect(viableActions(state, PLAYER_1, 'ally-tap-extra-mh-phase').length).toBe(1);
  });

  test('does NOT offer the tap when the company is two non-Hobbit characters', () => {
    const state = passToAdvance(stateWithCompany([GANDALF, LEGOLAS]));
    // No qualifying offer — the lone company finalizes straight to the Site phase.
    expect(state.phaseState.phase).toBe(Phase.Site);
  });

  test('does NOT offer the tap when the company is one character and two Hobbits', () => {
    const state = passToAdvance(stateWithCompany([GANDALF, FRODO, SAM_GAMGEE]));
    expect(state.phaseState.phase).toBe(Phase.Site);
  });

  test('does NOT offer the tap when Shadowfax is already tapped', () => {
    const state = stateWithCompany([GANDALF]);
    const gandalfId = state.players[0].companies[0].characters[0];
    const shadowfaxAllyId = state.players[0].characters[gandalfId].allies[0].instanceId;
    const tappedChar = {
      ...state.players[0].characters[gandalfId],
      allies: [{ ...state.players[0].characters[gandalfId].allies[0], status: CardStatus.Tapped }],
    };
    const tappedState: GameState = {
      ...state,
      players: [
        { ...state.players[0], characters: { ...state.players[0].characters, [gandalfId as string]: tappedChar } },
        state.players[1],
      ] as GameState['players'],
    };

    const advanced = passToAdvance(tappedState);
    expect(advanced.phaseState.phase).toBe(Phase.Site);
    // Shadowfax stays tapped — nothing untapped it.
    const finalGandalf = advanced.players[0].characters[gandalfId];
    expect(finalGandalf?.allies.find(a => a.instanceId === shadowfaxAllyId)?.status).toBe(CardStatus.Tapped);
  });

  test('tapping Shadowfax taps the ally and advances to the shared extra-mh-move-offer step', () => {
    const offered = passToAdvance(stateWithCompany([GANDALF]));
    const gandalfId = offered.players[0].companies[0].characters[0];
    const shadowfaxAllyId = offered.players[0].characters[gandalfId].allies[0].instanceId;
    const companyId = offered.players[0].companies[0].id;

    const tapAction: AllyTapExtraMHPhaseAction = {
      type: 'ally-tap-extra-mh-phase',
      player: PLAYER_1,
      companyId,
      allyInstanceId: shadowfaxAllyId,
    };
    const tapped = dispatch(offered, tapAction);
    const mh = tapped.phaseState as MovementHazardPhaseState;

    expect(mh.step).toBe('extra-mh-move-offer');
    expect(tapped.players[0].characters[gandalfId].allies[0].status).toBe(CardStatus.Tapped);

    // Moria (reachable from Rivendell) is offered as the additional destination.
    const moriaInst = tapped.players[0].siteDeck.find(s => s.definitionId === MORIA)!;
    const extraMoves = viableActions(tapped, PLAYER_1, 'extra-mh-move')
      .map(ea => ea.action as ExtraMHMoveAction);
    expect(extraMoves.some(a => a.destinationSite === moriaInst.instanceId)).toBe(true);
    expect(viableActions(tapped, PLAYER_1, 'pass').length).toBe(1);
  });

  test('accepting the extra move re-enters a fresh movement/hazard phase at the new destination', () => {
    const offered = passToAdvance(stateWithCompany([GANDALF]));
    const gandalfId = offered.players[0].companies[0].characters[0];
    const shadowfaxAllyId = offered.players[0].characters[gandalfId].allies[0].instanceId;
    const companyId = offered.players[0].companies[0].id;

    const tapped = dispatch(offered, {
      type: 'ally-tap-extra-mh-phase', player: PLAYER_1, companyId, allyInstanceId: shadowfaxAllyId,
    });
    const moriaInst = tapped.players[0].siteDeck.find(s => s.definitionId === MORIA)!;

    const moved = dispatch(tapped, {
      type: 'extra-mh-move', player: PLAYER_1, companyId, destinationSite: moriaInst.instanceId,
    });
    const mh = moved.phaseState as MovementHazardPhaseState;

    expect(mh.step).toBe('reveal-new-site');
    expect(moved.players[0].companies[0].destinationSite?.definitionId).toBe(MORIA);
    expect(mh.hazardsPlayedThisCompany).toBe(0);
  });

  test('declining the tap finishes the company and advances to the Site phase', () => {
    const offered = passToAdvance(stateWithCompany([GANDALF]));
    expect((offered.phaseState as MovementHazardPhaseState).step).toBe('ally-tap-mh-offer');

    const declined = dispatch(offered, { type: 'pass', player: PLAYER_1 });
    expect(declined.phaseState.phase).toBe(Phase.Site);

    // Shadowfax stays untapped — the player declined to use him.
    const gandalfId = declined.players[0].companies[0].characters[0];
    // Site phase does not preserve the same company array shape check here —
    // instead confirm via the character record directly.
    expect(declined.players[0].characters[gandalfId]?.allies[0]?.status).toBe(CardStatus.Untapped);
  });
});
