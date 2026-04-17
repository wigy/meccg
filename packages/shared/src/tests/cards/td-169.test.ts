/**
 * @module td-169.test
 *
 * Card test: Wizard Uncloaked (td-169)
 * Type: hero-resource-event (short, spell)
 * Effects:
 *   1. play-target character (filter: target.race wizard)
 *   2. bounce-hazard-events (return all hazard permanent-events on
 *      characters in wizard's company to opponent's hand, wizard makes
 *      corruption check modified by -2)
 *
 * "Spell. Wizard only. Return all hazard permanent-events on characters
 *  in your Wizard's company to opponent's hand. Wizard makes a corruption
 *  check modified by -2."
 *
 * Engine Support:
 * | # | Feature                                        | Status      | Notes                               |
 * |---|------------------------------------------------|-------------|-------------------------------------|
 * | 1 | Target = wizard (DSL filter)                   | IMPLEMENTED | play-target filter target.race wizard |
 * | 2 | Bounce hazard permanent-events to opp hand     | IMPLEMENTED | reducer-events bounce-hazard-events  |
 * | 3 | Wizard makes corruption check (-2 modifier)    | IMPLEMENTED | enqueues pending resolution          |
 * | 4 | Card discarded after play                      | IMPLEMENTED | reducer discards short event         |
 * | 5 | Not playable without wizard in play            | IMPLEMENTED | no eligible targets → not-playable   |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GANDALF,
  FOOLISH_WORDS, LURE_OF_THE_SENSES,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions,
  dispatch, expectInDiscardPile,
  attachHazardToChar, findCharInstanceId, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { PlayShortEventAction, CardDefinitionId } from '../../index.js';

const WIZARD_UNCLOAKED = 'td-169' as CardDefinitionId;

describe('Wizard Uncloaked (td-169)', () => {
  beforeEach(() => resetMint());

  test('playable in long-event phase when wizard is in play', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }], hand: [WIZARD_UNCLOAKED], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
    const action = playActions[0].action as PlayShortEventAction;
    expect(action.targetCharacterId).toBeDefined();
  });

  test('NOT playable when no wizard is in play', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [WIZARD_UNCLOAKED], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('playing bounces hazard permanent-events from wizard company to opponent hand', () => {
    let state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }], hand: [WIZARD_UNCLOAKED], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    state = attachHazardToChar(state, RESOURCE_PLAYER, GANDALF, FOOLISH_WORDS);
    state = attachHazardToChar(state, RESOURCE_PLAYER, ARAGORN, LURE_OF_THE_SENSES);

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);

    const after = dispatch(state, playActions[0].action);

    // Both hazard permanent-events should be returned to opponent's hand
    expect(after.players[1].hand).toHaveLength(2);
    const returnedDefIds = after.players[1].hand.map(c => c.definitionId);
    expect(returnedDefIds).toContain(FOOLISH_WORDS);
    expect(returnedDefIds).toContain(LURE_OF_THE_SENSES);

    // Characters should have no hazards attached
    const gandalfId = findCharInstanceId(after, RESOURCE_PLAYER, GANDALF);
    const aragornId = findCharInstanceId(after, RESOURCE_PLAYER, ARAGORN);
    expect(after.players[0].characters[gandalfId as string].hazards).toHaveLength(0);
    expect(after.players[0].characters[aragornId as string].hazards).toHaveLength(0);
  });

  test('playing enqueues corruption check on wizard with -2 modifier', () => {
    let state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }], hand: [WIZARD_UNCLOAKED], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    state = attachHazardToChar(state, RESOURCE_PLAYER, GANDALF, FOOLISH_WORDS);

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    const after = dispatch(state, playActions[0].action);

    expect(after.pendingResolutions).toHaveLength(1);
    expect(after.pendingResolutions[0].kind.type).toBe('corruption-check');
    const ccKind = after.pendingResolutions[0].kind as { type: 'corruption-check'; modifier: number; characterId: unknown };
    expect(ccKind.modifier).toBe(-2);

    const gandalfId = findCharInstanceId(after, RESOURCE_PLAYER, GANDALF);
    expect(ccKind.characterId).toBe(gandalfId);
  });

  test('card is discarded after play', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }], hand: [WIZARD_UNCLOAKED], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    const after = dispatch(state, playActions[0].action);

    expect(after.players[0].hand).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, WIZARD_UNCLOAKED);
  });

  test('does not bounce non-permanent hazards (e.g. no hazards to bounce still enqueues corruption check)', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }], hand: [WIZARD_UNCLOAKED], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    const after = dispatch(state, playActions[0].action);

    // No hazards to bounce — opponent hand stays empty
    expect(after.players[1].hand).toHaveLength(0);

    // Corruption check still enqueued
    expect(after.pendingResolutions).toHaveLength(1);
    expect(after.pendingResolutions[0].kind.type).toBe('corruption-check');
  });

  test('only bounces hazards from wizard company, not other companies', () => {
    let state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [GANDALF] },
            { site: MORIA, characters: [ARAGORN] },
          ],
          hand: [WIZARD_UNCLOAKED],
          siteDeck: [LORIEN],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Attach hazard to Aragorn who is in a DIFFERENT company from Gandalf
    state = attachHazardToChar(state, RESOURCE_PLAYER, ARAGORN, FOOLISH_WORDS);

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    const after = dispatch(state, playActions[0].action);

    // Aragorn's hazard should NOT be bounced (different company)
    expect(after.players[1].hand).toHaveLength(0);
    const aragornId = findCharInstanceId(after, RESOURCE_PLAYER, ARAGORN);
    expect(after.players[0].characters[aragornId as string].hazards).toHaveLength(1);
  });
});
