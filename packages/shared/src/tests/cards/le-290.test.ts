/**
 * @module le-290.test
 *
 * Card test: Ungol-orcs (le-290)
 * Type: minion-resource-faction (orc, unique, influence # 9)
 *
 * "Unique. Playable at Cirith Ungol if the influence check is greater than 8.
 *  ..."
 *
 * Regression: the card data named its playable site "Cirith" instead of
 * "Cirith Ungol", so the faction could never be influenced at its site.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildMinionSitePhaseState, resetMint, firstFactionInfluenceAttempt,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const UNGOL_ORCS = 'le-290' as CardDefinitionId;

const GRISHNAKH = 'le-12' as CardDefinitionId; // orc, no effects, DI 0 (clean influencer)

const CIRITH_UNGOL = 'le-362' as CardDefinitionId;  // playable
const DOL_GULDUR = 'le-367' as CardDefinitionId;    // not a playable site

describe('Ungol-orcs (le-290)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Cirith Ungol', () => {
    const state = buildMinionSitePhaseState({ site: CIRITH_UNGOL, characters: [GRISHNAKH], hand: [UNGOL_ORCS] });
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeDefined();
  });

  test('faction is NOT influenceable at a non-playable site (Dol Guldur)', () => {
    const state = buildMinionSitePhaseState({ site: DOL_GULDUR, characters: [GRISHNAKH], hand: [UNGOL_ORCS] });
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeUndefined();
  });
});
