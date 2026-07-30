/**
 * @module as-110 — World Gnawed by the Nameless
 *
 * Minion resource short-event (`grant-extra-mh-phase` with `movement:
 * "under-deeps"` + `returnToHand`, and a companion `keyed-attacks-normal`
 * `siteTypes: ["shadow-hold"]`). Card text: "Playable during the
 * movement/hazard phase on a company moving to an Under-deeps site. At the end
 * of its movement/hazard phase, target company attempts to move to an
 * additional Under-deeps site which it has not attempted to move to yet this
 * turn. Another site card is played and a movement/hazard phase immediately
 * follows. Return this card to your hand. All hazard creatures the company
 * faces this turn keyed to Shadow-holds [{S}] attack normally, not as
 * detainment."
 *
 * These tests drive the engine end-to-end: the event is offered only when the
 * active company is moving to an Under-deeps site; resolving it flags the
 * company (`extraMHPhasePending: 'under-deeps'`), returns the card to hand and
 * installs the turn-scoped detainment override; Shadow-hold-keyed creatures
 * then attack normally; once the move commits the company is offered the
 * Under-deeps variant of the `extra-mh-move-offer` step, restricted to
 * adjacent Under-deeps sites it has not attempted to move to this turn.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, makeMHState, resetMint, dispatch, viableFor,
  Phase, PLAYER_1, PLAYER_2,
} from '../test-helpers.js';
import { Alignment, SiteType, Race, RegionType, LORIEN, LEGOLAS } from '../../index.js';
import { MovementType } from '../../types/common.js';
import type { CardDefinitionId, GameState, MovementHazardPhaseState, SitePhaseState } from '../../index.js';
import type { ExtraMHMoveAction, DeclarePathAction } from '../../types/actions-movement-hazard.js';
import { isDetainmentAttack } from '../../engine/detainment.js';

const WORLD_GNAWED = 'as-110' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;            // minion character (mind 6)
const MOUNT_GUNDABAD = 'le-395' as CardDefinitionId;   // surface shadow-hold, entrance of The Under-leas
const MOUNT_GRAM = 'le-394' as CardDefinitionId;       // surface shadow-hold, entrance of The Under-vaults
const THE_UNDER_LEAS = 'as-167' as CardDefinitionId;   // Under-deeps shadow-hold
const THE_IRON_DEEPS = 'as-152' as CardDefinitionId;   // Under-deeps dark-hold, adjacent to The Under-leas (5)
const THE_UNDER_VAULTS = 'as-168' as CardDefinitionId; // Under-deeps R&L, adjacent to The Under-leas (6)
const THE_GEM_DEEPS = 'as-147' as CardDefinitionId;    // Under-deeps R&L, NOT adjacent to The Under-leas
const GOBLIN_GATE = 'le-378' as CardDefinitionId;      // surface shadow-hold (not Under-deeps)
const BARROW_WIGHT = 'le-61' as CardDefinitionId;      // Undead creature keyed to shadow-hold/dark-hold

/**
 * Build an M/H play-hazards state where PLAYER_1's (Ringwraith) minion company
 * is moving via Under-deeps movement from Mount Gundabad to `destination`, with
 * World Gnawed by the Nameless in hand and further Under-deeps sites in the
 * site deck.
 */
function movingTo(destination: CardDefinitionId, destinationSiteType: SiteType = SiteType.ShadowHold) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: MOUNT_GUNDABAD, characters: [GORBAG], destinationSite: destination }],
        hand: [WORLD_GNAWED],
        siteDeck: [THE_IRON_DEEPS, THE_UNDER_VAULTS, THE_GEM_DEEPS, GOBLIN_GATE],
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
  return {
    ...state,
    phaseState: makeMHState({
      activeCompanyIndex: 0,
      movementType: MovementType.UnderDeeps,
      destinationSiteType,
      destinationSiteName: (state.cardPool[destination] as { name?: string } | undefined)?.name ?? null,
    }),
  };
}

/** Play World Gnawed by the Nameless from PLAYER_1's hand. */
function playWorldGnawed(state: GameState): GameState {
  const instId = state.players[0].hand.find(c => c.definitionId === WORLD_GNAWED)!.instanceId;
  return dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: instId });
}

/** Reach the Under-deeps `extra-mh-move-offer` step: play the event, then both
 *  players pass so the move to The Under-leas commits. */
function offeredExtraMove() {
  let state = playWorldGnawed(movingTo(THE_UNDER_LEAS));
  state = dispatch(state, { type: 'pass', player: PLAYER_1 });
  state = dispatch(state, { type: 'pass', player: PLAYER_2 });
  return state;
}

/**
 * Drive a company through an Under-deeps move to The Under-vaults and into its
 * site phase, stopping at the `play-site-auto-attack` step with Barrow-wight
 * in the hazard player's hand. The Under-vaults' dynamic auto-attack rule
 * plays a creature *keyed to Shadow-holds* — exactly the attacks World Gnawed
 * by the Nameless converts to normal. `withCard` controls whether the event
 * was played during the movement/hazard phase.
 */
