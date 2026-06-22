/**
 * @module le-8.test
 *
 * Card test: Dorelas (le-8)
 * Type: minion-character (Ringwraith alignment)
 *
 * "Unique."
 *
 * Card shape (documented here, NOT asserted — see CLAUDE.md no-tautology rule):
 *   race: man, skills warrior/sage, unique, body 7, prowess 2, mind 3,
 *   directInfluence 1, marshallingPoints 1, homesite "Lond Galen".
 *   effects: [] — the only printed rule is "Unique.".
 *
 * Engine Support:
 * | # | Rule (card text) | Status | Notes                                          |
 * |---|------------------|--------|------------------------------------------------|
 * | 1 | "Unique."        | OK     | unique: true — play-character refuses a second |
 * |   |                  |        | copy while one is already in play (either side)|
 *
 * Basic character stats (prowess/body/mind/DI/MP) need no special effects — the
 * engine handles them structurally. The card has no `effects` entries.
 *
 * Playable: YES
 *
 * Rules exercised:
 * 1. Dorelas can be organised into play from hand at a minion haven (a viable
 *    play-character action is generated under general influence).
 * 2. "Unique.": only a single copy of Dorelas may be in play — the engine
 *    refuses to play a second copy from hand while one is already in a company,
 *    and the refusal reason names the uniqueness rule.
 *
 * Fixtures:
 *   DORELAS (le-8)        — minion man warrior/sage, unique, mind 3
 *   LAGDUF (le-18)        — minion orc (existing company-mate / opponent filler)
 *   DOL_GULDUR (le-367)   — minion haven (company site)
 *   MINAS_MORGUL (le-390) — minion haven (opponent site)
 *   EDORAS_LE (le-372)    — free-hold (siteDeck filler)
 *   MORIA_LE (le-392)     — shadow-hold (siteDeck filler)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, resetMint,
  handCardId, findCharInstanceId,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { Phase, Alignment } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const DORELAS = 'le-8' as CardDefinitionId;
const LAGDUF = 'le-18' as CardDefinitionId;

const DOL_GULDUR = 'le-367' as CardDefinitionId;    // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // minion haven
const EDORAS_LE = 'le-372' as CardDefinitionId;     // free-hold (siteDeck filler)
const MORIA_LE = 'le-392' as CardDefinitionId;      // shadow-hold (siteDeck filler)

describe('Dorelas (le-8)', () => {
  beforeEach(() => resetMint());

  // ── Playable: organised into play at a minion haven ───────────────────────

  test('Dorelas can be organised into play from hand at a minion haven', () => {
    // Ringwraith player with a company at Dol Guldur (a haven) and Dorelas in
    // hand. Dorelas has no home-site-only restriction, so a haven is a valid
    // play site; mind 3 fits comfortably under the 20 general influence.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [DORELAS], siteDeck: [EDORAS_LE] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_MORGUL, characters: [] }], hand: [], siteDeck: [MORIA_LE] },
      ],
    });

    const dorelasId = handCardId(state, RESOURCE_PLAYER);
    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.action.type === 'play-character'
        && a.action.characterInstanceId === dorelasId);

    // At least one viable play-character action exists (under general influence
    // at the haven where the company already sits).
    expect(playActions.length).toBeGreaterThanOrEqual(1);
    expect(playActions.some(a => a.viable
      && a.action.type === 'play-character'
      && a.action.controlledBy === 'general')).toBe(true);
  });

  // ── "Unique.": only one copy of Dorelas may be in play ────────────────────

  test('a second copy of Dorelas cannot be organised into play while one is already in play', () => {
    // Player 1 already has Dorelas in a company and holds a second copy in
    // hand. The unique rule must forbid playing the second copy.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [DORELAS] }], hand: [DORELAS], siteDeck: [EDORAS_LE] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [MORIA_LE] },
      ],
    });

    // Confirm one Dorelas is already in play.
    expect(findCharInstanceId(state, RESOURCE_PLAYER, DORELAS)).toBeTruthy();

    const dupId = handCardId(state, RESOURCE_PLAYER);
    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.action.type === 'play-character'
        && a.action.characterInstanceId === dupId);

    // The second copy is offered but blocked — specifically because the unique
    // Dorelas is already in play (not for some unrelated reason).
    expect(playActions.length).toBeGreaterThanOrEqual(1);
    expect(playActions.every(a => !a.viable)).toBe(true);
    expect(playActions.some(a => /unique/i.test(a.reason ?? ''))).toBe(true);
  });
});
