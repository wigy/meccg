/**
 * @module tw-229.test
 *
 * Card test: Escape (tw-229)
 * Type: hero-resource-event (short)
 *
 * Card text: "Playable on an unwounded character facing an attack.
 * The attack is canceled and the character is wounded (no body check
 * is required)."
 *
 * Effects:
 *   1. play-target — targets an unwounded (non-inverted) character
 *   2. cancel-attack — cancels the current attack
 *   3. wound-target-character — wounds the targeted character, no body check
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
  ARAGORN, LEGOLAS, BILBO, ELROND,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions,
  makeCancelWindowCombat,
  CardStatus,
  dispatch, expectCharStatus, expectInDiscardPile,
  resolveChain, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CancelAttackAction, PlayShortEventAction } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const ESCAPE = 'tw-229' as CardDefinitionId;

describe('Escape (tw-229)', () => {
  beforeEach(() => resetMint());

  // ── Legal action generation ─────────────────────────────────────────

  test('one cancel-attack action per unwounded character in defending company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, BILBO] }], hand: [ESCAPE], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: 'orc' });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    // Two unwounded characters → two actions
    expect(actions).toHaveLength(2);
    const actionItems = actions.map(ea => ea.action as CancelAttackAction);
    // All carry the same hand card
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
          companies: [{ site: MORIA, characters: [
            { defId: ARAGORN, status: CardStatus.Inverted },
            BILBO,
          ] }],
          hand: [ESCAPE],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: 'orc' });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    // Only Bilbo is unwounded
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
          companies: [{ site: MORIA, characters: [
            { defId: ARAGORN, status: CardStatus.Inverted },
          ] }],
          hand: [ESCAPE],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: 'orc' });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(actions).toHaveLength(0);
  });

  // ── Effect execution ────────────────────────────────────────────────

  test('playing Escape cancels combat and wounds the targeted character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [ESCAPE], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: 'orc' });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(actions).toHaveLength(1);

    // Declaration moves card to discard; combat still active
    const declared = dispatch(state, actions[0].action);
    expect(declared.chain).not.toBeNull();
    expect(declared.combat).not.toBeNull();
    expect(declared.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(declared, RESOURCE_PLAYER, ESCAPE);
    // Character is not yet wounded at declaration time
    expectCharStatus(declared, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);

    // Chain resolves: attack cancelled AND character wounded
    const after = resolveChain(declared);
    expect(after.combat).toBeNull();
    expectCharStatus(after, RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
  });

  test('tapped (not wounded) character IS a valid target', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [
            { defId: ARAGORN, status: CardStatus.Tapped },
          ] }],
          hand: [ESCAPE],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: 'orc' });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    // Tapped is not wounded, so eligible
    expect(actions).toHaveLength(1);
  });

  test('after playing Escape, the targeted tapped character becomes wounded', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [
            { defId: ARAGORN, status: CardStatus.Tapped },
          ] }],
          hand: [ESCAPE],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: 'orc' });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    const after = resolveChain(dispatch(state, actions[0].action));
    expect(after.combat).toBeNull();
    // Character moved from tapped → inverted (wounded)
    expectCharStatus(after, RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
  });

  test('NOT playable outside combat (not an assign-strikes window)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [ESCAPE], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const cancelActions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);

    // Escape must not be offered as play-short-event outside combat — it is
    // "Playable on an unwounded character facing an attack", meaning combat only.
    const shortEventActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(shortEventActions).toHaveLength(0);
  });

  test('NOT offered as play-short-event during end-of-turn (no attack to cancel)', () => {
    // Regression: Escape was incorrectly offered as play-short-event during
    // end-of-turn because play-target and wound-target-character were not
    // treated as neutral companions to cancel-attack in the combat-only check.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [ESCAPE], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const escapeInstanceId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const shortEventActions = viableActions(state, PLAYER_1, 'play-short-event');
    const escapePlayActions = shortEventActions.filter(ea => (ea.action as PlayShortEventAction).cardInstanceId === escapeInstanceId);
    expect(escapePlayActions).toHaveLength(0);
  });

  test('with two characters, each gets its own action with distinct targetCharacterId', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, ELROND] }], hand: [ESCAPE], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: 'troll' });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(actions).toHaveLength(2);

    // Play using the second character as target — Elrond gets wounded
    const actionForElrond = (actions.map(ea => ea.action as CancelAttackAction))
      .find(a => {
        const targetId = a.targetCharacterId;
        return targetId && state.players[RESOURCE_PLAYER].characters[targetId as string]?.definitionId === ELROND;
      });
    expect(actionForElrond).toBeDefined();

    const after = resolveChain(dispatch(state, actionForElrond!));
    expect(after.combat).toBeNull();
    expectCharStatus(after, RESOURCE_PLAYER, ELROND, CardStatus.Inverted);
    // Aragorn is unaffected
    expectCharStatus(after, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
  });
});
