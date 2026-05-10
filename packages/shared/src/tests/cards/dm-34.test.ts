/**
 * @module dm-34.test
 *
 * Card test: The Pûkel-deeps (dm-34)
 * Type: hero-site (ruins-and-lairs, under-deeps)
 *
 * Text:
 *   Adjacent Sites: Dunharrow (0), The Gem-deeps (9), The Sulfur-deeps (9)
 *   Playable: Items (minor, major, gold ring)
 *   Automatic-attacks (2):
 *     (1st) Pûkel-creature — 2 strikes with 11 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard creature
 *           from his hand normally keyed to Shadow-holds [{S}]
 *   Special: Any Undead creature or Pûkel-creature may also be played at this site.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                        |
 * |---|-------------------|--------|--------------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                                    |
 * | 2 | sitePath          | OK     | [] — under-deeps sites have no regular site path             |
 * | 3 | nearestHaven      | OK     | "" — under-deeps sites have no nearest haven                 |
 * | 4 | region            | OK     | "Rohan"                                                      |
 * | 5 | playableResources | OK     | ["minor", "major", "gold-ring"] — matches text               |
 * | 6 | automaticAttacks  | OK     | Pûkel-creature, 2 strikes, 11 prowess (1st attack only)      |
 * | 7 | adjacentSites     | OK     | Dunharrow (0), The Gem-deeps (9), The Sulfur-deeps (9)       |
 * | 8 | resourceDraws     | OK     | 2                                                            |
 * | 9 | hazardDraws       | OK     | 3                                                            |
 *
 * Engine Support:
 * | # | Feature                             | Status          | Notes                                         |
 * |---|-------------------------------------|-----------------|-----------------------------------------------|
 * | 1 | Site phase flow                     | IMPLEMENTED     | select-company, enter-or-skip, play-resources |
 * | 2 | Item playability (minor/major/ring)  | IMPLEMENTED     | playableResources gate                        |
 * | 3 | 1st auto-attack (Pûkel-creature 2/11)| IMPLEMENTED     | combat initiated with correct stats           |
 * | 4 | 2nd auto-attack (dynamic from hand) | NOT IMPLEMENTED | engine does not support dynamic auto-attacks  |
 * | 5 | Special: Undead/Pûkel-creature play | NOT IMPLEMENTED | play-restriction 'allow-additional-creature-types' unimplemented |
 *
 * Playable: PARTIALLY
 * NOT CERTIFIED — 2nd auto-attack (dynamic opponent creature from hand keyed to [{S}])
 *   and Special rule (Undead/Pûkel-creature playability) have no engine support.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN, GLAMDRING, DAGGER_OF_WESTERNESSE, PRECIOUS_GOLD_RING,
  resetMint,
  buildSitePhaseState, setupAutoAttackStep,
  viableActions, dispatch,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const PUKEL_DEEPS = 'dm-34' as CardDefinitionId;

describe('The Pûkel-deeps (dm-34)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack: Pûkel-creature 2/11 ───────────────────────────────────

  test('1st automatic attack: Pûkel-creature — 2 strikes with 11 prowess', () => {
    const state = buildSitePhaseState({
      site: PUKEL_DEEPS,
      characters: [ARAGORN],
    });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(2);
    expect(next.combat!.strikeProwess).toBe(11);
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Item playability ────────────────────────────────────────────────────────

  test('minor item (Dagger of Westernesse) is playable at The Pûkel-deeps', () => {
    const state = buildSitePhaseState({
      site: PUKEL_DEEPS,
      hand: [DAGGER_OF_WESTERNESSE],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('major item (Glamdring) is playable at The Pûkel-deeps', () => {
    const state = buildSitePhaseState({
      site: PUKEL_DEEPS,
      hand: [GLAMDRING],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('gold ring (Precious Gold Ring) is playable at The Pûkel-deeps', () => {
    const state = buildSitePhaseState({
      site: PUKEL_DEEPS,
      hand: [PRECIOUS_GOLD_RING],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });
});
