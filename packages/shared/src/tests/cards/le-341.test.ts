/**
 * @module le-341.test
 *
 * Card test: Sable Shield (le-341)
 * Type: minion-resource-item (major), unique, 2 corruption.
 * Keywords: shield
 *
 * "Unique. Shield. If a strike against the bearer is successful, he is not
 *  wounded. Instead, the attacker makes a roll—if this result is greater than
 *  6, discard Sable Shield."
 *
 * Engine Support:
 * | # | Feature                                      | Status      | Notes                                       |
 * |---|----------------------------------------------|-------------|---------------------------------------------|
 * | 1 | Wound prevention on successful strike         | IMPLEMENTED | absorb-wound effect in reducer-combat.ts    |
 * | 2 | Combat enters shield-discard-roll phase       | IMPLEMENTED | absorb-wound transition in resolveStrike    |
 * | 3 | Roll > threshold: shield discarded            | IMPLEMENTED | handleShieldDiscardRoll                     |
 * | 4 | Roll ≤ threshold: shield stays                | IMPLEMENTED | handleShieldDiscardRoll                     |
 *
 * Fixture alignment: minion-resource-item (ringwraith), tests use minion
 * characters (le-11 Gorbag, le-39 Shagrat) and minion sites (le-367, le-392).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, resetMint, Phase,
  attachItemToChar,
  findCharInstanceId,
  companyIdAt,
  dispatch,
  viableActions,
  makeShadowMHState,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { CardStatus, Race } from '../../index.js';
import type { CombatState } from '../../types/state-combat.js';
import type { CardDefinitionId, CardInstanceId } from '../../index.js';

const SABLE_SHIELD = 'le-341' as CardDefinitionId;

// Minion fixtures — declared locally per CLAUDE.md card-ids policy.
const GORBAG = 'le-11' as CardDefinitionId;         // prowess 6, body 9
const SHAGRAT = 'le-39' as CardDefinitionId;         // prowess 6, body 9
const DOL_GULDUR = 'le-367' as CardDefinitionId;     // darkhaven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;   // darkhaven

/**
 * Build a combat state with Gorbag (bearing Sable Shield) facing a single
 * strike with the given prowess. The strike is pre-assigned to Gorbag.
 *
 * `phase: 'resolve-strike'`, `assignmentPhase: 'done'`.
 */
function buildShieldCombatState(opts: { creatureProwess: number }) {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [MINAS_MORGUL] },
      { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [DOL_GULDUR] },
    ],
  });

  const withShield = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, SABLE_SHIELD);
  const gorbagId = findCharInstanceId(withShield, RESOURCE_PLAYER, GORBAG);
  const companyId = companyIdAt(withShield, RESOURCE_PLAYER);

  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: 'fake-orc' as CardInstanceId },
    companyId,
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess: opts.creatureProwess,
    creatureBody: null,
    creatureRace: Race.Orc,
    strikeAssignments: [{ characterId: gorbagId, excessStrikes: 0, resolved: false }],
    currentStrikeIndex: 0,
    phase: 'resolve-strike',
    assignmentPhase: 'done',
    bodyCheckTarget: null,
    detainment: false,
  };

  return { state: { ...withShield, phaseState: makeShadowMHState(), combat }, gorbagId };
}