function atVaultsAutoAttackStep(withCard: boolean): GameState {
  let state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: MOUNT_GRAM, characters: [GORBAG], destinationSite: THE_UNDER_VAULTS }],
        hand: [WORLD_GNAWED],
        siteDeck: [],
        playDeck: [],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [BARROW_WIGHT],
        siteDeck: [],
        playDeck: [],
      },
    ],
  });
  state = {
    ...state,
    phaseState: makeMHState({
      activeCompanyIndex: 0,
      movementType: MovementType.UnderDeeps,
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'The Under-vaults',
    }),
  };
  if (withCard) state = playWorldGnawed(state);
  state = dispatch(state, { type: 'pass', player: PLAYER_1 });
  state = dispatch(state, { type: 'pass', player: PLAYER_2 });
  if (withCard) {
    // No further Under-deeps site in the deck — decline the extra move.
    expect((state.phaseState as MovementHazardPhaseState).step).toBe('extra-mh-move-offer');
    state = dispatch(state, { type: 'pass', player: PLAYER_1 });
  }
  expect(state.phaseState.phase).toBe(Phase.Site);
  const companyId = state.players[0].companies[0].id;
  state = dispatch(state, { type: 'select-company', player: PLAYER_1, companyId });
  state = dispatch(state, { type: 'enter-site', player: PLAYER_1, companyId });
  expect((state.phaseState as SitePhaseState).step).toBe('reveal-on-guard-attacks');
  state = dispatch(state, { type: 'pass', player: PLAYER_2 });
  expect((state.phaseState as SitePhaseState).step).toBe('play-site-auto-attack');
  return state;
}

