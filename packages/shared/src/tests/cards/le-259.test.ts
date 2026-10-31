/**
 * @module le-259.test
 *
 * Card test: Agburanar Roused (le-259)
 * Type: minion-resource-faction (dragon, unique, 4 MP, influence # 13)
 *
 * "Unique. Manifestation of Agburanar. Playable at Caves of Ûlund if the
 *  influence check is greater than 12. Modifications: influencer discards a
 *  major item (+3) or a greater item (+6). All attacks by manifestations of
 *  Agburanar against any of your companies are canceled. Any company moving in
 *  Withered Heath, Northern Rhovanion, Grey Mountain Narrows, and/or Iron Hills
 *  faces one attack: Dragon — 2 strikes at 15/9."
 *
 * Regression: the card data named its playable site "Caves" instead of
 * "Caves of Ûlund", so the faction could never be influenced at its site.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildMinionSitePhaseState, resetMint, firstFactionInfluenceAttempt,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const AGBURANAR_ROUSED = 'le-259' as CardDefinitionId;

const GRISHNAKH = 'le-12' as CardDefinitionId; // orc, no effects, DI 0 (clean influencer)

const CAVES_OF_ULUND = 'le-360' as CardDefinitionId; // playable
const DOL_GULDUR = 'le-367' as CardDefinitionId;     // not a playable site

describe('Agburanar Roused (le-259)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Caves of Ûlund with baseline need = 13 (DI 0)', () => {
    const state = buildMinionSitePhaseState({ site: CAVES_OF_ULUND, characters: [GRISHNAKH], hand: [AGBURANAR_ROUSED] });
    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(13);
  });

  test('faction is NOT influenceable at a non-playable site (Dol Guldur)', () => {
    const state = buildMinionSitePhaseState({ site: DOL_GULDUR, characters: [GRISHNAKH], hand: [AGBURANAR_ROUSED] });
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeUndefined();
  });
});
