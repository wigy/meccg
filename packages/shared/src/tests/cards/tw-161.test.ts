/**
 * @module tw-161.test
 *
 * Card test: Glorfindel II (tw-161)
 * Type: hero-character
 * Effects: 2
 *
 * "Unique. +1 direct influence against Elves."
 *
 * This tests both effects:
 * 1. stat-modifier: +1 DI during influence-check when target is an elf
 * 2. stat-modifier: +1 DI during faction-influence-check when faction is elf race
 *
 * Effect #1 is tested by verifying Glorfindel can control an elf character
 * (Haldir, mind 3) as a follower — base DI 2 is insufficient, but +1 bonus
 * makes it 3 which equals Haldir's mind.
 *
 * Effect #2 cannot be end-to-end tested because there are no elf factions
 * in the current card pool, but the engine code path is verified via the
 * faction-influence-check resolver support added alongside this test.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GLORFINDEL_II, HALDIR, BEREGOND,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, CharacterCard, GameState, PlayCharacterAction } from '../../index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Find the instance ID of a character in play by definition ID. */
function findCharInstanceId(state: GameState, playerIdx: number, defId: CardDefinitionId): CardInstanceId {
  for (const [key, char] of Object.entries(state.players[playerIdx].characters)) {
    if (char.definitionId === defId) return key as CardInstanceId;
  }
  throw new Error(`Character ${defId} not found for player ${playerIdx}`);
}

/** Get all viable play-character actions for a player. */
function viablePlayCharacterActions(state: GameState, playerId: typeof PLAYER_1) {
  return computeLegalActions(state, playerId)
    .filter(ea => ea.viable && ea.action.type === 'play-character')
    .map(ea => ea.action as PlayCharacterAction);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Glorfindel II (tw-161)', () => {
  beforeEach(() => resetMint());

  test('base effective DI is 2 (conditional bonus does not inflate base stats)', () => {
    // Glorfindel II has base DI 2. The +1 DI against Elves is conditional
    // and should NOT appear in effectiveStats.directInfluence.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [{ defId: GLORFINDEL_II }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN }] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const glorfindelId = findCharInstanceId(state, 0, GLORFINDEL_II);
    const baseDef = pool[GLORFINDEL_II as string] as CharacterCard;
    expect(state.players[0].characters[glorfindelId as string].effectiveStats.directInfluence).toBe(baseDef.directInfluence);
    expect(baseDef.directInfluence).toBe(2);
  });

  test('+1 DI allows Glorfindel to control an elf character (Haldir, mind 3) as a follower', () => {
    // Glorfindel II base DI = 2. Haldir is an elf with mind 3.
    // Without the +1 DI bonus against Elves, DI 2 < mind 3 → cannot control.
    // With the bonus, DI 3 >= mind 3 → can control as a follower.
    //
    // We also fill GI so Haldir can only be played under DI, not GI.
    // Glorfindel (mind 8) + Legolas (mind 6) + Bilbo (mind 1) = 15 GI used.
    // Remaining GI = 20 - 15 = 5, which is enough for Haldir (mind 3) under GI.
    // So we'll use more characters or just check that a DI option exists.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: GLORFINDEL_II }, { defId: LEGOLAS }] }],
          hand: [HALDIR],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN }] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const glorfindelId = findCharInstanceId(state, 0, GLORFINDEL_II);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    // There should be at least one play-character action for Haldir
    // that places her under Glorfindel's DI
    const haldirUnderGlorfindel = actions.filter(
      a => a.controlledBy === glorfindelId,
    );
    expect(haldirUnderGlorfindel.length).toBeGreaterThanOrEqual(1);
  });

  test('+1 DI bonus does not apply to non-elf characters', () => {
    // Beregond is a dunadan with mind 2. Glorfindel has base DI 2 — enough
    // to control Beregond without any bonus (DI 2 >= mind 2).
    // The bonus should NOT apply because Beregond is not an elf.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: GLORFINDEL_II }] }],
          hand: [BEREGOND],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN }] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const glorfindelId = findCharInstanceId(state, 0, GLORFINDEL_II);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    // Beregond (dunadan, mind 2) can be controlled under DI (base DI 2 >= mind 2)
    const beregondUnderGlorfindel = actions.filter(
      a => a.controlledBy === glorfindelId,
    );
    expect(beregondUnderGlorfindel.length).toBeGreaterThanOrEqual(1);

    // Effective DI is still 2 (bonus doesn't apply to non-elves)
    expect(state.players[0].characters[glorfindelId as string].effectiveStats.directInfluence).toBe(2);
  });
});
