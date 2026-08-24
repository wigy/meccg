/**
 * @module action-redaction.test
 *
 * Regression tests for {@link redactActionForAudience} — the helper
 * `broadcastState` applies to `lastAction` for every recipient other than the
 * acting player. Instance ids are stable for the whole game and often
 * resolvable from earlier public broadcasts, so shipping the raw action would
 * let the audience recover private choices (a face-down movement destination,
 * a fetched card's identity) even though the toast defs map already omits
 * them.
 */

import { describe, test, expect } from 'vitest';
import { redactActionForAudience } from '@meccg/shared';
import type { GameAction, PlayerId, CardInstanceId, CompanyId } from '@meccg/shared';

const ALICE = 'p1' as PlayerId;

describe('redactActionForAudience', () => {
  test('strips the face-down movement destination from plan-movement (CoE 2.II.7)', () => {
    const action = {
      type: 'plan-movement',
      player: ALICE,
      companyId: 'company-1' as CompanyId,
      destinationSite: 'p1-42' as CardInstanceId,
    } as unknown as GameAction;

    const redacted = redactActionForAudience(action) as unknown as Record<string, unknown>;
    expect(redacted.type).toBe('plan-movement');
    expect(redacted.player).toBe(ALICE);
    expect(redacted.companyId).toBe('company-1');
    expect('destinationSite' in redacted).toBe(false);
  });

  test('strips the fetched card identity from fetch-from-pile', () => {
    const action = {
      type: 'fetch-from-pile',
      player: ALICE,
      source: 'discard',
      cardInstanceId: 'p1-7' as CardInstanceId,
    } as unknown as GameAction;

    const redacted = redactActionForAudience(action) as unknown as Record<string, unknown>;
    expect('cardInstanceId' in redacted).toBe(false);
    expect(redacted.source).toBe('discard');
  });

  test('strips both instance ids from exchange-sideboard and the arranged card from arrange-deck-top-card', () => {
    const exchange = redactActionForAudience({
      type: 'exchange-sideboard',
      player: ALICE,
      discardCardInstanceId: 'p1-8' as CardInstanceId,
      sideboardCardInstanceId: 'p1-9' as CardInstanceId,
    } as unknown as GameAction) as unknown as Record<string, unknown>;
    expect('discardCardInstanceId' in exchange).toBe(false);
    expect('sideboardCardInstanceId' in exchange).toBe(false);

    const arrange = redactActionForAudience({
      type: 'arrange-deck-top-card',
      player: ALICE,
      cardInstanceId: 'p1-10' as CardInstanceId,
    } as unknown as GameAction) as unknown as Record<string, unknown>;
    expect('cardInstanceId' in arrange).toBe(false);
  });

  test('returns actions without private fields unchanged (same reference)', () => {
    const action = { type: 'pass', player: ALICE } as GameAction;
    expect(redactActionForAudience(action)).toBe(action);
  });
});
