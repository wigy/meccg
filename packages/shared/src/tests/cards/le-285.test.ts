/**
 * @module le-285.test
 *
 * Card test: Smaug Roused (le-285)
 * Type: minion-resource-faction (dragon, unique, 5 MP, influence # 13, manifestId tw-90)
 *
 * "Unique. Manifestation of Smaug. Playable at The Lonely Mountain if the
 *  influence check is greater than 12. Modifications: influencer discards a
 *  major item (+3) or a greater item (+6). All attacks by manifestations of
 *  Smaug against any of your companies are canceled. Any company moving in
 *  Withered Heath, Northern Rhovanion, Grey Mountain Narrows, and/or Iron Hills
 *  faces one attack: Dragon — 2 strikes at 17/8 (attacker chooses defending
 *  characters)."
 *
 * Rule-by-rule interpretation:
 *  - "Unique. Manifestation of Smaug" → `unique: true` plus `manifestId: tw-90`
 *    (Smaug's chain). Wires the faction into manifestation uniqueness (g.man.1):
 *    it cannot be played while another form of Smaug — the basic creature, the
 *    Ahunt long-event (td-70), or the At-Home permanent-event — is in play.
 *  - "Playable at The Lonely Mountain … greater than 12" → `playableAt.site`
 *    (le-387) plus influence # 13 (a check strictly greater than 12 succeeds);
 *    `need = 13 - modifiers`.
 *  - "Modifications: influencer discards a major item (+3) or a greater item
 *    (+6)" → an `influence-modification` effect. The legal-action generator
 *    offers, per eligible carried item, an extra influence-attempt whose `need`
 *    is already lowered by the option value and which discards that item on
 *    declare; the bonus is threaded onto the roll.
 *  - "All attacks by manifestations of Smaug against any of your companies are
 *    canceled" → a `cancel-manifestation-attacks` effect (manifestId tw-90).
 *    While its controller is the moving player, any Ahunt sourced from a Smaug
 *    manifestation (this faction's own region attack, or an opponent's Smaug
 *    Ahunt) is skipped in the order-effects step.
 *  - "Any company moving in … faces one attack: Dragon — 2 strikes at 17/8
 *    (attacker chooses defending characters)" → an `ahunt-attack` effect over
 *    the four named regions.
 *
 * Engine Support:
 * | # | Feature                                                 | Status      | Notes                                    |
 * |---|---------------------------------------------------------|-------------|------------------------------------------|
 * | 1 | Playable only at The Lonely Mountain                    | IMPLEMENTED | `playableAt.site` match in site.ts       |
 * | 2 | Influence # 13 (greater than 12)                        | IMPLEMENTED | shared faction-influence machinery       |
 * | 3 | Manifestation uniqueness (blocked by Smaug in play)     | IMPLEMENTED | manifestId + manifestationInCardsInPlay  |
 * | 4 | Discard major item for +3 / greater item for +6         | IMPLEMENTED | influence-modification + discardForBonus |
 * | 5 | Region attack: Dragon 2×17/8, attacker chooses          | IMPLEMENTED | ahunt-attack in order-effects step       |
 * | 6 | Smaug manifestation attacks canceled vs your companies  | IMPLEMENTED | cancel-manifestation-attacks skip        |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildSitePhaseState, resetMint,
  PLAYER_1, RESOURCE_PLAYER,
  addCardInPlay, attachItemToChar, findCharInstanceId,
  firstFactionInfluenceAttempt, buildAhuntOrderEffectsState,
  viableActions, dispatch, resolveChain,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { RegionType } from '../../index.js';
import type { CardDefinitionId, CombatState, InfluenceAttemptAction } from '../../index.js';

const SMAUG_ROUSED = 'le-285' as CardDefinitionId;      // this card (minion faction, manifestId tw-90)
const SMAUG_AHUNT = 'td-70' as CardDefinitionId;        // Smaug Ahunt — same chain (manifestId tw-90)
const LONELY_MOUNTAIN = 'le-387' as CardDefinitionId;   // ruins-and-lairs (faction's home site)
const GOBLIN_GATE = 'le-378' as CardDefinitionId;       // shadow-hold (not Lonely Mountain)
const CIRYAHER = 'le-6' as CardDefinitionId;            // dúnadan, DI 2, no effects
const MAJOR_ITEM = 'le-301' as CardDefinitionId;        // Black-mail Coat (major, no effects)
const GREATER_ITEM = 'le-314' as CardDefinitionId;      // The Iron Crown (greater, no effects)

// Movement paths that trigger (or not) the region attack.
const PATH_WITHERED_HEATH = { pathNames: ['Withered Heath'], pathTypes: [RegionType.Wilderness] } as const;
const PATH_NORTHERN_RHOVANION = { pathNames: ['Northern Rhovanion'], pathTypes: [RegionType.Wilderness] } as const;
const PATH_IRON_HILLS = { pathNames: ['Iron Hills'], pathTypes: [RegionType.Wilderness] } as const;
const PATH_GREY_MOUNTAIN_NARROWS = { pathNames: ['Grey Mountain Narrows'], pathTypes: [RegionType.Shadow] } as const;
const PATH_NON_MATCHING = { pathNames: ['Belfalas'], pathTypes: [RegionType.Wilderness] } as const;

describe('Smaug Roused (le-285)', () => {
  beforeEach(() => resetMint());

  // ─── Region attack (ahunt) ─────────────────────────────────────────────────

  test('opponent moving through Withered Heath faces Dragon 2×17/8, attacker chooses defenders', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SMAUG_ROUSED, ...PATH_WITHERED_HEATH });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);

    expect(next.combat).not.toBeNull();
    const combat = next.combat as CombatState;
    expect(combat.attackSource.type).toBe('ahunt');
    expect(combat.strikesTotal).toBe(2);
    expect(combat.strikeProwess).toBe(17);
    expect(combat.creatureBody).toBe(8);
    expect(combat.creatureRace).toBe('dragon');
    // "attacker chooses defending characters" → cancel-window before assignment
    expect(combat.assignmentPhase).toBe('cancel-window');
  });

  test('opponent moving through Northern Rhovanion faces the region attack', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SMAUG_ROUSED, ...PATH_NORTHERN_RHOVANION });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('opponent moving through Iron Hills faces the region attack', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SMAUG_ROUSED, ...PATH_IRON_HILLS });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('opponent moving through Grey Mountain Narrows faces the region attack', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SMAUG_ROUSED, ...PATH_GREY_MOUNTAIN_NARROWS });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('moving through a non-listed region does not trigger the region attack', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SMAUG_ROUSED, ...PATH_NON_MATCHING });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  // ─── cancel-manifestation-attacks ──────────────────────────────────────────

  test("the controller's own moving company does NOT face Smaug Roused's region attack", () => {
    // Smaug Roused is in the MOVING player's own play area: its
    // cancel-manifestation-attacks (tw-90) suppresses its own region attack.
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: SMAUG_ROUSED, ...PATH_WITHERED_HEATH, ahuntOwnerIndex: 0,
    });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('control: with Smaug Roused on the OPPONENT, the mover still faces the attack', () => {
    // Same region, but the faction sits with the opponent — the mover controls
    // no cancellation, so the region attack fires (pins the previous skip to
    // ownership, not the path).
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: SMAUG_ROUSED, ...PATH_WITHERED_HEATH, ahuntOwnerIndex: 1,
    });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
  });

  test("an opponent's Smaug Ahunt is canceled while you control Smaug Roused", () => {
    // Opponent has Smaug Ahunt (td-70, same chain) in play; the moving player
    // controls Smaug Roused. "All attacks by manifestations of Smaug against any
    // of your companies are canceled" → no combat.
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: SMAUG_AHUNT, ...PATH_WITHERED_HEATH,
      movingPlayerCardsInPlay: [SMAUG_ROUSED],
    });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test("control: an opponent's Smaug Ahunt fires when you do NOT control Smaug Roused", () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SMAUG_AHUNT, ...PATH_WITHERED_HEATH });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  // ─── Playability & influence at The Lonely Mountain ────────────────────────

  test('influence-attempt is legal at The Lonely Mountain with baseline need = 11 (13 - DI 2)', () => {
    const state = buildSitePhaseState({ characters: [CIRYAHER], site: LONELY_MOUNTAIN, hand: [SMAUG_ROUSED] });
    const factionInstanceId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(11);
  });

  test('faction is NOT influenceable at a site other than The Lonely Mountain', () => {
    const state = buildSitePhaseState({ characters: [CIRYAHER], site: GOBLIN_GATE, hand: [SMAUG_ROUSED] });
    const factionInstanceId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeUndefined();
  });

  // ─── Manifestation uniqueness (g.man.1) ────────────────────────────────────

  test('Manifestation: not influenceable while a Smaug manifestation (Smaug Ahunt) is in play', () => {
    const base = buildSitePhaseState({ characters: [CIRYAHER], site: LONELY_MOUNTAIN, hand: [SMAUG_ROUSED] });
    // Smaug Ahunt (td-70, manifestId tw-90) in the opponent's play area.
    const state = addCardInPlay(base, 1, SMAUG_AHUNT);
    const factionInstanceId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeUndefined();
  });

  test('Manifestation control: influenceable again once no Smaug manifestation is in play', () => {
    const state = buildSitePhaseState({ characters: [CIRYAHER], site: LONELY_MOUNTAIN, hand: [SMAUG_ROUSED] });
    const factionInstanceId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
  });

  // ─── Modifications: discard an item for an influence bonus ─────────────────

  test('carrying a major item offers a discard variant with need lowered by 3 (11 → 8)', () => {
    const base = buildSitePhaseState({ characters: [CIRYAHER], site: LONELY_MOUNTAIN, hand: [SMAUG_ROUSED] });
    const state = attachItemToChar(base, RESOURCE_PLAYER, CIRYAHER, MAJOR_ITEM);
    const attempts = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction);

    const base11 = attempts.find(a => !a.discardForBonus);
    const discard3 = attempts.find(a => a.discardForBonus?.value === 3);
    expect(base11?.need).toBe(11);
    expect(discard3).toBeDefined();
    expect(discard3!.need).toBe(8);
  });

  test('carrying a greater item offers a discard variant with need lowered by 6 (11 → 5)', () => {
    const base = buildSitePhaseState({ characters: [CIRYAHER], site: LONELY_MOUNTAIN, hand: [SMAUG_ROUSED] });
    const state = attachItemToChar(base, RESOURCE_PLAYER, CIRYAHER, GREATER_ITEM);
    const attempts = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction);

    const discard6 = attempts.find(a => a.discardForBonus?.value === 6);
    expect(discard6).toBeDefined();
    expect(discard6!.need).toBe(5);
  });

  test('no discard variant is offered when the influencer carries no matching item', () => {
    const state = buildSitePhaseState({ characters: [CIRYAHER], site: LONELY_MOUNTAIN, hand: [SMAUG_ROUSED] });
    const attempts = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction);
    expect(attempts.every(a => !a.discardForBonus)).toBe(true);
  });

  test('discarding a greater item (+6) discards the item and succeeds at a roll that would otherwise fail', () => {
    const base = buildSitePhaseState({ characters: [CIRYAHER], site: LONELY_MOUNTAIN, hand: [SMAUG_ROUSED] });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, CIRYAHER, GREATER_ITEM);
    const ciryaherId = findCharInstanceId(withItem, RESOURCE_PLAYER, CIRYAHER);
    const greaterInstanceId = withItem.players[RESOURCE_PLAYER].characters[ciryaherId].items[0].instanceId;

    const discard6 = computeLegalActions(withItem, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction)
      .find(a => a.discardForBonus?.value === 6)!;
    expect(discard6.need).toBe(5);

    // Roll total = cheat 5 + DI 2 + bonus 6 = 13 ≥ influence # 13 → success.
    const withCheat = { ...withItem, cheatRollTotal: 5 };
    const afterAttempt = resolveChain(dispatch(withCheat, discard6));
    const rollAction = computeLegalActions(afterAttempt, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'faction-influence-roll')[0].action;
    const after = dispatch(afterAttempt, rollAction);

    // Item discarded (cost paid) and faction now in play.
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === GREATER_ITEM)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].characters[ciryaherId].items.some(i => i.instanceId === greaterInstanceId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === SMAUG_ROUSED)).toBe(true);
  });

  test('control: the same roll without the discard fails and the item is untouched', () => {
    const base = buildSitePhaseState({ characters: [CIRYAHER], site: LONELY_MOUNTAIN, hand: [SMAUG_ROUSED] });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, CIRYAHER, GREATER_ITEM);
    const ciryaherId = findCharInstanceId(withItem, RESOURCE_PLAYER, CIRYAHER);

    const baseAttempt = computeLegalActions(withItem, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction)
      .find(a => !a.discardForBonus)!;
    expect(baseAttempt.need).toBe(11);

    // Roll total = cheat 5 + DI 2 = 7 < influence # 13 → failure.
    const withCheat = { ...withItem, cheatRollTotal: 5 };
    const afterAttempt = resolveChain(dispatch(withCheat, baseAttempt));
    const rollAction = computeLegalActions(afterAttempt, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'faction-influence-roll')[0].action;
    const after = dispatch(afterAttempt, rollAction);

    // Faction failed to enter play; the greater item was NOT discarded.
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === SMAUG_ROUSED)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === GREATER_ITEM)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].characters[ciryaherId].items.some(i => i.definitionId === GREATER_ITEM)).toBe(true);
  });
});
