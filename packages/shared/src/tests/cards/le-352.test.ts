/**
 * @module le-352.test
 *
 * Card test: Barad-dûr (le-352)
 * Type: minion-site (dark-hold)
 *
 * Text:
 *   "Nearest Darkhaven: Minas Morgul.
 *    Special: Treat this site as a Darkhaven during the untap phase.
 *    Any gold ring item at this site is automatically tested during the
 *    site phase (the site need not be entered). All ring tests at this
 *    site are modified by -3."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                     |
 * |---|-------------------|--------|-----------------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — matches {D}                                 |
 * | 2 | sitePath          | OK     | [shadow, dark] — matches {s}{d}                           |
 * | 3 | nearestHaven      | OK     | "Minas Morgul" — valid minion haven (le-390)              |
 * | 4 | region            | OK     | "Gorgoroth" — adjacent to Imlad Morgul (Minas Morgul)     |
 * | 5 | playableResources | OK     | [] — no items may be played here                          |
 * | 6 | automaticAttacks  | OK     | [] — no automatic-attacks                                 |
 * | 7 | resourceDraws     | OK     | 2                                                         |
 * | 8 | hazardDraws       | OK     | 1                                                         |
 *
 * Engine Support:
 * | # | Feature                                  | Status          | Notes                                                 |
 * |---|------------------------------------------|-----------------|-------------------------------------------------------|
 * | 1 | Site phase flow                          | IMPLEMENTED     | select-company, enter-or-skip (no resources, no AA)   |
 * | 2 | Haven path movement                      | IMPLEMENTED     | Minas Morgul ↔ Barad-dûr via starter movement         |
 * | 3 | Region movement                          | IMPLEMENTED     | sites within 4 regions of Gorgoroth                   |
 * | 4 | Card draws                               | IMPLEMENTED     | resourceDraws (2) / hazardDraws (1)                   |
 * | 5 | site-rule: heal-during-untap             | IMPLEMENTED     | wounded characters heal during untap at this site     |
 * | 6 | Gold ring auto-test during site phase    | NOT IMPLEMENTED | no engine hook for borne-ring site-phase tests        |
 * | 7 | -3 modifier on all ring tests at site    | NOT IMPLEMENTED | depends on (6); no per-site ring-test modifier hook   |
 *
 * Playable: PARTIALLY — the "Darkhaven during untap" healing works, but
 * the site-phase gold-ring auto-test and the -3 ring-test modifier at
 * this site are not implemented. NOT CERTIFIED.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RIVENDELL, LORIEN, MORIA,
  LEGOLAS,
  resetMint, pool, buildTestState, Phase, Alignment, CardStatus,
  dispatch, expectCharStatus, RESOURCE_PLAYER,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard, CardDefinitionId } from '../../index.js';

const BARAD_DUR = 'le-352' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MIONID = 'as-3' as CardDefinitionId; // minion-character, ringwraith

describe('Barad-dûr (le-352)', () => {
  beforeEach(() => resetMint());

  // ─── Movement ───────────────────────────────────────────────────────────────

  test('reachable from Minas Morgul (nearest darkhaven) via starter movement', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).toContain(BARAD_DUR);
  });

  test('starter movement from Barad-dûr returns to Minas Morgul', () => {
    const baradDur = pool[BARAD_DUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, baradDur, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).toContain(MINAS_MORGUL);
  });

  test('not reachable from Dol Guldur via starter movement', () => {
    // Barad-dûr's nearest darkhaven is Minas Morgul, not Dol Guldur.
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).not.toContain(BARAD_DUR);
  });

  test('not reachable from a hero haven via starter movement', () => {
    // Barad-dûr is a minion site; hero havens have no starter route to it.
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).not.toContain(BARAD_DUR);
  });

  // ─── Untap phase: Darkhaven treatment ───────────────────────────────────────
  // Barad-dûr's text: "Treat this site as a Darkhaven during the untap phase."
  // The observable effect is that wounded (inverted) characters at Barad-dûr
  // heal to tapped during untap, as they would at a haven. The rest of the
  // game still treats the site as a dark-hold.

  test('wounded character at Barad-dûr heals during untap (Darkhaven rule)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BARAD_DUR, characters: [{ defId: MIONID, status: CardStatus.Inverted }] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
      ],
    });

    const nextState = dispatch(state, { type: 'untap', player: PLAYER_1 });

    // Wounded → tapped (same behavior as at a haven).
    expectCharStatus(nextState, RESOURCE_PLAYER, MIONID, CardStatus.Tapped);
  });

  test('tapped character at Barad-dûr untaps normally during untap', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BARAD_DUR, characters: [{ defId: MIONID, status: CardStatus.Tapped }] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
      ],
    });

    const nextState = dispatch(state, { type: 'untap', player: PLAYER_1 });

    expectCharStatus(nextState, RESOURCE_PLAYER, MIONID, CardStatus.Untapped);
  });

  test('regression: wounded character at a non-Barad-dûr dark-hold does NOT heal during untap', () => {
    // Guards against the heal-during-untap site-rule leaking to other sites
    // that lack the rule. Moria (le-392) is a shadow-hold with its own
    // site-rule but NOT heal-during-untap, so wounded characters there stay
    // wounded during untap.
    const MORIA_LE = 'le-392' as CardDefinitionId;
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA_LE, characters: [{ defId: MIONID, status: CardStatus.Inverted }] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
      ],
    });

    const nextState = dispatch(state, { type: 'untap', player: PLAYER_1 });

    expectCharStatus(nextState, RESOURCE_PLAYER, MIONID, CardStatus.Inverted);
  });

  // ─── Site phase: special rules (NOT IMPLEMENTED) ────────────────────────────
  // "Any gold ring item at this site is automatically tested during the site
  //  phase (the site need not be entered)."
  //
  // The engine has `auto-test-gold-ring` only for the storage path (a gold
  // ring stored at a site with the rule is auto-tested on store). Barad-dûr's
  // mechanic is different: any borne gold ring held by a character in any
  // company at this site is auto-tested during the site phase, whether or not
  // the company enters. No engine hook scans borne rings for site-phase tests
  // — the site-phase reducer does not enqueue `gold-ring-test` resolutions.

  test.todo('borne gold ring at Barad-dûr is auto-tested during the site phase');

  test.todo('gold ring auto-test fires even when company does not enter the site');

  // "All ring tests at this site are modified by -3."
  //
  // The engine's only ring-test modifier today is the `rollModifier` field on
  // the `auto-test-gold-ring` site-rule. Since Barad-dûr's auto-test trigger
  // is not implemented (above), neither is the -3 modifier for ring tests
  // performed here. A site-wide "all ring tests at this site get modifier X"
  // hook would be needed to also cover Rule 9.23 end-of-turn tests and the
  // manual `test-gold-ring` grant-action.

  test.todo('all ring tests at Barad-dûr have a -3 modifier applied to the 2d6 roll');
});
