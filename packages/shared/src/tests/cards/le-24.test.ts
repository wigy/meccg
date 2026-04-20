/**
 * @module le-24.test
 *
 * Card test: The Mouth (le-24)
 * Type: minion-character
 * Effects: 2
 *
 * "Unique. Manifestation of Mouth of Sauron. +2 direct influence against any
 *  faction. Tap during your organization phase to move one resource or
 *  character from your discard pile to your play deck and reshuffle."
 *
 * Effects tested:
 * 1. stat-modifier: +2 DI during faction-influence-check (any faction)
 * 2. grant-action: tap during organization phase to fetch one resource or
 *    character from the discard pile into the play deck (reshuffle). No
 *    corruption check. Hazards in the discard pile are not eligible.
 *
 * Fixture alignment: minion-character (ringwraith), so tests use minion sites
 * (LE) and minion resource cards.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  Phase, CardStatus,
  ORC_PATROL,
  buildTestState, buildSitePhaseState, resetMint,
  viableActions, dispatch, findCharInstanceId,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type {
  ActivateGrantedAction, CardDefinitionId, GameState,
  InfluenceAttemptAction,
} from '../../index.js';
import { computeLegalActions } from '../../index.js';

const THE_MOUTH = 'le-24' as CardDefinitionId;

// Minion sites
const BARAD_DUR = 'le-352' as CardDefinitionId;     // dark-hold, Mouth's homesite
const DOL_GULDUR = 'le-367' as CardDefinitionId;    // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // minion haven
const MORIA_MINION = 'le-392' as CardDefinitionId;  // shadow-hold
const GOBLIN_GATE = 'le-378' as CardDefinitionId;   // shadow-hold (Goblins site)

// Minion cards for fetch tests / influence tests
const BLACK_MACE = 'le-299' as CardDefinitionId;             // minion-resource-item
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId; // minion-resource-faction

// Minion companion character for fixtures
const OSTISEN = 'le-36' as CardDefinitionId;

describe('The Mouth (le-24)', () => {
  beforeEach(() => resetMint());

  // ─── Effect 1: +2 DI during faction-influence-check (any faction) ───────────

  test('+2 DI vs any faction reduces the required roll to influence a faction', () => {
    // The Mouth base DI = 4. Goblins of Goblin-gate influenceNumber = 9.
    // Without the +2 DI bonus: need = 9 - 4 = 5.
    // With the +2 DI bonus against any faction: need = 9 - (4 + 2) = 3.
    const state = buildSitePhaseState({
      characters: [THE_MOUTH],
      site: GOBLIN_GATE,
      hand: [GOBLINS_OF_GOBLIN_GATE],
    });

    const mouthId = findCharInstanceId(state, RESOURCE_PLAYER, THE_MOUTH);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const mouthAttempt = influenceActions.find(a => a.influencingCharacterId === mouthId);
    expect(mouthAttempt).toBeDefined();
    expect(mouthAttempt!.need).toBe(3);
  });

  // ─── Effect 2: grant-action — tap to fetch resource/character from discard ──

  test('grant-action recall-to-deck is offered during organization phase when untapped', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BARAD_DUR, characters: [THE_MOUTH] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          discardPile: [BLACK_MACE],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const mouthActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'recall-to-deck',
    );
    expect(mouthActions).toHaveLength(1);
  });

  test('grant-action recall-to-deck is NOT offered when The Mouth is tapped', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BARAD_DUR, characters: [{ defId: THE_MOUTH, status: CardStatus.Tapped }] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          discardPile: [BLACK_MACE],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const mouthActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'recall-to-deck',
    );
    expect(mouthActions).toHaveLength(0);
  });

  test('activating recall-to-deck taps The Mouth and enqueues fetch-to-deck', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BARAD_DUR, characters: [THE_MOUTH] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          discardPile: [BLACK_MACE],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const mouthAction = actions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'recall-to-deck',
    )!;
    expect(mouthAction).toBeDefined();

    const next = dispatch(state, mouthAction.action);

    const mouthId = findCharInstanceId(next, RESOURCE_PLAYER, THE_MOUTH);
    expect(next.players[0].characters[mouthId as string].status).toBe(CardStatus.Tapped);

    expect(next.pendingEffects).toHaveLength(1);
    expect(next.pendingEffects[0].type).toBe('card-effect');
    const effect = (next.pendingEffects[0] as { effect: { type: string; source: readonly string[] } }).effect;
    expect(effect.type).toBe('fetch-to-deck');
    expect(effect.source).toEqual(['discard-pile']);
  });

  test('fetch-from-pile offers minion resources/characters but not hazards', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BARAD_DUR, characters: [THE_MOUTH] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          discardPile: [BLACK_MACE, ORC_PATROL],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const activateActions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const mouthAction = activateActions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'recall-to-deck',
    )!;
    const afterActivation = dispatch(state, mouthAction.action);

    const fetchActions = computeLegalActions(afterActivation, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');

    // Only Black Mace (minion-resource-item) is eligible; Orc-patrol
    // (hazard-creature) is filtered out.
    const maceInstance = afterActivation.players[0].discardPile.find(c => c.definitionId === BLACK_MACE)!;
    const patrolInstance = afterActivation.players[0].discardPile.find(c => c.definitionId === ORC_PATROL)!;

    const fetchedIds = fetchActions.map(
      ea => (ea.action as { cardInstanceId: string }).cardInstanceId,
    );
    expect(fetchedIds).toContain(maceInstance.instanceId as unknown as string);
    expect(fetchedIds).not.toContain(patrolInstance.instanceId as unknown as string);
  });

  test('fetch moves the chosen card from discard to play deck and enqueues no corruption check', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BARAD_DUR, characters: [THE_MOUTH] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: [MORIA_MINION],
          discardPile: [BLACK_MACE],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const activateActions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const mouthAction = activateActions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'recall-to-deck',
    )!;
    const afterActivation = dispatch(state, mouthAction.action);

    const fetchActions = computeLegalActions(afterActivation, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
    expect(fetchActions).toHaveLength(1);

    const playDeckBefore = afterActivation.players[0].playDeck.length;
    const discardBefore = afterActivation.players[0].discardPile.length;

    const afterFetch: GameState = dispatch(afterActivation, fetchActions[0].action);

    expect(afterFetch.players[0].discardPile).toHaveLength(discardBefore - 1);
    expect(afterFetch.players[0].playDeck).toHaveLength(playDeckBefore + 1);
    expect(afterFetch.players[0].playDeck.some(c => c.definitionId === BLACK_MACE)).toBe(true);

    expect(afterFetch.pendingEffects).toHaveLength(0);

    // No corruption check enqueued (unlike Palantír fetch).
    const pendingForPlayer = afterFetch.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pendingForPlayer).toHaveLength(0);
  });

  test('fetch can pull back a character from discard', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BARAD_DUR, characters: [THE_MOUTH] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          playDeck: [MORIA_MINION],
          discardPile: [OSTISEN],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [{ defId: 'le-21' as CardDefinitionId }] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const activateActions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const mouthAction = activateActions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'recall-to-deck',
    )!;
    const afterActivation = dispatch(state, mouthAction.action);

    const fetchActions = computeLegalActions(afterActivation, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');

    // The Ostisen in the discard pile (minion-character) is a valid target.
    expect(fetchActions).toHaveLength(1);

    const afterFetch = dispatch(afterActivation, fetchActions[0].action);
    expect(afterFetch.players[0].playDeck.some(c => c.definitionId === OSTISEN)).toBe(true);
    expect(afterFetch.players[0].discardPile.some(c => c.definitionId === OSTISEN)).toBe(false);
  });
});
