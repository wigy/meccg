/**
 * @module le-177.test
 *
 * Card test: Crack in the Wall (le-177)
 * Type: minion-resource-event (short)
 * Effects: 3
 *   1. play-window: organization (playable throughout the org phase)
 *   2. play-target character, DSL filter { sage skill, untapped, company.moving },
 *      cost { tap: character }, requiredSkill sage
 *   3. on-event self-enters-play → add-constraint no-creatures-keyed-to-site,
 *      unlessSiteRegionType:free, scope:turn, target:target-company
 *
 * Text:
 *   "Sage only. Playable during the organization phase on an untapped sage in a
 *    moving company. Tap the sage. Unless the site is in a Free-domain [{f}],
 *    no hazard creatures may be played at the company's new site."
 *
 * This is the minion cousin of Secret Entrance (tw-324), but narrower: only
 * creature plays *keyed to the company's new site* are barred (the play-hazard
 * action's `keyedBy.method` is site-based); the same creature keyed to region
 * terrain in the path survives as its own action. The whole restriction is
 * void when the destination site sits in a Free-domain region (the
 * `unlessSiteRegionType: "free"` gate on the constraint).
 *
 * Engine Support:
 * | # | Rule (card text)                                     | Status      | Mechanism                                              |
 * |---|------------------------------------------------------|-------------|--------------------------------------------------------|
 * | 1 | Playable during the organization phase               | IMPLEMENTED | play-window phase:organization                         |
 * | 2 | on an untapped sage in a moving company (Sage only)  | IMPLEMENTED | play-target filter sage/untapped/company.moving        |
 * | 3 | Tap the sage                                         | IMPLEMENTED | play-target cost { tap: character }                    |
 * | 4 | no hazard creatures may be played at the new site    | IMPLEMENTED | no-creatures-keyed-to-site drops site-keyed plays      |
 * | 5 | (region-keyed creature plays are unaffected)         | IMPLEMENTED | keyedBy.method filter — region-type/name plays survive |
 * | 6 | Unless the site is in a Free-domain [{f}]            | IMPLEMENTED | unlessSiteRegionType:free gate (siteRegionTypeOf)      |
 *
 * Playable: YES
 * Certified: 2026-07-25
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  CAVE_DRAKE,
  makeMHState, mint,
  viableActions, dispatch,
  companyIdAt, charIdAt, findHandCardId,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Alignment, CardStatus, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId, PlayShortEventAction, PlayHazardAction } from '../../index.js';
import { addConstraint, sweepExpired } from '../../engine/pending.js';

const CRACK_IN_THE_WALL = 'le-177' as CardDefinitionId;
// Minion characters: a sage target and a non-sage companion.
const LAYOS = 'le-19' as CardDefinitionId;    // sage, diplomat (man)
const LAGDUF = 'le-18' as CardDefinitionId;   // warrior, orc (no sage skill)
// Hazard creatures.
const HOBGOBLINS = 'le-77' as CardDefinitionId;   // region-only: {w}{w}
const SELLSWORDS = 'le-89' as CardDefinitionId;   // site-only: border-hold / shadow-hold
// CAVE_DRAKE (tw-020) keys both ways: {w}{w} regions AND Ruins & Lairs site.
// Minion sites.
const DOL_GULDUR = 'le-367' as CardDefinitionId;      // haven (origin)
const ETTENMOORS = 'le-373' as CardDefinitionId;      // ruins-and-lairs in Rhudaur (wilderness region)
const DRUADAN_FOREST = 'le-368' as CardDefinitionId;  // border-hold in Anórien (FREE region)
const MINAS_MORGUL = 'le-390' as CardDefinitionId;    // haven (site-deck filler)

/**
 * Org-phase state with a Ringwraith active player. The single company (a sage
 * and a non-sage) sits at a haven and, when `dest` is given, has declared
 * movement there (making it a "moving company"). The Wizard opponent holds
 * the creatures.
 */
function orgState(dest?: CardDefinitionId) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: [LAYOS, LAGDUF], ...(dest ? { destinationSite: dest } : {}) }],
        hand: [CRACK_IN_THE_WALL],
        siteDeck: [MINAS_MORGUL],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }],
        hand: [HOBGOBLINS, CAVE_DRAKE, SELLSWORDS],
        siteDeck: [MINAS_MORGUL],
      },
    ],
  });
}

/** M/H phase state for the active moving company reaching a given destination. */
function mhAt(destinationSiteType: SiteType, destinationSiteName: string, sitePath: RegionType[]) {
  return makeMHState({
    activeCompanyIndex: 0,
    resolvedSitePath: sitePath,
    resolvedSitePathNames: sitePath.map(() => 'Hithaeglir'),
    destinationSiteType,
    destinationSiteName,
  });
}

/** The le-177 constraint payload, as the reducer creates it. */
function crackConstraint(companyId: ReturnType<typeof companyIdAt>) {
  return {
    source: mint(),
    sourceDefinitionId: CRACK_IN_THE_WALL,
    scope: { kind: 'turn' as const },
    target: { kind: 'company' as const, companyId },
    kind: { type: 'no-creatures-keyed-to-site' as const, unlessSiteRegionType: RegionType.Free },
  };
}

