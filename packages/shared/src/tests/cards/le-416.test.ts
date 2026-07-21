/**
 * @module le-416.test
 *
 * Card test: Wose Passage-hold (le-416)
 * Type: minion-site (border-hold) in Old Pûkel-land
 * Effects: 0 (no special text rules beyond standard site data fields)
 *
 * Text:
 *   "Nearest Darkhaven: Geann a-Lisch
 *    Automatic-attacks: Men — 3 strikes with 5 prowess"
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                   |
 * |---|-------------------|--------|---------------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid ({B})                             |
 * | 2 | sitePath          | OK     | [wilderness] — matches {w}                              |
 * | 3 | nearestHaven      | OK     | "Geann a-Lisch" — valid minion darkhaven (le-374)       |
 * | 4 | region            | OK     | "Old Pûkel-land" — valid region in card pool            |
 * | 5 | playableResources | OK     | [] — attributes.playable is empty (no items/info)       |
 * | 6 | automaticAttacks  | OK     | Men, 3 strikes, 5 prowess (plain fixed-strike attack)   |
 * | 7 | resourceDraws     | OK     | 1                                                       |
 * | 8 | hazardDraws       | OK     | 1                                                       |
 *
 * Engine Support:
 * | # | Feature                        | Status      | Notes                                                 |
 * |---|--------------------------------|-------------|-------------------------------------------------------|
 * | 1 | Site phase flow                | IMPLEMENTED | select-company, enter-or-skip, play-resources         |
 * | 2 | Haven path movement            | IMPLEMENTED | Geann a-Lisch ↔ Wose Passage-hold starter movement    |
 * | 3 | Automatic attack               | IMPLEMENTED | reducer-site initiates the Men combat (3 strikes)     |
 *
 * Note: "Wose Passage-hold" is a duplicate site name shared with the hero site
 * tw-439 (nearestHaven Edhellond, no auto-attack). Movement assertions therefore
 * key on the site's definition id (le-416), not its name. The minion border-hold
 * carries a Men 3-strike auto-attack the hero twin lacks; it is a plain
 * fixed-strike attack (no each-character, no detainment clause).
 *
 * Playable: YES
 * Certified: 2026-07-21
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  resetMint, pool,
  setupRingwraithAutoAttack, runAutoAttackCombatMulti,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import { reduce } from '../../engine/reducer.js';
import type { CardDefinitionId, SiteCard, SitePhaseState } from '../../index.js';

const WOSE_PASSAGE_HOLD_LE = 'le-416' as CardDefinitionId;
const WOSE_PASSAGE_HOLD_TW = 'tw-439' as CardDefinitionId;
const GEANN_A_LISCH = 'le-374' as CardDefinitionId;

// Minion characters for the Ringwraith-player fixture
const GORBAG = 'le-11' as CardDefinitionId;    // orc, prowess 6
const ASTERNAK = 'le-1' as CardDefinitionId;   // man, prowess 5

describe('Wose Passage-hold (le-416)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack: Men — 3 strikes with 5 prowess ─────────────────────

  test('Men automatic attack triggers with 3 strikes and 5 prowess', () => {
    const state = setupRingwraithAutoAttack(WOSE_PASSAGE_HOLD_LE, [GORBAG, ASTERNAK]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('man');
    expect(after.combat!.strikeProwess).toBe(5);
    // Plain fixed-strike attack: 3 strikes regardless of company size, not
    // one-per-character.
    expect(after.combat!.strikesTotal).toBe(3);
    expect(after.combat!.eachCharacterFacesOneStrike).not.toBe(true);
    expect(after.combat!.attackSource.type).toBe('automatic-attack');
    // No detainment clause on the card — the attack wounds normally.
    expect(after.combat!.detainment).toBe(false);
  });

  test('after the Men attack resolves, advance to declare-agent-attack', () => {
    const state = setupRingwraithAutoAttack(WOSE_PASSAGE_HOLD_LE, [GORBAG]);

    // Gorbag taps to fight (prowess 6) + roll 12 = 18 > 5 → wins each strike.
    const afterAttack = runAutoAttackCombatMulti(
      state,
      [
        { characterDefId: GORBAG, roll: 12, tapToFight: true },
        { characterDefId: GORBAG, roll: 12, tapToFight: true },
        { characterDefId: GORBAG, roll: 12, tapToFight: true },
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

  // ─── Movement: Geann a-Lisch ↔ Wose Passage-hold (le-416) ─────────────────

  test('starter movement from Geann a-Lisch reaches Wose Passage-hold (le-416)', () => {
    const geann = pool[GEANN_A_LISCH as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, geann, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).toContain(WOSE_PASSAGE_HOLD_LE);
  });

  test('starter movement from Geann a-Lisch does NOT reach hero Wose Passage-hold (tw-439)', () => {
    // Duplicate site name: the hero twin's nearestHaven is Edhellond.
    const geann = pool[GEANN_A_LISCH as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, geann, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).not.toContain(WOSE_PASSAGE_HOLD_TW);
  });

  test('starter movement from Wose Passage-hold (le-416) returns to Geann a-Lisch', () => {
    const wose = pool[WOSE_PASSAGE_HOLD_LE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, wose, allSites);
    const starterGeann = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (GEANN_A_LISCH as string),
    );

    expect(starterGeann).toBeDefined();
  });
});
