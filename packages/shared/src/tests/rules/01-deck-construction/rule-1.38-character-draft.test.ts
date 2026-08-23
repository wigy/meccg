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
  runActions, makePlayDeck, makeDraftConfig, pool, draftInstId,
  PLAYER_1, PLAYER_2, ARAGORN, LEGOLAS, BILBO, FRODO, FARAMIR, GIMLI, RIVENDELL, Alignment,
  createGame, assertEveryInstanceReachable,
  buildTestState, viablePlayCharacterActions, mint,
} from '../../test-helpers.js';
import type { GameConfig } from '../../test-helpers.js';
import { Phase } from '../../../index.js';

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
      id => colState.players[0].characters[id]?.instanceId,
    );
    const p2CharDefs = p2Company.characters.map(
      id => colState.players[1].characters[id]?.instanceId,
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

  test('passing item draft and deck draft removes leftover pool cards to out-of-play, not into nothing', () => {
    // Rule 1.9: "All other unused or duplicated cards in each player's pool
    // are removed from the game." Regression: the pass handlers only cleared
    // the phase-state arrays (unassignedItems / remainingPool), leaving the
    // undrafted instances unreachable — deleted from the game state instead
    // of removed-from-game (out-of-play pile).
    let state = createGame(makeDraftConfig(), pool);

    // Capture the instance IDs of the cards that will remain undrafted.
    const p1Bilbo = draftInstId(state, 0, BILBO);
    const p1Frodo = draftInstId(state, 0, FRODO);
    const p2Gimli = draftInstId(state, 1, GIMLI);

    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, ARAGORN) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, LEGOLAS) },
      { type: 'draft-stop', player: PLAYER_1 },
      { type: 'draft-stop', player: PLAYER_2 },
    ]);

    // Item draft: both pass without assigning — the pool daggers are removed
    // from the game.
    expect(state.phaseState.phase).toBe(Phase.Setup);
    let itemLeftovers1 = 0;
    if (state.phaseState.phase === Phase.Setup && state.phaseState.setupStep.step === 'item-draft') {
      itemLeftovers1 = state.phaseState.setupStep.itemDraftState[0].unassignedItems.length;
      state = runActions(state, [
        { type: 'pass', player: PLAYER_1 },
        { type: 'pass', player: PLAYER_2 },
      ]);
    }
    expect(itemLeftovers1).toBeGreaterThan(0);

    // Character deck draft: both pass without adding — the undrafted
    // characters are removed from the game.
    if (state.phaseState.phase === Phase.Setup && state.phaseState.setupStep.step === 'character-deck-draft') {
      state = runActions(state, [
        { type: 'pass', player: PLAYER_1 },
        { type: 'pass', player: PLAYER_2 },
      ]);
    }

    // Every leftover lands in its owner's out-of-play pile...
    const p1Out = state.players[0].outOfPlayPile.map(c => c.instanceId as string);
    const p2Out = state.players[1].outOfPlayPile.map(c => c.instanceId as string);
    expect(p1Out).toContain(p1Bilbo as string);
    expect(p1Out).toContain(p1Frodo as string);
    expect(p2Out).toContain(p2Gimli as string);
    // ...and P1's two unassigned daggers went there at the item-draft pass.
    expect(state.players[0].outOfPlayPile.length).toBeGreaterThanOrEqual(2 + itemLeftovers1);

    // ...flagged `removedFromGame`, per CoE 1.9's "removed from the game"
    // (docs/coe-rules.md's glossary distinguishes this from ordinary
    // elimination — only eliminated copies still count toward uniqueness).
    const p2GimliOut = state.players[1].outOfPlayPile.find(c => c.instanceId === p2Gimli);
    expect(p2GimliOut?.removedFromGame).toBe(true);

    // The no-card-disappears invariant holds across the whole state.
    assertEveryInstanceReachable(state);
  });

  test('undrafted unique-character leftover in out-of-play does not block a fresh copy from being played', () => {
    // Regression: an AI opponent passed out of the character deck draft
    // still holding an undrafted unique character (Elrohir) in its pool. The
    // leftover was sunk into outOfPlayPile per CoE 1.9 ("removed from the
    // game"), but the uniqueness check treated that pile as if it only ever
    // holds genuinely eliminated cards — which per the "unique" and "remove
    // from the game" glossary entries (docs/coe-rules.md) still count for
    // uniqueness only when eliminated, not when merely removed from the
    // game. That falsely blocked the human player's own copy from ever
    // being played, for the rest of the game.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [GIMLI],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const gimliInstId = state.players[0].hand[0].instanceId;
    const leftoverState = {
      ...state,
      players: [
        state.players[0],
        { ...state.players[1], outOfPlayPile: [{ instanceId: mint(), definitionId: GIMLI, removedFromGame: true as const }] },
      ] as typeof state.players,
    };

    const viable = viablePlayCharacterActions(leftoverState, PLAYER_1);
    expect(viable.some(a => a.characterInstanceId === gimliInstId)).toBe(true);
  });

  test('identical NON-unique reveals do NOT collide — each player keeps their copy', () => {
    // Regression: rule 1.9 sets aside "duplicated UNIQUE characters", but the
    // identical-pick branch had no uniqueness check, so two players revealing
    // the same non-unique character (three copies of the same Orc are legal)
    // were both denied it — and the pool filter deleted the first player's
    // remaining copies of that definition from the game state entirely.
    const ORC_VETERAN = 'le-35' as never; // non-unique minion character
    const LAGDUF = 'le-18' as never;
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1,
          name: 'Alice',
          alignment: Alignment.Ringwraith,
          // Two copies: the second must survive the round in the pool.
          draftPool: [ORC_VETERAN, ORC_VETERAN],
          playDeck: makePlayDeck(),
          siteDeck: [RIVENDELL],
          sideboard: [],
        },
        {
          id: PLAYER_2,
          name: 'Bob',
          alignment: Alignment.Ringwraith,
          draftPool: [ORC_VETERAN, LAGDUF],
          playDeck: makePlayDeck(),
          siteDeck: [RIVENDELL],
          sideboard: [],
        },
      ],
      seed: 42,
    };

    let state = createGame(config, pool);
    const p1Pick = draftInstId(state, 0, ORC_VETERAN);
    const p2Pick = draftInstId(state, 1, ORC_VETERAN);
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: p1Pick },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: p2Pick },
    ]);

    // No collision: both players drafted their Orc Veteran.
    const draftStep = (state.phaseState as {
      setupStep: {
        draftState: readonly [{ drafted: readonly { instanceId: string }[]; pool: readonly { instanceId: string }[] }, { drafted: readonly { instanceId: string }[] }];
        setAside: readonly [readonly unknown[], readonly unknown[]];
      };
    }).setupStep;
    expect(draftStep.draftState[0].drafted.some(c => c.instanceId === (p1Pick as string))).toBe(true);
    expect(draftStep.draftState[1].drafted.some(c => c.instanceId === (p2Pick as string))).toBe(true);
    expect(draftStep.setAside[0]).toHaveLength(0);
    expect(draftStep.setAside[1]).toHaveLength(0);

    // Player 0's second copy is still in the pool — not deleted from the game.
    expect(draftStep.draftState[0].pool.length).toBe(1);
  });
});
