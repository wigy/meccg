/**
 * @module rule-8.30-character-eliminated
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.30: Character Eliminated from Body Check
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If a character fails a body check, the character is eliminated and any effects or passive conditions that depend on the character being eliminated are resolved immediately. For each unwounded character in the same company, an item that the eliminated character controlled may be immediately transferred to that unwounded character (up to one item per unwounded character), and all other non-follower cards that the eliminated character controlled are immediately discarded.
 * A failed body check on an unwounded character will result in the character being eliminated, but a successful body check doesn't otherwise affect the character.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, LEGOLAS, GIMLI, GWAIHIR,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  DAGGER_OF_WESTERNESSE, HORN_OF_ANOR,
  buildTestState, resetMint, findCharInstanceId,
  makeShadowMHState, makeBodyCheckCombat, setCharStatus,
  attachAllyToChar, getAlliesOn,
  dispatch, viableActions,
  Phase, companyIdAt, CardStatus, RESOURCE_PLAYER,
  expectCharNotInPlay,
} from '../../test-helpers.js';

describe('Rule 8.30 — Character Eliminated from Body Check', () => {
  beforeEach(() => resetMint());

  test('item-salvage phase entered when character with items is eliminated and unwounded companions exist', () => {
    // Bilbo has a Dagger, Aragorn is unwounded in the same company.
    // Bilbo fails a body check → item-salvage phase should be entered.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MORIA,
            characters: [
              { defId: BILBO, items: [DAGGER_OF_WESTERNESSE] },
              ARAGORN,
            ],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    // Wound Bilbo so body check is triggered after strike failure.
    // Body check roll of 12 > Bilbo's body (9) → eliminated.
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, BILBO, CardStatus.Inverted);
    const readyState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: bilboId }),
      cheatRollTotal: 12,
    };
    const nextState = dispatch(readyState, { type: 'body-check-roll', player: PLAYER_2, need: 10, explanation: 'test' });

    // Should enter item-salvage phase
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.phase).toBe('item-salvage');
    expect(nextState.combat!.salvageItems).toHaveLength(1);
    expect(nextState.combat!.salvageRecipients).toContain(aragornId);

    // Bilbo should be in eliminated pile, not in characters
    expectCharNotInPlay(nextState, RESOURCE_PLAYER, bilboId);
    expect(nextState.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === bilboId)).toBe(true);
  });

  test('salvage-item action transfers item to unwounded companion', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MORIA,
            characters: [
              { defId: BILBO, items: [DAGGER_OF_WESTERNESSE] },
              ARAGORN,
            ],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const daggerId = state.players[0].characters[bilboId as string].items[0].instanceId;

    const woundedState = setCharStatus(state, RESOURCE_PLAYER, BILBO, CardStatus.Inverted);
    const readyState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: bilboId }),
      cheatRollTotal: 12,
    };
    const afterBodyCheck = dispatch(readyState, { type: 'body-check-roll', player: PLAYER_2, need: 10, explanation: 'test' });
    expect(afterBodyCheck.combat!.phase).toBe('item-salvage');

    // Salvage the Dagger to Aragorn
    const salvageActions = viableActions(afterBodyCheck, PLAYER_1, 'salvage-item');
    expect(salvageActions.length).toBe(1);
    const salvageAction = salvageActions[0].action;
    expect(salvageAction.type).toBe('salvage-item');

    const afterSalvage = dispatch(afterBodyCheck, salvageAction);

    // Combat should have finalized (all strikes resolved)
    expect(afterSalvage.combat).toBeNull();

    // Aragorn should now have the Dagger
    const aragornData = afterSalvage.players[0].characters[aragornId as string];
    expect(aragornData.items.some(i => i.instanceId === daggerId)).toBe(true);
  });

  test('pass during item-salvage discards remaining items', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MORIA,
            characters: [
              { defId: BILBO, items: [DAGGER_OF_WESTERNESSE] },
              ARAGORN,
            ],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const daggerId = state.players[0].characters[bilboId as string].items[0].instanceId;

    const woundedState = setCharStatus(state, RESOURCE_PLAYER, BILBO, CardStatus.Inverted);
    const readyState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: bilboId }),
      cheatRollTotal: 12,
    };
    const afterBodyCheck = dispatch(readyState, { type: 'body-check-roll', player: PLAYER_2, need: 10, explanation: 'test' });
    expect(afterBodyCheck.combat!.phase).toBe('item-salvage');

    // Pass — decline salvage
    const afterPass = dispatch(afterBodyCheck, { type: 'pass', player: PLAYER_1 });

    // Combat should have finalized
    expect(afterPass.combat).toBeNull();

    // Dagger should be in discard pile, not on any character
    expect(afterPass.players[0].discardPile.some(c => c.instanceId === daggerId)).toBe(true);
  });

  test('item-salvage generates one legal action per (item × recipient) pair', () => {
    // Regression test for the bug report from game mo13g8zo-gyai85 (seq 358→359):
    // the salvage-item UI needs one clickable action per item × recipient so the
    // player can pick both which item and which recipient. With 2 items and 2
    // unwounded recipients we expect 4 salvage-item actions plus a pass.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MORIA,
            characters: [
              { defId: BILBO, items: [DAGGER_OF_WESTERNESSE, HORN_OF_ANOR] },
              ARAGORN,
              GIMLI,
            ],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const woundedState = setCharStatus(state, RESOURCE_PLAYER, BILBO, CardStatus.Inverted);
    const readyState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: bilboId }),
      cheatRollTotal: 12,
    };
    const afterBodyCheck = dispatch(readyState, { type: 'body-check-roll', player: PLAYER_2, need: 10, explanation: 'test' });

    expect(afterBodyCheck.combat!.phase).toBe('item-salvage');
    expect(afterBodyCheck.combat!.salvageItems).toHaveLength(2);
    expect(afterBodyCheck.combat!.salvageRecipients).toHaveLength(2);

    const salvageActions = viableActions(afterBodyCheck, PLAYER_1, 'salvage-item');
    expect(salvageActions.length).toBe(4);

    const recipients = new Set(salvageActions.map(ea => {
      const a = ea.action;
      if (a.type !== 'salvage-item') throw new Error('expected salvage-item');
      return a.recipientCharacterId as string;
    }));
    expect(recipients.has(aragornId as string)).toBe(true);
    expect(recipients.has(gimliId as string)).toBe(true);
  });

  test('no item-salvage when eliminated character has no items', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MORIA,
            characters: [BILBO, ARAGORN],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    // Eliminate Bilbo (no items) — body check roll 12 > body 9
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, BILBO, CardStatus.Inverted);
    const readyState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: bilboId }),
      cheatRollTotal: 12,
    };
    const nextState = dispatch(readyState, { type: 'body-check-roll', player: PLAYER_2, need: 10, explanation: 'test' });

    // Should skip item-salvage and finalize combat directly
    expect(nextState.combat).toBeNull();
  });

  test('no item-salvage when no unwounded companions in company', () => {
    // Bilbo has a Dagger, but Aragorn (only companion) is wounded
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MORIA,
            characters: [
              { defId: BILBO, items: [DAGGER_OF_WESTERNESSE] },
              { defId: ARAGORN, status: CardStatus.Inverted },
            ],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const daggerId = state.players[0].characters[bilboId as string].items[0].instanceId;

    // Eliminate Bilbo — no unwounded companions → skip salvage
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, BILBO, CardStatus.Inverted);
    const readyState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: bilboId }),
      cheatRollTotal: 12,
    };
    const nextState = dispatch(readyState, { type: 'body-check-roll', player: PLAYER_2, need: 10, explanation: 'test' });

    // Should skip item-salvage and finalize combat directly
    expect(nextState.combat).toBeNull();

    // Dagger should be in discard pile
    expect(nextState.players[0].discardPile.some(c => c.instanceId === daggerId)).toBe(true);
  });

  test('ally that fails a body check goes to eliminated pile, not discard pile', () => {
    // Per CoE 2.V.2.2 allies are treated as characters for combat-specific
    // actions including body checks. Per CoE 3.I a failed body check
    // eliminates the entity (to the removed-from-play pile). Regression
    // test for bug 8dcd739fbd69557d: Gwaihir went to the discard pile
    // after failing a body check in game moab9vqb-68zlad.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN, BILBO] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const state = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GWAIHIR);
    const gwaihirId = getAlliesOn(state, RESOURCE_PLAYER, ARAGORN)[0].instanceId;
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    // Body check roll of 12 > Gwaihir's body (8) → ally is eliminated.
    const readyState = {
      ...state,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: gwaihirId }),
      cheatRollTotal: 12,
    };
    const nextState = dispatch(readyState, { type: 'body-check-roll', player: PLAYER_2, need: 10, explanation: 'test' });

    // Combat should have finalized (ally eliminations have no item-salvage)
    expect(nextState.combat).toBeNull();

    // Ally must be removed from the host character's allies list
    expect(getAlliesOn(nextState, RESOURCE_PLAYER, ARAGORN).some(a => a.instanceId === gwaihirId)).toBe(false);

    // Eliminated ally lands in the out-of-play (eliminated) pile, NOT discard
    expect(nextState.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === gwaihirId)).toBe(true);
    expect(nextState.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === gwaihirId)).toBe(false);
  });
});
