/**
 * @module le-406.test
 *
 * Card test: The Stones (le-406)
 * Type: minion-site (ruins-and-lairs) in Andrast
 * Effects: 0 (no special text rules beyond standard site data fields)
 *
 * Text:
 *   "Nearest Darkhaven: Geann a-Lisch
 *    Playable: Items (minor, major, greater)
 *    Automatic-attacks: Pûkel-creature — 2 strikes with 9 prowess"
 *
 * Data fix in this certification: `playableResources` was empty ([]) even
 * though the card text (and attributes.playable in data/cards.json) lists
 * "Items (minor, major, greater)" — restored to ["minor", "major", "greater"].
 * `unique: true` added (attributes.unique). The auto-attack creatureType was
 * "Pûkel-creatures" (plural), which normalizeCreatureRace does not map;
 * corrected to the singular "Pûkel-creature" that the engine normalizes to the
 * "pukel-creature" race (matching the sibling le-405 and the printed text).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                   |
 * |---|-------------------|--------|---------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid ({R})                         |
 * | 2 | sitePath          | OK     | [wilderness, wilderness] — matches {w}{w}               |
 * | 3 | nearestHaven      | OK     | "Geann a-Lisch" — valid minion darkhaven (le-374)       |
 * | 4 | region            | OK     | "Andrast"                                               |
 * | 5 | playableResources | OK     | [minor, major, greater] — matches card text (data fix)  |
 * | 6 | automaticAttacks  | OK     | Pûkel-creature, 2 strikes, 9 prowess                    |
 * | 7 | resourceDraws     | OK     | 1                                                       |
 * | 8 | hazardDraws       | OK     | 1                                                       |
 *
 * Engine Support:
 * | # | Feature                        | Status      | Notes                                                 |
 * |---|--------------------------------|-------------|-------------------------------------------------------|
 * | 1 | Site phase flow                | IMPLEMENTED | select-company, enter-or-skip, play-resources         |
 * | 2 | Item playability (min/maj/grt) | IMPLEMENTED | playableResources gates all three subtypes here       |
 * | 3 | Haven path movement            | IMPLEMENTED | Geann a-Lisch ↔ The Stones starter movement           |
 * | 4 | Automatic attack               | IMPLEMENTED | reducer-site initiates the 2-strike Pûkel combat      |
 *
 * Note: "The Stones" is a duplicate site name shared with the hero site tw-429
 * (nearestHaven Edhellond). Movement assertions therefore key on the site's
 * definition id (le-406), not its name.
 *
 * Playable: YES
 * Certified: 2026-07-21
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  resetMint, pool,
  viableActions,
  buildMinionSitePhaseState,
  setupRingwraithAutoAttack, runAutoAttackCombatMulti,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import { reduce } from '../../engine/reducer.js';
import type { CardDefinitionId, SiteCard, SitePhaseState } from '../../index.js';

const THE_STONES_LE = 'le-406' as CardDefinitionId;
const THE_STONES_TW = 'tw-429' as CardDefinitionId;
const GEANN_A_LISCH = 'le-374' as CardDefinitionId;

// Minion characters for the Ringwraith-player fixture
const GORBAG = 'le-11' as CardDefinitionId;    // orc, prowess 6
const ASTERNAK = 'le-1' as CardDefinitionId;   // man, prowess 5

// Playability probes
const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId;   // minor minion item
const SABLE_SHIELD = 'le-341' as CardDefinitionId;        // major minion item
const THE_IRON_CROWN = 'le-314' as CardDefinitionId;      // greater minion item

describe('The Stones (le-406)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack: Pûkel-creature — 2 strikes with 9 prowess ──────────

  test('Pûkel-creature automatic attack triggers with 2 strikes and 9 prowess', () => {
    const state = setupRingwraithAutoAttack(THE_STONES_LE, [GORBAG, ASTERNAK]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('pukel-creature');
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.strikeProwess).toBe(9);
    expect(after.combat!.attackSource.type).toBe('automatic-attack');
    // Ruins-and-lairs: no auto-detainment branch and no detainment clause on
    // the card — the attack wounds normally even against a minion company.
    expect(after.combat!.detainment).toBe(false);
  });

  test('after the two-strike Pûkel-creature attack, advance to declare-agent-attack', () => {
    const state = setupRingwraithAutoAttack(THE_STONES_LE, [GORBAG, ASTERNAK]);

    // Two strikes, two defenders: Gorbag (prowess 6) + roll 12 = 18 > 9 wins,
    // Asternak (prowess 5) + roll 12 = 17 > 9 wins. Both strikes resolved.
    const afterAttack = runAutoAttackCombatMulti(
      state,
      [
        { characterDefId: GORBAG, roll: 12, tapToFight: true },
        { characterDefId: ASTERNAK, roll: 12, tapToFight: true },
      ],
      PLAYER_1,
      PLAYER_2,
    );
    expect(afterAttack.state.combat).toBeNull();
    const sps = afterAttack.state.phaseState as SitePhaseState;
    expect(sps.step).toBe('automatic-attacks');
    expect(sps.automaticAttacksResolved).toBe(1);

    // Next pass: there is no second attack → advance to declare-agent-attack.
    const { state: afterSkip, error } = reduce(afterAttack.state, { type: 'pass', player: PLAYER_1 });
    expect(error).toBeUndefined();
    expect(afterSkip.combat).toBeNull();
    expect((afterSkip.phaseState as SitePhaseState).step).toBe('declare-agent-attack');
  });

  // ─── Item playability: Items (minor, major, greater) ──────────────────────

  test('minor minion item (Saw-toothed Blade) IS viable at The Stones', () => {
    const state = buildMinionSitePhaseState({
      site: THE_STONES_LE,
      characters: [GORBAG],
      hand: [SAW_TOOTHED_BLADE],
    });
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  test('major minion item (Sable Shield) IS viable — site lists major', () => {
    const state = buildMinionSitePhaseState({
      site: THE_STONES_LE,
      characters: [GORBAG],
      hand: [SABLE_SHIELD],
    });
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  test('greater minion item (The Iron Crown) IS viable — site lists greater', () => {
    // Viable only because the data fix restored "greater" to The Stones'
    // playableResources; without it a greater item is gated out.
    const state = buildMinionSitePhaseState({
      site: THE_STONES_LE,
      characters: [GORBAG],
      hand: [THE_IRON_CROWN],
    });
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  // ─── Movement: Geann a-Lisch ↔ The Stones (le-406) ────────────────────────

  test('starter movement from Geann a-Lisch reaches The Stones (le-406)', () => {
    const geann = pool[GEANN_A_LISCH as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, geann, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).toContain(THE_STONES_LE);
  });

  test('starter movement from Geann a-Lisch does NOT reach hero The Stones (tw-429)', () => {
    // Duplicate site name: the hero twin's nearestHaven is Edhellond.
    const geann = pool[GEANN_A_LISCH as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, geann, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).not.toContain(THE_STONES_TW);
  });

  test('starter movement from The Stones (le-406) returns to Geann a-Lisch', () => {
    const theStones = pool[THE_STONES_LE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, theStones, allSites);
    const starterGeann = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (GEANN_A_LISCH as string),
    );

    expect(starterGeann).toBeDefined();
  });
});
