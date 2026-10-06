/**
 * @module dm-59.test
 *
 * Card test: Foes Shall Fall (dm-59)
 * Type: hazard-event (permanent), keyword Corruption
 *
 * "Corruption. Playable on a non-Wizard character facing a strike from a
 *  Dragon or Drake hazard creature attack. If the strike is defeated, discard
 *  this card. If the strike is not defeated, place creature's card with Foes
 *  Shall Fall—creature is considered off to the side. Target character's
 *  company faces an attack from creature at the start of each
 *  movement/hazard phase if creature is playable. Discard associated
 *  creature's card if Foes Shall Fall is discarded. Discard Foes Shall Fall if
 *  attached Dragon or Drake is defeated. If target character is a Dwarf, he
 *  receives 2 corruption points."
 *
 * Corruption "1(2)": 1 corruption point, 2 for a Dwarf.
 *
 * Engine Support:
 * | # | Rule                                          | Status      | Notes                                       |
 * |---|-----------------------------------------------|-------------|---------------------------------------------|
 * | 1 | Playable on a non-Wizard character facing a   | IMPLEMENTED | play-window combat/resolve-strike +          |
 * |   | strike from a Dragon/Drake hazard creature    |             | play-target filter on target.race,           |
 * |   | attack                                        |             | attack.race, attack.holdableCreature         |
 * | 2 | Strike defeated → discard this card           | IMPLEMENTED | hold-creature-if-strike-not-defeated →       |
 * |   |                                               |             | settlePendingHeldCreature                    |
 * | 3 | Strike not defeated → creature off to the     | IMPLEMENTED | CardInPlay.heldCreature on the attached card |
 * |   | side with this card                           |             |                                              |
 * | 4 | Company faces creature's attack at start of   | IMPLEMENTED | held-creature-attack, order-effects step;    |
 * |   | each M/H phase if creature is playable        |             | playability = creature's normal keying       |
 * | 5 | Discard creature if this card is discarded    | IMPLEMENTED | sweepOrphanedHeldCreatures / settle helpers  |
 * | 6 | Discard this card if the creature is defeated | IMPLEMENTED | settleHeldCreatureAttack                     |
 * | 7 | 1 corruption point, 2 for a Dwarf             | IMPLEMENTED | stat-modifier corruption-points (+1 dwarf)   |
 *
 * Playable: YES — every rule is implemented in the engine and exercised by
 * assertions below.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  attachHazardToChar, attachHolderWithCreature, addCardToHand,
  setupCombatWithCaveDrake, makeSingleCharCombatState, buildHeldCreatureOrderEffectsState,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, GANDALF,
  RIVENDELL, LORIEN, MORIA,
  findCharInstanceId, dispatch, viableActions, executeAction,
  expectInDiscardPile, expectInPile, assertEveryInstanceReachable,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, GameState, PlayHazardAction } from '../../index.js';
import { Race, RegionType } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const FOES_SHALL_FALL = 'dm-59' as CardDefinitionId;
// Land-drake: Drake, 1 strike, 8 prowess, no body; keyed to Wilderness.
const LAND_DRAKE = 'td-40' as CardDefinitionId;

describe('Foes Shall Fall (dm-59)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: play restrictions ────────────────────────────────────────────

  test('offered on a non-Wizard character facing a strike from a Drake creature attack', () => {
    const combat = setupCombatWithCaveDrake({ heroChars: [ARAGORN], creatureDefId: LAND_DRAKE, extraHazardHand: [FOES_SHALL_FALL] });
    const aragornId = findCharInstanceId(combat, RESOURCE_PLAYER, ARAGORN);
    const atStrike = dispatch(combat, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    expect(atStrike.combat?.phase).toBe('resolve-strike');

    const plays = viableActions(atStrike, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[];
    expect(plays).toHaveLength(1);
    expect(plays[0].action.targetCharacterId).toBe(aragornId);
  });

  test('NOT offered against a strike from a non-Dragon/Drake creature', () => {
    const state = addCardToHand(
      makeSingleCharCombatState({ heroDefId: ARAGORN, creatureRace: Race.Orc, creatureProwess: 9, creatureBody: null, preAssigned: true }),
      HAZARD_PLAYER, FOES_SHALL_FALL,
    );
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('NOT offered on a Wizard', () => {
    const state = addCardToHand(
      makeSingleCharCombatState({ heroDefId: GANDALF, creatureRace: Race.Drake, creatureProwess: 9, creatureBody: null, preAssigned: true }),
      HAZARD_PLAYER, FOES_SHALL_FALL,
    );
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('NOT offered against a Dragon automatic-attack (not a hazard creature attack)', () => {
    const creatureAttack = addCardToHand(
      makeSingleCharCombatState({ heroDefId: ARAGORN, creatureRace: Race.Dragon, creatureProwess: 9, creatureBody: null, preAssigned: true }),
      HAZARD_PLAYER, FOES_SHALL_FALL,
    );
    expect(viableActions(creatureAttack, PLAYER_2, 'play-hazard')).toHaveLength(1);

    const siteInstanceId = creatureAttack.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;
    const autoAttack: GameState = {
      ...creatureAttack,
      combat: { ...creatureAttack.combat!, attackSource: { type: 'automatic-attack', siteInstanceId, attackIndex: 0 } },
    };
    expect(viableActions(autoAttack, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── Rule 2: strike defeated → discard ────────────────────────────────────

  test('if the strike is defeated, Foes Shall Fall is discarded and the creature is defeated normally', () => {
    const combat = setupCombatWithCaveDrake({ heroChars: [ARAGORN], creatureDefId: LAND_DRAKE, extraHazardHand: [FOES_SHALL_FALL] });
    const aragornId = findCharInstanceId(combat, RESOURCE_PLAYER, ARAGORN);
    const atStrike = dispatch(combat, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    const [play] = viableActions(atStrike, PLAYER_2, 'play-hazard');
    const afterPlay = dispatch(atStrike, play.action);
    // Attached to the struck character while the strike resolves.
    expect(afterPlay.players[RESOURCE_PLAYER].characters[aragornId].hazards.map(h => h.definitionId)).toContain(FOES_SHALL_FALL);

    // Roll 12 + prowess 6 = 18 > 8: strike defeated.
    const done = executeAction(afterPlay, PLAYER_1, 'resolve-strike', 12, true);
    expect(done.combat).toBeNull();
    expectInDiscardPile(done, HAZARD_PLAYER, FOES_SHALL_FALL);
    expectInPile(done, RESOURCE_PLAYER, 'killPile', LAND_DRAKE);
    expect(done.players[RESOURCE_PLAYER].characters[aragornId].hazards).toHaveLength(0);
    assertEveryInstanceReachable(done);
  });

  // ─── Rule 3: strike not defeated → creature held off to the side ──────────

  test('if the strike wounds the character, the creature is placed off to the side with Foes Shall Fall', () => {
    const combat = setupCombatWithCaveDrake({ heroChars: [ARAGORN], creatureDefId: LAND_DRAKE, extraHazardHand: [FOES_SHALL_FALL] });
    const aragornId = findCharInstanceId(combat, RESOURCE_PLAYER, ARAGORN);
    const atStrike = dispatch(combat, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    const [play] = viableActions(atStrike, PLAYER_2, 'play-hazard');
    const afterPlay = dispatch(atStrike, play.action);

    // Roll 2 + prowess 6 - 3 (not tapping) = 5 < 8: wounded; body check 2 survives.
    const wounded = executeAction(afterPlay, PLAYER_1, 'resolve-strike', 2, false);
    expect(wounded.combat?.phase).toBe('body-check');
    const done = executeAction(wounded, PLAYER_2, 'body-check-roll', 2);

    expect(done.combat).toBeNull();
    const aragorn = done.players[RESOURCE_PLAYER].characters[aragornId];
    const host = aragorn.hazards.find(h => h.definitionId === FOES_SHALL_FALL);
    expect(host?.heldCreature?.definitionId).toBe(LAND_DRAKE);
    expect(done.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === LAND_DRAKE)).toBe(false);
    expect(done.players[RESOURCE_PLAYER].killPile.some(c => c.definitionId === LAND_DRAKE)).toBe(false);
    expect(aragorn.effectiveStats.corruptionPoints).toBe(1);
    assertEveryInstanceReachable(done);
  });

  test('an ineffectual (tied) strike is not defeated — the creature is held', () => {
    const combat = setupCombatWithCaveDrake({ heroChars: [ARAGORN], creatureDefId: LAND_DRAKE, extraHazardHand: [FOES_SHALL_FALL] });
    const aragornId = findCharInstanceId(combat, RESOURCE_PLAYER, ARAGORN);
    const atStrike = dispatch(combat, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    const [play] = viableActions(atStrike, PLAYER_2, 'play-hazard');
    const afterPlay = dispatch(atStrike, play.action);

    // Roll 2 + prowess 6 = 8 = strike prowess 8: tie.
    const done = executeAction(afterPlay, PLAYER_1, 'resolve-strike', 2, true);
    expect(done.combat).toBeNull();
    const host = done.players[RESOURCE_PLAYER].characters[aragornId].hazards.find(h => h.definitionId === FOES_SHALL_FALL);
    expect(host?.heldCreature?.definitionId).toBe(LAND_DRAKE);
    assertEveryInstanceReachable(done);
  });

  // ─── Rule 7: corruption points ────────────────────────────────────────────

  test('gives 1 corruption point, or 2 to a Dwarf', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, GIMLI] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withCards = recomputeDerived(attachHazardToChar(
      attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, FOES_SHALL_FALL, HAZARD_PLAYER),
      RESOURCE_PLAYER, GIMLI, FOES_SHALL_FALL, HAZARD_PLAYER,
    ));
    const chars = withCards.players[RESOURCE_PLAYER].characters;
    expect(chars[findCharInstanceId(withCards, RESOURCE_PLAYER, ARAGORN)].effectiveStats.corruptionPoints).toBe(1);
    expect(chars[findCharInstanceId(withCards, RESOURCE_PLAYER, GIMLI)].effectiveStats.corruptionPoints).toBe(2);
  });

  // ─── Rule 4: recurring attack at the start of each M/H phase ──────────────

  test('the company faces the held creature\'s attack at the start of its M/H phase when the creature is playable', () => {
    const { state, hostId, creatureId } = buildHeldCreatureOrderEffectsState({
      characters: [ARAGORN], holderOn: ARAGORN, hostDefId: FOES_SHALL_FALL, creatureDefId: LAND_DRAKE,
      pathTypes: [RegionType.Wilderness], pathNames: ['Hollin'],
    });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);

    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource).toEqual({ type: 'creature', instanceId: creatureId, heldByHostInstanceId: hostId });
    expect(next.combat!.creatureRace).toBe(Race.Drake);
    expect(next.combat!.strikeProwess).toBe(8);
    // Lifted off its holder while it attacks; the attack is no hazard play.
    const aragornId = findCharInstanceId(next, RESOURCE_PLAYER, ARAGORN);
    expect(next.players[RESOURCE_PLAYER].characters[aragornId].hazards[0].heldCreature).toBeUndefined();
    expect(next.phaseState.phase === Phase.MovementHazard && next.phaseState.hazardsPlayedThisCompany).toBe(0);
    assertEveryInstanceReachable(next);
  });

  test('no attack when the held creature is not playable on the company', () => {
    const { state, creatureId } = buildHeldCreatureOrderEffectsState({
      characters: [ARAGORN], holderOn: ARAGORN, hostDefId: FOES_SHALL_FALL, creatureDefId: LAND_DRAKE,
      pathTypes: [RegionType.Shadow], pathNames: ['Imlad Morgul'],
    });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);

    expect(next.combat).toBeNull();
    // The order-effects step proceeds (a non-moving company skips draw-cards).
    expect(next.phaseState.phase === Phase.MovementHazard && next.phaseState.step).toBe('play-hazards');
    const aragornId = findCharInstanceId(next, RESOURCE_PLAYER, ARAGORN);
    expect(next.players[RESOURCE_PLAYER].characters[aragornId].hazards[0].heldCreature?.instanceId).toBe(creatureId);
  });

  test('an undefeated recurring attack returns the creature off to the side with Foes Shall Fall', () => {
    const { state, hostId, creatureId } = buildHeldCreatureOrderEffectsState({
      characters: [ARAGORN], holderOn: ARAGORN, hostDefId: FOES_SHALL_FALL, creatureDefId: LAND_DRAKE,
      pathTypes: [RegionType.Wilderness], pathNames: ['Hollin'],
    });
    const attacking = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    const aragornId = findCharInstanceId(attacking, RESOURCE_PLAYER, ARAGORN);
    const atStrike = dispatch(attacking, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    // Tie: roll 2 + 6 = 8.
    const done = executeAction(atStrike, PLAYER_1, 'resolve-strike', 2, true);

    expect(done.combat).toBeNull();
    const host = done.players[RESOURCE_PLAYER].characters[aragornId].hazards.find(h => h.instanceId === hostId);
    expect(host?.heldCreature?.instanceId).toBe(creatureId);
    expect(done.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === creatureId)).toBe(false);
    // The order-effects step moved on once the attack ended, without a
    // second attack from the same holder (non-moving: draw-cards skipped).
    expect(done.phaseState.phase === Phase.MovementHazard && done.phaseState.step).toBe('play-hazards');
    assertEveryInstanceReachable(done);
  });

  // ─── Rule 6: creature defeated → discard Foes Shall Fall ──────────────────

  test('if the held creature is defeated, it goes to the kill pile and Foes Shall Fall is discarded', () => {
    const { state, hostId, creatureId } = buildHeldCreatureOrderEffectsState({
      characters: [ARAGORN], holderOn: ARAGORN, hostDefId: FOES_SHALL_FALL, creatureDefId: LAND_DRAKE,
      pathTypes: [RegionType.Wilderness], pathNames: ['Hollin'],
    });
    const attacking = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    const aragornId = findCharInstanceId(attacking, RESOURCE_PLAYER, ARAGORN);
    const atStrike = dispatch(attacking, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    const done = executeAction(atStrike, PLAYER_1, 'resolve-strike', 12, true);

    expect(done.combat).toBeNull();
    expect(done.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === creatureId)).toBe(true);
    expect(done.players[RESOURCE_PLAYER].characters[aragornId].hazards.some(h => h.instanceId === hostId)).toBe(false);
    expect(done.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === hostId)).toBe(true);
    assertEveryInstanceReachable(done);
  });

  // ─── Rule 5: Foes Shall Fall discarded → creature discarded ───────────────

  test('when Foes Shall Fall leaves play, its held creature is discarded with it', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const { state, hostId, creatureId } = attachHolderWithCreature(base, RESOURCE_PLAYER, LEGOLAS, FOES_SHALL_FALL, LAND_DRAKE);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    // Rule 3.22: discard Legolas at a haven — his hazards go with him.
    const discard = viableActions(state, PLAYER_1, 'discard-character')
      .find(a => (a.action as { characterInstanceId?: string }).characterInstanceId === legolasId);
    expect(discard).toBeDefined();
    const done = dispatch(state, discard!.action);

    expect(done.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === hostId)).toBe(true);
    expect(done.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === creatureId)).toBe(true);
    assertEveryInstanceReachable(done);
  });
});
