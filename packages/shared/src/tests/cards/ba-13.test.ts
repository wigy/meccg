/**
 * @module ba-13.test
 *
 * Card test: Shelob's Brood (ba-13)
 * Type: hazard-creature (spiders)
 *
 * Text:
 *   "Spiders. Four strikes. Playable at any Under-deeps site or surface site
 *    thereof."
 *
 * Base stats: strikes 4, prowess 8, body — (null), kill MP 1, non-unique.
 * Canonical `attributes.playable` in cards.json is empty — the entire keying
 * requirement lives in the card text and is encoded in `keyedTo`.
 *
 * Engine Support:
 * | # | Rule                                                     | Status      | Notes                                                    |
 * |---|----------------------------------------------------------|-------------|----------------------------------------------------------|
 * | 1 | Spiders (race)                                           | IMPLEMENTED | race field; normalizes to "spider" in combat             |
 * | 2 | Four strikes (strikesTotal = 4)                          | IMPLEMENTED | single attack, strikes 4 / prowess 8 / no body           |
 * | 3 | Playable at any Under-deeps site                        | IMPLEMENTED | keyedTo siteKeywords:["under-deeps"]                      |
 * | 4 | ...or surface site thereof (no Doors of Night gate)      | IMPLEMENTED | keyedTo adjacentToSiteKeywords:["under-deeps"], no when   |
 *
 * Playable: YES
 * Certified: 2026-07-10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState,
  viableActionsForHandCard,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, Alignment, RegionType, SiteType,
} from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const SHELOBS_BROOD = 'ba-13' as CardDefinitionId;

// Under-deeps site: The Under-gates (dm-38) — shadow-hold
const THE_UNDER_GATES = 'dm-38' as CardDefinitionId;
// Under-deeps site: The Under-vaults (dm-41) — ruins-and-lairs, surface entry Mount Gram
const THE_UNDER_VAULTS = 'dm-41' as CardDefinitionId;
// Surface site adjacent to The Under-vaults (cost-0 under-deeps adjacency)
const MOUNT_GRAM = 'tw-415' as CardDefinitionId;
// Surface site adjacent to The Iron-deeps (dm-33)
const CARN_DUM = 'tw-380' as CardDefinitionId;

function baseStateWithBroodInHand() {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: MORIA, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH, THE_UNDER_GATES, THE_UNDER_VAULTS, MOUNT_GRAM, CARN_DUM],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [SHELOBS_BROOD],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

describe("Shelob's Brood (ba-13)", () => {
  beforeEach(() => resetMint());

  // ─── Keying: any Under-deeps site ───────────────────────────────────────────

  test('playable at an Under-deeps destination — The Under-gates (shadow-hold)', () => {
    const state = baseStateWithBroodInHand();
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'The Under-gates',
      }),
    };

    const actions = viableActionsForHandCard(ready, PLAYER_2, 'play-hazard', HAZARD_PLAYER, SHELOBS_BROOD);
    expect(actions.length).toBeGreaterThanOrEqual(1);
    expect(actions.every(a => a.viable)).toBe(true);
    const siteKeyed = actions
      .map(a => a.action as { keyedBy?: { method: string; value: string } })
      .find(a => a.keyedBy?.method === 'site-keyword');
    expect(siteKeyed?.keyedBy?.value).toBe('under-deeps');
  });

  test('playable at another Under-deeps destination — The Under-vaults (ruins-and-lairs)', () => {
    const state = baseStateWithBroodInHand();
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'The Under-vaults',
      }),
    };

    const actions = viableActionsForHandCard(ready, PLAYER_2, 'play-hazard', HAZARD_PLAYER, SHELOBS_BROOD);
    expect(actions.length).toBeGreaterThanOrEqual(1);
    expect(actions.every(a => a.viable)).toBe(true);
    const siteKeyed = actions
      .map(a => a.action as { keyedBy?: { method: string; value: string } })
      .find(a => a.keyedBy?.method === 'site-keyword');
    expect(siteKeyed?.keyedBy?.value).toBe('under-deeps');
  });

  // ─── Keying: surface site thereof (no Doors of Night required) ───────────────

  test('playable at a surface site of an Under-deeps site — Mount Gram (no Doors of Night)', () => {
    // Mount Gram is the surface entry point for The Under-vaults (dm-41).
    // Unlike Nameless Thing (dm-109), Shelob's Brood needs no Doors of Night.
    const state = baseStateWithBroodInHand();
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Shadow],
        resolvedSitePathNames: ['Gundabad'],
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'Mount Gram',
      }),
    };

    const actions = viableActionsForHandCard(ready, PLAYER_2, 'play-hazard', HAZARD_PLAYER, SHELOBS_BROOD);
    expect(actions).toHaveLength(1);
    expect(actions[0].viable).toBe(true);
    const a = actions[0].action as { keyedBy?: { method: string; value: string } };
    expect(a.keyedBy?.method).toBe('adjacent-to-site-keyword');
    expect(a.keyedBy?.value).toBe('under-deeps');
  });

  test('playable at another surface site of an Under-deeps site — Carn Dûm', () => {
    // Carn Dûm (tw-380) is the surface entry for The Iron-deeps (dm-33).
    const state = baseStateWithBroodInHand();
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Shadow],
        resolvedSitePathNames: ['Gundabad'],
        destinationSiteType: SiteType.DarkHold,
        destinationSiteName: 'Carn Dûm',
      }),
    };

    const actions = viableActionsForHandCard(ready, PLAYER_2, 'play-hazard', HAZARD_PLAYER, SHELOBS_BROOD);
    expect(actions).toHaveLength(1);
    expect(actions[0].viable).toBe(true);
    const a = actions[0].action as { keyedBy?: { method: string; value: string } };
    expect(a.keyedBy?.method).toBe('adjacent-to-site-keyword');
  });

  // ─── Keying: NOT playable at an unrelated site ──────────────────────────────

  test('NOT playable at an ordinary site that is neither Under-deeps nor a surface site thereof', () => {
    // Weathertop via a wilderness path: not an Under-deeps site and not
    // under-deeps-adjacent to one.
    const state = baseStateWithBroodInHand();
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
        resolvedSitePathNames: ['Rhudaur', 'Arthedain'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Weathertop',
      }),
    };

    const actions = viableActionsForHandCard(ready, PLAYER_2, 'play-hazard', HAZARD_PLAYER, SHELOBS_BROOD);
    expect(actions).toHaveLength(0);
  });

  // ─── Combat: single 4-strike attack, prowess 8, no body ─────────────────────

  test('combat initiates with strikesTotal = 4, prowess 8, no creature body, race spider (Under-deeps)', () => {
    const state = baseStateWithBroodInHand();
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'The Under-gates',
      }),
    };

    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, creatureId, companyId,
      { method: 'site-keyword', value: 'under-deeps' },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(4);
    expect(afterChain.combat!.strikeProwess).toBe(8);
    expect(afterChain.combat!.creatureBody).toBeNull();
    expect(afterChain.combat!.creatureRace).toBe('spider');
  });

  test('combat also resolves via surface-site keying — Mount Gram (adjacent-to-site-keyword)', () => {
    // Drive the reducer-side keying validation (checkCreatureKeying) through
    // the adjacent-to-site-keyword path, distinct from the legal-action matcher.
    const state = baseStateWithBroodInHand();
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Shadow],
        resolvedSitePathNames: ['Gundabad'],
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'Mount Gram',
      }),
    };

    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, creatureId, companyId,
      { method: 'adjacent-to-site-keyword', value: 'under-deeps' },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(4);
    expect(afterChain.combat!.strikeProwess).toBe(8);
  });
});
