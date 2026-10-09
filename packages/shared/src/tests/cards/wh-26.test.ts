/**
 * @module wh-26.test
 *
 * Card test: Mask Torn (wh-26)
 * Type: hazard-event (permanent)
 *
 * "Fallen-wizards may not bring characters with more than 4 mind into play.
 *  If a Fallen-wizard has more than 9 stage points, he may not bring
 *  characters with more than 3 mind into play. Discard when any play deck is
 *  exhausted."
 *
 * Effects:
 * 1. `prohibit-character-play` (`player.alignment: fallen-wizard`, filter
 *    `mind > 4`) — a Fallen-wizard's mind-5+ characters become unplayable.
 * 2. `prohibit-character-play` (also `player.stagePoints > 9`, filter
 *    `mind > 3`) — above 9 stage points the cap drops to mind 3.
 * 3. `on-event: play-deck-exhausted` self-discard — the Tokens to Show
 *    (as-101) pattern, fired by `completeDeckExhaust`.
 *
 * Non-Fallen-wizard players are unaffected, and the avatar (mind null) is
 * never caught by the numeric filter.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  resetMint, buildFallenWizardOrgPhaseState, buildTestState, Phase,
  addCardInPlay, viablePlayCharacterActions, findHandCardId, dispatch,
  RIVENDELL, GANDALF, BALIN, PEATH, KILI,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, EndOfTurnPhaseState, GameState } from '../../index.js';

const MASK_TORN = 'wh-26' as CardDefinitionId;
const SARUMAN_FW = 'wh-9' as CardDefinitionId;   // Fallen-wizard avatar
const ISENGARD_FW = 'wh-56' as CardDefinitionId; // Fallen-wizard Wizardhaven

const FW_HAND = [BALIN, PEATH, KILI]; // mind 5, 4, 3

describe('Mask Torn (wh-26)', () => {
  beforeEach(() => resetMint());

  test('baseline: without Mask Torn the Fallen-wizard may play mind 5, 4 and 3 characters', () => {
    const state = buildFallenWizardOrgPhaseState({ site: ISENGARD_FW, characters: [SARUMAN_FW], hand: FW_HAND });
    const playable = viablePlayCharacterActions(state, PLAYER_1).map(a => a.characterInstanceId);
    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, BALIN));
    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, PEATH));
    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, KILI));
  });

  test('a Fallen-wizard may not bring a character with more than 4 mind into play', () => {
    const state = addCardInPlay(
      buildFallenWizardOrgPhaseState({ site: ISENGARD_FW, characters: [SARUMAN_FW], hand: FW_HAND }),
      HAZARD_PLAYER, MASK_TORN,
    );
    const balinId = findHandCardId(state, RESOURCE_PLAYER, BALIN);
    const playable = viablePlayCharacterActions(state, PLAYER_1).map(a => a.characterInstanceId);
    expect(playable).not.toContain(balinId);
    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, PEATH));
    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, KILI));

    const blocked = computeLegalActions(state, PLAYER_1).find(
      ea => !ea.viable && ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === balinId,
    );
    expect(blocked?.reason ?? '').toContain('Balin');
  });

  test('at exactly 9 stage points the cap stays at mind 4', () => {
    const state = addCardInPlay(
      buildFallenWizardOrgPhaseState({ site: ISENGARD_FW, characters: [SARUMAN_FW], hand: FW_HAND, stagePoints: 9 }),
      HAZARD_PLAYER, MASK_TORN,
    );
    const playable = viablePlayCharacterActions(state, PLAYER_1).map(a => a.characterInstanceId);
    expect(playable).not.toContain(findHandCardId(state, RESOURCE_PLAYER, BALIN));
    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, PEATH));
    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, KILI));
  });

  test('with more than 9 stage points a Fallen-wizard may not bring characters with more than 3 mind into play', () => {
    const state = addCardInPlay(
      buildFallenWizardOrgPhaseState({ site: ISENGARD_FW, characters: [SARUMAN_FW], hand: FW_HAND, stagePoints: 10 }),
      HAZARD_PLAYER, MASK_TORN,
    );
    const playable = viablePlayCharacterActions(state, PLAYER_1).map(a => a.characterInstanceId);
    expect(playable).not.toContain(findHandCardId(state, RESOURCE_PLAYER, BALIN));
    expect(playable).not.toContain(findHandCardId(state, RESOURCE_PLAYER, PEATH));
    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, KILI));
  });

  test('stage points alone restrict nothing while Mask Torn is not in play', () => {
    const state = buildFallenWizardOrgPhaseState({ site: ISENGARD_FW, characters: [SARUMAN_FW], hand: FW_HAND, stagePoints: 10 });
    const playable = viablePlayCharacterActions(state, PLAYER_1).map(a => a.characterInstanceId);
    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, BALIN));
    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, PEATH));
  });

  test('a non-Fallen-wizard player is unaffected', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [BALIN], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = addCardInPlay(base, HAZARD_PLAYER, MASK_TORN);
    const playable = viablePlayCharacterActions(state, PLAYER_1).map(a => a.characterInstanceId);
    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, BALIN));
  });

  test('discards when a play deck is exhausted', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [RIVENDELL] },
        {
          id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [RIVENDELL],
          playDeck: [], discardPile: [PEATH],
        },
      ],
    });
    const resetHandState: GameState = {
      ...base,
      phaseState: {
        ...(base.phaseState as EndOfTurnPhaseState),
        step: 'reset-hand' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: [true, false] as [boolean, boolean],
      } as EndOfTurnPhaseState,
    };
    const withEvent = addCardInPlay(resetHandState, HAZARD_PLAYER, MASK_TORN);

    const afterExhaust = dispatch(withEvent, { type: 'deck-exhaust', player: PLAYER_2 });
    expect(afterExhaust.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === MASK_TORN)).toBe(true);

    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_2 });
    expect(afterPass.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === MASK_TORN)).toBe(false);
  });
});
