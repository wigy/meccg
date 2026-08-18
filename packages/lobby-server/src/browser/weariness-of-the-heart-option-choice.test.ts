/**
 * @module weariness-of-the-heart-option-choice.test
 *
 * Regression test for bug report 03e85bc501c15064: a hazard card that
 * declares multiple mutually-exclusive `play-option` effects on the same
 * target — e.g. Weariness of the Heart (prowess-penalty vs. corruption-check)
 * — yields one `play-hazard` legal action per (character, option) pair. The
 * board renderer's character-click handler used `viableActions(...).find(...)`
 * to resolve the click, so it always fired the first-declared option
 * ("prowess") and the corruption-check option was silently unreachable —
 * matching game msz5cyv2-24cn56 seq 1394, where a play-hazard action was
 * dispatched with `optionId: "prowess"` even though the reporter intended the
 * corruption check. `findHazardVariants` now returns all variants so the
 * click handler can present a disambiguation menu.
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardInstanceId, GameAction } from '@meccg/shared';
import { findHazardVariants, hazardVariantLabel } from './company-block.js';

const WEARINESS = 'p1-69' as CardInstanceId; // le-149 hazard card in hand
const THRANDUIL = 'p2-109' as CardInstanceId; // tw-184, the targeted character
const OTHER_CHAR = 'p2-2' as CardInstanceId; // a character in a different company

/** The two variants the engine emits for a Weariness of the Heart target (mirrors the seq-1394 log). */
const variants: GameAction[] = [
  {
    type: 'play-hazard',
    player: 'p1',
    cardInstanceId: WEARINESS,
    targetCompanyId: 'company-p2-1',
    targetCharacterId: THRANDUIL,
    optionId: 'prowess',
  },
  {
    type: 'play-hazard',
    player: 'p1',
    cardInstanceId: WEARINESS,
    targetCompanyId: 'company-p2-1',
    targetCharacterId: THRANDUIL,
    optionId: 'corruption',
  },
] as GameAction[];

describe('Weariness of the Heart option choice is reachable in the UI', () => {
  test('both play-option variants are surfaced for the targeted character', () => {
    const found = findHazardVariants(variants, WEARINESS, THRANDUIL);
    expect(found).toHaveLength(2);
    expect(found.some(v => v.optionId === 'prowess')).toBe(true);
    expect(found.some(v => v.optionId === 'corruption')).toBe(true);
  });

  test('variants for an unrelated character are not returned', () => {
    expect(findHazardVariants(variants, WEARINESS, OTHER_CHAR)).toHaveLength(0);
  });

  test('each option has a distinct, descriptive label', () => {
    const found = findHazardVariants(variants, WEARINESS, THRANDUIL);
    const labels = found.map(hazardVariantLabel);
    expect(new Set(labels).size).toBe(2);
    expect(labels).toContain('Corruption');
    expect(labels).toContain('Prowess');
  });
});
