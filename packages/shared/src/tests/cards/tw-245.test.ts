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
 * | # | Feature                                         | Status      | Notes                                        |
 * |---|-------------------------------------------------|-------------|----------------------------------------------|
 * | 1 | Unique — only one copy allowed                  | IMPLEMENTED | standard uniqueness check                    |
 * | 2 | Playable at Old Forest (name-matched)           | IMPLEMENTED | playableAt [{site:"Old Forest"}]             |
 * | 3 | May not be attacked (no strike assignment)      | IMPLEMENTED | combat-protection: no-attack                 |
 * | 4 | Cancel return-to-site-of-origin chain entry     | IMPLEMENTED | cancel-chain-return-to-origin + force-return-to-origin |
 * | 5 | Cancel attack keyed to Wilderness [{w}]         | IMPLEMENTED | cancel-attack with attack.keying condition   |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  attachAllyToChar,
  viableActions,
  findCharInstanceId,
  makeSitePhase,
  makeMHState,
  mint,
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
  CancelReturnToOriginAction,
  CombatState,
  AssignStrikeAction,
} from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { reduce } from '../../engine/reducer.js';
import { initiateChain } from '../../engine/chain-reducer.js';

const GOLDBERRY = 'tw-245' as CardDefinitionId;
const OLD_FOREST = 'tw-417' as CardDefinitionId;
const SNOWSTORM = 'tw-91' as CardDefinitionId;
const FOUL_FUMES = 'tw-36' as CardDefinitionId;

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

    const goldberryId = findCharInstanceId(withCombat, RESOURCE_PLAYER, ARAGORN);
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
    const withDefenderCombat = makeCancelWindowCombat(withGoldberry, {
      creatureRace: 'orc',
      attackKeying: [RegionType.Wilderness],
      strikesTotal: 2,
    });

    const aragornId = findCharInstanceId(withDefenderCombat, RESOURCE_PLAYER, ARAGORN);
    const aragornData = withDefenderCombat.players[RESOURCE_PLAYER].characters[aragornId as string];
    const goldberryInstanceId = aragornData?.allies[0]?.instanceId;
    expect(goldberryInstanceId).toBeDefined();

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
      attackKeying: [],
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

  test('cancel-return-to-origin IS offered when Snowstorm is an unresolved chain entry', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withGoldberry = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLDBERRY);

    const snowstormCard = { instanceId: mint(), definitionId: SNOWSTORM };
    const withChain = initiateChain(
      { ...withGoldberry, phaseState: makeMHState() },
      PLAYER_2,
      snowstormCard,
      { type: 'long-event' },
    );

    // After P2 initiates the chain, P1 (resource player) has priority
    expect(withChain.chain!.priority).toBe(PLAYER_1);

    const aragornId = findCharInstanceId(withChain, RESOURCE_PLAYER, ARAGORN);
    const goldberryInstanceId = withChain.players[RESOURCE_PLAYER].characters[aragornId as string]?.allies[0]?.instanceId;
    expect(goldberryInstanceId).toBeDefined();

    const cancelActions = computeLegalActions(withChain, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-return-to-origin')
      .map(ea => ea.action as CancelReturnToOriginAction);

    expect(cancelActions.some(a => a.allyInstanceId === goldberryInstanceId
      && a.targetInstanceId === snowstormCard.instanceId)).toBe(true);
  });

  test('cancel-return-to-origin IS offered when Foul Fumes is an unresolved chain entry', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withGoldberry = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLDBERRY);

    const foulFumesCard = { instanceId: mint(), definitionId: FOUL_FUMES };
    const withChain = initiateChain(
      { ...withGoldberry, phaseState: makeMHState() },
      PLAYER_2,
      foulFumesCard,
      { type: 'long-event' },
    );

    const aragornId = findCharInstanceId(withChain, RESOURCE_PLAYER, ARAGORN);
    const goldberryInstanceId = withChain.players[RESOURCE_PLAYER].characters[aragornId as string]?.allies[0]?.instanceId;
    expect(goldberryInstanceId).toBeDefined();

    const cancelActions = computeLegalActions(withChain, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-return-to-origin')
      .map(ea => ea.action as CancelReturnToOriginAction);

    expect(cancelActions.some(a => a.allyInstanceId === goldberryInstanceId
      && a.targetInstanceId === foulFumesCard.instanceId)).toBe(true);
  });

  test('tapped Goldberry cannot cancel a return-to-origin chain entry', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withGoldberry = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLDBERRY);

    const snowstormCard = { instanceId: mint(), definitionId: SNOWSTORM };
    const withChain = initiateChain(
      { ...withGoldberry, phaseState: makeMHState() },
      PLAYER_2,
      snowstormCard,
      { type: 'long-event' },
    );

    // Tap Goldberry before computing actions
    const aragornId = findCharInstanceId(withChain, RESOURCE_PLAYER, ARAGORN);
    const aragornData = withChain.players[RESOURCE_PLAYER].characters[aragornId as string];
    const tappedGoldberry = { ...aragornData.allies[0], status: CardStatus.Tapped };
    const updatedChars = {
      ...withChain.players[RESOURCE_PLAYER].characters,
      [aragornId as string]: { ...aragornData, allies: [tappedGoldberry] },
    };
    const tappedState = {
      ...withChain,
      players: [
        { ...withChain.players[RESOURCE_PLAYER], characters: updatedChars },
        withChain.players[HAZARD_PLAYER],
      ] as unknown as typeof withChain.players,
    };

    const cancelActions = computeLegalActions(tappedState, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-return-to-origin');

    expect(cancelActions).toHaveLength(0);
  });

  test('cancel-return-to-origin is NOT offered when chain entry has no force-return-to-origin tag', () => {
    // Use an ordinary creature (Orc) on the chain — no force-return-to-origin effect
    const CAVE_DRAKE = 'tw-18' as CardDefinitionId; // Call of Home — a short event, no return-to-origin tag
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withGoldberry = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLDBERRY);

    // Use a hazard card that does NOT have force-return-to-origin
    const ordinaryHazard = { instanceId: mint(), definitionId: CAVE_DRAKE };
    const withChain = initiateChain(
      { ...withGoldberry, phaseState: makeMHState() },
      PLAYER_2,
      ordinaryHazard,
      { type: 'short-event' },
    );

    const cancelActions = computeLegalActions(withChain, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-return-to-origin');

    expect(cancelActions).toHaveLength(0);
  });

  test('dispatching cancel-return-to-origin taps Goldberry and negates the chain entry', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withGoldberry = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLDBERRY);

    const snowstormCard = { instanceId: mint(), definitionId: SNOWSTORM };
    const withChain = initiateChain(
      { ...withGoldberry, phaseState: makeMHState() },
      PLAYER_2,
      snowstormCard,
      { type: 'long-event' },
    );

    const aragornId = findCharInstanceId(withChain, RESOURCE_PLAYER, ARAGORN);
    const goldberryInstanceId = withChain.players[RESOURCE_PLAYER].characters[aragornId as string]?.allies[0]?.instanceId;

    const action: CancelReturnToOriginAction = {
      type: 'cancel-return-to-origin',
      player: PLAYER_1,
      allyInstanceId: goldberryInstanceId,
      targetInstanceId: snowstormCard.instanceId,
    };

    const result = reduce(withChain, action);
    expect(result.error).toBeUndefined();

    // Goldberry must be tapped
    const goldberryAfter = result.state.players[RESOURCE_PLAYER]
      .characters[aragornId as string]?.allies[0];
    expect(goldberryAfter?.status).toBe(CardStatus.Tapped);

    // The chain entry must be negated
    const snowstormEntry = result.state.chain!.entries.find(
      e => e.card?.instanceId === snowstormCard.instanceId,
    );
    expect(snowstormEntry?.negated).toBe(true);

    // Priority must have flipped to opponent
    expect(result.state.chain!.priority).toBe(PLAYER_2);
  });
});
