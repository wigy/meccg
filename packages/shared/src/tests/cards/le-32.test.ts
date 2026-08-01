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
 * keyword Leader, discardBodyCheck [8], homesite "Any Dark-hold") is
 * documented here rather than asserted in tests — verifying JSON against
 * itself would prove nothing. "leader" is a descriptive keyword referenced
 * by other cards.
 *
 * Effects tested:
 * 1. discardBodyCheck [8]: discarded (not eliminated) when a mass body
 *    check fails at the effective threshold; stays in play when it passes.
 * 2. stat-modifier: +3 DI during influence-check when target race is orc
 * 3. stat-modifier: +3 DI during faction-influence-check when faction race is orc
 * 4. "leader" keyword: offered the leader-control influence variant on
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
  makeMHState, P1_COMPANY,
  findCharInstanceId, handCardId, dispatch, viablePlayCharacterActions, viableActions,
  getCharacter, RESOURCE_PLAYER, HAZARD_PLAYER,
  expectCharInPlay, expectCharNotInPlay,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import type {
  CardDefinitionId, CharacterCard, InfluenceAttemptAction,
  GameState, MovementHazardPhaseState, ResolveDiceCheckAction,
} from '../../index.js';
import { Phase, RegionType } from '../../index.js';

const ORC_CHIEFTAIN = 'le-32' as CardDefinitionId;
const VEILS_FLUNG_AWAY = 'le-146' as CardDefinitionId; // hazard short event; body check modifier -1

// Minion candidate characters for influence-check tests
const GRISHNAKH = 'le-12' as CardDefinitionId;   // orc, mind 3
const LUITPRAND = 'le-23' as CardDefinitionId;   // man, mind 1, no effects
const LAGDUF = 'le-18' as CardDefinitionId;      // minion orc (opponent filler)

// Minion sites
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // haven
const MORIA_MINION = 'le-392' as CardDefinitionId; // shadow-hold
const BARAD_DUR = 'le-352' as CardDefinitionId;    // dark-hold
const GOBLIN_GATE = 'le-378' as CardDefinitionId;  // shadow-hold (Goblins of Goblin-gate's site)
const EDORAS_LE = 'le-372' as CardDefinitionId;    // free-hold; site path has Wilderness

// Minion orc faction with positive influenceNumber
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId; // orc, influence# 9
const ORCS_OF_GORGOROTH = 'le-275' as CardDefinitionId;      // orc, leader-control, playable at Barad-dûr

/** Build an MH state with a Wilderness in the site path (Veils Flung Away condition). */
function makeWildernessMH(overrides?: Partial<MovementHazardPhaseState>): MovementHazardPhaseState {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness],
    resolvedSitePathNames: ['Rohan'],
    ...overrides,
  });
}

describe('Orc Chieftain (le-32)', () => {
  beforeEach(() => resetMint());

  // ─── discardBodyCheck [8]: fail → discard to discard pile ────────────────

  test('Orc Chieftain is discarded to discard pile when mass body check fails', () => {
    // discardBodyCheck [8], Veils modifier -1 → effectiveThreshold = 7.
    // Roll 6 (< 7) → fail → Orc Chieftain discarded to resource player's discard pile.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [ORC_CHIEFTAIN] }], hand: [], siteDeck: [EDORAS_LE] },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [LAGDUF] }], hand: [VEILS_FLUNG_AWAY], siteDeck: [MORIA_MINION] },
      ],
    });
    let s: GameState = { ...state, phaseState: makeWildernessMH() };
    const chieftainId = findCharInstanceId(s, RESOURCE_PLAYER, ORC_CHIEFTAIN);
    const veilId = handCardId(s, HAZARD_PLAYER);

    s = dispatch(s, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: veilId, targetCompanyId: P1_COMPANY });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    const dc = s.pendingResolutions.find(r => r.kind.type === 'dice-check' && r.kind.targetCharacterId === chieftainId);
    expect(dc).toBeDefined();
    if (dc?.kind.type === 'dice-check') {
      expect(dc.kind.threshold).toBe(7);
    }

    s = { ...s, cheatRollTotal: 6 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'resolve-dice-check');
    expect(rollActions).toHaveLength(1);
    s = dispatch(s, rollActions[0].action as ResolveDiceCheckAction);

    expectCharNotInPlay(s, RESOURCE_PLAYER, chieftainId);
    const discardDefIds = s.players[RESOURCE_PLAYER].discardPile.map(c => c.definitionId);
    expect(discardDefIds).toContain(ORC_CHIEFTAIN);
    const oopDefIds = s.players[RESOURCE_PLAYER].outOfPlayPile.map(c => c.definitionId);
    expect(oopDefIds).not.toContain(ORC_CHIEFTAIN);
  });

  test('Orc Chieftain stays in play when mass body check passes', () => {
    // discardBodyCheck [8], Veils modifier -1 → effectiveThreshold = 7.
    // Roll 7 (= threshold) → pass → Orc Chieftain remains in play.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [ORC_CHIEFTAIN] }], hand: [], siteDeck: [EDORAS_LE] },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [LAGDUF] }], hand: [VEILS_FLUNG_AWAY], siteDeck: [MORIA_MINION] },
      ],
    });
    let s: GameState = { ...state, phaseState: makeWildernessMH() };
    const chieftainId = findCharInstanceId(s, RESOURCE_PLAYER, ORC_CHIEFTAIN);
    const veilId = handCardId(s, HAZARD_PLAYER);

    s = dispatch(s, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: veilId, targetCompanyId: P1_COMPANY });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    s = { ...s, cheatRollTotal: 7 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'resolve-dice-check');
    s = dispatch(s, rollActions[0].action);

    expectCharInPlay(s, RESOURCE_PLAYER, chieftainId);
  });

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

  // ─── Effect 2: +3 DI during influence-check (character control) ──────────────

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

  // ─── Effect 3: +3 DI during faction-influence-check (orc factions) ───────────

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
