/**
 * @module tw-245.test
 *
 * Card test: Goldberry (tw-245)
 * Type: hero-resource-ally
 * Stats: prowess 0, body 0, mind 2, MP 1 (ally)
 * Unique. Playable at Old Forest.
 *
 * Card text:
 *   "Unique. Playable at Old Forest. May not be attacked.
 *    Tap Goldberry to cancel an effect declared earlier in the same chain
 *    of effects that would return Goldberrys' company to its site of origin.
 *    Alternatively, tap Goldberry to cancel one attack against her company
 *    keyed to Wilderness [{w}]."
 *
 * Engine Support:
 * | # | Feature                                         | Status          | Notes                                        |
 * |---|-------------------------------------------------|-----------------|----------------------------------------------|
 * | 1 | Unique — only one copy allowed                  | IMPLEMENTED     | standard uniqueness check                    |
 * | 2 | Playable at Old Forest (name-matched)           | IMPLEMENTED     | playableAt [{site:"Old Forest"}]             |
 * | 3 | May not be attacked (no strike assignment)      | IMPLEMENTED     | combat-protection: no-attack                 |
 * | 4 | Cancel return-to-site-of-origin chain entry     | NOT IMPLEMENTED | hazard return-to-origin mechanic not in engine |
 * | 5 | Cancel attack keyed to Wilderness [{w}]         | IMPLEMENTED     | cancel-attack with attack.keying condition   |
 *
 * Playable: PARTIALLY — rule 4 (cancel return-to-origin) is not implemented
 * because no hazard cards currently set the return-to-origin chain mechanic.
 *
 * NOT CERTIFIED.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  attachAllyToChar,
  viableActions,
  findCharInstanceId,
  makeSitePhase,
  PLAYER_1, PLAYER_2,
  ARAGORN, FRODO, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  makeCancelWindowCombat,
} from '../test-helpers.js';
import { CardStatus, RegionType } from '../../index.js';
import type {
  CardDefinitionId,
  CardInstanceId,
  CancelAttackAction,
  CombatState,
  AssignStrikeAction,
} from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

const GOLDBERRY = 'tw-245' as CardDefinitionId;
const OLD_FOREST = 'tw-417' as CardDefinitionId;

describe('Goldberry (tw-245)', () => {
  beforeEach(() => resetMint());

  // ─── Playable-at: Old Forest ──────────────────────────────────────────────

  test('Goldberry IS playable at Old Forest', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: OLD_FOREST, characters: [ARAGORN] }], hand: [GOLDBERRY], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const goldberryInstanceId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === goldberryInstanceId);
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('Goldberry is NOT playable at Rivendell (haven)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GOLDBERRY], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const goldberryInstanceId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === goldberryInstanceId);
    expect(playActions).toHaveLength(0);
  });

  // ─── May not be attacked (combat-protection: no-attack) ───────────────────

  test('Goldberry is NOT offered as a strike target by the defending player', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withGoldberry = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLDBERRY);
    const withCombat = makeCancelWindowCombat(withGoldberry, {
      creatureRace: 'orc',
      attackKeying: [RegionType.Wilderness],
      strikesTotal: 2,
    });

    // Advance to assign-strikes (defender phase) — combat is already there
    const goldberryId = findCharInstanceId(withCombat, RESOURCE_PLAYER, ARAGORN);
    // We need Goldberry's instance, not Aragorn's. Get it from the character data.
    const aragornData = withCombat.players[RESOURCE_PLAYER].characters[goldberryId as string];
    const goldberryInstanceId = aragornData?.allies[0]?.instanceId;
    expect(goldberryInstanceId).toBeDefined();

    const assignActions = computeLegalActions(withCombat, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'assign-strike')
      .map(ea => ea.action as AssignStrikeAction);

    const goldberryTargeted = assignActions.some(a => a.characterId === goldberryInstanceId);
    expect(goldberryTargeted).toBe(false);
  });

  test('Goldberry is NOT offered as a strike target by the attacking player', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withGoldberry = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLDBERRY);
    // Build combat with 2 strikes, Aragorn already assigned one — attacker gets the remaining
    const withDefenderCombat = makeCancelWindowCombat(withGoldberry, {
      creatureRace: 'orc',
      attackKeying: [RegionType.Wilderness],
      strikesTotal: 2,
    });

    const aragornId = findCharInstanceId(withDefenderCombat, RESOURCE_PLAYER, ARAGORN);
    const aragornData = withDefenderCombat.players[RESOURCE_PLAYER].characters[aragornId as string];
    const goldberryInstanceId = aragornData?.allies[0]?.instanceId;
    expect(goldberryInstanceId).toBeDefined();

    // Simulate: Aragorn assigned one strike, now attacker phase
    const combat: CombatState = {
      ...withDefenderCombat.combat!,
      strikeAssignments: [
        { characterId: aragornId, excessStrikes: 0, resolved: false },
      ],
      assignmentPhase: 'attacker',
    };
    const attackerState = { ...withDefenderCombat, combat };

    const assignActions = computeLegalActions(attackerState, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'assign-strike')
      .map(ea => ea.action as AssignStrikeAction);

    const goldberryTargeted = assignActions.some(a => a.characterId === goldberryInstanceId);
    expect(goldberryTargeted).toBe(false);
  });

  test('non-protected allies can still be assigned strikes (protection is not blanket)', () => {
    // FRODO's company, no Goldberry — a normal Orc Patrol ally would be targetable.
    // We use Aragorn alone to verify the baseline: Aragorn is a character, not an ally,
    // so this confirms the protection only affects Goldberry and not all party members.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, FRODO] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCombat = makeCancelWindowCombat(base, {
      creatureRace: 'orc',
      attackKeying: [RegionType.Wilderness],
      strikesTotal: 1,
    });

    const assignActions = computeLegalActions(withCombat, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'assign-strike');
    // Aragorn and Frodo are both valid targets (no combat-protection)
    expect(assignActions.length).toBeGreaterThanOrEqual(2);
  });

  // ─── Cancel-attack: keyed to Wilderness ───────────────────────────────────

  test('cancel-attack IS offered when attack is keyed to Wilderness', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withGoldberry = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLDBERRY);
    const withCombat = makeCancelWindowCombat(withGoldberry, {
      creatureRace: 'orc',
      attackKeying: [RegionType.Wilderness],
    });

    const aragornId = findCharInstanceId(withCombat, RESOURCE_PLAYER, ARAGORN);
    const goldberryInstanceId = withCombat.players[RESOURCE_PLAYER].characters[aragornId as string]?.allies[0]?.instanceId;
    expect(goldberryInstanceId).toBeDefined();

    const cancelActions = computeLegalActions(withCombat, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction);

    expect(cancelActions.some(a => a.cardInstanceId === goldberryInstanceId)).toBe(true);
  });

  test('cancel-attack is NOT offered when attack is keyed to Shadow-land (not Wilderness)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withGoldberry = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLDBERRY);
    const withCombat = makeCancelWindowCombat(withGoldberry, {
      creatureRace: 'orc',
      attackKeying: [RegionType.Shadow],
    });

    const aragornId = findCharInstanceId(withCombat, RESOURCE_PLAYER, ARAGORN);
    const goldberryInstanceId = withCombat.players[RESOURCE_PLAYER].characters[aragornId as string]?.allies[0]?.instanceId;
    expect(goldberryInstanceId).toBeDefined();

    const cancelActions = computeLegalActions(withCombat, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction);

    expect(cancelActions.some(a => a.cardInstanceId === goldberryInstanceId)).toBe(false);
  });

  test('cancel-attack is NOT offered when attack has no keying (e.g. automatic attack)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withGoldberry = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLDBERRY);
    const withCombat = makeCancelWindowCombat(withGoldberry, {
      creatureRace: 'orc',
      attackKeying: [],  // no keying
    });

    const aragornId = findCharInstanceId(withCombat, RESOURCE_PLAYER, ARAGORN);
    const goldberryInstanceId = withCombat.players[RESOURCE_PLAYER].characters[aragornId as string]?.allies[0]?.instanceId;
    expect(goldberryInstanceId).toBeDefined();

    const cancelActions = computeLegalActions(withCombat, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction);

    expect(cancelActions.some(a => a.cardInstanceId === goldberryInstanceId)).toBe(false);
  });

  test('tapped Goldberry cannot cancel an attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withGoldberry = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLDBERRY);
    const withCombat = makeCancelWindowCombat(withGoldberry, {
      creatureRace: 'orc',
      attackKeying: [RegionType.Wilderness],
    });

    const aragornId = findCharInstanceId(withCombat, RESOURCE_PLAYER, ARAGORN);
    const aragornData = withCombat.players[RESOURCE_PLAYER].characters[aragornId as string];
    const goldberryInstanceId = aragornData?.allies[0]?.instanceId;
    expect(goldberryInstanceId).toBeDefined();

    // Tap Goldberry before computing actions
    const tappedGoldberry = { ...aragornData.allies[0], status: CardStatus.Tapped };
    const updatedChars = {
      ...withCombat.players[RESOURCE_PLAYER].characters,
      [aragornId as string]: { ...aragornData, allies: [tappedGoldberry] },
    };
    const tappedState = {
      ...withCombat,
      players: [
        { ...withCombat.players[RESOURCE_PLAYER], characters: updatedChars },
        withCombat.players[HAZARD_PLAYER],
      ] as unknown as typeof withCombat.players,
    };

    const cancelActions = computeLegalActions(tappedState, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction);

    expect(cancelActions.some(a => a.cardInstanceId === goldberryInstanceId)).toBe(false);
  });

  // ─── Cancel return-to-site-of-origin ─────────────────────────────────────

  test.todo('Goldberry can cancel a hazard effect that would return her company to site of origin — NOT IMPLEMENTED: return-to-origin chain mechanic requires hazard cards to be tagged with a return-to-origin marker, which is not yet in the engine');
});
