/**
 * @module dm-115.test
 *
 * Card test: Ancient Stair (dm-115)
 * Type: hero-resource-event (short)
 * Effects:
 *   1. play-window: end-of-org (organization phase, end-of-org step)
 *   2. play-target: company, filter company.atUnderDeepsSurfaceSite === true
 *      AND company.siteUntapped === true (only playable on a company that
 *      starts its turn at an untapped adjacent site of an Under-deeps site —
 *      e.g. Glittering Caves tw-397, the roll-0 surface entrance of The
 *      Gem-deeps dm-30)
 *   3. Opponent may draw up to twice the normal number of cards for this
 *      company during the movement/hazard phase (hazard-draw-multiplier)
 *   4. If the company moved to an Under-deeps site, at the end of the turn
 *      the company may replace its site card with the site card at which it
 *      began the turn (haven-return-option, requiresMovedToKeyword: "under-deeps")
 *
 * Engine Support:
 * | # | Feature                                          | Status      | Notes                                             |
 * |---|---------------------------------------------------|-------------|----------------------------------------------------|
 * | 1 | Play window = end of organization                 | IMPLEMENTED | play-window phase:organization step:end-of-org     |
 * | 2 | Restrict to untapped Under-deeps-adjacent site     | IMPLEMENTED | play-target company filter, isUnderDeepsSurfaceSite |
 * | 3 | Opponent draws up to twice normal during M/H       | IMPLEMENTED | hazard-draw-multiplier constraint on company-mh-phase |
 * | 4 | Company may return to origin site at EOT if it     | IMPLEMENTED | haven-return-option constraint (requiresMovedToKeyword) |
 * |   | moved to an Under-deeps site                       |             | + haven-return action, gated in havenReturnActions  |
 *
 * CERTIFIED
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL,
  handCardId,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type {
  CardDefinitionId,
  CardInstanceId,
  PlayShortEventAction,
  HavenReturnAction,
} from '../../index.js';
import { CardStatus } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { reduce } from '../../engine/reducer.js';

const ANCIENT_STAIR = 'dm-115' as CardDefinitionId;
// Glittering Caves (tw-397): the roll-0 surface entrance listed in The
// Gem-deeps' (dm-30) `adjacentSites` map.
const GLITTERING_CAVES = 'tw-397' as CardDefinitionId;
const GEM_DEEPS = 'dm-30' as CardDefinitionId;

describe('Ancient Stair (dm-115)', () => {
  beforeEach(() => resetMint());

  test('Ancient Stair is playable at end-of-org on a company at an untapped Under-deeps-adjacent site', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: GLITTERING_CAVES, characters: [ARAGORN] }], hand: [ANCIENT_STAIR], siteDeck: [GEM_DEEPS] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [GEM_DEEPS] },
      ],
    });

    const stairInstance = handCardId(base, RESOURCE_PLAYER);
    const playActions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === stairInstance);

    expect(playActions.length).toBeGreaterThan(0);
    expect(playActions[0].targetCompanyId).toBeDefined();
  });

  test('Ancient Stair is NOT playable when the site is not adjacent to an Under-deeps site', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [ANCIENT_STAIR], siteDeck: [GEM_DEEPS] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [GEM_DEEPS] },
      ],
    });

    const stairInstance = handCardId(base, RESOURCE_PLAYER);
    const allActions = computeLegalActions(base, PLAYER_1);

    const viable = allActions.filter(ea =>
      ea.viable && ea.action.type === 'play-short-event' && (ea.action).cardInstanceId === stairInstance,
    );
    const notPlayable = allActions.filter(ea =>
      !ea.viable && ea.action.type === 'not-playable' && ea.action.cardInstanceId === stairInstance,
    );

    expect(viable.length).toBe(0);
    expect(notPlayable.length).toBeGreaterThan(0);
  });

  test('Ancient Stair is NOT playable when the Under-deeps-adjacent site is tapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: GLITTERING_CAVES, characters: [ARAGORN] }], hand: [ANCIENT_STAIR], siteDeck: [GEM_DEEPS] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [GEM_DEEPS] },
      ],
    });
    const tapped = {
      ...base,
      players: base.players.map((p, i) => i !== 0 ? p : {
        ...p,
        companies: p.companies.map((c, ci) => ci === 0
          ? { ...c, currentSite: { ...c.currentSite!, status: CardStatus.Tapped } }
          : c),
      }) as unknown as typeof base.players,
    };

    const stairInstance = handCardId(tapped, RESOURCE_PLAYER);
    const allActions = computeLegalActions(tapped, PLAYER_1);

    const viable = allActions.filter(ea =>
      ea.viable && ea.action.type === 'play-short-event' && (ea.action).cardInstanceId === stairInstance,
    );
    const notPlayable = allActions.filter(ea =>
      !ea.viable && ea.action.type === 'not-playable' && ea.action.cardInstanceId === stairInstance,
    );

    expect(viable.length).toBe(0);
    expect(notPlayable.length).toBeGreaterThan(0);
  });

  test('Playing Ancient Stair adds hazard-draw-multiplier constraint (×2) on the target company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: GLITTERING_CAVES, characters: [ARAGORN] }], hand: [ANCIENT_STAIR], siteDeck: [GEM_DEEPS] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [GEM_DEEPS] },
      ],
    });

    const stairInstance = handCardId(base, RESOURCE_PLAYER);
    const companyId = base.players[0].companies[0].id;

    const { state: after } = reduce(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: stairInstance,
      targetCompanyId: companyId,
    } as PlayShortEventAction);

    const c = after.activeConstraints.find(c => c.kind.type === 'hazard-draw-multiplier');
    expect(c).toBeDefined();
    expect(c!.kind.type === 'hazard-draw-multiplier' && c!.kind.multiplier).toBe(2);
  });

  test('Playing Ancient Stair records origin site + requiresMovedToKeyword("under-deeps") in haven-return-option constraint', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: GLITTERING_CAVES, characters: [ARAGORN] }], hand: [ANCIENT_STAIR], siteDeck: [GEM_DEEPS] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [GEM_DEEPS] },
      ],
    });

    const stairInstance = handCardId(base, RESOURCE_PLAYER);
    const companyId = base.players[0].companies[0].id;
    const originSite = base.players[0].companies[0].currentSite!;

    const { state: after } = reduce(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: stairInstance,
      targetCompanyId: companyId,
    } as PlayShortEventAction);

    const c = after.activeConstraints.find(c => c.kind.type === 'haven-return-option');
    expect(c).toBeDefined();
    if (c && c.kind.type === 'haven-return-option') {
      expect(c.kind.originHavenInstanceId).toBe(originSite.instanceId);
      expect(c.kind.originHavenDefinitionId).toBe(originSite.definitionId);
      expect(c.kind.requiresMovedToKeyword).toBe('under-deeps');
    }
  });

  test('haven-return is NOT offered at end of turn when the company did not move to an Under-deeps site', () => {
    const org = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: GLITTERING_CAVES, characters: [ARAGORN] }], hand: [ANCIENT_STAIR], siteDeck: [GEM_DEEPS] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [GEM_DEEPS] },
      ],
    });
    const { state: afterPlay } = reduce(org, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: handCardId(org, RESOURCE_PLAYER),
      targetCompanyId: org.players[0].companies[0].id,
    } as PlayShortEventAction);

    // Company stayed at Glittering Caves (a surface site, not Under-deeps) all turn.
    const eot = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: GLITTERING_CAVES, characters: [ARAGORN] }], hand: [], siteDeck: [GEM_DEEPS] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [GEM_DEEPS] },
      ],
    });
    const eotWithConstraints = { ...eot, activeConstraints: afterPlay.activeConstraints };

    const actions = computeLegalActions(eotWithConstraints, PLAYER_1);
    const havenReturnActions = actions.filter(ea => ea.viable && ea.action.type === 'haven-return');
    expect(havenReturnActions.length).toBe(0);
  });

  test('haven-return IS offered at end of turn when the company moved to an Under-deeps site', () => {
    const org = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: GLITTERING_CAVES, characters: [ARAGORN] }], hand: [ANCIENT_STAIR], siteDeck: [GEM_DEEPS] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [GEM_DEEPS] },
      ],
    });
    const { state: afterPlay } = reduce(org, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: handCardId(org, RESOURCE_PLAYER),
      targetCompanyId: org.players[0].companies[0].id,
    } as PlayShortEventAction);

    // Company descended to The Gem-deeps (an Under-deeps site) during its M/H phase.
    const eot = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: GEM_DEEPS, characters: [ARAGORN] }], hand: [], siteDeck: [GLITTERING_CAVES] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [GLITTERING_CAVES] },
      ],
    });
    const eotWithConstraints = { ...eot, activeConstraints: afterPlay.activeConstraints };

    const actions = computeLegalActions(eotWithConstraints, PLAYER_1);
    const havenReturnActions = actions.filter(ea => ea.viable && ea.action.type === 'haven-return');
    expect(havenReturnActions.length).toBe(1);
  });

  test('haven-return replaces company currentSite with the origin surface site and consumes the constraint', () => {
    const org = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: GLITTERING_CAVES, characters: [ARAGORN] }], hand: [ANCIENT_STAIR], siteDeck: [GEM_DEEPS] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [GEM_DEEPS] },
      ],
    });
    const { state: afterPlay } = reduce(org, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: handCardId(org, RESOURCE_PLAYER),
      targetCompanyId: org.players[0].companies[0].id,
    } as PlayShortEventAction);

    const eot = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: GEM_DEEPS, characters: [ARAGORN] }], hand: [], siteDeck: [GLITTERING_CAVES] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [GLITTERING_CAVES] },
      ],
    });
    // Align the site deck's Glittering Caves instance with the origin site captured
    // in the constraint, mirroring the real invariant that the origin's instance
    // returned to the deck when the company descended into the Gem-deeps.
    const originInstId = (afterPlay.activeConstraints.find(
      c => c.kind.type === 'haven-return-option',
    )!.kind as { originHavenInstanceId: CardInstanceId }).originHavenInstanceId;
    const gemDeepsInstId = eot.players[0].companies[0].currentSite!.instanceId;
    const eotWithConstraints = {
      ...eot,
      activeConstraints: afterPlay.activeConstraints,
      players: eot.players.map((p, i) => i !== 0 ? p : {
        ...p,
        siteDeck: p.siteDeck.map(c =>
          c.definitionId === GLITTERING_CAVES ? { ...c, instanceId: originInstId } : c,
        ),
      }) as unknown as typeof eot.players,
    };

    const companyId = eotWithConstraints.players[0].companies[0].id;
    const { state: afterReturn } = reduce(eotWithConstraints, {
      type: 'haven-return',
      player: PLAYER_1,
      companyId,
    } as HavenReturnAction);

    // Company is now back at Glittering Caves (the origin surface site).
    expect(afterReturn.players[0].companies[0].currentSite?.definitionId).toBe(GLITTERING_CAVES);
    expect(afterReturn.players[0].companies[0].siteCardOwned).toBe(true);
    // Glittering Caves removed from the site deck (it became the current site).
    expect(afterReturn.players[0].siteDeck.some(c => c.instanceId === originInstId)).toBe(false);
    // The Gem-deeps (untapped departure site) returned to the site deck.
    expect(afterReturn.players[0].siteDeck.some(c => c.instanceId === gemDeepsInstId)).toBe(true);
    // Constraint is consumed.
    expect(afterReturn.activeConstraints.find(c => c.kind.type === 'haven-return-option')).toBeUndefined();
  });
});
