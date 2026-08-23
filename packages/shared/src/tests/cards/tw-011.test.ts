/**
 * @module tw-011.test
 *
 * Card test: Awaken the Earth's Fire (tw-11)
 * Type: hazard-event (short, environment)
 *
 * "Environment. Modify the prowess of one automatic-attack at a Shadow-hold
 *  [{S}] or Dark-hold [{D}] site by +2. Alternatively, if Doors of Night is
 *  in play, treat one Shadow-land [{s}] as a Dark-domain [{d}] or one
 *  Shadow-hold [{S}] as a Dark-hold [{D}] until the end of the turn. Cannot
 *  be duplicated."
 *
 * This is the Choking Shadows (tw-21) template one keying tier darker:
 * Ruins & Lairs/Wilderness -> Shadow-hold/Shadow-land becomes
 * Shadow-hold-or-Dark-hold/Shadow-land -> Dark-hold/Dark-domain.
 *
 * Engine support:
 * - duplication-limit scope:turn max:1 — another copy cannot be played
 *   while this card's turn-scoped constraint is still active
 * - Mode A (no Doors of Night): auto-attack-prowess-boost (+2) constraint,
 *   consumed by the next automatic-attack at a Shadow-hold or Dark-hold site
 * - Mode B1 (Doors of Night + Shadow-hold destination): site-type-override
 *   to dark-hold for the turn
 * - Mode B2 (Doors of Night + Shadow-land destination region):
 *   region-type-override to dark for the turn
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
import { Phase, SiteType, RegionType, CardStatus, BARAD_DUR_MINION } from '../../index.js';
import type { GameState, HazardEventCard, MovementHazardPhaseState, CardInstanceId, CardDefinitionId, RevealOnGuardAction } from '../../index.js';

const AWAKEN_EARTHS_FIRE = 'tw-11' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Awaken the Earth\'s Fire (tw-11)', () => {
  beforeEach(() => resetMint());

  test('card definition is a short hazard event with environment keyword', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [AWAKEN_EARTHS_FIRE], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const def = state.cardPool[AWAKEN_EARTHS_FIRE] as HazardEventCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hazard-event');
    expect(def.eventType).toBe('short');
    expect(def.keywords).toContain('environment');
    // 1 duplication-limit + 1 play-condition + 4 on-event modes
    expect(def.effects).toHaveLength(6);
    expect(def.effects![0].type).toBe('duplication-limit');
    expect(def.effects![1].type).toBe('play-condition');
    expect(def.effects![2].type).toBe('on-event');
    expect(def.effects![3].type).toBe('on-event');
    expect(def.effects![4].type).toBe('on-event');
    expect(def.effects![5].type).toBe('on-event');
  });

  test('can be played at a Shadow-hold destination during M/H play-hazards step', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [AWAKEN_EARTHS_FIRE], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = {
      ...state,
      phaseState: makeMHState({
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'Moria',
        resolvedSitePath: [RegionType.Wilderness],
        resolvedSitePathNames: ['Hollin'],
      }),
    };
    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
  });

  test('can be played at a Dark-hold destination during M/H play-hazards step', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: BARAD_DUR_MINION }], hand: [], siteDeck: [BARAD_DUR_MINION] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [AWAKEN_EARTHS_FIRE], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = {
      ...state,
      phaseState: makeMHState({
        destinationSiteType: SiteType.DarkHold,
        destinationSiteName: 'Barad-dûr',
        resolvedSitePath: [RegionType.Shadow],
        resolvedSitePathNames: ['Nurn'],
      }),
    };
    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
  });

  test('not playable when destination is neither Shadow-hold nor Dark-hold and Doors of Night is not in play', () => {
    // Rule 5.1.2: a short-event cannot be played unless it would have an effect.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [AWAKEN_EARTHS_FIRE], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Free-hold destination, free region — none of the four modes can trigger
    // (Modes B1/B2 require DoN; Mode A requires Shadow-hold or Dark-hold).
    const mhGameState: GameState = {
      ...state,
      phaseState: makeMHState({
        destinationSiteType: SiteType.FreeHold,
        destinationSiteName: 'Minas Tirith',
        resolvedSitePath: [RegionType.Free],
        resolvedSitePathNames: ['Anórien'],
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
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [AWAKEN_EARTHS_FIRE], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = {
      ...state,
      phaseState: makeMHState({
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'Moria',
        resolvedSitePath: [RegionType.Wilderness],
        resolvedSitePathNames: ['Hollin'],
      }),
    };
    const aefId = handCardId(mhGameState, HAZARD_PLAYER);
    const s = playHazardAndResolve(mhGameState, PLAYER_2, aefId, P1_COMPANY);

    expect(s.players[1].hand).toHaveLength(0);
    expect(s.players[1].cardsInPlay).toHaveLength(0);
    expect(s.players[1].discardPile.map(c => c.instanceId)).toContain(aefId);
  });

  test('cannot be duplicated — second copy rejected while first is on chain', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [AWAKEN_EARTHS_FIRE, AWAKEN_EARTHS_FIRE], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = {
      ...state,
      phaseState: makeMHState({
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'Moria',
        resolvedSitePath: [RegionType.Wilderness],
        resolvedSitePathNames: ['Hollin'],
      }),
    };
    const aef1Id = handCardId(mhGameState, HAZARD_PLAYER, 0);

    // Play first copy → enters chain
    const afterFirst = dispatch(mhGameState, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: aef1Id, targetCompanyId: P1_COMPANY });
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
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [AWAKEN_EARTHS_FIRE, AWAKEN_EARTHS_FIRE], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mh: MovementHazardPhaseState = makeMHState({
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hollin'],
    });
    const mhGameState: GameState = { ...state, phaseState: mh };
    const aef1Id = handCardId(mhGameState, HAZARD_PLAYER, 0);

    // Play and resolve first copy — leaves an auto-attack-prowess-boost
    // constraint active until end of turn.
    const afterResolve = playHazardAndResolve(mhGameState, PLAYER_2, aef1Id, P1_COMPANY);
    expect(afterResolve.chain).toBeNull();
    expect(afterResolve.players[1].discardPile.map(c => c.instanceId)).toContain(aef1Id);
    expect(afterResolve.activeConstraints.some(c => c.sourceDefinitionId === AWAKEN_EARTHS_FIRE)).toBe(true);

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
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [AWAKEN_EARTHS_FIRE], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = {
      ...state,
      phaseState: makeMHState({
        destinationSiteType: SiteType.ShadowHold,
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

  // ─── Mode A: prowess boost at Shadow-hold / Dark-hold sites ─────────────

  test('Mode A — at Shadow-hold destination with no Doors of Night, adds auto-attack-prowess-boost constraint', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [AWAKEN_EARTHS_FIRE], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mh: MovementHazardPhaseState = makeMHState({
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hollin'],
    });
    const mhGameState: GameState = { ...state, phaseState: mh };

    const aefId = handCardId(mhGameState, HAZARD_PLAYER);
    const afterPlay = playHazardAndResolve(mhGameState, PLAYER_2, aefId, P1_COMPANY);

    const boost = afterPlay.activeConstraints.find(c =>
      c.kind.type === 'attribute-modifier' && c.kind.attribute === 'auto-attack.prowess',
    );
    expect(boost).toBeDefined();
    if (boost!.kind.type === 'attribute-modifier') {
      expect(boost!.kind.op).toBe('add');
      expect(boost!.kind.value).toBe(2);
      expect(boost!.kind.filter).toEqual({ 'site.type': SiteType.ShadowHold });
    }
  });

  test('Mode A — at Dark-hold destination with no Doors of Night, adds auto-attack-prowess-boost constraint', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: BARAD_DUR_MINION }], hand: [], siteDeck: [BARAD_DUR_MINION] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [AWAKEN_EARTHS_FIRE], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mh: MovementHazardPhaseState = makeMHState({
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Barad-dûr',
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Nurn'],
    });
    const mhGameState: GameState = { ...state, phaseState: mh };

    const aefId = handCardId(mhGameState, HAZARD_PLAYER);
    const afterPlay = playHazardAndResolve(mhGameState, PLAYER_2, aefId, P1_COMPANY);

    const boost = afterPlay.activeConstraints.find(c =>
      c.kind.type === 'attribute-modifier' && c.kind.attribute === 'auto-attack.prowess',
    );
    expect(boost).toBeDefined();
    if (boost!.kind.type === 'attribute-modifier') {
      expect(boost!.kind.op).toBe('add');
      expect(boost!.kind.value).toBe(2);
      expect(boost!.kind.filter).toEqual({ 'site.type': SiteType.DarkHold });
    }
  });

  // ─── Mode B: type overrides with Doors of Night in play ──────────────────

  test('Mode B1 — DoN in play + Shadow-hold destination: site-type-override to dark-hold', () => {
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
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [AWAKEN_EARTHS_FIRE], siteDeck: [MINAS_TIRITH], cardsInPlay: [donInPlay] },
      ],
    });

    const mh: MovementHazardPhaseState = makeMHState({
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hollin'],
    });
    const mhGameState: GameState = { ...state, phaseState: mh };

    const aefId = handCardId(mhGameState, HAZARD_PLAYER);
    const afterPlay = playHazardAndResolve(mhGameState, PLAYER_2, aefId, P1_COMPANY);

    const siteOverride = afterPlay.activeConstraints.find(c =>
      c.kind.type === 'attribute-modifier' && c.kind.attribute === 'site.type',
    );
    expect(siteOverride).toBeDefined();
    if (siteOverride!.kind.type === 'attribute-modifier') {
      expect(siteOverride!.kind.op).toBe('override');
      expect(siteOverride!.kind.value).toBe(SiteType.DarkHold);
    }
    // Mode A must not also apply (no prowess-add modifier)
    const prowessMods = afterPlay.activeConstraints.filter(c =>
      c.kind.type === 'attribute-modifier' && c.kind.attribute === 'auto-attack.prowess',
    );
    expect(prowessMods).toHaveLength(0);
  });

  test('Mode B2 — DoN in play + Shadow-land destination region: region-type-override to dark', () => {
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
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [AWAKEN_EARTHS_FIRE], siteDeck: [MINAS_TIRITH], cardsInPlay: [donInPlay] },
      ],
    });

    // Border-hold destination sitting in a Shadow-land region — neither
    // Mode A ("Shadow-hold or Dark-hold") nor the Mode B1 site-override
    // ("Shadow-hold") can apply; only the region override qualifies.
    const mh: MovementHazardPhaseState = makeMHState({
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Outpost of Angmar',
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Angmar'],
    });
    const mhGameState: GameState = { ...state, phaseState: mh };

    const aefId = handCardId(mhGameState, HAZARD_PLAYER);
    const afterPlay = playHazardAndResolve(mhGameState, PLAYER_2, aefId, P1_COMPANY);

    const regionOverride = afterPlay.activeConstraints.find(c =>
      c.kind.type === 'attribute-modifier' && c.kind.attribute === 'region.type',
    );
    expect(regionOverride).toBeDefined();
    if (regionOverride!.kind.type === 'attribute-modifier') {
      expect(regionOverride!.kind.op).toBe('override');
      expect(regionOverride!.kind.value).toBe(RegionType.Dark);
      expect(regionOverride!.kind.filter).toEqual({ 'region.name': 'Angmar' });
    }
    // Mode A must not also apply (border-hold destination — no auto-attack-prowess-boost)
    const prowessMods = afterPlay.activeConstraints.filter(c =>
      c.kind.type === 'attribute-modifier' && c.kind.attribute === 'auto-attack.prowess',
    );
    expect(prowessMods).toHaveLength(0);
  });

  // ─── On-guard reveal (rule 2.V.i) ────────────────────────────────────────

  test('bug regression: placed on-guard at a Shadow-hold site with automatic-attacks, is offered for reveal in Step 1', () => {
    const base = buildSitePhaseTwoPlayer({ site: MORIA, heroChars: [ARAGORN] });
    const { state: withOG, ogCard } = placeOnGuard(base, RESOURCE_PLAYER, 0, AWAKEN_EARTHS_FIRE);
    const testState = { ...withOG, phaseState: makeSitePhase({ step: 'reveal-on-guard-attacks', siteEntered: false }) };

    const revealActions = viableActions(testState, PLAYER_2, 'reveal-on-guard');
    expect(revealActions).toHaveLength(1);
    expect((revealActions[0].action as RevealOnGuardAction).cardInstanceId).toBe(ogCard.instanceId);
  });

  test('bug regression: revealing on-guard at Step 1 applies the +2 prowess boost and discards the card', () => {
    const base = buildSitePhaseTwoPlayer({ site: MORIA, heroChars: [ARAGORN] });
    const { state: withOG, ogCard } = placeOnGuard(base, RESOURCE_PLAYER, 0, AWAKEN_EARTHS_FIRE);
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
      expect(boost!.kind.filter).toEqual({ 'site.type': SiteType.ShadowHold });
    }
  });
});
