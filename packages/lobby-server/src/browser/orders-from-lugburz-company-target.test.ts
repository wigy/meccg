/**
 * @module orders-from-lugburz-company-target.test
 *
 * Regression test for bug f8996b0586d7cbdc: during the movement/hazard phase
 * of a Lieutenant of Angmar's company, clicking Orders from Lugbúrz (as-94) in
 * hand played it on the Orc Captain's company, which had already finished its
 * movement/hazard phase. The engine offers one `play-permanent-event` action
 * per eligible company (rule 2.IV.2 allows targeting another company), but the
 * hand renderer took the first such action. `findCardAction` now defaults a
 * company-targeting permanent event to the player's focused company.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardDefinitionId, CardInstanceId, CompanyId, GameAction } from '@meccg/shared';
import { findCardAction } from './render-hand.js';

const ORDERS = 'as-94' as CardDefinitionId;
const ORDERS_INSTANCE = 'p1-230' as CardInstanceId;

const ORC_CAPTAIN_COMPANY = 'company-p1-0' as CompanyId; // first in list, already moved
const OTHER_COMPANY = 'company-p1-1' as CompanyId;
const LIEUTENANT_COMPANY = 'company-p1-2' as CompanyId; // active / focused company

const lookup = (id: CardInstanceId): CardDefinitionId | undefined =>
  (id === ORDERS_INSTANCE ? ORDERS : undefined);

/** One play-permanent-event action per eligible company, as the engine emits. */
const companyActions: GameAction[] = [ORC_CAPTAIN_COMPANY, OTHER_COMPANY, LIEUTENANT_COMPANY].map(companyId => ({
  type: 'play-permanent-event',
  player: 'p1',
  cardInstanceId: ORDERS_INSTANCE,
  targetCompanyId: companyId,
})) as GameAction[];

describe('Orders from Lugbúrz company target defaults to the focused company', () => {
  test('targets the focused (active) company, not the first company', () => {
    const action = findCardAction(ORDERS, companyActions, lookup, undefined, LIEUTENANT_COMPANY);
    expect(action?.type).toBe('play-permanent-event');
    expect((action as { targetCompanyId?: CompanyId }).targetCompanyId).toBe(LIEUTENANT_COMPANY);
  });

  test('falls back to the first company when no company is focused', () => {
    const action = findCardAction(ORDERS, companyActions, lookup, undefined, undefined);
    expect((action as { targetCompanyId?: CompanyId }).targetCompanyId).toBe(ORC_CAPTAIN_COMPANY);
  });
});
