/**
 * @module rule-metd-check-kinds
 *
 * METD §1.2 — Check-modifier kinds.
 *
 * The CheckModifierEffect's `check` field can be a single CheckKind
 * (existing usage) or an array of CheckKinds (METD generalization).
 * The array form lets one effect modify multiple check types — e.g.
 * Foolish Words (td-25): -4 to influence, riddling AND offering.
 */

import { describe, expect, test } from 'vitest';
import type { CheckKind } from '../../../index.js';
import { resolveCheckModifier } from '../../../engine/effects/index.js';
import type { CollectedEffect } from '../../../engine/effects/index.js';

function modifier(check: CheckKind | readonly CheckKind[], value: number): CollectedEffect {
  return {
    effect: { type: 'check-modifier', check, value },
    sourceDef: undefined as never,
    sourceInstance: 'src-1' as never,
  };
}

describe('METD §1.2 — Check kinds', () => {
  test('single-kind modifier still applies (existing behavior)', () => {
    const effects = [modifier('influence', -1)];
    expect(resolveCheckModifier(effects, 'influence')).toBe(-1);
    expect(resolveCheckModifier(effects, 'corruption')).toBe(0);
  });

  test('multi-kind modifier applies to each listed kind', () => {
    const effects = [modifier(['influence', 'riddling', 'offering'], -4)];
    expect(resolveCheckModifier(effects, 'influence')).toBe(-4);
    expect(resolveCheckModifier(effects, 'riddling')).toBe(-4);
    expect(resolveCheckModifier(effects, 'offering')).toBe(-4);
  });

  test('multi-kind modifier does NOT apply to unlisted kinds', () => {
    const effects = [modifier(['influence', 'riddling', 'offering'], -4)];
    expect(resolveCheckModifier(effects, 'corruption')).toBe(0);
    expect(resolveCheckModifier(effects, 'flattery')).toBe(0);
  });

  test('single-kind and multi-kind modifiers stack', () => {
    const effects = [
      modifier('influence', 1),
      modifier(['influence', 'riddling'], -4),
    ];
    expect(resolveCheckModifier(effects, 'influence')).toBe(-3);
    expect(resolveCheckModifier(effects, 'riddling')).toBe(-4);
  });
});
