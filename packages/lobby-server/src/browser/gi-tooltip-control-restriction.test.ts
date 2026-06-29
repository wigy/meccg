/**
 * @module gi-tooltip-control-restriction.test
 *
 * Regression test for the General Influence info-box tooltip (game
 * mqzhpuzp-hvmzds, seq 154). A Troll-chief (le-45, printed mind 6) bearing
 * Wizard's Myrmidon (wh-84) requires only 3 points of influence to control
 * (CRF 22: "The character requires 3 points of influence to control"). The
 * engine's GI accounting correctly subtracts 3, but the GI tooltip listed the
 * character's mind instead, so its total disagreed with the displayed GI.
 *
 * The fix routes the tooltip through the same `control-restriction` cost
 * override the engine uses, so the counted cost (3) is shown — with the printed
 * mind in parentheses — and the tooltip total matches the engine's calculation.
 */

import './test-dom-bootstrap.js'; // must precede the render-player-names import (load-time window access)
import { describe, test, expect } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import type { CardDefinitionId, CardInstanceId, CharacterInPlay } from '@meccg/shared';
import { buildGITooltip } from './render-player-names.js';

const pool = loadCardPool();

const TROLL_CHIEF = 'le-45' as CardDefinitionId; // mind 6, race troll
const WIZARDS_MYRMIDON = 'wh-84' as CardDefinitionId; // control-restriction cost 3
const ANNALENA = 'tw-119' as CardDefinitionId; // mind 3, no restriction

/** Minimal CharacterInPlay under general influence; only fields the tooltip reads are set. */
function generalChar(
  definitionId: CardDefinitionId,
  instanceId: string,
  opts?: { effMind?: number; items?: CardDefinitionId[] },
): CharacterInPlay {
  return {
    instanceId: instanceId as CardInstanceId,
    definitionId,
    controlledBy: 'general',
    influenceUnsubtracted: false,
    effectiveStats: { mind: opts?.effMind },
    items: (opts?.items ?? []).map((d, i) => ({
      instanceId: `${instanceId}-i${i}` as CardInstanceId,
      definitionId: d,
    })),
  } as unknown as CharacterInPlay;
}

describe('GI tooltip honours control-restriction cost (Wizard\'s Myrmidon)', () => {
  test('a Troll-chief bearing Wizard\'s Myrmidon counts 3, not its mind', () => {
    const characters: Record<string, CharacterInPlay> = {
      'p1-94': generalChar(TROLL_CHIEF, 'p1-94', { items: [WIZARDS_MYRMIDON] }),
      'p1-103': generalChar(ANNALENA, 'p1-103'),
    };
    const html = buildGITooltip(characters, pool);

    // Troll-chief shows the override cost (3) with the printed mind (6) in parens.
    expect(html).toContain('3 (6)');
    // Total = 3 (Troll-chief override) + 3 (Annalena) = 6. Without the fix the
    // Troll-chief would be counted as its mind (6), giving a total of 9.
    expect(html).toContain('mp-total">6<');
  });

  test('without the restriction the printed mind is counted', () => {
    const characters: Record<string, CharacterInPlay> = {
      'p1-94': generalChar(TROLL_CHIEF, 'p1-94'),
    };
    const html = buildGITooltip(characters, pool);
    // No override -> printed mind 6 is the counted cost and the total.
    expect(html).toContain('mp-total">6<');
  });
});
