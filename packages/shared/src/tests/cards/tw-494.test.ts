/**
 * @module tw-494.test
 *
 * Card test: Black Arrow (tw-494)
 * Type: hero-resource-item (minor weapon), non-unique, 1 corruption.
 *
 * Card text:
 *   "Warrior only: Tap Black Arrow to give -1 to the prowess and body of
 *    any one attack against bearer's company. When Black Arrow is tapped,
 *    discard it if its bearer is not a Man."
 *
 * Engine Support:
 * | # | Feature                                             | Status      | Notes                                                  |
 * |---|-----------------------------------------------------|-------------|--------------------------------------------------------|
 * | 1 | Warrior-only gate on activation                     | IMPLEMENTED | `when: bearer.skills $includes warrior`                |
 * | 2 | Tap item → -1 attack prowess (every strike)         | IMPLEMENTED | `combat.strikeProwess += prowessModifier`              |
 * | 3 | Tap item → -1 creature body (body check)            | IMPLEMENTED | `combat.creatureBody += bodyModifier`                  |
 * | 4 | Man/Dúnadan bearer: item taps                       | IMPLEMENTED | `discardIfBearerNot.race` includes bearer's race       |
 * | 5 | Non-Man bearer: item is discarded instead of tapped | IMPLEMENTED | handler moves item to discard pile                     |
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  viableActions, dispatch,
  findCharInstanceId,
  attachItemToChar,
  makeCancelWindowCombat,
  PLAYER_1, PLAYER_2,
  ARAGORN, THEODEN, GIMLI, FRODO,
  ORC_PATROL,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Alignment, CardStatus } from '../../index.js';
import type { CardDefinitionId, ModifyAttackAction } from '../../index.js';

const BLACK_ARROW = 'tw-494' as CardDefinitionId;

describe('Black Arrow (tw-494)', () => {
  beforeEach(() => resetMint());

  // ─── Positive: warrior Man bearer, full effect ───────────────────────────

  test('modify-attack IS available when a warrior Man bears the arrow', () => {
    let base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [THEODEN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [FRODO] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    base = attachItemToChar(base, RESOURCE_PLAYER, THEODEN, BLACK_ARROW);

    const combatState = makeCancelWindowCombat(base, {
      creatureDefId: ORC_PATROL,
      creatureRace: 'orc',
      attackSourceType: 'creature',
      strikesTotal: 2,
      strikeProwess: 6,
    });

    const modifyActions = viableActions(combatState, PLAYER_1, 'modify-attack');
    expect(modifyActions).toHaveLength(1);

    const theodenId = findCharInstanceId(combatState, RESOURCE_PLAYER, THEODEN);
    const act = modifyActions[0].action as ModifyAttackAction;
    expect(act.characterInstanceId).toBe(theodenId);
  });

  test('executing modify-attack on a warrior Man taps the item and lowers prowess and body', () => {
    let base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [THEODEN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [FRODO] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    base = attachItemToChar(base, RESOURCE_PLAYER, THEODEN, BLACK_ARROW);

    const combatState = makeCancelWindowCombat(base, {
      creatureDefId: ORC_PATROL,
      creatureRace: 'orc',
      attackSourceType: 'creature',
      strikesTotal: 2,
      strikeProwess: 6,
    });
    // Set creatureBody explicitly to 7 (ORC_PATROL body) for body-modifier test.
    const combatWithBody = {
      ...combatState,
      combat: { ...combatState.combat!, creatureBody: 7 },
    };

    const modifyActions = viableActions(combatWithBody, PLAYER_1, 'modify-attack');
    expect(modifyActions).toHaveLength(1);

    const after = dispatch(combatWithBody, modifyActions[0].action);

    // Combat still active (not canceled, just modified).
    expect(after.combat).not.toBeNull();
    expect(after.combat!.phase).toBe('assign-strikes');

    // Strike prowess 6 → 5, creature body 7 → 6.
    expect(after.combat!.strikeProwess).toBe(5);
    expect(after.combat!.creatureBody).toBe(6);

    // Item is tapped, still on Théoden.
    const theodenId = findCharInstanceId(after, RESOURCE_PLAYER, THEODEN);
    const theoden = after.players[RESOURCE_PLAYER].characters[theodenId as string];
    expect(theoden.items).toHaveLength(1);
    expect(theoden.items[0].definitionId).toBe(BLACK_ARROW);
    expect(theoden.items[0].status).toBe(CardStatus.Tapped);

    // Item NOT in discard pile.
    const discard = after.players[RESOURCE_PLAYER].discardPile;
    expect(discard.find(c => c.definitionId === BLACK_ARROW)).toBeUndefined();
  });

  // ─── Positive: warrior Dúnadan bearer taps safely ────────────────────────

  test('modify-attack on a warrior Dúnadan taps the item (Dúnadan counts as Man)', () => {
    let base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [FRODO] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    base = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, BLACK_ARROW);

    const combatState = makeCancelWindowCombat(base, {
      creatureDefId: ORC_PATROL,
      creatureRace: 'orc',
      attackSourceType: 'creature',
      strikesTotal: 2,
      strikeProwess: 6,
    });

    const modifyActions = viableActions(combatState, PLAYER_1, 'modify-attack');
    expect(modifyActions).toHaveLength(1);

    const after = dispatch(combatState, modifyActions[0].action);

    // Modifier applied.
    expect(after.combat!.strikeProwess).toBe(5);

    // Item tapped, not discarded.
    const aragornId = findCharInstanceId(after, RESOURCE_PLAYER, ARAGORN);
    const aragorn = after.players[RESOURCE_PLAYER].characters[aragornId as string];
    expect(aragorn.items).toHaveLength(1);
    expect(aragorn.items[0].status).toBe(CardStatus.Tapped);
    expect(after.players[RESOURCE_PLAYER].discardPile.find(c => c.definitionId === BLACK_ARROW)).toBeUndefined();
  });

  // ─── Positive: warrior non-Man bearer discards item ──────────────────────

  test('modify-attack on a warrior Dwarf discards the item but still applies the modifier', () => {
    let base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [FRODO] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    base = attachItemToChar(base, RESOURCE_PLAYER, GIMLI, BLACK_ARROW);

    const combatState = makeCancelWindowCombat(base, {
      creatureDefId: ORC_PATROL,
      creatureRace: 'orc',
      attackSourceType: 'creature',
      strikesTotal: 2,
      strikeProwess: 6,
    });
    const combatWithBody = {
      ...combatState,
      combat: { ...combatState.combat!, creatureBody: 7 },
    };

    const modifyActions = viableActions(combatWithBody, PLAYER_1, 'modify-attack');
    expect(modifyActions).toHaveLength(1);

    const after = dispatch(combatWithBody, modifyActions[0].action);

    // Modifier still applied — card text: "tap to give -1" first, then discard.
    expect(after.combat!.strikeProwess).toBe(5);
    expect(after.combat!.creatureBody).toBe(6);

    // Item removed from Gimli, placed in discard pile.
    const gimliId = findCharInstanceId(after, RESOURCE_PLAYER, GIMLI);
    const gimli = after.players[RESOURCE_PLAYER].characters[gimliId as string];
    expect(gimli.items).toHaveLength(0);

    const discard = after.players[RESOURCE_PLAYER].discardPile;
    expect(discard.find(c => c.definitionId === BLACK_ARROW)).toBeDefined();
  });

  // ─── Negative: non-warrior bearer cannot activate ────────────────────────

  test('modify-attack is NOT available when bearer lacks the warrior skill', () => {
    // Frodo is a hobbit scout — no warrior skill.
    let base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [FRODO] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    base = attachItemToChar(base, RESOURCE_PLAYER, FRODO, BLACK_ARROW);

    const combatState = makeCancelWindowCombat(base, {
      creatureDefId: ORC_PATROL,
      creatureRace: 'orc',
      attackSourceType: 'creature',
      strikesTotal: 2,
      strikeProwess: 6,
    });

    const modifyActions = viableActions(combatState, PLAYER_1, 'modify-attack');
    expect(modifyActions).toHaveLength(0);
  });

  // ─── Negative: already-tapped item cannot activate ───────────────────────

  test('modify-attack is NOT available when the arrow is already tapped', () => {
    let base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [THEODEN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [FRODO] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    base = attachItemToChar(base, RESOURCE_PLAYER, THEODEN, BLACK_ARROW);

    // Tap the item up front.
    const theodenId = findCharInstanceId(base, RESOURCE_PLAYER, THEODEN);
    const tappedChar = {
      ...base.players[RESOURCE_PLAYER].characters[theodenId as string],
    };
    tappedChar.items = tappedChar.items.map(it =>
      it.definitionId === BLACK_ARROW ? { ...it, status: CardStatus.Tapped } : it,
    );
    base = {
      ...base,
      players: [
        {
          ...base.players[RESOURCE_PLAYER],
          characters: {
            ...base.players[RESOURCE_PLAYER].characters,
            [theodenId as string]: tappedChar,
          },
        },
        base.players[1],
      ] as unknown as typeof base.players,
    };

    const combatState = makeCancelWindowCombat(base, {
      creatureDefId: ORC_PATROL,
      creatureRace: 'orc',
      attackSourceType: 'creature',
      strikesTotal: 2,
      strikeProwess: 6,
    });

    const modifyActions = viableActions(combatState, PLAYER_1, 'modify-attack');
    expect(modifyActions).toHaveLength(0);
  });

  // ─── Two arrows on different characters tap independently ────────────────

  test('two Black Arrows on two warriors produce two independent modify-attack actions', () => {
    let base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [THEODEN, ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [FRODO] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    base = attachItemToChar(base, RESOURCE_PLAYER, THEODEN, BLACK_ARROW);
    base = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, BLACK_ARROW);

    const combatState = makeCancelWindowCombat(base, {
      creatureDefId: ORC_PATROL,
      creatureRace: 'orc',
      attackSourceType: 'creature',
      strikesTotal: 2,
      strikeProwess: 6,
    });

    const modifyActions = viableActions(combatState, PLAYER_1, 'modify-attack');
    expect(modifyActions).toHaveLength(2);

    // Applying both yields -2 prowess cumulatively.
    const afterFirst = dispatch(combatState, modifyActions[0].action);
    expect(afterFirst.combat!.strikeProwess).toBe(5);

    const secondActions = viableActions(afterFirst, PLAYER_1, 'modify-attack');
    expect(secondActions).toHaveLength(1);
    const afterSecond = dispatch(afterFirst, secondActions[0].action);
    expect(afterSecond.combat!.strikeProwess).toBe(4);
  });
});
