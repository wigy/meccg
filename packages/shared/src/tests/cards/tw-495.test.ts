/**
 * @module tw-495.test
 *
 * Card test: Fatty Bolger (tw-495)
 * Type: hero-character
 * Effects: 3
 *
 * "Unique. Unless he is one of the starting characters, he may only be
 * brought into play at his home site. All of his corruption checks are
 * modified by +1. He can tap to cancel a strike against another Hobbit
 * in his company."
 *
 * Tests:
 * 1. check-modifier: +1 to corruption checks (base corruptionModifier)
 * 2. play-restriction: home-site-only (can only be played at Bag End, not havens)
 * 3. cancel-strike: tap to cancel a strike against another hobbit in company
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, BILBO, FATTY_BOLGER,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  ORC_PATROL,
  GLAMDRING,
  Phase,
  buildTestState, resetMint, makeMHState,
  findCharInstanceId, viablePlayCharacterActions,
  enqueueTransferCorruptionCheck,
  getCharacter,
  handCardId, companyIdAt, charIdAt, dispatch, resolveChain,
  actionAs,
} from '../test-helpers.js';
import { computeLegalActions, BAG_END, SiteType } from '../../index.js';
import type { CorruptionCheckAction, CancelStrikeAction, SupportStrikeAction } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Fatty Bolger (tw-495)', () => {
  beforeEach(() => resetMint());

  // ── Card definition ───────────────────────────────────────────────────


  // ── Effect 1: check-modifier (corruption +1) ─────────────────────────


  test('+1 corruption modifier lowers need on pending corruption check', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BAG_END, characters: [{ defId: FATTY_BOLGER, items: [GLAMDRING] }, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const fattyId = findCharInstanceId(state, 0, FATTY_BOLGER);
    const glamdringInstId = getCharacter(state, 0, FATTY_BOLGER).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, fattyId, glamdringInstId);

    const actions = computeLegalActions(stateWithCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions.length).toBe(1);
    expect(ccActions[0].characterId).toBe(fattyId);
    expect(ccActions[0].corruptionModifier).toBe(1);
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - 1);
  });

  // ── Effect 2: play-restriction (home-site-only) ───────────────────────

  test('can be played at homesite Bag End', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [FATTY_BOLGER],
          siteDeck: [BAG_END, MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viablePlayCharacterActions(state, PLAYER_1);
    const fattyActions = actions.filter(a => {
      const siteDef = state.cardPool[
        state.players[0].siteDeck.find(c => c.instanceId === a.atSite)?.definitionId as string
      ];
      return siteDef && 'name' in siteDef && siteDef.name === 'Bag End';
    });
    expect(fattyActions.length).toBeGreaterThanOrEqual(1);
  });

  test('cannot be played at a haven (home-site-only restriction)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [FATTY_BOLGER],
          siteDeck: [RIVENDELL, MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viablePlayCharacterActions(state, PLAYER_1);
    expect(actions.length).toBe(0);
  });

  test('can join a company already at Bag End', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BAG_END, characters: [LEGOLAS] }],
          hand: [FATTY_BOLGER],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viablePlayCharacterActions(state, PLAYER_1);
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  // ── Effect 3: cancel-strike (tap to cancel strike against hobbit) ─────

  test('can tap to cancel a strike against another hobbit in company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [FATTY_BOLGER, BILBO, LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [ORC_PATROL],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    const orcPatrolId = handCardId(gameState, 1);
    const companyId = companyIdAt(gameState, 0);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: orcPatrolId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'ruins-and-lairs' },
    });
    const afterChain = resolveChain(afterPlay);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.phase).toBe('assign-strikes');

    // Defender assigns a strike to Bilbo (hobbit)
    const bilboId = charIdAt(afterChain, 0, 0, 1);
    const r2 = dispatch(afterChain, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: bilboId,
      tapped: false,
    });

    // Assign remaining strikes to other characters
    const fattyId = charIdAt(afterChain, 0, 0, 0);
    const legolasId = charIdAt(afterChain, 0, 0, 2);
    const r3 = dispatch(r2, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: fattyId,
      tapped: false,
    });
    const r4 = dispatch(r3, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: legolasId,
      tapped: false,
    });

    // All strikes assigned, should go to choose-strike-order or resolve-strike
    expect(r4.combat!.phase).toBe('choose-strike-order');

    // Choose Bilbo's strike to resolve first
    const bilboStrikeIdx = r4.combat!.strikeAssignments.findIndex(
      sa => sa.characterId === bilboId,
    );
    const r5 = dispatch(r4, {
      type: 'choose-strike-order',
      player: PLAYER_1,
      strikeIndex: bilboStrikeIdx,
    });
    expect(r5.combat!.phase).toBe('resolve-strike');

    // Now Fatty should have cancel-strike option (Bilbo is a hobbit)
    const defActions = computeLegalActions(r5, PLAYER_1);
    const cancelStrikeActions = defActions.filter(
      a => a.viable && a.action.type === 'cancel-strike',
    );
    expect(cancelStrikeActions.length).toBe(1);
    expect(actionAs<CancelStrikeAction>(cancelStrikeActions[0].action).cancellerInstanceId).toBe(fattyId);
    expect(actionAs<CancelStrikeAction>(cancelStrikeActions[0].action).targetCharacterId).toBe(bilboId);

    // Execute cancel-strike
    const r6 = dispatch(r5, cancelStrikeActions[0].action);

    // Fatty should be tapped
    expect(r6.players[0].characters[fattyId as string].status).toBe('tapped');
    // Bilbo's strike should be resolved (canceled)
    const bilboStrike = r6.combat!.strikeAssignments.find(sa => sa.characterId === bilboId);
    expect(bilboStrike!.resolved).toBe(true);
    expect(bilboStrike!.result).toBe('canceled');
  });

  test('cannot cancel a strike against a non-hobbit', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [FATTY_BOLGER, LEGOLAS, BILBO] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [ORC_PATROL],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    const orcPatrolId = handCardId(gameState, 1);
    const companyId = companyIdAt(gameState, 0);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: orcPatrolId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'ruins-and-lairs' },
    });
    const afterChain = resolveChain(afterPlay);

    // Assign all 3 strikes (3 characters, 3 strikes — one each)
    const fattyId = charIdAt(afterChain, 0, 0, 0);
    const legolasId = charIdAt(afterChain, 0, 0, 1);
    const bilboId = charIdAt(afterChain, 0, 0, 2);
    const r2 = dispatch(afterChain, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: legolasId,
      tapped: false,
    });
    const r3 = dispatch(r2, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: fattyId,
      tapped: false,
    });
    const r4 = dispatch(r3, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: bilboId,
      tapped: false,
    });
    expect(r4.combat!.phase).toBe('choose-strike-order');

    // Choose Legolas's strike to resolve first
    const legolasStrikeIdx = r4.combat!.strikeAssignments.findIndex(
      sa => sa.characterId === legolasId,
    );
    const r5 = dispatch(r4, {
      type: 'choose-strike-order',
      player: PLAYER_1,
      strikeIndex: legolasStrikeIdx,
    });

    // Fatty should NOT have cancel-strike option (Legolas is an elf)
    const defActions = computeLegalActions(r5, PLAYER_1);
    const cancelStrikeActions = defActions.filter(
      a => a.viable && a.action.type === 'cancel-strike',
    );
    expect(cancelStrikeActions.length).toBe(0);
  });

  test('cannot cancel own strike', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [FATTY_BOLGER, BILBO, LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [ORC_PATROL],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    const orcPatrolId = handCardId(gameState, 1);
    const companyId = companyIdAt(gameState, 0);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: orcPatrolId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'ruins-and-lairs' },
    });
    const afterChain = resolveChain(afterPlay);

    // Assign all 3 strikes
    const fattyId = charIdAt(afterChain, 0, 0, 0);
    const bilboId = charIdAt(afterChain, 0, 0, 1);
    const legolasId = charIdAt(afterChain, 0, 0, 2);
    const r2 = dispatch(afterChain, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: fattyId,
      tapped: false,
    });
    const r3 = dispatch(r2, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: bilboId,
      tapped: false,
    });
    const r4 = dispatch(r3, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: legolasId,
      tapped: false,
    });
    expect(r4.combat!.phase).toBe('choose-strike-order');

    // Choose Fatty's own strike to resolve
    const fattyStrikeIdx = r4.combat!.strikeAssignments.findIndex(
      sa => sa.characterId === fattyId,
    );
    const r5 = dispatch(r4, {
      type: 'choose-strike-order',
      player: PLAYER_1,
      strikeIndex: fattyStrikeIdx,
    });

    // Fatty cannot cancel his own strike (target: other-in-company skips self).
    // Bilbo doesn't have cancel-strike, so no cancel-strike actions at all.
    const defActions = computeLegalActions(r5, PLAYER_1);
    const cancelStrikeActions = defActions.filter(
      a => a.viable && a.action.type === 'cancel-strike',
    );
    expect(cancelStrikeActions.length).toBe(0);
  });

  test('offers both support-strike and cancel-strike when resolving another hobbit strike', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [FATTY_BOLGER, BILBO, LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [ORC_PATROL],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    const orcPatrolId = handCardId(gameState, 1);
    const companyId = companyIdAt(gameState, 0);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: orcPatrolId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'ruins-and-lairs' },
    });
    const afterChain = resolveChain(afterPlay);

    const bilboId = charIdAt(afterChain, 0, 0, 1);
    const legolasId = charIdAt(afterChain, 0, 0, 2);

    // Assign strikes to Bilbo and Legolas only — leave Fatty unassigned so he can support/cancel
    const r2 = dispatch(afterChain, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: bilboId,
      tapped: false,
    });
    const r3 = dispatch(r2, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: legolasId,
      tapped: false,
    });

    // Choose Bilbo's strike to resolve first
    const bilboStrikeIdx = r3.combat!.strikeAssignments.findIndex(
      sa => sa.characterId === bilboId,
    );
    const r4 = dispatch(r3, {
      type: 'choose-strike-order',
      player: PLAYER_1,
      strikeIndex: bilboStrikeIdx,
    });
    expect(r4.combat!.phase).toBe('resolve-strike');

    const fattyId = charIdAt(afterChain, 0, 0, 0);
    const defActions = computeLegalActions(r4, PLAYER_1);

    const supportActions = defActions.filter(
      a => a.viable && a.action.type === 'support-strike'
        && actionAs<SupportStrikeAction>(a.action).supportingCharacterId === fattyId,
    );
    const cancelActions = defActions.filter(
      a => a.viable && a.action.type === 'cancel-strike'
        && actionAs<CancelStrikeAction>(a.action).cancellerInstanceId === fattyId,
    );

    expect(supportActions.length).toBe(1);
    expect(cancelActions.length).toBe(1);
  });
});
