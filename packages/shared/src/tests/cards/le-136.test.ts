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
  handCardId, companyIdAt, charIdAt, dispatch, expectInDiscardPile,
  resolveChain, RESOURCE_PLAYER, HAZARD_PLAYER,
  mint, placeOnGuard, makeSitePhase,
  findHandCardId, expectInHand, expectNotInHand,
  getOnGuardCard, onGuardCardIdAt,
  viableActionsForHandCard, firstAction,
} from '../test-helpers.js';
import type { CardDefinitionId, PlayShortEventAction, CancelAttackAction, RevealOnGuardAction } from '../../index.js';
import { RegionType, SiteType } from '../../index.js';
import { addConstraint } from '../../engine/pending.js';

const SEARCHING_EYE = 'le-136' as CardDefinitionId;

// Shared options for the M/H phase state used by every chain-cancel test:
// one Wilderness region in the resolved path, Moria as the destination.
const MH_PATH_THROUGH_WILDERNESS = {
  activeCompanyIndex: 0,
  resolvedSitePath: [RegionType.Wilderness],
  resolvedSitePathNames: ['Hithaeglir'],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Moria',
} as const;

describe('Searching Eye (le-136) — chain cancel', () => {
  beforeEach(() => resetMint());

  test('offered on chain when Concealment targets the attack; cancels it so combat stays live', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [CONCEALMENT], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL, SEARCHING_EYE], siteDeck: [RIVENDELL] },
      ],
    });
    const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH_THROUGH_WILDERNESS) };

    const searchingEyeId = findHandCardId(stateAtMH, HAZARD_PLAYER, SEARCHING_EYE);
    const concealmentId = findHandCardId(stateAtMH, RESOURCE_PLAYER, CONCEALMENT);
    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);

    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    // Resource declares Concealment — chain opens, hazard gets priority.
    const cancelAction = firstAction<CancelAttackAction>(combatState, PLAYER_1, 'cancel-attack');
    const afterConceal = dispatch(combatState, cancelAction);

    expect(afterConceal.chain).not.toBeNull();
    expect(afterConceal.chain!.priority).toBe(PLAYER_2);

    // Searching Eye is now a viable chain response; its target is
    // Concealment's chain entry.
    const searchingEyePlays = viableActionsForHandCard(afterConceal, PLAYER_2, 'play-short-event', HAZARD_PLAYER, SEARCHING_EYE)
      .map(ea => ea.action as PlayShortEventAction);
    expect(searchingEyePlays).toHaveLength(1);
    const concealmentEntry = afterConceal.chain!.entries.find(e => e.card?.definitionId === CONCEALMENT)!;
    expect(searchingEyePlays[0].targetInstanceId).toBe(concealmentEntry.card!.instanceId);

    // Hazard plays Searching Eye → chain has two entries, resolves LIFO
    // (Searching Eye negates Concealment; Concealment is then skipped).
    const afterEye = dispatch(afterConceal, searchingEyePlays[0]);
    expect(afterEye.chain!.entries).toHaveLength(2);

    const resolved = resolveChain(afterEye);
    expect(resolved.chain).toBeNull();
    // Combat is STILL active — Concealment never got to fire.
    expect(resolved.combat).not.toBeNull();

    // Both cards moved from hand to their owners' discard piles.
    expectInDiscardPile(resolved, RESOURCE_PLAYER, concealmentId);
    expectInDiscardPile(resolved, HAZARD_PLAYER, searchingEyeId);
    expectNotInHand(resolved, RESOURCE_PLAYER, concealmentId);
    expectNotInHand(resolved, HAZARD_PLAYER, searchingEyeId);
  });

  test('not offered when no scout-skill card is on the chain', () => {
    // Same shape as above but without Concealment in the resource hand.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL, SEARCHING_EYE], siteDeck: [RIVENDELL] },
      ],
    });
    const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH_THROUGH_WILDERNESS) };

    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    // Combat is active (no chain yet — the creature resolved into combat).
    // Searching Eye should not be offered because no chain is live.
    const searchingEyePlays = viableActionsForHandCard(combatState, PLAYER_2, 'play-short-event', HAZARD_PLAYER, SEARCHING_EYE);
    expect(searchingEyePlays).toHaveLength(0);
  });

  test('offered vs a Stealth constraint during M/H; dispatching removes the constraint', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [SEARCHING_EYE], siteDeck: [RIVENDELL] },
      ],
    });
    const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH_THROUGH_WILDERNESS) };

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

    // Searching Eye is offered, and its target is the constraint's source.
    const searchingEyePlays = viableActionsForHandCard(constrained, PLAYER_2, 'play-short-event', HAZARD_PLAYER, SEARCHING_EYE)
      .map(ea => ea.action as PlayShortEventAction);
    expect(searchingEyePlays).toHaveLength(1);
    expect(searchingEyePlays[0].targetInstanceId).toBe(stealthInstanceId);

    // Dispatching it opens a chain; resolving the chain removes the
    // constraint via `resolveEnvironmentCancel`'s constraint-removal branch.
    const searchingEyeId = findHandCardId(constrained, HAZARD_PLAYER, SEARCHING_EYE);
    const afterPlay = dispatch(constrained, searchingEyePlays[0]);
    const resolved = resolveChain(afterPlay);
    expect(resolved.chain).toBeNull();
    expect(resolved.activeConstraints).toHaveLength(0);
    expectInDiscardPile(resolved, HAZARD_PLAYER, searchingEyeId);
  });

  test('not offered during M/H when no scout-skill constraint is in effect', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [SEARCHING_EYE], siteDeck: [RIVENDELL] },
      ],
    });
    const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH_THROUGH_WILDERNESS) };

    expect(viableActionsForHandCard(stateAtMH, PLAYER_2, 'play-short-event', HAZARD_PLAYER, SEARCHING_EYE))
      .toHaveLength(0);
  });

  test('control: without Searching Eye, Concealment resolves and cancels the attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [CONCEALMENT], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });
    const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH_THROUGH_WILDERNESS) };

    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    const cancelAction = firstAction<CancelAttackAction>(combatState, PLAYER_1, 'cancel-attack');
    const resolved = resolveChain(dispatch(combatState, cancelAction));

    // With no Searching Eye to interrupt, Concealment cancels combat.
    expect(resolved.chain).toBeNull();
    expect(resolved.combat).toBeNull();
  });
});

