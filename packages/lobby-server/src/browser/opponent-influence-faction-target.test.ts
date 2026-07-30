/**
 * @module opponent-influence-faction-target.test
 *
 * Regression test for bug report 4962d549b6fcedb5 (game ms793m80-xmj2e8, seq
 * 1172): "Je ne peux pas influencer les factions adverses" ("I cannot
 * influence opposing factions").
 *
 * The engine correctly offered `opponent-influence-attempt` actions targeting
 * an opponent's in-play faction, but factions (a bearer-less `cardsInPlay`
 * entry) render in the flat cards-in-play row, not inside a company block —
 * so unlike character/ally/item targets (wired by `addOpponentInfluenceTargets`
 * on the opponent's rendered company blocks), clicking a faction card never
 * had a handler attached and the second click of the targeting flow silently
 * did nothing. `findOpponentInfluenceTargetActions` now resolves the viable
 * attempt(s) for a board card so the cards-in-play renderer can wire it; this
 * test asserts that resolution.
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardInstanceId, GameAction } from '@meccg/shared';
import { findOpponentInfluenceTargetActions } from './company-block.js';

const INFLUENCER = 'p1-187' as CardInstanceId; // td-93, in the reported game
const OTHER_INFLUENCER = 'p1-201' as CardInstanceId; // tw-178, also in the reported game
const FACTION = 'p2-8' as CardInstanceId; // tw-277 (Men of Anórien), the reported target
const OTHER_CARD = 'p2-9' as CardInstanceId;

const attemptNoReveal: GameAction = {
  type: 'opponent-influence-attempt',
  player: 'p1',
  influencingCharacterId: INFLUENCER,
  targetPlayer: 'p2',
  targetInstanceId: FACTION,
  targetKind: 'faction',
} as GameAction;

const attemptWithReveal: GameAction = {
  type: 'opponent-influence-attempt',
  player: 'p1',
  influencingCharacterId: INFLUENCER,
  targetPlayer: 'p2',
  targetInstanceId: FACTION,
  targetKind: 'faction',
  revealedCardInstanceId: 'p1-183' as CardInstanceId,
} as GameAction;

const attemptOtherInfluencer: GameAction = {
  type: 'opponent-influence-attempt',
  player: 'p1',
  influencingCharacterId: OTHER_INFLUENCER,
  targetPlayer: 'p2',
  targetInstanceId: FACTION,
  targetKind: 'faction',
} as GameAction;

const attemptOtherTarget: GameAction = {
  type: 'opponent-influence-attempt',
  player: 'p1',
  influencingCharacterId: INFLUENCER,
  targetPlayer: 'p2',
  targetInstanceId: OTHER_CARD,
  targetKind: 'faction',
} as GameAction;

const actions: GameAction[] = [
  attemptNoReveal,
  attemptWithReveal,
  attemptOtherInfluencer,
  attemptOtherTarget,
];

describe('opponent-influence-attempt surfaces an opponent faction as a click target', () => {
  test('resolves every reveal variant for the selected influencer targeting this faction', () => {
    expect(findOpponentInfluenceTargetActions(actions, INFLUENCER, FACTION)).toEqual([
      attemptNoReveal,
      attemptWithReveal,
    ]);
  });

  test('ignores actions from a different influencer or against a different target', () => {
    expect(findOpponentInfluenceTargetActions(actions, OTHER_INFLUENCER, FACTION)).toEqual([
      attemptOtherInfluencer,
    ]);
    expect(findOpponentInfluenceTargetActions(actions, INFLUENCER, OTHER_CARD)).toEqual([
      attemptOtherTarget,
    ]);
  });

  test('no target actions for an unrelated card', () => {
    expect(findOpponentInfluenceTargetActions(actions, INFLUENCER, 'p2-999' as CardInstanceId)).toEqual([]);
  });
});
