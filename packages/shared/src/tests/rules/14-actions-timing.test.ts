/**
 * @module 14-actions-timing.test
 *
 * Tests for CoE Rules Section 9: Actions, Conditions, and Timing.
 *
 * Rule references from docs/coe-rules.md.
 */

import { describe, test } from 'vitest';

describe('9 Actions', () => {
  test.todo('[9] actions cannot be performed without an allowance or requirement');
  test.todo('[9] card effect conflicts with rule: most recent effect takes precedence');
  test.todo('[9] resource/character actions only when resource short-event could be played');
  test.todo('[9] hazard actions only when hazard short-event could be played');
});

describe('9 Active conditions', () => {
  test.todo('[9] active conditions must be met for action to be declared and resolved');
  test.todo('[9] active conditions performed immediately on declaration');
  test.todo('[9] if active conditions invalid at resolution, effects negated but conditions stay performed');
  test.todo('[9] tap for effect: entity must be untapped at declaration');
  test.todo('[9] discard for effect: entity must be in play at declaration');
});

describe('9 Chain of effects', () => {
  test.todo('[9] chain of effects: last declared resolves first (LIFO)');
  test.todo('[9] resource player has priority to initiate new chain');
  test.todo('[9] cannot take actions while chain is resolving');
  test.todo('[9] immediate effects resolve without chain, no response allowed');
});

describe('9 Passive conditions', () => {
  test.todo('[9] passive conditions: declared in new chain when circumstances met');
  test.todo('[9] beginning of phase: passive conditions declared before other actions');
  test.todo('[9] end of phase: passive conditions declared after both players finish');
  test.todo('[9] cards have no memory once they leave play');
});
