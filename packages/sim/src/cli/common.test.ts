/**
 * @module cli/common.test
 *
 * The agent-spec grammar, which is the only channel a strength gate has.
 *
 * `gate` spawns `tsx` children and hands each one an agent *spec* — not an
 * options object — so anything a gate needs to vary has to be expressible as a
 * string. That makes the parser load-bearing in a way a CLI parser usually is
 * not: a spec that silently drops the part it did not understand rates the
 * shipped defaults against themselves and reports a dead heat, which looks
 * exactly like a real answer.
 */

import { describe, test, expect } from 'vitest';
import { resolveAgent } from './common.js';

describe('h2 tunable overrides', () => {
  test('are named in the agent name, so a gate says what it rated', () => {
    expect(resolveAgent('h2').name).toBe('h2');
    expect(resolveAgent('h2:all/tapTempoCost=0.6').name).toBe('h2/tapTempoCost=0.6');
  });

  test('accept more than one, and keep the module selector', () => {
    expect(resolveAgent('h2:combat,kill/tapTempoCost=0.6/resourceDrawValue=0.5').name)
      .toBe('h2:combat,kill/tapTempoCost=0.6/resourceDrawValue=0.5');
  });

  test('reject the fallback operator: H2 answers every decision itself now', () => {
    expect(() => resolveAgent('h2:all/tapTempoCost=0.6+mc:rollouts=4/turns=1'))
      .toThrow(/h2 no longer composes a fallback/);
  });

  test('reject the yielding operator: H2 answers every decision itself now', () => {
    expect(() => resolveAgent('h2>mc:rollouts=4/turns=1')).toThrow(/h2 no longer composes a fallback/);
    expect(() => resolveAgent('h2:combat,kill/tapTempoCost=0.6>mc')).toThrow(/h2 no longer composes a fallback/);
  });

  test('reject an unknown name rather than quietly rating the defaults', () => {
    expect(() => resolveAgent('h2:all/tapTemp=0.6')).toThrow(/Unknown tunable/);
  });

  test('reject a non-numeric value', () => {
    expect(() => resolveAgent('h2:all/tapTempoCost=high')).toThrow(/expects a number/);
  });

  test('reject a parameter with no value at all', () => {
    expect(() => resolveAgent('h2:all/tapTempoCost')).toThrow(/name=value/);
  });
});
