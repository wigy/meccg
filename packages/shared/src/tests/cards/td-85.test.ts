/**
 * @module td-85.test
 *
 * Card test: Withered Lands (td-85)
 * Type: hazard-event (short-event, Environment)
 *
 * Text:
 *   "Environment. Playable if Doors of Night is in play. Treat one Wilderness
 *    [{w}] as two Wildernesses [{w}] or one Shadow-land [{s}] as two Wildernesses
 *    [{w}] or one Border-land [{b}] as two Wildernesses [{w}] until the end of
 *    the turn."
 *
 * Effects:
 * | # | Effect              | Rule covered                                       |
 * |---|---------------------|----------------------------------------------------|
 * | 1 | play-condition      | "Playable if Doors of Night is in play"            |
 * | 2 | region-keying-boost | softens creature keying: one W/S/B region counts   |
 * |   |                     | as two Wildernesses (three alternatives, one used) |
 *
 * On play the short-event adds a turn-scoped `region-keying-boost` active
 * constraint. The creature-keying matchers consult it and treat one region of
 * type wilderness / shadow / border in a company's site path as two
 * wildernesses (the boosts are alternatives — never combined). The path itself
 * is never mutated.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  DOORS_OF_NIGHT,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState, addCardInPlay,
  viableActions, reduce, resolveChain,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, Alignment, RegionType, SiteType,
  computeLegalActions,
} from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, GameState, ConstraintId, CompanyId,
} from '../../index.js';

const WITHERED_LANDS = 'td-85' as CardDefinitionId;
const GIANT = 'tw-39' as CardDefinitionId;            // keyed {w}{w} only
const TRUE_FIRE_DRAKE = 'le-95' as CardDefinitionId;  // keyed {w}{w}{w} (no DoN)

/** Resource player (PLAYER_1) holds a company; hazard player (PLAYER_2) holds the named hazards. */
function baseState(hazardHand: CardDefinitionId[]) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: hazardHand, siteDeck: [RIVENDELL] },
    ],
  });
}

/** Inject a turn-scoped Withered Lands region-keying-boost constraint (no card needed). */
function withBoost(state: GameState): GameState {
  return {
    ...state,
    activeConstraints: [
      ...state.activeConstraints,
      {
        id: 'wl-boost' as ConstraintId,
        source: 'wl-src' as CardInstanceId,
        sourceDefinitionId: WITHERED_LANDS,
        scope: { kind: 'turn' },
        target: { kind: 'player', playerId: PLAYER_2 },
        kind: {
          type: 'region-keying-boost',
          boosts: [
            { from: RegionType.Wilderness, asType: RegionType.Wilderness, count: 2 },
            { from: RegionType.Shadow, asType: RegionType.Wilderness, count: 2 },
            { from: RegionType.Border, asType: RegionType.Wilderness, count: 2 },
          ],
        },
      },
    ],
  };
}

function handInstance(state: GameState, defId: CardDefinitionId): CardInstanceId {
  return state.players[HAZARD_PLAYER].hand.find(c => c.definitionId === defId)!.instanceId;
}

function giantIsPlayable(state: GameState, defId = GIANT): boolean {
  const inst = handInstance(state, defId);
  return computeLegalActions(state, PLAYER_2).some(
    ea => ea.action.type === 'play-hazard' && ea.action.cardInstanceId === inst && ea.viable,
  );
}

