/**
 * @module daelomin-at-home-discard.test
 *
 * Regression test for bug report e2bc7fa448678d09 (game mrahfk9s-eaeybx, seq
 * 256): Daelomin at Home (td-11), a Dragon "At Home" permanent event, was
 * certified in the engine but never wired into the browser UI. wigy reported
 * three symptoms:
 *
 *   1. "No UI for discarding it." — the cards-in-play row rendered the permanent
 *      as a plain image with no click handler, so the only way to trigger the
 *      `discard-card-for-hazard-limit` action was the raw debug action panel.
 *   2. "Action text has p1 and p2 instead of names." — reaching the action only
 *      through the raw panel surfaced bare ids; the described action must use
 *      the player/company name maps.
 *   3. "It did not increase HL when discarded." — the hazard-limit display read
 *      the at-reveal snapshot directly, ignoring the mid-phase
 *      `hazard-limit-modifier` constraint the discard adds, so the shown
 *      remaining count never went up (even though the engine applied the +2).
 *
 * The engine was correct (it moves the card to the discard pile and adds a
 * `hazard-limit-modifier` constraint); these are the client-side fixes:
 * `findDiscardForHazardLimitAction` (board click handler), `getHazardLimitLabel`
 * folding in the constraint via `effectiveHazardLimit`, and `describeAction`
 * resolving names.
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect } from 'vitest';
import { Phase, describeAction, loadCardPool } from '@meccg/shared';
import type { CardInstanceId, CardDefinitionId, GameAction, PlayerView, ActiveConstraint } from '@meccg/shared';
import { findDiscardForHazardLimitAction } from './company-block.js';
import { getHazardLimitLabel } from './render-player-names.js';

const DAELOMIN_AT_HOME = 'p1-44' as CardInstanceId; // td-11, the permanent in play
const OTHER_PERMANENT = 'p1-42' as CardInstanceId;
const TARGET_COMPANY = 'company-p2-0';

const discardAction: GameAction = {
  type: 'discard-card-for-hazard-limit',
  player: 'p1',
  cardInstanceId: DAELOMIN_AT_HOME,
  targetCompanyId: TARGET_COMPANY,
} as GameAction;

describe('findDiscardForHazardLimitAction surfaces Daelomin at Home on the board', () => {
  test('returns the discard action for the card in play', () => {
    expect(findDiscardForHazardLimitAction([discardAction], DAELOMIN_AT_HOME)).toEqual(discardAction);
  });

  test('returns null when no discard action targets that card', () => {
    expect(findDiscardForHazardLimitAction([discardAction], OTHER_PERMANENT)).toBeNull();
    expect(findDiscardForHazardLimitAction([], DAELOMIN_AT_HOME)).toBeNull();
  });
});

const boostConstraint: ActiveConstraint = {
  id: 'c-251-mrahy90v',
  source: DAELOMIN_AT_HOME,
  sourceDefinitionId: 'td-11' as CardDefinitionId,
  target: { kind: 'company', companyId: TARGET_COMPANY },
  kind: { type: 'hazard-limit-modifier', value: 2 },
  scope: { kind: 'company-mh-phase', companyId: TARGET_COMPANY },
} as unknown as ActiveConstraint;

const viewWith = (constraints: readonly ActiveConstraint[]): PlayerView =>
  ({
    activePlayer: 'p2',
    self: { id: 'p1', companies: [] },
    opponent: { id: 'p2', companies: [{ id: TARGET_COMPANY }] },
    activeConstraints: constraints,
    phaseState: {
      phase: Phase.MovementHazard,
      step: 'play-hazards',
      activeCompanyIndex: 0,
      hazardLimitAtReveal: 4,
      preRevealHazardLimitConstraintIds: [],
      hazardsPlayedThisCompany: 0,
    },
  }) as unknown as PlayerView;

describe('getHazardLimitLabel reflects a Daelomin at Home discard', () => {
  test('shows the at-reveal limit before any discard', () => {
    expect(getHazardLimitLabel(viewWith([]))).toBe('4');
  });

  test('folds the +2 hazard-limit-modifier into the displayed remaining limit', () => {
    expect(getHazardLimitLabel(viewWith([boostConstraint]))).toBe('6');
  });
});

describe('describeAction renders names, not raw player/company ids', () => {
  test('resolves the acting player and target company via the name maps', () => {
    const cardPool = loadCardPool();
    const instanceLookup = (id: CardInstanceId): CardDefinitionId | undefined =>
      (id === DAELOMIN_AT_HOME ? ('td-11' as CardDefinitionId) : undefined);
    const desc = describeAction(
      discardAction,
      cardPool,
      instanceLookup,
      { [TARGET_COMPANY]: "Elrond's company" },
      { p1: 'wigy', p2: 'AI-Smart' },
    );
    expect(desc).toContain('wigy');
    expect(desc).toContain("Elrond's company");
    expect(desc).toContain('Daelomin at Home');
    expect(desc).not.toContain('p1');
    expect(desc).not.toContain('p2');
    expect(desc).not.toContain('company-');
  });
});