describe('as-110 — World Gnawed by the Nameless', () => {
  beforeEach(() => resetMint());

  test('is playable during play-hazards on a company moving to an Under-deeps site', () => {
    const state = movingTo(THE_UNDER_LEAS);
    const instId = state.players[0].hand.find(c => c.definitionId === WORLD_GNAWED)!.instanceId;

    const plays = viableFor(state, PLAYER_1)
      .map(a => a.action)
      .filter(a => a.type === 'play-short-event' && a.cardInstanceId === instId);
    expect(plays.length).toBe(1);
  });

  test('is NOT playable when the company is moving to a surface (non-Under-deeps) site', () => {
    const state = movingTo(GOBLIN_GATE);
    const instId = state.players[0].hand.find(c => c.definitionId === WORLD_GNAWED)!.instanceId;

    const plays = viableFor(state, PLAYER_1)
      .map(a => a.action)
      .filter(a => a.type === 'play-short-event' && a.cardInstanceId === instId);
    expect(plays.length).toBe(0);
  });

  test('resolving it flags the company for an Under-deeps extra phase, returns the card to hand and installs the detainment override', () => {
    const state = movingTo(THE_UNDER_LEAS);
    const instId = state.players[0].hand.find(c => c.definitionId === WORLD_GNAWED)!.instanceId;

    const after = playWorldGnawed(state);
    const company = after.players[0].companies[0];

    expect(company.extraMHPhasePending).toBe('under-deeps');
    // "Return this card to your hand" — not discarded.
    expect(after.players[0].hand.some(c => c.instanceId === instId)).toBe(true);
    expect(after.players[0].discardPile.some(c => c.instanceId === instId)).toBe(false);
    // Turn-scoped keyed-attacks-normal constraint on the target company.
    const constraint = after.activeConstraints.find(c => c.kind.type === 'keyed-attacks-normal');
    expect(constraint).toBeDefined();
    expect(constraint!.scope).toEqual({ kind: 'turn' });
    expect(constraint!.target).toEqual({ kind: 'company', companyId: company.id });
    expect(constraint!.kind).toEqual({ type: 'keyed-attacks-normal', siteTypes: [SiteType.ShadowHold] });
    expect((after.phaseState as MovementHazardPhaseState).step).toBe('play-hazards');
  });

  test('a creature played keyed to Shadow-holds as a dynamic auto-attack attacks normally after the event', () => {
    // The Under-vaults (as-168) lets the hazard player play a creature keyed
    // to Shadow-holds [{S}] as the site's automatic-attack — with World Gnawed
    // by the Nameless played this turn, that attack is normal, not detainment.
    const state = atVaultsAutoAttackStep(true);
    const bwInst = state.players[1].hand.find(c => c.definitionId === BARROW_WIGHT)!.instanceId;

    const after = dispatch(state, { type: 'play-site-auto-attack', player: PLAYER_2, cardInstanceId: bwInst });

    expect(after.combat).not.toBeNull();
    expect(after.combat!.detainment).toBe(false);
  });

  test('without the event, the same Shadow-hold-keyed played auto-attack is detainment against the minion company', () => {
    const state = atVaultsAutoAttackStep(false);
    const bwInst = state.players[1].hand.find(c => c.definitionId === BARROW_WIGHT)!.instanceId;

    const after = dispatch(state, { type: 'play-site-auto-attack', player: PLAYER_2, cardInstanceId: bwInst });

    expect(after.combat).not.toBeNull();
    expect(after.combat!.detainment).toBe(true);
  });

  test('the override is keying-specific: a creature actually keyed to a region stays detainment', () => {
    // Engine-level check of the nuance the reducer path cannot easily reach: an
    // Orc declared-keyed to a Shadow-land region (not the Shadow-hold) remains
    // detainment under §3.II.2.R2 even while the company converts
    // shadow-hold-keyed attacks to normal.
    expect(isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{ regionTypes: [RegionType.Shadow], siteTypes: [SiteType.ShadowHold] }],
      attackDeclaredSiteTypes: [],
      normalIfKeyedToSiteTypes: [SiteType.ShadowHold],
      defendingAlignment: Alignment.Ringwraith,
    })).toBe(true);
    // The same creature declared-keyed to the Shadow-hold is converted.
    expect(isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{ regionTypes: [RegionType.Shadow], siteTypes: [SiteType.ShadowHold] }],
      attackDeclaredSiteTypes: [SiteType.ShadowHold],
      normalIfKeyedToSiteTypes: [SiteType.ShadowHold],
      defendingAlignment: Alignment.Ringwraith,
    })).toBe(false);
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
    // The Gem-deeps is Under-deeps but not adjacent; Goblin-gate is a surface
    // site — neither is a legal destination.
    expect(offeredDefs).not.toContain(THE_GEM_DEEPS);
    expect(offeredDefs).not.toContain(GOBLIN_GATE);
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

  test('accepting the extra move runs a fresh Under-deeps movement/hazard phase, where the returned card is playable again', () => {
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
    // records the attempt and enters the roll step at the printed roll (5,
    // no phase-count penalty on the card).
    const declare = viableFor(moved, PLAYER_1)
      .map(a => a.action)
      .find((a): a is DeclarePathAction => a.type === 'declare-path');
    expect(declare?.movementType).toBe('under-deeps');
    const rolling = dispatch(moved, declare!);
    const mhRoll = rolling.phaseState as MovementHazardPhaseState;
    expect(mhRoll.step).toBe('under-deeps-roll');
    expect(mhRoll.underDeepsRollRequired).toBe(5);
    expect(mhRoll.underDeepsAttempts?.[companyId as string]).toContain(THE_IRON_DEEPS);

    // Successful roll → the second phase proceeds through card draws (both
    // decks are empty, so both players just pass) to play-hazards, where the
    // returned copy of World Gnawed by the Nameless is playable again for the
    // move to The Iron-deeps (an Under-deeps destination).
    let rolled = dispatch({ ...rolling, cheatRollTotal: 12 }, { type: 'under-deeps-roll', player: PLAYER_1 });
    expect((rolled.phaseState as MovementHazardPhaseState).step).toBe('draw-cards');
    rolled = dispatch(rolled, { type: 'pass', player: PLAYER_1 });
    rolled = dispatch(rolled, { type: 'pass', player: PLAYER_2 });
    const mhSecond = rolled.phaseState as MovementHazardPhaseState;
    expect(mhSecond.step).toBe('play-hazards');
    const wgInst = rolled.players[0].hand.find(c => c.definitionId === WORLD_GNAWED)!.instanceId;
    const replays = viableFor(rolled, PLAYER_1)
      .map(a => a.action)
      .filter(a => a.type === 'play-short-event' && a.cardInstanceId === wgInst);
    expect(replays.length).toBe(1);

    // Letting the second phase end commits the company at The Iron-deeps.
    const done = dispatch(dispatch(rolled, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });
    expect(done.players[0].companies[0].currentSite?.definitionId).toBe(THE_IRON_DEEPS);
    expect(done.phaseState.phase).toBe(Phase.Site);
  });

  test('declaring the first Under-deeps path records the destination as attempted', () => {
    let state = movingTo(THE_UNDER_LEAS);
    const companyId = state.players[0].companies[0].id;
    state = {
      ...state,
      phaseState: makeMHState({ activeCompanyIndex: 0, step: 'reveal-new-site', siteRevealed: true }),
    };

    const declare = viableFor(state, PLAYER_1)
      .map(a => a.action)
      .find((a): a is DeclarePathAction => a.type === 'declare-path' && a.movementType === 'under-deeps');
    expect(declare).toBeDefined();
    const after = dispatch(state, declare!);
    expect((after.phaseState as MovementHazardPhaseState).underDeepsAttempts?.[companyId as string])
      .toContain(THE_UNDER_LEAS);
  });

  test('declining the extra move finishes the company and advances to the Site phase', () => {
    const offered = offeredExtraMove();
    expect((offered.phaseState as MovementHazardPhaseState).step).toBe('extra-mh-move-offer');

    const done = dispatch(offered, { type: 'pass', player: PLAYER_1 });
    expect(done.phaseState.phase).toBe(Phase.Site);
  });
});
