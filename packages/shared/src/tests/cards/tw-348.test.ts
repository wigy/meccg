/**
 * @module tests/cards/tw-348
 *
 * Card test for **The White Tree** (tw-348).
 *
 * The White Tree is a unique permanent resource event worth 5 MP.
 * Card text: "Unique. Sage only at Minas Tirith. Playable only if you
 * discard a Sapling of the White Tree borne by one of your characters
 * at Minas Tirith, or one from your Marshalling Points pile stored at
 * Minas Tirith. Minas Tirith becomes a Haven [{H}] for the purposes
 * of healing and playing hazards."
 *
 * Rules tested:
 * - Requires a sage character in the company at Minas Tirith
 * - Site must be Minas Tirith (play-target site filter)
 * - Requires discarding a Sapling of the White Tree (from character
 *   items or out-of-play pile)
 * - Not playable without a Sapling
 * - Not playable at other sites
 * - Not playable without a sage
 * - After entering play, adds a site-type-override constraint making
 *   Minas Tirith a haven for healing
 * - Wounded characters at Minas Tirith heal during untap when White
 *   Tree is in play
 */

import { describe, test, beforeEach, expect } from 'vitest';
import {
  buildSitePhaseState, resetMint, PLAYER_1, PLAYER_2,
  playPermanentEventAndResolve, handCardId,
  attachItemToChar, findCharInstanceId,
} from '../test-helpers.js';
import {
  computeLegalActions, reduce, Phase, CardStatus,
  ELROND, ARAGORN, LEGOLAS, MINAS_TIRITH, MORIA, LORIEN,
  SAPLING_OF_THE_WHITE_TREE, RIVENDELL,
} from '../../index.js';
import type {
  CardDefinitionId, GameState, CardInstance, PlayPermanentEventAction,
} from '../../index.js';
import { buildTestState, mint } from '../test-helpers.js';

const THE_WHITE_TREE = 'tw-348' as CardDefinitionId;

