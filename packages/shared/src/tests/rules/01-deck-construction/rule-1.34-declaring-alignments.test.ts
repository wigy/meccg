/**
 * @module rule-1.34-declaring-alignments
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.34: Declaring Alignments
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Declaring Alignments - To begin a new game, each player must declare which type of player they are.
 */

import { describe, test, expect } from 'vitest';
import {
  makePlayDeck, pool, PLAYER_1, PLAYER_2, RIVENDELL, Alignment,
  createGame,
} from '../../test-helpers.js';
import type { GameConfig, CardDefinitionId } from '../../../index.js';

const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const THE_WHITE_TOWERS = 'wh-58' as CardDefinitionId;
const MORIA_BALROG = 'ba-93' as CardDefinitionId;

/** Builds a two-player config with the given declared alignments. */
function makeConfig(p1Alignment: Alignment, p2Alignment: Alignment): GameConfig {
  const siteFor = (alignment: Alignment): CardDefinitionId => {
    switch (alignment) {
      case Alignment.Wizard: return RIVENDELL;
      case Alignment.Ringwraith: return MINAS_MORGUL;
      case Alignment.FallenWizard: return THE_WHITE_TOWERS;
      case Alignment.Balrog: return MORIA_BALROG;
    }
  };
  return {
    players: [
      {
        id: PLAYER_1,
        name: 'Alice',
        alignment: p1Alignment,
        draftPool: [],
        playDeck: makePlayDeck(),
        siteDeck: [siteFor(p1Alignment)],
        sideboard: [],
      },
      {
        id: PLAYER_2,
        name: 'Bob',
        alignment: p2Alignment,
        draftPool: [],
        playDeck: makePlayDeck(),
        siteDeck: [siteFor(p2Alignment)],
        sideboard: [],
      },
    ],
    seed: 42,
  };
}

describe('Rule 1.34 — Declaring Alignments', () => {
  test('a new game records each player\'s declared alignment', () => {
    const state = createGame(makeConfig(Alignment.Wizard, Alignment.Ringwraith), pool);
    expect(state.players[0].alignment).toBe(Alignment.Wizard);
    expect(state.players[1].alignment).toBe(Alignment.Ringwraith);
  });

  test('all four player types can be declared', () => {
    for (const alignment of [Alignment.Wizard, Alignment.Ringwraith, Alignment.FallenWizard, Alignment.Balrog]) {
      const state = createGame(makeConfig(alignment, Alignment.Wizard), pool);
      expect(state.players[0].alignment).toBe(alignment);
    }
  });
});
