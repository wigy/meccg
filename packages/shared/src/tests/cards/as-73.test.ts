/**
 * @module as-73.test
 *
 * Card test: Creature of an Older World (as-73)
 * Type: minion-resource-ally, alignment ringwraith, unique. 1 ally MP.
 *
 * Card text: "Unique. Playable on your Ringwraith at a tapped or untapped
 * Barad-dûr (does not tap the site). Its controlling character's company is
 * overt. Your Ringwraith receives +2 prowess. If your Ringwraith is the only
 * character in his company and there are not other allies, the company is in
 * Fell Rider mode and may move freely (using starter movement). Tap this ally
 * to: cancel a strike against your Ringwraith or to assign your Ringwraith's
 * strikes against a hero company as you choose before hero strikes are
 * assigned. Return your Ringwraith to your hand if this ally leaves active
 * play. Cannot be included in a Balrog's deck."
 *
 * Bug: `playableAt` was shipped empty, so the ally was never offered as
 * playable anywhere, including its printed home site (Barad-dûr). Fixed by
 * adding `playableAt: [{ site: "Barad-dûr" }]` plus the
 * `playable-at-tapped-site` play-flag for the "tapped or untapped" clause.
 *
 * This test covers only the play-condition bug (rule 1 below); the ally's
 * other effects (overt company, +2 prowess, Fell Rider mode, tap ability)
 * are not yet certified.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildMinionSitePhaseState, resetMint, CardStatus,
  PLAYER_1, RESOURCE_PLAYER,
  findHandCardId, findCharInstanceId,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const CREATURE_OF_AN_OLDER_WORLD = 'as-73' as CardDefinitionId;
const REN_RW = 'le-56' as CardDefinitionId;    // Ringwraith avatar
const BARAD_DUR = 'le-352' as CardDefinitionId; // minion dark-hold (name "Barad-dûr")
const CARN_DUM = 'le-359' as CardDefinitionId;  // a different minion dark-hold

describe('Creature of an Older World (as-73)', () => {
  beforeEach(() => resetMint());

  test('playable on the Ringwraith at an untapped Barad-dûr', () => {
    const state = buildMinionSitePhaseState({
      site: BARAD_DUR,
      characters: [REN_RW],
      hand: [CREATURE_OF_AN_OLDER_WORLD],
    });
    const cardId = findHandCardId(state, RESOURCE_PLAYER, CREATURE_OF_AN_OLDER_WORLD);
    const renId = findCharInstanceId(state, RESOURCE_PLAYER, REN_RW);

    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (cardId as string),
    );
    expect(plays).toHaveLength(1);
    expect((plays[0].action as { attachToCharacterId?: string }).attachToCharacterId).toBe(renId as string);
  });

  test('playable on the Ringwraith at an already-tapped Barad-dûr ("tapped or untapped")', () => {
    const state = buildMinionSitePhaseState({
      site: BARAD_DUR,
      characters: [REN_RW],
      hand: [CREATURE_OF_AN_OLDER_WORLD],
      siteStatus: CardStatus.Tapped,
    });
    const cardId = findHandCardId(state, RESOURCE_PLAYER, CREATURE_OF_AN_OLDER_WORLD);

    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (cardId as string),
    );
    expect(plays).toHaveLength(1);
  });

  test('NOT playable at a different dark-hold (only at Barad-dûr)', () => {
    const state = buildMinionSitePhaseState({
      site: CARN_DUM,
      characters: [REN_RW],
      hand: [CREATURE_OF_AN_OLDER_WORLD],
    });
    const cardId = findHandCardId(state, RESOURCE_PLAYER, CREATURE_OF_AN_OLDER_WORLD);

    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (cardId as string),
    );
    expect(plays).toHaveLength(0);
  });
});
