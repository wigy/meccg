/**
 * @module rule-metd-hoard-minor-starting-company
 *
 * METD §3 — Hoard minor items may not be included in a starting company
 * (i.e. cannot be assigned during the item-draft phase, even though they
 * are minor and structurally eligible).
 */

import { describe, test, expect } from 'vitest';
import type { CardDefinitionId } from '../../../index.js';
import { evaluateAction, ITEM_DRAFT_RULES } from '../../../index.js';

const ADAMANT_HELMET = 'td-96' as CardDefinitionId; // hoard, minor, non-unique
const DAGGER_OF_WESTERNESSE = 'tw-206' as CardDefinitionId; // non-hoard, minor, non-unique

describe('METD §3 — Hoard minor items rejected from starting company', () => {
  test('Adamant Helmet (hoard) is rejected as a starting item', () => {
    const result = evaluateAction(
      { type: 'assign-starting-item' as const, player: 'p1' as never, itemDefId: ADAMANT_HELMET, characterInstanceId: 'p1-0' as never },
      ITEM_DRAFT_RULES,
      {
        card: { name: 'Adamant Helmet', isItem: true, unique: false, isHoard: true },
        ctx: { assignedCount: 0, maxStartingItems: 2 },
      },
    );
    expect(result.viable).toBe(false);
    expect(result.reason).toMatch(/hoard/i);
  });

  test('Dagger of Westernesse (non-hoard) is accepted as a starting item', () => {
    const result = evaluateAction(
      { type: 'assign-starting-item' as const, player: 'p1' as never, itemDefId: DAGGER_OF_WESTERNESSE, characterInstanceId: 'p1-0' as never },
      ITEM_DRAFT_RULES,
      {
        card: { name: 'Dagger of Westernesse', isItem: true, unique: false, isHoard: false },
        ctx: { assignedCount: 0, maxStartingItems: 2 },
      },
    );
    expect(result.viable).toBe(true);
  });
});
