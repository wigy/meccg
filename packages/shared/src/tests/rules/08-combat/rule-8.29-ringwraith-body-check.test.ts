/**
 * @module rule-8.29-ringwraith-body-check
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.29: Ringwraith Body Check Special
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [MINION] If a body check roll against a Ringwraith is exactly equal to 7 or 8 before any modifications, the Ringwraith is returned to its player's hand. Until it has been re-played, that player cannot reveal a different Ringwraith and their opponent cannot reveal the same Ringwraith.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase, CardDefinitionId, Alignment, computeLegalActions, Race } from '../../../index.js';
import {
  buildTestState, PLAYER_1, PLAYER_2, resetMint,
  dispatch, viableActions, findCharInstanceId, companyIdAt, makeShadowMHState,
  RESOURCE_PLAYER,
} from '../../test-helpers.js';
import type { CombatState, OrganizationPhaseState } from '../../../index.js';

// Ringwraith avatars (le set, race: ringwraith, mind: null)
const ADUNAPHEL = 'le-50' as CardDefinitionId;  // body 10
const INDUR = 'le-54' as CardDefinitionId;       // body 10

// Minion sites
const CARN_DUM = 'le-359' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

// Hero character for opponent company
const LEGOLAS = 'tw-168' as CardDefinitionId;

/** Build a state with Ringwraith wounded and poised for a body check. */
function makeRingwraithBodyCheckState(ringwraithDefId: CardDefinitionId, roll: number) {
  const base = buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: CARN_DUM, characters: [ringwraithDefId] }],
        hand: [],
        siteDeck: [MINAS_MORGUL],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: DOL_GULDUR, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [MINAS_MORGUL],
      },
    ],
  });

  const rwId = findCharInstanceId(base, RESOURCE_PLAYER, ringwraithDefId);
  const companyId = companyIdAt(base, RESOURCE_PLAYER);

  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: 'fake-creature' as never },
    companyId,
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess: 5,
    creatureBody: 8,
    creatureRace: Race.Orc,
    strikeAssignments: [{
      characterId: rwId,
      excessStrikes: 0,
      resolved: true,
      result: 'wounded',
      wasAlreadyWounded: false,
    }],
    currentStrikeIndex: 0,
    phase: 'body-check',
    assignmentPhase: 'done',
    bodyCheckTarget: 'character',
    detainment: false,
  };

  return {
    state: { ...base, phaseState: makeShadowMHState(), combat, cheatRollTotal: roll },
    rwId,
  };
}

describe('Rule 8.29 — Ringwraith Body Check Special', () => {
  beforeEach(() => resetMint());

  test('[MINION] If body check roll against Ringwraith is exactly 7 or 8 before mods, Ringwraith returned to hand', () => {
    const { state, rwId } = makeRingwraithBodyCheckState(ADUNAPHEL, 7);

    const [bodyCheckAction] = viableActions(state, PLAYER_2, 'body-check-roll');
    const after = dispatch(state, bodyCheckAction.action);

    // Ringwraith must be in hand (not in characters, not in outOfPlayPile)
    expect(after.players[RESOURCE_PLAYER].characters[rwId]).toBeUndefined();
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === rwId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === rwId)).toBe(true);

    // Flag must be set to the Ringwraith's definition ID
    expect(after.players[RESOURCE_PLAYER].ringwraithReturnedToHand).toBe(ADUNAPHEL);

    // Combat ends
    expect(after.combat).toBeNull();
  });

  test('[MINION] Roll of 8 also triggers Ringwraith return-to-hand', () => {
    const { state, rwId } = makeRingwraithBodyCheckState(ADUNAPHEL, 8);
    const [bodyCheckAction] = viableActions(state, PLAYER_2, 'body-check-roll');
    const after = dispatch(state, bodyCheckAction.action);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === rwId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].ringwraithReturnedToHand).toBe(ADUNAPHEL);
  });

  test('[MINION] Roll of 9 does NOT trigger return-to-hand (character survives normally)', () => {
    // Adunaphel body 10: roll 9 ≤ 10, so character survives normally
    const { state, rwId } = makeRingwraithBodyCheckState(ADUNAPHEL, 9);
    const [bodyCheckAction] = viableActions(state, PLAYER_2, 'body-check-roll');
    const after = dispatch(state, bodyCheckAction.action);
    expect(after.players[RESOURCE_PLAYER].characters[rwId]).toBeDefined();
    expect(after.players[RESOURCE_PLAYER].ringwraithReturnedToHand).toBeUndefined();
  });

  test('[MINION] After return-to-hand, player cannot reveal a different Ringwraith until re-played', () => {
    const { state } = makeRingwraithBodyCheckState(ADUNAPHEL, 7);
    const [bodyCheckAction] = viableActions(state, PLAYER_2, 'body-check-roll');
    const afterBodyCheck = dispatch(state, bodyCheckAction.action);

    // Enter organization phase with INDUR in hand
    const indurInstance = { instanceId: 'indur-inst' as never, definitionId: INDUR };
    const orgPhaseState: OrganizationPhaseState = {
      phase: Phase.Organization,
      step: 'play-actions',
      characterPlayedThisTurn: false,
      sideboardFetchedThisTurn: 0,
      sideboardFetchDestination: null,
    };
    const orgState = {
      ...afterBodyCheck,
      activePlayer: PLAYER_1,
      phaseState: orgPhaseState,
      players: afterBodyCheck.players.map((p, i) =>
        i === RESOURCE_PLAYER ? { ...p, hand: [...p.hand, indurInstance] } : p,
      ) as unknown as typeof afterBodyCheck.players,
    };

    const legalActions = computeLegalActions(orgState, PLAYER_1);
    const indurPlayAction = legalActions.find(
      a => a.action.type === 'play-character' &&
           'characterInstanceId' in a.action &&
           a.action.characterInstanceId === indurInstance.instanceId,
    );
    // Indur is a different Ringwraith — should be blocked
    expect(indurPlayAction?.viable).toBe(false);
  });
});
