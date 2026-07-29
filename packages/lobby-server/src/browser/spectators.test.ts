import { describe, it, expect } from 'vitest';
import { spectatorBadge, spectatorListText } from './spectators.js';

/**
 * The watcher badge sits among the other toolbar icons, so an empty list must
 * hide the button outright rather than render a "0" that looks like a broken
 * counter and opens an empty dialog.
 */
describe('spectatorBadge', () => {
  it('renders nothing when nobody is watching', () => {
    expect(spectatorBadge([])).toBeNull();
  });

  it('counts a single watcher in the singular', () => {
    expect(spectatorBadge(['wigy'])).toEqual({ count: '1', title: '1 person watching' });
  });

  it('counts several watchers in the plural', () => {
    expect(spectatorBadge(['bergil', 'rodrigo', 'wigy'])).toEqual({
      count: '3',
      title: '3 people watching',
    });
  });
});

describe('spectatorListText', () => {
  it('lists one watcher per line under a singular heading', () => {
    expect(spectatorListText(['wigy'])).toBe('Watching this game:\n\nwigy');
  });

  it('lists one watcher per line under a heading carrying the count', () => {
    expect(spectatorListText(['bergil', 'rodrigo'])).toBe(
      'Watching this game (2):\n\nbergil\nrodrigo',
    );
  });
});
