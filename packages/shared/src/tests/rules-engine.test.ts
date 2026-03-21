/**
 * @module rules-engine.test
 *
 * Tests for the rules engine: template rendering, rule evaluation,
 * and the new comparison operators added to the condition matcher.
 */

import { describe, it, expect } from 'vitest';
import { matchesCondition } from '../effects/condition-matcher.js';
import { renderTemplate } from '../rules/template.js';
import { evaluateRules, evaluateAction } from '../rules/evaluator.js';
import type { Condition } from '../types/effects.js';
import type { RuleSet } from '../rules/types.js';
import type { GameAction } from '../types/actions.js';

// ---- Comparison operators ----

describe('comparison operators', () => {
  it('$gt matches when greater', () => {
    const cond: Condition = { value: { $gt: 5 } };
    expect(matchesCondition(cond, { value: 6 })).toBe(true);
    expect(matchesCondition(cond, { value: 5 })).toBe(false);
    expect(matchesCondition(cond, { value: 4 })).toBe(false);
  });

  it('$gte matches when greater or equal', () => {
    const cond: Condition = { value: { $gte: 5 } };
    expect(matchesCondition(cond, { value: 6 })).toBe(true);
    expect(matchesCondition(cond, { value: 5 })).toBe(true);
    expect(matchesCondition(cond, { value: 4 })).toBe(false);
  });

  it('$lt matches when less', () => {
    const cond: Condition = { value: { $lt: 5 } };
    expect(matchesCondition(cond, { value: 4 })).toBe(true);
    expect(matchesCondition(cond, { value: 5 })).toBe(false);
    expect(matchesCondition(cond, { value: 6 })).toBe(false);
  });

  it('$lte matches when less or equal', () => {
    const cond: Condition = { value: { $lte: 5 } };
    expect(matchesCondition(cond, { value: 4 })).toBe(true);
    expect(matchesCondition(cond, { value: 5 })).toBe(true);
    expect(matchesCondition(cond, { value: 6 })).toBe(false);
  });

  it('$ne matches when not equal', () => {
    const cond: Condition = { value: { $ne: 'orc' } };
    expect(matchesCondition(cond, { value: 'elf' })).toBe(true);
    expect(matchesCondition(cond, { value: 'orc' })).toBe(false);
  });

  it('$ne works with null', () => {
    const cond: Condition = { value: { $ne: null } };
    expect(matchesCondition(cond, { value: 5 })).toBe(true);
    expect(matchesCondition(cond, { value: null })).toBe(false);
  });

  it('$in matches when value is in array', () => {
    const cond: Condition = { value: { $in: ['a', 'b', 'c'] } };
    expect(matchesCondition(cond, { value: 'b' })).toBe(true);
    expect(matchesCondition(cond, { value: 'd' })).toBe(false);
  });

  it('$gt rejects non-numeric context values', () => {
    const cond: Condition = { value: { $gt: 5 } };
    expect(matchesCondition(cond, { value: 'six' })).toBe(false);
  });

  it('comparison operators work with dot paths', () => {
    const cond: Condition = { 'ctx.projectedMind': { $lte: 20 } };
    expect(matchesCondition(cond, { ctx: { projectedMind: 18 } })).toBe(true);
    expect(matchesCondition(cond, { ctx: { projectedMind: 21 } })).toBe(false);
  });
});

// ---- Template rendering ----

describe('renderTemplate', () => {
  it('replaces simple placeholders', () => {
    expect(renderTemplate('Hello {{name}}', { name: 'Gandalf' })).toBe('Hello Gandalf');
  });

  it('replaces dot-path placeholders', () => {
    const ctx = { card: { name: 'Gimli', mind: 6 } };
    expect(renderTemplate('{{card.name}} has mind {{card.mind}}', ctx)).toBe('Gimli has mind 6');
  });

  it('renders ??? for missing values', () => {
    expect(renderTemplate('{{missing}}', {})).toBe('???');
  });

  it('handles multiple placeholders', () => {
    const ctx = { a: 1, b: 2 };
    expect(renderTemplate('{{a}} + {{b}}', ctx)).toBe('1 + 2');
  });

  it('passes through text without placeholders', () => {
    expect(renderTemplate('no placeholders here', {})).toBe('no placeholders here');
  });
});

// ---- Rule evaluator ----

describe('evaluateRules', () => {
  const rules: RuleSet = {
    name: 'Test Rules',
    rules: [
      {
        id: 'must-be-character',
        condition: { 'card.isCharacter': true },
        failMessage: '{{card.name}} is not a character',
      },
      {
        id: 'mind-limit',
        condition: { 'ctx.projectedMind': { $lte: 20 } },
        failMessage: '{{card.name}}: mind {{card.mind}} would exceed limit ({{ctx.currentMind}} + {{card.mind}} > 20)',
      },
    ],
  };

  it('returns undefined when all rules pass', () => {
    const ctx = { card: { name: 'Gimli', isCharacter: true, mind: 6 }, ctx: { projectedMind: 18, currentMind: 12 } };
    expect(evaluateRules(rules, ctx)).toBeUndefined();
  });

  it('returns first failing rule message', () => {
    const ctx = { card: { name: 'Sting', isCharacter: false, mind: 0 }, ctx: { projectedMind: 0, currentMind: 0 } };
    expect(evaluateRules(rules, ctx)).toBe('Sting is not a character');
  });

  it('returns second rule failure when first passes', () => {
    const ctx = { card: { name: 'Gimli', isCharacter: true, mind: 6 }, ctx: { projectedMind: 22, currentMind: 16 } };
    expect(evaluateRules(rules, ctx)).toBe('Gimli: mind 6 would exceed limit (16 + 6 > 20)');
  });
});

describe('evaluateAction', () => {
  const rules: RuleSet = {
    name: 'Simple Rule',
    rules: [
      {
        id: 'check',
        condition: { ok: true },
        failMessage: 'Not ok',
      },
    ],
  };

  it('returns viable action when rules pass', () => {
    const action = { type: 'draft-stop', player: 'p1' } as unknown as GameAction;
    const result = evaluateAction(action, rules, { ok: true });
    expect(result).toEqual({ action, viable: true });
    expect(result.reason).toBeUndefined();
  });

  it('returns non-viable action with reason when rules fail', () => {
    const action = { type: 'draft-stop', player: 'p1' } as unknown as GameAction;
    const result = evaluateAction(action, rules, { ok: false });
    expect(result).toEqual({ action, viable: false, reason: 'Not ok' });
  });
});
