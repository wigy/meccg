/**
 * @module tw-293.test
 *
 * Card test: Old Friendship (tw-293)
 * Type: hero-resource-event (short)
 * Effects:
 *   - play-target: character, filter company.containsDiplomat
 *   - play-option "influence-check-boost": when target is a diplomat, adds a
 *     one-shot +5 influence check-modifier gated (`constraintWhen`) to an
 *     opponent-influence attempt against a character
 *   - play-option "corruption-check-boost": when pending.corruptionCheckTargetsMe,
 *     add-constraint check-modifier corruption value 4
 *
 * "Diplomat only. +5 to an influence check against a character by a diplomat.
 *  Alternatively, +4 to a corruption check by a character in a diplomat's company."
 *
 * Old Friendship is the sibling of New Friendship (tw-292), sharing the same
 * "Diplomat only" company-scoped play-target and the reactive corruption-check
 * boost shape. It differs in the influence clause: New Friendship boosts "any
 * one influence check" (an ordinary faction-influence attempt), whereas Old
 * Friendship boosts specifically "an influence check against a character" — the
 * opponent-influence-check path (CoE rule 8), modeled with the same
 * `constraintWhen` gating shape as Mine or No One's (ba-68).
 *
 * Engine support table:
 * | # | Feature                                                          | Status      | Notes                                                    |
 * |---|-------------------------------------------------------------------|-------------|-----------------------------------------------------------|
 * | 1 | "Diplomat only" — play-target: company must contain a diplomat  | IMPLEMENTED | play-target filter company.containsDiplomat                |
 * | 2 | +5 influence boost applies to opponent-influence vs a character | IMPLEMENTED | constraintWhen reason opponent-influence-check + kind    |
 * | 3 | +5 boost does NOT apply vs an ally or a faction                  | IMPLEMENTED | constraintWhen target.kind gate                          |
 * | 4 | +4 corruption boost for the diplomat themselves                 | IMPLEMENTED | play-option when pending.corruptionCheckTargetsMe        |
 * | 5 | +4 corruption boost for any company member (non-diplomat too)   | IMPLEMENTED | company.containsDiplomat in context; play-target relaxed |
 *
 * Fixtures:
 *   LEGOLAS (tw-95)  - elf, skills [warrior, diplomat], DI 2 — the diplomat
 *   ARAGORN (tw-95?) - man, warrior/ranger, not a diplomat — company mate / opponent target
 *   GWAIHIR          - hero ally (mind 4)
 *   WOOD_ELVES       - hero faction (influence# 9)
 *   MORIA            - ruins-and-lairs site shared by both companies
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, GWAIHIR, WOOD_ELVES,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, THRANDUILS_HALLS,
  attachAllyToChar, addCardInPlay,
  charIdAt, findCharInstanceId, handCardId,
  dispatch, dispatchResult, resolveChain, makeSitePhase,
  firstOpponentInfluenceAttempt,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, GameState, PlayShortEventAction } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { addConstraint, enqueueResolution } from '../../engine/pending.js';

const OLD_FRIENDSHIP = 'tw-293' as CardDefinitionId;

describe('Old Friendship (tw-293)', () => {
  beforeEach(() => resetMint());

  // ── "Diplomat only" — structural play-target gating ────────────────────────

  test('not offered at all when the company has no diplomat', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [OLD_FRIENDSHIP],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const viableActions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(viableActions).toHaveLength(0);

    const notPlayable = computeLegalActions(base, PLAYER_1)
      .filter(ea => !ea.viable && ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId === handCardId(base, RESOURCE_PLAYER));
    expect(notPlayable.length).toBeGreaterThan(0);
  });

  test('influence-check-boost: NOT offered targeting a non-diplomat company mate', () => {
    // Company: Legolas (diplomat) + Aragorn (non-diplomat). Only Legolas
    // qualifies for the influence-check-boost option.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [LEGOLAS, ARAGORN] }], hand: [OLD_FRIENDSHIP], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const state = { ...base, turnNumber: 3, phaseState: makeSitePhase() };
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    expect(actions.filter(a => a.optionId === 'influence-check-boost' && a.targetCharacterId === aragornId)).toHaveLength(0);
    expect(actions.some(a => a.optionId === 'influence-check-boost')).toBe(true);
  });

  // ── influence-check-boost ────────────────────────────────────────────────

  test('playing influence-check-boost adds a +5 gated opponent-influence check-modifier on the diplomat', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [LEGOLAS] }], hand: [OLD_FRIENDSHIP], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const state = { ...base, turnNumber: 3, phaseState: makeSitePhase() };
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const cardInstance = handCardId(state, RESOURCE_PLAYER);

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
    const k = constraints[0].kind;
    expect(k.type).toBe('check-modifier');
    if (k.type === 'check-modifier') {
      expect(k.value).toBe(5);
      // Must be gated to opponent-influence — not a bare (faction-only) booster.
      expect(k.when).toBeDefined();
    }
    expect(constraints[0].target.kind).toBe('character');
    if (constraints[0].target.kind === 'character') {
      expect(constraints[0].target.characterId).toBe(legolasId);
    }
    expect(after.players[0].hand).toHaveLength(0);
  });

  test('+5 applies to an opponent-influence attempt against a character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [LEGOLAS] }], hand: [OLD_FRIENDSHIP], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const state = { ...base, turnNumber: 3, phaseState: makeSitePhase() };
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const cardInstance = handCardId(state, RESOURCE_PLAYER);

    const boosted = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetCharacterId: legolasId,
      optionId: 'influence-check-boost',
    }));

    const aragornId = findCharInstanceId(boosted, HAZARD_PLAYER, ARAGORN);
    const attempt = firstOpponentInfluenceAttempt(boosted, aragornId);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('character');

    const result = dispatchResult(boosted, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no opponent-influence-defend pending');
    expect(pending.kind.attempt.boostModifier).toBe(5);
    // The one-shot constraint is consumed by the attempt.
    expect(result.state.activeConstraints.some(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    )).toBe(false);
  });

  test('+5 does NOT apply to an opponent-influence attempt against an ally', () => {
    let state: GameState = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [LEGOLAS] }], hand: [OLD_FRIENDSHIP], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    state = { ...state, turnNumber: 3, phaseState: makeSitePhase() };
    state = attachAllyToChar(state, HAZARD_PLAYER, ARAGORN, GWAIHIR);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const cardInstance = handCardId(state, RESOURCE_PLAYER);

    const boosted = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetCharacterId: legolasId,
      optionId: 'influence-check-boost',
    }));

    const aragornId = findCharInstanceId(boosted, HAZARD_PLAYER, ARAGORN);
    const allyId = boosted.players[HAZARD_PLAYER].characters[aragornId].allies[0].instanceId;
    const attempt = firstOpponentInfluenceAttempt(boosted, allyId);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('ally');

    const result = dispatchResult(boosted, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no opponent-influence-defend pending');
    expect(pending.kind.attempt.boostModifier ?? 0).toBe(0);
    // The constraint is left in place for a qualifying (character) attempt.
    expect(result.state.activeConstraints.some(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    )).toBe(true);
  });

  test('+5 does NOT apply to an opponent-influence attempt against a faction', () => {
    let state: GameState = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: THRANDUILS_HALLS, characters: [LEGOLAS] }], hand: [OLD_FRIENDSHIP], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: THRANDUILS_HALLS, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    state = { ...state, turnNumber: 3, phaseState: makeSitePhase() };
    state = addCardInPlay(state, HAZARD_PLAYER, WOOD_ELVES);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const cardInstance = handCardId(state, RESOURCE_PLAYER);

    const boosted = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetCharacterId: legolasId,
      optionId: 'influence-check-boost',
    }));

    const factionId = boosted.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === WOOD_ELVES)!.instanceId;
    const attempt = firstOpponentInfluenceAttempt(boosted, factionId);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('faction');

    const result = dispatchResult(boosted, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no opponent-influence-defend pending');
    expect(pending.kind.attempt.boostModifier ?? 0).toBe(0);
  });

  // ── corruption-check-boost ────────────────────────────────────────────────

  test('corruption-check-boost: offered when the diplomat has a pending corruption check', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [OLD_FRIENDSHIP], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const legolasId = charIdAt(base, RESOURCE_PLAYER);

    // No pending check → corruption-check-boost not offered. (The
    // influence-check-boost option is offered proactively — like Mine or No
    // One's ba-68 — since it does not depend on an active check.)
    const noneActions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.optionId === 'corruption-check-boost');
    expect(noneActions).toHaveLength(0);

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

  test('corruption-check-boost: playing adds a +4 check-modifier corruption constraint', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [OLD_FRIENDSHIP], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
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
      expect(constraints[0].kind.value).toBe(4);
    }
    expect(after.players[0].hand).toHaveLength(0);
    expect(after.pendingResolutions).toHaveLength(1);
    expect(after.pendingResolutions[0].kind.type).toBe('corruption-check');
  });

  test('corruption-check-boost: +4 constraint increases corruptionModifier in the roll action', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      recompute: true,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const legolasId = charIdAt(base, RESOURCE_PLAYER);

    const boosted = addConstraint(base, {
      source: 'of-1' as CardInstanceId,
      sourceDefinitionId: OLD_FRIENDSHIP,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: legolasId },
      kind: { type: 'check-modifier', check: 'corruption', value: 4 },
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
    expect(checkAction.corruptionModifier).toBe(4);
  });

  test('corruption-check-boost: offered targeting a non-diplomat company mate of the diplomat', () => {
    // Company: Legolas (diplomat) + Aragorn (non-diplomat). Corruption check
    // is on Aragorn — the boost should still be offered since Aragorn is in a
    // company that contains a diplomat.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS, ARAGORN] }], hand: [OLD_FRIENDSHIP], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
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

    const aragornCorruption = boostActions.filter(
      a => a.optionId === 'corruption-check-boost' && a.targetCharacterId === aragornId,
    );
    expect(aragornCorruption).toHaveLength(1);

    const aragornInfluence = boostActions.filter(
      a => a.optionId === 'influence-check-boost' && a.targetCharacterId === aragornId,
    );
    expect(aragornInfluence).toHaveLength(0);
  });
});
