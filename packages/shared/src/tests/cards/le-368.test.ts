/**
 * @module le-368.test
 *
 * Card test: Drúadan Forest (le-368)
 * Type: minion-site (border-hold) in Anórien
 * Effects: 0 (no special text rules beyond standard site data fields)
 *
 * Text:
 *   "Nearest Darkhaven: Minas Morgul
 *    Automatic-attacks: Men — 3 strikes with 6 prowess"
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                   |
 * |---|-------------------|--------|---------------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid ({B})                             |
 * | 2 | sitePath          | OK     | [shadow, wilderness, free] — matches {s}{w}{f}          |
 * | 3 | nearestHaven      | OK     | "Minas Morgul" — valid minion darkhaven (le-390)        |
 * | 4 | region            | OK     | "Anórien" — valid region in card pool                   |
 * | 5 | playableResources | OK     | [] — attributes.playable is empty (no items/info)       |
 * | 6 | automaticAttacks  | OK     | Men, 3 strikes, 6 prowess (plain fixed-strike attack)   |
 * | 7 | resourceDraws     | OK     | 2                                                       |
 * | 8 | hazardDraws       | OK     | 2                                                       |
 * | 9 | unique            | OK     | true — matches attributes.unique in cards.json          |
 *
 * Engine Support:
 * | # | Feature                        | Status      | Notes                                                 |
 * |---|--------------------------------|-------------|-------------------------------------------------------|
 * | 1 | Site phase flow                | IMPLEMENTED | select-company, enter-or-skip, play-resources         |
 * | 2 | Haven path movement            | IMPLEMENTED | Minas Morgul ↔ Drúadan Forest starter movement        |
 * | 3 | Automatic attack               | IMPLEMENTED | reducer-site initiates the Men combat (3 strikes)     |
 *
 * Note: the Men auto-attack is a plain fixed-strike attack — 3 strikes at 6
 * prowess regardless of company size (no each-character clause), and no
 * detainment clause, so the strikes wound normally.
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

const DRUADAN_FOREST = 'le-368' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

// Minion characters for the Ringwraith-player fixture
const GORBAG = 'le-11' as CardDefinitionId;    // orc, prowess 6
const ASTERNAK = 'le-1' as CardDefinitionId;   // man, prowess 5

describe('Drúadan Forest (le-368)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack: Men — 3 strikes with 6 prowess ─────────────────────

  test('Men automatic attack triggers with 3 strikes and 6 prowess', () => {
    const state = setupRingwraithAutoAttack(DRUADAN_FOREST, [GORBAG, ASTERNAK]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('man');
    expect(after.combat!.strikeProwess).toBe(6);
    // Plain fixed-strike attack: 3 strikes regardless of company size, not
    // one-per-character.
    expect(after.combat!.strikesTotal).toBe(3);
    expect(after.combat!.eachCharacterFacesOneStrike).not.toBe(true);
    expect(after.combat!.attackSource.type).toBe('automatic-attack');
    // No detainment clause on the card — the attack wounds normally.
    expect(after.combat!.detainment).toBe(false);
  });

  test('after the Men attack resolves, advance to declare-agent-attack', () => {
    const state = setupRingwraithAutoAttack(DRUADAN_FOREST, [GORBAG]);

    // Gorbag taps to fight (prowess 6) + roll 12 = 18 > 6 → wins each strike.
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

  // ─── Movement: Minas Morgul ↔ Drúadan Forest (le-368) ─────────────────────

  test('starter movement from Minas Morgul reaches Drúadan Forest (le-368)', () => {
    const morgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, morgul, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).toContain(DRUADAN_FOREST);
  });

  test('starter movement from Drúadan Forest (le-368) returns to Minas Morgul', () => {
    const forest = pool[DRUADAN_FOREST as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, forest, allSites);
    const starterMorgul = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (MINAS_MORGUL as string),
    );

    expect(starterMorgul).toBeDefined();
  });
});
