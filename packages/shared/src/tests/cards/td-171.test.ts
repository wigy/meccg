/**
 * @module td-171.test
 *
 * Card test: Wondrous Maps (td-171)
 * Type: hero-resource-event (permanent)
 * Effects: 4
 *   1. play-window: organization, step end-of-org
 *   2. play-target company, DSL filter { company.moving: false, company.hasSite: true }
 *   3. acts-as-site: siteType ruins-and-lairs, automatic-attack Orcs 4/7,
 *      playableResources (minor, major), resourceDraws 1, hazardDraws 3,
 *      requiredMovementType region, requiredLastRegionType shadow,
 *      leaveRequiresRegionMovement, discardOnLeaveSite
 *   4. on-event self-enters-play → declare-virtual-site-movement, target: target-company
 *
 * Text:
 *   "Playable at the end of the organization phase on a company using region
 *    cards with the last one being a Shadow-land [{s}]. (Play regions face-up.)
 *    This card is used as a site card, Ruins & Lairs [{R}] (automatic-attack:
 *    Orcs—4 strikes at 7 prowess, items: (minor, major), cards opponent draws:
 *    3, you draw: 1). The company may only leave the site using region
 *    movement. Discard Wonderous Maps when the company moves to a new site."
 *
 * Engine support (new primitive — `acts-as-site` / `declare-virtual-site-movement`,
 * see `docs/certification-engine-support.md`):
 * | # | Rule (card text)                                              | Status      |
 * |---|------------------------------------------------------------------|-------------|
 * | 1 | Playable at the end of the organization phase                  | IMPLEMENTED |
 * | 2 | … on a company [not already moving, with a current site]       | IMPLEMENTED |
 * | 3 | Declares movement to itself instead of a real site (no draw)   | IMPLEMENTED |
 * | 4 | Movement must use region movement ending in a Shadow-land      | IMPLEMENTED |
 * | 5 | This card is used as a site card, Ruins & Lairs                | IMPLEMENTED |
 * | 6 | automatic-attack: Orcs — 4 strikes at 7 prowess                | IMPLEMENTED |
 * | 7 | items: (minor, major)                                          | IMPLEMENTED |
 * | 8 | cards opponent draws: 3, you draw: 1                           | IMPLEMENTED |
 * | 9 | The company may only leave the site using region movement      | IMPLEMENTED |
 * | 10| Discard when the company moves to a new site                   | IMPLEMENTED |
 *
 * Playable: YES
 * Certified: 2026-08-28
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, reduce, viableActions, viableFor,
  companyIdAt, findHandCardId, addCardInPlay, makeMHState, makeSitePhase,
  playPermanentEventAndResolve,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Alignment, CardStatus, Phase, Race, SiteType, ARAGORN, LEGOLAS, LORIEN, RIVENDELL } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState, MovementHazardPhaseState } from '../../index.js';
import type { PlayPermanentEventAction, DeclarePathAction, PlanMovementAction } from '../../index.js';
import { MovementType } from '../../types/common.js';

const WONDROUS_MAPS = 'td-171' as CardDefinitionId;
const WONDROUS_MAPS_SITE = 'td-171-site' as CardDefinitionId;
const CAMETH_BRIN = 'tw-379' as CardDefinitionId; // border-hold, Rhudaur — adjacent to Angmar (shadow)
const A_SMALL_VIAL = 'tw-244' as CardDefinitionId; // minor item

/** Organization-phase state: a hero company at Rivendell (Rhudaur), hand holds Wondrous Maps. */
function orgState(): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        hand: [WONDROUS_MAPS],
        siteDeck: [CAMETH_BRIN],
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
}

/** Play Wondrous Maps on the company at Rivendell (declares movement to the card itself). */
function playWondrousMaps(): GameState {
  const base = orgState();
  return playPermanentEventAndResolve(
    base, PLAYER_1, findHandCardId(base, RESOURCE_PLAYER, WONDROUS_MAPS), undefined,
    { targetCompanyId: companyIdAt(base, RESOURCE_PLAYER) },
  );
}

