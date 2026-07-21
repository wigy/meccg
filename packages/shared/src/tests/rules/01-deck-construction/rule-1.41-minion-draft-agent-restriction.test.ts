/**
 * @module rule-1.41-minion-draft-agent-restriction
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.41 (CoE 1.9.R2): Minion Draft Agent Restriction
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [MINION] A Ringwraith player cannot reveal agent characters during the character draft unless they have already drafted a resource that specifically allows them to play agent characters (e.g. Open to the Summons).
 *
 * The restriction is lifted only by an enabling resource (Open to the Summons,
 * wh-46) the Ringwraith holds for the starting company — in the play deck or
 * brought in the pool "in lieu of a minor item" (covered by the wh-46 card
 * test). Drafting an ordinary (non-enabling) character never lifts it.
 */

import { describe, test, expect } from 'vitest';
import {
  makePlayDeck, pool, draftInstId, runActions,
  PLAYER_1, PLAYER_2, RIVENDELL, Alignment,
  createGame,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../index.js';
import type { GameConfig, CardDefinitionId, CardInstanceId, GameState, PlayerId } from '../../../index.js';

const MINAS_MORGUL = 'le-390' as CardDefinitionId; // Ringwraith darkhaven (site deck)
const BILL_FERNY = 'dm-3' as CardDefinitionId;     // minion agent character, mind 3
const MIONID = 'as-3' as CardDefinitionId;         // non-agent minion character, mind 4
const BALIN = 'tw-123' as CardDefinitionId;        // hero character (opponent's pool), mind 5

/** Viability of drafting a given pool definition for a player, via legal actions. */
function draftViable(state: GameState, player: PlayerId, playerIndex: number, defId: CardDefinitionId): boolean | undefined {
  const inst = draftInstId(state, playerIndex, defId);
  return computeLegalActions(state, player).find(
    ea => ea.action.type === 'draft-pick'
      && (ea.action as { characterInstanceId?: CardInstanceId }).characterInstanceId === inst,
  )?.viable;
}

function makeRingwraithConfig(): GameConfig {
  return {
    players: [
      {
        id: PLAYER_1,
        name: 'Alice',
        alignment: Alignment.Ringwraith,
        draftPool: [BILL_FERNY, MIONID],
        playDeck: makePlayDeck(),
        siteDeck: [MINAS_MORGUL],
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

describe('Rule 1.41 — Minion Draft Agent Restriction', () => {
  test('[MINION] a Ringwraith cannot draft an agent character, but may draft a non-agent character', () => {
    const state = createGame(makeRingwraithConfig(), pool);
    // The agent (Bill Ferny) is blocked; a non-agent minion of the same
    // alignment is freely draftable.
    expect(draftViable(state, PLAYER_1, 0, BILL_FERNY)).toBe(false);
    expect(draftViable(state, PLAYER_1, 0, MIONID)).toBe(true);
  });

  test('[MINION] the reducer rejects drafting an agent character for a Ringwraith', () => {
    const state = createGame(makeRingwraithConfig(), pool);
    const billInst = draftInstId(state, 0, BILL_FERNY);
    expect(() =>
      runActions(state, [{ type: 'draft-pick', player: PLAYER_1, characterInstanceId: billInst }]),
    ).toThrow(/Ringwraith cannot draft an agent/i);
  });

  test('[MINION] the agent restriction cannot be lifted — drafting another character does not unlock an agent', () => {
    let state = createGame(makeRingwraithConfig(), pool);
    // Complete a draft round: the Ringwraith takes the non-agent character and
    // the opponent takes theirs. Drafting an ordinary character provides no
    // agent-summons enabler, so the agent stays blocked.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, MIONID) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, BALIN) },
    ]);
    expect(draftViable(state, PLAYER_1, 0, BILL_FERNY)).toBe(false);
  });
});
