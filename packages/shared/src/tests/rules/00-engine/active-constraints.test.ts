/**
 * @module active-constraints
 *
 * Engine mechanics — active-constraint list.
 *
 * Exercises the public API via {@link computeLegalActions} and direct
 * calls to {@link addConstraint} / {@link sweepExpired}, validating
 * sweep semantics and the cross-target / cross-player filtering. The
 * card-level tests (tw-053, tw-084, tw-332) cover end-to-end behaviour
 * for each constraint kind; this file pins down the list mechanics.
 *
 * See `specs/pending-effects-plan.md` for the design.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  companyIdAt,
} from '../../test-helpers.js';
import {
  addConstraint,
  removeConstraint,
  constraintsOnCompany,
  sweepExpired,
} from '../../../engine/pending.js';
import type { CardInstanceId, CardDefinitionId, CompanyId } from '../../../index.js';

describe('Active constraints — list mechanics', () => {
  beforeEach(() => resetMint());

  test('addConstraint appends and assigns a unique id', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const targetCompanyId = companyIdAt(base, 0);
    const a = addConstraint(base, {
      source: 'a' as CardInstanceId,
      sourceDefinitionId: 'test-def' as CardDefinitionId,
      scope: { kind: 'company-site-phase', companyId: targetCompanyId },
      target: { kind: 'company', companyId: targetCompanyId },
      kind: { type: 'site-phase-do-nothing' },
    });
    const b = addConstraint(a, {
      source: 'b' as CardInstanceId,
      sourceDefinitionId: 'test-def' as CardDefinitionId,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId: targetCompanyId },
      kind: { type: 'no-creature-hazards-on-company' },
    });

    expect(b.activeConstraints).toHaveLength(2);
    const [first, second] = b.activeConstraints;
    expect(first.id).not.toBe(second.id);
    expect(constraintsOnCompany(b, targetCompanyId)).toHaveLength(2);
  });

  test('removeConstraint drops the targeted entry by id', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const targetCompanyId = companyIdAt(base, 0);
    const constrained = addConstraint(base, {
      source: 'a' as CardInstanceId,
      sourceDefinitionId: 'test-def' as CardDefinitionId,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId: targetCompanyId },
      kind: { type: 'no-creature-hazards-on-company' },
    });

    const id = constrained.activeConstraints[0].id;
    const removed = removeConstraint(constrained, id);
    expect(removed.activeConstraints).toHaveLength(0);
  });

  test('turn-end sweep clears turn-scoped constraints but leaves phase-scoped ones alone', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const targetCompanyId = companyIdAt(base, 0);
    let s = base;
    s = addConstraint(s, {
      source: 'turn-scoped' as CardInstanceId,
      sourceDefinitionId: 'test-def' as CardDefinitionId,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId: targetCompanyId },
      kind: { type: 'no-creature-hazards-on-company' },
    });
    s = addConstraint(s, {
      source: 'site-scoped' as CardInstanceId,
      sourceDefinitionId: 'test-def' as CardDefinitionId,
      scope: { kind: 'company-site-phase', companyId: targetCompanyId },
      target: { kind: 'company', companyId: targetCompanyId },
      kind: { type: 'site-phase-do-nothing' },
    });
    expect(s.activeConstraints).toHaveLength(2);

    const swept = sweepExpired(s, { kind: 'turn-end' });
    expect(swept.activeConstraints).toHaveLength(1);
    expect(swept.activeConstraints[0].kind.type).toBe('site-phase-do-nothing');
  });

  test('company-site-end sweep clears company-site-phase constraints for that company only', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const companyA = companyIdAt(base, 0);
    const companyB = 'company-other' as CompanyId;
    let s = base;
    s = addConstraint(s, {
      source: 'a' as CardInstanceId,
      sourceDefinitionId: 'test-def' as CardDefinitionId,
      scope: { kind: 'company-site-phase', companyId: companyA },
      target: { kind: 'company', companyId: companyA },
      kind: { type: 'site-phase-do-nothing' },
    });
    s = addConstraint(s, {
      source: 'b' as CardInstanceId,
      sourceDefinitionId: 'test-def' as CardDefinitionId,
      scope: { kind: 'company-site-phase', companyId: companyB },
      target: { kind: 'company', companyId: companyB },
      kind: { type: 'site-phase-do-nothing' },
    });
    expect(s.activeConstraints).toHaveLength(2);

    const swept = sweepExpired(s, { kind: 'company-site-end', companyId: companyA });
    expect(swept.activeConstraints).toHaveLength(1);
    expect(swept.activeConstraints[0].source).toBe('b');
  });

  test('until-cleared constraints are not removed by any sweep boundary', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const targetCompanyId = companyIdAt(base, 0);
    const persistent = addConstraint(base, {
      source: 'persistent' as CardInstanceId,
      sourceDefinitionId: 'test-def' as CardDefinitionId,
      scope: { kind: 'until-cleared' },
      target: { kind: 'company', companyId: targetCompanyId },
      kind: { type: 'site-phase-do-nothing' },
    });

    expect(sweepExpired(persistent, { kind: 'turn-end' }).activeConstraints).toHaveLength(1);
    expect(sweepExpired(persistent, { kind: 'company-site-end', companyId: targetCompanyId }).activeConstraints).toHaveLength(1);
    expect(sweepExpired(persistent, { kind: 'phase-end', phase: Phase.Site }).activeConstraints).toHaveLength(1);
  });
});