describe('Crack in the Wall (le-177)', () => {
  beforeEach(() => resetMint());

  test('playable during the organization phase on the untapped sage of a moving company', () => {
    const base = orgState(ETTENMOORS);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, CRACK_IN_THE_WALL);
    const sageId = charIdAt(base, RESOURCE_PLAYER, 0, 0);

    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);

    // Exactly one action — targeting the sage, never the non-sage warrior.
    expect(plays).toHaveLength(1);
    expect(plays[0].targetScoutInstanceId).toBe(sageId);
  });

  test('not playable on a non-moving company (no declared destination)', () => {
    const base = orgState(); // no destinationSite → company is not moving
    const cardId = findHandCardId(base, RESOURCE_PLAYER, CRACK_IN_THE_WALL);

    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('not playable when the sage is tapped', () => {
    const base = orgState(ETTENMOORS);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, CRACK_IN_THE_WALL);
    const sageId = charIdAt(base, RESOURCE_PLAYER, 0, 0);
    const sage = base.players[0].characters[sageId];
    const tapped = {
      ...base,
      players: [
        {
          ...base.players[0],
          characters: { ...base.players[0].characters, [sageId]: { ...sage, status: CardStatus.Tapped } },
        },
        base.players[1],
      ] as typeof base.players,
    };

    const plays = viableActions(tapped, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('playing it taps the sage and adds the free-domain-gated constraint (turn scope)', () => {
    const base = orgState(ETTENMOORS);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, CRACK_IN_THE_WALL);
    const sageId = charIdAt(base, RESOURCE_PLAYER, 0, 0);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const next = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetScoutInstanceId: sageId,
    });

    // Tap the sage.
    expect(next.players[0].characters[sageId].status).toBe(CardStatus.Tapped);

    // Constraint: no creatures keyed to the new site, gated on Free-domain.
    expect(next.activeConstraints).toHaveLength(1);
    const constraint = next.activeConstraints[0];
    expect(constraint.kind).toEqual({ type: 'no-creatures-keyed-to-site', unlessSiteRegionType: RegionType.Free });
    expect(constraint.scope.kind).toBe('turn');
    expect(constraint.target).toEqual({ kind: 'company', companyId });
  });

  test('site-keyed creature plays at the new site are blocked; region-keyed plays survive', () => {
    const base = orgState(ETTENMOORS);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    // Ettenmoors is a Ruins & Lairs in Rhudaur (a Wilderness region — the
    // Free-domain exemption does NOT apply). Path has two wildernesses.
    const atRuins = { ...base, phaseState: mhAt(SiteType.RuinsAndLairs, 'Ettenmoors', [RegionType.Wilderness, RegionType.Wilderness]) };
    const hobId = findHandCardId(atRuins, HAZARD_PLAYER, HOBGOBLINS);
    const drakeId = findHandCardId(atRuins, HAZARD_PLAYER, CAVE_DRAKE);

    // Baseline: Cave-drake is offered both region-keyed and site-keyed;
    // Hobgoblins region-keyed.
    const before = viableActions(atRuins, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === companyId);
    const drakeMethodsBefore = new Set(before.filter(a => a.cardInstanceId === drakeId).map(a => a.keyedBy?.method));
    expect(drakeMethodsBefore.has('site-type')).toBe(true);
    expect(drakeMethodsBefore.has('region-type')).toBe(true);
    expect(before.some(a => a.cardInstanceId === hobId)).toBe(true);

    // With the constraint: the Cave-drake's site-keyed play is dropped, its
    // region-keyed play survives, and the region-only Hobgoblins is untouched.
    const constrained = addConstraint(atRuins, crackConstraint(companyId));
    const after = viableActions(constrained, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === companyId);
    const drakeMethodsAfter = new Set(after.filter(a => a.cardInstanceId === drakeId).map(a => a.keyedBy?.method));
    expect(drakeMethodsAfter.has('site-type')).toBe(false);
    expect(drakeMethodsAfter.has('region-type')).toBe(true);
    expect(after.some(a => a.cardInstanceId === hobId)).toBe(true);
  });

  test('destination in a Free-domain: the restriction does not apply', () => {
    // Drúadan Forest is a Border-hold in Anórien, a Free-domain region.
    const base = orgState(DRUADAN_FOREST);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const atDruadan = { ...base, phaseState: mhAt(SiteType.BorderHold, 'Drúadan Forest', [RegionType.Shadow, RegionType.Wilderness, RegionType.Free]) };
    const sellswordsId = findHandCardId(atDruadan, HAZARD_PLAYER, SELLSWORDS);

    // Baseline: Sellswords Between Charters site-keys to the Border-hold.
    const before = viableActions(atDruadan, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === companyId && a.cardInstanceId === sellswordsId);
    expect(before.length).toBeGreaterThan(0);
    expect(before[0].keyedBy?.method).toBe('site-type');

    // With the constraint: the site sits in a Free-domain, so even the
    // site-keyed play is still allowed ("Unless the site is in a Free-domain").
    const constrained = addConstraint(atDruadan, crackConstraint(companyId));
    const after = viableActions(constrained, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === companyId && a.cardInstanceId === sellswordsId);
    expect(after.length).toBeGreaterThan(0);
  });

  test('the constraint clears at turn-end (scope: turn)', () => {
    const base = orgState(ETTENMOORS);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, CRACK_IN_THE_WALL);
    const sageId = charIdAt(base, RESOURCE_PLAYER, 0, 0);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetScoutInstanceId: sageId,
    });
    expect(afterPlay.activeConstraints).toHaveLength(1);

    const swept = sweepExpired(afterPlay, { kind: 'turn-end' });
    expect(swept.activeConstraints).toHaveLength(0);
  });
});
