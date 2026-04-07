/**
 * @module tw-244.test
 *
 * Card test: Glamdring (tw-244)
 * Type: hero-resource-item (major, weapon)
 * Effects: 2
 *
 * "Unique. Weapon. +3 to prowess to a maximum of 8
 *  (a maximum of 9 against Orcs)."
 *
 * This tests:
 * 1. stat-modifier: prowess +3 (max 8) — unconditional
 * 2. stat-modifier: prowess +3 (max 9) in combat vs orc — overrides glamdring-prowess
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  reduce,
  ARAGORN, FRODO, GLORFINDEL_II,
  GLAMDRING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  Phase,
  buildTestState, resetMint,
  findCharInstanceId,
} from '../test-helpers.js';
import type { CharacterCard } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Glamdring (tw-244)', () => {
  beforeEach(() => resetMint());

  test('prowess +3 capped at 8 for Aragorn (base 6)', () => {
    // Aragorn base prowess 6. Glamdring adds +3 → 9, capped at 8.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [GLAMDRING] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FRODO] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Dispatch pass to trigger recomputeDerived with DSL effects
    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    const s = result.state;

    const aragornId = findCharInstanceId(s, 0, ARAGORN);
    const baseDef = pool[ARAGORN as string] as CharacterCard;
    expect(baseDef.prowess).toBe(6);
    expect(s.players[0].characters[aragornId as string].effectiveStats.prowess).toBe(8);
  });

  test('prowess +3 uncapped for Frodo (base 1)', () => {
    // Frodo base prowess 1. Glamdring adds +3 → 4, below cap of 8.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: FRODO, items: [GLAMDRING] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    const s = result.state;

    const frodoId = findCharInstanceId(s, 0, FRODO);
    const baseDef = pool[FRODO as string] as CharacterCard;
    expect(baseDef.prowess).toBe(1);
    expect(s.players[0].characters[frodoId as string].effectiveStats.prowess).toBe(4);
  });

  test('prowess capped at 8 for Glorfindel II (base 8)', () => {
    // Glorfindel II base prowess 8. Glamdring adds +3 → 11, capped at 8.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: GLORFINDEL_II, items: [GLAMDRING] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    const s = result.state;

    const glorfinId = findCharInstanceId(s, 0, GLORFINDEL_II);
    const baseDef = pool[GLORFINDEL_II as string] as CharacterCard;
    expect(baseDef.prowess).toBe(8);
    expect(s.players[0].characters[glorfinId as string].effectiveStats.prowess).toBe(8);
  });

  test('body is not modified by Glamdring', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [GLAMDRING] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FRODO] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    const s = result.state;

    const aragornId = findCharInstanceId(s, 0, ARAGORN);
    const baseDef = pool[ARAGORN as string] as CharacterCard;
    expect(s.players[0].characters[aragornId as string].effectiveStats.body).toBe(baseDef.body);
  });
});
