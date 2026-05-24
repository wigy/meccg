/**
 * @module tw-414.test
 *
 * Card test: Mount Doom (tw-414)
 * Type: hero-site (shadow-hold) in Gorgoroth
 * Nearest Haven: Lórien
 * Playable: (none)
 * Automatic-attacks: (none)
 * Effects:
 *   1. site-rule hazard-limit-modifier +2 (for moving companies)
 *   2. site-rule creatures-always-keyed-to-site (bypass no-creature-hazards-on-company for site-keyed creatures)
 *
 * Text:
 *   "Any company moving to this site has its hazard limit increased by 2
 *    and hazard creatures may always be played keyed to the site regardless
 *    of any other cards played."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                               |
 * |---|-------------------|--------|---------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "shadow-hold" — valid                                               |
 * | 2 | sitePath          | OK     | [wilderness, border, free, wilderness, shadow, dark] from Lórien    |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                                 |
 * | 4 | region            | OK     | "Gorgoroth" — valid region in card pool                             |
 * | 5 | playableResources | OK     | [] — no items playable here                                         |
 * | 6 | automaticAttacks  | OK     | [] — no automatic attacks                                           |
 * | 7 | resourceDraws     | OK     | 3                                                                   |
 * | 8 | hazardDraws       | OK     | 6                                                                   |
 *
 * Engine Support:
 * | # | Feature                                | Status      | Notes                                                                   |
 * |---|----------------------------------------|-------------|-------------------------------------------------------------------------|
 * | 1 | Site phase flow                        | IMPLEMENTED | select-company, enter-or-skip, play-resources                           |
 * | 2 | Haven path movement                    | IMPLEMENTED | Lórien → Mount Doom via starter movement                                |
 * | 3 | Card draws                             | IMPLEMENTED | resourceDraws / hazardDraws thread through M/H phase                    |
 * | 4 | Hazard-limit modifier (+2)             | IMPLEMENTED | site-rule applied during set-hazard-limit for moving companies          |
 * | 5 | creatures-always-keyed-to-site bypass  | IMPLEMENTED | site-keyed creatures bypass no-creature-hazards-on-company constraint   |
 *
 * Playable: YES
 * Certified: 2026-05-10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, FARAMIR,
  RIVENDELL, LORIEN, MINAS_TIRITH, MOUNT_DOOM,
  BARROW_WIGHT, TOM_TUMA, STEALTH,
  resetMint, mint, pool,
  buildTestState, makeMHState,
  dispatch,
  viableActions,
  companyIdAt,
  RESOURCE_PLAYER,
  CardStatus,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites, Phase, SiteType, RegionType,
} from '../../index.js';
import type { SiteCard, MovementHazardPhaseState, PlayHazardAction } from '../../index.js';
import { addConstraint } from '../../engine/pending.js';

describe('Mount Doom (tw-414)', () => {
  beforeEach(() => resetMint());

  // ─── Site path: reachable from nearest haven Lórien ─────────────────────────

  test('Lórien starter movement reaches Mount Doom', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (MOUNT_DOOM as string),
    );

    expect(entry).toBeDefined();
  });

  test('Rivendell starter movement does NOT reach Mount Doom', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (MOUNT_DOOM as string),
    );

    expect(entry).toBeUndefined();
  });

  // ─── Hazard-limit modifier: +2 for moving companies ─────────────────────────

  test('single character moving to Mount Doom: hazard limit is 2 + 2 = 4', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [FARAMIR] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const destInstId = mint();
    const company = {
      ...base.players[RESOURCE_PLAYER].companies[0],
      destinationSite: { instanceId: destInstId, definitionId: MOUNT_DOOM, status: CardStatus.Untapped },
    };
    const players = [
      { ...base.players[RESOURCE_PLAYER], companies: [company] },
      base.players[1],
    ] as typeof base.players;

    const state = { ...base, players, phaseState: makeMHState({ step: 'set-hazard-limit' }) };
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const result = next.phaseState as MovementHazardPhaseState;

    expect(result.step).toBe('order-effects');
    expect(result.hazardLimitAtReveal).toBe(4); // 2 (base) + 2 (site-rule)
  });

  test('three characters moving to Mount Doom: hazard limit is 3 + 2 = 5', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [ARAGORN, LEGOLAS, GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [FARAMIR] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const destInstId = mint();
    const company = {
      ...base.players[RESOURCE_PLAYER].companies[0],
      destinationSite: { instanceId: destInstId, definitionId: MOUNT_DOOM, status: CardStatus.Untapped },
    };
    const players = [
      { ...base.players[RESOURCE_PLAYER], companies: [company] },
      base.players[1],
    ] as typeof base.players;

    const state = { ...base, players, phaseState: makeMHState({ step: 'set-hazard-limit' }) };
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const result = next.phaseState as MovementHazardPhaseState;

    expect(result.hazardLimitAtReveal).toBe(5); // 3 (base) + 2 (site-rule)
  });

  test('non-moving company at Mount Doom: hazard limit is NOT increased', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MOUNT_DOOM, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [FARAMIR] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const state = { ...base, phaseState: makeMHState({ step: 'set-hazard-limit' }) };
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const result = next.phaseState as MovementHazardPhaseState;

    // base = max(1, 2) = 2; no site-rule bonus for non-moving company
    expect(result.hazardLimitAtReveal).toBe(2);
  });

  // ─── creatures-always-keyed-to-site: site-keyed creatures bypass no-creature-hazards ─

  test('shadow-hold keyed creature bypasses no-creature-hazards-on-company at Mount Doom', () => {
    // Barrow-wight (tw-015) is keyed to shadow-hold; moving to Mount Doom
    // (shadow-hold site) with the creatures-always-keyed-to-site rule means it
    // can bypass a no-creature-hazards-on-company constraint (e.g. from Stealth).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [FARAMIR] }], hand: [BARROW_WIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const destInstId = mint();
    const company = {
      ...base.players[RESOURCE_PLAYER].companies[0],
      destinationSite: { instanceId: destInstId, definitionId: MOUNT_DOOM, status: CardStatus.Untapped },
    };
    const players = [
      { ...base.players[RESOURCE_PLAYER], companies: [company] },
      base.players[1],
    ] as typeof base.players;

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness, RegionType.Border, RegionType.Free, RegionType.Wilderness, RegionType.Shadow, RegionType.Dark],
      resolvedSitePathNames: ['Gorgoroth', 'Noman-lands', 'Anórien', 'Brown Lands', 'Nurn', 'Gorgoroth'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Mount Doom',
    });

    const stateWithDest = { ...base, players, phaseState: mhState };
    const targetCompanyId = companyIdAt(stateWithDest, RESOURCE_PLAYER);

    // Without constraint: Barrow-wight is viable against the company.
    const withoutConstraint = viableActions(stateWithDest, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === targetCompanyId);
    expect(withoutConstraint.length).toBeGreaterThan(0);

    // Add no-creature-hazards-on-company constraint.
    const stealthInst = mint();
    const constrained = addConstraint(stateWithDest, {
      source: stealthInst,
      sourceDefinitionId: STEALTH,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId: targetCompanyId },
      kind: { type: 'no-creature-hazards-on-company' },
    });

    // After the constraint, Barrow-wight is still viable because Mount Doom's
    // creatures-always-keyed-to-site rule bypasses the restriction for
    // site-type-keyed creatures.
    const afterConstraint = viableActions(constrained, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === targetCompanyId);
    expect(afterConstraint.length).toBeGreaterThan(0);
  });

  test('region-keyed-only creature is still blocked by no-creature-hazards-on-company at Mount Doom', () => {
    // "Tom" (tw-103) is keyed only to two wildernesses (region type); it has no
    // siteTypes entry. Mount Doom's path contains two wildernesses, so Tom is
    // normally keyable by region type. However, Tom does NOT carry a shadow-hold
    // site-type keying, so the creatures-always-keyed-to-site bypass does NOT
    // apply. The no-creature-hazards-on-company constraint still blocks Tom.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [FARAMIR] }], hand: [TOM_TUMA], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const destInstId = mint();
    const company = {
      ...base.players[RESOURCE_PLAYER].companies[0],
      destinationSite: { instanceId: destInstId, definitionId: MOUNT_DOOM, status: CardStatus.Untapped },
    };
    const players = [
      { ...base.players[RESOURCE_PLAYER], companies: [company] },
      base.players[1],
    ] as typeof base.players;

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness, RegionType.Border, RegionType.Free, RegionType.Wilderness, RegionType.Shadow, RegionType.Dark],
      resolvedSitePathNames: ['Gorgoroth', 'Noman-lands', 'Anórien', 'Brown Lands', 'Nurn', 'Gorgoroth'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Mount Doom',
    });

    const stateWithDest = { ...base, players, phaseState: mhState };
    const targetCompanyId = companyIdAt(stateWithDest, RESOURCE_PLAYER);

    // Without constraint: Tom is viable (keyed by two wildernesses in path).
    const withoutConstraint = viableActions(stateWithDest, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === targetCompanyId);
    expect(withoutConstraint.length).toBeGreaterThan(0);

    // Add no-creature-hazards-on-company constraint.
    const stealthInst = mint();
    const constrained = addConstraint(stateWithDest, {
      source: stealthInst,
      sourceDefinitionId: STEALTH,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId: targetCompanyId },
      kind: { type: 'no-creature-hazards-on-company' },
    });

    // After the constraint, Tom is NOT viable — no site-type keying means no bypass.
    const afterConstraint = viableActions(constrained, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === targetCompanyId);
    expect(afterConstraint.length).toBe(0);
  });
});
