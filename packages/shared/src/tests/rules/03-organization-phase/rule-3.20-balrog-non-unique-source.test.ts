/**
 * @module rule-3.20-balrog-non-unique-source
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.20: Balrog Non-Unique Character Source
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [BALROG] When a Balrog player plays a non-unique character with mind of three or less, that character may come from the player's hand, discard pile, or sideboard.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../test-helpers.js';
import {
  buildTestState, resetMint, dispatch, Phase, Alignment,
  viablePlayCharacterActions,
  PLAYER_1, PLAYER_2,
  ARAGORN, RIVENDELL,
} from '../../test-helpers.js';

// Non-unique, mind <= 3, Balrog-legal characters. Single-test use → inline.
const MOUNTAIN_MAGGOT = 'ba-8' as CardDefinitionId; // mind 1
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId; // mind 2
const ORC_CAPTAIN = 'le-31' as CardDefinitionId; // mind 5 — above the mind-3 threshold
const THE_UNDER_GATES = 'ba-100' as CardDefinitionId;

describe('Rule 3.20 — Balrog Non-Unique Character Source', () => {
  beforeEach(() => resetMint());

  test('[BALROG] Non-unique mind<=3 character playable from the discard pile', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          hand: [],
          discardPile: [MOUNTAIN_MAGGOT],
          siteDeck: [THE_UNDER_GATES],
          companies: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          hand: [],
          siteDeck: [],
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        },
      ],
      recompute: true,
    });

    const discardInstId = state.players[0].discardPile.find(c => c.definitionId === MOUNTAIN_MAGGOT)!.instanceId;
    const play = viablePlayCharacterActions(state, PLAYER_1)
      .find(a => a.characterInstanceId === discardInstId);
    expect(play).toBeDefined();

    const after = dispatch(state, play!);
    expect(after.players[0].discardPile.some(c => c.instanceId === discardInstId)).toBe(false);
    expect(after.players[0].characters[discardInstId]).toBeDefined();
  });

  test('[BALROG] Non-unique mind<=3 character playable from the sideboard', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          hand: [],
          sideboard: [CROOK_LEGGED_ORC],
          siteDeck: [THE_UNDER_GATES],
          companies: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          hand: [],
          siteDeck: [],
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        },
      ],
      recompute: true,
    });

    const sideboardInstId = state.players[0].sideboard.find(c => c.definitionId === CROOK_LEGGED_ORC)!.instanceId;
    const play = viablePlayCharacterActions(state, PLAYER_1)
      .find(a => a.characterInstanceId === sideboardInstId);
    expect(play).toBeDefined();

    const after = dispatch(state, play!);
    expect(after.players[0].sideboard.some(c => c.instanceId === sideboardInstId)).toBe(false);
    expect(after.players[0].characters[sideboardInstId]).toBeDefined();
  });

  test('[BALROG] A non-unique character above the mind-3 threshold is not offered from the discard pile', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          hand: [],
          discardPile: [ORC_CAPTAIN],
          siteDeck: [THE_UNDER_GATES],
          companies: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          hand: [],
          siteDeck: [],
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        },
      ],
      recompute: true,
    });

    const discardInstId = state.players[0].discardPile.find(c => c.definitionId === ORC_CAPTAIN)!.instanceId;
    expect(viablePlayCharacterActions(state, PLAYER_1)
      .some(a => a.characterInstanceId === discardInstId)).toBe(false);
  });
});
