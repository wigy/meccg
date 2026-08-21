/**
 * @module td-34.test
 *
 * Card test: Incite Denizens (td-34)
 * Type: hazard-event (short)
 *
 * "Playable on a Ruins & Lairs [{R}]. An additional automatic-attack is
 *  created at the site until the end of the turn. This is an exact duplicate
 *  (including all existing and eventual modifications to prowess, etc.) of an
 *  existing automatic-attack at the site of your choice. This automatic-attack
 *  is faced immediately following its original. Cannot be duplicated on a
 *  given site."
 *
 * Engine support:
 * - play-target site with filter for ruins-and-lairs with auto-attacks
 * - duplication-limit scope:site max:1 ("Cannot be duplicated on a given site")
 * - on-event company-arrives-at-site → auto-attack-duplicate constraint
 * - reducer-site handles the duplicate attack during automatic-attacks step
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  viableActions, makeMHState, makeSitePhase,
  P1_COMPANY,
  handCardId, dispatch, playHazardAndResolve, phaseStateAs, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, SiteType, RegionType, CardStatus, ISENGARD } from '../../index.js';
import { addConstraint } from '../../engine/pending.js';
import type { GameState, HazardEventCard, MovementHazardPhaseState, SitePhaseState, CardDefinitionId, CompanyId, CardInstanceId } from '../../index.js';

const INCITE_DENIZENS = 'td-34' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Incite Denizens (td-34)', () => {
  beforeEach(() => resetMint());

  test('card definition is a short hazard event with correct effects', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [INCITE_DENIZENS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const def = state.cardPool[INCITE_DENIZENS] as HazardEventCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hazard-event');
    expect(def.eventType).toBe('short');
    expect(def.effects).toHaveLength(3);
    expect(def.effects![0].type).toBe('play-target');
    expect(def.effects![1].type).toBe('duplication-limit');
    expect(def.effects![2].type).toBe('on-event');
  });

  // ─── Playability ────────────────────────────────────────────────────────

  test('playable at a ruins-and-lairs destination (Isengard)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [ISENGARD] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [INCITE_DENIZENS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const destCard = state.players[0].siteDeck[0];
    const stateWithDest: GameState = {
      ...state,
      players: [
        {
          ...state.players[0],
          companies: [{
            ...state.players[0].companies[0],
            destinationSite: { instanceId: destCard.instanceId, definitionId: destCard.definitionId, status: CardStatus.Untapped },
          }],
        },
        state.players[1],
      ] as typeof state.players,
    };

    const mh: MovementHazardPhaseState = makeMHState({
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Isengard',
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Gap of Isen'],
    });
    const mhGameState: GameState = { ...stateWithDest, phaseState: mh };
    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
  });

  test('not playable at a free-hold destination (Minas Tirith)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [INCITE_DENIZENS], siteDeck: [ISENGARD] },
      ],
    });

    const destCard = state.players[0].siteDeck[0];
    const stateWithDest: GameState = {
      ...state,
      players: [
        {
          ...state.players[0],
          companies: [{
            ...state.players[0].companies[0],
            destinationSite: { instanceId: destCard.instanceId, definitionId: destCard.definitionId, status: CardStatus.Untapped },
          }],
        },
        state.players[1],
      ] as typeof state.players,
    };

    const mh: MovementHazardPhaseState = makeMHState({
      destinationSiteType: SiteType.FreeHold,
      destinationSiteName: 'Minas Tirith',
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['Gondor'],
    });
    const mhGameState: GameState = { ...stateWithDest, phaseState: mh };
    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('not playable at a shadow-hold destination (Moria)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [INCITE_DENIZENS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const destCard = state.players[0].siteDeck[0];
    const stateWithDest: GameState = {
      ...state,
      players: [
        {
          ...state.players[0],
          companies: [{
            ...state.players[0].companies[0],
            destinationSite: { instanceId: destCard.instanceId, definitionId: destCard.definitionId, status: CardStatus.Untapped },
          }],
        },
        state.players[1],
      ] as typeof state.players,
    };

    const mh: MovementHazardPhaseState = makeMHState({
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Redhorn Gate'],
    });
    const mhGameState: GameState = { ...stateWithDest, phaseState: mh };
    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  // ─── Short event behavior ──────────────────────────────────────────────

  test('goes to discard pile after play (short event)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [ISENGARD] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [INCITE_DENIZENS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const destCard = state.players[0].siteDeck[0];
    const stateWithDest: GameState = {
      ...state,
      players: [
        {
          ...state.players[0],
          companies: [{
            ...state.players[0].companies[0],
            destinationSite: { instanceId: destCard.instanceId, definitionId: destCard.definitionId, status: CardStatus.Untapped },
          }],
        },
        state.players[1],
      ] as typeof state.players,
    };

    const mh: MovementHazardPhaseState = makeMHState({
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Isengard',
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Gap of Isen'],
    });
    const mhGameState: GameState = { ...stateWithDest, phaseState: mh };
    const idId = handCardId(mhGameState, HAZARD_PLAYER);
    const s = playHazardAndResolve(mhGameState, PLAYER_2, idId, P1_COMPANY);

    expect(s.players[1].hand).toHaveLength(0);
    expect(s.players[1].cardsInPlay).toHaveLength(0);
    expect(s.players[1].discardPile.map(c => c.instanceId)).toContain(idId);
  });

  // ─── Duplication limit ─────────────────────────────────────────────────

  test('cannot be duplicated — second copy rejected while first is on chain', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [ISENGARD] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [INCITE_DENIZENS, INCITE_DENIZENS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const destCard = state.players[0].siteDeck[0];
    const stateWithDest: GameState = {
      ...state,
      players: [
        {
          ...state.players[0],
          companies: [{
            ...state.players[0].companies[0],
            destinationSite: { instanceId: destCard.instanceId, definitionId: destCard.definitionId, status: CardStatus.Untapped },
          }],
        },
        state.players[1],
      ] as typeof state.players,
    };

    const mh: MovementHazardPhaseState = makeMHState({
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Isengard',
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Gap of Isen'],
    });
    const mhGameState: GameState = { ...stateWithDest, phaseState: mh };
    const id1 = handCardId(mhGameState, HAZARD_PLAYER, 0);

    const afterFirst = dispatch(mhGameState, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: id1, targetCompanyId: P1_COMPANY });
    expect(afterFirst.chain).not.toBeNull();

    const actions = viableActions(afterFirst, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  // ─── Constraint creation ───────────────────────────────────────────────

  test('adds auto-attack-duplicate constraint after play and resolve at ruins-and-lairs', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [ISENGARD] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [INCITE_DENIZENS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const destCard = state.players[0].siteDeck[0];
    const stateWithDest: GameState = {
      ...state,
      players: [
        {
          ...state.players[0],
          companies: [{
            ...state.players[0].companies[0],
            destinationSite: { instanceId: destCard.instanceId, definitionId: destCard.definitionId, status: CardStatus.Untapped },
          }],
        },
        state.players[1],
      ] as typeof state.players,
    };

    const mh: MovementHazardPhaseState = makeMHState({
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Isengard',
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Gap of Isen'],
    });
    const mhGameState: GameState = { ...stateWithDest, phaseState: mh };
    const idId = handCardId(mhGameState, HAZARD_PLAYER);
    const afterPlay = playHazardAndResolve(mhGameState, PLAYER_2, idId, P1_COMPANY);

    const dup = afterPlay.activeConstraints.find(c => c.kind.type === 'auto-attack-duplicate');
    expect(dup).toBeDefined();
    expect(dup!.kind.type).toBe('auto-attack-duplicate');
    expect(dup!.target).toEqual({ kind: 'company', companyId: P1_COMPANY });
  });

  // ─── Site phase: duplicate attack fires ────────────────────────────────

  test('duplicate automatic attack fires after normal attack at ruins-and-lairs (Isengard)', () => {
    // Isengard (tw-404) has 1 auto-attack: Wolves — 3 strikes / 7 prowess
    const state = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: ISENGARD, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const companyId = `company-${PLAYER_1 as string}-0` as CompanyId;
    const sitePhase = makeSitePhase({
      step: 'automatic-attacks',
      automaticAttacksResolved: 0,
      siteEntered: false,
    });
    let s: GameState = { ...state, phaseState: sitePhase };

    s = addConstraint(s, {
      source: 'incite-1' as CardInstanceId,
      sourceDefinitionId: INCITE_DENIZENS,
      scope: { kind: 'company-site-phase', companyId },
      target: { kind: 'company', companyId },
      kind: { type: 'auto-attack-duplicate' },
    });

    // First pass → initiates Wolves auto-attack (3 strikes / 7 prowess)
    s = dispatch(s, { type: 'pass', player: PLAYER_1 });
    expect(s.combat).not.toBeNull();
    expect(s.combat!.strikeProwess).toBe(7);
    expect(s.combat!.strikesTotal).toBe(3);
    expect(s.combat!.creatureRace).toBe('wolf');

    // Cancel the combat
    s = { ...s, combat: null };

    // Second pass → all normal attacks done, duplicate fires (Wolves again)
    s = dispatch(s, { type: 'pass', player: PLAYER_1 });
    expect(s.combat).not.toBeNull();
    expect(s.combat!.strikeProwess).toBe(7);
    expect(s.combat!.strikesTotal).toBe(3);
    expect(s.combat!.creatureRace).toBe('wolf');

    // Constraint should be consumed
    expect(s.activeConstraints.find(c => c.kind.type === 'auto-attack-duplicate')).toBeUndefined();

    // Cancel the combat
    s = { ...s, combat: null };

    // Third pass → no more attacks, advance to declare-agent-attack
    s = dispatch(s, { type: 'pass', player: PLAYER_1 });
    expect(s.combat).toBeNull();
    expect(phaseStateAs<SitePhaseState>(s).step).toBe('declare-agent-attack');
  });

  test('no duplicate fires when constraint is absent', () => {
    const state = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: ISENGARD, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const sitePhase = makeSitePhase({
      step: 'automatic-attacks',
      automaticAttacksResolved: 0,
      siteEntered: false,
    });
    let s: GameState = { ...state, phaseState: sitePhase };

    // Process the single normal attack
    s = dispatch(s, { type: 'pass', player: PLAYER_1 });
    expect(s.combat).not.toBeNull();
    s = { ...s, combat: null };

    // No constraint — should advance directly to declare-agent-attack
    s = dispatch(s, { type: 'pass', player: PLAYER_1 });
    expect(s.combat).toBeNull();
    expect(phaseStateAs<SitePhaseState>(s).step).toBe('declare-agent-attack');
  });

  test('counts against hazard limit', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [ISENGARD] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [INCITE_DENIZENS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const destCard = state.players[0].siteDeck[0];
    const stateWithDest: GameState = {
      ...state,
      players: [
        {
          ...state.players[0],
          companies: [{
            ...state.players[0].companies[0],
            destinationSite: { instanceId: destCard.instanceId, definitionId: destCard.definitionId, status: CardStatus.Untapped },
          }],
        },
        state.players[1],
      ] as typeof state.players,
    };

    const mhGameState: GameState = {
      ...stateWithDest,
      phaseState: makeMHState({
        hazardsPlayedThisCompany: 4,
        hazardLimitAtReveal: 4,
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Isengard',
        resolvedSitePath: [RegionType.Wilderness],
        resolvedSitePathNames: ['Gap of Isen'],
      }),
    };
    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });
});
