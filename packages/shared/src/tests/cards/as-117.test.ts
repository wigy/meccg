/**
 * @module as-117.test
 *
 * Card test: Itangast Roused (as-117)
 * Type: minion-resource-faction (dragon, unique, 6 MP, influence # 16, manifestId td-36)
 *
 * "Unique. Manifestation of Itangast. Playable at Gold Hill if the influence
 *  check is greater than 15. Modifications: influencer discards a major item
 *  (+4) or a greater item (+8). All attacks by manifestations of Itangast
 *  against any of your companies are canceled. Any company moving in Withered
 *  Heath, Iron Hills, Northern Rhovanion, and/or Grey Mountain Narrows faces
 *  one attack: Dragon — 3 strikes at 18/8."
 *
 * Rule-by-rule interpretation:
 *  - "Unique. Manifestation of Itangast" → `unique: true` plus
 *    `manifestId: td-36` (Itangast's chain), so it cannot be played while
 *    Itangast, Itangast Ahunt (td-37) or Itangast at Home is in play.
 *  - "Playable at Gold Hill … greater than 15" → `playableAt.site` plus
 *    influence # 16; `need = 16 - modifiers`.
 *  - "Modifications: influencer discards a major item (+4) or a greater item
 *    (+8)" → an `influence-modification` effect.
 *  - "All attacks by manifestations of Itangast … are canceled" → a
 *    `cancel-manifestation-attacks` effect (manifestId td-36).
 *  - "Any company moving in … faces one attack: Dragon — 3 strikes at 18/8"
 *    → an `ahunt-attack` effect over the four named regions (defender assigns
 *    strikes normally).
 *
 * Engine Support:
 * | # | Feature                                                 | Status      | Notes                                    |
 * |---|---------------------------------------------------------|-------------|------------------------------------------|
 * | 1 | Playable only at Gold Hill                              | IMPLEMENTED | `playableAt.site` match in site.ts       |
 * | 2 | Influence # 16 (greater than 15)                        | IMPLEMENTED | shared faction-influence machinery       |
 * | 3 | Manifestation uniqueness (blocked by Itangast in play)  | IMPLEMENTED | manifestId + manifestationInCardsInPlay  |
 * | 4 | Discard major item for +4 / greater item for +8         | IMPLEMENTED | influence-modification + discardForBonus |
 * | 5 | Region attack: Dragon 3×18/8                            | IMPLEMENTED | ahunt-attack in order-effects step       |
 * | 6 | Itangast manifestation attacks canceled vs your companies | IMPLEMENTED | cancel-manifestation-attacks skip      |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildSitePhaseState, resetMint,
  PLAYER_1, RESOURCE_PLAYER,
  addCardInPlay, attachItemToChar,
  firstFactionInfluenceAttempt, buildAhuntOrderEffectsState,
  viableActions, dispatch,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { RegionType } from '../../index.js';
import type { CardDefinitionId, CombatState, InfluenceAttemptAction } from '../../index.js';

const ITANGAST_ROUSED = 'as-117' as CardDefinitionId;   // this card (minion faction, manifestId td-36)
const ITANGAST_AHUNT = 'td-37' as CardDefinitionId;     // Itangast Ahunt — same chain (manifestId td-36)
const GOLD_HILL = 'as-148' as CardDefinitionId;         // minion Gold Hill (faction's home site)
const GOBLIN_GATE = 'le-378' as CardDefinitionId;       // shadow-hold (not Gold Hill)
const CIRYAHER = 'le-6' as CardDefinitionId;            // dúnadan, DI 2, no effects
const MAJOR_ITEM = 'le-301' as CardDefinitionId;        // Black-mail Coat (major, no effects)
const GREATER_ITEM = 'le-314' as CardDefinitionId;      // The Iron Crown (greater, no effects)

const PATH_IRON_HILLS = { pathNames: ['Iron Hills'], pathTypes: [RegionType.Wilderness] } as const;
const PATH_NON_MATCHING = { pathNames: ['Belfalas'], pathTypes: [RegionType.Wilderness] } as const;

describe('Itangast Roused (as-117)', () => {
  beforeEach(() => resetMint());

  // ─── Playability & influence at Gold Hill ──────────────────────────────────

  test('influence-attempt is legal at Gold Hill with baseline need = 14 (16 - DI 2)', () => {
    // Regression: game mvufyzxp-jo2x5r — Itangast Roused had no playableAt, so a
    // company at Gold Hill could not attempt to influence it.
    const state = buildSitePhaseState({ characters: [CIRYAHER], site: GOLD_HILL, hand: [ITANGAST_ROUSED] });
    const factionInstanceId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(14);
  });

  test('faction is NOT influenceable at a site other than Gold Hill', () => {
    const state = buildSitePhaseState({ characters: [CIRYAHER], site: GOBLIN_GATE, hand: [ITANGAST_ROUSED] });
    const factionInstanceId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeUndefined();
  });

  test('Manifestation: not influenceable while Itangast Ahunt is in play', () => {
    const base = buildSitePhaseState({ characters: [CIRYAHER], site: GOLD_HILL, hand: [ITANGAST_ROUSED] });
    const state = addCardInPlay(base, 1, ITANGAST_AHUNT);
    const factionInstanceId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeUndefined();
  });

  // ─── Modifications: discard an item for an influence bonus ─────────────────

  test('carrying a major item offers a discard variant with need lowered by 4 (14 → 10)', () => {
    const base = buildSitePhaseState({ characters: [CIRYAHER], site: GOLD_HILL, hand: [ITANGAST_ROUSED] });
    const state = attachItemToChar(base, RESOURCE_PLAYER, CIRYAHER, MAJOR_ITEM);
    const attempts = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction);
    expect(attempts.find(a => a.discardForBonus?.value === 4)?.need).toBe(10);
  });

  test('carrying a greater item offers a discard variant with need lowered by 8 (14 → 6)', () => {
    const base = buildSitePhaseState({ characters: [CIRYAHER], site: GOLD_HILL, hand: [ITANGAST_ROUSED] });
    const state = attachItemToChar(base, RESOURCE_PLAYER, CIRYAHER, GREATER_ITEM);
    const attempts = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction);
    expect(attempts.find(a => a.discardForBonus?.value === 8)?.need).toBe(6);
  });

  // ─── Region attack (ahunt) ─────────────────────────────────────────────────

  test('opponent moving through Iron Hills faces Dragon 3×18/8, defender assigns strikes', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: ITANGAST_ROUSED, ...PATH_IRON_HILLS });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);

    expect(next.combat).not.toBeNull();
    const combat = next.combat as CombatState;
    expect(combat.attackSource.type).toBe('ahunt');
    expect(combat.strikesTotal).toBe(3);
    expect(combat.strikeProwess).toBe(18);
    expect(combat.creatureBody).toBe(8);
    expect(combat.creatureRace).toBe('dragon');
    expect(combat.assignmentPhase).toBe('defender');
  });

  test('moving through a non-listed region does not trigger the region attack', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: ITANGAST_ROUSED, ...PATH_NON_MATCHING });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  // ─── cancel-manifestation-attacks ──────────────────────────────────────────

  test("an opponent's Itangast Ahunt is canceled while you control Itangast Roused", () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: ITANGAST_AHUNT, ...PATH_IRON_HILLS,
      movingPlayerCardsInPlay: [ITANGAST_ROUSED],
    });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test("the controller's own moving company does NOT face Itangast Roused's region attack", () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: ITANGAST_ROUSED, ...PATH_IRON_HILLS, ahuntOwnerIndex: 0,
    });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });
});