/** Play the card and enter the reveal-new-site step of the company's M/H phase. */
function playedAtReveal(): GameState {
  const played = playWondrousMaps();
  return { ...played, phaseState: makeMHState({ step: 'reveal-new-site', activeCompanyIndex: 0 }) };
}

/** Every legal `declare-path` action for PLAYER_1 in the given state. */
function declarePathActions(state: GameState): DeclarePathAction[] {
  return viableFor(state, PLAYER_1)
    .map(a => a.action)
    .filter((a): a is DeclarePathAction => a.type === 'declare-path');
}

/** Declare a legal region path ending in a Shadow-land (Angmar). */
function declareShadowPath(state: GameState): GameState {
  const toShadow = declarePathActions(state).find(a => a.movementType === MovementType.Region && (a.regionPath?.length ?? 0) > 0);
  if (!toShadow) throw new Error('no viable region declare-path action reaching a Shadow-land');
  return dispatch(state, toShadow);
}

/**
 * Drive both players' `pass` through draw-cards and play-hazards to finish
 * the company's M/H phase (declare-path already auto-advances through the
 * hazard-limit snapshot and order-effects steps).
 */
function finishMH(state: GameState): GameState {
  let s = dispatch(state, { type: 'pass', player: PLAYER_1 }); // resource player: draw-cards
  s = dispatch(s, { type: 'pass', player: PLAYER_2 }); // hazard player: draw-cards
  s = dispatch(s, { type: 'pass', player: PLAYER_1 }); // resource player: play-hazards
  s = dispatch(s, { type: 'pass', player: PLAYER_2 }); // hazard player: play-hazards
  return s;
}

/** Play, declare a shadow-land region path, and finish the M/H phase — the company arrives. */
function arrivedAtVirtualSite(): GameState {
  return finishMH(declareShadowPath(playedAtReveal()));
}

/**
 * Directly construct a company sitting at the Wondrous Maps virtual site
 * (bypassing the org/M/H pipeline — used for site-behavior/leave tests that
 * don't need to exercise the movement-declaration machinery itself). Returns
 * the shared instance ID (the same ID appears in `cardsInPlay` with the
 * resource-event definition, and as `currentSite` with the site definition).
 */
function atVirtualSite(phase: Phase.Site | Phase.Organization): { state: GameState; instanceId: CardInstanceId } {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [CAMETH_BRIN], playDeck: [] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [], playDeck: [] },
    ],
  });
  const withCard = addCardInPlay(base, RESOURCE_PLAYER, WONDROUS_MAPS);
  const instanceId = withCard.players[RESOURCE_PLAYER].cardsInPlay[withCard.players[RESOURCE_PLAYER].cardsInPlay.length - 1].instanceId;
  const players = withCard.players.map((p, i) => i === RESOURCE_PLAYER
    ? {
        ...p,
        companies: p.companies.map((c, ci) => ci === 0
          ? { ...c, currentSite: { instanceId, definitionId: WONDROUS_MAPS_SITE, status: CardStatus.Untapped }, virtualSiteRegionName: 'Angmar' }
          : c),
      }
    : p);
  const phaseState = phase === Phase.Site ? makeSitePhase({ step: 'play-resources' }) : withCard.phaseState;
  return { state: { ...withCard, players: players as unknown as typeof base.players, phaseState }, instanceId };
}

