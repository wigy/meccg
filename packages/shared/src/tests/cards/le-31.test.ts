/**
 * @module le-31.test
 *
 * Card test: Orc Captain (le-31)
 * Type: minion-character
 * Effects: 2
 *
 * "Leader. Discard on a body check result of 8. +3 direct influence
 *  against Orcs and Orc factions."
 *
 * Card shape (non-unique, race orc, prowess 5, body 8, mind 5, DI 0,
 * keyword Leader, homesite "Any Dark-hold") is documented here rather
 * than asserted in tests — verifying JSON against itself would prove
 * nothing. "Leader" is a descriptive keyword referenced by other cards;
 * "Discard on a body check result of 8" is the standard semantic of
 * body 8 and needs no card-specific logic.
 *
 * Effects tested:
 * 1. stat-modifier: +3 DI during influence-check when target race is orc
 * 2. stat-modifier: +3 DI during faction-influence-check when faction race is orc
 *
 * Fixture alignment: minion-character (ringwraith), so tests use minion sites
 * (LE) and minion candidate characters (LE/AS).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  buildTestState, buildSitePhaseState, resetMint,
  findCharInstanceId, viablePlayCharacterActions,
  getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CharacterCard, InfluenceAttemptAction } from '../../index.js';
import { computeLegalActions, Phase } from '../../index.js';

const ORC_CAPTAIN = 'le-31' as CardDefinitionId;

// Minion candidate characters for influence-check tests
const GRISHNAKH = 'le-12' as CardDefinitionId;   // orc, mind 3
const LUITPRAND = 'le-23' as CardDefinitionId;   // man, mind 1, no effects

// Minion sites
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // haven
const MORIA_MINION = 'le-392' as CardDefinitionId; // shadow-hold
const BARAD_DUR = 'le-352' as CardDefinitionId;    // dark-hold
const GOBLIN_GATE = 'le-378' as CardDefinitionId;  // shadow-hold (Goblins of Goblin-gate's site)

// Minion orc faction with positive influenceNumber
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId; // orc, influence# 9

describe('Orc Captain (le-31)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats (conditional bonuses do not inflate base stats) ──────────────

  test('base effective DI is 0 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [ORC_CAPTAIN] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const baseDef = pool[ORC_CAPTAIN as string] as CharacterCard;
    expect(getCharacter(state, RESOURCE_PLAYER, ORC_CAPTAIN).effectiveStats.directInfluence)
      .toBe(baseDef.directInfluence);
  });

  // ─── Effect 1: +3 DI during influence-check (character control) ──────────────

  test('+3 DI vs Orcs allows Orc Captain to control Grishnákh (orc, mind 3) as a follower', () => {
    // Orc Captain base DI = 0. Grishnákh is an orc with mind 3.
    // Without the +3 DI bonus against Orcs: DI 0 < mind 3 → cannot control.
    // With the bonus: DI 3 >= mind 3 → can control as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_MORGUL, characters: [ORC_CAPTAIN] }],
          hand: [GRISHNAKH],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const captainId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_CAPTAIN);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const grishnakhUnderCaptain = actions.filter(a => a.controlledBy === captainId);
    expect(grishnakhUnderCaptain.length).toBeGreaterThanOrEqual(1);
  });

  test('+3 DI bonus does NOT apply to non-Orc characters', () => {
    // Luitprand is race "man" with mind 1. Orc Captain's +3 DI bonus is
    // race-gated (orc only), so DI stays at 0 < mind 1 → Orc Captain cannot
    // take Luitprand as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_MORGUL, characters: [ORC_CAPTAIN] }],
          hand: [LUITPRAND],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const captainId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_CAPTAIN);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const luitprandUnderCaptain = actions.filter(a => a.controlledBy === captainId);
    expect(luitprandUnderCaptain).toHaveLength(0);
  });

  // ─── Effect 2: +3 DI during faction-influence-check (orc factions) ───────────

  test('+3 DI bonus applies when influencing an Orc faction (Goblins of Goblin-gate)', () => {
    // Orc Captain (orc, base DI 0) attempts to influence Goblins of Goblin-gate
    // (orc faction, influenceNumber 9) at Goblin-gate.
    // With the +3 DI bonus vs Orc factions: modifier = DI 0 + 3 = 3 → need 9 - 3 = 6.
    const state = buildSitePhaseState({
      characters: [ORC_CAPTAIN],
      site: GOBLIN_GATE,
      hand: [GOBLINS_OF_GOBLIN_GATE],
    });

    const captainId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_CAPTAIN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const captainAttempt = influenceActions.find(
      a => a.influencingCharacterId === captainId,
    );
    expect(captainAttempt).toBeDefined();

    // influenceNumber(9) - baseDI(0) - diBonusVsOrcFaction(3) = 6
    expect(captainAttempt!.need).toBe(6);
  });
});
