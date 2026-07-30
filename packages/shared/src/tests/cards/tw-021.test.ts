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
  ARAGORN, LEGOLAS,
  DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  viableActions, makeMHState,
  P1_COMPANY,
  handCardId, dispatch, playHazardAndResolve, HAZARD_PLAYER,
  makeSitePhase, placeOnGuard, buildSitePhaseTwoPlayer, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Phase, SiteType, RegionType, CardStatus } from '../../index.js';
import type { GameState, HazardEventCard, MovementHazardPhaseState, CardInstanceId, CardDefinitionId, RevealOnGuardAction } from '../../index.js';

const CHOKING_SHADOWS = 'tw-21' as CardDefinitionId;
const ORC_GUARD = 'tw-072' as CardDefinitionId;
const HUORN = 'tw-45' as CardDefinitionId;
// Glittering Caves: a Ruins & Lairs site with an automatic-attack, used to
// test Choking Shadows revealed from an on-guard slot (rule 2.V.i).
const GLITTERING_CAVES = 'tw-397' as CardDefinitionId;

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

    const def = state.cardPool[CHOKING_SHADOWS] as HazardEventCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hazard-event');
    expect(def.eventType).toBe('short');
    expect(def.keywords).toContain('environment');
    // 1 duplication-limit + 1 play-condition + 3 on-event modes
    expect(def.effects).toHaveLength(5);
    expect(def.effects![0].type).toBe('duplication-limit');
    expect(def.effects![1].type).toBe('play-condition');
    expect(def.effects![2].type).toBe('on-event');
    expect(def.effects![3].type).toBe('on-event');
    expect(def.effects![4].type).toBe('on-event');
  });

  test('can be played at a R&L destination during M/H play-hazards step', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CHOKING_SHADOWS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = {
      ...state,
      phaseState: makeMHState({
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Moria',
        resolvedSitePath: [RegionType.Wilderness],
        resolvedSitePathNames: ['Hollin'],
      }),
    };
    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
  });

  test('not playable when destination is non-R&L and Doors of Night is not in play', () => {
    // Bug: Choking Shadows was playable against any company regardless of
    // destination/DoN, even though none of its effects could trigger.
    // Rule 5.1.2: a short-event cannot be played unless it would have an effect.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CHOKING_SHADOWS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Dark-hold destination, shadow region — none of the three Choking Shadows
    // modes can trigger (Modes B1/B2 require DoN; Mode A requires R&L).
    const mhGameState: GameState = {
      ...state,
      phaseState: makeMHState({
        destinationSiteType: SiteType.DarkHold,
        destinationSiteName: 'Carn Dûm',
        resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness, RegionType.Wilderness, RegionType.Shadow],
        resolvedSitePathNames: ['Redhorn Gate', 'Hollin', 'Rhudaur', 'Angmar'],
      }),
    };
    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('goes to discard pile after play (short event)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CHOKING_SHADOWS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = {
      ...state,
      phaseState: makeMHState({
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Moria',
        resolvedSitePath: [RegionType.Wilderness],
        resolvedSitePathNames: ['Hollin'],
      }),
    };
    const csId = handCardId(mhGameState, HAZARD_PLAYER);
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
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CHOKING_SHADOWS, CHOKING_SHADOWS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = {
      ...state,
      phaseState: makeMHState({
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Moria',
        resolvedSitePath: [RegionType.Wilderness],
        resolvedSitePathNames: ['Hollin'],
      }),
    };
    const cs1Id = handCardId(mhGameState, HAZARD_PLAYER, 0);

    // Play first copy → enters chain
    const afterFirst = dispatch(mhGameState, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: cs1Id, targetCompanyId: P1_COMPANY });
    expect(afterFirst.chain).not.toBeNull();

    // Second copy should not be in the viable legal actions
    const actions = viableActions(afterFirst, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('second copy is still rejected after first resolves (active constraint persists for the turn)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA }], hand: [], siteDeck: [MORIA] },
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
    const cs1Id = handCardId(mhGameState, HAZARD_PLAYER, 0);

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
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CHOKING_SHADOWS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = {
      ...state,
      phaseState: makeMHState({
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Moria',
        resolvedSitePath: [RegionType.Wilderness],
        resolvedSitePathNames: ['Hollin'],
        hazardsPlayedThisCompany: 4,
        hazardLimitAtReveal: 4,
      }),
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
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA }], hand: [], siteDeck: [MORIA] },
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

    const csId = handCardId(mhGameState, HAZARD_PLAYER);
    const afterPlay = playHazardAndResolve(mhGameState, PLAYER_2, csId, P1_COMPANY);

    const boost = afterPlay.activeConstraints.find(c =>
      c.kind.type === 'attribute-modifier' && c.kind.attribute === 'auto-attack.prowess',
    );
    expect(boost).toBeDefined();
    if (boost!.kind.type === 'attribute-modifier') {
      expect(boost!.kind.op).toBe('add');
      expect(boost!.kind.value).toBe(2);
      expect(boost!.kind.filter).toEqual({ 'site.type': SiteType.RuinsAndLairs });
    }
  });

  test('Mode A — non-R&L destination with no Doors of Night, not playable (play-condition)', () => {
    // Rule 5.1.2: cannot play if no effect can trigger. At a non-R&L site
    // without Doors of Night, none of the three Choking Shadows modes apply.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MINAS_TIRITH }], hand: [], siteDeck: [MORIA] },
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

    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
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
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA }], hand: [], siteDeck: [MORIA] },
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

    const csId = handCardId(mhGameState, HAZARD_PLAYER);
    const afterPlay = playHazardAndResolve(mhGameState, PLAYER_2, csId, P1_COMPANY);

    const siteOverride = afterPlay.activeConstraints.find(c =>
      c.kind.type === 'attribute-modifier' && c.kind.attribute === 'site.type',
    );
    expect(siteOverride).toBeDefined();
    if (siteOverride!.kind.type === 'attribute-modifier') {
      expect(siteOverride!.kind.op).toBe('override');
      expect(siteOverride!.kind.value).toBe(SiteType.ShadowHold);
    }
    // Mode A must not also apply (no prowess-add modifier)
    const prowessMods = afterPlay.activeConstraints.filter(c =>
      c.kind.type === 'attribute-modifier' && c.kind.attribute === 'auto-attack.prowess',
    );
    expect(prowessMods).toHaveLength(0);
  });

  // ─── Keying through the override: offer/validate symmetry ────────────────

  test('Mode B2 override keys creatures on a starter-movement (non-parallel) path — offer and reducer agree', () => {
    // Regression from heuristic self-play (sim seed 208): with Choking
    // Shadows' region-type-override active on "Wold & Foothills", the
    // offering side proposed Orc-guard keyed by shadow, but
    // checkCreatureKeying skipped name-scoped overrides whenever
    // resolvedSitePath (from site cards — starter movement) was not
    // index-parallel with resolvedSitePathNames, rejecting the very play it
    // had offered. Both sides now share computeCandidateRegionPaths.
    const donInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: LORIEN }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CHOKING_SHADOWS, ORC_GUARD], siteDeck: [MINAS_TIRITH], cardsInPlay: [donInPlay] },
      ],
    });
    const mh: MovementHazardPhaseState = makeMHState({
      destinationSiteType: SiteType.Haven,
      destinationSiteName: 'Lórien',
      // Starter movement: the type path comes from the site cards' sitePath
      // and is NOT index-parallel with the traversed region names.
      resolvedSitePath: [RegionType.Wilderness, RegionType.Border, RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur', 'Wold & Foothills'],
    });
    const mhGameState: GameState = { ...state, phaseState: mh };
    const csId = handCardId(mhGameState, HAZARD_PLAYER, 0);
    const orcGuardId = handCardId(mhGameState, HAZARD_PLAYER, 1);

    // Play Choking Shadows — Mode B2 (destination region "Wold & Foothills"
    // is a printed Wilderness) leaves the region-type-override constraint.
    const afterCs = playHazardAndResolve(mhGameState, PLAYER_2, csId, P1_COMPANY);
    expect(afterCs.activeConstraints.some(c =>
      c.kind.type === 'attribute-modifier' && c.kind.attribute === 'region.type',
    )).toBe(true);

    // Orc-guard (shadow/dark) is offered keyed by shadow…
    const offers = viableActions(afterCs, PLAYER_2, 'play-hazard');
    const orcOffer = offers.find(a => {
      const action = a.action as { cardInstanceId?: string; keyedBy?: { value?: string } };
      return action.cardInstanceId === orcGuardId && action.keyedBy?.value === RegionType.Shadow;
    });
    expect(orcOffer).toBeDefined();
    // …and the reducer accepts exactly the action it offered.
    const afterOrc = dispatch(afterCs, orcOffer!.action);
    expect(afterOrc.chain).not.toBeNull();
  });

  test('Mode B2 override replaces the printed type — a Wilderness-keyed creature can no longer key to the converted region', () => {
    // Latent inverse of the bug above: the offering side used to keep the
    // printed type AND append the override, so a Wilderness-keyed creature
    // was still offered after the region became a Shadow-land — a play the
    // reducer (replacement semantics) would reject.
    const donInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CHOKING_SHADOWS, HUORN, ORC_GUARD], siteDeck: [MINAS_TIRITH], cardsInPlay: [donInPlay] },
      ],
    });
    const mh: MovementHazardPhaseState = makeMHState({
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Thranduil\'s Halls',
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Western Mirkwood'],
    });
    const mhGameState: GameState = { ...state, phaseState: mh };
    const csId = handCardId(mhGameState, HAZARD_PLAYER, 0);
    const huornId = handCardId(mhGameState, HAZARD_PLAYER, 1);
    const orcGuardId = handCardId(mhGameState, HAZARD_PLAYER, 2);

    const afterCs = playHazardAndResolve(mhGameState, PLAYER_2, csId, P1_COMPANY);

    const offers = viableActions(afterCs, PLAYER_2, 'play-hazard');
    const byCard = (id: string) => offers.filter(a => (a.action as { cardInstanceId?: string }).cardInstanceId === id);
    // Huorn keys only to Wilderness — the sole Wilderness is now a Shadow-land.
    expect(byCard(huornId)).toHaveLength(0);
    // Orc-guard keys to the converted Shadow-land.
    const orcOffers = byCard(orcGuardId);
    expect(orcOffers.length).toBeGreaterThan(0);
    const afterOrc = dispatch(afterCs, orcOffers[0].action);
    expect(afterOrc.chain).not.toBeNull();
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
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CHOKING_SHADOWS], siteDeck: [MINAS_TIRITH], cardsInPlay: [donInPlay] },
      ],
    });

    const mh: MovementHazardPhaseState = makeMHState({
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Thranduil\'s Halls',
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Western Mirkwood'],
    });
    const mhGameState: GameState = { ...state, phaseState: mh };

    const csId = handCardId(mhGameState, HAZARD_PLAYER);
    const afterPlay = playHazardAndResolve(mhGameState, PLAYER_2, csId, P1_COMPANY);

    const regionOverride = afterPlay.activeConstraints.find(c =>
      c.kind.type === 'attribute-modifier' && c.kind.attribute === 'region.type',
    );
    expect(regionOverride).toBeDefined();
    if (regionOverride!.kind.type === 'attribute-modifier') {
      expect(regionOverride!.kind.op).toBe('override');
      expect(regionOverride!.kind.value).toBe(RegionType.Shadow);
      expect(regionOverride!.kind.filter).toEqual({ 'region.name': 'Western Mirkwood' });
    }
  });

  // ─── On-guard reveal (rule 2.V.i) ────────────────────────────────────────

  test('bug regression: placed on-guard at a R&L site with automatic-attacks, is offered for reveal in Step 1', () => {
    // Bug report: Choking Shadows placed on-guard for the +2 boost on an
    // automatic-attack could only be revealed after the automatic-attack was
    // already resolved. Root cause: the reveal-on-guard-attacks eligibility
    // check only recognized `stat-modifier`/`site-entry-roll-attack` effects,
    // not Choking Shadows' `on-event: company-arrives-at-site` + add-constraint
    // shape — so `reveal-on-guard` was never offered for it.
    const base = buildSitePhaseTwoPlayer({ site: GLITTERING_CAVES, heroChars: [ARAGORN] });
    const { state: withOG, ogCard } = placeOnGuard(base, RESOURCE_PLAYER, 0, CHOKING_SHADOWS);
    const testState = { ...withOG, phaseState: makeSitePhase({ step: 'reveal-on-guard-attacks', siteEntered: false }) };

    const revealActions = viableActions(testState, PLAYER_2, 'reveal-on-guard');
    expect(revealActions).toHaveLength(1);
    expect((revealActions[0].action as RevealOnGuardAction).cardInstanceId).toBe(ogCard.instanceId);
  });

  test('bug regression: revealing on-guard at Step 1 applies the +2 prowess boost and discards the card', () => {
    const base = buildSitePhaseTwoPlayer({ site: GLITTERING_CAVES, heroChars: [ARAGORN] });
    const { state: withOG, ogCard } = placeOnGuard(base, RESOURCE_PLAYER, 0, CHOKING_SHADOWS);
    const testState = { ...withOG, phaseState: makeSitePhase({ step: 'reveal-on-guard-attacks', siteEntered: false }) };

    const afterReveal = dispatch(testState, { type: 'reveal-on-guard', player: PLAYER_2, cardInstanceId: ogCard.instanceId });

    // The card is no longer on-guard, and never enters cardsInPlay (short event).
    expect(afterReveal.players[0].companies[0].onGuardCards).toHaveLength(0);
    expect(afterReveal.players[1].cardsInPlay).toHaveLength(0);
    expect(afterReveal.players[1].discardPile.map(c => c.instanceId)).toContain(ogCard.instanceId);

    const boost = afterReveal.activeConstraints.find(c =>
      c.kind.type === 'attribute-modifier' && c.kind.attribute === 'auto-attack.prowess',
    );
    expect(boost).toBeDefined();
    if (boost!.kind.type === 'attribute-modifier') {
      expect(boost!.kind.op).toBe('add');
      expect(boost!.kind.value).toBe(2);
      expect(boost!.kind.filter).toEqual({ 'site.type': SiteType.RuinsAndLairs });
    }
  });
});
