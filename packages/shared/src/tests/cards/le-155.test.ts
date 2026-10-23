/**
 * @module le-155.test
 *
 * Card test: "Two-headed" Troll (le-155)
 * Type: minion-resource-ally
 * Alignment: ringwraith
 * Stats: prowess 5, body 8, 1 MP (ally)
 *
 * Card text:
 *   "Playable at any tapped or untapped Ruins & Lairs [{R}] with a Troll
 *    automatic-attack. Its controlling character's company is overt. Tap to
 *    cancel an Orc or Troll attack against his company. Cannot be duplicated
 *    in a given company."
 *
 * Effects:
 *   1. play-flag: playable-at-tapped-site — playable at a tapped site (in
 *      addition to untapped, the default)
 *   + playableAt: [{ siteType: "ruins-and-lairs", when: Troll auto-attack }]
 *
 * | # | Rule                                                       | Status | Notes                                                  |
 * |---|-------------------------------------------------------------|--------|---------------------------------------------------------|
 * | 1 | Playable at any R&L with a Troll automatic-attack, tapped    | OK     | playableAt siteType + when(site.autoAttack.race) + flag |
 * |   | or untapped                                                  |        |                                                          |
 * | 2 | NOT playable at a R&L without a Troll automatic-attack       | OK     | playableAt `when` clause excludes non-matching sites     |
 * | 3 | Company is overt                                             | TODO   |                                                          |
 * | 4 | Tap to cancel an Orc or Troll attack against his company     | TODO   |                                                          |
 * | 5 | Cannot be duplicated in a given company                      | TODO   |                                                          |
 *
 * Playable: PARTIAL
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  resetMint, buildSitePhaseState,
  CardStatus,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, PlayHeroResourceAction } from '../../index.js';

const TWO_HEADED_TROLL = 'le-155' as CardDefinitionId;

// Minion character to bear the ally.
const ASTERNAK = 'le-1' as CardDefinitionId;

// A Ruins & Lairs site with a Troll automatic-attack (the bug-report site).
const BUHR_WIDU = 'le-357' as CardDefinitionId;
// A Ruins & Lairs site with a Wolf (not Troll) automatic-attack (control).
const OST_IN_EDHIL = 'le-397' as CardDefinitionId;

describe('"Two-headed" Troll (le-155)', () => {
  beforeEach(() => resetMint());

  test('IS playable at an untapped Ruins & Lairs with a Troll automatic-attack', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: BUHR_WIDU,
      hand: [TWO_HEADED_TROLL],
    });
    const allyInst = state.players[0].hand[0].instanceId;
    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === allyInst);
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('IS also playable at a TAPPED Ruins & Lairs with a Troll automatic-attack (Buhr Widu)', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: BUHR_WIDU,
      hand: [TWO_HEADED_TROLL],
      siteStatus: CardStatus.Tapped,
    });
    const allyInst = state.players[0].hand[0].instanceId;
    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === allyInst);
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a Ruins & Lairs without a Troll automatic-attack', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: OST_IN_EDHIL,
      hand: [TWO_HEADED_TROLL],
    });
    const allyInst = state.players[0].hand[0].instanceId;
    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === allyInst);
    expect(playActions).toHaveLength(0);
  });
});
