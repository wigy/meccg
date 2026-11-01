/**
 * @module le-259.test
 *
 * Card test: Agburanar Roused (le-259)
 * Type: minion-resource-faction (dragon, unique, 4 MP, influence # 13, manifestId tw-3)
 *
 * "Unique. Manifestation of Agburanar. Playable at Caves of Ûlund if the
 *  influence check is greater than 12. Modifications: influencer discards a
 *  major item (+3) or a greater item (+6). All attacks by manifestations of
 *  Agburanar against any of your companies are canceled. Any company moving in
 *  Withered Heath, Northern Rhovanion, Grey Mountain Narrows, and/or Iron Hills
 *  faces one attack: Dragon — 2 strikes at 15/9."
 *
 * Effects reuse the Roused-faction primitives of Smaug Roused (le-285):
 * `influence-modification`, `cancel-manifestation-attacks` (tw-3) and an
 * `ahunt-attack` over the four named regions (defender assigns strikes).
 *
 * Regressions:
 *  - the card data named its playable site "Caves" instead of
 *    "Caves of Ûlund", so the faction could never be influenced at its site.
 *  - game mvwygofe-tehqzz: the card had no effects, so Pallando's company
 *    moving (starter movement) through Wold & Foothills → Grey Mountain
 *    Narrows faced no Dragon attack.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildMinionSitePhaseState, resetMint, firstFactionInfluenceAttempt,
  PLAYER_1, buildAhuntOrderEffectsState, viableActions, dispatch,
} from '../test-helpers.js';
import { RegionType } from '../../index.js';
import type { CardDefinitionId, CombatState } from '../../index.js';

const AGBURANAR_ROUSED = 'le-259' as CardDefinitionId;
const AGBURANAR_AHUNT = 'td-1' as CardDefinitionId; // Agburanar Ahunt — same chain (manifestId tw-3)

const GRISHNAKH = 'le-12' as CardDefinitionId; // orc, no effects, DI 0 (clean influencer)

const CAVES_OF_ULUND = 'le-360' as CardDefinitionId; // playable
const DOL_GULDUR = 'le-367' as CardDefinitionId;     // not a playable site

const PATH_GREY_MOUNTAINS = {
  pathNames: ['Wold & Foothills', 'Grey Mountain Narrows'],
  pathTypes: [RegionType.Wilderness, RegionType.Wilderness],
} as const;
const PATH_NON_MATCHING = { pathNames: ['Belfalas'], pathTypes: [RegionType.Wilderness] } as const;

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

  // ─── Region attack (ahunt) ─────────────────────────────────────────────────

  test('opponent moving through Grey Mountain Narrows faces Dragon 2×15/9, defender assigns strikes', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: AGBURANAR_ROUSED, ...PATH_GREY_MOUNTAINS });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);

    expect(next.combat).not.toBeNull();
    const combat = next.combat as CombatState;
    expect(combat.attackSource.type).toBe('ahunt');
    expect(combat.strikesTotal).toBe(2);
    expect(combat.strikeProwess).toBe(15);
    expect(combat.creatureBody).toBe(9);
    expect(combat.creatureRace).toBe('dragon');
    expect(combat.assignmentPhase).toBe('defender');
  });

  test('moving through a non-listed region does not trigger the region attack', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: AGBURANAR_ROUSED, ...PATH_NON_MATCHING });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  // ─── cancel-manifestation-attacks ──────────────────────────────────────────

  test("an opponent's Agburanar Ahunt is canceled while you control Agburanar Roused", () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: AGBURANAR_AHUNT, ...PATH_GREY_MOUNTAINS,
      movingPlayerCardsInPlay: [AGBURANAR_ROUSED],
    });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });
});
