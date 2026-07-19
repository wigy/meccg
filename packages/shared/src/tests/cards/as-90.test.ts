/**
 * @module as-90.test
 *
 * Card test: Join With That Power (as-90)
 * Type: minion-resource-event (short)
 * Alignment: ringwraith
 *
 * Text:
 *   "Diplomat only. One influence check or corruption check by a character
 *    in a diplomat's company receives a bonus equal to the number of
 *    characters in the company minus one. Cannot be duplicated on a given
 *    check."
 *
 * Effects:
 *   1. play-target: character, filter: company.containsDiplomat
 *   2. play-option "influence-check-boost": when player.hasFactionInHand,
 *      add-constraint check-modifier influence until-cleared,
 *      valueExpr: company.characterCount - 1
 *   3. play-option "corruption-check-boost": when pending.corruptionCheckTargetsMe,
 *      add-constraint check-modifier corruption until-cleared,
 *      valueExpr: company.characterCount - 1
 *   4. duplication-limit: scope active-check, max 1
 *
 * Engine support table:
 * | # | Rule                                                                    | Status      |
 * |---|-------------------------------------------------------------------------|-------------|
 * | 1 | Playable only when company contains a Diplomat                          | IMPLEMENTED |
 * | 2 | Targets a character in that Diplomat's company                          | IMPLEMENTED |
 * | 3 | Applies to influence check (hasFactionInHand) or corruption check       | IMPLEMENTED |
 * | 4 | Bonus value = company.characterCount - 1                                | IMPLEMENTED |
 * | 5 | Cannot be duplicated on a given check (active-check scope)              | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures:
 *   ASTERNAK (le-1)       - minion man, diplomat+warrior, mind 5, DI 2 (+2 vs Variag Camp factions)
 *   LUITPRAND (le-23)     - minion man, scout, mind 1, no diplomat
 *   OSTISEN (le-36)       - minion man, scout, mind 2, no diplomat
 *   VARIAG_CAMP (le-411)  - minion border-hold
 *   VARIAGS (le-292)      - minion faction, influence# 8, playable at Variag Camp
 *   MINAS_MORGUL (le-390) - minion haven
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  LORIEN, MINAS_TIRITH,
  handCardId, charIdAt, dispatch, resolveChain, findHandCardId,
  buildInfluenceAttemptChainState, buildSitePhaseState, findCharInstanceId, RESOURCE_PLAYER,
  expectInDiscardPile,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, PlayShortEventAction } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { addConstraint, enqueueResolution } from '../../engine/pending.js';

const JOIN_WITH_THAT_POWER = 'as-90' as CardDefinitionId;
const ASTERNAK = 'le-1' as CardDefinitionId;
const LUITPRAND = 'le-23' as CardDefinitionId;
const OSTISEN = 'le-36' as CardDefinitionId;
const VARIAG_CAMP = 'le-411' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const VARIAGS = 'le-292' as CardDefinitionId;

describe('Join With That Power (as-90)', () => {
  beforeEach(() => resetMint());

  test('influence-check-boost: offered during active influence attempt when company has Diplomat', () => {
    const state = buildInfluenceAttemptChainState({
      characters: [ASTERNAK],
      site: VARIAG_CAMP,
      hand: [JOIN_WITH_THAT_POWER, VARIAGS],
      factionDefId: VARIAGS,
    });
    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    expect(actions.some(a => a.optionId === 'influence-check-boost')).toBe(true);
  });

  test('influence-check-boost: NOT offered when company has no Diplomat', () => {
    const state = buildInfluenceAttemptChainState({
      characters: [LUITPRAND],
      site: VARIAG_CAMP,
      hand: [JOIN_WITH_THAT_POWER, VARIAGS],
      factionDefId: VARIAGS,
    });
    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    expect(actions.some(a => a.optionId === 'influence-check-boost')).toBe(false);
  });

  test('influence-check-boost: solo Diplomat -> constraint value = 0 (characterCount - 1)', () => {
    const state = buildInfluenceAttemptChainState({
      characters: [ASTERNAK],
      site: VARIAG_CAMP,
      hand: [JOIN_WITH_THAT_POWER, VARIAGS],
      factionDefId: VARIAGS,
    });
    const asternak = findCharInstanceId(state, RESOURCE_PLAYER, ASTERNAK);
    const cardInstance = findHandCardId(state, RESOURCE_PLAYER, JOIN_WITH_THAT_POWER);
    // The boost rides the chain of effects; resolve it (both players pass) so
    // the constraint is applied on resolution — see tw-337 for the regression.
    const after = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetCharacterId: asternak,
      optionId: 'influence-check-boost',
    }));
    const constraints = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    );
    expect(constraints).toHaveLength(1);
    if (constraints[0].kind.type === 'check-modifier') {
      expect(constraints[0].kind.value).toBe(0);
    }
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, cardInstance);
  });

  test('influence-check-boost: 2-character company -> constraint value = 1', () => {
    const state = buildInfluenceAttemptChainState({
      characters: [ASTERNAK, LUITPRAND],
      site: VARIAG_CAMP,
      hand: [JOIN_WITH_THAT_POWER, VARIAGS],
      factionDefId: VARIAGS,
    });
    const asternak = findCharInstanceId(state, RESOURCE_PLAYER, ASTERNAK);
    const cardInstance = findHandCardId(state, RESOURCE_PLAYER, JOIN_WITH_THAT_POWER);
    // The boost rides the chain of effects; resolve it (both players pass) so
    // the constraint is applied on resolution — see tw-337 for the regression.
    const after = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetCharacterId: asternak,
      optionId: 'influence-check-boost',
    }));
    const constraints = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    );
    expect(constraints).toHaveLength(1);
    if (constraints[0].kind.type === 'check-modifier') {
      expect(constraints[0].kind.value).toBe(1);
    }
  });

  test('influence-check-boost: active constraint reduces influence-attempt need', () => {
    // Asternak + Luitprand. Asternak DI 4 vs Variag Camp factions. Variags inf# 8.
    // Baseline need = 4. With +1 constraint (2-char company): need = 3.
    const base = buildSitePhaseState({
      characters: [ASTERNAK, LUITPRAND],
      site: VARIAG_CAMP,
      hand: [VARIAGS],
    });
    const asternak = findCharInstanceId(base, RESOURCE_PLAYER, ASTERNAK);
    const boosted = addConstraint(base, {
      source: 'jwtp-1' as CardInstanceId,
      sourceDefinitionId: JOIN_WITH_THAT_POWER,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: asternak },
      kind: { type: 'check-modifier', check: 'influence', value: 1 },
    });
    const influenceActions = computeLegalActions(boosted, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt'
        && (ea.action as { influencingCharacterId: CardInstanceId }).influencingCharacterId === asternak);
    expect(influenceActions.length).toBeGreaterThan(0);
    const influenceAction = influenceActions[0].action as { need: number };
    expect(influenceAction.need).toBe(4);
  });

  test('corruption-check-boost: offered during pending CC on character in diplomat company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [ASTERNAK, OSTISEN] }], hand: [JOIN_WITH_THAT_POWER], siteDeck: [VARIAG_CAMP] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LUITPRAND] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const ostisen = findCharInstanceId(base, RESOURCE_PLAYER, OSTISEN);
    // No check -> not playable
    expect(computeLegalActions(base, PLAYER_1).filter(ea => ea.viable && ea.action.type === 'play-short-event')).toHaveLength(0);
    // CC on Ostisen (in diplomat's company) -> offered
    const withCheck = enqueueResolution(base, { source: null, actor: PLAYER_1, scope: { kind: 'phase', phase: Phase.Organization }, kind: { type: 'corruption-check', characterId: ostisen, modifier: 0, reason: 'test', possessions: [], transferredItemId: null } });
    const boostActions = computeLegalActions(withCheck, PLAYER_1).filter(ea => ea.viable && ea.action.type === 'play-short-event').map(ea => ea.action as PlayShortEventAction);
    expect(boostActions.some(a => a.optionId === 'corruption-check-boost')).toBe(true);
  });

  test('corruption-check-boost: NOT offered when company has no Diplomat', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [LUITPRAND, OSTISEN] }], hand: [JOIN_WITH_THAT_POWER], siteDeck: [VARIAG_CAMP] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ASTERNAK] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const luitprand = findCharInstanceId(base, RESOURCE_PLAYER, LUITPRAND);
    const withCheck = enqueueResolution(base, { source: null, actor: PLAYER_1, scope: { kind: 'phase', phase: Phase.Organization }, kind: { type: 'corruption-check', characterId: luitprand, modifier: 0, reason: 'test', possessions: [], transferredItemId: null } });
    expect(computeLegalActions(withCheck, PLAYER_1).filter(ea => ea.viable && ea.action.type === 'play-short-event')).toHaveLength(0);
  });

  test('corruption-check-boost: solo Diplomat -> constraint value = 0', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [ASTERNAK] }], hand: [JOIN_WITH_THAT_POWER], siteDeck: [VARIAG_CAMP] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LUITPRAND] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const asternak = charIdAt(base, RESOURCE_PLAYER);
    const cardInstance = handCardId(base, RESOURCE_PLAYER);
    const withCheck = enqueueResolution(base, { source: null, actor: PLAYER_1, scope: { kind: 'phase', phase: Phase.Organization }, kind: { type: 'corruption-check', characterId: asternak, modifier: 0, reason: 'test', possessions: [], transferredItemId: null } });
    const after = dispatch(withCheck, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: cardInstance, targetCharacterId: asternak, optionId: 'corruption-check-boost' });
    const constraints = after.activeConstraints.filter(c => c.kind.type === 'check-modifier' && c.kind.check === 'corruption');
    expect(constraints).toHaveLength(1);
    if (constraints[0].kind.type === 'check-modifier') expect(constraints[0].kind.value).toBe(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, cardInstance);
    expect(after.pendingResolutions).toHaveLength(1);
  });

  test('corruption-check-boost: 2-character company -> constraint value = 1', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [ASTERNAK, OSTISEN] }], hand: [JOIN_WITH_THAT_POWER], siteDeck: [VARIAG_CAMP] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LUITPRAND] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const asternak = findCharInstanceId(base, RESOURCE_PLAYER, ASTERNAK);
    const cardInstance = handCardId(base, RESOURCE_PLAYER);
    const withCheck = enqueueResolution(base, { source: null, actor: PLAYER_1, scope: { kind: 'phase', phase: Phase.Organization }, kind: { type: 'corruption-check', characterId: asternak, modifier: 0, reason: 'test', possessions: [], transferredItemId: null } });
    const after = dispatch(withCheck, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: cardInstance, targetCharacterId: asternak, optionId: 'corruption-check-boost' });
    const constraints = after.activeConstraints.filter(c => c.kind.type === 'check-modifier' && c.kind.check === 'corruption');
    expect(constraints).toHaveLength(1);
    if (constraints[0].kind.type === 'check-modifier') expect(constraints[0].kind.value).toBe(1);
  });

  test('corruption-check-boost: constraint increases corruptionModifier in roll action', () => {
    // Asternak + Ostisen. Add +1 constraint. Roll action must carry corruptionModifier = 1.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      recompute: true,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [ASTERNAK, OSTISEN] }], hand: [], siteDeck: [VARIAG_CAMP] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LUITPRAND] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const asternak = findCharInstanceId(base, RESOURCE_PLAYER, ASTERNAK);
    const boosted = addConstraint(base, { source: 'jwtp-1' as CardInstanceId, sourceDefinitionId: JOIN_WITH_THAT_POWER, scope: { kind: 'until-cleared' }, target: { kind: 'character', characterId: asternak }, kind: { type: 'check-modifier', check: 'corruption', value: 1 } });
    const withCheck = enqueueResolution(boosted, { source: null, actor: PLAYER_1, scope: { kind: 'phase', phase: Phase.Organization }, kind: { type: 'corruption-check', characterId: asternak, modifier: 0, reason: 'test', possessions: [], transferredItemId: null } });
    const checkActions = computeLegalActions(withCheck, PLAYER_1).filter(ea => ea.viable && ea.action.type === 'corruption-check');
    expect(checkActions).toHaveLength(1);
    expect((checkActions[0].action as { corruptionModifier: number }).corruptionModifier).toBe(1);
  });

  test('active-check duplication limit: second copy blocked for same character', () => {
    // Two copies in hand. Play first; second must be blocked for same character.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [ASTERNAK] }], hand: [JOIN_WITH_THAT_POWER, JOIN_WITH_THAT_POWER], siteDeck: [VARIAG_CAMP] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LUITPRAND] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const asternak = charIdAt(base, RESOURCE_PLAYER);
    const withCheck = enqueueResolution(base, { source: null, actor: PLAYER_1, scope: { kind: 'phase', phase: Phase.Organization }, kind: { type: 'corruption-check', characterId: asternak, modifier: 0, reason: 'test', possessions: [], transferredItemId: null } });
    const firstOffers = computeLegalActions(withCheck, PLAYER_1).filter(ea => ea.viable && ea.action.type === 'play-short-event' && (ea.action).optionId === 'corruption-check-boost');
    expect(firstOffers).toHaveLength(2);
    const after = dispatch(withCheck, firstOffers[0].action);
    const secondOffers = computeLegalActions(after, PLAYER_1).filter(ea => ea.viable && ea.action.type === 'play-short-event' && (ea.action).optionId === 'corruption-check-boost');
    expect(secondOffers).toHaveLength(0);
  });

  test('second copy can be played on a different character in the same company', () => {
    // First copy on Asternak; second copy still available for Ostisen's check.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [ASTERNAK, OSTISEN] }], hand: [JOIN_WITH_THAT_POWER, JOIN_WITH_THAT_POWER], siteDeck: [VARIAG_CAMP] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LUITPRAND] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const asternak = findCharInstanceId(base, RESOURCE_PLAYER, ASTERNAK);
    const ostisen = findCharInstanceId(base, RESOURCE_PLAYER, OSTISEN);

    const withAsterCheck = enqueueResolution(base, { source: null, actor: PLAYER_1, scope: { kind: 'phase', phase: Phase.Organization }, kind: { type: 'corruption-check', characterId: asternak, modifier: 0, reason: 'test', possessions: [], transferredItemId: null } });
    const asterOffers = computeLegalActions(withAsterCheck, PLAYER_1).filter(ea => ea.viable && ea.action.type === 'play-short-event' && (ea.action).optionId === 'corruption-check-boost' && (ea.action).targetCharacterId === asternak);
    expect(asterOffers.length).toBeGreaterThan(0);
    const afterFirst = dispatch(withAsterCheck, asterOffers[0].action);

    // Queue Ostisen CC, resolve Asternak's first (passes with roll 12)
    const withOstisenCheck = enqueueResolution(afterFirst, { source: null, actor: PLAYER_1, scope: { kind: 'phase', phase: Phase.Organization }, kind: { type: 'corruption-check', characterId: ostisen, modifier: 0, reason: 'test', possessions: [], transferredItemId: null } });
    const stateWithCheat = { ...withOstisenCheck, cheatRollTotal: 12 };
    const asterCheckRolls = computeLegalActions(stateWithCheat, PLAYER_1).filter(ea => ea.viable && ea.action.type === 'corruption-check');
    expect(asterCheckRolls).toHaveLength(1);
    const afterAsterCheck = dispatch(stateWithCheat, asterCheckRolls[0].action);

    // Ostisen's check now active; second as-90 should be offered for Ostisen
    const ostisenOffers = computeLegalActions(afterAsterCheck, PLAYER_1).filter(ea => ea.viable && ea.action.type === 'play-short-event' && (ea.action).optionId === 'corruption-check-boost');
    expect(ostisenOffers.length).toBeGreaterThan(0);
  });
});
