/**
 * @module rule-1.42-fw-draft-agent-restriction
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.42: Fallen-Wizard Draft Agent Restriction
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] A Fallen-wizard player cannot reveal agent characters during the character draft unless they have already drafted a resource that specifically allows them to play agent characters (e.g. Open to the Summons or Thrall of the Voice).
 */

import { describe, test, expect } from 'vitest';
import {
  makePlayDeck, pool, draftInstId, runActions,
  PLAYER_1, PLAYER_2, RIVENDELL, Alignment,
  createGame,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../index.js';
import type { GameConfig, CardDefinitionId, CardInstanceId, GameState, PlayerId } from '../../../index.js';

const THRALL_OF_THE_VOICE = 'wh-82' as CardDefinitionId; // enabling Stage resource
const BILL_FERNY = 'dm-3' as CardDefinitionId;           // minion agent, mind 3
const BALIN = 'tw-123' as CardDefinitionId;              // non-agent control, mind 5

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
        draftPool: [THRALL_OF_THE_VOICE, BILL_FERNY, BALIN],
        playDeck: makePlayDeck(),
        siteDeck: [RIVENDELL],
        sideboard: [],
      },
      {
        id: PLAYER_2,
        name: 'Bob',
        alignment: Alignment.Wizard,
        draftPool: [BALIN],
        playDeck: makePlayDeck(),
        siteDeck: [RIVENDELL],
        sideboard: [],
      },
    ],
    seed: 42,
  };
}

describe('Rule 1.42 — Fallen-Wizard Draft Agent Restriction', () => {
  test('[FALLEN-WIZARD] cannot draft an agent character without an enabling resource', () => {
    const state = createGame(makeConfig(Alignment.FallenWizard), pool);
    // The agent (low mind) is blocked by the agent rule, not the mind rule;
    // a non-agent of higher mind is still fine.
    expect(draftViable(state, PLAYER_1, 0, BILL_FERNY)).toBe(false);
    expect(draftViable(state, PLAYER_1, 0, BALIN)).toBe(true);
  });

  test('[FALLEN-WIZARD] may draft an agent once Thrall of the Voice has been drafted', () => {
    let state = createGame(makeConfig(Alignment.FallenWizard), pool);
    // Drafting Thrall resolves it immediately (CoE 1.9.F4), so it is in play at
    // once and lifts the agent-draft gate this same round — no opponent pick
    // needed.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, THRALL_OF_THE_VOICE) },
    ]);
    expect(draftViable(state, PLAYER_1, 0, BILL_FERNY)).toBe(true);
  });

  test('a non-Fallen-wizard player is unaffected by the agent draft restriction', () => {
    const state = createGame(makeConfig(Alignment.Wizard), pool);
    expect(draftViable(state, PLAYER_1, 0, BILL_FERNY)).toBe(true);
  });
});
