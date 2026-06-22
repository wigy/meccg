/**
 * @module le-45.test
 *
 * Card test: Troll-chief (le-45)
 * Type: minion-character (ringwraith), non-unique
 * Race: troll | Skills: warrior | Keywords: Leader, Olog-hai
 * Stats: prowess 6, body 9, mind 6, direct influence 0
 *
 * "Olog-hai. Leader. Discard on a body check result of 9. +3 direct influence
 *  against Trolls, Orcs, Troll factions, and Orc factions."
 *
 * Rules covered by this test:
 *   1. +3 DI during influence-check when the target character race is troll.
 *   2. +3 DI during influence-check when the target character race is orc.
 *   3. The +3 DI bonus is race-gated (does NOT apply to non-orc/non-troll).
 *   4. +3 DI during faction-influence-check vs a Troll faction (Black Trolls).
 *   5. +3 DI during faction-influence-check vs an Orc faction (Goblins of Goblin-gate).
 *   6. Leader keyword: an Orc/Troll-leader influence attempt on a leader-control
 *      faction (Black Trolls) offers the place-under-leader-control variant;
 *      a non-Leader troll is NOT offered the variant.
 *   7. "Discard on a body check result of 9": a body check roll of 9 sends the
 *      Troll-chief to the discard pile (CoE 8.31), while a roll > body (10)
 *      eliminates it to the out-of-play pile.
 *
 * "Olog-hai" is a troll-subtype trait with no separate mechanical rule beyond
 * the keyword itself (the engine treats it like Uruk-hai / Half-troll labels),
 * so it carries no dedicated assertion.
 *
 * Fixture alignment: minion-character (ringwraith), so tests use minion sites
 * (LE) and minion candidate characters (LE/AS).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2, Alignment,
  buildTestState, buildSitePhaseState, resetMint,
  findCharInstanceId, viablePlayCharacterActions, firstFactionInfluenceAttempt,
  viableActions, dispatch, companyIdAt, makeShadowMHState, makeBodyCheckCombat,
  setCharStatus, CardStatus, getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CharacterCard, InfluenceAttemptAction, CardInstanceId, GameState,
} from '../../index.js';
import { Phase } from '../../index.js';

const TROLL_CHIEF = 'le-45' as CardDefinitionId;        // troll Leader, DI 0, body 9, discardBodyCheck [9]

// Minion candidate characters for influence-check (follower control) tests.
const GRISHNAKH = 'le-12' as CardDefinitionId;          // orc, mind 3
const TROLL_LOUT = 'le-44' as CardDefinitionId;         // troll, mind 3, NOT a Leader
const DORELAS = 'le-8' as CardDefinitionId;             // man, mind 3 (out-of-race control control)

// Minion sites
const MINAS_MORGUL = 'le-390' as CardDefinitionId;      // haven
const DOL_GULDUR = 'le-367' as CardDefinitionId;        // haven
const BARAD_DUR = 'le-352' as CardDefinitionId;         // dark-hold (Troll-chief homesite type; Black Trolls playable here)
const GOBLIN_GATE = 'le-378' as CardDefinitionId;       // shadow-hold (Goblins of Goblin-gate's site)
const CARN_DUM = 'le-359' as CardDefinitionId;          // dark-hold (body-check fixture site)
const MORIA_MINION = 'le-392' as CardDefinitionId;      // shadow-hold (site-deck filler)

// Minion factions
const BLACK_TROLLS = 'le-262' as CardDefinitionId;          // troll faction, influence# 11, leader-control
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId; // orc faction, influence# 9

/** Place-under-leader-control variants of the faction influence attempt. */
function controlVariants(state: GameState, factionInstanceId: CardInstanceId): InfluenceAttemptAction[] {
  return viableActions(state, PLAYER_1, 'influence-attempt')
    .map(a => a.action as InfluenceAttemptAction)
    .filter(a => a.factionInstanceId === factionInstanceId && a.placeUnderLeaderControl === true);
}

