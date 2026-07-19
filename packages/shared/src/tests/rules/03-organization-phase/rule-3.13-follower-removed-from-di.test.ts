/**
 * @module rule-3.13-follower-removed-from-di
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.13: Follower Removed from Direct Influence
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If a follower is removed from the control of direct influence outside of an organization phase (e.g. due to its controlling character being eliminated, or the follower's mind being increased such that it can no longer be controlled by its controlling character's direct influence, etc.), its mind is not immediately subtracted from its player's general influence. During its player's next organization phase, the character must be moved back under the control of either general influence or direct influence, or else it must be discarded at the end of that phase.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase } from '../../../index.js';
import type { CardInstanceId, CombatState } from '../../../index.js';
import {
  buildTestState, resetMint, dispatch, viableActions, executeAction,
  companyIdAt, findCharInstanceId, makeShadowMHState, recomputeDerived,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, FARAMIR, LEGOLAS,
  MORIA, LORIEN, MINAS_TIRITH,
} from '../../test-helpers.js';

describe('Rule 3.13 — Follower Removed from Direct Influence', () => {
  beforeEach(() => resetMint());

  test('controller eliminated in combat: follower reverts to GI with the mind subtraction deferred', () => {
    // Faramir follows Aragorn (direct influence). Aragorn faces an
    // unwinnable strike during the movement/hazard phase, is wounded, and
    // the body check eliminates him. Per rule 3.13 Faramir reverts to
    // general influence, but his mind must NOT count against general
    // influence yet — the subtraction is deferred to the player's next
    // organization phase.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MORIA,
            characters: [
              { defId: ARAGORN },
              { defId: FARAMIR, followerOf: 0 },
            ],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const faramirId = findCharInstanceId(base, RESOURCE_PLAYER, FARAMIR);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    expect(base.players[RESOURCE_PLAYER].characters[faramirId].controlledBy).toBe(aragornId);
    // Baseline: only Aragorn (general influence) counts; Faramir is under DI.
    const giBefore = base.players[RESOURCE_PLAYER].generalInfluenceUsed;

    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: 'fake-creature' as CardInstanceId },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 99, // unwinnable — Aragorn is wounded
      creatureBody: null,
      creatureRace: 'orc',
      strikeAssignments: [{ characterId: aragornId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
    };
    const state = { ...base, combat, phaseState: makeShadowMHState() };

    // Fail the strike (roll 2 vs prowess 99) → wounded, body check follows.
    const [resolveAction] = viableActions({ ...state, cheatRollTotal: 2 }, PLAYER_1, 'resolve-strike');
    expect(resolveAction).toBeDefined();
    const wounded = dispatch({ ...state, cheatRollTotal: 2 }, resolveAction.action);

    // Body check roll 12 > Aragorn's body 9 → eliminated.
    const after = executeAction(wounded, PLAYER_2, 'body-check-roll', 12);
    expect(after.players[RESOURCE_PLAYER].characters[aragornId]).toBeUndefined();
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === aragornId)).toBe(true);

    // Faramir reverted to general influence with the subtraction deferred.
    const faramir = after.players[RESOURCE_PLAYER].characters[faramirId];
    expect(faramir.controlledBy).toBe('general');
    expect(faramir.influenceUnsubtracted).toBe(true);
    // General influence used dropped by Aragorn's contribution and did NOT
    // pick up Faramir's mind.
    expect(after.players[RESOURCE_PLAYER].generalInfluenceUsed).toBeLessThan(giBefore);
    expect(after.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(0);
  });

  test('the deferred mind counts against GI at the start of the player\'s next organization phase', () => {
    // A follower that was stripped of its controller outside the
    // organization phase carries the influenceUnsubtracted flag. Once its
    // player reaches their next organization phase, the flag clears and the
    // character's mind counts against general influence again (from which
    // point the player must reassign or discard the character).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, FARAMIR] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const faramirId = findCharInstanceId(base, RESOURCE_PLAYER, FARAMIR);
    // Baseline: both characters count under general influence.
    const giFull = base.players[RESOURCE_PLAYER].generalInfluenceUsed;

    // Simulate the mid-turn deferral: Faramir under GI but not yet subtracted.
    const flagged = recomputeDerived({
      ...base,
      phaseState: {
        phase: Phase.Untap,
        untapped: false,
        hazardSideboardDestination: null,
        hazardSideboardFetched: 0,
        hazardSideboardAccessed: true,
        resourcePlayerPassed: false,
        hazardPlayerPassed: true,
      } as typeof base.phaseState,
      players: base.players.map((p, i) => i !== RESOURCE_PLAYER ? p : {
        ...p,
        characters: {
          ...p.characters,
          [faramirId as string]: {
            ...p.characters[faramirId],
            influenceUnsubtracted: true,
          },
        },
      }) as unknown as typeof base.players,
    });
    expect(flagged.players[RESOURCE_PLAYER].generalInfluenceUsed).toBeLessThan(giFull);

    // Untapping moves the player into their organization phase — the
    // deferral ends and Faramir's mind counts again.
    const inOrg = dispatch(flagged, { type: 'untap', player: PLAYER_1 });
    expect(inOrg.phaseState.phase).toBe(Phase.Organization);
    expect(inOrg.players[RESOURCE_PLAYER].characters[faramirId].influenceUnsubtracted).toBeUndefined();
    expect(inOrg.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(giFull);
  });

  // The enforcement half — "must be moved back under the control of either
  // general influence or direct influence, or else it must be discarded at
  // the end of that phase" — needs the end-of-organization-phase forced
  // discard state machine shared with rule 3.47 (influence overflow), which
  // does not exist yet.
  test.todo('follower not reassigned by end of next organization phase is discarded');
});
