/**
 * @module rule-1.38-character-draft
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.38: Character Draft
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Character Draft - Immediately after declaring alignments, players conduct a character draft to determine their starting companies. For each round of the character draft, each player selects a character from their pool face-down and then both players reveal their choice simultaneously. Players set aside duplicated unique characters with the same name or manifestation; if the cards are not duplicates, each player plays their drafted card with their starting company. A player stops drafting characters when one of the following criteria is met:
 * • The player has five starting characters.
 * • Revealing another character would bring the player's total mind over 20, regardless of any effects in play that would modify a character's mind.
 * • The player has exhausted their pool of characters or no longer wishes to reveal characters.
 * Once one of the players stops drafting cards, their opponent may finish drafting cards until they have also met the above criteria. Each player may then play up to two minor items from their pool under the control of up to two of their starting characters. Finally, each player may then choose any unused or duplicated characters from their pool to shuffle into their play deck, provided that doing so does not exceed a total of 10 non-avatar characters in their play deck. All other unused or duplicated cards in each player's pool are removed from the game.
 */

import { describe, test, expect } from 'vitest';
import {
  runActions, makePlayDeck, pool, draftInstId,
  PLAYER_1, PLAYER_2, ARAGORN, LEGOLAS, BILBO, FARAMIR, GIMLI, RIVENDELL, Alignment,
  createGame,
} from '../../test-helpers.js';
import type { GameConfig } from '../../test-helpers.js';

describe('Rule 1.38 — Character Draft', () => {
  test('Players draft characters from pool simultaneously; set aside duplicates; stop at 5 characters or 20 mind', () => {
    // === Part 1: Duplicate set-aside ===
    // Both players pick ARAGORN simultaneously → collision; neither gets ARAGORN.
    const colConfig: GameConfig = {
      players: [
        {
          id: PLAYER_1,
          name: 'Alice',
          alignment: Alignment.Wizard,
          draftPool: [ARAGORN, BILBO],
          playDeck: makePlayDeck(),
          siteDeck: [RIVENDELL],
          sideboard: [],
        },
        {
          id: PLAYER_2,
          name: 'Bob',
          alignment: Alignment.Wizard,
          draftPool: [ARAGORN, LEGOLAS],
          playDeck: makePlayDeck(),
          siteDeck: [RIVENDELL],
          sideboard: [],
        },
      ],
      seed: 42,
    };

    let colState = createGame(colConfig, pool);

    // Round 1: both pick ARAGORN → collision
    const p1AragornInst = draftInstId(colState, 0, ARAGORN);
    const p2AragornInst = draftInstId(colState, 1, ARAGORN);
    colState = runActions(colState, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: p1AragornInst },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: p2AragornInst },
    ]);

    // Round 2: each picks their remaining character. With only 1 character left per pool,
    // the draft auto-ends after both pick (pools exhausted → auto-stopped).
    colState = runActions(colState, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(colState, 0, BILBO) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(colState, 1, LEGOLAS) },
    ]);

    // After the collision, neither player should have ARAGORN in their starting company.
    // P1 has BILBO; P2 has LEGOLAS.
    const p1Company = colState.players[0].companies[0];
    const p2Company = colState.players[1].companies[0];

    const p1CharDefs = p1Company.characters.map(
      id => colState.players[0].characters[id as string]?.instanceId,
    );
    const p2CharDefs = p2Company.characters.map(
      id => colState.players[1].characters[id as string]?.instanceId,
    );

    expect(p1CharDefs.includes(p1AragornInst)).toBe(false);
    expect(p2CharDefs.includes(p2AragornInst)).toBe(false);

    // Each player has exactly one character (from round 2, not the collision)
    expect(p1Company.characters).toHaveLength(1);
    expect(p2Company.characters).toHaveLength(1);

    // === Part 2: 20-mind stop ===
    // Aragorn(9) + Legolas(6) + Faramir(5) = 20 mind → auto-stopped after 3rd pick.
    // The player cannot then add Gimli(6) because 20 + 6 = 26 > 20.
    const mindConfig: GameConfig = {
      players: [
        {
          id: PLAYER_1,
          name: 'Alice',
          alignment: Alignment.Wizard,
          draftPool: [ARAGORN, LEGOLAS, FARAMIR, GIMLI],
          playDeck: makePlayDeck(),
          siteDeck: [RIVENDELL],
          sideboard: [],
        },
        {
          id: PLAYER_2,
          name: 'Bob',
          alignment: Alignment.Wizard,
          draftPool: [BILBO],
          playDeck: makePlayDeck(),
          siteDeck: [RIVENDELL],
          sideboard: [],
        },
      ],
      seed: 42,
    };

    let mindState = createGame(mindConfig, pool);

    // P2 picks BILBO in round 1, auto-stops (pool exhausted). P1 picks ARAGORN.
    mindState = runActions(mindState, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(mindState, 0, ARAGORN) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(mindState, 1, BILBO) },
    ]);

    // P1 picks LEGOLAS and FARAMIR alone (P2 stopped after round 1)
    mindState = runActions(mindState, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(mindState, 0, LEGOLAS) },
    ]);
    mindState = runActions(mindState, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(mindState, 0, FARAMIR) },
    ]);

    // After ARAGORN(9) + LEGOLAS(6) + FARAMIR(5) = 20, P1 is auto-stopped.
    // P1 is now in item-draft or later setup step (not character-draft).
    if (mindState.phaseState.phase === 'setup') {
      const step = (mindState.phaseState as { phase: 'setup'; setupStep: { step: string } }).setupStep;
      // Either auto-advanced past draft, or still in draft but P1 is stopped
      if (step.step === 'character-draft') {
        // Still in draft (shouldn't happen since P1 also stopped)
        const draftStep = (mindState.phaseState as { phase: 'setup'; setupStep: { step: 'character-draft'; draftState: readonly [{ stopped: boolean }, { stopped: boolean }] } }).setupStep;
        expect(draftStep.draftState[0].stopped).toBe(true);
      }
    }

    // P1's starting company should have exactly 3 characters (Aragorn, Legolas, Faramir)
    const mindP1Company = mindState.players[0].companies[0];
    expect(mindP1Company.characters).toHaveLength(3);
  });
});