describe('Troll-chief (le-45)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats (conditional bonuses do not inflate base stats) ──────────────

  test('base effective DI is 0 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [TROLL_CHIEF] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [TROLL_LOUT] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const baseDef = pool[TROLL_CHIEF as string] as CharacterCard;
    expect(baseDef.directInfluence).toBe(0);
    expect(getCharacter(state, RESOURCE_PLAYER, TROLL_CHIEF).effectiveStats.directInfluence)
      .toBe(baseDef.directInfluence);
  });

  // ─── Rules 1 & 2: +3 DI during influence-check (follower control) ────────────

  test('+3 DI vs Orcs lets Troll-chief control Grishnákh (mind 3) as a follower', () => {
    // Troll-chief base DI 0. Grishnákh is an orc with mind 3.
    // Without the bonus: DI 0 < mind 3 → cannot control.
    // With the +3 DI vs Orcs: DI 3 >= mind 3 → can control as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [TROLL_CHIEF] }], hand: [GRISHNAKH], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [TROLL_LOUT] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const chiefId = findCharInstanceId(state, RESOURCE_PLAYER, TROLL_CHIEF);
    const underChief = viablePlayCharacterActions(state, PLAYER_1).filter(a => a.controlledBy === chiefId);
    expect(underChief.length).toBeGreaterThanOrEqual(1);
  });

  test('+3 DI vs Trolls lets Troll-chief control Troll Lout (mind 3) as a follower', () => {
    // Troll-chief base DI 0. Troll Lout is a troll with mind 3.
    // With the +3 DI vs Trolls: DI 3 >= mind 3 → can control as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [TROLL_CHIEF] }], hand: [TROLL_LOUT], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GRISHNAKH] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const chiefId = findCharInstanceId(state, RESOURCE_PLAYER, TROLL_CHIEF);
    const underChief = viablePlayCharacterActions(state, PLAYER_1).filter(a => a.controlledBy === chiefId);
    expect(underChief.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Rule 3: bonus is race-gated ────────────────────────────────────────────

  test('+3 DI bonus does NOT apply to a non-Orc/non-Troll character (man, mind 3)', () => {
    // Dorelas is race "man" with mind 3 — the same mind a controllable orc/troll
    // would have. The bonus is race-gated, so DI stays at 0 < 3 → no control.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [TROLL_CHIEF] }], hand: [DORELAS], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [TROLL_LOUT] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const chiefId = findCharInstanceId(state, RESOURCE_PLAYER, TROLL_CHIEF);
    const underChief = viablePlayCharacterActions(state, PLAYER_1).filter(a => a.controlledBy === chiefId);
    expect(underChief).toHaveLength(0);
  });

  // ─── Rule 4: +3 DI during faction-influence-check vs a Troll faction ─────────

  test('+3 DI vs Troll factions reduces the influence need for Black Trolls', () => {
    // Black Trolls (troll faction, influence# 11) at Barad-dûr.
    // need = influence#(11) - baseDI(0) - diBonusVsTrollFaction(3) = 8.
    const state = buildSitePhaseState({
      characters: [TROLL_CHIEF],
      site: BARAD_DUR,
      hand: [BLACK_TROLLS],
    });

    const chiefId = findCharInstanceId(state, RESOURCE_PLAYER, TROLL_CHIEF);
    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);

    expect(attempt).toBeDefined();
    expect(attempt!.influencingCharacterId).toBe(chiefId);
    expect(attempt!.need).toBe(8);
  });

  // ─── Rule 5: +3 DI during faction-influence-check vs an Orc faction ──────────

  test('+3 DI vs Orc factions reduces the influence need for Goblins of Goblin-gate', () => {
    // Goblins of Goblin-gate (orc faction, influence# 9) at Goblin-gate.
    // need = influence#(9) - baseDI(0) - diBonusVsOrcFaction(3) = 6.
    const state = buildSitePhaseState({
      characters: [TROLL_CHIEF],
      site: GOBLIN_GATE,
      hand: [GOBLINS_OF_GOBLIN_GATE],
    });

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);

    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(6);
  });

  // ─── Rule 6: Leader keyword enables the leader-control variant ────────────────

  test('Leader keyword: Troll-chief is offered the place-under-leader-control variant for Black Trolls', () => {
    const state = buildSitePhaseState({
      characters: [TROLL_CHIEF],
      site: BARAD_DUR,
      hand: [BLACK_TROLLS],
    });
    const factionInstanceId = state.players[0].hand[0].instanceId;

    expect(controlVariants(state, factionInstanceId)).toHaveLength(1);
  });

  test('a non-Leader troll (Troll Lout) is NOT offered the leader-control variant', () => {
    // Troll Lout is a troll but lacks the Leader keyword → no control variant,
    // though a normal influence attempt is still offered.
    const state = buildSitePhaseState({
      characters: [TROLL_LOUT],
      site: BARAD_DUR,
      hand: [BLACK_TROLLS],
    });
    const factionInstanceId = state.players[0].hand[0].instanceId;

    expect(controlVariants(state, factionInstanceId)).toHaveLength(0);
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeDefined();
  });

  // ─── Rule 7: Discard on a body check result of 9 ─────────────────────────────

  test('a body check roll of 9 sends Troll-chief to the discard pile (not eliminated)', () => {
    // discardBodyCheck [9]: roll exactly 9 → discard pile, not out-of-play pile.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [TROLL_CHIEF] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [TROLL_LOUT] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const chiefId = findCharInstanceId(state, RESOURCE_PLAYER, TROLL_CHIEF);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const wounded = setCharStatus(state, RESOURCE_PLAYER, TROLL_CHIEF, CardStatus.Inverted);
    const readyState = {
      ...wounded,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: chiefId }),
      cheatRollTotal: 9,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === chiefId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === chiefId)).toBe(false);
  });

  test('a body check roll above body (10 > 9) eliminates Troll-chief to the out-of-play pile', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [TROLL_CHIEF] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [TROLL_LOUT] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const chiefId = findCharInstanceId(state, RESOURCE_PLAYER, TROLL_CHIEF);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const wounded = setCharStatus(state, RESOURCE_PLAYER, TROLL_CHIEF, CardStatus.Inverted);
    const readyState = {
      ...wounded,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: chiefId }),
      cheatRollTotal: 10,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === chiefId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === chiefId)).toBe(false);
  });
});
