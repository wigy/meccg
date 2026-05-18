/**
 * @module as-68.test
 *
 * Card test: Bow of the Galadhrim (as-68)
 * Type: hero-resource-item (major)
 * Unique: true
 * MP: 2 (item) | Corruption: 1
 *
 * Card text:
 *   "Unique. The following effect applies only if the bearer is an Elf Warrior.
 *    In company versus company combat, make a roll before strikes are assigned
 *    for each non-unique minion ally in the company the bearer is facing. If the
 *    result for an ally is greater than the ally's mind plus five, discard the ally."
 *
 * Effects:
 *   1. on-event: cvc-combat-pre-strike — for each non-unique minion ally in the
 *      opponent's company, roll 2d6; if roll > ally.mind + 5, discard ally.
 *      Condition: bearer is Elf AND bearer has warrior skill.
 *
 * | # | Effect Type | Status          | Notes                                           |
 * |---|-------------|-----------------|------------------------------------------------|
 * | 1 | on-event    | NOT IMPLEMENTED | cvc-combat-pre-strike trigger not in engine;   |
 * |   |             |                 | CvCC combat phase has no reducer implementation |
 *
 * Data fixes applied:
 *   - corruptionPoints: 0 → 1 (canonical cards.json AS-68 has "corruption": "1")
 *   - effects array added (documents the CvCC pre-strike roll intent)
 *
 * Playable: PARTIALLY
 * NOT CERTIFIED — CvCC combat phase not implemented in engine.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  LEGOLAS,
  MORIA,
  resetMint,
  buildSitePhaseState,
  viableActions,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const BOW_OF_THE_GALADHRIM = 'as-68' as CardDefinitionId;

describe('Bow of the Galadhrim (as-68)', () => {
  beforeEach(() => resetMint());

  // ─── Basic playability ───────────────────────────────────────────────────────
  // The Bow is a major item; it should be offered at any site allowing major items.
  // Moria (tw-413) allows minor, major, greater, and gold-ring items.
  // Legolas (tw-168) is an Elf Warrior — the intended bearer.

  test('major item is offered at Moria with Legolas (Elf Warrior) in company', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [LEGOLAS],
      hand: [BOW_OF_THE_GALADHRIM],
    });
    const bowInstId = state.players[0].hand[0].instanceId;

    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.some(ea => {
      const a = ea.action as { cardInstanceId?: string };
      return a.cardInstanceId === (bowInstId as string);
    })).toBe(true);
  });

  // ─── CvCC pre-strike roll — NOT IMPLEMENTED ─────────────────────────────────

  test.todo(
    'in company-vs-company combat, Elf Warrior bearer triggers pre-strike roll ' +
    'for each non-unique minion ally in opposing company: roll > mind+5 discards the ally',
  );
});
