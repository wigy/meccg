/**
 * @module wh-53.test
 *
 * Card test: Mechanical Bow (wh-53)
 * Type: minion-resource-item (Major Item), alignment ringwraith, non-unique.
 * Marshalling points: 1 · Corruption: 1. Keywords: weapon, technology.
 *
 * Text: "Weapon. Technology. -1 to bearer's body. Warrior only: +2 prowess to a
 * maximum of 8; -1 to the body of any strike its bearer faces if he taps to
 * face the strike."
 *
 * Effects:
 * | # | Effect Type                       | Status | Notes                                                              |
 * |---|------------------------------------|--------|--------------------------------------------------------------------|
 * | 1 | stat-modifier body -1              | OK     | unconditional (applies to any bearer)                              |
 * | 2 | stat-modifier prowess +2, max 8    | OK     | warrior only                                                        |
 * | 3 | enemy-modifier body subtract 1     | OK     | warrior only AND `combat.strikeMode: "tap"` — reduces the creature's body for the body check that follows a strike the bearer taps to face |
 *
 * Playable: YES.
 *
 * Modeling notes:
 *  - Effect 1 ("-1 to bearer's body") is a bare `stat-modifier` body -1, surfaced
 *    in `effectiveStats.body` (mirrors Smart and Secret le-229's +1 body). It is
 *    NOT gated on warrior — the sentence precedes "Warrior only:".
 *  - Effect 2 reuses the standard warrior-gated `stat-modifier` prowess with a
 *    `max` cap (same shape as Ancient Black Axe as-122).
 *  - Effect 3 is the new mechanic. "If he taps to face the strike" is the
 *    difference from as-122's unconditional "-1 to strike's body": the warrior
 *    `enemy-modifier` body -1 additionally gates on `combat.strikeMode: "tap"`.
 *    The strike-facing mode is now recorded on `StrikeAssignment.strikeMode` in
 *    `resolveStrikeCore` and threaded into `resolveEnemyBody` (via a `combat`
 *    context field) at the creature body check. In *untap* (stay-untapped) mode
 *    the gate fails and the creature's body is unreduced.
 *
 * Fixture alignment: minion (ringwraith) bearer + minion characters, per the
 * project's alignment-matching convention. The attacking side (the Orc hazard
 * creature) is the combat opponent.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, Alignment,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  CardStatus, CardDefinitionId, CardInstanceId,
  recomputeDerived, getCharacter, attachItemToChar,
  findCharInstanceId, companyIdAt, executeAction, makeShadowMHState,
} from '../test-helpers.js';
import type { CombatState, GameState } from '../../index.js';

const MECHANICAL_BOW = 'wh-53' as CardDefinitionId;

// Minion (ringwraith) characters.
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;         // warrior, non-unique, prowess 5, body 8
const LUITPRAND = 'le-23' as CardDefinitionId;           // scout only (non-warrior), prowess 3, body 7
const LIEUTENANT_OF_MORGUL = 'le-22' as CardDefinitionId; // warrior/ranger, prowess 8

// Sites.
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // minion site (bearer's company)
const MINAS_TIRITH = 'tw-407' as CardDefinitionId; // opponent (hazard player) placeholder site

// A real Orc hazard-creature card so a defeated creature routes to the kill pile.
const ORC_WARBAND = 'tw-076' as CardDefinitionId;
const ORC_CREATURE_ID = 'orc-creature-1' as CardInstanceId;

/** Ringwraith mover (P1) vs Wizard hazard player (P2), M/H phase. */
function orgBase(bearerDefId: CardDefinitionId): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [bearerDefId] }], hand: [], siteDeck: [] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [] },
    ],
  });
}

/**
 * Build an M/H creature combat where a single Orc strike (prowess 3, body 9)
 * is pre-assigned to `bearerDefId` (who bears the Bow), poised at
 * `resolve-strike`. The Orc creature card sits in P2's cardsInPlay so that a
 * defeated creature is routed to P1's kill pile by `finalizeCombat`.
 */
function bowCreatureCombat(bearerDefId: CardDefinitionId): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [{ defId: bearerDefId, items: [MECHANICAL_BOW] }] }], hand: [], siteDeck: [] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [] },
    ],
  });
  const bearerId = findCharInstanceId(base, RESOURCE_PLAYER, bearerDefId);
  const companyId = companyIdAt(base, RESOURCE_PLAYER);

  // Put the Orc creature card into the hazard player's (P2) cardsInPlay.
  const withCreature = {
    ...base.players[HAZARD_PLAYER],
    cardsInPlay: [
      ...base.players[HAZARD_PLAYER].cardsInPlay,
      { instanceId: ORC_CREATURE_ID, definitionId: ORC_WARBAND, status: CardStatus.Untapped },
    ],
  };
  const players: typeof base.players = [base.players[RESOURCE_PLAYER], withCreature];

  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: ORC_CREATURE_ID },
    companyId,
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess: 3,
    creatureBody: 9,
    creatureRace: 'orc',
    strikeAssignments: [{ characterId: bearerId, excessStrikes: 0, resolved: false }],
    currentStrikeIndex: 0,
    phase: 'resolve-strike',
    assignmentPhase: 'done',
    bodyCheckTarget: null,
    detainment: false,
  };

  return { ...base, players, phaseState: makeShadowMHState(), combat };
}

