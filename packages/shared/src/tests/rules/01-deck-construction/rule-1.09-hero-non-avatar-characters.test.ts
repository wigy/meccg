/**
 * @module rule-1.09-hero-non-avatar-characters
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.09: Hero Non-Avatar Characters
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [HERO] A Wizard player's non-avatar characters can only be hero characters, but a Wizard player may include agent character cards in their deck. Instead of an agent being a character card for a Wizard player, it is treated as a hazard card for deck-building requirements and in all areas throughout the game.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viablePlayCharacterActions, nonViablePlayCharacterActions, Phase,
  PLAYER_1, PLAYER_2,
  LEGOLAS,
  RIVENDELL, LORIEN, BREE,
  Alignment,
} from '../../test-helpers.js';
import type { CardDefinitionId } from '../../../index.js';

// Bill Ferny (dm-3): agent character, homesite "Bree, Cameth Brin", mind 3
const BILL_FERNY = 'dm-3' as CardDefinitionId;

describe('Rule 1.09 — Hero Non-Avatar Characters', () => {
  beforeEach(() => resetMint());

  test('[HERO] Wizard player cannot play agent character from hand — agent is treated as a hazard card', () => {
    // Bill Ferny has the "agent" keyword. For a Wizard player, agents are
    // treated as hazard cards in all areas and may not be played as characters
    // (rule 1.09 / rule 1.3.W2). The engine must mark the action as non-viable.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          hand: [BILL_FERNY],
          siteDeck: [RIVENDELL, BREE],
          companies: [],
        },
        { id: PLAYER_2, hand: [], siteDeck: [], companies: [{ site: LORIEN, characters: [LEGOLAS] }] },
      ],
      recompute: true,
    });

    const billFernyInstId = state.players[0].hand.find(c => c.definitionId === BILL_FERNY)?.instanceId;

    // Bill Ferny must appear as a non-viable play-character action
    const nonViable = nonViablePlayCharacterActions(state, PLAYER_1);
    expect(nonViable.some(a => a.characterInstanceId === billFernyInstId)).toBe(true);

    // No viable play-character action exists for Bill Ferny
    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable.every(a => a.characterInstanceId !== billFernyInstId)).toBe(true);
  });
});