describe('tw-348 The White Tree', () => {
  beforeEach(() => resetMint());

  test('playable by a sage at Minas Tirith with Sapling on character', () => {
    let state: GameState = buildSitePhaseState({
      site: MINAS_TIRITH,
      characters: [ELROND],
      hand: [THE_WHITE_TREE],
    });
    state = attachItemToChar(state, 0, ELROND, SAPLING_OF_THE_WHITE_TREE);

    const actions = computeLegalActions(state, PLAYER_1);
    const playActions = actions
      .filter(a => a.viable && a.action.type === 'play-permanent-event');
    expect(playActions).toHaveLength(1);

    const action = playActions[0].action as PlayPermanentEventAction;
    expect(action.discardCardInstanceId).toBeDefined();
    expect(action.targetSiteDefinitionId).toBe(MINAS_TIRITH);
  });

  test('playable with Sapling from out-of-play pile (stored)', () => {
    let state: GameState = buildSitePhaseState({
      site: MINAS_TIRITH,
      characters: [ELROND],
      hand: [THE_WHITE_TREE],
    });
    const saplingInstance: CardInstance = {
      instanceId: mint(),
      definitionId: SAPLING_OF_THE_WHITE_TREE,
    };
    const p0 = state.players[0];
    const updatedP0 = { ...p0, outOfPlayPile: [...p0.outOfPlayPile, saplingInstance] };
    state = { ...state, players: [updatedP0, state.players[1]] } as typeof state;

    const actions = computeLegalActions(state, PLAYER_1);
    const playActions = actions
      .filter(a => a.viable && a.action.type === 'play-permanent-event');
    expect(playActions).toHaveLength(1);

    const action = playActions[0].action as PlayPermanentEventAction;
    expect(action.discardCardInstanceId).toBe(saplingInstance.instanceId);
  });

  test('not playable without a Sapling', () => {
    const state = buildSitePhaseState({
      site: MINAS_TIRITH,
      characters: [ELROND],
      hand: [THE_WHITE_TREE],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const playActions = actions
      .filter(a => a.viable && a.action.type === 'play-permanent-event');
    expect(playActions).toHaveLength(0);
  });

  test('not playable at a non-Minas Tirith site', () => {
    let state: GameState = buildSitePhaseState({
      site: RIVENDELL,
      characters: [ELROND],
      hand: [THE_WHITE_TREE],
    });
    state = attachItemToChar(state, 0, ELROND, SAPLING_OF_THE_WHITE_TREE);

    const actions = computeLegalActions(state, PLAYER_1);
    const playActions = actions
      .filter(a => a.viable && a.action.type === 'play-permanent-event');
    expect(playActions).toHaveLength(0);
  });

  test('not playable without a sage in the company', () => {
    let state: GameState = buildSitePhaseState({
      site: MINAS_TIRITH,
      characters: [ARAGORN],
      hand: [THE_WHITE_TREE],
    });
    state = attachItemToChar(state, 0, ARAGORN, SAPLING_OF_THE_WHITE_TREE);

    const actions = computeLegalActions(state, PLAYER_1);
    const playActions = actions
      .filter(a => a.viable && a.action.type === 'play-permanent-event');
    expect(playActions).toHaveLength(0);
  });

  test('playing discards the Sapling from the character', () => {
    let state: GameState = buildSitePhaseState({
      site: MINAS_TIRITH,
      characters: [ELROND],
      hand: [THE_WHITE_TREE],
    });
    state = attachItemToChar(state, 0, ELROND, SAPLING_OF_THE_WHITE_TREE);

    const elrondId = findCharInstanceId(state, 0, ELROND);
    const saplingId = state.players[0].characters[elrondId as string].items[0].instanceId;
    const whiteTreeId = handCardId(state, 0);

    state = playPermanentEventAndResolve(state, PLAYER_1, whiteTreeId, undefined, {
      targetSiteDefinitionId: MINAS_TIRITH,
      discardCardInstanceId: saplingId,
    });

    // Sapling should be in discard pile
    const saplingInDiscard = state.players[0].discardPile.some(
      c => c.definitionId === SAPLING_OF_THE_WHITE_TREE,
    );
    expect(saplingInDiscard).toBe(true);

    // Sapling should no longer be on the character
    const elrond = state.players[0].characters[elrondId as string];
    expect(elrond.items).toHaveLength(0);

    // The White Tree should be in cardsInPlay
    const wtInPlay = state.players[0].cardsInPlay.some(
      c => c.definitionId === THE_WHITE_TREE,
    );
    expect(wtInPlay).toBe(true);
  });

  test('playing discards the Sapling from out-of-play pile', () => {
    let state: GameState = buildSitePhaseState({
      site: MINAS_TIRITH,
      characters: [ELROND],
      hand: [THE_WHITE_TREE],
    });
    const saplingInstance: CardInstance = {
      instanceId: mint(),
      definitionId: SAPLING_OF_THE_WHITE_TREE,
    };
    const p0 = state.players[0];
    const updatedP0 = { ...p0, outOfPlayPile: [...p0.outOfPlayPile, saplingInstance] };
    state = { ...state, players: [updatedP0, state.players[1]] } as typeof state;

    const whiteTreeId = handCardId(state, 0);

    state = playPermanentEventAndResolve(state, PLAYER_1, whiteTreeId, undefined, {
      targetSiteDefinitionId: MINAS_TIRITH,
      discardCardInstanceId: saplingInstance.instanceId,
    });

    // Sapling should be in discard pile, not out-of-play pile
    expect(state.players[0].outOfPlayPile).toHaveLength(0);
    const saplingInDiscard = state.players[0].discardPile.some(
      c => c.definitionId === SAPLING_OF_THE_WHITE_TREE,
    );
    expect(saplingInDiscard).toBe(true);

    // White Tree should be in cardsInPlay
    const wtInPlay = state.players[0].cardsInPlay.some(
      c => c.definitionId === THE_WHITE_TREE,
    );
    expect(wtInPlay).toBe(true);
  });

  test('adds site-type-override constraint making Minas Tirith a haven', () => {
    let state: GameState = buildSitePhaseState({
      site: MINAS_TIRITH,
      characters: [ELROND],
      hand: [THE_WHITE_TREE],
    });
    state = attachItemToChar(state, 0, ELROND, SAPLING_OF_THE_WHITE_TREE);

    const elrondId = findCharInstanceId(state, 0, ELROND);
    const saplingId = state.players[0].characters[elrondId as string].items[0].instanceId;
    const whiteTreeId = handCardId(state, 0);

    state = playPermanentEventAndResolve(state, PLAYER_1, whiteTreeId, undefined, {
      targetSiteDefinitionId: MINAS_TIRITH,
      discardCardInstanceId: saplingId,
    });

    // Should have an active constraint overriding Minas Tirith to haven
    const override = state.activeConstraints.find(
      c => c.kind.type === 'attribute-modifier'
        && c.kind.attribute === 'site.type'
        && c.kind.op === 'override'
        && c.kind.value === 'haven'
        && (c.kind.filter as { 'site.definitionId'?: string } | undefined)?.['site.definitionId'] === (MINAS_TIRITH as unknown as string),
    );
    expect(override).toBeDefined();
    expect(override!.scope.kind).toBe('until-cleared');
  });

  test('wounded characters at Minas Tirith heal during untap when White Tree is in play', () => {
    // Build untap-phase state with a wounded character at Minas Tirith
    // and a site-type-override constraint (simulating White Tree in play)
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [{ defId: ELROND, status: CardStatus.Inverted }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    // Add attribute-modifier constraint for Minas Tirith → haven
    const whiteTreeInstance = mint();
    const constraintState: GameState = {
      ...state,
      activeConstraints: [
        ...state.activeConstraints,
        {
          id: ('c-1') as import('../../index.js').ConstraintId,
          source: whiteTreeInstance,
          sourceDefinitionId: THE_WHITE_TREE,
          scope: { kind: 'until-cleared' },
          target: { kind: 'player', playerId: PLAYER_1 },
          kind: {
            type: 'attribute-modifier' as const,
            attribute: 'site.type' as const,
            op: 'override' as const,
            value: 'haven' as import('../../index.js').SiteType,
            filter: { 'site.definitionId': MINAS_TIRITH as unknown as string },
          },
        },
      ],
    };

    const result = reduce(constraintState, { type: 'untap', player: PLAYER_1 });
    expect(result.error).toBeUndefined();

    // Wounded character should heal to tapped (like at a haven)
    const elrondId = findCharInstanceId(result.state, 0, ELROND);
    const elrond = result.state.players[0].characters[elrondId as string];
    expect(elrond.status).toBe(CardStatus.Tapped);
  });

  test('wounded characters at Minas Tirith stay wounded without White Tree', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [{ defId: ELROND, status: CardStatus.Inverted }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const result = reduce(state, { type: 'untap', player: PLAYER_1 });
    expect(result.error).toBeUndefined();

    // Without the constraint, Minas Tirith is a free-hold — no healing
    const elrondId = findCharInstanceId(result.state, 0, ELROND);
    const elrond = result.state.players[0].characters[elrondId as string];
    expect(elrond.status).toBe(CardStatus.Inverted);
  });

  test('unique — not playable if already in play', () => {
    let state: GameState = buildSitePhaseState({
      site: MINAS_TIRITH,
      characters: [ELROND],
      hand: [THE_WHITE_TREE],
    });
    state = attachItemToChar(state, 0, ELROND, SAPLING_OF_THE_WHITE_TREE);

    // Put The White Tree already in play
    const wtInPlay = { instanceId: mint(), definitionId: THE_WHITE_TREE, status: CardStatus.Untapped };
    const p0 = state.players[0];
    const updatedP0 = { ...p0, cardsInPlay: [...p0.cardsInPlay, wtInPlay] };
    state = { ...state, players: [updatedP0, state.players[1]] } as typeof state;

    const actions = computeLegalActions(state, PLAYER_1);
    const playActions = actions
      .filter(a => a.viable && a.action.type === 'play-permanent-event');
    expect(playActions).toHaveLength(0);
  });
});
