/**
 * @module le-284.test
 *
 * Card test: Scorba Roused (le-284)
 * Type: minion-resource-faction (dragon, unique, 3 MP, influence # 12, manifestId td-63)
 *
 * "Unique. Manifestation of Scorba. Playable at Zarak Dûm if the influence check
 *  is greater than 11. Modifications: influencer discards a major item (+3) or a
 *  greater item (+6). All attacks by manifestations of Scorba against any of your
 *  companies are canceled. Any company moving in Angmar, Gundabad, and/or
 *  Forochel faces one attack: Dragon — 3 strikes at 12/8 (attacker chooses
 *  defending characters)."
 *
 * Rule-by-rule interpretation:
 *  - "Unique. Manifestation of Scorba" → `unique: true` plus `manifestId: td-63`
 *    (Scorba's chain). Wires the faction into manifestation uniqueness (g.man.1):
 *    it cannot be played while another form of Scorba — the basic creature
 *    (td-63), the Ahunt long-event (td-64), or Scorba at Home (td-65) — is in
 *    play on either side.
 *  - "Playable at Zarak Dûm … greater than 11" → `playableAt.site` (le-417) plus
 *    influence # 12 (a check strictly greater than 11 succeeds);
 *    `need = 12 - modifiers`.
 *  - "Modifications: influencer discards a major item (+3) or a greater item
 *    (+6)" → an `influence-modification` effect. The legal-action generator
 *    offers, per eligible carried item, an extra influence-attempt whose `need`
 *    is already lowered by the option value and which discards that item on
 *    declare; the bonus is threaded onto the roll.
 *  - "All attacks by manifestations of Scorba against any of your companies are
 *    canceled" → a `cancel-manifestation-attacks` effect (manifestId td-63).
 *    While its controller is the moving player, any Ahunt sourced from a Scorba
 *    manifestation (this faction's own region attack, or an opponent's Scorba
 *    Ahunt) is skipped in the order-effects step.
 *  - "Any company moving in Angmar, Gundabad, and/or Forochel faces one attack:
 *    Dragon — 3 strikes at 12/8 (attacker chooses defending characters)" → an
 *    `ahunt-attack` effect over the three named regions.
 *
 * Engine Support:
 * | # | Feature                                                 | Status      | Notes                                    |
 * |---|---------------------------------------------------------|-------------|------------------------------------------|
 * | 1 | Playable only at Zarak Dûm                              | IMPLEMENTED | `playableAt.site` match in site.ts       |
 * | 2 | Influence # 12 (greater than 11)                        | IMPLEMENTED | shared faction-influence machinery       |
 * | 3 | Manifestation uniqueness (blocked by Scorba in play)    | IMPLEMENTED | manifestId + manifestationInCardsInPlay  |
 * | 4 | Discard major item for +3 / greater item for +6         | IMPLEMENTED | influence-modification + discardForBonus |
 * | 5 | Region attack: Dragon 3×12/8, attacker chooses          | IMPLEMENTED | ahunt-attack in order-effects step       |
 * | 6 | Scorba manifestation attacks canceled vs your companies | IMPLEMENTED | cancel-manifestation-attacks skip        |
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

const SCORBA_ROUSED = 'le-284' as CardDefinitionId;     // this card (minion faction, manifestId td-63)
const SCORBA_AHUNT = 'td-64' as CardDefinitionId;       // Scorba Ahunt — same chain (manifestId td-63)
const ZARAK_DUM = 'le-417' as CardDefinitionId;         // ruins-and-lairs (faction's home site)
const GOBLIN_GATE = 'le-378' as CardDefinitionId;       // shadow-hold (not Zarak Dûm)
const CIRYAHER = 'le-6' as CardDefinitionId;            // dúnadan, DI 2, no effects
const MAJOR_ITEM = 'le-301' as CardDefinitionId;        // Black-mail Coat (major, no effects)
const GREATER_ITEM = 'le-314' as CardDefinitionId;      // The Iron Crown (greater, no effects)

// Movement paths that trigger (or not) the region attack.
const PATH_ANGMAR = { pathNames: ['Angmar'], pathTypes: [RegionType.Shadow] } as const;
const PATH_GUNDABAD = { pathNames: ['Gundabad'], pathTypes: [RegionType.Dark] } as const;
const PATH_FOROCHEL = { pathNames: ['Forochel'], pathTypes: [RegionType.Wilderness] } as const;
const PATH_NON_MATCHING = { pathNames: ['Belfalas'], pathTypes: [RegionType.Free] } as const;

describe('Scorba Roused (le-284)', () => {
  beforeEach(() => resetMint());

  // ─── Region attack (ahunt) ─────────────────────────────────────────────────

  test('opponent moving through Angmar faces Dragon 3×12/8, attacker chooses defenders', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SCORBA_ROUSED, ...PATH_ANGMAR });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);

    expect(next.combat).not.toBeNull();
    const combat = next.combat as CombatState;
    expect(combat.attackSource.type).toBe('ahunt');
    expect(combat.strikesTotal).toBe(3);
    expect(combat.strikeProwess).toBe(12);
    expect(combat.creatureBody).toBe(8);
    expect(combat.creatureRace).toBe('dragon');
    // "attacker chooses defending characters" → cancel-window before assignment
    expect(combat.assignmentPhase).toBe('cancel-window');
  });

  test('opponent moving through Gundabad faces the region attack', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SCORBA_ROUSED, ...PATH_GUNDABAD });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('opponent moving through Forochel faces the region attack', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SCORBA_ROUSED, ...PATH_FOROCHEL });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('moving through a non-listed region does not trigger the region attack', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SCORBA_ROUSED, ...PATH_NON_MATCHING });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  // ─── cancel-manifestation-attacks ──────────────────────────────────────────

  test("the controller's own moving company does NOT face Scorba Roused's region attack", () => {
    // Scorba Roused is in the MOVING player's own play area: its
    // cancel-manifestation-attacks (td-63) suppresses its own region attack.
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: SCORBA_ROUSED, ...PATH_ANGMAR, ahuntOwnerIndex: 0,
    });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('control: with Scorba Roused on the OPPONENT, the mover still faces the attack', () => {
    // Same region, but the faction sits with the opponent — the mover controls
    // no cancellation, so the region attack fires (pins the previous skip to
    // ownership, not the path).
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: SCORBA_ROUSED, ...PATH_ANGMAR, ahuntOwnerIndex: 1,
    });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
  });

  test("an opponent's Scorba Ahunt is canceled while you control Scorba Roused", () => {
    // Opponent has Scorba Ahunt (td-64, same chain) in play; the moving player
    // controls Scorba Roused. "All attacks by manifestations of Scorba against
    // any of your companies are canceled" → no combat.
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: SCORBA_AHUNT, ...PATH_ANGMAR,
      movingPlayerCardsInPlay: [SCORBA_ROUSED],
    });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test("control: an opponent's Scorba Ahunt fires when you do NOT control Scorba Roused", () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: SCORBA_AHUNT, ...PATH_ANGMAR });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  // ─── Playability & influence at Zarak Dûm ──────────────────────────────────

  test('influence-attempt is legal at Zarak Dûm with baseline need = 10 (12 - DI 2)', () => {
    const state = buildSitePhaseState({ characters: [CIRYAHER], site: ZARAK_DUM, hand: [SCORBA_ROUSED] });
    const factionInstanceId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(10);
  });

  test('faction is NOT influenceable at a site other than Zarak Dûm', () => {
    const state = buildSitePhaseState({ characters: [CIRYAHER], site: GOBLIN_GATE, hand: [SCORBA_ROUSED] });
    const factionInstanceId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeUndefined();
  });

  // ─── Manifestation uniqueness (g.man.1) ────────────────────────────────────

  test('Manifestation: not influenceable while a Scorba manifestation (Scorba Ahunt) is in play', () => {
    const base = buildSitePhaseState({ characters: [CIRYAHER], site: ZARAK_DUM, hand: [SCORBA_ROUSED] });
    // Scorba Ahunt (td-64, manifestId td-63) in the opponent's play area.
    const state = addCardInPlay(base, 1, SCORBA_AHUNT);
    const factionInstanceId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeUndefined();
  });

  test('Manifestation control: influenceable again once no Scorba manifestation is in play', () => {
    const state = buildSitePhaseState({ characters: [CIRYAHER], site: ZARAK_DUM, hand: [SCORBA_ROUSED] });
    const factionInstanceId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
  });

  // ─── Modifications: discard an item for an influence bonus ─────────────────

  test('carrying a major item offers a discard variant with need lowered by 3 (10 → 7)', () => {
    const base = buildSitePhaseState({ characters: [CIRYAHER], site: ZARAK_DUM, hand: [SCORBA_ROUSED] });
    const state = attachItemToChar(base, RESOURCE_PLAYER, CIRYAHER, MAJOR_ITEM);
    const attempts = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction);

    const base10 = attempts.find(a => !a.discardForBonus);
    const discard3 = attempts.find(a => a.discardForBonus?.value === 3);
    expect(base10?.need).toBe(10);
    expect(discard3).toBeDefined();
    expect(discard3!.need).toBe(7);
  });

  test('carrying a greater item offers a discard variant with need lowered by 6 (10 → 4)', () => {
    const base = buildSitePhaseState({ characters: [CIRYAHER], site: ZARAK_DUM, hand: [SCORBA_ROUSED] });
    const state = attachItemToChar(base, RESOURCE_PLAYER, CIRYAHER, GREATER_ITEM);
    const attempts = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction);

    const discard6 = attempts.find(a => a.discardForBonus?.value === 6);
    expect(discard6).toBeDefined();
    expect(discard6!.need).toBe(4);
  });

  test('no discard variant is offered when the influencer carries no matching item', () => {
    const state = buildSitePhaseState({ characters: [CIRYAHER], site: ZARAK_DUM, hand: [SCORBA_ROUSED] });
    const attempts = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction);
    expect(attempts.every(a => !a.discardForBonus)).toBe(true);
  });

  test('discarding a major item (+3) discards the item and succeeds at a roll that would otherwise fail', () => {
    const base = buildSitePhaseState({ characters: [CIRYAHER], site: ZARAK_DUM, hand: [SCORBA_ROUSED] });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, CIRYAHER, MAJOR_ITEM);
    const ciryaherId = findCharInstanceId(withItem, RESOURCE_PLAYER, CIRYAHER);
    const majorInstanceId = withItem.players[RESOURCE_PLAYER].characters[ciryaherId].items[0].instanceId;

    const discard3 = computeLegalActions(withItem, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction)
      .find(a => a.discardForBonus?.value === 3)!;
    expect(discard3.need).toBe(7);

    // Roll total = cheat 7 + DI 2 + bonus 3 = 12 ≥ influence # 12 → success.
    const withCheat = { ...withItem, cheatRollTotal: 7 };
    const afterAttempt = resolveChain(dispatch(withCheat, discard3));
    const rollAction = computeLegalActions(afterAttempt, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'faction-influence-roll')[0].action;
    const after = dispatch(afterAttempt, rollAction);

    // Item discarded (cost paid) and faction now in play.
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === MAJOR_ITEM)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].characters[ciryaherId].items.some(i => i.instanceId === majorInstanceId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === SCORBA_ROUSED)).toBe(true);
  });

  test('control: the same roll without the discard fails and the item is untouched', () => {
    const base = buildSitePhaseState({ characters: [CIRYAHER], site: ZARAK_DUM, hand: [SCORBA_ROUSED] });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, CIRYAHER, MAJOR_ITEM);
    const ciryaherId = findCharInstanceId(withItem, RESOURCE_PLAYER, CIRYAHER);

    const baseAttempt = computeLegalActions(withItem, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction)
      .find(a => !a.discardForBonus)!;
    expect(baseAttempt.need).toBe(10);

    // Roll total = cheat 7 + DI 2 = 9 < influence # 12 → failure.
    const withCheat = { ...withItem, cheatRollTotal: 7 };
    const afterAttempt = resolveChain(dispatch(withCheat, baseAttempt));
    const rollAction = computeLegalActions(afterAttempt, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'faction-influence-roll')[0].action;
    const after = dispatch(afterAttempt, rollAction);

    // Faction failed to enter play; the major item was NOT discarded.
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === SCORBA_ROUSED)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === MAJOR_ITEM)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].characters[ciryaherId].items.some(i => i.definitionId === MAJOR_ITEM)).toBe(true);
  });
});
