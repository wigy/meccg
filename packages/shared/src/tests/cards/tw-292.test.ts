/**
 * @module tw-292.test
 *
 * Card test: New Friendship (tw-292)
 * Type: hero-resource-event (short)
 * Effects:
 *   - play-target: character, filter company.containsDiplomat
 *   - play-option "influence-check-boost": when target is diplomat AND player.hasFactionInHand,
 *     add-constraint check-modifier influence value 3
 *   - play-option "corruption-check-boost": when pending.corruptionCheckTargetsMe,
 *     add-constraint check-modifier corruption value 2
 *
 * "Diplomat only. +3 to any one influence check by a diplomat. Alternatively,
 *  +2 to a corruption check by a character in a diplomat's company."
 *
 * Engine support table:
 * | # | Feature                                                          | Status      | Notes                                                           |
 * |---|------------------------------------------------------------------|-------------|-----------------------------------------------------------------|
 * | 1 | "Diplomat only" — play-target: company must contain a diplomat   | IMPLEMENTED | play-target filter company.containsDiplomat                     |
 * | 2 | +3 influence check boost (diplomat, active influence attempt)    | IMPLEMENTED | play-option when target.skills diplomat + hasFactionInHand (chain-only)      |
 * | 3 | +2 corruption check boost for diplomat themselves                | IMPLEMENTED | play-option when pending.corruptionCheckTargetsMe               |
 * | 4 | +2 to any company member's corruption check (non-diplomat too)   | IMPLEMENTED | company.containsDiplomat in context; play-target relaxed        |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, THEODEN, BEREGOND,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, PELARGIR,
  MEN_OF_LEBENNIN,
  handCardId, charIdAt, dispatch, resolveChain,
  buildSitePhaseState, buildInfluenceAttemptChainState, findCharInstanceId, findHandCardId,
  RESOURCE_PLAYER,
  expectInDiscardPile, makeMHState,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, PlayShortEventAction, FactionInfluenceRollAction } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { addConstraint, enqueueResolution } from '../../engine/pending.js';

const NEW_FRIENDSHIP = 'tw-292' as CardDefinitionId;

describe('New Friendship (tw-292)', () => {
  beforeEach(() => resetMint());

  // ── influence-check-boost ─────────────────────────────────────────────────

  test('influence-check-boost: offered during an active influence attempt', () => {
    // New Friendship must be played in response to an active influence check —
    // not speculatively before the attempt is declared.
    const state = buildInfluenceAttemptChainState({
      characters: [LEGOLAS],
      site: PELARGIR,
      hand: [NEW_FRIENDSHIP, MEN_OF_LEBENNIN],
      factionDefId: MEN_OF_LEBENNIN,
    });

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    expect(actions.some(a => a.optionId === 'influence-check-boost')).toBe(true);
  });

  test('influence-check-boost: NOT offered when no faction in hand', () => {
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: PELARGIR,
      hand: [NEW_FRIENDSHIP],
    });

    const viableActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(viableActions).toHaveLength(0);
  });

  test('influence-check-boost: NOT offered before influence attempt is declared (faction in hand)', () => {
    // Regression: hasFactionInHand was true during the site phase whenever the
    // player held a faction card in hand, causing New Friendship to appear playable
    // before any influence check was in progress (game ID mpo1cqve-ltys6m, seq 233).
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: PELARGIR,
      hand: [NEW_FRIENDSHIP, MEN_OF_LEBENNIN],
    });

    const viableActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event'
        && ea.action.optionId === 'influence-check-boost');
    expect(viableActions).toHaveLength(0);
  });

  test('influence-check-boost: NOT offered when no diplomat in company', () => {
    // Aragorn is a warrior/scout/ranger but not a diplomat
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: PELARGIR,
      hand: [NEW_FRIENDSHIP, MEN_OF_LEBENNIN],
    });

    const viableActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(viableActions).toHaveLength(0);
  });

  test('influence-check-boost: playing adds +3 check-modifier influence constraint on the diplomat', () => {
    // Set up an active influence attempt chain so New Friendship is playable
    const state = buildInfluenceAttemptChainState({
      characters: [LEGOLAS],
      site: PELARGIR,
      hand: [NEW_FRIENDSHIP, MEN_OF_LEBENNIN],
      factionDefId: MEN_OF_LEBENNIN,
    });

    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const cardInstance = findHandCardId(state, RESOURCE_PLAYER, NEW_FRIENDSHIP);

    // The boost rides the chain of effects; resolve it (both players pass) so
    // the constraint is applied on resolution — see tw-337 for the regression.
    const after = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetCharacterId: legolasId,
      optionId: 'influence-check-boost',
    }));

    const constraints = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    );
    expect(constraints).toHaveLength(1);
    if (constraints[0].kind.type === 'check-modifier') {
      expect(constraints[0].kind.value).toBe(3);
    }
    expect(constraints[0].target.kind).toBe('character');
    if (constraints[0].target.kind === 'character') {
      expect(constraints[0].target.characterId).toBe(legolasId);
    }
    // Card consumed; faction card is now in the chain
    expect(after.players[0].hand).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, cardInstance);
  });

  test('influence-check-boost: active +3 constraint reduces influence-attempt need', () => {
    // Legolas (DI 2, elf) at Pelargir; Men of Lebennin (inf# 8, no elf bonus).
    // Baseline modifier = DI 2 → need = 8 - 2 = 6.
    // With +3 constraint: modifier = 5 → need = 3.
    const base = buildSitePhaseState({
      characters: [LEGOLAS],
      site: PELARGIR,
      hand: [MEN_OF_LEBENNIN],
    });

    const legolasId = findCharInstanceId(base, RESOURCE_PLAYER, LEGOLAS);

    const boosted = addConstraint(base, {
      source: 'nf-1' as CardInstanceId,
      sourceDefinitionId: NEW_FRIENDSHIP,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: legolasId },
      kind: { type: 'check-modifier', check: 'influence', value: 3 },
    });

    const influenceActions = computeLegalActions(boosted, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt');
    expect(influenceActions.length).toBeGreaterThan(0);
    const attempt = influenceActions[0].action as { need: number };
    // Legolas DI 2, no racial modifier, +3 constraint → need = 8 - 2 - 3 = 3
    expect(attempt.need).toBe(3);
  });

  test('influence-check-boost: +3 constraint is counted in faction-influence-roll pending need', () => {
    // Regression: factionInfluenceRollActions in pending.ts was not consulting
    // activeConstraints, so constraints added during the chain (e.g. by New
    // Friendship) were not reflected in the pending-roll action shown to the
    // player (game mpo1cqve-ltys6m, seq 238).
    const chainState = buildInfluenceAttemptChainState({
      characters: [LEGOLAS],
      site: PELARGIR,
      hand: [MEN_OF_LEBENNIN],
      factionDefId: MEN_OF_LEBENNIN,
    });
    const legolasId = findCharInstanceId(chainState, RESOURCE_PLAYER, LEGOLAS);
    // Simulate New Friendship played during the chain: +3 influence constraint
    const withConstraint = addConstraint(chainState, {
      source: 'nf-1' as CardInstanceId,
      sourceDefinitionId: NEW_FRIENDSHIP,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: legolasId },
      kind: { type: 'check-modifier', check: 'influence', value: 3 },
    });
    // p1 passes chain priority → both players have now passed → chain resolves
    // → faction-influence-roll pending resolution is created
    const pass = computeLegalActions(withConstraint, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'pass-chain-priority',
    );
    if (!pass) throw new Error('Expected p1 to be able to pass chain priority');
    const resolved = dispatch(withConstraint, pass.action);
    // The pending faction-influence-roll action must count the +3 constraint
    const rollActions = computeLegalActions(resolved, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'faction-influence-roll');
    expect(rollActions).toHaveLength(1);
    const rollAction = rollActions[0].action as { need: number };
    // Legolas DI 2, no racial modifier, +3 constraint → need = 8 - 2 - 3 = 3
    expect(rollAction.need).toBe(3);
  });

  test('influence-check-boost: NOT offered during movement-hazard phase even with faction in hand', () => {
    // Regression: hasFactionInHand was true any time the player held a faction
    // card, so New Friendship appeared playable during the movement-hazard phase
    // even though no influence check was in progress (game ID mpk6t3id-kalubb, seq 73).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [LEGOLAS] }],
          hand: [NEW_FRIENDSHIP, MEN_OF_LEBENNIN],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = { ...state, phaseState: makeMHState() };

    const viableActions = computeLegalActions(mhState, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event'
        && ea.action.optionId === 'influence-check-boost');
    expect(viableActions).toHaveLength(0);
  });

  // ── corruption-check-boost ────────────────────────────────────────────────

  test('corruption-check-boost: offered when diplomat has a pending corruption check', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
          hand: [NEW_FRIENDSHIP],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const legolasId = charIdAt(base, RESOURCE_PLAYER);

    // No pending check → not offered
    const noneActions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(noneActions).toHaveLength(0);

    // Enqueue corruption check on Legolas → boost option appears
    const withCheck = enqueueResolution(base, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      kind: {
        type: 'corruption-check',
        characterId: legolasId,
        modifier: 0,
        reason: 'test',
        possessions: [],
        transferredItemId: null,
      },
    });

    const boostActions = computeLegalActions(withCheck, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    expect(boostActions.some(a => a.optionId === 'corruption-check-boost')).toBe(true);
  });

  test('corruption-check-boost: playing adds +2 check-modifier corruption constraint', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
          hand: [NEW_FRIENDSHIP],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const legolasId = charIdAt(base, RESOURCE_PLAYER);
    const cardInstance = handCardId(base, RESOURCE_PLAYER);

    const withCheck = enqueueResolution(base, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      kind: {
        type: 'corruption-check',
        characterId: legolasId,
        modifier: 0,
        reason: 'test',
        possessions: [],
        transferredItemId: null,
      },
    });

    const after = dispatch(withCheck, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetCharacterId: legolasId,
      optionId: 'corruption-check-boost',
    });

    const constraints = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'corruption',
    );
    expect(constraints).toHaveLength(1);
    if (constraints[0].kind.type === 'check-modifier') {
      expect(constraints[0].kind.value).toBe(2);
    }
    // Card consumed; pending check still queued
    expect(after.players[0].hand).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, cardInstance);
    expect(after.pendingResolutions).toHaveLength(1);
    expect(after.pendingResolutions[0].kind.type).toBe('corruption-check');
  });

  test('corruption-check-boost: +2 constraint increases corruptionModifier in the roll action', () => {
    // Legolas has no inherent corruption modifier, so baseline = 0.
    // With +2 constraint the roll action should show corruptionModifier = 2.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      recompute: true,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const legolasId = charIdAt(base, RESOURCE_PLAYER);

    const boosted = addConstraint(base, {
      source: 'nf-1' as CardInstanceId,
      sourceDefinitionId: NEW_FRIENDSHIP,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: legolasId },
      kind: { type: 'check-modifier', check: 'corruption', value: 2 },
    });

    const withCheck = enqueueResolution(boosted, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      kind: {
        type: 'corruption-check',
        characterId: legolasId,
        modifier: 0,
        reason: 'test',
        possessions: [],
        transferredItemId: null,
      },
    });

    const checkActions = computeLegalActions(withCheck, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'corruption-check');
    expect(checkActions).toHaveLength(1);
    const checkAction = checkActions[0].action as { corruptionModifier: number };
    expect(checkAction.corruptionModifier).toBe(2);
  });

  test('influence-check-boost: faction-influence-roll need uses free DI (not full DI) when influencer has followers (game mpo1cqve-ltys6m seq 584)', () => {
    // Regression: factionInfluenceRollActions used charDef.directInfluence (full DI)
    // instead of availableDI (free DI after subtracting follower mind costs).
    //
    // Théoden (DI 3, diplomat) controls Beregond (mind 2) as follower → free DI = 1.
    // Men of Lebennin: influence# 8, no racial bonus (Théoden race "man", not Dúnedain).
    // +3 New Friendship constraint.
    //
    // Correct:  modifier = freeDI(1) + constraint(3) = 4 → need = 8 - 4 = 4
    // With bug: modifier = fullDI(3) + constraint(3) = 6 → need = 8 - 6 = 2
    const base = buildSitePhaseState({
      characters: [{ defId: THEODEN }, { defId: BEREGOND, followerOf: 0 }],
      site: PELARGIR,
      hand: [MEN_OF_LEBENNIN],
    });

    const thodenId = findCharInstanceId(base, RESOURCE_PLAYER, THEODEN);
    const factionInstance = base.players[0].hand.find(c => c.definitionId === MEN_OF_LEBENNIN)!;

    const boosted = addConstraint(base, {
      source: 'nf-1' as CardInstanceId,
      sourceDefinitionId: NEW_FRIENDSHIP,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: thodenId },
      kind: { type: 'check-modifier', check: 'influence', value: 3 },
    });

    // Dispatch influence-attempt with Théoden; resolve chain (both players pass)
    const afterAttempt = dispatch(boosted, {
      type: 'influence-attempt',
      player: PLAYER_1,
      factionInstanceId: factionInstance.instanceId,
      influencingCharacterId: thodenId,
      need: 4,
      explanation: 'test',
    });
    const resolved = resolveChain(afterAttempt);

    // The pending faction-influence-roll must use free DI (1), not full DI (3)
    const rollActions = computeLegalActions(resolved, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'faction-influence-roll')
      .map(ea => ea.action as FactionInfluenceRollAction);
    expect(rollActions).toHaveLength(1);
    // freeDI=1, no racial modifier, +3 constraint → need = 8 - 1 - 3 = 4
    expect(rollActions[0].need).toBe(4);
  });

  // ── broader corruption rule: non-diplomat in diplomat's company ──────────

  test('corruption-check-boost: offered targeting non-diplomat when diplomat is in the same company', () => {
    // Company: Legolas (diplomat) + Aragorn (non-diplomat).
    // Corruption check is on Aragorn. New Friendship should offer
    // corruption-check-boost targeting Aragorn, because Aragorn is in
    // a company that contains a diplomat (Legolas).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS, ARAGORN] }],
          hand: [NEW_FRIENDSHIP],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);

    const withCheck = enqueueResolution(base, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      kind: {
        type: 'corruption-check',
        characterId: aragornId,
        modifier: 0,
        reason: 'test',
        possessions: [],
        transferredItemId: null,
      },
    });

    const boostActions = computeLegalActions(withCheck, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    // corruption-check-boost offered targeting Aragorn (non-diplomat in diplomat company)
    const aragornCorruption = boostActions.filter(
      a => a.optionId === 'corruption-check-boost' && a.targetCharacterId === aragornId,
    );
    expect(aragornCorruption).toHaveLength(1);

    // influence-check-boost NOT offered targeting Aragorn (not a diplomat)
    const aragornInfluence = boostActions.filter(
      a => a.optionId === 'influence-check-boost' && a.targetCharacterId === aragornId,
    );
    expect(aragornInfluence).toHaveLength(0);
  });
});
