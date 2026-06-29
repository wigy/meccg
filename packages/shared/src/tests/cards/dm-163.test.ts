/**
 * @module dm-163.test
 *
 * Card test: When You Know More (dm-163)
 * Type: hero-resource-event (permanent), Light Enchantment
 * Marshalling points: 1 (miscellaneous, scored while in play on the sage)
 * Effects:
 *   1. play-target — site, filter playableResources includes "information"
 *   2. play-target — character, filter sage skill AND untapped
 *   3. play-flag — tap-site-on-play
 *   4. play-flag — tap-character-on-play
 *   5. grant-action — boost-company-influence (activeSitePhase, cost tap bearer):
 *        sequence [ add-constraint check-modifier influence +2 (target the
 *        chosen company-mate, scope turn), enqueue-corruption-check on bearer ]
 *
 * Text:
 *   "Light enchantment. Playable on a sage during the site phase at a site
 *    where Information is playable. Tap sage and site. Tap sage to modify one
 *    influence attempt by a character in his company by +2. Sage makes a
 *    corruption check."
 *
 * | # | Rule                                                         | Status |
 * |---|--------------------------------------------------------------|--------|
 * | 1 | Playable on a sage (skill gate)                              | OK     |
 * | 2 | Only at a site where Information is playable                 | OK     |
 * | 3 | Tap the sage on play                                         | OK     |
 * | 4 | Tap the site on play                                         | OK     |
 * | 5 | Tap sage (grant): +2 to one influence attempt by a co-member | OK     |
 * | 6 | The sage makes a corruption check when the ability is used   | OK     |
 * | 7 | The +2 modifies (and is consumed by) one influence attempt   | OK     |
 *
 * Playable: YES — CERTIFIED.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, RESOURCE_PLAYER,
  CardStatus,
  buildSitePhaseState, attachItemToChar,
  resetMint, findCharInstanceId,
  dispatch, resolveChain, viableActions, setCharStatus,
  CELEBORN, FARAMIR, ARAGORN, MEN_OF_LEBENNIN, PELARGIR,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { addConstraint } from '../../engine/pending.js';
import type {
  CardDefinitionId, CardInstanceId,
  ActivateGrantedAction, InfluenceAttemptAction,
} from '../../index.js';

const WHEN_YOU_KNOW_MORE = 'dm-163' as CardDefinitionId;
const AMON_HEN = 'tw-371' as CardDefinitionId;   // ruins-and-lairs, Information playable
const TOLFALAS = 'tw-433' as CardDefinitionId;    // ruins-and-lairs, NO Information

describe('When You Know More (dm-163)', () => {
  beforeEach(() => resetMint());

  // ── Rules 1+2: playable on a sage at an Information site ──────────────────

  test('offered as a permanent event on a sage at a site where Information is playable', () => {
    const state = buildSitePhaseState({
      characters: [CELEBORN],
      site: AMON_HEN,
      hand: [WHEN_YOU_KNOW_MORE],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('NOT offered on a non-sage character', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN], // warrior/scout/ranger — no sage skill
      site: AMON_HEN,
      hand: [WHEN_YOU_KNOW_MORE],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT offered at a site where Information is not playable', () => {
    const state = buildSitePhaseState({
      characters: [CELEBORN],
      site: TOLFALAS,
      hand: [WHEN_YOU_KNOW_MORE],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Rules 3+4: tap sage and site on play ─────────────────────────────────

  test('playing it taps the sage and the site, and attaches to the sage', () => {
    const state = buildSitePhaseState({
      characters: [CELEBORN],
      site: AMON_HEN,
      hand: [WHEN_YOU_KNOW_MORE],
    });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action;
    const after = resolveChain(dispatch(state, action));

    const celebornId = findCharInstanceId(after, RESOURCE_PLAYER, CELEBORN);
    const celeborn = after.players[RESOURCE_PLAYER].characters[celebornId];
    expect(celeborn.status).toBe(CardStatus.Tapped);
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Tapped);
    // The enchantment is now attached to the sage (resource permanent-event → items slot).
    expect(celeborn.items.some(i => i.definitionId === WHEN_YOU_KNOW_MORE)).toBe(true);
  });

  // ── Rule 5+6: the granted tap ability ────────────────────────────────────

  test('the granted ability is offered once per untapped company-mate, not for the sage itself', () => {
    const base = buildSitePhaseState({
      characters: [CELEBORN, FARAMIR],
      site: PELARGIR,
    });
    const state = attachItemToChar(base, RESOURCE_PLAYER, CELEBORN, WHEN_YOU_KNOW_MORE);

    const celebornId = findCharInstanceId(state, RESOURCE_PLAYER, CELEBORN);
    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .filter(a => a.actionId === 'boost-company-influence');

    expect(actions).toHaveLength(1);
    expect(actions[0].targetCardId).toBe(faramirId);
    // Never offered targeting the bearer (it taps to pay the cost).
    expect(actions.some(a => a.targetCardId === celebornId)).toBe(false);
  });

  test('the granted ability is not offered when the sage (bearer) is tapped', () => {
    const base = buildSitePhaseState({
      characters: [CELEBORN, FARAMIR],
      site: PELARGIR,
    });
    const attached = attachItemToChar(base, RESOURCE_PLAYER, CELEBORN, WHEN_YOU_KNOW_MORE);
    const state = setCharStatus(attached, RESOURCE_PLAYER, CELEBORN, CardStatus.Tapped);

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .filter(a => a.actionId === 'boost-company-influence');
    expect(actions).toHaveLength(0);
  });

  test('the granted ability is not offered with no other untapped company-mate', () => {
    const base = buildSitePhaseState({
      characters: [CELEBORN], // sage alone — nobody else can make the boosted attempt
      site: PELARGIR,
    });
    const state = attachItemToChar(base, RESOURCE_PLAYER, CELEBORN, WHEN_YOU_KNOW_MORE);

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .filter(a => a.actionId === 'boost-company-influence');
    expect(actions).toHaveLength(0);
  });

  test('activating taps the sage, adds a +2 influence modifier on the chosen mate, and enqueues a corruption check on the sage', () => {
    const base = buildSitePhaseState({
      characters: [CELEBORN, FARAMIR],
      site: PELARGIR,
    });
    const state = attachItemToChar(base, RESOURCE_PLAYER, CELEBORN, WHEN_YOU_KNOW_MORE);

    const celebornId = findCharInstanceId(state, RESOURCE_PLAYER, CELEBORN);
    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .find(a => a.actionId === 'boost-company-influence')!;
    const after = dispatch(state, action);

    // Bearer (sage) taps.
    expect(after.players[RESOURCE_PLAYER].characters[celebornId].status).toBe(CardStatus.Tapped);

    // +2 influence check-modifier targeting the chosen company-mate, turn-scoped.
    const infConstraints = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    );
    expect(infConstraints).toHaveLength(1);
    const constraint = infConstraints[0];
    if (constraint.kind.type === 'check-modifier') {
      expect(constraint.kind.value).toBe(2);
    }
    expect(constraint.scope.kind).toBe('turn');
    expect(constraint.target.kind).toBe('character');
    if (constraint.target.kind === 'character') {
      expect(constraint.target.characterId).toBe(faramirId);
    }

    // Corruption check enqueued on the sage (the bearer), not the mate.
    expect(after.pendingResolutions).toHaveLength(1);
    expect(after.pendingResolutions[0].kind.type).toBe('corruption-check');
    if (after.pendingResolutions[0].kind.type === 'corruption-check') {
      expect(after.pendingResolutions[0].kind.characterId).toBe(celebornId);
      expect(after.pendingResolutions[0].kind.reason).toBe('When You Know More');
    }
  });

  // ── Rule 7: the +2 modifies and is consumed by one influence attempt ─────

  test('the +2 modifier reduces a company-mate influence-attempt need and is consumed', () => {
    const base = buildSitePhaseState({
      characters: [CELEBORN, FARAMIR],
      site: PELARGIR,
      hand: [MEN_OF_LEBENNIN], // playable at Pelargir, influence # 8, Dúnedain +1
    });
    const faramirId = findCharInstanceId(base, RESOURCE_PLAYER, FARAMIR);

    // Baseline: Faramir (Dúnedain, DI 1) → need 8 - 1 (DI) - 1 (Dúnedain) = 6.
    const baseAttempt = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === faramirId);
    expect(baseAttempt?.need).toBe(6);

    // Apply the constraint exactly as When You Know More's grant-action produces it.
    const boosted = addConstraint(base, {
      source: 'wykm-1' as CardInstanceId,
      sourceDefinitionId: WHEN_YOU_KNOW_MORE,
      scope: { kind: 'turn' },
      target: { kind: 'character', characterId: faramirId },
      kind: { type: 'check-modifier', check: 'influence', value: 2 },
    });

    const boostedAttempt = computeLegalActions(boosted, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === faramirId);
    expect(boostedAttempt?.need).toBe(4); // 6 - 2

    // Resolve the attempt — the one-shot constraint is consumed.
    const factionInstance = boosted.players[RESOURCE_PLAYER].hand.find(
      c => c.definitionId === MEN_OF_LEBENNIN,
    )!;
    const withCheat = { ...boosted, cheatRollTotal: 12 };
    const afterAttempt = resolveChain(dispatch(withCheat, {
      type: 'influence-attempt',
      player: PLAYER_1,
      factionInstanceId: factionInstance.instanceId,
      influencingCharacterId: faramirId,
      need: 4,
      explanation: 'test',
    }));
    const rollAction = computeLegalActions(afterAttempt, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'faction-influence-roll')[0].action;
    const after = dispatch(afterAttempt, rollAction);

    const remaining = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    );
    expect(remaining).toHaveLength(0);
  });

  // ── End-to-end: grant ability → corruption check → boosted influence ─────

  test('end-to-end: tapping the sage boosts a mate influence attempt after the corruption check', () => {
    const base = buildSitePhaseState({
      characters: [CELEBORN, FARAMIR],
      site: PELARGIR,
      hand: [MEN_OF_LEBENNIN],
    });
    const state = attachItemToChar(base, RESOURCE_PLAYER, CELEBORN, WHEN_YOU_KNOW_MORE);
    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);

    // Activate the granted ability targeting Faramir.
    const activate = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .find(a => a.actionId === 'boost-company-influence')!;
    const activated = dispatch(state, activate);

    // Resolve the sage's corruption check (passes on a high roll).
    const ccAction = computeLegalActions({ ...activated, cheatRollTotal: 12 }, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'corruption-check')[0].action;
    const afterCC = dispatch({ ...activated, cheatRollTotal: 12 }, ccAction);

    // The +2 turn-scoped constraint survives the corruption check.
    expect(afterCC.activeConstraints.some(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    )).toBe(true);

    // Faramir's influence attempt now needs only 4 (8 - 1 - 1 - 2).
    const boostedAttempt = computeLegalActions(afterCC, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === faramirId);
    expect(boostedAttempt?.need).toBe(4);

    // Resolve it; the boost is consumed.
    const afterAttempt = resolveChain(dispatch({ ...afterCC, cheatRollTotal: 12 }, boostedAttempt!));
    const rollAction = computeLegalActions(afterAttempt, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'faction-influence-roll')[0].action;
    const done = dispatch(afterAttempt, rollAction);
    expect(done.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    )).toHaveLength(0);
  });
});
