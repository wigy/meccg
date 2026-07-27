/**
 * @module ai/h2/core/rationale.test
 *
 * Explanations are a shipped output, not debug noise: the CLI prints them and
 * golden tests diff them. So the renderer's shape is pinned here, and so is
 * the tunable-collection helper that module tests use to enforce "no
 * anonymous constants".
 */

import { describe, test, expect } from 'vitest';
import { collectTunables, formatValue, leaf, node, renderRationale } from './rationale.js';

describe('formatting', () => {
  test('renders each unit the way its readers expect', () => {
    expect(formatValue(0.4167, 'p')).toBe('41.7%');
    expect(formatValue(0.024, 'winprob')).toBe('2.4%');
    expect(formatValue(1.75, 'tsd')).toBe('+1.8');
    expect(formatValue(-6, 'tsd')).toBe('-6.0');
    expect(formatValue(2, 'mp')).toBe('+2');
    expect(formatValue('Rivendell')).toBe('Rivendell');
  });
});

describe('rendering', () => {
  test('draws the derivation as a tree', () => {
    const tree = node('outcome', 0.417, [
      leaf('base prowess', 7),
      leaf('support', 1, { tunable: 'supportBonus' }),
    ], { unit: 'p', note: 'CoE 3.iv' });

    expect(renderRationale(tree)).toEqual([
      'outcome: 41.7%  [CoE 3.iv]',
      '├─ base prowess: 7',
      '└─ support: 1  {supportBonus}',
    ]);
  });

  test('nests deeper levels under the right connector', () => {
    const tree = node('a', 1, [
      node('b', 2, [leaf('c', 3)]),
      leaf('d', 4),
    ]);
    expect(renderRationale(tree)).toEqual([
      'a: 1',
      '├─ b: 2',
      '│  └─ c: 3',
      '└─ d: 4',
    ]);
  });

  test('honours a caller-supplied indent so it can be spliced into a report', () => {
    expect(renderRationale(leaf('x', 1), '  ')).toEqual(['  x: 1']);
  });
});

describe('constant tracing', () => {
  test('finds every tunable named anywhere in the tree', () => {
    const tree = node('root', 0, [
      leaf('a', 1, { tunable: 'potentialDiscount' }),
      node('b', 2, [leaf('c', 3, { tunable: 'softmaxTemperature' })]),
      leaf('d', 4),
    ]);
    expect(collectTunables(tree)).toEqual(new Set(['potentialDiscount', 'softmaxTemperature']));
  });

  test('is empty when every number came from the game rather than a constant', () => {
    expect(collectTunables(node('root', 0, [leaf('prowess', 7)]))).toEqual(new Set());
  });
});
