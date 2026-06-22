/**
 * MEWH — Anti-Fallen-wizard sideboard.
 *
 * Source: The White Hand Insert, "Declaring That Your Wizard is Fallen": "Your
 * opponent may also add 10 cards to his sideboard (these cards should be
 * preselected for a Fallen-wizard opponent)."
 *
 * A player's preselected anti-Fallen-wizard sideboard is folded into their main
 * sideboard at game start only when their *opponent* is a Fallen-wizard.
 */
import { describe, test, expect } from 'vitest';
import { Alignment } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';
import { createGame } from '../../engine/init.js';
import type { GameConfig } from '../../engine/init.js';
import {
  pool, PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, BILBO, FRODO, LEGOLAS, GIMLI, DAGGER_OF_WESTERNESSE,
  RIVENDELL, MORIA, MINAS_TIRITH, makePlayDeck,
} from '../test-helpers.js';

const ANTI_FW_A = 'tw-333' as CardDefinitionId; // Sting
const ANTI_FW_B = 'tw-206' as CardDefinitionId; // Dagger of Westernesse

function config(opponentAlignment: Alignment): GameConfig {
  return {
    players: [
      {
        id: PLAYER_1,
        name: 'Alice',
        alignment: Alignment.Wizard,
        draftPool: [ARAGORN, BILBO, FRODO, DAGGER_OF_WESTERNESSE],
        playDeck: makePlayDeck(),
        siteDeck: [RIVENDELL, MORIA, MINAS_TIRITH],
        sideboard: [],
        antiFwSideboard: [ANTI_FW_A, ANTI_FW_B],
      },
      {
        id: PLAYER_2,
        name: 'Bob',
        alignment: opponentAlignment,
        draftPool: [LEGOLAS, GIMLI, DAGGER_OF_WESTERNESSE],
        playDeck: makePlayDeck(),
        siteDeck: [RIVENDELL, MORIA, MINAS_TIRITH],
        sideboard: [],
      },
    ],
    seed: 42,
  };
}

function sideboardDefIds(state: ReturnType<typeof createGame>): string[] {
  return state.players[RESOURCE_PLAYER].sideboard.map(c => c.definitionId as string);
}

describe('MEWH — anti-Fallen-wizard sideboard', () => {
  test('the anti-FW sideboard is added to the main sideboard when the opponent is a Fallen-wizard', () => {
    const state = createGame(config(Alignment.FallenWizard), pool);
    const ids = sideboardDefIds(state);
    expect(ids).toContain(ANTI_FW_A as string);
    expect(ids).toContain(ANTI_FW_B as string);
  });

  test('the anti-FW sideboard is NOT added when the opponent is not a Fallen-wizard', () => {
    const state = createGame(config(Alignment.Ringwraith), pool);
    const ids = sideboardDefIds(state);
    expect(ids).not.toContain(ANTI_FW_A as string);
    expect(ids).not.toContain(ANTI_FW_B as string);
  });
});
