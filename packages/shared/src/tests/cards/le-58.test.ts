/**
 * @module le-58.test
 *
 * Card test: The Witch-king (le-58)
 * Type: minion-character (ringwraith avatar), alignment ringwraith.
 * Stats: prowess 9, body 12, direct influence 3, mind null.
 *
 * Card text:
 *   "Unique. Manifestation of The Witch-king of Angmar. Can use spirit-magic
 *    and shadow-magic. +3 direct influence in Heralded Lord mode. +1 prowess in
 *    Fell Rider mode. As your Ringwraith, up to two Ringwraith followers in his
 *    company may be controlled with no influence. You may bring these followers
 *    into play during separate organization phases."
 *
 * Like every named Ringwraith manifestation, the Witch-king's per-mode stat
 * change "to your Ringwraith" lives on this avatar card as `stat-modifier`
 * effects gated on `bearer.ringwraithMode` (the mode is established by an
 * in-play mode card — Black Rider le-170 / Fell Rider le-183 / Heralded Lord
 * le-190 — bound to his company; see le-53 Hoarmûrath for the reference).
 *
 * Engine Support:
 * | # | Feature                                                       | Status          |
 * |---|---------------------------------------------------------------|-----------------|
 * | 1 | +3 direct influence in Heralded Lord mode                     | IMPLEMENTED     |
 * | 2 | +1 prowess in Fell Rider mode                                 | IMPLEMENTED     |
 * | 3 | Can use spirit-magic / shadow-magic                           | FLAVOR          |
 * | 4 | Up to two Ringwraith followers controlled with no influence,  | NOT IMPLEMENTED |
 * |   |   brought into play during separate organization phases       |                 |
 *
 * NOT CERTIFIED: rule #4 (the no-influence follower allowance plus the
 * separate-phase play allowance) needs engine support that does not exist yet.
 * The per-mode stat changes (#1, #2) are covered below.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  getCharacter, companyIdAt, addCardInPlay, recomputeDerived,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const THE_WITCH_KING = 'le-58' as CardDefinitionId;

// Ringwraith mode cards that establish the company's mode.
const HERALDED_LORD = 'le-190' as CardDefinitionId;
const FELL_RIDER = 'le-183' as CardDefinitionId;

// Darkhavens (siteType: haven, ringwraith alignment).
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
// Hero site so the opposing player has a legal position.
const MINAS_TIRITH = 'tw-407' as CardDefinitionId;

describe('The Witch-king (le-58)', () => {
  beforeEach(() => resetMint());

  test('base stats with no mode card: prowess 9, direct influence 3', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [THE_WITCH_KING] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const wk = getCharacter(state, RESOURCE_PLAYER, THE_WITCH_KING);
    expect(wk.effectiveStats.prowess).toBe(9);
    expect(wk.effectiveStats.directInfluence).toBe(3);
  });

  test('+3 direct influence in Heralded Lord mode (prowess unchanged)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [THE_WITCH_KING] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    state = recomputeDerived(addCardInPlay(state, RESOURCE_PLAYER, HERALDED_LORD, companyIdAt(state, RESOURCE_PLAYER)));
    const wk = getCharacter(state, RESOURCE_PLAYER, THE_WITCH_KING);
    expect(wk.effectiveStats.directInfluence).toBe(6); // 3 + 3
    expect(wk.effectiveStats.prowess).toBe(9); // Fell Rider bonus does not apply
  });

  test('+1 prowess in Fell Rider mode (direct influence unchanged)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [THE_WITCH_KING] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    state = recomputeDerived(addCardInPlay(state, RESOURCE_PLAYER, FELL_RIDER, companyIdAt(state, RESOURCE_PLAYER)));
    const wk = getCharacter(state, RESOURCE_PLAYER, THE_WITCH_KING);
    expect(wk.effectiveStats.prowess).toBe(10); // 9 + 1
    expect(wk.effectiveStats.directInfluence).toBe(3); // Heralded Lord bonus does not apply
  });
});
