/**
 * @module dm-35.test
 *
 * Card test: The Sulfur-deeps (dm-35)
 * Type: hero-site (dark-hold, under-deeps)
 * Effects: 0
 *
 * "Adjacent Sites: Dol Guldur (0), The Under-courts (5), The Pûkel-deeps (9),
 *  The Under-gates (5), The Under-galleries (8)
 *  Playable: Items (minor, major, greater)
 *  Automatic-attacks (2):
 *    (1st) Trolls — 2 strikes with 9 prowess
 *    (2nd) Opponent may play as an automatic-attack one non-unique hazard creature
 *          from his hand normally keyed to Shadow-holds [S]
 *  Special: If Khamûl the Easterling or Adûnaphel is in play as a permanent-event,
 *           one must be used as an additional automatic-attack (attacker's choice,
 *           discard after use—ignore result of defeat)."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                               |
 * |---|-------------------|--------|-----------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — matches authoritative {D}             |
 * | 2 | sitePath          | OK     | [] — under-deeps site, no path needed               |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site, no haven needed              |
 * | 4 | playableResources | OK     | ["minor","major","greater"] — matches card text     |
 * | 5 | automaticAttacks  | PARTIAL| 1st (Trolls 2/9) in data; 2nd (dynamic) missing    |
 * | 6 | resourceDraws     | OK     | 1                                                   |
 * | 7 | hazardDraws       | OK     | 4                                                   |
 *
 * Engine Support:
 * | # | Feature                              | Status          | Notes                                |
 * |---|--------------------------------------|-----------------|--------------------------------------|
 * | 1 | Site phase flow                      | IMPLEMENTED     | play-resources step                  |
 * | 2 | Item playability (minor/major/greater)| IMPLEMENTED     | playableResources gate               |
 * | 3 | 1st auto-attack: Trolls 2/9          | IMPLEMENTED     | data correct                         |
 * | 4 | 2nd auto-attack (dynamic from hand)  | NOT IMPLEMENTED | no engine support; data also missing |
 * | 5 | Khamûl/Adûnaphel extra auto-attack   | NOT IMPLEMENTED | not in effects; no engine support    |
 * | 6 | Under-deeps movement                 | NOT IMPLEMENTED | rule-3.45 is test.todo               |
 *
 * Playable: PARTIALLY
 * NOT CERTIFIED — dynamic 2nd auto-attack (opponent plays from hand keyed to
 *   Shadow-holds) and the Khamûl/Adûnaphel additional auto-attack special rule
 *   are not implemented in the engine.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, ARAGORN,
  resetMint,
  buildSitePhaseState,
  setupAutoAttackStep,
  dispatch,
  viableActions,
} from '../test-helpers.js';
import {
  GLAMDRING, DAGGER_OF_WESTERNESSE, THE_MITHRIL_COAT,
} from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const SULFUR_DEEPS = 'dm-35' as CardDefinitionId;

describe('The Sulfur-deeps (dm-35)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability ─────────────────────────────────────────────────────

  test('minor items are playable at The Sulfur-deeps', () => {
    const state = buildSitePhaseState({
      site: SULFUR_DEEPS,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are playable at The Sulfur-deeps', () => {
    const state = buildSitePhaseState({
      site: SULFUR_DEEPS,
      hand: [GLAMDRING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('greater items are playable at The Sulfur-deeps', () => {
    const state = buildSitePhaseState({
      site: SULFUR_DEEPS,
      hand: [THE_MITHRIL_COAT],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Automatic attack (1st): Trolls 2 strikes / 9 prowess ────────────────

  test('first automatic attack (Trolls) triggers with 2 strikes and 9 prowess', () => {
    const state = buildSitePhaseState({
      site: SULFUR_DEEPS,
      characters: [ARAGORN],
    });
    const readyState = setupAutoAttackStep(state);

    const afterFirst = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(afterFirst.combat).not.toBeNull();
    expect(afterFirst.combat!.strikesTotal).toBe(2);
    expect(afterFirst.combat!.strikeProwess).toBe(9);
    expect(afterFirst.combat!.creatureRace).toBe('troll');
    expect(afterFirst.combat!.attackSource.type).toBe('automatic-attack');
  });
});
