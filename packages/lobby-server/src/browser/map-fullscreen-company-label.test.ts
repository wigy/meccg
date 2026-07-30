/**
 * @module map-fullscreen-company-label.test
 *
 * Regression test for bug report a3ece000086bd2b4 (game ms6gbt8d-5na91m, seq
 * 323): "Map says Glorfindel's company but all company view says Saruman's
 * company." The full-map overlay named a company after `company.characters[0]`
 * (array order), while the all-companies view names it via `getTitleCharacter`
 * (avatar first, then highest mind/MP/prowess). A company containing both
 * Saruman (a wizard avatar, `mind: null`) and Glorfindel II therefore got two
 * different names depending on which view rendered it.
 *
 * `companyLabel` must use the same title-character rule so both views agree.
 */

import './test-dom-bootstrap.js';
import { describe, test, expect } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import type { PlayerView, Company, CardDefinitionId, CardInstanceId, CompanyId, CharacterInPlay } from '@meccg/shared';
import { companyLabel } from './map-fullscreen.js';

const pool = loadCardPool();

const SARUMAN = 'tw-181' as CardDefinitionId; // wizard avatar, mind: null
const GLORFINDEL_II = 'tw-161' as CardDefinitionId; // mind: 8

const COMPANY_ID = 'company-p2-0' as CompanyId;
const SARUMAN_INST = 'p2-0' as CardInstanceId;
const GLORFINDEL_INST = 'p2-102' as CardInstanceId; // listed first in company.characters

function character(instanceId: CardInstanceId, definitionId: CardDefinitionId): CharacterInPlay {
  return {
    instanceId,
    definitionId,
    status: 'untapped',
    items: [],
    allies: [],
    hazards: [],
    followers: [],
    controlledBy: 'general',
    effectiveStats: { prowess: 0, body: 0 },
  } as unknown as CharacterInPlay;
}

// Glorfindel II listed first — this ordering is exactly what triggered the bug.
const company = {
  id: COMPANY_ID,
  characters: [GLORFINDEL_INST, SARUMAN_INST],
  currentSite: null,
  siteCardOwned: true,
  destinationSite: null,
  movementPath: [],
  onGuardCards: [],
  moved: false,
} as unknown as Company;

const view = {
  self: { id: 'p1', companies: [], characters: {}, cardsInPlay: [] },
  opponent: {
    id: 'p2',
    companies: [company],
    characters: {
      [GLORFINDEL_INST]: character(GLORFINDEL_INST, GLORFINDEL_II),
      [SARUMAN_INST]: character(SARUMAN_INST, SARUMAN),
    },
    cardsInPlay: [],
  },
  activePlayer: 'p1',
  phaseState: { phase: 'organization' },
  legalActions: [],
} as unknown as PlayerView;

describe('map-fullscreen companyLabel', () => {
  test('names the company after the avatar title character, not the first array entry', () => {
    expect(companyLabel(company, view, pool)).toBe(`Saruman's Company`);
  });
});
