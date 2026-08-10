/**
 * @module le-300.test
 *
 * Card test: Black-hide Shield (le-300)
 * Type: minion-resource-item (minor), non-unique, 1 corruption point.
 * Keywords: shield
 * Effects:
 *   1. stat-modifier: +1 body, max 9
 *
 * "Shield. +1 to body to a maximum of 9."
 *
 * Fixture alignment: minion-resource-item (ringwraith), tests use minion
 * characters (le-18 Lagduf, le-11 Gorbag) and minion sites (le-367, le-390).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, resetMint, Phase,
  getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const BLACK_HIDE_SHIELD = 'le-300' as CardDefinitionId;

// Minion fixtures — declared locally per CLAUDE.md card-ids policy.
const LAGDUF = 'le-18' as CardDefinitionId;         // orc, prowess 5, body 8
const GORBAG = 'le-11' as CardDefinitionId;         // orc, prowess 6, body 9 (already at cap)
const DOL_GULDUR = 'le-367' as CardDefinitionId;    // darkhaven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // darkhaven

describe('Black-hide Shield (le-300)', () => {
  beforeEach(() => resetMint());

  // ─── Effect: +1 body, max 9 ─────────────────────────────────────────────

  test('+1 body is reflected in effective stats for a character with base body < 9', () => {
    // Lagduf (le-18) has base body 8; with the shield it should be 9,
    // exactly at the max-9 cap so the full +1 applies.
    const withoutShield = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const withShield = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [{ defId: LAGDUF, items: [BLACK_HIDE_SHIELD] }] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const baseBody = getCharacter(withoutShield, RESOURCE_PLAYER, LAGDUF).effectiveStats.body;
    const withShieldBody = getCharacter(withShield, RESOURCE_PLAYER, LAGDUF).effectiveStats.body;
    expect(baseBody).toBe(8);
    expect(withShieldBody).toBe(baseBody + 1);
    expect(withShieldBody).toBe(9);
  });

  test('body bonus is capped at 9 for a character already at the cap', () => {
    // Gorbag (le-11) has base body 9 — already at the printed maximum, so
    // the shield's +1 has no further effect.
    const withShield = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [{ defId: GORBAG, items: [BLACK_HIDE_SHIELD] }] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const withShieldBody = getCharacter(withShield, RESOURCE_PLAYER, GORBAG).effectiveStats.body;
    expect(withShieldBody).toBe(9);
  });

  // ─── Corruption: 1 corruption point counts toward the bearer's total ───

  test("the shield's 1 corruption point is included in the bearer's corruption total", () => {
    const withShield = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [{ defId: LAGDUF, items: [BLACK_HIDE_SHIELD] }] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const stats = getCharacter(withShield, RESOURCE_PLAYER, LAGDUF).effectiveStats;
    expect(stats.corruptionPoints).toBe(1);
  });
});