describe('Sable Shield (le-341)', () => {
  beforeEach(() => resetMint());

  // ─── Effect 1: wound prevention ─────────────────────────────────────────

  test('bearer is NOT wounded when strike succeeds — combat enters shield-discard-roll', () => {
    // Gorbag prowess 6; with cheat roll 2: total = 2+6=8 < creature prowess 9.
    // Sable Shield absorbs the wound; Gorbag should tap but not be wounded.
    const { state, gorbagId } = buildShieldCombatState({ creatureProwess: 9 });
    const stateWithCheat = { ...state, cheatRollTotal: 2 };

    const resolveAction = viableActions(stateWithCheat, PLAYER_1, 'resolve-strike')[0];
    expect(resolveAction).toBeDefined();

    const afterStrike = dispatch(stateWithCheat, resolveAction.action);

    // Gorbag is tapped (strike succeeded) but NOT wounded.
    const gorbag = afterStrike.players[RESOURCE_PLAYER].characters[gorbagId];
    expect(gorbag.status).toBe(CardStatus.Tapped);
    expect(gorbag.status).not.toBe(CardStatus.Inverted);

    // Combat advanced to shield-discard-roll phase.
    expect(afterStrike.combat?.phase).toBe('shield-discard-roll');
    expect(afterStrike.combat?.shieldAbsorbItemId).toBeDefined();
  });

  test('when strike fails (character wins), shield does NOT activate', () => {
    // Gorbag prowess 6; cheat roll 12: total = 12+6=18 > creature prowess 9.
    // Strike fails (character wins); no shield-discard-roll phase.
    const { state } = buildShieldCombatState({ creatureProwess: 9 });
    const stateWithCheat = { ...state, cheatRollTotal: 12 };

    const resolveAction = viableActions(stateWithCheat, PLAYER_1, 'resolve-strike')[0];
    const afterStrike = dispatch(stateWithCheat, resolveAction.action);

    // Should NOT be in shield-discard-roll phase.
    expect(afterStrike.combat?.phase).not.toBe('shield-discard-roll');
  });

  // ─── Effect 2/3: shield-discard-roll actions ────────────────────────────

  test('shield-discard-roll action is offered to the attacking player (P2)', () => {
    const { state } = buildShieldCombatState({ creatureProwess: 9 });
    const stateWithCheat = { ...state, cheatRollTotal: 2 };
    const resolveAction = viableActions(stateWithCheat, PLAYER_1, 'resolve-strike')[0];
    const afterStrike = dispatch(stateWithCheat, resolveAction.action);

    // P2 (attacker) gets the shield-discard-roll action.
    const p2Actions = viableActions(afterStrike, PLAYER_2, 'shield-discard-roll');
    expect(p2Actions).toHaveLength(1);
    expect(p2Actions[0].action.type).toBe('shield-discard-roll');

    // P1 (defender) does NOT get the action.
    const p1Actions = viableActions(afterStrike, PLAYER_1, 'shield-discard-roll');
    expect(p1Actions).toHaveLength(0);
  });

  // ─── Effect 4: roll > 6 → shield discarded ──────────────────────────────

  test('shield is discarded when roll strictly exceeds 6', () => {
    const { state, gorbagId } = buildShieldCombatState({ creatureProwess: 9 });

    // Strike succeeds (cheat 2 → total 8 < 9).
    const afterStrike = dispatch({ ...state, cheatRollTotal: 2 },
      viableActions({ ...state, cheatRollTotal: 2 }, PLAYER_1, 'resolve-strike')[0].action);

    // Roll 7 > 6 → shield discarded.
    const rollAction = viableActions(afterStrike, PLAYER_2, 'shield-discard-roll')[0];
    const afterRoll = dispatch({ ...afterStrike, cheatRollTotal: 7 }, rollAction.action);

    const gorbag = afterRoll.players[RESOURCE_PLAYER].characters[gorbagId];
    const shieldInItems = gorbag.items.some(i => i.definitionId === SABLE_SHIELD);
    expect(shieldInItems).toBe(false);

    // Shield is in P1's discard pile.
    const shieldInDiscard = afterRoll.players[RESOURCE_PLAYER].discardPile.some(
      i => i.definitionId === SABLE_SHIELD,
    );
    expect(shieldInDiscard).toBe(true);

    // Combat finished (no more strikes).
    expect(afterRoll.combat).toBeNull();
  });

  // ─── Effect 5: roll ≤ 6 → shield stays ──────────────────────────────────

  test('shield stays when roll does not exceed 6', () => {
    const { state, gorbagId } = buildShieldCombatState({ creatureProwess: 9 });

    // Strike succeeds (cheat 2 → total 8 < 9).
    const afterStrike = dispatch({ ...state, cheatRollTotal: 2 },
      viableActions({ ...state, cheatRollTotal: 2 }, PLAYER_1, 'resolve-strike')[0].action);

    // Roll 6 is NOT > 6 → shield survives.
    const rollAction = viableActions(afterStrike, PLAYER_2, 'shield-discard-roll')[0];
    const afterRoll = dispatch({ ...afterStrike, cheatRollTotal: 6 }, rollAction.action);

    const gorbag = afterRoll.players[RESOURCE_PLAYER].characters[gorbagId];
    const shieldInItems = gorbag.items.some(i => i.definitionId === SABLE_SHIELD);
    expect(shieldInItems).toBe(true);

    // Combat finished.
    expect(afterRoll.combat).toBeNull();
  });

  // ─── Effect 6: exact threshold (roll = 6) ──────────────────────────────

  test('shield survives when roll equals threshold (roll = 6, threshold = 6)', () => {
    const { state, gorbagId } = buildShieldCombatState({ creatureProwess: 9 });

    const afterStrike = dispatch({ ...state, cheatRollTotal: 2 },
      viableActions({ ...state, cheatRollTotal: 2 }, PLAYER_1, 'resolve-strike')[0].action);

    const rollAction = viableActions(afterStrike, PLAYER_2, 'shield-discard-roll')[0];
    const afterRoll = dispatch({ ...afterStrike, cheatRollTotal: 6 }, rollAction.action);

    const gorbag = afterRoll.players[RESOURCE_PLAYER].characters[gorbagId];
    expect(gorbag.items.some(i => i.definitionId === SABLE_SHIELD)).toBe(true);
  });
});
