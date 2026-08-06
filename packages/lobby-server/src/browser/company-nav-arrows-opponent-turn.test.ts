/**
 * @module company-nav-arrows-opponent-turn.test
 *
 * Regression test for bug report 81ee70bf81fcef7e (game mshb5l69-65659o, seq
 * 275): "it stays in all company view, and even if I go to party view the
 * select left/right arrows to go to next company are gone."
 *
 * The reporter (p1) had 3 companies while the opponent (p2, active player at
 * the reported state) had only 1. `renderSingleView` picked the company list
 * to cycle through based on whose *turn* it was (`isSelfTurn`) rather than
 * which side the *focused* company belonged to. During the opponent's
 * movement/hazard phase, focusing one of the local player's own companies
 * (e.g. by clicking it in the forced all-companies overview) left
 * `cycleCompanies` pointing at the opponent's single-company list, so the
 * `cycleCompanies.length > 1` check failed and both nav arrows silently
 * disappeared even though the local player had two other companies to cycle
 * through.
 */

import './test-dom-bootstrap.js';
import { describe, test, expect } from 'vitest';
import type { Company, OpponentCompanyView } from '@meccg/shared';
import { getCycleCompanies } from './company-views.js';

describe('getCycleCompanies', () => {
  const selfCompanies = [
    { id: 'company-p1-0' },
    { id: 'company-p1-1' },
    { id: 'company-p1-2' },
  ] as unknown as Company[];
  const opponentCompanies = [{ id: 'company-p2-0' }] as unknown as OpponentCompanyView[];

  test('cycles through the local player\'s own companies when a self company is focused, even on the opponent\'s turn', () => {
    expect(getCycleCompanies('self', selfCompanies, opponentCompanies)).toBe(selfCompanies);
  });

  test('cycles through the opponent\'s companies when an opponent company is focused', () => {
    expect(getCycleCompanies('opponent', selfCompanies, opponentCompanies)).toBe(opponentCompanies);
  });
});
