/**
 * @module td-113.test
 *
 * Card test: Emerald of the Mariner (td-113)
 * Type: hero-resource-item (greater), alignment wizard, unique.
 * Marshalling Points: 3. Corruption Points: 0.
 *
 * Text: "Unique. Hoard item. Bearer receives +1 to all of his corruption
 *  checks. You may keep one more card than normal in your hand. This item is
 *  considered a source of 0 corruption points."
 *
 * | # | Rule                                          | Mechanism                                          |
 * |---|------------------------------------------------|-----------------------------------------------------|
 * | 1 | Hoard item — playable only at a hoard site      | item-play-site filter site.keywords $includes hoard |
 * | 2 | Bearer: +1 to all his corruption checks         | check-modifier check="corruption" value=1            |
 * | 3 | You may keep one more card in hand              | hand-size-modifier value=1                           |
 * | 4 | Item is a source of 0 corruption points         | corruptionPoints: 0 (base data field)                |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  ARAGORN,
  buildTestState, buildSitePhaseState, resetMint, makePlayDeck,
  viableActions, findCharInstanceId, getCharacter,
  enqueueCorruptionCheck,
} from '../test-helpers.js';
import type { CardDefinitionId, CorruptionCheckAction, GameState } from '../../index.js';
import { Phase, Alignment } from '../../index.js';
import { resolveHandSize } from '../../engine/effects/index.js';
import { HAND_SIZE } from '../../constants.js';

const EMERALD_OF_THE_MARINER = 'td-113' as CardDefinitionId;
const IREROCK = 'tw-402' as CardDefinitionId; // hero ruins-and-lairs, hoard keyword
const RIVENDELL = 'tw-421' as CardDefinitionId; // hero haven, no hoard, empty playableResources
const LORIEN = 'tw-408' as CardDefinitionId;

/** Wizard organization-phase state with `bearer` holding the given items. */
function buildOrgState(opts: { bearer?: CardDefinitionId; items?: CardDefinitionId[] }): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{
          site: IREROCK,
          characters: [{ defId: opts.bearer ?? ARAGORN, items: opts.items ?? [EMERALD_OF_THE_MARINER] }],
        }],
        hand: [],
        siteDeck: [LORIEN],
        playDeck: makePlayDeck(),
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [IREROCK] },
    ],
  });
}

describe('Emerald of the Mariner (td-113)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: item-play-site (hoard sites only) ──

  test('playable at a hoard site (Irerock)', () => {
    const state = buildSitePhaseState({ site: IREROCK, hand: [EMERALD_OF_THE_MARINER] });

    expect(viableActions(state, PLAYER_1, 'play-hero-resource').length).toBe(1);
  });

  test('NOT playable at a non-hoard site (Rivendell)', () => {
    const state = buildSitePhaseState({ site: RIVENDELL, hand: [EMERALD_OF_THE_MARINER] });

    expect(viableActions(state, PLAYER_1, 'play-hero-resource').length).toBe(0);
  });

  // ── Effect 2: +1 to bearer's corruption checks ──

  test('corruption check is modified by +1 while the bearer holds the Emerald', () => {
    const state = buildOrgState({});
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const withCheck = enqueueCorruptionCheck(state, PLAYER_1, aragornId);

    const [action] = viableActions(withCheck, PLAYER_1, 'corruption-check');
    expect((action.action as CorruptionCheckAction).corruptionModifier).toBe(1);
  });

  test('no corruption-check modifier when the bearer does not hold the Emerald', () => {
    const state = buildOrgState({ items: [] });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const withCheck = enqueueCorruptionCheck(state, PLAYER_1, aragornId);

    const [action] = viableActions(withCheck, PLAYER_1, 'corruption-check');
    expect((action.action as CorruptionCheckAction).corruptionModifier).toBe(0);
  });

  // ── Effect 3: +1 hand size ──

  test('hand size is one higher while the bearer holds the Emerald', () => {
    const state = buildOrgState({});

    expect(resolveHandSize(state, RESOURCE_PLAYER)).toBe(HAND_SIZE + 1);
    // The opponent, who bears nothing, keeps the base hand size.
    expect(resolveHandSize(state, 1)).toBe(HAND_SIZE);
  });

  test('hand size is unchanged when the Emerald is not in play', () => {
    const state = buildOrgState({ items: [] });

    expect(resolveHandSize(state, RESOURCE_PLAYER)).toBe(HAND_SIZE);
  });

  // ── Effect 4: the Emerald is itself a source of 0 corruption points ──

  test('the Emerald contributes 0 corruption points to its bearer', () => {
    const state = buildOrgState({});

    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.corruptionPoints).toBe(0);
  });
});
