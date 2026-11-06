/**
 * @module roused-influence-variant-labels.test
 *
 * Regression test for bug report ae1250fd67723f1a (game mvwygofe-tehqzz,
 * Itangast Roused as-117): the Dragon "Roused" factions let the influencer
 * discard a major item (+4) or a greater item (+8), so the engine emits one
 * extra influence-attempt variant per eligible carried item. The board's
 * disambiguation menu labelled every non-leader-control variant
 * "Influence (tap site)", so the player saw three identical options and could
 * not tell which one discarded which item. Each label now names the discarded
 * item, its bonus, and the roll needed.
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardInstanceId, GameAction } from '@meccg/shared';
import { findInfluenceVariants, influenceVariantLabel } from './company-block.js';

const ITANGAST = 'p1-61' as CardInstanceId;   // as-117 Itangast Roused in hand
const LIEUTENANT = 'p1-244' as CardInstanceId; // Lieutenant of Angmar, the influencer
const HIGH_HELM = 'p1-15' as CardInstanceId;   // a major item
const GREATER_ITEM = 'p1-16' as CardInstanceId; // a greater item
const SUPPORTER = 'p1-8' as CardInstanceId;     // a company-mate tapping in support

const NAMES: Record<string, string> = {
  [HIGH_HELM]: 'High Helm',
  [GREATER_ITEM]: 'Black Mace',
  [SUPPORTER]: 'Orc Captain',
};
const nameOf = (id: CardInstanceId): string => NAMES[id as string] ?? (id as string);

/** The variants the engine emits for the influencer (mirrors the seq-2446 log). */
const variants: GameAction[] = [
  {
    type: 'influence-attempt', player: 'p1',
    factionInstanceId: ITANGAST, influencingCharacterId: LIEUTENANT,
    need: 6, explanation: 'Need roll >= 6',
  },
  {
    type: 'influence-attempt', player: 'p1',
    factionInstanceId: ITANGAST, influencingCharacterId: LIEUTENANT,
    need: 2, explanation: 'Need roll >= 2 — discard major item "High Helm" for +4',
    discardForBonus: { itemInstanceId: HIGH_HELM, value: 4 },
  },
  {
    type: 'influence-attempt', player: 'p1',
    factionInstanceId: ITANGAST, influencingCharacterId: LIEUTENANT,
    need: -2, explanation: 'Need roll >= -2 — discard greater item "Black Mace" for +8',
    discardForBonus: { itemInstanceId: GREATER_ITEM, value: 8 },
  },
  {
    type: 'influence-attempt', player: 'p1',
    factionInstanceId: ITANGAST, influencingCharacterId: LIEUTENANT,
    need: 4, explanation: 'Need roll >= 4 — Orc Captain taps in support',
    supportCharacterId: SUPPORTER,
  },
] as GameAction[];

describe('Itangast Roused (as-117) influence variants are distinguishable in the UI', () => {
  test('every variant gets a distinct label', () => {
    const found = findInfluenceVariants(variants, ITANGAST, LIEUTENANT);
    expect(found).toHaveLength(4);
    const labels = found.map(v => influenceVariantLabel(v, nameOf));
    expect(new Set(labels).size).toBe(4);
  });

  test('labels name the discarded item, its bonus and the roll needed', () => {
    const labels = findInfluenceVariants(variants, ITANGAST, LIEUTENANT)
      .map(v => influenceVariantLabel(v, nameOf));
    expect(labels).toEqual([
      'Influence (tap site, need 6+)',
      'Discard High Helm for +4 (tap site, need 2+)',
      'Discard Black Mace for +8 (tap site, need -2+)',
      'Orc Captain taps in support (tap site, need 4+)',
    ]);
  });
});
