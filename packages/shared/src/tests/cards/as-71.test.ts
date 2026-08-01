/**
 * @module as-71.test
 *
 * Card test: The Balrog (as-71)
 * Type: minion-resource-ally (Ringwraith)
 *
 * Text:
 *   "Unique. Manifestation of Balrog of Moria. Playable by a non-Ringwraith
 *   character at the Under-gates. ..."
 *
 * Bug: the card's `playableAt` list was empty (`[]`), so it was never offered
 * as playable at any site — including its own printed site, The Under-gates
 * (as-165). Fixed by adding a `{ site: "The Under-gates" }` entry.
 *
 * Playable: YES (site restriction only; the other printed rules are untested here)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  RESOURCE_PLAYER,
  resetMint,
  buildMinionSitePhaseState,
  viableActions,
  findHandCardId,
} from '../test-helpers.js';
import type { CardDefinitionId, PlayHeroResourceAction } from '../../index.js';

const THE_BALROG = 'as-71' as CardDefinitionId;
const THE_UNDER_GATES = 'as-165' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId; // minion haven — not the Under-gates
const GRISHNAKH = 'le-12' as CardDefinitionId; // orc, non-Ringwraith minion character

describe('The Balrog (as-71)', () => {
  beforeEach(() => resetMint());

  test('is playable at The Under-gates', () => {
    const state = buildMinionSitePhaseState({
      characters: [GRISHNAKH],
      site: THE_UNDER_GATES,
      hand: [THE_BALROG],
    });
    const cardId = findHandCardId(state, RESOURCE_PLAYER, THE_BALROG);
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(actions).toHaveLength(1);
  });

  test('is NOT playable at a site other than The Under-gates', () => {
    const state = buildMinionSitePhaseState({
      characters: [GRISHNAKH],
      site: DOL_GULDUR,
      hand: [THE_BALROG],
    });
    const cardId = findHandCardId(state, RESOURCE_PLAYER, THE_BALROG);
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(actions).toHaveLength(0);
  });
});
