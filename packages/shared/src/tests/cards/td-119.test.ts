/**
 * @module td-119.test
 *
 * Card test: Gold Belt of Lórien (td-119)
 * Type: hero-resource-item (special), alignment wizard, unique.
 * Marshalling Points: 0. Corruption Points: 1.
 *
 * Card text: "Unique. Only playable at Lórien. +1 direct influence to
 * bearer."
 *
 * Rule coverage:
 *
 * | # | Rule                          | Mechanism                                          |
 * |---|-------------------------------|-----------------------------------------------------|
 * | 1 | Only playable at Lórien       | `item-play-site` `sites: ["Lórien"]`                 |
 * | 2 | +1 direct influence to bearer | `stat-modifier` `direct-influence`, value 1          |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  Phase, Alignment,
  ARAGORN, MINAS_TIRITH, MORIA,
  LORIEN, RIVENDELL,
  resetMint,
  buildTestState, buildSitePhaseState,
  viableActions, dispatch,
  attachItemToChar, recomputeDerived,
  getCharacter,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const GOLD_BELT = 'td-119' as CardDefinitionId;

describe('Gold Belt of Lórien (td-119)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: only playable at Lórien ──

  test('playable at Lórien during the site phase', () => {
    const state = buildSitePhaseState({ site: LORIEN, characters: [ARAGORN], hand: [GOLD_BELT] });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(1);
  });

  test('playing it at Lórien attaches the belt to the bearer', () => {
    const state = buildSitePhaseState({ site: LORIEN, characters: [ARAGORN], hand: [GOLD_BELT] });
    const after = dispatch(state, viableActions(state, PLAYER_1, 'play-hero-resource')[0].action);
    expect(getCharacter(after, RESOURCE_PLAYER, ARAGORN).items.map(i => i.definitionId)).toEqual([GOLD_BELT]);
  });

  test('NOT playable at Rivendell (a different Haven)', () => {
    const state = buildSitePhaseState({ site: RIVENDELL, characters: [ARAGORN], hand: [GOLD_BELT] });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  test('NOT playable at Moria', () => {
    const state = buildSitePhaseState({ site: MORIA, characters: [ARAGORN], hand: [GOLD_BELT] });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  // ── Rule 2: +1 direct influence to bearer ──

  function statsState(): GameState {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    return recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, GOLD_BELT));
  }

  test('bearer gains +1 direct influence', () => {
    const stats = getCharacter(statsState(), RESOURCE_PLAYER, ARAGORN).effectiveStats;
    expect(stats.directInfluence).toBe(4); // base 3 + 1
  });
});
