/**
 * @module rule-1.53-hand-size-modifications
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.53: Hand Size Modifications
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If a player's base hand size is modified by their starting cards or otherwise during the game, that player draws up to their new hand size or discards down to it when a subsequent rule or effect resets their hand (i.e. not when the modification itself comes into effect).
 * Effects that modify a player's hand size are cumulative.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CAVE_DRAKE, ORC_PATROL,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../engine/legal-actions/index.js';
import type { CardDefinitionId } from '../../../index.js';

// Pallando (tw-175): "You may keep one more card than normal in your hand."
// Gives +1 hand-size-modifier always (no condition).
const PALLANDO = 'tw-175' as CardDefinitionId;

describe('Rule 1.53 — Hand Size Modifications', () => {
  beforeEach(() => resetMint());

  test('Modified hand size applies when hand resets; Pallando gives +1 always (draw 9 instead of 8)', () => {
    // Pallando is in play for P1; P1 has empty hand and 12 cards in play deck.
    // At EOT reset-hand step, P1 must draw to their hand size (8+1=9).
    // Verify: the draw-cards action requests count=9, not count=8.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [PALLANDO] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: [
            CAVE_DRAKE, CAVE_DRAKE, CAVE_DRAKE,
            ORC_PATROL, ORC_PATROL, ORC_PATROL,
            ORC_PATROL, ORC_PATROL, ORC_PATROL,
            ORC_PATROL, ORC_PATROL, ORC_PATROL,
          ],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
          playDeck: [],
        },
      ],
    });

    // Advance through both players' discard steps (both pass → both done).
    const p1Pass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const p2Pass = dispatch(p1Pass, { type: 'pass', player: PLAYER_2 });

    // Now at reset-hand step. Check P1's legal actions.
    const actions = computeLegalActions(p2Pass, PLAYER_1);
    const viableP1 = actions.filter(a => a.viable);

    // With Pallando in play, hand size = 9. Player has 0 cards → must draw 9.
    const drawAction = viableP1.find(a => a.action.type === 'draw-cards');
    expect(drawAction).toBeDefined();
    expect((drawAction!.action as { count: number }).count).toBe(9);
  });

  test('Baseline without modifier: player draws 8 cards at EOT reset-hand', () => {
    // Without any hand-size modifier in play, P1 draws to base 8.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: [
            CAVE_DRAKE, CAVE_DRAKE, CAVE_DRAKE,
            ORC_PATROL, ORC_PATROL, ORC_PATROL,
            ORC_PATROL, ORC_PATROL, ORC_PATROL,
            ORC_PATROL, ORC_PATROL, ORC_PATROL,
          ],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
          playDeck: [],
        },
      ],
    });

    const p1Pass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const p2Pass = dispatch(p1Pass, { type: 'pass', player: PLAYER_2 });

    const actions = computeLegalActions(p2Pass, PLAYER_1);
    const viableP1 = actions.filter(a => a.viable);

    const drawAction = viableP1.find(a => a.action.type === 'draw-cards');
    expect(drawAction).toBeDefined();
    // Without modifier, draw exactly 8 (base hand size).
    expect((drawAction!.action as { count: number }).count).toBe(8);
  });

  test('Hand-size modifier does not reset hand immediately; player must discard only if over new limit at reset-hand', () => {
    // P1 has 8 cards in hand and then Pallando enters play (hand size becomes 9).
    // The modification does NOT force an immediate draw — only when a reset occurs.
    // Here, already at 8 cards and Pallando is already in play, so at EOT the
    // player is below the new hand size (8 < 9) and must draw 1.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [PALLANDO] }],
          // Already at base hand size of 8 (would be over without Pallando)
          hand: [
            CAVE_DRAKE, CAVE_DRAKE, CAVE_DRAKE,
            ORC_PATROL, ORC_PATROL, ORC_PATROL,
            ORC_PATROL, ORC_PATROL,
          ],
          siteDeck: [MORIA],
          playDeck: [ORC_PATROL, ORC_PATROL], // only 2 cards left to draw
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
          playDeck: [],
        },
      ],
    });

    const p1Pass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const p2Pass = dispatch(p1Pass, { type: 'pass', player: PLAYER_2 });

    const actions = computeLegalActions(p2Pass, PLAYER_1);
    const viableP1 = actions.filter(a => a.viable);

    // Hand size is 9 (8+1 from Pallando); current hand is 8 → must draw 1.
    const drawAction = viableP1.find(a => a.action.type === 'draw-cards');
    expect(drawAction).toBeDefined();
    expect((drawAction!.action as { count: number }).count).toBe(1);
  });

  test('Player at modified hand size passes reset-hand (no draw needed)', () => {
    // Pallando gives +1 (hand size = 9). Player already holds 9 cards.
    // At EOT reset-hand, player should pass (already at hand size).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [PALLANDO] }],
          hand: [
            CAVE_DRAKE, CAVE_DRAKE, CAVE_DRAKE,
            ORC_PATROL, ORC_PATROL, ORC_PATROL,
            ORC_PATROL, ORC_PATROL, ORC_PATROL,
          ],
          siteDeck: [MORIA],
          playDeck: [ORC_PATROL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
          playDeck: [],
        },
      ],
    });

    const p1Pass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const p2Pass = dispatch(p1Pass, { type: 'pass', player: PLAYER_2 });

    const actions = computeLegalActions(p2Pass, PLAYER_1);
    const viableP1 = actions.filter(a => a.viable);

    // Hand size is 9 (8+1 from Pallando); current hand is 9 → pass.
    expect(viableP1.some(a => a.action.type === 'pass')).toBe(true);
    expect(viableP1.some(a => a.action.type === 'draw-cards')).toBe(false);
    expect(viableP1.some(a => a.action.type === 'discard-card')).toBe(false);
  });
});
