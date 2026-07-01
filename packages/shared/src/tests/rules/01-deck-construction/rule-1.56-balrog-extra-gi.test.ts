/**
 * @module rule-1.56-balrog-extra-gi
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.56: Balrog Extra General Influence
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [BALROG] A Balrog player has an additional 5 points of general influence that cannot be used to control characters, and which is added on top of available general influence (i.e. even if the player's available general influence has been stopped at zero).
 */

import { describe, test, expect } from 'vitest';
import {
  makePlayDeck, pool, PLAYER_1, PLAYER_2, RIVENDELL, Alignment,
  createGame,
} from '../../test-helpers.js';
import { extraGeneralInfluence, effectiveGeneralInfluence, GENERAL_INFLUENCE } from '../../../index.js';
import type { GameConfig, CardDefinitionId } from '../../../index.js';

const MORIA_BALROG = 'ba-93' as CardDefinitionId;

function makeConfig(p1Alignment: Alignment): GameConfig {
  return {
    players: [
      {
        id: PLAYER_1,
        name: 'Alice',
        alignment: p1Alignment,
        draftPool: [],
        playDeck: makePlayDeck(),
        siteDeck: [p1Alignment === Alignment.Balrog ? MORIA_BALROG : RIVENDELL],
        sideboard: [],
      },
      {
        id: PLAYER_2,
        name: 'Bob',
        alignment: Alignment.Wizard,
        draftPool: [],
        playDeck: makePlayDeck(),
        siteDeck: [RIVENDELL],
        sideboard: [],
      },
    ],
    seed: 42,
  };
}

describe('Rule 1.56 — Balrog Extra General Influence', () => {
  test('[BALROG] a Balrog player has an additional 5 general influence', () => {
    expect(extraGeneralInfluence(Alignment.Balrog)).toBe(5);
  });

  test('[BALROG] the extra general influence does not enlarge the pool used to control characters', () => {
    const state = createGame(makeConfig(Alignment.Balrog), pool);
    // The character-control budget stays at the base 20 — the extra 5 is not
    // part of it, matching the rule's "cannot be used to control characters".
    expect(effectiveGeneralInfluence(state, PLAYER_1)).toBe(GENERAL_INFLUENCE);
    expect(extraGeneralInfluence(state.players[0].alignment)).toBe(5);
  });
});