describe('Withered Lands (td-85)', () => {
  beforeEach(() => resetMint());

  // ─── Playability gate: requires Doors of Night ─────────────────────────────

  test('NOT playable when Doors of Night is not in play', () => {
    const state: GameState = { ...baseState([WITHERED_LANDS]), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Wilderness], resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs, destinationSiteName: 'Moria',
    }) };
    const inst = handInstance(state, WITHERED_LANDS);
    const viable = viableActions(state, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === inst);
    expect(viable).toHaveLength(0);
  });

  test('playable when Doors of Night is in play', () => {
    let state: GameState = { ...baseState([WITHERED_LANDS]), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Wilderness], resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs, destinationSiteName: 'Moria',
    }) };
    state = addCardInPlay(state, HAZARD_PLAYER, DOORS_OF_NIGHT);
    const inst = handInstance(state, WITHERED_LANDS);
    const viable = viableActions(state, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === inst);
    expect(viable.length).toBeGreaterThan(0);
  });

  // ─── Playing it leaves the turn-scoped region-keying-boost constraint ──────

  test('playing Withered Lands adds a turn-scoped region-keying-boost constraint and discards the card', () => {
    let state: GameState = { ...baseState([WITHERED_LANDS]), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Wilderness], resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs, destinationSiteName: 'Moria',
    }) };
    state = addCardInPlay(state, HAZARD_PLAYER, DOORS_OF_NIGHT);
    const inst = handInstance(state, WITHERED_LANDS);
    const companyId: CompanyId = state.players[RESOURCE_PLAYER].companies[0].id;

    const r = reduce(state, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: inst, targetCompanyId: companyId });
    expect(r.error).toBeUndefined();
    const after = resolveChain(r.state);

    const boost = after.activeConstraints.find(c => c.kind.type === 'region-keying-boost');
    expect(boost).toBeDefined();
    expect(boost!.scope).toEqual({ kind: 'turn' });
    // Card is discarded after resolution (short event).
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === WITHERED_LANDS)).toBe(true);
    expect(after.players[HAZARD_PLAYER].hand.some(c => c.definitionId === WITHERED_LANDS)).toBe(false);
  });

  // ─── Wilderness mode: one Wilderness counts as two ─────────────────────────

  test('a {w}{w} creature is NOT playable on a single-wilderness path without the boost', () => {
    const state: GameState = { ...baseState([GIANT]), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Wilderness], resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs, destinationSiteName: 'Moria',
    }) };
    expect(giantIsPlayable(state)).toBe(false);
  });

  test('a {w}{w} creature becomes playable on a single-wilderness path with the boost', () => {
    const state = withBoost({ ...baseState([GIANT]), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Wilderness], resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs, destinationSiteName: 'Moria',
    }) });
    expect(giantIsPlayable(state)).toBe(true);
    // It is keyed via wilderness region-type.
    const inst = handInstance(state, GIANT);
    const act = computeLegalActions(state, PLAYER_2).find(
      ea => ea.action.type === 'play-hazard' && ea.action.cardInstanceId === inst && ea.viable,
    );
    const keyed = (act!.action as { keyedBy?: { method: string; value: string } }).keyedBy;
    expect(keyed).toEqual({ method: 'region-type', value: RegionType.Wilderness });
  });

  // ─── Shadow mode: one Shadow-land counts as two Wildernesses ───────────────

  test('a {w}{w} creature becomes playable on a single-shadow path with the boost', () => {
    const base: GameState = { ...baseState([GIANT]), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Shadow], resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold, destinationSiteName: 'Dol Guldur',
    }) };
    expect(giantIsPlayable(base)).toBe(false);          // control: no boost
    expect(giantIsPlayable(withBoost(base))).toBe(true); // shadow → two wildernesses
  });

  // ─── Border mode: one Border-land counts as two Wildernesses ───────────────

  test('a {w}{w} creature becomes playable on a single-border path with the boost', () => {
    const base: GameState = { ...baseState([GIANT]), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Border], resolvedSitePathNames: ['Andrast'],
      destinationSiteType: SiteType.BorderHold, destinationSiteName: 'Edhellond',
    }) };
    expect(giantIsPlayable(base)).toBe(false);           // control: no boost
    expect(giantIsPlayable(withBoost(base))).toBe(true); // border → two wildernesses
  });

  // ─── No applicable region: boost cannot help ───────────────────────────────

  test('the boost does not help when the path has no wilderness/shadow/border region', () => {
    const base: GameState = { ...baseState([GIANT]), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Free, RegionType.Free], resolvedSitePathNames: ['Lamedon', 'Anfalas'],
      destinationSiteType: SiteType.FreeHold, destinationSiteName: 'Edhellond',
    }) };
    expect(giantIsPlayable(withBoost(base))).toBe(false);
  });

  // ─── Boundary: the boost only adds one region, not unlimited ────────────────

  test('one region counts as exactly two: a {w}{w}{w} creature needs two real wildernesses', () => {
    // True Fire-drake (le-95) base keying is {w}{w}{w} (the {w}{w} softening
    // requires Doors of Night, which is not in play here). The boost turns one
    // wilderness into two, so a single-wilderness path yields only two — not
    // enough — but a two-wilderness path yields three.
    const onePath: GameState = { ...baseState([TRUE_FIRE_DRAKE]), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Wilderness], resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs, destinationSiteName: 'Moria',
    }) };
    expect(giantIsPlayable(withBoost(onePath), TRUE_FIRE_DRAKE)).toBe(false);

    const twoPath: GameState = { ...baseState([TRUE_FIRE_DRAKE]), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness], resolvedSitePathNames: ['Rhudaur', 'Arthedain'],
      destinationSiteType: SiteType.RuinsAndLairs, destinationSiteName: 'Moria',
    }) };
    expect(giantIsPlayable(withBoost(twoPath), TRUE_FIRE_DRAKE)).toBe(true);
  });
});
