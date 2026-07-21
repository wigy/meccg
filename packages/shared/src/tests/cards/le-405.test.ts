/**
 * @module le-405.test
 *
 * Card test: Stone-circle (le-405)
 * Type: minion-site (ruins-and-lairs) in Old Pûkel Gap
 * Effects: 0 (no special text rules beyond standard site data fields)
 *
 * Text:
 *   "Nearest Darkhaven: Geann a-Lisch
 *    Playable: Information, Items (minor)
 *    Automatic-attacks: Pûkel-creature — 1 strike with 9 prowess"
 *
 * Data fix in this certification: `playableResources` was empty ([]) even
 * though the card text lists "Information, Items (minor)" — restored to
 * ["information", "minor"] per attributes.playable in data/cards.json, and
 * `unique: true` added (attributes.unique), matching the certified hero twin
 * tw-427.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                   |
 * |---|-------------------|--------|---------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid ({R})                         |
 * | 2 | sitePath          | OK     | [wilderness, wilderness] — matches {w}{w}               |
 * | 3 | nearestHaven      | OK     | "Geann a-Lisch" — valid minion darkhaven (le-374)       |
 * | 4 | region            | OK     | "Old Pûkel Gap" — same as hero twin tw-427              |
 * | 5 | playableResources | OK     | [information, minor] — matches card text (data fix)     |
 * | 6 | automaticAttacks  | OK     | Pûkel-creature, 1 strike, 9 prowess                     |
 * | 7 | resourceDraws     | OK     | 1                                                       |
 * | 8 | hazardDraws       | OK     | 1                                                       |
 *
 * Engine Support:
 * | # | Feature                        | Status      | Notes                                                 |
 * |---|--------------------------------|-------------|-------------------------------------------------------|
 * | 1 | Site phase flow                | IMPLEMENTED | select-company, enter-or-skip, play-resources         |
 * | 2 | Item playability (minor)       | IMPLEMENTED | playableResources gates minor subtype at this site    |
 * | 3 | Information playability        | IMPLEMENTED | information resources filter on site.playableResources|
 * | 4 | Haven path movement            | IMPLEMENTED | Geann a-Lisch ↔ Stone-circle starter movement         |
 * | 5 | Automatic attack               | IMPLEMENTED | reducer-site initiates the Pûkel-creature combat      |
 *
 * Note: "Stone-circle" is a duplicate site name shared with the hero site
 * tw-427 (nearestHaven Edhellond). Movement assertions therefore key on the
 * site's definition id (le-405), not its name.
 *
 * Playable: YES
 * Certified: 2026-07-20
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

const STONE_CIRCLE_LE = 'le-405' as CardDefinitionId;
const STONE_CIRCLE_TW = 'tw-427' as CardDefinitionId;
const GEANN_A_LISCH = 'le-374' as CardDefinitionId;

// Minion characters for the Ringwraith-player fixture
const GORBAG = 'le-11' as CardDefinitionId;    // orc, prowess 6
const ASTERNAK = 'le-1' as CardDefinitionId;   // man, prowess 5

// Playability probes
const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId;   // minor minion item
const SABLE_SHIELD = 'le-341' as CardDefinitionId;        // major minion item
const THAT_AINT_NO_SECRET = 'le-240' as CardDefinitionId; // information resource

describe('Stone-circle (le-405)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack: Pûkel-creature — 1 strike with 9 prowess ───────────

  test('Pûkel-creature automatic attack triggers with 1 strike and 9 prowess', () => {
    const state = setupRingwraithAutoAttack(STONE_CIRCLE_LE, [GORBAG, ASTERNAK]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('pukel-creature');
    expect(after.combat!.strikesTotal).toBe(1);
    expect(after.combat!.strikeProwess).toBe(9);
    expect(after.combat!.attackSource.type).toBe('automatic-attack');
    // Ruins-and-lairs: no auto-detainment branch and no detainment clause on
    // the card — the attack wounds normally even against a minion company.
    expect(after.combat!.detainment).toBe(false);
  });

  test('after the single Pûkel-creature attack, advance to declare-agent-attack', () => {
    const state = setupRingwraithAutoAttack(STONE_CIRCLE_LE, [GORBAG]);

    // Gorbag taps to fight (prowess 6) + roll 12 = 18 > 9 → wins the strike.
    const afterAttack = runAutoAttackCombatMulti(
      state,
      [{ characterDefId: GORBAG, roll: 12, tapToFight: true }],
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

  // ─── Item playability: Items (minor) ──────────────────────────────────────

  test('minor minion item (Saw-toothed Blade) IS viable at Stone-circle', () => {
    const state = buildMinionSitePhaseState({
      site: STONE_CIRCLE_LE,
      characters: [GORBAG],
      hand: [SAW_TOOTHED_BLADE],
    });
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  test('major minion item (Sable Shield) is NOT viable — site lists minor only', () => {
    const state = buildMinionSitePhaseState({
      site: STONE_CIRCLE_LE,
      characters: [GORBAG],
      hand: [SABLE_SHIELD],
    });
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBe(0);
  });

  // ─── Information playability ──────────────────────────────────────────────

  test('information resource (That Ain\'t No Secret) IS playable at Stone-circle', () => {
    // le-240 filters its site target on playableResources $includes
    // "information" — viable here only because the data fix restored
    // "information" to Stone-circle's playableResources.
    const state = buildMinionSitePhaseState({
      site: STONE_CIRCLE_LE,
      characters: [GORBAG],
      hand: [THAT_AINT_NO_SECRET],
    });
    const viable = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(viable.length).toBeGreaterThan(0);
  });

  // ─── Movement: Geann a-Lisch ↔ Stone-circle (le-405) ─────────────────────

  test('starter movement from Geann a-Lisch reaches Stone-circle (le-405)', () => {
    const geann = pool[GEANN_A_LISCH as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, geann, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).toContain(STONE_CIRCLE_LE);
  });

  test('starter movement from Geann a-Lisch does NOT reach hero Stone-circle (tw-427)', () => {
    // Duplicate site name: the hero twin's nearestHaven is Edhellond.
    const geann = pool[GEANN_A_LISCH as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, geann, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).not.toContain(STONE_CIRCLE_TW);
  });

  test('starter movement from Stone-circle (le-405) returns to Geann a-Lisch', () => {
    const stoneCircle = pool[STONE_CIRCLE_LE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, stoneCircle, allSites);
    const starterGeann = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (GEANN_A_LISCH as string),
    );

    expect(starterGeann).toBeDefined();
  });
});
