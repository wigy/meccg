/**
 * @module tw-189.test
 *
 * Card test: A Friend or Three (tw-189)
 * Type: hero-resource-event (short)
 * Effects:
 *   - play-target: character (any)
 *   - play-option "influence-check-boost": when player.hasFactionInHand,
 *     add-constraint check-modifier influence, valueExpr company.characterCount
 *   - play-option "corruption-check-boost": when pending.corruptionCheckTargetsMe,
 *     add-constraint check-modifier corruption, valueExpr company.characterCount
 *
 * "One influence check or corruption check by a character in a company receives
 *  a +1 modification for each character in his company."
 *
 * Engine support table:
 * | # | Feature                                             | Status      | Notes                                             |
 * |---|-----------------------------------------------------|-------------|---------------------------------------------------|
 * | 1 | Target = any character                              | IMPLEMENTED | play-target character, no filter                  |
 * | 2 | Influence-check-boost during active influence attempt| IMPLEMENTED | when: player.hasFactionInHand (chain-only)         |
 * | 3 | Corruption-check-boost available during CC window   | IMPLEMENTED | when: pending.corruptionCheckTargetsMe            |
 * | 4 | +1 per character in company (valueExpr)             | IMPLEMENTED | valueExpr: company.characterCount, context added  |
 * | 5 | Influence constraint modifies influence-attempt need| IMPLEMENTED | reducer-site.ts reads check-modifier constraints  |
 * | 6 | Corruption constraint modifies corruptionModifier   | IMPLEMENTED | pending.ts reads check-modifier constraints       |
 * | 7 | Constraint consumed after the check                 | IMPLEMENTED | both sites clear until-cleared on resolution      |
 * | 8 | Not playable when no faction and no CC pending      | IMPLEMENTED | no eligible options → not-playable                |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, BILBO,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, PELARGIR,
  MEN_OF_LEBENNIN,
  handCardId, charIdAt, dispatch, resolveChain, findHandCardId,
  buildSitePhaseState, buildInfluenceAttemptChainState, findCharInstanceId, RESOURCE_PLAYER,
  expectInDiscardPile,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, PlayShortEventAction, FreeCouncilPhaseState } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { addConstraint, enqueueResolution } from '../../engine/pending.js';

const A_FRIEND_OR_THREE = 'tw-189' as CardDefinitionId;

describe('A Friend or Three (tw-189)', () => {
  beforeEach(() => resetMint());

  // ── influence-check-boost ────────────────────────────────────────────────

  test('influence-check-boost: offered during an active influence attempt', () => {
    // A Friend or Three must be played in response to an active influence check —
    // not speculatively before the attempt is declared.
    const state = buildInfluenceAttemptChainState({
      characters: [ARAGORN],
      site: PELARGIR,
      hand: [A_FRIEND_OR_THREE, MEN_OF_LEBENNIN],
      factionDefId: MEN_OF_LEBENNIN,
    });

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    expect(actions.some(a => a.optionId === 'influence-check-boost')).toBe(true);
  });

  test('influence-check-boost: not offered when no faction in hand', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: PELARGIR,
      hand: [A_FRIEND_OR_THREE],
    });

    const viableActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(viableActions).toHaveLength(0);
  });

  test('influence-check-boost: constraint value equals company size (solo → +1)', () => {
    // Set up an active influence attempt chain so the card is playable
    const state = buildInfluenceAttemptChainState({
      characters: [ARAGORN],
      site: PELARGIR,
      hand: [A_FRIEND_OR_THREE, MEN_OF_LEBENNIN],
      factionDefId: MEN_OF_LEBENNIN,
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const cardInstance = findHandCardId(state, RESOURCE_PLAYER, A_FRIEND_OR_THREE);

    // The boost rides the chain of effects; resolve it (both players pass) so
    // the constraint is applied on resolution — see tw-337 for the regression.
    const after = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetCharacterId: aragornId,
      optionId: 'influence-check-boost',
    }));

    const constraints = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    );
    expect(constraints).toHaveLength(1);
    if (constraints[0].kind.type === 'check-modifier') {
      expect(constraints[0].kind.value).toBe(1);
    }
    expect(constraints[0].target.kind).toBe('character');
    if (constraints[0].target.kind === 'character') {
      expect(constraints[0].target.characterId).toBe(aragornId);
    }
    // Card consumed from hand; faction card is now in the chain
    expect(after.players[0].hand).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, cardInstance);
  });

  test('influence-check-boost: constraint value equals company size (3-char company → +3)', () => {
    const state = buildInfluenceAttemptChainState({
      characters: [ARAGORN, LEGOLAS, GIMLI],
      site: PELARGIR,
      hand: [A_FRIEND_OR_THREE, MEN_OF_LEBENNIN],
      factionDefId: MEN_OF_LEBENNIN,
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const cardInstance = findHandCardId(state, RESOURCE_PLAYER, A_FRIEND_OR_THREE);

    const after = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetCharacterId: aragornId,
      optionId: 'influence-check-boost',
    }));

    const constraints = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    );
    expect(constraints).toHaveLength(1);
    if (constraints[0].kind.type === 'check-modifier') {
      expect(constraints[0].kind.value).toBe(3);
    }
  });

  test('influence-check-boost: active constraint reduces influence-attempt need', () => {
    // Aragorn (DI 3, Dúnedain) solo at Pelargir, Men of Lebennin (inf# 8, Dúnedain +1).
    // Baseline modifier = DI 3 + Dúnedain +1 = 4 → need = 8 - 4 = 4.
    // With +1 constraint from A Friend or Three: modifier = 5 → need = 3.
    const base = buildSitePhaseState({
      characters: [ARAGORN],
      site: PELARGIR,
      hand: [MEN_OF_LEBENNIN],
    });

    const aragornId = charIdAt(base, RESOURCE_PLAYER);

    const boosted = addConstraint(base, {
      source: 'aft-1' as CardInstanceId,
      sourceDefinitionId: A_FRIEND_OR_THREE,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: aragornId },
      kind: { type: 'check-modifier', check: 'influence', value: 1 },
    });

    const influenceActions = computeLegalActions(boosted, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt');
    expect(influenceActions.length).toBeGreaterThan(0);
    const influenceAction = influenceActions[0].action as { need: number };
    // Baseline need 4, minus +1 constraint = 3
    expect(influenceAction.need).toBe(3);
  });

  test('influence-check-boost: offered during chain after faction card has left hand', () => {
    // Regression: when the influence attempt is declared, the faction card moves from
    // hand into the chain. hasFactionInHand must also be true while that chain entry
    // is live so A Friend or Three remains playable as a boost event.
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: PELARGIR,
      hand: [A_FRIEND_OR_THREE, MEN_OF_LEBENNIN],
    });

    // Declare the influence attempt — Men of Lebennin moves from hand into the chain
    const influenceActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt');
    expect(influenceActions.length).toBeGreaterThan(0);
    const afterDeclare = dispatch(state, influenceActions[0].action);

    // Faction card is no longer in p1's hand
    const factionId = findHandCardId(state, RESOURCE_PLAYER, MEN_OF_LEBENNIN);
    expect(afterDeclare.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === factionId)).toBe(false);
    expect(afterDeclare.chain).not.toBeNull();

    // Hazard player (p2) passes priority to p1
    const afterP2Pass = dispatch(afterDeclare, { type: 'pass-chain-priority', player: PLAYER_2 });
    expect(afterP2Pass.chain?.priority).toBe(PLAYER_1);

    // p1 must be offered influence-check-boost even though faction is now in the chain
    const p1Actions = computeLegalActions(afterP2Pass, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    expect(p1Actions.some(a => a.optionId === 'influence-check-boost')).toBe(true);
  });

  // ── corruption-check-boost ───────────────────────────────────────────────

  test('corruption-check-boost: offered only while a corruption check is pending for the target', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [A_FRIEND_OR_THREE],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = charIdAt(base, RESOURCE_PLAYER);

    // No pending check → card not playable
    const noneActions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(noneActions).toHaveLength(0);

    // Enqueue corruption check on Aragorn → boost option appears
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
    expect(boostActions.some(a => a.optionId === 'corruption-check-boost')).toBe(true);
  });

  test('corruption-check-boost: constraint value equals company size (solo → +1)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [A_FRIEND_OR_THREE],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = charIdAt(base, RESOURCE_PLAYER);
    const cardInstance = handCardId(base, RESOURCE_PLAYER);

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

    const after = dispatch(withCheck, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetCharacterId: aragornId,
      optionId: 'corruption-check-boost',
    });

    const constraints = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'corruption',
    );
    expect(constraints).toHaveLength(1);
    if (constraints[0].kind.type === 'check-modifier') {
      expect(constraints[0].kind.value).toBe(1);
    }
    // Card consumed; pending check still queued
    expect(after.players[0].hand).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, cardInstance);
    expect(after.pendingResolutions).toHaveLength(1);
    expect(after.pendingResolutions[0].kind.type).toBe('corruption-check');
  });

  test('corruption-check-boost: constraint value equals company size (3-char company → +3)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS, GIMLI] }],
          hand: [A_FRIEND_OR_THREE],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [BILBO] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = charIdAt(base, RESOURCE_PLAYER);
    const cardInstance = handCardId(base, RESOURCE_PLAYER);

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

    const after = dispatch(withCheck, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetCharacterId: aragornId,
      optionId: 'corruption-check-boost',
    });

    const constraints = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'corruption',
    );
    expect(constraints).toHaveLength(1);
    if (constraints[0].kind.type === 'check-modifier') {
      expect(constraints[0].kind.value).toBe(3);
    }
  });

  test('corruption-check-boost: constraint increases corruptionModifier in the pending roll action', () => {
    // Aragorn has no inherent corruption check modifier, so baseline corruptionModifier = 0.
    // With +1 constraint (solo company), the corruption-check action carries corruptionModifier = 1.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      recompute: true,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = charIdAt(base, RESOURCE_PLAYER);

    const boosted = addConstraint(base, {
      source: 'aft-1' as CardInstanceId,
      sourceDefinitionId: A_FRIEND_OR_THREE,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: aragornId },
      kind: { type: 'check-modifier', check: 'corruption', value: 1 },
    });

    const withCheck = enqueueResolution(boosted, {
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

    const checkActions = computeLegalActions(withCheck, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'corruption-check');
    expect(checkActions).toHaveLength(1);
    const checkAction = checkActions[0].action as { corruptionModifier: number };
    // Aragorn base modifier 0 + constraint +1 = 1
    expect(checkAction.corruptionModifier).toBe(1);
  });

  test('corruption-check-boost constraint is consumed after the corruption check resolves', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      recompute: true,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = charIdAt(base, RESOURCE_PLAYER);

    const boosted = addConstraint(base, {
      source: 'aft-1' as CardInstanceId,
      sourceDefinitionId: A_FRIEND_OR_THREE,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: aragornId },
      kind: { type: 'check-modifier', check: 'corruption', value: 1 },
    });

    const withCheck = enqueueResolution(boosted, {
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

    // Force a high roll so the check passes
    const stateWithCheat = { ...withCheck, cheatRollTotal: 12 };

    const checkActions = computeLegalActions(stateWithCheat, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'corruption-check');
    expect(checkActions).toHaveLength(1);

    const state = dispatch(stateWithCheat, checkActions[0].action);
    expect(state.activeConstraints.filter(c => c.kind.type === 'check-modifier')).toHaveLength(0);
  });

  test('corruption-check-boost: playing the card during a Free Council pending check applies the constraint (regression)', () => {
    // Regression: the Free Council reducer used to route every play-short-event
    // unconditionally to the hazard-event handler (handlePlayShortEvent), which
    // silently discarded resource events like A Friend or Three without ever
    // reading their targetCharacterId/optionId or applying the check-modifier
    // constraint — even though the action was correctly offered as legal (CoE
    // 10.3.i / 7.1.1). See bug report: "No playing of support cards for
    // corruption checks during the council (such as A Friend or Three) possible".
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [A_FRIEND_OR_THREE], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const aragornId = charIdAt(base, RESOURCE_PLAYER);
    const cardInstance = handCardId(base, RESOURCE_PLAYER);

    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck: {
        characterId: aragornId,
        corruptionPoints: 0,
        corruptionModifier: 0,
        possessions: [],
        need: 1,
        explanation: 'test',
        supportCount: 0,
      },
    };
    const state = { ...base, phaseState: fcState };

    const after = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetCharacterId: aragornId,
      optionId: 'corruption-check-boost',
    });

    const constraints = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'corruption',
    );
    expect(constraints).toHaveLength(1);
    if (constraints[0].kind.type === 'check-modifier') {
      expect(constraints[0].kind.value).toBe(1);
    }
    // Card consumed; the Free Council pending check stays open until pass.
    expect(after.players[0].hand).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, cardInstance);
    expect((after.phaseState as FreeCouncilPhaseState).pendingCheck).not.toBeNull();
  });

  test('corruption-check-boost: playing the card during the untap phase applies the constraint (regression)', () => {
    // Regression: an any-phase grant-action (e.g. Magical Harp td-130) can
    // enqueue a corruption-check resolution mid-untap-phase. handleUntap only
    // recognized 'pass', 'untap', 'activate-granted-action', and the
    // hazard-sideboard actions — any other action type (including
    // play-short-event) was rejected as "wrong action type", so a reactive
    // corruption-check-boost play left the check — and the whole untap phase —
    // stuck forever. See bug report: "doesn't get out of untap phase" (game
    // mthc4u90-sgd13r, turn 8).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [A_FRIEND_OR_THREE], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const aragornId = charIdAt(base, RESOURCE_PLAYER);
    const cardInstance = handCardId(base, RESOURCE_PLAYER);

    const withCheck = enqueueResolution(base, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Untap },
      kind: {
        type: 'corruption-check',
        characterId: aragornId,
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
      targetCharacterId: aragornId,
      optionId: 'corruption-check-boost',
    });

    const constraints = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'corruption',
    );
    expect(constraints).toHaveLength(1);
    if (constraints[0].kind.type === 'check-modifier') {
      expect(constraints[0].kind.value).toBe(1);
    }
    // Card consumed; the pending corruption check stays open until resolved.
    expect(after.players[0].hand).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, cardInstance);
    expect(after.pendingResolutions).toHaveLength(1);
    expect(after.pendingResolutions[0].kind.type).toBe('corruption-check');
  });
});
