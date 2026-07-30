/**
 * @module ordered-decks.test
 *
 * `GameConfig.orderedDecks` — the scripted-game flag used by the guided
 * tutorial (specs/2026-07-30-tutorial-plan.md). When set, each player's play
 * deck keeps the exact order supplied in the config for the whole game:
 * neither the pre-draft shuffle at game creation nor the `shuffle-play-deck`
 * setup step may disturb it, so index 0 is always the next card drawn and a
 * tutorial script can predict every draw. Characters added during the
 * character-deck-draft step join the bottom of the deck, leaving the
 * arranged draw order untouched.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, FRODO, LEGOLAS, GIMLI,
  makeDraftConfig, makePlayDeck, runFullSetup, runSimpleDraft,
  resetMint, runActions, dispatch,
  pool,
} from '../../test-helpers.js';
import { createGame, Phase, SetupStep, HAND_SIZE } from '../../../index.js';
import type { GameConfig } from '../../../index.js';

describe('orderedDecks: scripted games keep the configured play-deck order', () => {
  beforeEach(() => resetMint());

  test('createGame preserves the configured deck order for both players', () => {
    const config: GameConfig = { ...makeDraftConfig(), orderedDecks: true };
    const state = createGame(config, pool);

    expect(state.orderedDecks).toBe(true);
    expect(state.players[0].playDeck.map(c => c.definitionId)).toEqual(makePlayDeck());
    expect(state.players[1].playDeck.map(c => c.definitionId)).toEqual(makePlayDeck());
  });

  test('without the flag the pre-draft shuffle randomizes the deck (control)', () => {
    const state = createGame(makeDraftConfig(), pool);

    expect(state.orderedDecks).toBeUndefined();
    expect(state.players[0].playDeck.map(c => c.definitionId)).not.toEqual(makePlayDeck());
  });

  test('order survives the shuffle-play-deck step: opening hand is the first 8 configured cards', () => {
    const state = runFullSetup({ ...makeDraftConfig(), orderedDecks: true });
    const configured = makePlayDeck();

    expect(state.phaseState.phase).toBe(Phase.Untap);
    expect(state.players[0].hand.map(c => c.definitionId)).toEqual(configured.slice(0, HAND_SIZE));
    expect(state.players[0].playDeck.map(c => c.definitionId)).toEqual(configured.slice(HAND_SIZE));
    expect(state.players[1].hand.map(c => c.definitionId)).toEqual(configured.slice(0, HAND_SIZE));
    expect(state.players[1].playDeck.map(c => c.definitionId)).toEqual(configured.slice(HAND_SIZE));
  });

  test('add-character-to-deck joins the bottom of the ordered deck', () => {
    const base = makeDraftConfig();
    // Character-only draft pools: no starting items, so the item-draft step
    // has nothing to assign and the deck-draft step still has leftovers.
    const config: GameConfig = {
      ...base,
      orderedDecks: true,
      players: [
        { ...base.players[0], draftPool: [ARAGORN, BILBO, FRODO] },
        { ...base.players[1], draftPool: [LEGOLAS, GIMLI] },
      ],
    };
    let state = runSimpleDraft(config);

    // Skip the (empty) item draft if the engine stopped there.
    if (state.phaseState.phase === Phase.Setup && state.phaseState.setupStep.step === SetupStep.ItemDraft) {
      state = runActions(state, [
        { type: 'pass', player: PLAYER_1 },
        { type: 'pass', player: PLAYER_2 },
      ]);
    }

    expect(state.phaseState.phase).toBe(Phase.Setup);
    if (state.phaseState.phase !== Phase.Setup || state.phaseState.setupStep.step !== SetupStep.CharacterDeckDraft) {
      throw new Error(`expected character-deck-draft, got ${JSON.stringify(state.phaseState)}`);
    }

    const frodo = state.phaseState.setupStep.deckDraftState[0].remainingPool.find(c => c.definitionId === FRODO);
    if (!frodo) throw new Error('Frodo not in remaining pool');
    const deckBefore = state.players[0].playDeck.map(c => c.definitionId);

    state = dispatch(state, { type: 'add-character-to-deck', player: PLAYER_1, characterInstanceId: frodo.instanceId });

    // Frodo lands at the bottom — the arranged draw order above him is untouched.
    expect(state.players[0].playDeck.map(c => c.definitionId)).toEqual([...deckBefore, FRODO]);
  });
});
