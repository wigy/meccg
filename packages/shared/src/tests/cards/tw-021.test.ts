/**
 * @module tw-021.test
 *
 * Card test: Choking Shadows (tw-21)
 * Type: hazard-event (short, environment)
 *
 * "Environment. Modify the prowess of one automatic-attack at a Ruins & Lairs
 *  site by +2. Alternatively, if Doors of Night is in play, treat one
 *  Wilderness as a Shadow-land or one Ruins & Lairs as a Shadow-hold until
 *  the end of the turn. Cannot be duplicated."
 *
 * Engine support:
 * - duplication-limit scope:turn max:1 — another copy cannot be played
 *   while this card's turn-scoped constraint is still active
 * - Mode A (no Doors of Night): auto-attack-prowess-boost (+2) constraint,
 *   consumed by the next automatic-attack at a R&L site
 * - Mode B1 (Doors of Night + R&L destination): site-type-override to
 *   shadow-hold for the turn
 * - Mode B2 (Doors of Night + Wilderness destination region):
 *   region-type-override to shadow for the turn
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  reduce,
  ARAGORN, LEGOLAS,
  CHOKING_SHADOWS, DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  viableActions, makeMHState,
  P1_COMPANY,
  handCardId, dispatch, playHazardAndResolve,
} from '../test-helpers.js';
import { Phase, SiteType, RegionType, CardStatus } from '../../index.js';
import type { GameState, HazardEventCard, MovementHazardPhaseState, CardInstanceId } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Choking Shadows (tw-21)', () => {
  beforeEach(() => resetMint());

  test('card definition is a short hazard event with environment keyword', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CHOKING_SHADOWS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const def = state.cardPool[CHOKING_SHADOWS as string] as HazardEventCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hazard-event');
    expect(def.eventType).toBe('short');
    expect(def.keywords).toContain('environment');
    // 1 duplication-limit + 3 on-event modes
    expect(def.effects).toHaveLength(4);
    expect(def.effects![0].type).toBe('duplication-limit');
    expect(def.effects![1].type).toBe('on-event');
    expect(def.effects![2].type).toBe('on-event');
    expect(def.effects![3].type).toBe('on-event');
  });

  test('can be played as a hazard short event during M/H play-hazards step', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CHOKING_SHADOWS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = { ...state, phaseState: makeMHState() };
    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
  });

  test('goes to discard pile after play (short event)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CHOKING_SHADOWS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = { ...state, phaseState: makeMHState() };
    const csId = handCardId(mhGameState, 1);
    const s = playHazardAndResolve(mhGameState, PLAYER_2, csId, P1_COMPANY);

    expect(s.players[1].hand).toHaveLength(0);
    expect(s.players[1].cardsInPlay).toHaveLength(0);
    expect(s.players[1].discardPile.map(c => c.instanceId)).toContain(csId);
  });

  test('cannot be duplicated — second copy rejected while first is on chain', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CHOKING_SHADOWS, CHOKING_SHADOWS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = { ...state, phaseState: makeMHState() };
    const cs1Id = handCardId(mhGameState, 1, 0);

    // Play first copy → enters chain
    const afterFirst = dispatch(mhGameState, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: cs1Id, targetCompanyId: P1_COMPANY });
    expect(afterFirst.chain).not.toBeNull();

    // Second copy should be rejected
    const cs2Id = handCardId(mhGameState, 1, 1);
    const result = reduce(afterFirst, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: cs2Id, targetCompanyId: P1_COMPANY });
    expect(result.error).toBe('Choking Shadows cannot be duplicated');
  });

  test('second copy is still rejected after first resolves (active constraint persists for the turn)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CHOKING_SHADOWS, CHOKING_SHADOWS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mh: MovementHazardPhaseState = makeMHState({
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hollin'],
    });
    const mhGameState: GameState = { ...state, phaseState: mh };
    const cs1Id = handCardId(mhGameState, 1, 0);

    // Play and resolve first copy — leaves an auto-attack-prowess-boost
    // constraint active until end of turn.
    const afterResolve = playHazardAndResolve(mhGameState, PLAYER_2, cs1Id, P1_COMPANY);
    expect(afterResolve.chain).toBeNull();
    expect(afterResolve.players[1].discardPile.map(c => c.instanceId)).toContain(cs1Id);
    expect(afterResolve.activeConstraints.some(c => c.sourceDefinitionId === CHOKING_SHADOWS)).toBe(true);

    // Second copy is not playable: the turn-scoped constraint from the
    // first copy is still in effect.
    const actions = viableActions(afterResolve, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('counts against hazard limit', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CHOKING_SHADOWS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = {
      ...state,
      phaseState: makeMHState({ hazardsPlayedThisCompany: 4, hazardLimit: 4 }),
    };
    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  // ─── Mode A: prowess boost at R&L sites ──────────────────────────────────

  test('Mode A — at R&L destination with no Doors of Night, adds auto-attack-prowess-boost constraint', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CHOKING_SHADOWS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mh: MovementHazardPhaseState = makeMHState({
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hollin'],
    });
    const mhGameState: GameState = { ...state, phaseState: mh };

    const csId = handCardId(mhGameState, 1);
    const afterPlay = playHazardAndResolve(mhGameState, PLAYER_2, csId, P1_COMPANY);

    const boost = afterPlay.activeConstraints.find(c => c.kind.type === 'auto-attack-prowess-boost');
    expect(boost).toBeDefined();
    expect(boost!.kind.type).toBe('auto-attack-prowess-boost');
    if (boost!.kind.type === 'auto-attack-prowess-boost') {
      expect(boost!.kind.value).toBe(2);
      expect(boost!.kind.siteType).toBe(SiteType.RuinsAndLairs);
    }
  });

  test('Mode A — non-R&L destination with no Doors of Night, no effect applied', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CHOKING_SHADOWS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mh: MovementHazardPhaseState = makeMHState({
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Bree',
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['Eriador'],
    });
    const mhGameState: GameState = { ...state, phaseState: mh };

    const csId = handCardId(mhGameState, 1);
    const afterPlay = playHazardAndResolve(mhGameState, PLAYER_2, csId, P1_COMPANY);

    expect(afterPlay.activeConstraints.filter(c => c.kind.type === 'auto-attack-prowess-boost')).toHaveLength(0);
    expect(afterPlay.activeConstraints.filter(c => c.kind.type === 'site-type-override')).toHaveLength(0);
    expect(afterPlay.activeConstraints.filter(c => c.kind.type === 'region-type-override')).toHaveLength(0);
  });

  // ─── Mode B: type overrides with Doors of Night in play ──────────────────

  test('Mode B1 — DoN in play + R&L destination: site-type-override to shadow-hold', () => {
    const donInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CHOKING_SHADOWS], siteDeck: [MINAS_TIRITH], cardsInPlay: [donInPlay] },
      ],
    });

    const mh: MovementHazardPhaseState = makeMHState({
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hollin'],
    });
    const mhGameState: GameState = { ...state, phaseState: mh };

    const csId = handCardId(mhGameState, 1);
    const afterPlay = playHazardAndResolve(mhGameState, PLAYER_2, csId, P1_COMPANY);

    const siteOverride = afterPlay.activeConstraints.find(c => c.kind.type === 'site-type-override');
    expect(siteOverride).toBeDefined();
    if (siteOverride!.kind.type === 'site-type-override') {
      expect(siteOverride!.kind.overrideType).toBe(SiteType.ShadowHold);
    }
    // Mode A must not also apply
    expect(afterPlay.activeConstraints.filter(c => c.kind.type === 'auto-attack-prowess-boost')).toHaveLength(0);
  });

  test('Mode B2 — DoN in play + Wilderness destination region: region-type-override to shadow', () => {
    const donInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CHOKING_SHADOWS], siteDeck: [MINAS_TIRITH], cardsInPlay: [donInPlay] },
      ],
    });

    const mh: MovementHazardPhaseState = makeMHState({
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Thranduils Halls',
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Western Mirkwood'],
    });
    const mhGameState: GameState = { ...state, phaseState: mh };

    const csId = handCardId(mhGameState, 1);
    const afterPlay = playHazardAndResolve(mhGameState, PLAYER_2, csId, P1_COMPANY);

    const regionOverride = afterPlay.activeConstraints.find(c => c.kind.type === 'region-type-override');
    expect(regionOverride).toBeDefined();
    if (regionOverride!.kind.type === 'region-type-override') {
      expect(regionOverride!.kind.overrideType).toBe(RegionType.Shadow);
      expect(regionOverride!.kind.regionName).toBe('Western Mirkwood');
    }
  });
});
