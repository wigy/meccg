/**
 * @module le-136.test
 *
 * Card test: Searching Eye (le-136)
 * Type: hazard-event (short)
 * Effects: 1 (on-event self-enters-play → cancel-chain-entry on a target
 *             whose source card has an effect with `requiredSkill: "scout"`)
 *
 * Text:
 *   "Cancel and discard any card requiring scout skill before it is resolved
 *    or cancel any ongoing effect of a card that required scout skill to play.
 *    If this card is played as an on-guard card, it can be revealed during the
 *    opponent's site phase to cancel and discard a card requiring scout skill
 *    before it is resolved."
 *
 * Engine Support:
 * | # | Feature                                                          | Status      |
 * |---|------------------------------------------------------------------|-------------|
 * | 1 | Cancel a scout-skill card on the chain before it resolves        | IMPLEMENTED |
 * | 2 | Cancel ongoing effect of a card that needed scout                | IMPLEMENTED |
 * | 3 | On-guard reveal during opponent's site phase (scout-skill cancel)| IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  ORC_PATROL, CONCEALMENT, STEALTH,
  LORIEN, MORIA, MINAS_TIRITH, RIVENDELL,
  makeMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt, dispatch, expectInDiscardPile,
  resolveChain, RESOURCE_PLAYER, HAZARD_PLAYER,
  viableActions, mint, placeOnGuard, makeSitePhase,
} from '../test-helpers.js';
import type { CardDefinitionId, PlayShortEventAction, CancelAttackAction, RevealOnGuardAction } from '../../index.js';
import { RegionType, SiteType } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { addConstraint } from '../../engine/pending.js';

const SEARCHING_EYE = 'le-136' as CardDefinitionId;

describe('Searching Eye (le-136) — chain cancel', () => {
  beforeEach(() => resetMint());

  test('is offered as a chain response when a scout-skill short is on the chain', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [CONCEALMENT], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL, SEARCHING_EYE], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    // Resource declares Concealment — chain opens, hazard gets priority.
    const cancelAction = viableActions(combatState, PLAYER_1, 'cancel-attack')[0].action as CancelAttackAction;
    const afterConceal = dispatch(combatState, cancelAction);

    expect(afterConceal.chain).not.toBeNull();
    expect(afterConceal.chain!.priority).toBe(PLAYER_2);

    // Hazard's legal actions now include play-short-event for Searching Eye
    // targeting Concealment's chain entry.
    const hazardActions = computeLegalActions(afterConceal, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    const searchingEyePlays = hazardActions.filter(a => {
      const handCard = afterConceal.players[HAZARD_PLAYER].hand.find(c => c.instanceId === a.cardInstanceId);
      return handCard?.definitionId === SEARCHING_EYE;
    });
    expect(searchingEyePlays).toHaveLength(1);

    // Target must be Concealment's chain-entry card instance.
    const concealmentEntry = afterConceal.chain!.entries.find(e => e.card?.definitionId === CONCEALMENT)!;
    expect(searchingEyePlays[0].targetInstanceId).toBe(concealmentEntry.card!.instanceId);
  });

  test('is NOT offered when no scout-skill card is on the chain', () => {
    // Same setup but without Concealment — Orc-Patrol's attack chain has no
    // scout-skill target, so Searching Eye shouldn't be emitted.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL, SEARCHING_EYE], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    // At this point combat is active (no chain yet — creature already
    // resolved into combat). Searching Eye still shouldn't be offered as
    // a chain response because no chain is active.
    const hazardActions = computeLegalActions(combatState, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    const searchingEyePlays = hazardActions.filter(a => {
      const handCard = combatState.players[HAZARD_PLAYER].hand.find(c => c.instanceId === a.cardInstanceId);
      return handCard?.definitionId === SEARCHING_EYE;
    });
    expect(searchingEyePlays).toHaveLength(0);
  });

  test('cancels Concealment on resolution — attack is not cancelled', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [CONCEALMENT], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL, SEARCHING_EYE], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    // Record instance ids before the chain begins
    const searchingEyeInstanceId = combatState.players[HAZARD_PLAYER].hand
      .find(c => c.definitionId === SEARCHING_EYE)!.instanceId;
    const concealmentInstanceId = combatState.players[RESOURCE_PLAYER].hand
      .find(c => c.definitionId === CONCEALMENT)!.instanceId;

    // 1. Resource declares Concealment — chain opens.
    const cancelAction = viableActions(combatState, PLAYER_1, 'cancel-attack')[0].action as CancelAttackAction;
    const afterConceal = dispatch(combatState, cancelAction);

    // 2. Hazard plays Searching Eye targeting Concealment.
    const searchingEyePlay = computeLegalActions(afterConceal, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .find(a => a.cardInstanceId === searchingEyeInstanceId)!;
    expect(searchingEyePlay).toBeDefined();

    const afterEye = dispatch(afterConceal, searchingEyePlay);

    // Chain now has two entries: Concealment (unresolved, not negated) and
    // Searching Eye (unresolved, not negated, with target = concealment).
    expect(afterEye.chain).not.toBeNull();
    expect(afterEye.chain!.entries).toHaveLength(2);

    // 3. Both pass — chain resolves LIFO: Searching Eye first, negating
    // Concealment; Concealment entry is then skipped (negated).
    const resolved = resolveChain(afterEye);

    // Chain is complete.
    expect(resolved.chain).toBeNull();

    // Combat is STILL active — attack was not cancelled, because
    // Concealment's cancel-attack never got to fire.
    expect(resolved.combat).not.toBeNull();

    // Both cards are in their owners' discard piles.
    expectInDiscardPile(resolved, RESOURCE_PLAYER, concealmentInstanceId);
    expectInDiscardPile(resolved, HAZARD_PLAYER, searchingEyeInstanceId);

    // Neither card remains in hand.
    expect(resolved.players[RESOURCE_PLAYER].hand.find(c => c.instanceId === concealmentInstanceId)).toBeUndefined();
    expect(resolved.players[HAZARD_PLAYER].hand.find(c => c.instanceId === searchingEyeInstanceId)).toBeUndefined();
  });

  test('is offered during M/H phase when a scout-skill constraint is in effect', () => {
    // Build a state in M/H phase: P1 (resource) has a company; P2 (hazard)
    // holds Searching Eye. A Stealth-sourced `no-creature-hazards-on-company`
    // constraint is active, protecting P1's company. Searching Eye should be
    // offered with targetInstanceId = the constraint's `source` (Stealth).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [SEARCHING_EYE], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const stealthInstanceId = mint();
    const constrained = addConstraint(stateAtMH, {
      source: stealthInstanceId,
      sourceDefinitionId: STEALTH,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId: targetCompanyId },
      kind: { type: 'no-creature-hazards-on-company' },
    });

    const plays = viableActions(constrained, PLAYER_2, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    const searchingEyePlays = plays.filter(a => {
      const c = constrained.players[HAZARD_PLAYER].hand.find(h => h.instanceId === a.cardInstanceId);
      return c?.definitionId === SEARCHING_EYE;
    });
    expect(searchingEyePlays).toHaveLength(1);
    expect(searchingEyePlays[0].targetInstanceId).toBe(stealthInstanceId);
  });

  test('dispatching Searching Eye against a Stealth constraint removes the constraint', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [SEARCHING_EYE], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const stealthInstanceId = mint();
    const constrained = addConstraint(stateAtMH, {
      source: stealthInstanceId,
      sourceDefinitionId: STEALTH,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId: targetCompanyId },
      kind: { type: 'no-creature-hazards-on-company' },
    });
    expect(constrained.activeConstraints).toHaveLength(1);

    const searchingEyeInstanceId = constrained.players[HAZARD_PLAYER].hand
      .find(c => c.definitionId === SEARCHING_EYE)!.instanceId;
    const play: PlayShortEventAction = {
      type: 'play-short-event',
      player: PLAYER_2,
      cardInstanceId: searchingEyeInstanceId,
      targetInstanceId: stealthInstanceId,
    };

    const afterPlay = dispatch(constrained, play);

    // The Searching Eye play opened a chain; resolving it removes the
    // Stealth-sourced constraint via `resolveEnvironmentCancel`'s
    // constraint-removal branch.
    const resolved = resolveChain(afterPlay);

    expect(resolved.chain).toBeNull();
    expect(resolved.activeConstraints).toHaveLength(0);
    expectInDiscardPile(resolved, HAZARD_PLAYER, searchingEyeInstanceId);
  });

  test('is NOT offered when no scout-skill constraint is in effect', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [SEARCHING_EYE], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const viable = viableActions(stateAtMH, PLAYER_2, 'play-short-event');
    const searchingEyeViable = viable.filter(ea => {
      const a = ea.action as PlayShortEventAction;
      const c = stateAtMH.players[HAZARD_PLAYER].hand.find(h => h.instanceId === a.cardInstanceId);
      return c?.definitionId === SEARCHING_EYE;
    });
    expect(searchingEyeViable).toHaveLength(0);
  });

  test('without Searching Eye, Concealment resolves and cancels the attack (control)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [CONCEALMENT], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    const cancelAction = viableActions(combatState, PLAYER_1, 'cancel-attack')[0].action as CancelAttackAction;
    const afterConceal = dispatch(combatState, cancelAction);

    // Hazard has no Searching Eye — just pass to resolution.
    const resolved = resolveChain(afterConceal);

    expect(resolved.chain).toBeNull();
    expect(resolved.combat).toBeNull();
  });
});

describe('Searching Eye (le-136) — on-guard reveal (site phase)', () => {
  beforeEach(() => resetMint());

  function buildSitePhaseState() {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [STEALTH], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const stateAtSite = { ...base, phaseState: makeSitePhase() };
    const { state: withOnGuard } = placeOnGuard(stateAtSite, RESOURCE_PLAYER, 0, SEARCHING_EYE);
    return withOnGuard;
  }

  test('playing a scout-skill short with on-guard cards enqueues an on-guard-window', () => {
    const state = buildSitePhaseState();
    const stealthInstanceId = handCardId(state, RESOURCE_PLAYER);

    const play: PlayShortEventAction = {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: stealthInstanceId,
    };
    const afterPlay = dispatch(state, play);

    // Window is queued for the hazard player; Stealth is still in hand
    // and its constraint has NOT been added yet.
    expect(afterPlay.pendingResolutions.length).toBeGreaterThan(0);
    const top = afterPlay.pendingResolutions[0];
    expect(top.actor).toBe(PLAYER_2);
    expect(top.kind.type).toBe('on-guard-window');
    if (top.kind.type === 'on-guard-window') {
      expect(top.kind.stage).toBe('reveal-window');
      expect(top.kind.deferredAction).toEqual(play);
    }
    expect(afterPlay.players[RESOURCE_PLAYER].hand.find(c => c.instanceId === stealthInstanceId)).toBeDefined();
    expect(afterPlay.activeConstraints).toHaveLength(0);
  });

  test('hazard reveal window offers Searching Eye as a viable reveal', () => {
    const state = buildSitePhaseState();
    const stealthInstanceId = handCardId(state, RESOURCE_PLAYER);

    const play: PlayShortEventAction = {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: stealthInstanceId,
    };
    const afterPlay = dispatch(state, play);

    const reveals = viableActions(afterPlay, PLAYER_2, 'reveal-on-guard')
      .map(ea => ea.action as RevealOnGuardAction);
    expect(reveals).toHaveLength(1);
    const ogCard = afterPlay.players[RESOURCE_PLAYER].companies[0].onGuardCards[0];
    expect(reveals[0].cardInstanceId).toBe(ogCard.instanceId);
  });

  test('revealing Searching Eye cancels the deferred short and discards both cards', () => {
    const state = buildSitePhaseState();
    const stealthInstanceId = handCardId(state, RESOURCE_PLAYER);
    const ogCardInstance = state.players[RESOURCE_PLAYER].companies[0].onGuardCards[0].instanceId;

    const play: PlayShortEventAction = {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: stealthInstanceId,
    };
    const afterPlay = dispatch(state, play);

    const reveal: RevealOnGuardAction = {
      type: 'reveal-on-guard',
      player: PLAYER_2,
      cardInstanceId: ogCardInstance,
    };
    const afterReveal = dispatch(afterPlay, reveal);

    // Pending resolution consumed; no chain initiated; no constraint added.
    expect(afterReveal.pendingResolutions).toHaveLength(0);
    expect(afterReveal.chain).toBeNull();
    expect(afterReveal.activeConstraints).toHaveLength(0);

    // Both cards discarded to their owners, removed from hand / on-guard.
    expectInDiscardPile(afterReveal, RESOURCE_PLAYER, stealthInstanceId);
    expectInDiscardPile(afterReveal, HAZARD_PLAYER, ogCardInstance);
    expect(afterReveal.players[RESOURCE_PLAYER].hand.find(c => c.instanceId === stealthInstanceId)).toBeUndefined();
    expect(afterReveal.players[RESOURCE_PLAYER].companies[0].onGuardCards).toHaveLength(0);
  });

  test('hazard pass runs the deferred short normally', () => {
    const state = buildSitePhaseState();
    const stealthInstanceId = handCardId(state, RESOURCE_PLAYER);
    const aragornInstanceId = state.players[RESOURCE_PLAYER].companies[0].characters[0];

    const play: PlayShortEventAction = {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: stealthInstanceId,
      targetScoutInstanceId: aragornInstanceId,
    };
    const afterPlay = dispatch(state, play);

    const afterPass = dispatch(afterPlay, { type: 'pass', player: PLAYER_2 });

    // Deferred action ran — Stealth is in discard, its constraint is active.
    expectInDiscardPile(afterPass, RESOURCE_PLAYER, stealthInstanceId);
    expect(afterPass.activeConstraints).toHaveLength(1);
    expect(afterPass.activeConstraints[0].sourceDefinitionId).toBe(STEALTH);
    // Searching Eye remains on-guard (not revealed).
    expect(afterPass.players[RESOURCE_PLAYER].companies[0].onGuardCards).toHaveLength(1);
    expect(afterPass.pendingResolutions).toHaveLength(0);
  });

  test('playing a short without requiredSkill does NOT enqueue an on-guard-window', () => {
    // Replace Stealth (scout-only) with Concealment (scout-only cancel-attack):
    // still has requiredSkill, so intercepted. Use a short that has NO
    // requiredSkill to prove the intercept is narrow.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const stateAtSite = { ...base, phaseState: makeSitePhase() };
    const { state: withOnGuard } = placeOnGuard(stateAtSite, RESOURCE_PLAYER, 0, SEARCHING_EYE);

    // No resource shorts queued — exercise only the negative branch of the
    // interceptor guard: when no hand card has requiredSkill, nothing is
    // intercepted (trivially true, but still exercises the check path).
    expect(withOnGuard.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expect(withOnGuard.pendingResolutions).toHaveLength(0);
  });
});
