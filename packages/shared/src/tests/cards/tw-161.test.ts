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
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GLORFINDEL_II, HALDIR, BEREGOND,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, THRANDUILS_HALLS,
  WOOD_ELVES,
  buildTestState, resetMint,
  findCharInstanceId, viablePlayCharacterActions, buildSitePhaseState,
} from '../test-helpers.js';
import { computeLegalActions, Phase } from '../../index.js';
import type { CharacterCard, InfluenceAttemptAction } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Glorfindel II (tw-161)', () => {
  beforeEach(() => resetMint());

  test('base effective DI is 2 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [GLORFINDEL_II] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
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
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [GLORFINDEL_II, LEGOLAS] }],
          hand: [HALDIR],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const glorfindelId = findCharInstanceId(state, 0, GLORFINDEL_II);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const haldirUnderGlorfindel = actions.filter(
      a => a.controlledBy === glorfindelId,
    );
    expect(haldirUnderGlorfindel.length).toBeGreaterThanOrEqual(1);
  });

  test('+1 DI bonus does not apply to non-elf characters', () => {
    // Beregond is a dunadan with mind 2. Glorfindel has base DI 2 — enough
    // to control Beregond without any bonus (DI 2 >= mind 2).
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [GLORFINDEL_II] }],
          hand: [BEREGOND],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const glorfindelId = findCharInstanceId(state, 0, GLORFINDEL_II);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const beregondUnderGlorfindel = actions.filter(
      a => a.controlledBy === glorfindelId,
    );
    expect(beregondUnderGlorfindel.length).toBeGreaterThanOrEqual(1);

    // Effective DI is still 2 (bonus doesn't apply to non-elves)
    expect(state.players[0].characters[glorfindelId as string].effectiveStats.directInfluence).toBe(2);
  });

  test('+1 DI bonus applies when influencing an elf faction (Wood-elves)', () => {
    // Glorfindel II (elf, base DI 2) attempts to influence Wood-elves at Thranduil's Halls.
    // Wood-elves influence number = 8, Elves get +1 check modifier from faction card.
    // With Glorfindel's +1 DI bonus vs elves, total modifier = DI 2 + 1 (DI bonus) + 1 (elf check) = 4.
    // Need to roll > 8 - 4 = 4, so roll of 5+ succeeds.
    // Without the DI bonus, modifier would be 2 + 1 = 3, need roll > 5.
    const state = buildSitePhaseState({
      characters: [GLORFINDEL_II],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });

    const glorfindelId = findCharInstanceId(state, 0, GLORFINDEL_II);
    const actions = computeLegalActions(state, PLAYER_1);

    // There should be an influence-attempt action for Wood-elves with Glorfindel
    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const glorfindelAttempt = influenceActions.find(
      a => a.influencingCharacterId === glorfindelId,
    );
    expect(glorfindelAttempt).toBeDefined();

    // The influence need should reflect the +1 DI bonus:
    // influenceNumber(8) - baseDI(2) - diBonusVsElf(1) - elfCheckMod(1) = 4
    expect(glorfindelAttempt!.need).toBe(4);
  });
});
