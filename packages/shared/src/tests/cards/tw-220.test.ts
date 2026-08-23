/**
 * @module tw-220.test
 *
 * Card test: Eagle-mounts (tw-220)
 * Type: hero-resource-event (short)
 * Effects: 3
 *   - play-window organization / end-of-org
 *   - play-target character (DSL filter: target.skills $includes "diplomat" + company.siteName "Eagles' Eyrie")
 *   - on-event self-enters-play → set-company-special-movement "eagle-mounts"
 *
 * "Playable only at the end of the organization phase on a company with a
 *  diplomat that begins the turn at Eagles' Eyrie. Company may move to any
 *  site that is not a Shadow-hold [{S}], Dark-hold [{D}], or Under-deeps.
 *  Opponent may only play hazard creatures that are keyed to the company's
 *  new site."
 *
 * Distinct from Gwaihir (tw-251), which excludes destinations by REGION type
 * (Shadow-land [{s}] / Dark-domain [{d}]): Eagle-mounts excludes by SITE type
 * (Shadow-hold [{S}] / Dark-hold [{D}]) instead — its own `eagle-mounts`
 * `specialMovement` mode. Moria is a Shadow-hold sitting in a wilderness
 * region, so it is reachable via Gwaihir but not via Eagle-mounts — this is
 * exercised below.
 *
 * Certified: 2026-08-23
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, Alignment,
  PLAYER_1, PLAYER_2,
  ADRAZAR, BEREGOND, LEGOLAS,
  EAGLES_EYRIE, LORIEN, MORIA, MOUNT_DOOM, BANDIT_LAIR,
  CAVE_DRAKE,
  makeMHState,
  handCardId, charIdAt, companyIdAt, dispatch,
  viableActions, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, PlanMovementAction, PlayHazardAction } from '../../index.js';
import { SiteType } from '../../index.js';

const EAGLE_MOUNTS = 'tw-220' as CardDefinitionId;
const DOL_GULDUR = 'tw-387' as CardDefinitionId; // Dark-hold
const WOLVES = 'tw-114' as CardDefinitionId; // region-keyed only (border/wilderness)

describe('Eagle-mounts (tw-220)', () => {
  beforeEach(() => resetMint());

  test('playable at the end of the organization phase on a company with a diplomat at Eagles’ Eyrie', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: EAGLES_EYRIE, characters: [ADRAZAR] }], hand: [EAGLE_MOUNTS], siteDeck: [LORIEN] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);
    const adrazarInstance = charIdAt(base, RESOURCE_PLAYER);

    const playActions = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as { cardInstanceId: string; targetScoutInstanceId?: string });
    const eagleMounts = playActions.find(a => a.cardInstanceId === cardInstance);
    expect(eagleMounts).toBeDefined();
    expect(eagleMounts?.targetScoutInstanceId).toBe(adrazarInstance);
  });

  test('not playable when the company has no diplomat', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: EAGLES_EYRIE, characters: [BEREGOND] }], hand: [EAGLE_MOUNTS], siteDeck: [LORIEN] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }], hand: [], siteDeck: [] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);

    const playActions = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as { cardInstanceId: string });
    expect(playActions.some(a => a.cardInstanceId === cardInstance)).toBe(false);
  });

  test('not playable when the company is not at Eagles’ Eyrie', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [ADRAZAR] }], hand: [EAGLE_MOUNTS], siteDeck: [MORIA] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);

    const playActions = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as { cardInstanceId: string });
    expect(playActions.some(a => a.cardInstanceId === cardInstance)).toBe(false);
  });

  test('playing the card grants eagle-mounts special movement to the diplomat’s company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: EAGLES_EYRIE, characters: [ADRAZAR] }], hand: [EAGLE_MOUNTS], siteDeck: [LORIEN] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);
    const adrazarInstance = charIdAt(base, RESOURCE_PLAYER);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetScoutInstanceId: adrazarInstance,
    });

    expect(afterPlay.players[RESOURCE_PLAYER].companies[0].id).toBe(companyId);
    expect(afterPlay.players[RESOURCE_PLAYER].companies[0].specialMovement).toBe('eagle-mounts');
  });

  test('special movement allows plan-movement to a haven (Lórien)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: EAGLES_EYRIE, characters: [ADRAZAR] }], hand: [EAGLE_MOUNTS], siteDeck: [LORIEN] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);
    const adrazarInstance = charIdAt(base, RESOURCE_PLAYER);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetScoutInstanceId: adrazarInstance,
    });

    const moveActions = viableActions(afterPlay, PLAYER_1, 'plan-movement')
      .map(ea => ea.action as PlanMovementAction);
    const moveDefIds = moveActions
      .map(a => afterPlay.players[RESOURCE_PLAYER].siteDeck.find(c => c.instanceId === a.destinationSite)?.definitionId);
    expect(moveDefIds).toContain(LORIEN);
  });

  test('special movement excludes Shadow-hold destinations even outside a Shadow-land region (Moria)', () => {
    // Moria is a Shadow-hold [{S}] site sitting in the Redhorn Gate region,
    // which is a wilderness (not Shadow-land) region — this is exactly the
    // case that distinguishes Eagle-mounts' site-type exclusion from
    // Gwaihir's region-type exclusion (Moria IS reachable via Gwaihir).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: EAGLES_EYRIE, characters: [ADRAZAR] }], hand: [EAGLE_MOUNTS], siteDeck: [MORIA, LORIEN] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);
    const adrazarInstance = charIdAt(base, RESOURCE_PLAYER);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetScoutInstanceId: adrazarInstance,
    });

    const moveActions = viableActions(afterPlay, PLAYER_1, 'plan-movement')
      .map(ea => ea.action as PlanMovementAction);
    const moveDefIds = moveActions
      .map(a => afterPlay.players[RESOURCE_PLAYER].siteDeck.find(c => c.instanceId === a.destinationSite)?.definitionId);
    expect(moveDefIds).toContain(LORIEN);
    expect(moveDefIds).not.toContain(MORIA);
  });

  test('special movement excludes Dark-hold destinations (Dol Guldur)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: EAGLES_EYRIE, characters: [ADRAZAR] }], hand: [EAGLE_MOUNTS], siteDeck: [DOL_GULDUR, LORIEN] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);
    const adrazarInstance = charIdAt(base, RESOURCE_PLAYER);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetScoutInstanceId: adrazarInstance,
    });

    const moveActions = viableActions(afterPlay, PLAYER_1, 'plan-movement')
      .map(ea => ea.action as PlanMovementAction);
    const moveDefIds = moveActions
      .map(a => afterPlay.players[RESOURCE_PLAYER].siteDeck.find(c => c.instanceId === a.destinationSite)?.definitionId);
    expect(moveDefIds).toContain(LORIEN);
    expect(moveDefIds).not.toContain(DOL_GULDUR);
  });

  test('reveal-new-site declares MovementType.Special with no traversed regions', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: EAGLES_EYRIE, characters: [ADRAZAR] }], hand: [EAGLE_MOUNTS], siteDeck: [MOUNT_DOOM, LORIEN] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);
    const adrazarInstance = charIdAt(base, RESOURCE_PLAYER);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetScoutInstanceId: adrazarInstance,
    });

    const moveActions = viableActions(afterPlay, PLAYER_1, 'plan-movement')
      .map(ea => ea.action as PlanMovementAction);
    const lorienMove = moveActions.find(a => afterPlay.players[RESOURCE_PLAYER].siteDeck
      .find(c => c.instanceId === a.destinationSite)?.definitionId === LORIEN);
    expect(lorienMove).toBeDefined();

    const afterMove = dispatch(afterPlay, lorienMove!);

    const revealState = {
      ...afterMove,
      phaseState: makeMHState({ step: 'reveal-new-site', activeCompanyIndex: 0 }),
    };
    const declareActions = viableActions(revealState, PLAYER_1, 'declare-path')
      .map(ea => ea.action as { movementType: string });
    expect(declareActions).toHaveLength(1);
    expect(declareActions[0].movementType).toBe('special');
  });

  test('opponent may only play hazard creatures keyed to the company’s new site — region-only keying is blocked, site-type keying is allowed', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: EAGLES_EYRIE, characters: [ADRAZAR] }], hand: [EAGLE_MOUNTS], siteDeck: [BANDIT_LAIR] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE, WOLVES], siteDeck: [] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);
    const adrazarInstance = charIdAt(base, RESOURCE_PLAYER);
    const targetCompanyId = companyIdAt(base, RESOURCE_PLAYER);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetScoutInstanceId: adrazarInstance,
    });

    // Simulate the M/H phase after special movement declared the company's
    // new site: Bandit Lair (Ruins & Lairs [{R}]), no region path traversed.
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Bandit Lair',
    });
    const stateAtPlayHazards = { ...afterPlay, phaseState: mhState };

    const hazardActions = viableActions(stateAtPlayHazards, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === targetCompanyId);
    const playedDefIds = hazardActions.map(a => a.cardInstanceId)
      .map(instId => stateAtPlayHazards.players[1].hand.find(c => c.instanceId === instId)?.definitionId);

    // Cave-drake is keyed to site type Ruins & Lairs — playable at Bandit Lair.
    expect(playedDefIds).toContain(CAVE_DRAKE);
    // Wolves is keyed only to region types (border/wilderness) — with no
    // region path traversed by special movement, it cannot be played.
    expect(playedDefIds).not.toContain(WOLVES);
  });
});
