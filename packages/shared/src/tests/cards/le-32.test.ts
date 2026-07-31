/**
 * @module le-32.test
 *
 * Card test: Orc Chieftain (le-32)
 * Type: minion-character
 * Effects: 2
 *
 * "Leader. Discard on a body check result of 8. +3 direct influence
 *  against Orcs and Orc factions."
 *
 * Card shape (non-unique, race orc, prowess 4, body 8, mind 4, DI 0,
 * keyword Leader, homesite "Any Dark-hold") is documented here rather
 * than asserted in tests — verifying JSON against itself would prove
 * nothing. "leader" is a descriptive keyword referenced by other cards;
 * "Discard on a body check result of 8" is the standard semantic of
 * body 8 and needs no card-specific logic.
 *
 * Effects tested:
 * 1. stat-modifier: +3 DI during influence-check when target race is orc
 * 2. stat-modifier: +3 DI during faction-influence-check when faction race is orc
 * 3. "leader" keyword: offered the leader-control influence variant on
 *    leader-control factions (e.g. Orcs of Gorgoroth, le-275) — this is the
 *    reported bug: without the keyword, no option was offered to place the
 *    faction under the Chieftain's control and leave the site untapped.
 *
 * Fixture alignment: minion-character (ringwraith), so tests use minion sites
 * (LE) and minion candidate characters (LE/AS).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  buildTestState, buildSitePhaseState, buildMinionSitePhaseState, resetMint,
  findCharInstanceId, viablePlayCharacterActions, viableActions,
  getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CharacterCard, InfluenceAttemptAction } from '../../index.js';
import { computeLegalActions, Phase } from '../../index.js';

const ORC_CHIEFTAIN = 'le-32' as CardDefinitionId;

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
const ORCS_OF_GORGOROTH = 'le-275' as CardDefinitionId;      // orc, leader-control, playable at Barad-dûr

describe('Orc Chieftain (le-32)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats (conditional bonuses do not inflate base stats) ──────────────

  test('base effective DI is 0 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [ORC_CHIEFTAIN] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const baseDef = pool[ORC_CHIEFTAIN as string] as CharacterCard;
    expect(getCharacter(state, RESOURCE_PLAYER, ORC_CHIEFTAIN).effectiveStats.directInfluence)
      .toBe(baseDef.directInfluence);
  });

  // ─── Effect 1: +3 DI during influence-check (character control) ──────────────

  test('+3 DI vs Orcs allows Orc Chieftain to control Grishnákh (orc, mind 3) as a follower', () => {
    // Orc Chieftain base DI = 0. Grishnákh is an orc with mind 3.
    // Without the +3 DI bonus against Orcs: DI 0 < mind 3 → cannot control.
    // With the bonus: DI 3 >= mind 3 → can control as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_MORGUL, characters: [ORC_CHIEFTAIN] }],
          hand: [GRISHNAKH],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const chieftainId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_CHIEFTAIN);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const grishnakhUnderChieftain = actions.filter(a => a.controlledBy === chieftainId);
    expect(grishnakhUnderChieftain.length).toBeGreaterThanOrEqual(1);
  });

  test('+3 DI bonus does NOT apply to non-Orc characters', () => {
    // Luitprand is race "man" with mind 1. Orc Chieftain's +3 DI bonus is
    // race-gated (orc only), so DI stays at 0 < mind 1 → Orc Chieftain cannot
    // take Luitprand as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_MORGUL, characters: [ORC_CHIEFTAIN] }],
          hand: [LUITPRAND],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const chieftainId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_CHIEFTAIN);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const luitprandUnderChieftain = actions.filter(a => a.controlledBy === chieftainId);
    expect(luitprandUnderChieftain).toHaveLength(0);
  });

  // ─── Effect 2: +3 DI during faction-influence-check (orc factions) ───────────

  test('+3 DI bonus applies when influencing an Orc faction (Goblins of Goblin-gate)', () => {
    // Orc Chieftain (orc, base DI 0) attempts to influence Goblins of Goblin-gate
    // (orc faction, influenceNumber 9) at Goblin-gate.
    // With the +3 DI bonus vs Orc factions: modifier = DI 0 + 3 = 3 → need 9 - 3 = 6.
    const state = buildSitePhaseState({
      characters: [ORC_CHIEFTAIN],
      site: GOBLIN_GATE,
      hand: [GOBLINS_OF_GOBLIN_GATE],
    });

    const chieftainId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_CHIEFTAIN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const chieftainAttempt = influenceActions.find(
      a => a.influencingCharacterId === chieftainId,
    );
    expect(chieftainAttempt).toBeDefined();

    // influenceNumber(9) - baseDI(0) - diBonusVsOrcFaction(3) = 6
    expect(chieftainAttempt!.need).toBe(6);
  });

  // ─── Keyword "leader": leader-control influence variant ──────────────────────

  test('Orc Chieftain (leader) is offered the leader-control influence variant on Orcs of Gorgoroth', () => {
    // Bug report: influencing a leader-control faction (Orcs of Gorgoroth,
    // le-275) with Orc Chieftain did not offer the option to place the
    // faction under his control and leave the site untapped, because the
    // card data was missing the "leader" keyword required by the faction's
    // leader-control effect (requiresKeyword: "leader").
    const state = buildMinionSitePhaseState({ site: BARAD_DUR, characters: [ORC_CHIEFTAIN], hand: [ORCS_OF_GORGOROTH] });
    const chieftainId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_CHIEFTAIN);
    const attempts = viableActions(state, PLAYER_1, 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .filter(a => a.influencingCharacterId === chieftainId);
    expect(attempts.some(a => a.placeUnderLeaderControl === true)).toBe(true);
  });
});
