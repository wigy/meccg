/**
 * @module le-178.test
 *
 * Card test: Crooked Promptings (le-178)
 * Type: minion-resource-event (short)
 * Alignment: ringwraith
 *
 * Text:
 *   "Diplomat only. +3 to any one influence check by a character in a
 *    diplomat's company or +2 to a corruption check by a character in his
 *    company."
 *
 * Effects:
 *   1. play-target: character, filter: company.containsDiplomat
 *   2. play-option "influence-check-boost": when player.hasFactionInHand,
 *      add-constraint check-modifier influence until-cleared, value 3
 *   3. play-option "corruption-check-boost": when pending.corruptionCheckTargetsMe,
 *      add-constraint check-modifier corruption until-cleared, value 2
 *
 * Note on the "Diplomat only" wording: unlike New Friendship (tw-292), whose
 * +3 influence applies only to the *diplomat himself*, Crooked Promptings'
 * +3 applies to "any one influence check by a character in a diplomat's
 * company" — so the influence option carries NO `target.skills` gate, only
 * the company-level `company.containsDiplomat` filter from play-target. The
 * boost therefore reaches non-diplomat companions too.
 *
 * Engine support table:
 * | # | Rule                                                                | Status      |
 * |---|---------------------------------------------------------------------|-------------|
 * | 1 | Playable only when the company contains a Diplomat                  | IMPLEMENTED |
 * | 2 | +3 to an influence check by any character in that company          | IMPLEMENTED |
 * | 3 | +2 to a corruption check by any character in that company          | IMPLEMENTED |
 * | 4 | "or" — the two modes are mutually-exclusive play-options           | IMPLEMENTED |
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

const CROOKED_PROMPTINGS = 'le-178' as CardDefinitionId;
const ASTERNAK = 'le-1' as CardDefinitionId;
const LUITPRAND = 'le-23' as CardDefinitionId;
const OSTISEN = 'le-36' as CardDefinitionId;
const VARIAG_CAMP = 'le-411' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const VARIAGS = 'le-292' as CardDefinitionId;

describe('Crooked Promptings (le-178)', () => {
  beforeEach(() => resetMint());

  test('influence-check-boost: offered during active influence attempt when company has Diplomat', () => {
    const state = buildInfluenceAttemptChainState({
      characters: [ASTERNAK],
      site: VARIAG_CAMP,
      hand: [CROOKED_PROMPTINGS, VARIAGS],
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
      hand: [CROOKED_PROMPTINGS, VARIAGS],
      factionDefId: VARIAGS,
    });
    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    expect(actions.some(a => a.optionId === 'influence-check-boost')).toBe(false);
  });

  test('influence-check-boost: also offered targeting a NON-diplomat companion (no target.skills gate)', () => {
    // Company = Asternak (diplomat) + Ostisen (scout, no diplomat). The boost
    // must be offered targeting Ostisen — the +3 reaches "any one influence
    // check by a character in a diplomat's company", not just the diplomat.
    const state = buildInfluenceAttemptChainState({
      characters: [ASTERNAK, OSTISEN],
      site: VARIAG_CAMP,
      hand: [CROOKED_PROMPTINGS, VARIAGS],
      factionDefId: VARIAGS,
    });
    const ostisen = findCharInstanceId(state, RESOURCE_PLAYER, OSTISEN);
    const offers = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.optionId === 'influence-check-boost' && a.targetCharacterId === ostisen);
    expect(offers).toHaveLength(1);
  });

  test('influence-check-boost: adds a +3 influence constraint and discards the card', () => {
    const state = buildInfluenceAttemptChainState({
      characters: [ASTERNAK],
      site: VARIAG_CAMP,
      hand: [CROOKED_PROMPTINGS, VARIAGS],
      factionDefId: VARIAGS,
    });
    const asternak = findCharInstanceId(state, RESOURCE_PLAYER, ASTERNAK);
    const cardInstance = findHandCardId(state, RESOURCE_PLAYER, CROOKED_PROMPTINGS);
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
      expect(constraints[0].kind.value).toBe(3);
    }
    expectInDiscardPile(after, RESOURCE_PLAYER, cardInstance);
  });

  test('influence-check-boost: +3 constraint reduces the influence-attempt need', () => {
    // Asternak DI 2, +2 vs Variag Camp factions = 4 against Variags (inf# 9).
    // Baseline need = 9 - 4 = 5. With +3 constraint: need = 2.
    const base = buildSitePhaseState({
      characters: [ASTERNAK],
      site: VARIAG_CAMP,
      hand: [VARIAGS],
    });
    const asternak = findCharInstanceId(base, RESOURCE_PLAYER, ASTERNAK);
    const boosted = addConstraint(base, {
      source: 'cp-1' as CardInstanceId,
      sourceDefinitionId: CROOKED_PROMPTINGS,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: asternak },
      kind: { type: 'check-modifier', check: 'influence', value: 3 },
    });
    const influenceActions = computeLegalActions(boosted, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt'
        && (ea.action as { influencingCharacterId: CardInstanceId }).influencingCharacterId === asternak);
    expect(influenceActions.length).toBeGreaterThan(0);
    expect((influenceActions[0].action as { need: number }).need).toBe(2);
  });

  test('corruption-check-boost: offered during pending CC on a character in a diplomat company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [ASTERNAK, OSTISEN] }], hand: [CROOKED_PROMPTINGS], siteDeck: [VARIAG_CAMP] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LUITPRAND] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const ostisen = findCharInstanceId(base, RESOURCE_PLAYER, OSTISEN);
    // No pending check -> nothing playable
    expect(computeLegalActions(base, PLAYER_1).filter(ea => ea.viable && ea.action.type === 'play-short-event')).toHaveLength(0);
    // CC on Ostisen (non-diplomat, but in a diplomat's company) -> offered
    const withCheck = enqueueResolution(base, { source: null, actor: PLAYER_1, scope: { kind: 'phase', phase: Phase.Organization }, kind: { type: 'corruption-check', characterId: ostisen, modifier: 0, reason: 'test', possessions: [], transferredItemId: null } });
    const boostActions = computeLegalActions(withCheck, PLAYER_1).filter(ea => ea.viable && ea.action.type === 'play-short-event').map(ea => ea.action as PlayShortEventAction);
    expect(boostActions.some(a => a.optionId === 'corruption-check-boost')).toBe(true);
  });

  test('corruption-check-boost: NOT offered when company has no Diplomat', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [LUITPRAND, OSTISEN] }], hand: [CROOKED_PROMPTINGS], siteDeck: [VARIAG_CAMP] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ASTERNAK] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const luitprand = findCharInstanceId(base, RESOURCE_PLAYER, LUITPRAND);
    const withCheck = enqueueResolution(base, { source: null, actor: PLAYER_1, scope: { kind: 'phase', phase: Phase.Organization }, kind: { type: 'corruption-check', characterId: luitprand, modifier: 0, reason: 'test', possessions: [], transferredItemId: null } });
    expect(computeLegalActions(withCheck, PLAYER_1).filter(ea => ea.viable && ea.action.type === 'play-short-event')).toHaveLength(0);
  });

  test('corruption-check-boost: adds a +2 corruption constraint and discards the card', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [ASTERNAK] }], hand: [CROOKED_PROMPTINGS], siteDeck: [VARIAG_CAMP] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LUITPRAND] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const asternak = charIdAt(base, RESOURCE_PLAYER);
    const cardInstance = handCardId(base, RESOURCE_PLAYER);
    const withCheck = enqueueResolution(base, { source: null, actor: PLAYER_1, scope: { kind: 'phase', phase: Phase.Organization }, kind: { type: 'corruption-check', characterId: asternak, modifier: 0, reason: 'test', possessions: [], transferredItemId: null } });
    const after = dispatch(withCheck, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: cardInstance, targetCharacterId: asternak, optionId: 'corruption-check-boost' });
    const constraints = after.activeConstraints.filter(c => c.kind.type === 'check-modifier' && c.kind.check === 'corruption');
    expect(constraints).toHaveLength(1);
    if (constraints[0].kind.type === 'check-modifier') expect(constraints[0].kind.value).toBe(2);
    expectInDiscardPile(after, RESOURCE_PLAYER, cardInstance);
    // The pending corruption check is still queued for resolution.
    expect(after.pendingResolutions).toHaveLength(1);
  });

  test('corruption-check-boost: +2 constraint raises corruptionModifier in the roll action', () => {
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
    const boosted = addConstraint(base, { source: 'cp-1' as CardInstanceId, sourceDefinitionId: CROOKED_PROMPTINGS, scope: { kind: 'until-cleared' }, target: { kind: 'character', characterId: asternak }, kind: { type: 'check-modifier', check: 'corruption', value: 2 } });
    const withCheck = enqueueResolution(boosted, { source: null, actor: PLAYER_1, scope: { kind: 'phase', phase: Phase.Organization }, kind: { type: 'corruption-check', characterId: asternak, modifier: 0, reason: 'test', possessions: [], transferredItemId: null } });
    const checkActions = computeLegalActions(withCheck, PLAYER_1).filter(ea => ea.viable && ea.action.type === 'corruption-check');
    expect(checkActions).toHaveLength(1);
    expect((checkActions[0].action as { corruptionModifier: number }).corruptionModifier).toBe(2);
  });
});
