/**
 * @module le-115.test
 *
 * Card test: Incite Defenders (le-115)
 * Type: hazard-event (short)
 *
 * "Playable on a Border-hold or Free-hold. An additional automatic-attack
 *  is created at the site until the end of the turn. This is an exact
 *  duplicate (including all existing and eventual modifications to prowess,
 *  etc.) of an existing automatic-attack of your choice at the site. This
 *  automatic-attack is faced immediately following its original. Cannot be
 *  duplicated on a given site."
 *
 * Engine support:
 * - play-target site with filter for border-hold / free-hold
 * - duplication-limit scope:turn max:1
 * - on-event company-arrives-at-site → auto-attack-duplicate constraint
 * - reducer-site handles the duplicate attack during automatic-attacks step
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  reduce,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BREE,
  buildTestState, resetMint,
  viableActions, makeMHState, makeSitePhase,
  P1_COMPANY,
  handCardId, dispatch, playHazardAndResolve,
} from '../test-helpers.js';
import { Phase, SiteType, RegionType, CardStatus } from '../../index.js';
import { addConstraint } from '../../engine/pending.js';
import type { GameState, HazardEventCard, MovementHazardPhaseState, SitePhaseState, CardDefinitionId, CompanyId, CardInstanceId } from '../../index.js';

const INCITE_DEFENDERS = 'le-115' as CardDefinitionId;
const BAG_END_LE = 'le-350' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Incite Defenders (le-115)', () => {
  beforeEach(() => resetMint());

  test('card definition is a short hazard event with correct effects', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [INCITE_DEFENDERS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const def = state.cardPool[INCITE_DEFENDERS as string] as HazardEventCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hazard-event');
    expect(def.eventType).toBe('short');
    expect(def.effects).toHaveLength(3);
    expect(def.effects![0].type).toBe('play-target');
    expect(def.effects![1].type).toBe('duplication-limit');
    expect(def.effects![2].type).toBe('on-event');
  });

  // ─── Playability ────────────────────────────────────────────────────────

  test('playable at a free-hold destination', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [BAG_END_LE] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [INCITE_DEFENDERS], siteDeck: [MINAS_TIRITH] },
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
      destinationSiteName: 'Bag End',
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['The Shire'],
    });
    const mhGameState: GameState = { ...stateWithDest, phaseState: mh };
    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
  });

  test('not playable at a border-hold destination without automatic-attacks (Bree)', () => {
    // Bree (tw-378) is a border-hold with no automatic-attacks. Incite Defenders
    // duplicates an existing automatic-attack, so it must only be playable at
    // sites that actually have one.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [BREE] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [INCITE_DEFENDERS], siteDeck: [MINAS_TIRITH] },
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
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Bree',
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['Eriador'],
    });
    const mhGameState: GameState = { ...stateWithDest, phaseState: mh };
    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('not playable at a free-hold destination without automatic-attacks (Minas Tirith)', () => {
    // Minas Tirith (tw-412) is a free-hold with no automatic-attacks.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [INCITE_DEFENDERS], siteDeck: [BREE] },
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

  test('not playable at a ruins-and-lairs destination', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [INCITE_DEFENDERS], siteDeck: [MINAS_TIRITH] },
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
      destinationSiteName: 'Moria',
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hollin'],
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
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [BAG_END_LE] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [INCITE_DEFENDERS], siteDeck: [MINAS_TIRITH] },
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
      destinationSiteName: 'Bag End',
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['The Shire'],
    });
    const mhGameState: GameState = { ...stateWithDest, phaseState: mh };
    const idId = handCardId(mhGameState, 1);
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
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [BAG_END_LE] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [INCITE_DEFENDERS, INCITE_DEFENDERS], siteDeck: [MINAS_TIRITH] },
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
      destinationSiteName: 'Bag End',
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['The Shire'],
    });
    const mhGameState: GameState = { ...stateWithDest, phaseState: mh };
    const id1 = handCardId(mhGameState, 1, 0);

    const afterFirst = dispatch(mhGameState, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: id1, targetCompanyId: P1_COMPANY });
    expect(afterFirst.chain).not.toBeNull();

    const actions = viableActions(afterFirst, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  // ─── Constraint creation ───────────────────────────────────────────────

  test('adds auto-attack-duplicate constraint after play and resolve at free-hold', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [BAG_END_LE] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [INCITE_DEFENDERS], siteDeck: [MINAS_TIRITH] },
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
      destinationSiteName: 'Bag End',
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['The Shire'],
    });
    const mhGameState: GameState = { ...stateWithDest, phaseState: mh };
    const idId = handCardId(mhGameState, 1);
    const afterPlay = playHazardAndResolve(mhGameState, PLAYER_2, idId, P1_COMPANY);

    const dup = afterPlay.activeConstraints.find(c => c.kind.type === 'auto-attack-duplicate');
    expect(dup).toBeDefined();
    expect(dup!.kind.type).toBe('auto-attack-duplicate');
    expect(dup!.target).toEqual({ kind: 'company', companyId: P1_COMPANY });
  });

  // ─── Site phase: duplicate attack fires ────────────────────────────────

  test('duplicate automatic attack fires after normal attacks at free-hold with auto-attacks', () => {
    const state = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: BAG_END_LE, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
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

    // Add auto-attack-duplicate constraint (as if Incite Defenders resolved)
    s = addConstraint(s, {
      source: 'incite-1' as CardInstanceId,
      sourceDefinitionId: INCITE_DEFENDERS,
      scope: { kind: 'company-site-phase', companyId },
      target: { kind: 'company', companyId },
      kind: { type: 'auto-attack-duplicate' },
    });

    // Bag End (le-350) has 2 auto-attacks: Hobbits (5/5) and Dúnedain (3/11)
    // First pass → initiates first auto-attack (Hobbits)
    s = dispatch(s, { type: 'pass', player: PLAYER_1 });
    expect(s.combat).not.toBeNull();
    expect(s.combat!.strikeProwess).toBe(5);
    expect(s.combat!.strikesTotal).toBe(5);
    expect(s.combat!.creatureRace).toBe('hobbit');

    // Cancel the combat (force through by setting combat to null for testing)
    s = { ...s, combat: null };

    // Second pass → initiates second auto-attack (Dúnedain)
    s = dispatch(s, { type: 'pass', player: PLAYER_1 });
    expect(s.combat).not.toBeNull();
    expect(s.combat!.strikeProwess).toBe(11);
    expect(s.combat!.strikesTotal).toBe(3);

    // Cancel the combat
    s = { ...s, combat: null };

    // Third pass → all normal attacks done, duplicate fires (copies first attack: Hobbits 5/5)
    s = dispatch(s, { type: 'pass', player: PLAYER_1 });
    expect(s.combat).not.toBeNull();
    expect(s.combat!.strikeProwess).toBe(5);
    expect(s.combat!.strikesTotal).toBe(5);
    expect(s.combat!.creatureRace).toBe('hobbit');

    // Constraint should be consumed
    expect(s.activeConstraints.find(c => c.kind.type === 'auto-attack-duplicate')).toBeUndefined();

    // Cancel the combat
    s = { ...s, combat: null };

    // Fourth pass → no more attacks, advance to declare-agent-attack
    s = dispatch(s, { type: 'pass', player: PLAYER_1 });
    expect(s.combat).toBeNull();
    expect((s.phaseState as SitePhaseState).step).toBe('declare-agent-attack');
  });

  test('no duplicate fires when constraint is absent', () => {
    const state = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: BAG_END_LE, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const sitePhase = makeSitePhase({
      step: 'automatic-attacks',
      automaticAttacksResolved: 0,
      siteEntered: false,
    });
    let s: GameState = { ...state, phaseState: sitePhase };

    // Process both normal attacks
    s = dispatch(s, { type: 'pass', player: PLAYER_1 });
    expect(s.combat).not.toBeNull();
    s = { ...s, combat: null };

    s = dispatch(s, { type: 'pass', player: PLAYER_1 });
    expect(s.combat).not.toBeNull();
    s = { ...s, combat: null };

    // No constraint — should advance directly to declare-agent-attack
    s = dispatch(s, { type: 'pass', player: PLAYER_1 });
    expect(s.combat).toBeNull();
    expect((s.phaseState as SitePhaseState).step).toBe('declare-agent-attack');
  });

  test('counts against hazard limit', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [BAG_END_LE] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [INCITE_DEFENDERS], siteDeck: [MINAS_TIRITH] },
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
        hazardLimit: 4,
        destinationSiteType: SiteType.FreeHold,
        destinationSiteName: 'Bag End',
        resolvedSitePath: [RegionType.Free],
        resolvedSitePathNames: ['The Shire'],
      }),
    };
    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });
});
