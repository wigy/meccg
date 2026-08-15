/**
 * @module replay-transport.test
 *
 * Tests for the replay transport's cursor arithmetic — the ends of the
 * timeline, where an off-by-one either strands the viewer on the last frame
 * or seeks past it.
 */

import { describe, test, expect } from 'vitest';
import { targetFrame, disabledActions, playFrom, frameLabel } from './replay-transport.js';

describe('targetFrame', () => {
  test('steps one frame at a time and jumps to either end', () => {
    expect(targetFrame('prev', 5, 10)).toBe(4);
    expect(targetFrame('next', 5, 10)).toBe(6);
    expect(targetFrame('first', 5, 10)).toBe(0);
    expect(targetFrame('last', 5, 10)).toBe(9);
  });

  test('refuses to step off either end', () => {
    expect(targetFrame('prev', 0, 10)).toBeNull();
    expect(targetFrame('next', 9, 10)).toBeNull();
    // Already there: the seek is a no-op the caller can skip, not an error.
    expect(targetFrame('first', 0, 10)).toBe(0);
    expect(targetFrame('last', 9, 10)).toBe(9);
  });

  test('play is not a seek, and an empty timeline goes nowhere', () => {
    expect(targetFrame('play', 3, 10)).toBeNull();
    expect(targetFrame('next', 0, 0)).toBeNull();
    expect(targetFrame('first', 0, 0)).toBeNull();
  });
});

describe('disabledActions', () => {
  test('greys out the backward controls at the start and the forward ones at the end', () => {
    expect(disabledActions(0, 10)).toMatchObject({ first: true, prev: true, next: false, last: false });
    expect(disabledActions(9, 10)).toMatchObject({ first: false, prev: false, next: true, last: true });
    expect(disabledActions(4, 10)).toMatchObject({ first: false, prev: false, next: false, last: false });
  });

  test('play stays live at the end — it restarts from the top — but not for a single frame', () => {
    expect(disabledActions(9, 10).play).toBe(false);
    expect(disabledActions(0, 1).play).toBe(true);
  });
});

describe('playFrom', () => {
  test('advances one frame while there is more to watch', () => {
    expect(playFrom(0, 10)).toBe(1);
    expect(playFrom(8, 10)).toBe(9);
  });

  test('restarts from the top once the replay has finished', () => {
    expect(playFrom(9, 10)).toBe(0);
  });

  test('an empty timeline has nothing to play', () => {
    expect(playFrom(0, 0)).toBeNull();
  });
});

describe('frameLabel', () => {
  test('reads as turn, phase, step', () => {
    expect(frameLabel({ turn: 4, phase: 'movement-hazard', step: 'site-arrival' }))
      .toBe('Turn 4 · movement-hazard · site-arrival');
  });

  test('drops the parts a frame does not have', () => {
    expect(frameLabel({ turn: null, phase: 'setup', step: 'character-draft' }))
      .toBe('setup · character-draft');
    expect(frameLabel({ turn: 2, phase: 'untap', step: null })).toBe('Turn 2 · untap');
    expect(frameLabel({ turn: null, phase: null, step: null })).toBe('');
  });

  test('turn 0 is a turn, not a missing one', () => {
    expect(frameLabel({ turn: 0, phase: 'setup', step: null })).toBe('Turn 0 · setup');
  });
});
