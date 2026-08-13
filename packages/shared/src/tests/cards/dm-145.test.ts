/**
 * @module dm-145 — Into Dark Tunnels
 *
 * Hero resource short-event (`grant-extra-mh-phase` with `movement:
 * "under-deeps"`). Card text: "Playable at the end of the movement/hazard
 * phase on a company that has moved to an Under-deeps site. That company may
 * attempt to move to an additional site on the same turn. Another site card
 * may be played and a movement/hazard phase immediately follows."
 *
 * Unlike its minion sibling World Gnawed by the Nameless (as-110), this card
 * carries no `returnToHand` and no companion `keyed-attacks-normal` effect —
 * it is a plain one-shot Under-deeps extra-phase grant, discarded normally
 * after resolution.
 *
 * These tests drive the engine end-to-end: the event is offered only when the
 * active company is moving to an Under-deeps site; resolving it flags the
 * company (`extraMHPhasePending: 'under-deeps'`) and discards the card; once
 * the move commits the company is offered the Under-deeps variant of the
 * `extra-mh-move-offer` step, restricted to adjacent Under-deeps sites it has
 * not attempted to move to this turn.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, makeMHState, resetMint, dispatch, viableFor,
  LEGOLAS, LORIEN,
  Phase, PLAYER_1, PLAYER_2,
} from '../test-helpers.js';
import { MovementType } from '../../types/common.js';
import type { CardDefinitionId, GameState, MovementHazardPhaseState } from '../../index.js';
import type { ExtraMHMoveAction, DeclarePathAction } from '../../types/actions-movement-hazard.js';

const INTO_DARK_TUNNELS = 'dm-145' as CardDefinitionId;
const MOUNT_GUNDABAD = 'tw-416' as CardDefinitionId;   // hero surface site (not Under-deeps)
const THE_UNDER_LEAS = 'dm-40' as CardDefinitionId;    // Under-deeps shadow-hold
const THE_IRON_DEEPS = 'dm-33' as CardDefinitionId;    // Under-deeps dark-hold, adjacent to The Under-leas (6)
const THE_UNDER_VAULTS = 'dm-41' as CardDefinitionId;  // Under-deeps ruins-and-lairs, adjacent to The Under-leas (7)
const THE_GEM_DEEPS = 'dm-30' as CardDefinitionId;     // Under-deeps, NOT adjacent to The Under-leas

/**
 * Build an M/H play-hazards state where PLAYER_1's company is moving via
 * Under-deeps movement from Mount Gundabad to `destination`, with Into Dark
 * Tunnels in hand and further Under-deeps sites in the site deck.
 */
function movingTo(destination: CardDefinitionId) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MOUNT_GUNDABAD, characters: [LEGOLAS], destinationSite: destination }],
        hand: [INTO_DARK_TUNNELS],
        siteDeck: [THE_IRON_DEEPS, THE_UNDER_VAULTS, THE_GEM_DEEPS, MOUNT_GUNDABAD],
        playDeck: [],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [] }],
        hand: [],
        siteDeck: [],
        playDeck: [],
      },
    ],
  });
  return {
    ...state,
    phaseState: makeMHState({
      activeCompanyIndex: 0,
      movementType: MovementType.UnderDeeps,
    }),
  };
}

/** Play Into Dark Tunnels from PLAYER_1's hand. */
function playIntoDarkTunnels(state: GameState): GameState {
  const instId = state.players[0].hand.find(c => c.definitionId === INTO_DARK_TUNNELS)!.instanceId;
  return dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: instId });
}

/** Reach the Under-deeps `extra-mh-move-offer` step: play the event, then both
 *  players pass so the move to The Under-leas commits. */
function offeredExtraMove() {
  let state = playIntoDarkTunnels(movingTo(THE_UNDER_LEAS));
  state = dispatch(state, { type: 'pass', player: PLAYER_1 });
  state = dispatch(state, { type: 'pass', player: PLAYER_2 });
  return state;
}

