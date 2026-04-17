/**
 * @module pending-resolutions
 *
 * Engine mechanics — pending-resolution queue.
 *
 * Exercises the public API via {@link computeLegalActions} and direct
 * calls to {@link enqueueResolution} / {@link sweepExpired}, validating
 * the per-actor short-circuit and the FIFO drain order. The card-level
 * tests (tw-015, tw-060, tw-127, tw-375, etc.) cover end-to-end
 * behaviour through the reducer; this file pins down the queue
 * mechanics on their own so a regression in the helper module is
 * caught immediately.
 *
 * See `specs/2026-04-08-pending-effects-plan.md` for the design.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  charIdAt, companyIdAt, RESOURCE_PLAYER,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../engine/legal-actions/index.js';
import {
  enqueueResolution,
  topResolutionFor,
  pendingResolutionsFor,
  dequeueResolution,
  sweepExpired,
} from '../../../engine/pending.js';
import type { CardInstanceId } from '../../../index.js';

describe('Pending resolutions — queue mechanics', () => {
  beforeEach(() => resetMint());

  test('topResolutionFor returns the first entry queued for the actor', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(topResolutionFor(base, PLAYER_1)).toBeNull();

    const aragornId = charIdAt(base, RESOURCE_PLAYER);
    const queued = enqueueResolution(base, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      kind: {
        type: 'corruption-check',
        characterId: aragornId,
        modifier: 0,
        reason: 'Test',
        possessions: [],
        transferredItemId: null,
      },
    });

    const top = topResolutionFor(queued, PLAYER_1);
    expect(top).not.toBeNull();
    expect(top!.actor).toBe(PLAYER_1);
    expect(top!.kind.type).toBe('corruption-check');
  });

  test('FIFO drain order: first queued is the one returned by topResolutionFor', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = charIdAt(base, RESOURCE_PLAYER);

    const r1 = enqueueResolution(base, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      kind: { type: 'corruption-check', characterId: aragornId, modifier: 0, reason: 'first', possessions: [], transferredItemId: null },
    });
    const r2 = enqueueResolution(r1, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      kind: { type: 'corruption-check', characterId: aragornId, modifier: 0, reason: 'second', possessions: [], transferredItemId: null },
    });

    const all = pendingResolutionsFor(r2, PLAYER_1);
    expect(all).toHaveLength(2);
    const top = topResolutionFor(r2, PLAYER_1)!;
    expect(top.kind.type === 'corruption-check' && top.kind.reason).toBe('first');

    const afterDequeue = dequeueResolution(r2, top.id);
    const nextTop = topResolutionFor(afterDequeue, PLAYER_1)!;
    expect(nextTop.kind.type === 'corruption-check' && nextTop.kind.reason).toBe('second');
  });

  test('per-actor short-circuit: while a resolution is queued for player A, player B has no actions and player A has only the resolution action', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = charIdAt(base, RESOURCE_PLAYER);
    const queued = enqueueResolution(base, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      kind: { type: 'corruption-check', characterId: aragornId, modifier: 0, reason: 'Transfer', possessions: [], transferredItemId: null },
    });

    // Player A: collapsed to a single corruption-check action
    const aActions = computeLegalActions(queued, PLAYER_1).filter(ea => ea.viable);
    expect(aActions).toHaveLength(1);
    expect(aActions[0].action.type).toBe('corruption-check');

    // Player B: no legal actions while A is resolving
    const bActions = computeLegalActions(queued, PLAYER_2).filter(ea => ea.viable);
    expect(bActions).toHaveLength(0);
  });

  test('phase-end sweep clears phase-scoped resolutions for that phase', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = charIdAt(base, RESOURCE_PLAYER);
    const orgScoped = enqueueResolution(base, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      kind: { type: 'corruption-check', characterId: aragornId, modifier: 0, reason: 'Test', possessions: [], transferredItemId: null },
    });
    expect(orgScoped.pendingResolutions).toHaveLength(1);

    const swept = sweepExpired(orgScoped, { kind: 'phase-end', phase: Phase.Organization });
    expect(swept.pendingResolutions).toHaveLength(0);
  });

  test('company-site-end sweep clears company-site-subphase resolutions for that company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = charIdAt(base, RESOURCE_PLAYER);
    const targetCompanyId = companyIdAt(base, RESOURCE_PLAYER);
    const queued = enqueueResolution(base, {
      source: 'creature-1' as CardInstanceId,
      actor: PLAYER_1,
      scope: { kind: 'company-site-subphase', companyId: targetCompanyId },
      kind: { type: 'corruption-check', characterId: aragornId, modifier: -2, reason: 'Wound', possessions: [], transferredItemId: null },
    });

    const swept = sweepExpired(queued, { kind: 'company-site-end', companyId: targetCompanyId });
    expect(swept.pendingResolutions).toHaveLength(0);
  });

  test('sweep does not clear resolutions outside its scope', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = charIdAt(base, RESOURCE_PLAYER);
    // Phase-scoped to Organization — should NOT be cleared by a Site
    // company-site-end sweep.
    const orgScoped = enqueueResolution(base, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      kind: { type: 'corruption-check', characterId: aragornId, modifier: 0, reason: 'Transfer', possessions: [], transferredItemId: null },
    });

    const swept = sweepExpired(orgScoped, { kind: 'company-site-end', companyId: companyIdAt(base, RESOURCE_PLAYER) });
    expect(swept.pendingResolutions).toHaveLength(1);
  });
});
