/**
 * @module condition-matcher.test
 *
 * Tests for the condition matcher that evaluates DSL conditions
 * against context objects.
 */

import { describe, it, expect } from 'vitest';
import { matchesCondition } from '../effects/condition-matcher.js';
import type { Condition } from '../types/effects.js';

describe('matchesCondition', () => {
  describe('simple equality', () => {
    it('matches a single string key', () => {
      const condition: Condition = { reason: 'combat' };
      expect(matchesCondition(condition, { reason: 'combat' })).toBe(true);
    });

    it('rejects on mismatch', () => {
      const condition: Condition = { reason: 'combat' };
      expect(matchesCondition(condition, { reason: 'influence-check' })).toBe(false);
    });

    it('rejects when key is missing from context', () => {
      const condition: Condition = { reason: 'combat' };
      expect(matchesCondition(condition, {})).toBe(false);
    });

    it('matches numeric values', () => {
      const condition: Condition = { value: 42 };
      expect(matchesCondition(condition, { value: 42 })).toBe(true);
    });

    it('matches boolean values', () => {
      const condition: Condition = { active: true };
      expect(matchesCondition(condition, { active: true })).toBe(true);
    });
  });

  describe('dot-path resolution', () => {
    it('resolves nested object paths', () => {
      const condition: Condition = { 'bearer.race': 'hobbit' };
      const context = { bearer: { race: 'hobbit', name: 'Frodo' } };
      expect(matchesCondition(condition, context)).toBe(true);
    });

    it('resolves deeply nested paths', () => {
      const condition: Condition = { 'a.b.c': 'deep' };
      const context = { a: { b: { c: 'deep' } } };
      expect(matchesCondition(condition, context)).toBe(true);
    });

    it('returns false for missing intermediate path segment', () => {
      const condition: Condition = { 'bearer.race': 'hobbit' };
      expect(matchesCondition(condition, { bearer: undefined })).toBe(false);
    });
  });

  describe('implicit AND (multiple keys)', () => {
    it('matches when all keys match', () => {
      const condition: Condition = { reason: 'combat', 'enemy.race': 'orc' };
      const context = { reason: 'combat', enemy: { race: 'orc' } };
      expect(matchesCondition(condition, context)).toBe(true);
    });

    it('rejects when one key mismatches', () => {
      const condition: Condition = { reason: 'combat', 'enemy.race': 'orc' };
      const context = { reason: 'combat', enemy: { race: 'nazgul' } };
      expect(matchesCondition(condition, context)).toBe(false);
    });
  });

  describe('$and operator', () => {
    it('matches when all sub-conditions match', () => {
      const condition: Condition = {
        $and: [{ reason: 'combat' }, { 'enemy.race': 'orc' }],
      };
      const context = { reason: 'combat', enemy: { race: 'orc' } };
      expect(matchesCondition(condition, context)).toBe(true);
    });

    it('rejects when any sub-condition fails', () => {
      const condition: Condition = {
        $and: [{ reason: 'combat' }, { 'enemy.race': 'orc' }],
      };
      const context = { reason: 'influence-check', enemy: { race: 'orc' } };
      expect(matchesCondition(condition, context)).toBe(false);
    });
  });

  describe('$or operator', () => {
    it('matches when at least one sub-condition matches', () => {
      const condition: Condition = {
        $or: [{ 'enemy.race': 'undead' }, { 'enemy.race': 'nazgul' }],
      };
      expect(matchesCondition(condition, { enemy: { race: 'nazgul' } })).toBe(true);
    });

    it('rejects when no sub-condition matches', () => {
      const condition: Condition = {
        $or: [{ 'enemy.race': 'undead' }, { 'enemy.race': 'nazgul' }],
      };
      expect(matchesCondition(condition, { enemy: { race: 'orc' } })).toBe(false);
    });
  });

  describe('$not operator', () => {
    it('negates a matching condition', () => {
      const condition: Condition = { $not: { 'enemy.race': 'undead' } };
      expect(matchesCondition(condition, { enemy: { race: 'undead' } })).toBe(false);
    });

    it('passes when inner condition fails', () => {
      const condition: Condition = { $not: { 'enemy.race': 'undead' } };
      expect(matchesCondition(condition, { enemy: { race: 'orc' } })).toBe(true);
    });
  });

  describe('$includes operator', () => {
    it('matches when array contains the value', () => {
      const condition: Condition = { 'bearer.skills': { $includes: 'warrior' } };
      const context = { bearer: { skills: ['warrior', 'scout'] } };
      expect(matchesCondition(condition, context)).toBe(true);
    });

    it('rejects when array does not contain the value', () => {
      const condition: Condition = { 'bearer.skills': { $includes: 'sage' } };
      const context = { bearer: { skills: ['warrior', 'scout'] } };
      expect(matchesCondition(condition, context)).toBe(false);
    });

    it('rejects when context value is not an array', () => {
      const condition: Condition = { 'bearer.skills': { $includes: 'warrior' } };
      const context = { bearer: { skills: 'warrior' } };
      expect(matchesCondition(condition, context)).toBe(false);
    });
  });

  describe('nested composite conditions', () => {
    it('handles $not wrapping $or (One Ring exclusion pattern)', () => {
      const condition: Condition = {
        $not: {
          $or: [{ 'enemy.race': 'undead' }, { 'enemy.race': 'nazgul' }],
        },
      };
      // Should match against orcs
      expect(matchesCondition(condition, { enemy: { race: 'orc' } })).toBe(true);
      // Should NOT match against undead
      expect(matchesCondition(condition, { enemy: { race: 'undead' } })).toBe(false);
      // Should NOT match against nazgul
      expect(matchesCondition(condition, { enemy: { race: 'nazgul' } })).toBe(false);
    });

    it('handles empty condition (always matches)', () => {
      const condition: Condition = {};
      expect(matchesCondition(condition, { anything: 'here' })).toBe(true);
    });
  });
});
