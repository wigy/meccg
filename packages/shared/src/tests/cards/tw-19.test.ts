/**
 * @module tw-19.test
 *
 * Card test: Call of the Sea (tw-19)
 * Type: hazard-event (short)
 *
 * "Playable on a Elf character. The character's player makes a roll. Return
 *  the character to the player's hand if this result plus his unused
 *  general influence is less than 10. This result is modified by -3 if the
 *  character's company moved this turn using a site path containing a
 *  Coastal Sea [{c}]. Any one item held by a character removed in this
 *  fashion may automatically be transferred to another character in his
 *  company (all other non-follower cards target character controls are
 *  discarded)."
 *
 * Engine support:
 * - play-target character filter: race elf
 * - call-of-home-check threshold:10 with a rollModifiers entry (-3 when the
 *   active company's resolved site path includes a Coastal Sea region) —
 *   roll + unused GI + modifiers < 10 returns the character to hand; one
 *   item may transfer to a company-mate (allowItemTransfer), the rest of
 *   the character's cards discard, followers fall to GI.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GALADRIEL,
  GLAMDRING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  viableActions, makeMHState,
  P1_COMPANY,
  handCardId, charIdAt, dispatch, RESOURCE_PLAYER, HAZARD_PLAYER,
  expectCharInPlay, expectCharNotInPlay,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { Phase, RegionType } from '../../index.js';
import type { GameState, HazardEventCard, CardDefinitionId, PlayHazardAction, ResolveDiceCheckAction } from '../../index.js';
import type { TransferReturnedItemAction } from '../../types/actions-movement-hazard.js';

const CALL_OF_THE_SEA = 'tw-19' as CardDefinitionId;

describe('Call of the Sea (tw-19)', () => {
  beforeEach(() => resetMint());

  test('card definition is a short hazard event with play-target and call-of-home-check effects', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CALL_OF_THE_SEA], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const def = state.cardPool[CALL_OF_THE_SEA] as HazardEventCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hazard-event');
    expect(def.eventType).toBe('short');
    expect(def.effects).toHaveLength(2);
    expect(def.effects![0].type).toBe('play-target');
    expect(def.effects![1].type).toBe('call-of-home-check');
  });

  test('playable on an Elf character during M/H play-hazards', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CALL_OF_THE_SEA], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhState: GameState = { ...state, phaseState: makeMHState() };
    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);

    const playAction = actions[0].action as PlayHazardAction;
    expect(playAction.targetCharacterId).toBeDefined();
  });

  test('NOT playable on a non-Elf character (Aragorn)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CALL_OF_THE_SEA], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhState: GameState = { ...state, phaseState: makeMHState() };
    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('generates one action per eligible Elf in a mixed company', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS, GALADRIEL] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CALL_OF_THE_SEA], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhState: GameState = { ...state, phaseState: makeMHState() };
    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(2);
  });

  test('character stays when roll + unused GI >= threshold (no Coastal Sea in path)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CALL_OF_THE_SEA], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Aragorn (mind 9) + Legolas (mind 6) use 15 GI; unused GI = 20 - 15 = 5.
    // No Coastal Sea in path → no roll modifier. Need roll >= 10 - 5 = 5.
    const legolasId = charIdAt(state, RESOURCE_PLAYER, 0, 1);
    const mhState: GameState = { ...state, phaseState: makeMHState({ resolvedSitePath: [RegionType.Wilderness] }) };
    const cosId = handCardId(mhState, HAZARD_PLAYER);

    let s = dispatch(mhState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cosId,
      targetCompanyId: P1_COMPANY,
      targetCharacterId: legolasId,
    });

    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    expect(s.pendingResolutions).toHaveLength(1);
    const dc = s.pendingResolutions.find(r => r.kind.type === 'dice-check');
    expect(dc?.kind.type).toBe('dice-check');
    if (dc?.kind.type === 'dice-check') {
      expect(dc.kind.targetCharacterId).toBe(legolasId);
      expect(dc.kind.threshold).toBe(10);
    }

    // Force roll = 6: 6 + 5 (unused GI) = 11 >= 10 → passes.
    s = { ...s, cheatRollTotal: 6 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'resolve-dice-check');
    expect(rollActions).toHaveLength(1);
    s = dispatch(s, rollActions[0].action as ResolveDiceCheckAction);

    expectCharInPlay(s, RESOURCE_PLAYER, legolasId);
    expect(s.players[0].hand.length).toBe(0);
  });

  test('character returns to hand when the same roll fails due to the Coastal Sea -3 penalty', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            ARAGORN,
            { defId: LEGOLAS, items: [GLAMDRING] },
          ] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CALL_OF_THE_SEA], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Aragorn (mind 9) + Legolas (mind 6) use 15 GI; unused GI = 5.
    // Company moved via a Coastal Sea this turn → roll modified by -3.
    // Need roll >= 10 - 5 + 3 = 8. Force roll = 6: 6 - 3 + 5 = 8 < 10 → fails
    // (the same roll that passed without the Coastal Sea penalty above).
    const legolasId = charIdAt(state, RESOURCE_PLAYER, 0, 1);
    const mhState: GameState = { ...state, phaseState: makeMHState({ resolvedSitePath: [RegionType.Wilderness, RegionType.Coastal] }) };
    const cosId = handCardId(mhState, HAZARD_PLAYER);

    let s = dispatch(mhState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cosId,
      targetCompanyId: P1_COMPANY,
      targetCharacterId: legolasId,
    });

    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    expect(s.pendingResolutions).toHaveLength(1);

    s = { ...s, cheatRollTotal: 6 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'resolve-dice-check');
    expect(rollActions).toHaveLength(1);
    s = dispatch(s, rollActions[0].action as ResolveDiceCheckAction);

    // Legolas should be back in hand.
    expectCharNotInPlay(s, RESOURCE_PLAYER, legolasId);
    const handDefIds = s.players[0].hand.map(c => c.definitionId);
    expect(handDefIds).toContain(LEGOLAS);

    // Glamdring lands in the owner's discard pile (available for transfer).
    const discardDefIds = s.players[0].discardPile.map(c => c.definitionId);
    expect(discardDefIds).toContain(GLAMDRING);

    // One item may automatically be transferred to another character in his
    // company: a transfer-returned-item resolution is offered to Aragorn's
    // company-mate slot.
    expect(s.pendingResolutions).toHaveLength(1);
    expect(s.pendingResolutions[0].kind.type).toBe('transfer-returned-item');

    const transferActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'transfer-returned-item');
    expect(transferActions.length).toBeGreaterThan(0);
    const toAragorn = transferActions.find(a => (a.action as TransferReturnedItemAction).itemInstanceId !== undefined);
    expect(toAragorn).toBeDefined();

    s = dispatch(s, toAragorn!.action);

    // Glamdring now sits on Aragorn instead of the discard pile.
    const aragornId = charIdAt(s, RESOURCE_PLAYER);
    const aragorn = s.players[0].characters[aragornId];
    expect(aragorn.items.map(i => i.definitionId)).toContain(GLAMDRING);
    expect(s.players[0].discardPile.map(c => c.definitionId)).not.toContain(GLAMDRING);
  });
});