describe('Searching Eye (le-136) — on-guard reveal (site phase)', () => {
  // State used by every test in this block: PLAYER_1 at Moria with Stealth
  // in hand; Searching Eye placed on-guard on PLAYER_1's company. Rebuilt
  // in beforeEach so mint counters stay deterministic across tests.
  let state: ReturnType<typeof placeOnGuard>['state'];

  beforeEach(() => {
    resetMint();
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [STEALTH], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    state = placeOnGuard({ ...base, phaseState: makeSitePhase() }, RESOURCE_PLAYER, 0, SEARCHING_EYE).state;
  });

  test('playing a scout-skill short enqueues an on-guard-window and offers Searching Eye as a reveal', () => {
    const stealthId = handCardId(state, RESOURCE_PLAYER);
    const play: PlayShortEventAction = {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: stealthId,
    };
    const afterPlay = dispatch(state, play);

    // Window is queued for the hazard player; Stealth is still in hand
    // and its constraint has NOT been added yet.
    const [pending] = afterPlay.pendingResolutions;
    expect(pending.actor).toBe(PLAYER_2);
    expect(pending.kind.type).toBe('on-guard-window');
    if (pending.kind.type === 'on-guard-window') {
      expect(pending.kind.stage).toBe('reveal-window');
      expect(pending.kind.deferredAction).toEqual(play);
    }
    expectInHand(afterPlay, RESOURCE_PLAYER, stealthId);
    expect(afterPlay.activeConstraints).toHaveLength(0);

    // Searching Eye is offered as the one viable reveal.
    const ogCardId = onGuardCardIdAt(afterPlay, RESOURCE_PLAYER);
    const revealAction = firstAction<RevealOnGuardAction>(afterPlay, PLAYER_2, 'reveal-on-guard');
    expect(revealAction.cardInstanceId).toBe(ogCardId);
  });

  test('revealing Searching Eye cancels the deferred short and discards both cards', () => {
    const stealthId = handCardId(state, RESOURCE_PLAYER);
    const ogCardId = onGuardCardIdAt(state, RESOURCE_PLAYER);

    const afterPlay = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: stealthId,
    });
    const afterReveal = dispatch(afterPlay, {
      type: 'reveal-on-guard',
      player: PLAYER_2,
      cardInstanceId: ogCardId,
    });

    // Pending resolution consumed; no chain initiated; no constraint added.
    expect(afterReveal.pendingResolutions).toHaveLength(0);
    expect(afterReveal.chain).toBeNull();
    expect(afterReveal.activeConstraints).toHaveLength(0);

    // Both cards discarded to their owners, removed from hand / on-guard.
    expectInDiscardPile(afterReveal, RESOURCE_PLAYER, stealthId);
    expectInDiscardPile(afterReveal, HAZARD_PLAYER, ogCardId);
    expectNotInHand(afterReveal, RESOURCE_PLAYER, stealthId);
    expect(afterReveal.players[RESOURCE_PLAYER].companies[0].onGuardCards).toHaveLength(0);
  });

  test('hazard pass runs the deferred short normally', () => {
    const stealthId = handCardId(state, RESOURCE_PLAYER);
    const aragornInstanceId = charIdAt(state, RESOURCE_PLAYER);

    const afterPlay = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: stealthId,
      targetScoutInstanceId: aragornInstanceId,
    });
    const afterPass = dispatch(afterPlay, { type: 'pass', player: PLAYER_2 });

    // Deferred action ran — Stealth is in discard, its constraint is active.
    expectInDiscardPile(afterPass, RESOURCE_PLAYER, stealthId);
    expect(afterPass.activeConstraints).toHaveLength(1);
    expect(afterPass.activeConstraints[0].sourceDefinitionId).toBe(STEALTH);
    // Searching Eye remains on-guard (not revealed).
    expect(getOnGuardCard(afterPass, RESOURCE_PLAYER).definitionId).toBe(SEARCHING_EYE);
    expect(afterPass.pendingResolutions).toHaveLength(0);
  });

  test('playing a short without requiredSkill does NOT enqueue an on-guard-window', () => {
    // Negative branch of the interceptor guard: with no resource short in
    // hand that declares `requiredSkill`, nothing is intercepted. Build a
    // fresh state with an empty resource hand but the same on-guard setup.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const { state: withOnGuard } = placeOnGuard(
      { ...base, phaseState: makeSitePhase() },
      RESOURCE_PLAYER, 0, SEARCHING_EYE,
    );

    expect(withOnGuard.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expect(withOnGuard.pendingResolutions).toHaveLength(0);
  });
});