/** True if the Orc creature ended up in P1's (the defender's) kill pile — i.e. defeated. */
function creatureDefeated(state: GameState): boolean {
  return state.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === ORC_CREATURE_ID);
}

describe('Mechanical Bow (wh-53)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: -1 to bearer's body (unconditional) ─────────────────────────

  test('-1 to a warrior bearer\'s body', () => {
    const state = recomputeDerived(attachItemToChar(orgBase(ORC_CAPTAIN), RESOURCE_PLAYER, ORC_CAPTAIN, MECHANICAL_BOW));
    expect(getCharacter(state, RESOURCE_PLAYER, ORC_CAPTAIN).effectiveStats.body).toBe(7); // base 8 - 1
  });

  test('-1 to body applies even to a non-warrior bearer (unconditional)', () => {
    const state = recomputeDerived(attachItemToChar(orgBase(LUITPRAND), RESOURCE_PLAYER, LUITPRAND, MECHANICAL_BOW));
    expect(getCharacter(state, RESOURCE_PLAYER, LUITPRAND).effectiveStats.body).toBe(6); // base 7 - 1
  });

  // ── Effect 2: warrior-only +2 prowess (max 8) ─────────────────────────────

  test('warrior bearer gains +2 prowess', () => {
    const state = recomputeDerived(attachItemToChar(orgBase(ORC_CAPTAIN), RESOURCE_PLAYER, ORC_CAPTAIN, MECHANICAL_BOW));
    expect(getCharacter(state, RESOURCE_PLAYER, ORC_CAPTAIN).effectiveStats.prowess).toBe(7); // base 5 + 2
  });

  test('+2 prowess is capped at a maximum of 8 (Lieutenant of Morgul base 8)', () => {
    // Base 8 + 2 = 10 without the cap; the `max: 8` clamps it back to 8.
    const state = recomputeDerived(attachItemToChar(orgBase(LIEUTENANT_OF_MORGUL), RESOURCE_PLAYER, LIEUTENANT_OF_MORGUL, MECHANICAL_BOW));
    expect(getCharacter(state, RESOURCE_PLAYER, LIEUTENANT_OF_MORGUL).effectiveStats.prowess).toBe(8);
  });

  test('+2 prowess does NOT apply to a non-warrior bearer', () => {
    const state = recomputeDerived(attachItemToChar(orgBase(LUITPRAND), RESOURCE_PLAYER, LUITPRAND, MECHANICAL_BOW));
    expect(getCharacter(state, RESOURCE_PLAYER, LUITPRAND).effectiveStats.prowess).toBe(3); // unchanged
  });

  // ── Effect 3: warrior + tap-to-face → -1 to the strike's body ─────────────

  test('a warrior who TAPS to face the strike reduces the creature body by 1 (body 9→8; a body-check roll of 9 now defeats it)', () => {
    const combat = bowCreatureCombat(ORC_CAPTAIN);
    // Orc Captain (prowess 5 + 2 bow = 7) taps to face → parries the prowess-3 strike.
    const afterStrike = executeAction(combat, PLAYER_1, 'resolve-strike', 8, /* tapToFight */ true);
    expect(afterStrike.combat!.bodyCheckTarget).toBe('creature');
    // Creature body check: roll 9 vs reduced body 8 → 9 > 8 → creature defeated.
    const after = executeAction(afterStrike, PLAYER_2, 'body-check-roll', 9);
    expect(creatureDefeated(after)).toBe(true);
  });

  test('the SAME warrior facing UNTAPPED gets no body reduction (body stays 9; the roll of 9 leaves the creature alive)', () => {
    const combat = bowCreatureCombat(ORC_CAPTAIN);
    // Stay-untapped (mode 'untap'): prowess 7 - 3 = 4, still parries the prowess-3 strike…
    const afterStrike = executeAction(combat, PLAYER_1, 'resolve-strike', 8, /* tapToFight */ false);
    expect(afterStrike.combat!.bodyCheckTarget).toBe('creature');
    // …but `combat.strikeMode` is 'untap', so the -1 does not apply: 9 vs body 9 → survives.
    const after = executeAction(afterStrike, PLAYER_2, 'body-check-roll', 9);
    expect(creatureDefeated(after)).toBe(false);
  });

  test('a NON-warrior bearer who taps to face gets no body reduction (warrior gate)', () => {
    const combat = bowCreatureCombat(LUITPRAND);
    // Luitprand (prowess 3, no warrior bonus) taps to face → parries the prowess-3 strike.
    const afterStrike = executeAction(combat, PLAYER_1, 'resolve-strike', 8, /* tapToFight */ true);
    expect(afterStrike.combat!.bodyCheckTarget).toBe('creature');
    // No warrior → enemy-modifier gate fails: body stays 9, roll 9 → survives.
    const after = executeAction(afterStrike, PLAYER_2, 'body-check-roll', 9);
    expect(creatureDefeated(after)).toBe(false);
  });
});
