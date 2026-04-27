/**
 * @module rule-1.40-minion-draft-six
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.40: Minion Draft Six Characters
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [MINION] A Ringwraith player may draft up to six starting characters instead of five.
 */

import { describe, test, expect } from 'vitest';
import {
  runActions, makePlayDeck, pool, draftInstId,
  PLAYER_1, PLAYER_2, ARAGORN, RIVENDELL, Alignment,
  createGame,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../index.js';
import type { GameConfig, CardDefinitionId } from '../../../index.js';

// Six low-mind minion characters (total mind 9, well under limit of 20)
const LUITPRAND = 'le-23' as CardDefinitionId;    // mind 1
const ODOACER = 'le-28' as CardDefinitionId;       // mind 1
const ORC_BRAWLER = 'le-30' as CardDefinitionId;   // mind 1
const OSTISEN = 'le-36' as CardDefinitionId;        // mind 2
const MUZGASH = 'le-25' as CardDefinitionId;        // mind 2
const ORC_VETERAN = 'le-35' as CardDefinitionId;    // mind 2

const MINAS_MORGUL = 'le-390' as CardDefinitionId;

describe('Rule 1.40 — Minion Draft Six Characters', () => {
  test('[MINION] Ringwraith player may draft up to six starting characters instead of five', () => {
    // P1 is Ringwraith with 6 low-mind characters in pool.
    // P2 is Wizard with 1 character — auto-stops after round 1, leaving P1 to draft alone.
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1,
          name: 'Alice',
          alignment: Alignment.Ringwraith,
          draftPool: [LUITPRAND, ODOACER, ORC_BRAWLER, OSTISEN, MUZGASH, ORC_VETERAN],
          playDeck: makePlayDeck(),
          siteDeck: [MINAS_MORGUL],
          sideboard: [],
        },
        {
          id: PLAYER_2,
          name: 'Bob',
          alignment: Alignment.Wizard,
          draftPool: [ARAGORN],
          playDeck: makePlayDeck(),
          siteDeck: [RIVENDELL],
          sideboard: [],
        },
      ],
      seed: 42,
    };

    let state = createGame(config, pool);

    // Round 1: both players pick. P2's pool is exhausted → P2 auto-stops.
    const luitprandInst = draftInstId(state, 0, LUITPRAND);
    const aragornInst = draftInstId(state, 1, ARAGORN);
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: luitprandInst },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: aragornInst },
    ]);

    // Rounds 2–5: P1 picks alone (P2 already stopped)
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, ODOACER) },
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, ORC_BRAWLER) },
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, OSTISEN) },
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, MUZGASH) },
    ]);

    // After 5 characters drafted, Ringwraith has NOT hit their limit (max is 6).
    // Legal actions must still include a draft-pick for PLAYER_1.
    const actionsAt5 = computeLegalActions(state, PLAYER_1);
    const picksAt5 = actionsAt5.filter(ea => ea.action.type === 'draft-pick' && ea.viable);
    expect(picksAt5.length).toBeGreaterThan(0);

    // Round 6: pick the sixth character
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, ORC_VETERAN) },
    ]);

    // After 6 characters drafted, Ringwraith is at max — no more picks available.
    const actionsAt6 = computeLegalActions(state, PLAYER_1);
    const picksAt6 = actionsAt6.filter(ea => ea.action.type === 'draft-pick' && ea.viable);
    expect(picksAt6).toHaveLength(0);
  });
});
