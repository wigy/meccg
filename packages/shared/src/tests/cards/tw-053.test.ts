/**
 * @module tw-053.test
 *
 * Card test: Lost in Free-domains (tw-53)
 * Type: hazard-event (permanent, company-targeting)
 * Effects: 2 (play-target company, on-event self-enters-play → add-constraint
 *             site-phase-do-nothing scope:company-site-phase)
 *
 * "Playable on a company moving with a Free-domain in its site path.
 *  The company may do nothing during its site phase."
 *
 * Engine Support:
 * | # | Feature                                  | Status      | Notes                                  |
 * |---|------------------------------------------|-------------|----------------------------------------|
 * | 1 | Play target = company                    | IMPLEMENTED | play-hazard's mandatory targetCompanyId |
 * | 2 | Adds site-phase-do-nothing constraint    | IMPLEMENTED | on-event self-enters-play apply        |
 * | 3 | Constraint collapses enter-or-skip menu  | IMPLEMENTED | constraint filter (legal-actions/pending) |
 * | 4 | Constraint clears at company-site-end    | IMPLEMENTED | sweepExpired in advanceSiteToNextCompany |
 * | 5 | Constraint does not affect other companies | IMPLEMENTED | constraint filter checks active company |
 * | 6 | Play-from-hand → chain → constraint added | IMPLEMENTED | reduce(play-hazard) end-to-end          |
 *
 * Certified: 2026-04-08
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  LOST_IN_FREE_DOMAINS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  pool,
  makeMHState,
  handCardId, companyIdAt, dispatch,
} from '../test-helpers.js';
import type {
  CompanyId, HazardEventCard,
  SitePhaseState,
  PlayHazardAction,
} from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { addConstraint, sweepExpired } from '../../engine/pending.js';

describe('Lost in Free-domains (tw-53)', () => {
  beforeEach(() => resetMint());

  test('card definition has the expected effects', () => {
    const def = pool[LOST_IN_FREE_DOMAINS as string] as HazardEventCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hazard-event');
    expect(def.eventType).toBe('permanent');

    const playTarget = def.effects?.find(e => e.type === 'play-target');
    expect(playTarget).toBeDefined();
    expect(playTarget?.target).toBe('company');

    const onEvent = def.effects?.find(e => e.type === 'on-event');
    expect(onEvent).toBeDefined();
    expect(onEvent?.event).toBe('self-enters-play');
    expect(onEvent?.apply.type).toBe('add-constraint');
    expect(onEvent?.apply.constraint).toBe('site-phase-do-nothing');
    expect(onEvent?.apply.scope).toBe('company-site-phase');
  });

  test('site-phase-do-nothing constraint collapses enter-or-skip to pass', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const targetCompanyId = companyIdAt(base, 0);

    // Move into the enter-or-skip step for the target company.
    const sitePhaseState: SitePhaseState = {
      phase: Phase.Site,
      step: 'enter-or-skip',
      activeCompanyIndex: 0,
      handledCompanyIds: [],
      automaticAttacksResolved: 0,
      siteEntered: false,
      resourcePlayed: false,
      minorItemAvailable: false,
      declaredAgentAttack: null,
      awaitingOnGuardReveal: false,
      pendingResourceAction: null,
      opponentInteractionThisTurn: null,
      pendingOpponentInfluence: null,
    };
    const sitePhaseStateAtStep = { ...base, phaseState: sitePhaseState };

    // Without the constraint, the player has both `enter-site` and `pass`.
    const beforeActions = computeLegalActions(sitePhaseStateAtStep, PLAYER_1)
      .filter(ea => ea.viable)
      .map(ea => ea.action.type);
    expect(beforeActions).toContain('enter-site');
    expect(beforeActions).toContain('pass');

    // Add the Lost in Free-domains constraint targeting the company.
    const constrained = addConstraint(sitePhaseStateAtStep, {
      source: 'lifd-1' as never,
      sourceDefinitionId: LOST_IN_FREE_DOMAINS,
      scope: { kind: 'company-site-phase', companyId: targetCompanyId },
      target: { kind: 'company', companyId: targetCompanyId },
      kind: { type: 'site-phase-do-nothing' },
    });

    const afterActions = computeLegalActions(constrained, PLAYER_1)
      .filter(ea => ea.viable)
      .map(ea => ea.action.type);
    expect(afterActions).toEqual(['pass']);
  });

  test('constraint does not affect other companies (or other phases)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Constraint targets a fictitious other company id — should be ignored.
    const constrained = addConstraint(base, {
      source: 'lifd-1' as never,
      sourceDefinitionId: LOST_IN_FREE_DOMAINS,
      scope: { kind: 'company-site-phase', companyId: 'other-co' as CompanyId },
      target: { kind: 'company', companyId: 'other-co' as CompanyId },
      kind: { type: 'site-phase-do-nothing' },
    });

    const sitePhaseState: SitePhaseState = {
      phase: Phase.Site,
      step: 'enter-or-skip',
      activeCompanyIndex: 0,
      handledCompanyIds: [],
      automaticAttacksResolved: 0,
      siteEntered: false,
      resourcePlayed: false,
      minorItemAvailable: false,
      declaredAgentAttack: null,
      awaitingOnGuardReveal: false,
      pendingResourceAction: null,
      opponentInteractionThisTurn: null,
      pendingOpponentInfluence: null,
    };
    const stateAtStep = { ...constrained, phaseState: sitePhaseState };

    const actions = computeLegalActions(stateAtStep, PLAYER_1)
      .filter(ea => ea.viable)
      .map(ea => ea.action.type);
    expect(actions).toContain('enter-site');
    expect(actions).toContain('pass');
  });

  test('sweepExpired clears the constraint at company-site-end', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const targetCompanyId = companyIdAt(base, 0);
    const constrained = addConstraint(base, {
      source: 'lifd-1' as never,
      sourceDefinitionId: LOST_IN_FREE_DOMAINS,
      scope: { kind: 'company-site-phase', companyId: targetCompanyId },
      target: { kind: 'company', companyId: targetCompanyId },
      kind: { type: 'site-phase-do-nothing' },
    });
    expect(constrained.activeConstraints).toHaveLength(1);

    const swept = sweepExpired(constrained, { kind: 'company-site-end', companyId: targetCompanyId });
    expect(swept.activeConstraints).toHaveLength(0);
  });

  test('Lost in Free-domains is offered as a viable hazard play during play-hazards step', () => {
    // Build an M/H state with P1's company active and P2 holding Lost in
    // Free-domains. The hazard player should see a viable play-hazard
    // action targeting P1's company.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [LOST_IN_FREE_DOMAINS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const targetCompanyId = companyIdAt(base, 0);
    const lifdInstance = handCardId(base, 1);

    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    const playActions = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard')
      .map(ea => ea.action as PlayHazardAction);

    const lifdPlay = playActions.find(a => a.cardInstanceId === lifdInstance);
    expect(lifdPlay).toBeDefined();
    expect(lifdPlay!.targetCompanyId).toBe(targetCompanyId);
    // Lost in Free-domains has play-target=company, so the action does
    // *not* carry a per-character target.
    expect(lifdPlay!.targetCharacterId).toBeUndefined();
  });

  test('playing Lost in Free-domains through reduce adds the constraint to the targeted company', () => {
    // Drive the full play-from-hand pipeline: P2 plays Lost in
    // Free-domains via reduce(), the chain resolves, and an active
    // constraint of kind site-phase-do-nothing should be queued
    // against P1's active company. Lost in Free-domains itself ends
    // up in P2's cardsInPlay.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [LOST_IN_FREE_DOMAINS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const targetCompanyId = companyIdAt(base, 0);
    const lifdInstance = handCardId(base, 1);

    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    const afterPlay = dispatch(stateAtPlayHazards, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: lifdInstance,
      targetCompanyId,
    });
    expect(afterPlay.chain).not.toBeNull();

    // Resolve the chain (both players pass priority).
    let current = afterPlay;
    for (let i = 0; i < 10 && current.chain !== null; i++) {
      const r = reduce(current, { type: 'pass-chain-priority', player: current.chain.priority });
      if (r.error) break;
      current = r.state;
    }
    expect(current.chain).toBeNull();

    // Lost in Free-domains is now in P2's cardsInPlay (no character attachment).
    const lifdInPlay = current.players[1].cardsInPlay.find(c => c.instanceId === lifdInstance);
    expect(lifdInPlay).toBeDefined();
    expect(lifdInPlay!.definitionId).toBe(LOST_IN_FREE_DOMAINS);
    // Not site-attached either — Lost in Free-domains targets a company, not a site.
    expect(lifdInPlay!.attachedToSite).toBeUndefined();

    // The on-event self-enters-play handler should have added a
    // site-phase-do-nothing constraint targeting the active company.
    const constraints = current.activeConstraints.filter(
      c => c.kind.type === 'site-phase-do-nothing'
        && c.target.kind === 'company'
        && c.target.companyId === targetCompanyId,
    );
    expect(constraints).toHaveLength(1);
    expect(constraints[0].source).toBe(lifdInstance);
    expect(constraints[0].scope).toEqual({ kind: 'company-site-phase', companyId: targetCompanyId });
  });

  test('after playing Lost in Free-domains, the targeted company is locked into pass at enter-or-skip', () => {
    // Same as above, but transition into the Site phase after the
    // chain resolves and verify the constraint actually filters the
    // legal-action menu down to `pass` for the affected company.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [LOST_IN_FREE_DOMAINS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const targetCompanyId = companyIdAt(base, 0);
    const lifdInstance = handCardId(base, 1);

    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    const afterPlay = dispatch(stateAtPlayHazards, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: lifdInstance,
      targetCompanyId,
    });

    let current = afterPlay;
    for (let i = 0; i < 10 && current.chain !== null; i++) {
      const r = reduce(current, { type: 'pass-chain-priority', player: current.chain.priority });
      if (r.error) break;
      current = r.state;
    }
    expect(current.chain).toBeNull();

    // Transition into the Site phase at the enter-or-skip step for the
    // affected company. The constraint should filter the menu.
    const sitePhaseState: SitePhaseState = {
      phase: Phase.Site,
      step: 'enter-or-skip',
      activeCompanyIndex: 0,
      handledCompanyIds: [],
      automaticAttacksResolved: 0,
      siteEntered: false,
      resourcePlayed: false,
      minorItemAvailable: false,
      declaredAgentAttack: null,
      awaitingOnGuardReveal: false,
      pendingResourceAction: null,
      opponentInteractionThisTurn: null,
      pendingOpponentInfluence: null,
    };
    const stateAtSite = { ...current, phaseState: sitePhaseState };

    const actions = computeLegalActions(stateAtSite, PLAYER_1)
      .filter(ea => ea.viable)
      .map(ea => ea.action.type);
    expect(actions).toEqual(['pass']);
  });
});
