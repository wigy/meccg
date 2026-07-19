/**
 * @module le-181.test
 *
 * Card test: Down Down to Goblin-town (le-181)
 * Type: minion-resource-event (short)
 * Effects: 3
 *   1. play-window: organization, step end-of-org (playable throughout the org
 *      phase — end-of-org cards do not lock the phase, CoE 2.II.7)
 *   2. play-target company, DSL filter { company.moving: true }
 *   3. on-event self-enters-play → add-constraint
 *      only-creatures-keyed-to-site-at-ruins-lairs, scope:turn,
 *      target:target-company
 *
 * Text:
 *   "Playable during the organization phase on a moving company. If the company
 *    moves to a Ruins & Lairs [{R}], no hazard creatures may be played (by type
 *    or name) keyed to regions against his company."
 *
 * This is the minion twin of Secret Passage (tw-325). Unlike Secret Passage's
 * ungated `only-creatures-keyed-to-site` constraint (which drops region-keyed
 * creatures at any destination — enshrined by the dm-98 test), le-181 uses the
 * R&L-gated variant: the restriction only bites when the protected company
 * actually moves to a Ruins & Lairs. Region-keyed creatures ("by type or name")
 * are dropped there; creatures keyed to the R&L site survive. When the company
 * moves anywhere else the card is inert.
 *
 * Engine Support:
 * | # | Rule (card text)                                     | Status      | Mechanism                                             |
 * |---|------------------------------------------------------|-------------|-------------------------------------------------------|
 * | 1 | Playable during the organization phase               | IMPLEMENTED | play-window phase:organization                        |
 * | 2 | on a moving company                                  | IMPLEMENTED | play-target company filter { company.moving: true }   |
 * | 3 | If company moves to a Ruins & Lairs: region-keyed    | IMPLEMENTED | only-creatures-keyed-to-site-at-ruins-lairs (R&L gate)|
 * |   |   creatures may not be played against it             |             |                                                       |
 * | 4 | (site-keyed creatures survive)                       | IMPLEMENTED | isCreatureKeyedToDestinationSite allow-list           |
 * | 5 | (inert when moving to a non-R&L site)                | IMPLEMENTED | R&L gate returns base at any other destination        |
 * | 6 | "his company" — one company only, cross-player       | IMPLEMENTED | constraint target scoped to the played-on company     |
 *
 * Playable: YES
 * Certified: 2026-07-12
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  CAVE_DRAKE,
  makeMHState, mint,
  viableActions, dispatch,
  companyIdAt, findHandCardId,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Alignment, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId, PlayShortEventAction, PlayHazardAction } from '../../index.js';
import { addConstraint, sweepExpired } from '../../engine/pending.js';

const DOWN_DOWN = 'le-181' as CardDefinitionId;
// Minion characters (company-target — any character qualifies).
const LAGDUF = 'le-18' as CardDefinitionId;   // warrior, orc
// Region-only keyed creature ({w}{w}) — NOT keyed to any site.
const HOBGOBLINS = 'le-77' as CardDefinitionId;
// CAVE_DRAKE (tw-020) keys to Ruins & Lairs by site-type (also {w}{w}).
// Minion sites.
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // haven (origin)
const ETTENMOORS = 'le-373' as CardDefinitionId;   // ruins-and-lairs (destination)
const BARAD_DUR = 'le-352' as CardDefinitionId;    // dark-hold (non-R&L destination)
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // haven (site-deck filler)

/**
 * Org-phase state with a Ringwraith active player. The single company sits at a
 * haven and, when `dest` is given, is declared as moving to that destination
 * (making it a "moving company"). The Wizard opponent holds the creatures.
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
        companies: [{ site: DOL_GULDUR, characters: [LAGDUF], ...(dest ? { destinationSite: dest } : {}) }],
        hand: [DOWN_DOWN],
        siteDeck: [MINAS_MORGUL],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }],
        hand: [HOBGOBLINS, CAVE_DRAKE],
        siteDeck: [MINAS_MORGUL],
      },
    ],
  });
}

/** M/H phase state for the active moving company reaching a given destination. */
function mhAt(destinationSiteType: SiteType, destinationSiteName: string, activeCompanyIndex = 0) {
  return makeMHState({
    activeCompanyIndex,
    // Two wildernesses so Hobgoblins ({w}{w}) is keyable via terrain.
    resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
    resolvedSitePathNames: ['Hithaeglir', 'Hithaeglir'],
    destinationSiteType,
    destinationSiteName,
  });
}

