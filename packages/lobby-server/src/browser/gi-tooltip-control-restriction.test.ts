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
const ROBIN = 'tw-179' as CardDefinitionId; // Robin Smallburrow, mind 3
const AWAIT_ADVENT = 'dm-117' as CardDefinitionId; // Await the Advent of Allies: general-influence-exempt

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
    const html = buildGITooltip(20, characters, pool);

    // The ledger opens with the pool.
    expect(html).toContain('General influence</td><td class="mp-value">20<');
    // Troll-chief shows the override cost (−3) with the printed mind (6) in parens.
    expect(html).toContain('−3 (6)');
    // Free = 20 − 3 (Troll-chief override) − 3 (Annalena) = 14. Without the fix
    // the Troll-chief would be counted as its mind (6), leaving 11.
    expect(html).toContain('mp-total">14<');
  });

  test('without the restriction the printed mind is counted', () => {
    const characters: Record<string, CharacterInPlay> = {
      'p1-94': generalChar(TROLL_CHIEF, 'p1-94'),
    };
    const html = buildGITooltip(20, characters, pool);
    // No override -> printed mind 6 is subtracted: free = 20 − 6.
    expect(html).toContain('−6');
    expect(html).toContain('mp-total">14<');
  });
});

describe('GI tooltip omits characters bearing Await the Advent of Allies (dm-117)', () => {
  // Regression for game mrs06zup-du4wde, seq 272: Robin Smallburrow (mind 3)
  // bearing Await the Advent of Allies "does not count against general
  // influence" (CRF 22). The engine drops his mind from the GI pool
  // (generalInfluenceUsed 17 -> 14), but the tooltip still counted it, so its
  // total disagreed with the displayed GI.
  test('Robin bearing Await the Advent of Allies consumes 0 GI', () => {
    const characters: Record<string, CharacterInPlay> = {
      'p1-99': generalChar(ROBIN, 'p1-99', { items: [AWAIT_ADVENT] }),
      'p1-103': generalChar(ANNALENA, 'p1-103'),
    };
    const html = buildGITooltip(20, characters, pool);
    // Robin is exempt and omitted entirely.
    expect(html).not.toContain('Robin Smallburrow');
    // Free = 20 − 3 (Annalena only); without the fix Robin's mind would also
    // be subtracted, leaving 14.
    expect(html).toContain('mp-total">17<');
  });

  test('the same character with no Await the Advent of Allies still counts', () => {
    const characters: Record<string, CharacterInPlay> = {
      'p1-99': generalChar(ROBIN, 'p1-99'),
    };
    const html = buildGITooltip(20, characters, pool);
    // Without the exempting card, Robin's mind (3) is counted normally.
    expect(html).toContain('Robin Smallburrow');
    expect(html).toContain('mp-total">17<');
  });
});

describe('GI ledger reflects a stage-resource/bonus-adjusted pool', () => {
  test('a 25-point pool (e.g. Bade to Rule +5) opens the ledger and feeds Free', () => {
    const characters: Record<string, CharacterInPlay> = {
      'p1-103': generalChar(ANNALENA, 'p1-103'),
    };
    const html = buildGITooltip(25, characters, pool);
    expect(html).toContain('General influence</td><td class="mp-value">25<');
    expect(html).toContain('mp-total">22<');
  });
});
