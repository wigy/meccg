/**
 * @module render-toolbar-status.test
 *
 * Unit tests for the pure toolbar status text builder. No DOM required —
 * mirrors the pure-function test pattern in
 * `render-phase-meter-movement-path.test.ts`.
 */

import './test-dom-bootstrap.js'; // must precede the render import (load-time window access)
import { describe, test, expect } from 'vitest';
import { Phase } from '@meccg/shared';
import { buildToolbarStatusText } from './render-toolbar-status.js';

describe('buildToolbarStatusText', () => {
  test('returns empty string when no game has been assigned yet', () => {
    expect(buildToolbarStatusText(null, null, undefined)).toBe('');
  });

  test('shows only the game ID once assigned but before the first state arrives', () => {
    expect(buildToolbarStatusText('game123', null, undefined)).toBe('Game game123');
  });

  test('omits the turn number during Setup, since turnNumber stays 0', () => {
    expect(buildToolbarStatusText('game123', 0, Phase.Setup)).toBe('Game game123 · Setup Phase');
  });

  test.each([
    [Phase.Untap, 'Untap'],
    [Phase.Organization, 'Organization'],
    [Phase.LongEvent, 'Long-event'],
    [Phase.MovementHazard, 'Movement/Hazard'],
    [Phase.Site, 'Site'],
    [Phase.EndOfTurn, 'End of Turn'],
  ])('formats a normal turn phase (%s)', (phase, label) => {
    expect(buildToolbarStatusText('game123', 3, phase)).toBe(`Game game123 · Turn 3 · ${label} Phase`);
  });

  test('formats Free Council, carrying over the final turn number', () => {
    expect(buildToolbarStatusText('game123', 12, Phase.FreeCouncil)).toBe('Game game123 · Turn 12 · Free Council Phase');
  });

  test('formats Game Over, carrying over the final turn number', () => {
    expect(buildToolbarStatusText('game123', 12, Phase.GameOver)).toBe('Game game123 · Turn 12 · Game Over Phase');
  });
});
