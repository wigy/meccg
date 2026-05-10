/**
 * @module dm-36.test
 *
 * Card test: The Under-courts (dm-36)
 * Type: hero-site (dark-hold) in Gorgoroth — Under-deeps
 *
 * Text:
 *   Adjacent Sites: Barad-dûr (0), The Sulfur-deeps (5), The Under-galleries (4)
 *   Playable: Items (minor, major, greater)
 *   Automatic-attacks (2): (1st) Trolls — 3 strikes with 10 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard
 *       creature from his hand normally keyed to Shadow-holds [S]
 *   Special: If any Nazgûl permanent-event is in play, one must be used as an
 *     additional automatic-attack (attacker's choice, discard after use—ignore
 *     result of defeat).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                  |
 * |---|-------------------|--------|--------------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — valid                                    |
 * | 2 | sitePath          | OK     | [] — under-deeps sites have no surface path            |
 * | 3 | nearestHaven      | OK     | "" — under-deeps sites have no nearest haven           |
 * | 4 | region            | OK     | "Gorgoroth"                                            |
 * | 5 | playableResources | FIXED  | [] → ["minor", "major", "greater"]                     |
 * | 6 | automaticAttacks  | PARTIAL| 1st (Trolls 3/10) present; 2nd dynamic attack not data |
 * | 7 | resourceDraws     | OK     | 1                                                      |
 * | 8 | hazardDraws       | OK     | 4                                                      |
 *
 * Engine Support:
 * | # | Feature                                 | Status          | Notes                               |
 * |---|-----------------------------------------|-----------------|-------------------------------------|
 * | 1 | Site phase flow                         | IMPLEMENTED     | select-company, enter-or-skip, etc. |
 * | 2 | First auto-attack (Trolls 3 str / 10 p) | IMPLEMENTED     | passes through as data              |
 * | 3 | Item playability (minor, major, greater) | IMPLEMENTED     | playableResources gate              |
 * | 4 | Gold-ring NOT playable                  | IMPLEMENTED     | not in playableResources            |
 * | 5 | 2nd auto-attack (opponent plays creat.) | NOT IMPLEMENTED | dynamic auto-attack not supported   |
 * | 6 | Nazgûl permanent-event as auto-attack   | NOT IMPLEMENTED | no engine support for special rule  |
 *
 * Playable: PARTIALLY
 * NOT CERTIFIED — two special rules have no engine support:
 *   - Dynamic 2nd auto-attack (opponent plays a non-unique creature from hand
 *     keyed to Shadow-holds)
 *   - Nazgûl permanent-event as an additional automatic-attack
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN, GLAMDRING, DAGGER_OF_WESTERNESSE, THE_MITHRIL_COAT, PRECIOUS_GOLD_RING,
  resetMint,
  buildSitePhaseState, setupAutoAttackStep,
  viableActions, dispatch,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const THE_UNDER_COURTS = 'dm-36' as CardDefinitionId;

describe('The Under-courts (dm-36)', () => {
  beforeEach(() => resetMint());

  // ─── First automatic attack: Trolls 3/10 ────────────────────────────────────

  test('first automatic attack: Trolls — 3 strikes with 10 prowess', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_COURTS,
      characters: [ARAGORN],
    });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(3);
    expect(next.combat!.strikeProwess).toBe(10);
    expect(next.combat!.creatureRace).toBe('troll');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Item playability ────────────────────────────────────────────────────────

  test('minor item (Dagger of Westernesse) is playable at The Under-courts', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_COURTS,
      hand: [DAGGER_OF_WESTERNESSE],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('major item (Glamdring) is playable at The Under-courts', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_COURTS,
      hand: [GLAMDRING],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('greater item (The Mithril-coat) is playable at The Under-courts', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_COURTS,
      hand: [THE_MITHRIL_COAT],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('gold-ring item is NOT playable at The Under-courts', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_COURTS,
      hand: [PRECIOUS_GOLD_RING],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBe(0);
  });

  // ─── NOT IMPLEMENTED — dynamic 2nd auto-attack ──────────────────────────────
  //
  // The 2nd auto-attack ("Opponent may play as an automatic-attack one
  // non-unique hazard creature from his hand normally keyed to Shadow-holds")
  // requires the engine to prompt the hazard player to optionally play a
  // creature card during the automatic-attacks step. No engine support exists
  // for this pattern today.

  test.todo('hazard player may play a non-unique creature from hand as 2nd auto-attack (keyed to Shadow-holds)');
  test.todo('hazard player may decline to play a creature as 2nd auto-attack');
  test.todo('unique creature cannot be played as the dynamic 2nd auto-attack');

  // ─── NOT IMPLEMENTED — Nazgûl permanent-event as additional auto-attack ─────
  //
  // "If any Nazgûl permanent-event is in play, one must be used as an additional
  // automatic-attack (attacker's choice, discard after use — ignore result of
  // defeat)." This requires: detecting Nazgûl permanent-events in play, forcing
  // an additional auto-attack, discarding the used event, and ignoring the
  // defeat result. No engine support exists for this rule today.

  test.todo('if a Nazgûl permanent-event is in play, it becomes an additional auto-attack');
  test.todo('the Nazgûl event is discarded after being used as an auto-attack regardless of outcome');
  test.todo('result of defeat of the Nazgûl auto-attack is ignored');
  test.todo('if no Nazgûl permanent-event is in play, no additional auto-attack is added');
});
