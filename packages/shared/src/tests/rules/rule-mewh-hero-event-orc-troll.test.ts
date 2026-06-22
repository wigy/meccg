/**
 * MEWH §9 — no hero resource permanent-event on an Orc/Troll company.
 *
 * Source: The White Hand Insert, "Special Orc & Troll Rules": "You may not play
 * a hero resource permanent-event on a company with an Orc or Troll in it."
 *
 * Exercised with Fellowship (tw-240), a hero (wizard-aligned) company-targeting
 * permanent-event playable on a 4+ member company at a haven: a Fallen-wizard
 * may play it on an all-Man company at Isengard, but not once an Orc joins.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment } from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';
import {
  buildTestState, resetMint, viableActions,
  PLAYER_1, PLAYER_2, LORIEN, MINAS_TIRITH,
  Phase,
} from '../test-helpers.js';

const ISENGARD = 'wh-56' as CardDefinitionId; // Wizardhaven (haven)
const FELLOWSHIP = 'tw-240' as CardDefinitionId; // hero company-targeting permanent-event
const GORBAG = 'le-11' as CardDefinitionId;   // Orc
const MAN_A = 'le-1' as CardDefinitionId;     // Asternak — Man
const MAN_B = 'le-7' as CardDefinitionId;     // Dôgrib — Man
const MAN_C = 'le-17' as CardDefinitionId;    // Jerrek — Man
const MAN_D = 'le-19' as CardDefinitionId;    // Layos — Man

function fwCompany(characters: CardDefinitionId[]): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: ISENGARD, characters }],
        hand: [FELLOWSHIP],
        siteDeck: [MINAS_TIRITH],
      },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
}

function fellowshipPlayable(state: GameState): boolean {
  return viableActions(state, PLAYER_1, 'play-permanent-event')
    .some(a => {
      const inst = (a.action as { cardInstanceId?: string }).cardInstanceId;
      const card = state.players[0].hand.find(c => (c.instanceId as string) === inst);
      return card?.definitionId === FELLOWSHIP;
    });
}

describe('MEWH §9 — no hero permanent-event on an Orc/Troll company', () => {
  beforeEach(() => resetMint());

  test('a Fallen-wizard may play a hero permanent-event on an all-Man company', () => {
    expect(fellowshipPlayable(fwCompany([MAN_A, MAN_B, MAN_C, MAN_D]))).toBe(true);
  });

  test('a Fallen-wizard may NOT play a hero permanent-event on a company containing an Orc', () => {
    expect(fellowshipPlayable(fwCompany([GORBAG, MAN_B, MAN_C, MAN_D]))).toBe(false);
  });
});
