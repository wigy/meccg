/**
 * @module as-23.test
 *
 * Card test: A Lie in Your Eyes (as-23)
 * Type: hazard-event (short)
 *
 * "Playable on an untapped non-Ringwraith, non-Wizard character. Your
 *  opponent may either: tap the character, tap an ally the character
 *  controls, or choose for you to make a roll. If the result is greater
 *  than the character's mind plus 6, the character is discarded (along
 *  with all non-follower cards he controls)."
 *
 * Engine support:
 * - play-target character filter: untapped, non-wizard, non-ringwraith
 * - opponent-choose-tap-or-roll (rollAddend 6): a `tap-or-roll-choice`
 *   pending resolution for the defending player, offering tap-character,
 *   tap-ally (one per untapped ally, omitted when none), and roll. The
 *   roll branch enqueues a generic `dice-check` (roller = card-player,
 *   threshold = mind + 6, `onPass: discard-character`).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  CardStatus,
  ARAGORN, GANDALF, FRODO, GLAMDRING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  viableActions,
  makeMHState,
  P1_COMPANY,
  handCardId, findCharInstanceId, dispatch,
  attachAllyToChar, setCharStatus,
  getCharacter, expectCharStatus, expectCharInPlay, expectCharNotInPlay,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { Phase } from '../../index.js';
import type {
  GameState, CardDefinitionId, PlayHazardAction, ChooseTapOrRollAction, ResolveDiceCheckAction,
} from '../../index.js';

const A_LIE_IN_YOUR_EYES = 'as-23' as CardDefinitionId;
const KHAMUL = 'le-55' as CardDefinitionId;
const ROAC = 'tw-320' as CardDefinitionId;
const SAM_GAMGEE = 'tw-180' as CardDefinitionId;

describe('A Lie in Your Eyes (as-23)', () => {
  beforeEach(() => resetMint());

  test('playable only on an untapped non-Ringwraith, non-Wizard character', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, GANDALF, KHAMUL] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [A_LIE_IN_YOUR_EYES], siteDeck: [MINAS_TIRITH] },
      ],
    });

    let s: GameState = { ...state, phaseState: makeMHState() };
    s = setCharStatus(s, RESOURCE_PLAYER, GANDALF, CardStatus.Tapped);

    const actions = viableActions(s, PLAYER_2, 'play-hazard');
    // Only Aragorn qualifies: Gandalf is a Wizard (and tapped), Khamûl is a
    // Ringwraith.
    expect(actions).toHaveLength(1);
    const playAction = actions[0].action as PlayHazardAction;
    expect(playAction.targetCharacterId).toBeDefined();
    expect(playAction.targetCharacterId).toBe(findCharInstanceId(s, RESOURCE_PLAYER, ARAGORN));
  });

  function playOnFrodo(extraItems: readonly CardDefinitionId[] = []): { state: GameState; frodoId: ReturnType<typeof findCharInstanceId> } {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: FRODO, items: extraItems as CardDefinitionId[] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [A_LIE_IN_YOUR_EYES], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const frodoId = findCharInstanceId(state, RESOURCE_PLAYER, FRODO);
    const mhState: GameState = { ...state, phaseState: makeMHState() };
    const cardId = handCardId(mhState, HAZARD_PLAYER);

    let s = dispatch(mhState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId: P1_COMPANY,
      targetCharacterId: frodoId,
    });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    expect(s.pendingResolutions).toHaveLength(1);
    expect(s.pendingResolutions[0].kind.type).toBe('tap-or-roll-choice');
    expect(s.pendingResolutions[0].actor).toBe(PLAYER_1);

    return { state: s, frodoId };
  }

  test('opponent may tap the character instead of rolling', () => {
    const { state: s0, frodoId } = playOnFrodo();

    const action: ChooseTapOrRollAction = { type: 'choose-tap-or-roll', player: PLAYER_1, choice: 'tap-character' };
    const s = dispatch(s0, action);

    expectCharStatus(s, RESOURCE_PLAYER, FRODO, CardStatus.Tapped);
    expectCharInPlay(s, RESOURCE_PLAYER, frodoId);
    expect(s.pendingResolutions).toHaveLength(0);
  });

  test('tap-ally choice is not offered when the character controls no untapped ally', () => {
    const { state: s0 } = playOnFrodo();
    const actions = computeLegalActions(s0, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'choose-tap-or-roll');
    expect(actions.map(a => (a.action as ChooseTapOrRollAction).choice).sort())
      .toEqual(['roll', 'tap-character']);
  });

  test('opponent may tap an ally the character controls instead', () => {
    let { state: s0 } = playOnFrodo();
    s0 = attachAllyToChar(s0, RESOURCE_PLAYER, FRODO, ROAC);
    const allyId = getCharacter(s0, RESOURCE_PLAYER, FRODO).allies[0].instanceId;

    const choiceActions = computeLegalActions(s0, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'choose-tap-or-roll');
    expect(choiceActions.map(a => (a.action as ChooseTapOrRollAction).choice).sort())
      .toEqual(['roll', 'tap-ally', 'tap-character']);

    const action: ChooseTapOrRollAction = {
      type: 'choose-tap-or-roll', player: PLAYER_1, choice: 'tap-ally', allyInstanceId: allyId,
    };
    const s = dispatch(s0, action);

    expect(getCharacter(s, RESOURCE_PLAYER, FRODO).allies[0].status).toBe(CardStatus.Tapped);
    expectCharStatus(s, RESOURCE_PLAYER, FRODO, CardStatus.Untapped);
    expect(s.pendingResolutions).toHaveLength(0);
  });

  test('opponent lets the card-player roll — high roll discards the character and his items', () => {
    const { state: s0, frodoId } = playOnFrodo([GLAMDRING]);

    const action: ChooseTapOrRollAction = { type: 'choose-tap-or-roll', player: PLAYER_1, choice: 'roll' };
    const s1 = dispatch(s0, action);

    expect(s1.pendingResolutions).toHaveLength(1);
    const dc = s1.pendingResolutions[0];
    expect(dc.kind.type).toBe('dice-check');
    expect(dc.actor).toBe(PLAYER_2);
    if (dc.kind.type === 'dice-check') {
      expect(dc.kind.targetCharacterId).toBe(frodoId);
      // Frodo's mind is 5; threshold = 5 + 6 = 11 ("greater than" → comparison 'gt').
      expect(dc.kind.threshold).toBe(11);
      expect(dc.kind.comparison).toBe('gt');
      expect(dc.kind.roller).toBe(PLAYER_2);
    }

    // Force the maximum roll (12 > 11) so the character is discarded.
    const s2 = { ...s1, cheatRollTotal: 12 };
    const rollActions = computeLegalActions(s2, PLAYER_2)
      .filter(a => a.viable && a.action.type === 'resolve-dice-check');
    expect(rollActions).toHaveLength(1);
    const s = dispatch(s2, rollActions[0].action as ResolveDiceCheckAction);

    expectCharNotInPlay(s, RESOURCE_PLAYER, frodoId);
    const discardDefIds = s.players[0].discardPile.map(c => c.definitionId);
    expect(discardDefIds).toContain(FRODO);
    expect(discardDefIds).toContain(GLAMDRING);
    expect(s.pendingResolutions).toHaveLength(0);
  });

  test('opponent lets the card-player roll — a roll of exactly mind+6 leaves the character in play', () => {
    const { state: s0, frodoId } = playOnFrodo();

    const s1 = dispatch(s0, { type: 'choose-tap-or-roll', player: PLAYER_1, choice: 'roll' } as ChooseTapOrRollAction);

    // Roll = 11 (= mind 5 + 6): "greater than" requires strictly more than 11.
    const s2 = { ...s1, cheatRollTotal: 11 };
    const rollActions = computeLegalActions(s2, PLAYER_2)
      .filter(a => a.viable && a.action.type === 'resolve-dice-check');
    const s = dispatch(s2, rollActions[0].action as ResolveDiceCheckAction);

    expectCharInPlay(s, RESOURCE_PLAYER, frodoId);
    expectCharStatus(s, RESOURCE_PLAYER, FRODO, CardStatus.Untapped);
    expect(s.pendingResolutions).toHaveLength(0);
  });

  test('a follower is not discarded with the character — freed to general influence', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            FRODO,
            { defId: SAM_GAMGEE, followerOf: 0 },
          ] }],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [A_LIE_IN_YOUR_EYES], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const frodoId = findCharInstanceId(state, RESOURCE_PLAYER, FRODO);
    const samId = findCharInstanceId(state, RESOURCE_PLAYER, SAM_GAMGEE);
    const mhState: GameState = { ...state, phaseState: makeMHState() };
    const cardId = handCardId(mhState, HAZARD_PLAYER);

    let s: GameState = dispatch(mhState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId: P1_COMPANY,
      targetCharacterId: frodoId,
    });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });
    s = dispatch(s, { type: 'choose-tap-or-roll', player: PLAYER_1, choice: 'roll' } as ChooseTapOrRollAction);
    s = { ...s, cheatRollTotal: 12 };
    const rollActions = computeLegalActions(s, PLAYER_2)
      .filter(a => a.viable && a.action.type === 'resolve-dice-check');
    s = dispatch(s, rollActions[0].action as ResolveDiceCheckAction);

    expectCharNotInPlay(s, RESOURCE_PLAYER, frodoId);
    // Sam (the follower) is not among Frodo's discarded possessions — he is
    // freed to general influence rather than discarded.
    const sam = s.players[0].characters[samId];
    expect(sam).toBeDefined();
    expect(sam.controlledBy).toBe('general');
    const discardDefIds = s.players[0].discardPile.map(c => c.definitionId);
    expect(discardDefIds).not.toContain(SAM_GAMGEE);
  });
});
