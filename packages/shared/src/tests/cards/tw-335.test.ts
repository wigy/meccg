/**
 * @module tw-335.test
 *
 * Card test: Sun (tw-335)
 * Type: hero-resource-event (long, environment)
 * Effects: 4 (duplication-limit, 3 stat-modifiers)
 *
 * "Environment. The prowess of each Dúnadan is modified by +1.
 *  Additionally, if Gates of Morning is in play, the prowess of each
 *  automatic-attack and hazard creature is modified by -1 and the prowess
 *  of each Man and Dúnadan is modified by +1. Cannot be duplicated."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  reduce,
  Phase,
  ARAGORN, LEGOLAS, BARD_BOWMAN,
  SUN, GATES_OF_MORNING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId, CharacterCard } from '../../index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Look up a character's instance ID by definition ID in the resulting state. */
function findCharInstance(state: import('../../index.js').GameState, playerIdx: number, defId: CardDefinitionId): string {
  for (const [key, char] of Object.entries(state.players[playerIdx].characters)) {
    if (char.definitionId === defId) return key;
  }
  throw new Error(`Character ${defId} not found for player ${playerIdx}`);
}

function baseProwess(defId: CardDefinitionId): number {
  return (pool[defId as string] as CharacterCard).prowess;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Sun (tw-335)', () => {
  beforeEach(() => resetMint());

  test('Dúnadan prowess +1 when Sun is in play', () => {
    // Aragorn is a dunadan — should get +1 prowess from Sun
    // Legolas is an elf — should be unaffected
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SUN], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const sunInstanceId = state.players[0].hand[0].instanceId;
    const result = reduce(state, { type: 'play-long-event', player: PLAYER_1, cardInstanceId: sunInstanceId });
    expect(result.error).toBeUndefined();

    const s = result.state;
    expect(s.players[0].characters[findCharInstance(s, 0, ARAGORN)].effectiveStats.prowess).toBe(baseProwess(ARAGORN) + 1);
    expect(s.players[1].characters[findCharInstance(s, 1, LEGOLAS)].effectiveStats.prowess).toBe(baseProwess(LEGOLAS));
  });

  test('with Gates of Morning: Man and Dúnadan prowess +1 additional', () => {
    // Sun alone: Dúnadan +1, Man +0
    // Sun + Gates of Morning: Dúnadan +2, Man +1
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, BARD_BOWMAN] }], hand: [SUN], siteDeck: [MORIA], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const sunInstanceId = state.players[0].hand[0].instanceId;
    const result = reduce(state, { type: 'play-long-event', player: PLAYER_1, cardInstanceId: sunInstanceId });
    expect(result.error).toBeUndefined();

    const s = result.state;
    // Aragorn (dunadan): +1 unconditional + +1 with GoM = +2
    expect(s.players[0].characters[findCharInstance(s, 0, ARAGORN)].effectiveStats.prowess).toBe(baseProwess(ARAGORN) + 2);
    // Bard Bowman (man): +1 with GoM
    expect(s.players[0].characters[findCharInstance(s, 0, BARD_BOWMAN)].effectiveStats.prowess).toBe(baseProwess(BARD_BOWMAN) + 1);
    // Legolas (elf): unaffected
    expect(s.players[1].characters[findCharInstance(s, 1, LEGOLAS)].effectiveStats.prowess).toBe(baseProwess(LEGOLAS));
  });

  test('affects opponent characters too', () => {
    const sunInPlay: CardInPlay = {
      instanceId: 'sun-pre' as CardInstanceId,
      definitionId: SUN,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA], cardsInPlay: [sunInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Pass to trigger recomputeDerived
    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();

    // P2's Aragorn (dunadan) should get +1 from P1's Sun
    const s = result.state;
    expect(s.players[1].characters[findCharInstance(s, 1, ARAGORN)].effectiveStats.prowess).toBe(baseProwess(ARAGORN) + 1);
  });

  test('body and direct influence are not modified', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SUN], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const sunInstanceId = state.players[0].hand[0].instanceId;
    const result = reduce(state, { type: 'play-long-event', player: PLAYER_1, cardInstanceId: sunInstanceId });
    expect(result.error).toBeUndefined();

    const s = result.state;
    const aragornDef = pool[ARAGORN as string] as CharacterCard;
    const stats = s.players[0].characters[findCharInstance(s, 0, ARAGORN)].effectiveStats;
    expect(stats.body).toBe(aragornDef.body);
    expect(stats.directInfluence).toBe(aragornDef.directInfluence);
  });
});
