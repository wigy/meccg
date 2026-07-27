/**
 * @module le-180.test
 *
 * Card test: Diversion (le-180)
 * Type: minion-resource-event (short)
 * Alignment: ringwraith
 *
 * Card text: "Playable on an unwounded character facing an attack.
 * The attack is canceled and the character is wounded (no body check
 * is required)."
 *
 * Effects:
 *   1. play-target — targets an unwounded (non-inverted) character
 *   2. cancel-attack — cancels the current attack
 *   3. set-character-status{inverted, target-character} — wounds the targeted
 *      character; no body check required
 *
 * One cancel-attack legal action is generated per unwounded character in
 * the defending company. Wounded (inverted) characters are not eligible
 * targets. After the chain resolves, the attack is cancelled and the
 * targeted character is wounded.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  viableActions,
  makeCancelWindowCombat,
  CardStatus,
  dispatch, expectCharStatus, expectInDiscardPile,
  resolveChain, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CancelAttackAction, PlayShortEventAction } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';
import { Race } from '../../index.js';

const DIVERSION = 'le-180' as CardDefinitionId;

// Minion fixtures (ringwraith alignment)
const LAGDUF = 'le-18' as CardDefinitionId;       // minion orc character
const CIRYAHER = 'le-6' as CardDefinitionId;      // minion man character

const DOL_GULDUR = 'le-367' as CardDefinitionId;  // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven
const MORIA_MINION = 'le-392' as CardDefinitionId; // minion shadow-hold

describe('Diversion (le-180)', () => {
  beforeEach(() => resetMint());

  // ── Legal action generation ─────────────────────────────────────────

  test('one cancel-attack action per unwounded character in defending company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [LAGDUF, CIRYAHER] }], hand: [DIVERSION], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    // Two unwounded characters → two actions
    expect(actions).toHaveLength(2);
    const actionItems = actions.map(ea => ea.action as CancelAttackAction);
    expect(actionItems.every(a => a.type === 'cancel-attack')).toBe(true);
    // Each has a distinct targetCharacterId
    const targetIds = actionItems.map(a => a.targetCharacterId);
    expect(targetIds[0]).toBeDefined();
    expect(targetIds[1]).toBeDefined();
    expect(targetIds[0]).not.toBe(targetIds[1]);
  });

  test('wounded (inverted) character is NOT a valid target', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA_MINION, characters: [
            { defId: LAGDUF, status: CardStatus.Inverted },
            CIRYAHER,
          ] }],
          hand: [DIVERSION],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    // Only Ciryaher is unwounded
    expect(actions).toHaveLength(1);
    const action = actions[0].action as CancelAttackAction;
    expect(action.targetCharacterId).toBeDefined();
  });

  test('no cancel-attack actions when all defenders are wounded', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA_MINION, characters: [
            { defId: LAGDUF, status: CardStatus.Inverted },
          ] }],
          hand: [DIVERSION],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(actions).toHaveLength(0);
  });

  // ── Effect execution ────────────────────────────────────────────────

  test('playing Diversion cancels combat and wounds the targeted character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [DIVERSION], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(actions).toHaveLength(1);

    // Declaration moves card to discard; combat still active
    const declared = dispatch(state, actions[0].action);
    expect(declared.chain).not.toBeNull();
    expect(declared.combat).not.toBeNull();
    expect(declared.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(declared, RESOURCE_PLAYER, DIVERSION);
    // Character is not yet wounded at declaration time
    expectCharStatus(declared, RESOURCE_PLAYER, LAGDUF, CardStatus.Untapped);

    // Chain resolves: attack cancelled AND character wounded
    const after = resolveChain(declared);
    expect(after.combat).toBeNull();
    expectCharStatus(after, RESOURCE_PLAYER, LAGDUF, CardStatus.Inverted);
  });

  test('tapped (not wounded) character IS a valid target', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA_MINION, characters: [
            { defId: LAGDUF, status: CardStatus.Tapped },
          ] }],
          hand: [DIVERSION],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    // Tapped is not wounded, so eligible
    expect(actions).toHaveLength(1);
  });

  test('after playing Diversion, the targeted tapped character becomes wounded', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA_MINION, characters: [
            { defId: LAGDUF, status: CardStatus.Tapped },
          ] }],
          hand: [DIVERSION],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    const after = resolveChain(dispatch(state, actions[0].action));
    expect(after.combat).toBeNull();
    // Character moved from tapped → inverted (wounded)
    expectCharStatus(after, RESOURCE_PLAYER, LAGDUF, CardStatus.Inverted);
  });

  test('NOT playable outside combat (not an assign-strikes window)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [DIVERSION], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const cancelActions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);

    const shortEventActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(shortEventActions).toHaveLength(0);
  });

  test('NOT offered as play-short-event during end-of-turn (no attack to cancel)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [DIVERSION], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const diversionInstanceId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const shortEventActions = viableActions(state, PLAYER_1, 'play-short-event');
    const diversionPlayActions = shortEventActions.filter(ea => (ea.action as PlayShortEventAction).cardInstanceId === diversionInstanceId);
    expect(diversionPlayActions).toHaveLength(0);
  });

  test('with two characters, each gets its own action with distinct targetCharacterId', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [LAGDUF, CIRYAHER] }], hand: [DIVERSION], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Troll });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(actions).toHaveLength(2);

    // Play using Ciryaher as the target — he gets wounded
    const actionForCiryaher = (actions.map(ea => ea.action as CancelAttackAction))
      .find(a => {
        const targetId = a.targetCharacterId;
        return targetId && state.players[RESOURCE_PLAYER].characters[targetId]?.definitionId === CIRYAHER;
      });
    expect(actionForCiryaher).toBeDefined();

    const after = resolveChain(dispatch(state, actionForCiryaher!));
    expect(after.combat).toBeNull();
    expectCharStatus(after, RESOURCE_PLAYER, CIRYAHER, CardStatus.Inverted);
    // Lagduf is unaffected
    expectCharStatus(after, RESOURCE_PLAYER, LAGDUF, CardStatus.Untapped);
  });
});
