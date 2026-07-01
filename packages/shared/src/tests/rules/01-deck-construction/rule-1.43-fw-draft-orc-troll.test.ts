/**
 * @module rule-1.43-fw-draft-orc-troll
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.43: Fallen-Wizard Draft Orc/Troll Restriction
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] A Fallen-wizard player cannot reveal Orc or Troll characters during the character draft unless they have already drafted a Stage resource that specifically allows them to play Orc or Troll characters (e.g. Bad Company).
 */

import { describe, test, expect } from 'vitest';
import {
  makePlayDeck, pool, draftInstId, runActions,
  PLAYER_1, PLAYER_2, RIVENDELL, Alignment,
  createGame,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../index.js';
import type { GameConfig, CardDefinitionId, CardInstanceId, GameState, PlayerId } from '../../../index.js';

const BAD_COMPANY = 'wh-63' as CardDefinitionId; // enabling Stage resource (Orc/Troll)
const ORC_BRAWLER = 'le-30' as CardDefinitionId; // minion character, race orc, mind 1
const LUITPRAND = 'le-23' as CardDefinitionId;   // minion character, race man, mind 1

/** Viability of drafting a given pool definition for a player, via legal actions. */
function draftViable(state: GameState, player: PlayerId, playerIndex: number, defId: CardDefinitionId): boolean | undefined {
  const inst = draftInstId(state, playerIndex, defId);
  return computeLegalActions(state, player).find(
    ea => ea.action.type === 'draft-pick'
      && (ea.action as { characterInstanceId?: CardInstanceId }).characterInstanceId === inst,
  )?.viable;
}

function makeConfig(p1Alignment: Alignment): GameConfig {
  return {
    players: [
      {
        id: PLAYER_1,
        name: 'Alice',
        alignment: p1Alignment,
        draftPool: [BAD_COMPANY, ORC_BRAWLER, LUITPRAND],
        playDeck: makePlayDeck(),
        siteDeck: [RIVENDELL],
        sideboard: [],
      },
      {
        id: PLAYER_2,
        name: 'Bob',
        alignment: Alignment.Wizard,
        draftPool: [LUITPRAND],
        playDeck: makePlayDeck(),
        siteDeck: [RIVENDELL],
        sideboard: [],
      },
    ],
    seed: 42,
  };
}

describe('Rule 1.43 — Fallen-Wizard Draft Orc/Troll Restriction', () => {
  test('[FALLEN-WIZARD] cannot draft an Orc character without an enabling resource', () => {
    const state = createGame(makeConfig(Alignment.FallenWizard), pool);
    // The Orc is blocked by the orc/troll rule, not the mind rule; a non-orc
    // character of the same mind is still fine.
    expect(draftViable(state, PLAYER_1, 0, ORC_BRAWLER)).toBe(false);
    expect(draftViable(state, PLAYER_1, 0, LUITPRAND)).toBe(true);
  });

  test('[FALLEN-WIZARD] may draft an Orc once Bad Company has been drafted', () => {
    let state = createGame(makeConfig(Alignment.FallenWizard), pool);
    // Drafting Bad Company is the Fallen-wizard's action for the round (CoE
    // 1.9.F4, resolve-immediately model); once the opponent acts and the round
    // resolves, Bad Company is in play and lifts the orc/troll gate.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, BAD_COMPANY) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, LUITPRAND) },
    ]);
    expect(draftViable(state, PLAYER_1, 0, ORC_BRAWLER)).toBe(true);
  });

  test('a non-Fallen-wizard player is unaffected by the orc/troll draft restriction', () => {
    const state = createGame(makeConfig(Alignment.Ringwraith), pool);
    expect(draftViable(state, PLAYER_1, 0, ORC_BRAWLER)).toBe(true);
  });
});
