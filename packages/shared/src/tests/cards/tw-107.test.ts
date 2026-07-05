/**
 * @module tw-107.test
 *
 * Card test: Ûvatha the Horseman (tw-107)
 * Type: hazard-creature (dual creature / permanent-event)
 * Race: Nazgûl. One strike at prowess 15, body 9, 5 kill MP.
 *
 * Card text:
 *   "Unique. Nazgûl (9th). May be played as a hazard creature (with one
 *    strike) or as a permanent-event.
 *    As a creature, may also be played keyed to Harondor, Horse Plains,
 *    Gorgoroth, and Khand; and may also be played at sites in these regions.
 *    If played as a permanent-event, it will remain in play until tapped
 *    during the opponent's movement/hazard phase (tapping counts against the
 *    hazard limit). When tapped, Ûvatha the Horseman becomes a short-event and
 *    you may bring one hazard creature from your discard pile to your hand."
 *
 * Keying (canonical `playable` = {d}{D}):
 *   - Base: a Dark-domain region {d} in the site path and a Dark-hold {D}
 *     destination.
 *   - Alt: named regions Harondor, Horse Plains, Gorgoroth, Khand — a single
 *     `regionNames` keyedTo entry, which also covers "played at sites in these
 *     regions" (the destination region name is part of the resolved path).
 *
 * Engine support:
 * | # | Feature                                       | Status          | Notes                                    |
 * |---|-----------------------------------------------|-----------------|------------------------------------------|
 * | 1 | One strike, prowess 15, body 9                | IMPLEMENTED     | structural data                          |
 * | 2 | Keying: base {d}{D}                           | IMPLEMENTED     | regionTypes/siteTypes in keyedTo         |
 * | 3 | Keying: named Harondor/Horse Plains/…         | IMPLEMENTED     | regionNames in keyedTo                   |
 * | 4 | Permanent-event play mode (dual creature/PE)  | NOT IMPLEMENTED | no dual-mode play path in the engine     |
 * | 5 | Tapped by opponent in their M/H (vs haz limit)| NOT IMPLEMENTED | depends on #4                            |
 * | 6 | On tap → short-event, fetch creature from disc| NOT IMPLEMENTED | depends on #4                            |
 *
 * Playable: PARTIALLY — the hazard-creature mode (stats + keying) is fully
 * supported, but the alternative permanent-event mode and its tap-to-fetch
 * ability are not implemented in the engine (the `playable-as-event` play-flag
 * is only consulted for deck-construction counting, not for enabling an actual
 * permanent-event play). NOT CERTIFIED. This test covers the working
 * creature-mode keying and combat initiation; the permanent-event mode is out
 * of scope until the dual-mode play subsystem exists.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState,
  playCreatureHazardAndResolve,
  handCardId,
  viableActions,
  companyIdAt,
  HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const UVATHA = 'tw-107' as CardDefinitionId;

/** Two-company M/H setup with Ûvatha in the hazard player's hand. */
function setup() {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [UVATHA], siteDeck: [RIVENDELL] },
    ],
  });
}

describe('Ûvatha the Horseman (tw-107)', () => {
  beforeEach(() => resetMint());

  // ─── Creature-mode keying ───────────────────────────────────────────────────

  test('playable as a creature keyed to a Dark-hold in a Dark-domain path', () => {
    const state = setup();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Barad-dûr',
    });
    const ready = { ...state, phaseState: mhState };
    const uvathaId = handCardId(ready, HAZARD_PLAYER);
    const viable = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === uvathaId && a.viable);
    expect(viable.length).toBeGreaterThan(0);
  });

  test('playable as a creature keyed to a named region (Harondor)', () => {
    const state = setup();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Harondor'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };
    const uvathaId = handCardId(ready, HAZARD_PLAYER);
    const viable = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === uvathaId && a.viable);
    expect(viable.length).toBeGreaterThan(0);
  });

  test('NOT playable on a neutral path (no Dark-hold, no named region)', () => {
    const state = setup();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };
    const uvathaId = handCardId(ready, HAZARD_PLAYER);
    const viable = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === uvathaId && a.viable);
    expect(viable).toHaveLength(0);
  });

  // ─── Combat initiates (creature mode) ────────────────────────────────────────

  test('creature combat initiates with one strike at prowess 15', () => {
    const state = setup();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Khand'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Minas Morgul',
    });
    const ready = { ...state, phaseState: mhState };
    const uvathaId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, 0, 0);
    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, uvathaId, companyId,
      { method: 'region-name', value: 'Khand' },
    );
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(1);
    expect(after.combat!.strikeProwess).toBe(15);
  });
});
