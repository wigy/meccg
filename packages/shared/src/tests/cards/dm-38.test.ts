/**
 * @module dm-38.test
 *
 * Card test: The Under-gates (dm-38)
 * Type: hero-site (shadow-hold) in Redhorn Gate
 * Keywords: under-deeps
 *
 * Text:
 *   Adjacent Sites: Moria (0), The Gem-deeps (6), The Sulfur-deeps (5),
 *     The Under-grottos (8), The Under-leas (6)
 *   Playable: Items (minor, major, greater, gold ring)
 *   Automatic-attacks (2):
 *     (1st) Balrog — 2 strikes with 16 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard
 *       creature from his hand normally keyed to Ruins & Lairs [{R}]
 *   Special: If Balrog of Moria is in play or if it or Durin's Bane has been
 *     defeated, the first automatic attack is canceled.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                  |
 * |---|-------------------|--------|--------------------------------------------------------|
 * | 1 | siteType          | OK     | "shadow-hold" — valid                                  |
 * | 2 | sitePath          | OK     | [] — under-deeps site, uses adjacentSites              |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site, no standard haven path          |
 * | 4 | region            | OK     | "Redhorn Gate"                                         |
 * | 5 | playableResources | OK     | ["minor","major","greater","gold-ring"] — matches text |
 * | 6 | automaticAttacks  | OK     | Balrog, 2 strikes, 16 prowess (1st attack)             |
 * | 7 | resourceDraws     | OK     | 1                                                      |
 * | 8 | hazardDraws       | OK     | 3                                                      |
 * | 9 | adjacentSites     | OK     | Moria(0), Gem-deeps(6), Sulfur-deeps(5),               |
 * |   |                   |        | Under-grottos(8), Under-leas(6)                        |
 *
 * Engine Support:
 * | # | Feature                                      | Status          | Notes                                        |
 * |---|----------------------------------------------|-----------------|----------------------------------------------|
 * | 1 | Site phase flow                              | IMPLEMENTED     | select-company, enter-or-skip, play-resources |
 * | 2 | First auto-attack (Balrog 2/16)              | IMPLEMENTED     | passes through as data                       |
 * | 3 | Minor/major/greater/gold-ring playability    | IMPLEMENTED     | playableResources gate                       |
 * | 4 | 2nd auto-attack (opponent plays from hand)   | NOT IMPLEMENTED | dynamic auto-attack, no engine support       |
 * | 5 | Cancel 1st attack if Balrog in play/defeated | NOT IMPLEMENTED | no DSL effect type for conditional cancel    |
 * | 6 | Under-deeps movement (adjacentSites)         | NOT IMPLEMENTED | rule 3.45 is test.todo()                     |
 *
 * Playable: PARTIALLY
 * NOT CERTIFIED — dynamic 2nd auto-attack (opponent plays from hand keyed to R&L)
 *   and conditional first-attack cancellation rule have no engine support.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN, DAGGER_OF_WESTERNESSE, GLAMDRING, THE_MITHRIL_COAT, PRECIOUS_GOLD_RING,
  resetMint,
  buildSitePhaseState, setupAutoAttackStep,
  viableActions, dispatch,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const THE_UNDER_GATES = 'dm-38' as CardDefinitionId;

describe('The Under-gates (dm-38)', () => {
  beforeEach(() => resetMint());

  // ─── First automatic attack: Balrog 2/16 ────────────────────────────────────

  test('first automatic attack: Balrog — 2 strikes with 16 prowess', () => {
    const state = buildSitePhaseState({ site: THE_UNDER_GATES, characters: [ARAGORN] });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(2);
    expect(next.combat!.strikeProwess).toBe(16);
    expect(next.combat!.creatureRace).toBe('balrog');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Item playability ────────────────────────────────────────────────────────

  test('minor item (Dagger of Westernesse) is playable at The Under-gates', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_GATES,
      hand: [DAGGER_OF_WESTERNESSE],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('major item (Glamdring) is playable at The Under-gates', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_GATES,
      hand: [GLAMDRING],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('greater item (The Mithril-coat) is playable at The Under-gates', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_GATES,
      hand: [THE_MITHRIL_COAT],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('gold-ring item (Precious Gold Ring) is playable at The Under-gates', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_GATES,
      hand: [PRECIOUS_GOLD_RING],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });
});
