/**
 * @module rule-3.19-balrog-extra-character
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.19: Balrog Extra Character Play
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [BALROG] In addition to playing or discarding one character while organizing, a Balrog player may take one additional action to play or remove from play a non-unique character while organizing.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../test-helpers.js';
import {
  buildTestState, resetMint, dispatch, phaseStateAs, Phase, Alignment,
  viablePlayCharacterActions, nonViablePlayCharacterActions,
  PLAYER_1, PLAYER_2,
  ARAGORN, RIVENDELL,
} from '../../test-helpers.js';
import type { OrganizationPhaseState } from '../../../index.js';

// Three non-unique Balrog-legal characters, all playable at the Balrog's
// haven (The Under-gates). Single-test use → inline.
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId; // mind 2, non-unique
const MOUNTAIN_MAGGOT = 'ba-8' as CardDefinitionId; // mind 1, non-unique
const ORC_CAPTAIN = 'le-31' as CardDefinitionId; // mind 5, non-unique
const THE_UNDER_GATES = 'ba-100' as CardDefinitionId;

describe('Rule 3.19 — Balrog Extra Character Play', () => {
  beforeEach(() => resetMint());

  test('[BALROG] May play a second non-unique character on the same turn, but not a third', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          hand: [CROOK_LEGGED_ORC, MOUNTAIN_MAGGOT, ORC_CAPTAIN],
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

    // First play: normal once-per-turn play.
    const firstPlay = viablePlayCharacterActions(state, PLAYER_1)
      .find(a => a.characterInstanceId === state.players[0].hand.find(c => c.definitionId === CROOK_LEGGED_ORC)!.instanceId)!;
    expect(firstPlay).toBeDefined();
    const afterFirst = dispatch(state, firstPlay);
    expect(phaseStateAs<OrganizationPhaseState>(afterFirst).characterPlayedThisTurn).toBe(true);

    // Second play: the Balrog's extra non-unique-character action.
    const secondCandidate = afterFirst.players[0].hand.find(c => c.definitionId === MOUNTAIN_MAGGOT)!.instanceId;
    const secondPlay = viablePlayCharacterActions(afterFirst, PLAYER_1)
      .find(a => a.characterInstanceId === secondCandidate);
    expect(secondPlay).toBeDefined();
    const afterSecond = dispatch(afterFirst, secondPlay!);

    // Third non-unique character: no more extra plays this turn.
    const thirdInstId = afterSecond.players[0].hand.find(c => c.definitionId === ORC_CAPTAIN)!.instanceId;
    const thirdViable = viablePlayCharacterActions(afterSecond, PLAYER_1)
      .filter(a => a.characterInstanceId === thirdInstId);
    expect(thirdViable).toHaveLength(0);
    const thirdBlocked = nonViablePlayCharacterActions(afterSecond, PLAYER_1)
      .filter(a => a.characterInstanceId === thirdInstId);
    expect(thirdBlocked.length).toBeGreaterThan(0);
  });
});
