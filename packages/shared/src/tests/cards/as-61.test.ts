/**
 * @module as-61.test
 *
 * Card test: Petty-dwarves (as-61)
 * Type: hero-resource-faction · alignment: wizard · race: dwarf · UNIQUE
 *       · faction MP 2 · influence # 11
 *
 * Card text:
 *   "Unique. Manifestation of minion Petty-dwarves. Playable at The Worthy
 *    Hills if the influence check is greater than 10. Standard
 *    Modifications: Elves (-2), Dwarves (+2)."
 *
 * Rules modelled (and how):
 *  - "Playable at The Worthy Hills" — `playableAt: [{ site: "The Worthy Hills" }]`;
 *    the faction influence-attempt generator only offers the attempt when the
 *    company's current site name matches exactly.
 *  - "if the influence check is greater than 10" — `influenceNumber: 11`; the
 *    engine succeeds on `total >= influenceNumber`, so a modified roll of 11
 *    (i.e. "greater than 10") is the minimum. The computed `need = 11 - DI - checkMod`.
 *  - "Standard Modifications: Elves (-2), Dwarves (+2)" — two `check-modifier`
 *    effects gated on `bearer.race`.
 *  - "Unique" — `unique: true`; a copy already in play blocks a second
 *    influence attempt (the unique duplicate-in-play gate).
 *  - "Manifestation of minion Petty-dwarves" — manifestation uniqueness vs.
 *    the same-named minion faction (as-65).
 *
 * | # | Rule                                                            | Status |
 * |---|------------------------------------------------------------------|--------|
 * | 1 | influence-able at The Worthy Hills; base need = 11 ("> 10")       | OK     |
 * | 2 | Elf gets -2 check modifier when influencing                      | OK     |
 * | 3 | Dwarf gets +2 check modifier when influencing                    | OK     |
 * | 4 | non-Elf/Dwarf character gets no check modifier                   | OK     |
 * | 5 | NOT playable at a different site (even another ruins-and-lairs)  | OK     |
 * | 6 | unique: a copy already in play blocks a second attempt           | OK     |
 * | 7 | manifestation uniqueness vs. minion version (as-65)               | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  RESOURCE_PLAYER, PLAYER_1, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, GIMLI,
  buildSitePhaseState, addCardInPlay, resetMint,
  findHandCardId, firstFactionInfluenceAttempt,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const PETTY_DWARVES = 'as-61' as CardDefinitionId;        // the faction under test (UNIQUE, dwarf, inf # 11)
const PETTY_DWARVES_MINION = 'as-65' as CardDefinitionId; // same-named minion faction — manifestation uniqueness
const WORTHY_HILLS = 'as-142' as CardDefinitionId;   // its only playable site (ruins-and-lairs)
const WEATHERTOP = 'as-169' as CardDefinitionId;     // another ruins-and-lairs — NOT The Worthy Hills

describe('Petty-dwarves (as-61)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: playable at The Worthy Hills; influence # 11 ("greater than 10") ──

  test('influence-able at The Worthy Hills; a DI-3 Dúnadan needs 8 (no faction modifier)', () => {
    // Aragorn (dunadan, DI 3) attempts to influence the Petty-dwarves.
    //   need = influenceNumber(11) - DI(3) = 8 (no Elf/Dwarf modifier applies)
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: WORTHY_HILLS,
      hand: [PETTY_DWARVES],
    });
    const factionId = findHandCardId(state, RESOURCE_PLAYER, PETTY_DWARVES);
    const attempt = firstFactionInfluenceAttempt(state, factionId);

    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  // ── Rule 2: Elves receive a -2 check modifier ───────────────────────────────────

  test('Elf character gets -2 check modifier when influencing', () => {
    // Legolas (elf, DI 2) attempts to influence the Petty-dwarves.
    //   modifier = DI 2 + checkMod(-2) = 0
    //   need = 11 - 0 = 11
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: WORTHY_HILLS,
      hand: [PETTY_DWARVES],
    });
    const factionId = findHandCardId(state, RESOURCE_PLAYER, PETTY_DWARVES);
    const attempt = firstFactionInfluenceAttempt(state, factionId);

    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(11);
  });

  // ── Rule 3: Dwarves receive a +2 check modifier ─────────────────────────────────

  test('Dwarf character gets +2 check modifier when influencing', () => {
    // Gimli (dwarf, DI 2) attempts to influence the Petty-dwarves.
    //   modifier = DI 2 + checkMod(+2) = 4
    //   need = 11 - 4 = 7
    const state = buildSitePhaseState({
      characters: [GIMLI],
      site: WORTHY_HILLS,
      hand: [PETTY_DWARVES],
    });
    const factionId = findHandCardId(state, RESOURCE_PLAYER, PETTY_DWARVES);
    const attempt = firstFactionInfluenceAttempt(state, factionId);

    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  // ── Rule 4: named-site restriction ──────────────────────────────────────────────

  test('NOT playable at a different ruins-and-lairs (only The Worthy Hills qualifies)', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: WEATHERTOP,
      hand: [PETTY_DWARVES],
    });
    const factionId = findHandCardId(state, RESOURCE_PLAYER, PETTY_DWARVES);

    expect(firstFactionInfluenceAttempt(state, factionId)).toBeUndefined();
  });

  // ── Rule 5: unique — a copy already in play blocks a second ────────────────────

  test('unique: a copy already in play blocks a second influence attempt', () => {
    const base = buildSitePhaseState({
      characters: [ARAGORN],
      site: WORTHY_HILLS,
      hand: [PETTY_DWARVES],
    });
    const state = addCardInPlay(base, RESOURCE_PLAYER, PETTY_DWARVES);
    const factionId = findHandCardId(state, RESOURCE_PLAYER, PETTY_DWARVES);

    expect(firstFactionInfluenceAttempt(state, factionId)).toBeUndefined();
  });

  // ── Rule 6: manifestation uniqueness vs. the minion version ────────────────────

  test('manifestation uniqueness: hero version cannot be played if minion version is in play', () => {
    // The engine's name-based faction uniqueness check prevents playing as-61
    // when as-65 (same name "Petty-dwarves") is already in play, even on the
    // opponent's side.
    const base = buildSitePhaseState({
      characters: [ARAGORN],
      site: WORTHY_HILLS,
      hand: [PETTY_DWARVES],
    });
    const state = addCardInPlay(base, HAZARD_PLAYER, PETTY_DWARVES_MINION);

    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions.filter(
      a => a.viable && a.action.type === 'influence-attempt',
    );
    expect(influenceActions).toHaveLength(0);

    const notPlayable = actions.find(
      a => !a.viable && a.action.type === 'not-playable',
    );
    expect(notPlayable).toBeDefined();
  });
});