describe('Down Down to Goblin-town (le-181)', () => {
  beforeEach(() => resetMint());

  test('playable during the organization phase on a moving company', () => {
    const base = orgState(ETTENMOORS);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, DOWN_DOWN);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);

    // One company-target play action for the moving company.
    expect(plays).toHaveLength(1);
    expect(plays[0].targetCompanyId).toBe(companyId);
  });

  test('not playable on a non-moving company (no declared destination)', () => {
    const base = orgState(); // no destinationSite → company is not moving
    const cardId = findHandCardId(base, RESOURCE_PLAYER, DOWN_DOWN);

    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('playing it adds the R&L-gated constraint to the moving company (turn scope)', () => {
    const base = orgState(ETTENMOORS);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, DOWN_DOWN);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const next = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetCompanyId: companyId,
    });

    expect(next.activeConstraints).toHaveLength(1);
    const constraint = next.activeConstraints[0];
    expect(constraint.kind.type).toBe('only-creatures-keyed-to-site-at-ruins-lairs');
    expect(constraint.scope.kind).toBe('turn');
    expect(constraint.target).toEqual({ kind: 'company', companyId });
  });

  test('moving to a Ruins & Lairs: region-keyed creatures are blocked, site-keyed creatures survive', () => {
    const base = orgState(ETTENMOORS);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const atRuins = { ...base, phaseState: mhAt(SiteType.RuinsAndLairs, 'Ettenmoors') };

    // Baseline: both creatures are playable against the company at the R&L —
    // Hobgoblins via {w}{w} terrain, Cave-drake via the R&L site.
    const before = viableActions(atRuins, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === companyId);
    const beforeIds = new Set(before.map(a => a.cardInstanceId));
    const hobId = findHandCardId(atRuins, HAZARD_PLAYER, HOBGOBLINS);
    const drakeId = findHandCardId(atRuins, HAZARD_PLAYER, CAVE_DRAKE);
    expect(beforeIds.has(hobId)).toBe(true);
    expect(beforeIds.has(drakeId)).toBe(true);

    // With the constraint: the region-keyed Hobgoblins is dropped, but the
    // R&L-site-keyed Cave-drake survives.
    const constrained = addConstraint(atRuins, {
      source: mint(),
      sourceDefinitionId: DOWN_DOWN,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: { type: 'only-creatures-keyed-to-site-at-ruins-lairs' },
    });
    const after = viableActions(constrained, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === companyId);
    const afterIds = new Set(after.map(a => a.cardInstanceId));
    expect(afterIds.has(hobId)).toBe(false);
    expect(afterIds.has(drakeId)).toBe(true);
  });

  test('moving to a non-Ruins & Lairs site: the card is inert and region-keyed creatures are still allowed', () => {
    const base = orgState(BARAD_DUR);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const atDarkHold = { ...base, phaseState: mhAt(SiteType.DarkHold, 'Barad-dûr') };
    const hobId = findHandCardId(atDarkHold, HAZARD_PLAYER, HOBGOBLINS);

    // Baseline: Hobgoblins is playable via {w}{w} terrain at the dark-hold.
    const before = viableActions(atDarkHold, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === companyId && a.cardInstanceId === hobId);
    expect(before.length).toBeGreaterThan(0);

    // With the constraint present but the destination NOT a Ruins & Lairs, the
    // card imposes nothing — Hobgoblins is still allowed. (This is the point of
    // difference from Secret Passage's ungated only-creatures-keyed-to-site.)
    const constrained = addConstraint(atDarkHold, {
      source: mint(),
      sourceDefinitionId: DOWN_DOWN,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: { type: 'only-creatures-keyed-to-site-at-ruins-lairs' },
    });
    const after = viableActions(constrained, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === companyId && a.cardInstanceId === hobId);
    expect(after.length).toBeGreaterThan(0);
  });

  test('only the played-on company is protected, not another company at a R&L', () => {
    // Two moving companies; the constraint targets only the first. A region-keyed
    // creature against the *other* company at a R&L is unaffected.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: DOL_GULDUR, characters: [LAGDUF], destinationSite: ETTENMOORS },
            { site: DOL_GULDUR, characters: [LAGDUF], destinationSite: ETTENMOORS },
          ],
          hand: [DOWN_DOWN],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }],
          hand: [HOBGOBLINS],
          siteDeck: [MINAS_MORGUL],
        },
      ],
    });
    const protectedCompanyId = companyIdAt(base, RESOURCE_PLAYER, 0);
    const otherCompanyId = companyIdAt(base, RESOURCE_PLAYER, 1);
    const hobId = findHandCardId(base, HAZARD_PLAYER, HOBGOBLINS);

    const constrained = addConstraint(base, {
      source: mint(),
      sourceDefinitionId: DOWN_DOWN,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId: protectedCompanyId },
      kind: { type: 'only-creatures-keyed-to-site-at-ruins-lairs' },
    });

    // Protected company at the R&L → Hobgoblins dropped.
    const protectedMH = { ...constrained, phaseState: mhAt(SiteType.RuinsAndLairs, 'Ettenmoors') };
    const protectedPlays = viableActions(protectedMH, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === protectedCompanyId && a.cardInstanceId === hobId);
    expect(protectedPlays).toHaveLength(0);

    // Unprotected company (index 1) at the R&L → Hobgoblins still allowed.
    const otherMH = { ...constrained, phaseState: mhAt(SiteType.RuinsAndLairs, 'Ettenmoors', 1) };
    const otherPlays = viableActions(otherMH, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === otherCompanyId && a.cardInstanceId === hobId);
    expect(otherPlays.length).toBeGreaterThan(0);
  });

  test('the constraint clears at turn-end (scope: turn)', () => {
    const base = orgState(ETTENMOORS);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, DOWN_DOWN);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetCompanyId: companyId,
    });
    expect(afterPlay.activeConstraints).toHaveLength(1);

    const swept = sweepExpired(afterPlay, { kind: 'turn-end' });
    expect(swept.activeConstraints).toHaveLength(0);
  });
});