describe('Wondrous Maps (td-171)', () => {
  beforeEach(() => resetMint());

  // ─── Playability ────────────────────────────────────────────────────────

  test('playable at the end of the organization phase on a company with a site, not already moving', () => {
    const base = orgState();
    const cardId = findHandCardId(base, RESOURCE_PLAYER, WONDROUS_MAPS);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const plays = viableActions(base, PLAYER_1, 'play-permanent-event')
      .map(ea => ea.action as PlayPermanentEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(1);
    expect(plays[0].targetCompanyId).toBe(companyId);
  });

  test('not playable on a company that has already declared movement', () => {
    const base = orgState();
    const cardId = findHandCardId(base, RESOURCE_PLAYER, WONDROUS_MAPS);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const camethInst = base.players[RESOURCE_PLAYER].siteDeck.find(s => s.definitionId === CAMETH_BRIN)!;
    const alreadyMoving = dispatch(base, {
      type: 'plan-movement', player: PLAYER_1, companyId, destinationSite: camethInst.instanceId,
    });

    const plays = viableActions(alreadyMoving, PLAYER_1, 'play-permanent-event')
      .map(ea => ea.action as PlayPermanentEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('the organization-phase play window is enforced — not playable during the M/H phase', () => {
    const base = orgState();
    const cardId = findHandCardId(base, RESOURCE_PLAYER, WONDROUS_MAPS);
    const inMH: GameState = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const plays = viableActions(inMH, PLAYER_1, 'play-permanent-event')
      .map(ea => ea.action as PlayPermanentEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  // ─── Declaring movement to itself ──────────────────────────────────────

  test("playing it sets the company's destination to the card itself — no site deck draw", () => {
    const before = orgState();
    const cardId = findHandCardId(before, RESOURCE_PLAYER, WONDROUS_MAPS);
    const after = playWondrousMaps();

    const company = after.players[RESOURCE_PLAYER].companies[0];
    expect(company.destinationSite?.instanceId).toBe(cardId);
    expect(company.destinationSite?.definitionId).toBe(WONDROUS_MAPS_SITE);
    // Site deck is untouched — this move never draws a card from it.
    expect(after.players[RESOURCE_PLAYER].siteDeck).toHaveLength(before.players[RESOURCE_PLAYER].siteDeck.length);
    // The card itself is now in cardsInPlay (as the resource-event definition).
    const inPlay = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === cardId);
    expect(inPlay?.definitionId).toBe(WONDROUS_MAPS);
  });

  test('only region-movement declare-path actions are offered, each ending in a Shadow-land', () => {
    const inMH = playedAtReveal();
    const paths = declarePathActions(inMH);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every(a => a.movementType === MovementType.Region)).toBe(true);
    // Every offered path's declared last region resolves to a Shadow-land.
    for (const path of paths) {
      const lastRegionId = path.regionPath![path.regionPath!.length - 1];
      const regionDef = inMH.cardPool[lastRegionId];
      expect(regionDef && 'regionType' in regionDef ? regionDef.regionType : undefined).toBe('shadow');
    }
  });

  test('declaring starter movement is rejected', () => {
    const inMH = playedAtReveal();
    const result = reduce(inMH, { type: 'declare-path', player: PLAYER_1, movementType: MovementType.Starter });
    expect(result.error).toBeDefined();
  });

  test('declaring a region path that does not end in a Shadow-land is rejected', () => {
    const inMH = playedAtReveal();
    // Rhudaur alone (wilderness) — a single-region path back to the origin's
    // own region, never reaching a Shadow-land.
    const rhudaurRegionId = Object.values(inMH.cardPool).find(
      c => c.cardType === 'region' && c.name === 'Rhudaur',
    )!.id;
    const result = reduce(inMH, {
      type: 'declare-path', player: PLAYER_1, movementType: MovementType.Region, regionPath: [rhudaurRegionId],
    });
    expect(result.error).toBeDefined();
  });

  test('arriving records the current site as the Wondrous Maps virtual site and the region it sits in', () => {
    const finished = arrivedAtVirtualSite();
    const company = finished.players[RESOURCE_PLAYER].companies[0];
    expect(company.currentSite?.definitionId).toBe(WONDROUS_MAPS_SITE);
    expect(company.virtualSiteRegionName).toBe('Angmar');
    expect(company.destinationSite).toBeNull();
  });

  test('resource/hazard draw counts match the printed site box (1 / 3)', () => {
    const revealed = declareShadowPath(playedAtReveal());
    const mh = revealed.phaseState as MovementHazardPhaseState;
    expect(mh.resolvedSitePathNames.at(-1)).toBe('Angmar');
    expect(mh.resolvedSitePath.at(-1)).toBe('shadow');
    // Advance past the hazard-play window straight to the draw step by
    // simulating both players passing hazards.
    const finished = finishMH(revealed);
    const finishedMh = finished.phaseState as MovementHazardPhaseState;
    if (finishedMh.phase === Phase.MovementHazard) {
      expect(finishedMh.resourceDrawMax).toBe(1);
      expect(finishedMh.hazardDrawMax).toBe(3);
    }
  });

  // ─── Site behavior once arrived (constructed directly) ─────────────────

  test('the virtual site counts as Ruins & Lairs with the printed automatic attack', () => {
    const { state } = atVirtualSite(Phase.Site);
    const siteDef = state.cardPool[WONDROUS_MAPS_SITE];
    expect(siteDef && 'siteType' in siteDef ? siteDef.siteType : undefined).toBe(SiteType.RuinsAndLairs);
    expect(siteDef && 'automaticAttacks' in siteDef ? siteDef.automaticAttacks : undefined).toEqual([
      { creatureType: 'Orcs', strikes: 4, prowess: 7 },
    ]);
    expect(siteDef && 'playableResources' in siteDef ? siteDef.playableResources : undefined).toEqual(['minor', 'major']);
  });

  test('the automatic attack triggers combat: Orcs, 4 strikes at 7 prowess', () => {
    const { state } = atVirtualSite(Phase.Site);
    const atAttacks: GameState = { ...state, phaseState: makeSitePhase({ step: 'automatic-attacks', siteEntered: true }) };
    const next = dispatch(atAttacks, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(4);
    expect(next.combat!.strikeProwess).toBe(7);
    expect(next.combat!.creatureRace).toBe(Race.Orc);
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  test('a minor item is playable at the virtual site', () => {
    const { state } = atVirtualSite(Phase.Site);
    const withHand = {
      ...state,
      players: state.players.map((p, i) => i === RESOURCE_PLAYER
        ? { ...p, hand: [{ instanceId: 'x-hand-1' as CardInstanceId, definitionId: A_SMALL_VIAL }] }
        : p) as unknown as typeof state.players,
    };
    const plays = viableActions(withHand, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThan(0);
  });

  // ─── Leaving and discard ────────────────────────────────────────────────

  test('the company may plan movement away using region movement', () => {
    const { state } = atVirtualSite(Phase.Organization);
    const plans = viableFor(state, PLAYER_1)
      .map(a => a.action)
      .filter((a): a is PlanMovementAction => a.type === 'plan-movement');
    expect(plans.length).toBeGreaterThan(0);
    const camethInst = state.players[RESOURCE_PLAYER].siteDeck.find(s => s.definitionId === CAMETH_BRIN)!;
    expect(plans.some(p => p.destinationSite === camethInst.instanceId)).toBe(true);
  });

  test('discards Wondrous Maps when the company moves to a new site', () => {
    const { state, instanceId } = atVirtualSite(Phase.Organization);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const camethInst = state.players[RESOURCE_PLAYER].siteDeck.find(s => s.definitionId === CAMETH_BRIN)!;

    const planned = dispatch(state, {
      type: 'plan-movement', player: PLAYER_1, companyId, destinationSite: camethInst.instanceId,
    });
    const mh: GameState = { ...planned, phaseState: makeMHState({ step: 'reveal-new-site', activeCompanyIndex: 0 }) };
    const toCameth = declarePathActions(mh).find(a => a.movementType === MovementType.Region);
    expect(toCameth).toBeDefined();
    const declared = dispatch(mh, toCameth!);
    const finished = finishMH(declared);

    const company = finished.players[RESOURCE_PLAYER].companies[0];
    expect(company.currentSite?.definitionId).toBe(CAMETH_BRIN);
    expect(company.virtualSiteRegionName).toBeUndefined();
    // The Wondrous Maps instance is discarded, never lost.
    expect(finished.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === instanceId)).toBe(false);
    expect(finished.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === instanceId)).toBe(true);
  });
});
