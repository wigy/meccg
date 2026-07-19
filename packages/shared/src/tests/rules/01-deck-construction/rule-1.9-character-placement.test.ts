/**
 * @module rule-1.9-character-placement
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.9 / 1.51.B1: Character Placement into starting companies
 *
 * Source: docs/coe-rules.txt
 *
 * A player who declares more than one starting company (Ringwraith 1.10.R1 /
 * Balrog 1.10.B1) distributes their drafted characters across those companies
 * during the character-placement setup step. Placement must make monotonic
 * progress: each character may be placed at most once. Without that guarantee,
 * the reversible place-character move lets a player (an AI in particular)
 * shuffle characters back and forth between companies forever without ever
 * finishing — the bug reported in game mrevwcn5-itaw75, where p2 issued 40+
 * place-character actions oscillating two characters between its two companies.
 */

import { describe, test, expect } from 'vitest';
import {
  runActions, makePlayDeck, pool, draftInstId,
  PLAYER_1, PLAYER_2, ARAGORN, RIVENDELL, Alignment,
  createGame,
} from '../../test-helpers.js';
import { computeLegalActions, reduce } from '../../../index.js';
import type { GameConfig, CardDefinitionId, GameState } from '../../../index.js';

const AZOG = 'ba-2' as CardDefinitionId;
const BOLG = 'ba-4' as CardDefinitionId;
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId;
const MORIA_BALROG = 'ba-93' as CardDefinitionId;
const THE_UNDER_GATES = 'ba-100' as CardDefinitionId;

/** The place-character legal actions currently available to a player. */
function placeActions(state: GameState, player: typeof PLAYER_1) {
  return computeLegalActions(state, player)
    .map(ea => ea.action)
    .filter(a => a.type === 'place-character');
}

describe('Rule 1.9 — Character Placement is monotonic (no endless shuffling)', () => {
  test('[BALROG] each character is placed at most once; placement cannot cycle', () => {
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1,
          name: 'Alice',
          alignment: Alignment.Balrog,
          draftPool: [AZOG, BOLG, CROOK_LEGGED_ORC],
          playDeck: makePlayDeck(),
          siteDeck: [MORIA_BALROG, THE_UNDER_GATES],
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

    // Character draft. P2 has a single-character pool and auto-stops after its
    // one pick; P1 then drafts its remaining two characters alone.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, AZOG) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, ARAGORN) },
    ]);
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, BOLG) },
    ]);
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, CROOK_LEGGED_ORC) },
    ]);

    // Advance through any intermediate setup steps to starting-site-selection.
    for (let i = 0; i < 6; i++) {
      if (state.phaseState.phase !== 'setup') break;
      const step = (state.phaseState as { phase: 'setup'; setupStep: { step: string } }).setupStep;
      if (step.step === 'starting-site-selection') break;
      state = runActions(state, [
        { type: 'pass', player: PLAYER_1 },
        { type: 'pass', player: PLAYER_2 },
      ]);
    }

    // P1 (Balrog) declares two starting companies at Moria and the Under-gates;
    // P2 (Wizard) declares Rivendell (single company).
    const moriaInst = state.players[0].siteDeck.find(c => c.definitionId === MORIA_BALROG)!.instanceId;
    const underGatesInst = state.players[0].siteDeck.find(c => c.definitionId === THE_UNDER_GATES)!.instanceId;
    const rivendellInst = state.players[1].siteDeck.find(c => c.definitionId === RIVENDELL)!.instanceId;
    state = runActions(state, [
      { type: 'select-starting-site', player: PLAYER_1, siteInstanceId: moriaInst },
      { type: 'select-starting-site', player: PLAYER_1, siteInstanceId: underGatesInst },
      { type: 'pass', player: PLAYER_1 },
      { type: 'select-starting-site', player: PLAYER_2, siteInstanceId: rivendellInst },
      { type: 'pass', player: PLAYER_2 },
    ]);

    // Now at character placement — P1 has two companies and three characters
    // all initially gathered in its base company.
    expect(state.phaseState.phase).toBe('setup');
    const step = (state.phaseState as { phase: 'setup'; setupStep: { step: string } }).setupStep;
    expect(step.step).toBe('character-placement');

    const chars = [...state.players[0].companies[0].characters];
    expect(chars).toHaveLength(3);
    const [charA, charB, charC] = chars;
    const targetCompany = state.players[0].companies[1].id;

    // Initially every character is offered a move into the empty company.
    const offeredIds = new Set(placeActions(state, PLAYER_1).map(a => a.characterInstanceId));
    expect(offeredIds).toEqual(new Set([charA, charB, charC]));

    // Place charA into the second company.
    state = runActions(state, [
      { type: 'place-character', player: PLAYER_1, characterInstanceId: charA, companyId: targetCompany },
    ]);

    // charA is now settled — it is no longer offered a placement move, so the
    // AI can never move it back and start oscillating.
    const afterOne = new Set(placeActions(state, PLAYER_1).map(a => a.characterInstanceId));
    expect(afterOne).toEqual(new Set([charB, charC]));

    // Re-placing an already-placed character is rejected by the reducer.
    const rejected = reduce(state, {
      type: 'place-character', player: PLAYER_1, characterInstanceId: charA, companyId: state.players[0].companies[0].id,
    });
    expect(rejected.error).toBeTruthy();

    // Place the remaining two characters; placement then terminates with no
    // place-character actions left — only the pass to finish remains.
    state = runActions(state, [
      { type: 'place-character', player: PLAYER_1, characterInstanceId: charB, companyId: targetCompany },
      { type: 'place-character', player: PLAYER_1, characterInstanceId: charC, companyId: targetCompany },
    ]);
    expect(placeActions(state, PLAYER_1)).toHaveLength(0);
  });
});
