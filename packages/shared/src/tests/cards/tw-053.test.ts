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
 * | 1 | Play target = company                    | DATA        | play-target target:"company"           |
 * | 2 | Adds site-phase-do-nothing constraint    | IMPLEMENTED | on-event self-enters-play apply        |
 * | 3 | Constraint collapses enter-or-skip menu  | IMPLEMENTED | constraint filter (legal-actions/pending) |
 * | 4 | Constraint clears at company-site-end    | IMPLEMENTED | sweepExpired in advanceSiteToNextCompany |
 * | 5 | Constraint does not affect other companies | IMPLEMENTED | constraint filter checks active company |
 *
 * Playable: PARTIAL — full play-from-hand wiring for play-target=company
 * is left as a follow-up. The constraint behaviour is fully tested.
 *
 * Certified: 2026-04-08
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  LOST_IN_FREE_DOMAINS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  pool,
} from '../test-helpers.js';
import type {
  CompanyId, HazardEventCard,
  SitePhaseState,
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

    const targetCompanyId = base.players[0].companies[0].id;

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

    const targetCompanyId = base.players[0].companies[0].id;
    const constrained = addConstraint(base, {
      source: 'lifd-1' as never,
      scope: { kind: 'company-site-phase', companyId: targetCompanyId },
      target: { kind: 'company', companyId: targetCompanyId },
      kind: { type: 'site-phase-do-nothing' },
    });
    expect(constrained.activeConstraints).toHaveLength(1);

    const swept = sweepExpired(constrained, { kind: 'company-site-end', companyId: targetCompanyId });
    expect(swept.activeConstraints).toHaveLength(0);
  });
});
