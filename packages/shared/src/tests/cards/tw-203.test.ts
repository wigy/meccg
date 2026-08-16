/**
 * @module tw-203.test
 *
 * Card test: Clear Skies (tw-203)
 * Type: hero-resource-event (Long-event, Environment), non-unique.
 *
 * Card text:
 *   "Environment. Playable only if Gates of Morning is in play. The prowess
 *    of each character is modified by +2."
 *
 * Effects:
 * | # | Effect                                          | Rule covered                       |
 * |---|--------------------------------------------------|-------------------------------------|
 * | 1 | play-condition (card-in-play, Gates of Morning)   | "Playable only if Gates of Morning is in play" |
 * | 2 | stat-modifier (prowess +2, target: all-characters) | "The prowess of each character is modified by +2" |
 *
 * Engine support (all shipped, precedent Fog tw-241 / The Sun Shone Fiercely
 * ba-25):
 * - `play-condition` `requires: 'card-in-play'` gates hero-resource
 *   long-event play in `legal-actions/long-event.ts`.
 * - `stat-modifier` `target: "all-characters"` applies to every character in
 *   play on either side (`collectGlobalEffects` / `recompute-derived.ts`).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GIMLI,
  GATES_OF_MORNING,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  Phase, Alignment,
  buildTestState, resetMint, getCharacter, baseProwess,
  addCardInPlay,
  actionAs,
  playLongEventAndResolve,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  computeLegalActions,
} from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import type {
  CardDefinitionId, CardInstanceId, GameState,
  PlayLongEventAction, NotPlayableAction, EvaluatedAction,
} from '../../index.js';

const CLEAR_SKIES = 'tw-203' as CardDefinitionId;

function resourceHandInstance(state: GameState, defId: CardDefinitionId): CardInstanceId {
  return state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === defId)!.instanceId;
}

describe('Clear Skies (tw-203)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: "Playable only if Gates of Morning is in play" ────────────────

  test('not playable while Gates of Morning is absent, playable once it is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [CLEAR_SKIES], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const inst = resourceHandInstance(state, CLEAR_SKIES);
    const isClearSkiesAction = (ea: EvaluatedAction) => {
      if (ea.action.type === 'not-playable') return actionAs<NotPlayableAction>(ea.action).cardInstanceId === inst;
      if (ea.action.type === 'play-long-event') return actionAs<PlayLongEventAction>(ea.action).cardInstanceId === inst;
      return false;
    };

    const withoutGom = computeLegalActions(state, PLAYER_1).find(isClearSkiesAction);
    expect(withoutGom?.viable).toBe(false);
    expect(withoutGom?.action.type).toBe('not-playable');
    expect(withoutGom?.reason).toMatch(/Gates of Morning/);

    const withGom = addCardInPlay(state, RESOURCE_PLAYER, GATES_OF_MORNING);
    const withGomAction = computeLegalActions(withGom, PLAYER_1).find(isClearSkiesAction);
    expect(withGomAction?.viable).toBe(true);
    expect(withGomAction?.action.type).toBe('play-long-event');
  });

  test('resolving Clear Skies moves it from hand into the resource player\'s cardsInPlay', () => {
    const state = addCardInPlay(
      buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.LongEvent,
        recompute: true,
        players: [
          { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [CLEAR_SKIES], siteDeck: [MINAS_TIRITH] },
          { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
        ],
      }),
      RESOURCE_PLAYER, GATES_OF_MORNING,
    );
    const inst = resourceHandInstance(state, CLEAR_SKIES);
    const after = playLongEventAndResolve(state, PLAYER_1, inst);
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === inst)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === CLEAR_SKIES)).toBe(false);
  });

  // ─── Rule 2: +2 prowess to every character, both sides ─────────────────────

  test('grants +2 prowess to a character in the controller\'s own company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const withCard = recomputeDerived(addCardInPlay(state, RESOURCE_PLAYER, CLEAR_SKIES));

    expect(getCharacter(withCard, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(baseProwess(ARAGORN) + 2);
  });

  test('also grants +2 prowess to the opponent\'s characters (global effect)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [] },
      ],
    });
    const withCard = recomputeDerived(addCardInPlay(state, RESOURCE_PLAYER, CLEAR_SKIES));

    expect(getCharacter(withCard, HAZARD_PLAYER, GIMLI).effectiveStats.prowess).toBe(baseProwess(GIMLI) + 2);
  });

  test('no bonus without Clear Skies in play (negative control)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(baseProwess(ARAGORN));
  });
});
