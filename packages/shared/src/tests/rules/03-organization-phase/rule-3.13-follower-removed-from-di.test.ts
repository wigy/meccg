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
import { Phase, Race, Alignment } from '../../../index.js';
import type { CardDefinitionId, CardInstanceId, CombatState } from '../../../index.js';
import {
  buildTestState, resetMint, dispatch, viableActions, executeAction,
  companyIdAt, findCharInstanceId, makeShadowMHState, recomputeDerived,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, FARAMIR, LEGOLAS, ELROND, BEREGOND,
  MORIA, LORIEN, MINAS_TIRITH,
} from '../../test-helpers.js';

// Indûr the Ringwraith (5 direct influence) with Bade to Rule (le-167, -2
// direct influence) attached leaves 3 — no longer enough for Orc Captain
// (le-31, mind 5), which followed him while his direct influence was still 5.
const INDUR = 'le-54' as CardDefinitionId;
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;
const BADE_TO_RULE = 'le-167' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // Darkhaven

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
      creatureRace: Race.Orc,
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

  test('controller\'s direct influence reduced by an in-play effect: follower released at the end of the organization phase it happened in', () => {
    // Regression: Orc Captain (mind 5) follows Indûr (5 direct influence).
    // Bade to Rule then drops Indûr to 3 direct influence — no longer enough
    // to control Orc Captain. The engine must not let Orc Captain remain his
    // follower; per CoE 2.II.2.2.3 he is released to general influence
    // (deferred) by the end of the organization phase the drop happened in,
    // not left dangling across turns until a player notices and fixes it by
    // hand (bug report: Ringwraith with only 3 DI still controlling Orc
    // Captain).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: MINAS_MORGUL,
            characters: [
              { defId: INDUR, items: [BADE_TO_RULE] },
              { defId: ORC_CAPTAIN, followerOf: 0 },
            ],
          }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const indurId = findCharInstanceId(base, RESOURCE_PLAYER, INDUR);
    const orcCaptainId = findCharInstanceId(base, RESOURCE_PLAYER, ORC_CAPTAIN);
    // Bade to Rule already dropped Indûr's direct influence to 3.
    expect(base.players[RESOURCE_PLAYER].characters[indurId].effectiveStats.directInfluence).toBe(3);
    expect(base.players[RESOURCE_PLAYER].characters[orcCaptainId].controlledBy).toBe(indurId);

    const after = dispatch(base, { type: 'pass', player: PLAYER_1 });

    const orcCaptain = after.players[RESOURCE_PLAYER].characters[orcCaptainId];
    expect(orcCaptain.controlledBy).toBe('general');
    expect(orcCaptain.influenceUnsubtracted).toBe(true);
    expect(after.players[RESOURCE_PLAYER].characters[indurId].followers).not.toContain(orcCaptainId);
    // Deferred — Orc Captain's mind does not count against general influence
    // this turn.
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

  test('follower not reassigned by the end of the next organization phase is discarded', () => {
    // Aragorn (9) + Elrond (10) already use 19 of the 20-point pool. Beregond
    // (2) was stripped of his controller between organization phases, so his
    // mind was deferred; the organization phase charges it back, putting the
    // player at 21. The player neither reassigns him nor frees room, so on
    // passing he is the one who must go — and *only* he: the rule discards a
    // character that lost direct-influence control before the player gets any
    // choice, even though Aragorn and Elrond are worth far more influence.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, ELROND, BEREGOND] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const beregondId = findCharInstanceId(base, RESOURCE_PLAYER, BEREGOND);
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
          [beregondId as string]: { ...p.characters[beregondId], influenceUnsubtracted: true },
        },
      }) as unknown as typeof base.players,
    });
    expect(flagged.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(19);

    const inOrg = dispatch(flagged, { type: 'untap', player: PLAYER_1 });
    expect(inOrg.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(21);

    const passed = dispatch(inOrg, { type: 'pass', player: PLAYER_1 });
    const offered = viableActions(passed, PLAYER_1, 'influence-overflow-discard');
    expect(offered).toHaveLength(1);
    expect((offered[0].action as { characterInstanceId: CardInstanceId }).characterInstanceId).toBe(beregondId);

    const after = dispatch(passed, { type: 'influence-overflow-discard', player: PLAYER_1, characterInstanceId: beregondId });
    expect(after.players[RESOURCE_PLAYER].characters[beregondId]).toBeUndefined();
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === beregondId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(19);
    expect(after.pendingResolutions.some(r => r.kind.type === 'influence-overflow-discard')).toBe(false);
  });

  test('a follower moved back under direct influence during that phase is not discarded', () => {
    // Same 21-over-20 position, but this time the player uses the organization
    // phase for what the rule asks: Beregond (mind 2) goes back under Aragorn's
    // direct influence (3 available). That takes his mind off the pool, so the
    // phase ends within general influence and nothing is forced.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, ELROND, BEREGOND] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const beregondId = findCharInstanceId(base, RESOURCE_PLAYER, BEREGOND);
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
          [beregondId as string]: { ...p.characters[beregondId], influenceUnsubtracted: true },
        },
      }) as unknown as typeof base.players,
    });

    const inOrg = dispatch(flagged, { type: 'untap', player: PLAYER_1 });
    const reassigned = dispatch(inOrg, {
      type: 'move-to-influence', player: PLAYER_1,
      characterInstanceId: beregondId, controlledBy: aragornId,
    });
    expect(reassigned.players[RESOURCE_PLAYER].characters[beregondId].controlledBy).toBe(aragornId);
    expect(reassigned.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(19);

    const passed = dispatch(reassigned, { type: 'pass', player: PLAYER_1 });
    expect(passed.pendingResolutions.some(r => r.kind.type === 'influence-overflow-discard')).toBe(false);
    expect(passed.players[RESOURCE_PLAYER].characters[beregondId]).toBeDefined();
  });
});