describe('dm-145 — Into Dark Tunnels', () => {
  beforeEach(() => resetMint());

  test('is playable during play-hazards on a company moving to an Under-deeps site', () => {
    const state = movingTo(THE_UNDER_LEAS);
    const instId = state.players[0].hand.find(c => c.definitionId === INTO_DARK_TUNNELS)!.instanceId;

    const plays = viableFor(state, PLAYER_1)
      .map(a => a.action)
      .filter(a => a.type === 'play-short-event' && a.cardInstanceId === instId);
    expect(plays.length).toBe(1);
  });

  test('is NOT playable when the company is moving to a surface (non-Under-deeps) site', () => {
    const state = movingTo(MOUNT_GUNDABAD);
    const instId = state.players[0].hand.find(c => c.definitionId === INTO_DARK_TUNNELS)!.instanceId;

    const plays = viableFor(state, PLAYER_1)
      .map(a => a.action)
      .filter(a => a.type === 'play-short-event' && a.cardInstanceId === instId);
    expect(plays.length).toBe(0);
  });

  test('is NOT playable during the organization phase, before any movement/hazard phase begins', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MOUNT_GUNDABAD, characters: [LEGOLAS], destinationSite: THE_UNDER_LEAS }],
          hand: [INTO_DARK_TUNNELS],
          siteDeck: [THE_IRON_DEEPS],
          playDeck: [],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [],
          siteDeck: [],
          playDeck: [],
        },
      ],
    });
    const instId = state.players[0].hand.find(c => c.definitionId === INTO_DARK_TUNNELS)!.instanceId;

    const plays = viableFor(state, PLAYER_1)
      .map(a => a.action)
      .filter(a => a.type === 'play-short-event' && a.cardInstanceId === instId);
    expect(plays.length).toBe(0);
  });

  test('resolving it flags the company for an Under-deeps extra phase and discards the card', () => {
    const state = movingTo(THE_UNDER_LEAS);
    const instId = state.players[0].hand.find(c => c.definitionId === INTO_DARK_TUNNELS)!.instanceId;

    const after = playIntoDarkTunnels(state);
    const company = after.players[0].companies[0];

    expect(company.extraMHPhasePending).toBe('under-deeps');
    // No "return to hand" clause on this card — it discards normally.
    expect(after.players[0].hand.some(c => c.instanceId === instId)).toBe(false);
    expect(after.players[0].discardPile.some(c => c.instanceId === instId)).toBe(true);
    expect((after.phaseState as MovementHazardPhaseState).step).toBe('play-hazards');
  });

  test('after the move commits, only adjacent unattempted Under-deeps sites are offered as extra destinations', () => {
    const offered = offeredExtraMove();
    const mh = offered.phaseState as MovementHazardPhaseState;
    const company = offered.players[0].companies[0];

    expect(mh.step).toBe('extra-mh-move-offer');
    expect(mh.extraMHMoveUnderDeeps).toBe(true);
    expect(company.currentSite?.definitionId).toBe(THE_UNDER_LEAS);
    expect(company.extraMHPhasePending).toBeFalsy();

    const actions = viableFor(offered, PLAYER_1).map(a => a.action);
    const extraMoves = actions.filter((a): a is ExtraMHMoveAction => a.type === 'extra-mh-move');
    const offeredDefs = extraMoves.map(a =>
      offered.players[0].siteDeck.find(s => s.instanceId === a.destinationSite)?.definitionId);
    // The Iron-deeps and The Under-vaults are Under-deeps-adjacent to The
    // Under-leas → offered.
    expect(offeredDefs).toContain(THE_IRON_DEEPS);
    expect(offeredDefs).toContain(THE_UNDER_VAULTS);
    // The Gem-deeps is Under-deeps but not adjacent; Mount Gundabad is a
    // surface site — neither is a legal destination.
    expect(offeredDefs).not.toContain(THE_GEM_DEEPS);
    expect(offeredDefs).not.toContain(MOUNT_GUNDABAD);
    expect(actions.some(a => a.type === 'pass')).toBe(true);
  });

  test('a site the company already attempted to move to this turn is not offered', () => {
    let offered = offeredExtraMove();
    const companyId = offered.players[0].companies[0].id;
    // Record The Iron-deeps as attempted earlier this turn (e.g. a failed
    // movement roll); The Under-vaults (also adjacent) stays legal.
    offered = {
      ...offered,
      phaseState: {
        ...(offered.phaseState as MovementHazardPhaseState),
        underDeepsAttempts: { [companyId as string]: [THE_IRON_DEEPS] },
      },
    };

    const extraMoves = viableFor(offered, PLAYER_1)
      .map(a => a.action)
      .filter((a): a is ExtraMHMoveAction => a.type === 'extra-mh-move');
    const offeredDefs = extraMoves.map(a =>
      offered.players[0].siteDeck.find(s => s.instanceId === a.destinationSite)?.definitionId);
    expect(offeredDefs).not.toContain(THE_IRON_DEEPS);
    expect(offeredDefs).toContain(THE_UNDER_VAULTS);
  });

  test('accepting the extra move runs a fresh Under-deeps movement/hazard phase', () => {
    const offered = offeredExtraMove();
    const companyId = offered.players[0].companies[0].id;
    const ironDeepsInst = offered.players[0].siteDeck.find(s => s.definitionId === THE_IRON_DEEPS)!;

    const moved = dispatch(offered, {
      type: 'extra-mh-move',
      player: PLAYER_1,
      companyId,
      destinationSite: ironDeepsInst.instanceId,
    });
    const mhMoved = moved.phaseState as MovementHazardPhaseState;

    // A new movement/hazard phase begins: destination set, site drawn, mode
    // flag cleared, per-phase state reset.
    expect(mhMoved.step).toBe('reveal-new-site');
    expect(mhMoved.extraMHMoveUnderDeeps).toBeFalsy();
    expect(moved.players[0].companies[0].destinationSite?.definitionId).toBe(THE_IRON_DEEPS);
    expect(moved.players[0].siteDeck.some(s => s.definitionId === THE_IRON_DEEPS)).toBe(false);
    expect(mhMoved.hazardsPlayedThisCompany).toBe(0);

    // Only Under-deeps movement reaches The Iron-deeps; declaring the path
    // records the attempt and enters the roll step.
    const declare = viableFor(moved, PLAYER_1)
      .map(a => a.action)
      .find((a): a is DeclarePathAction => a.type === 'declare-path');
    expect(declare?.movementType).toBe('under-deeps');
    const rolling = dispatch(moved, declare!);
    const mhRoll = rolling.phaseState as MovementHazardPhaseState;
    expect(mhRoll.step).toBe('under-deeps-roll');
    expect(mhRoll.underDeepsAttempts?.[companyId as string]).toContain(THE_IRON_DEEPS);

    // Successful roll → the second phase proceeds through card draws (both
    // decks are empty for the resource player, so both players just pass) to
    // play-hazards, and then to finalizing the company at The Iron-deeps.
    let rolled = dispatch({ ...rolling, cheatRollTotal: 12 }, { type: 'under-deeps-roll', player: PLAYER_1 });
    expect((rolled.phaseState as MovementHazardPhaseState).step).toBe('draw-cards');
    rolled = dispatch(rolled, { type: 'pass', player: PLAYER_1 });
    rolled = dispatch(rolled, { type: 'pass', player: PLAYER_2 });
    expect((rolled.phaseState as MovementHazardPhaseState).step).toBe('play-hazards');

    const done = dispatch(dispatch(rolled, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });
    expect(done.players[0].companies[0].currentSite?.definitionId).toBe(THE_IRON_DEEPS);
    expect(done.phaseState.phase).toBe(Phase.Site);
  });

  test('declining the extra move finishes the company and advances to the Site phase', () => {
    const offered = offeredExtraMove();
    expect((offered.phaseState as MovementHazardPhaseState).step).toBe('extra-mh-move-offer');

    const done = dispatch(offered, { type: 'pass', player: PLAYER_1 });
    expect(done.phaseState.phase).toBe(Phase.Site);
  });
});
