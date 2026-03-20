import { describe, it, expect } from 'vitest';
import { formatCardName, stripCardMarkers, formatCardList } from '../format.js';
import { loadCardPool } from '../data/index.js';

const pool = loadCardPool();

describe('formatCardName', () => {
  it('returns colored name for known cards', () => {
    const def = pool['tw-120']; // Aragorn
    const result = formatCardName(def);
    expect(stripCardMarkers(result)).toContain('Aragorn II');
  });

  it('returns dim grey for undefined card', () => {
    const result = formatCardName(undefined);
    expect(result).toContain('a card');
  });

  it('embeds STX card ID marker', () => {
    const def = pool['tw-120'];
    const result = formatCardName(def);
    expect(result).toContain('\x02tw-120\x02');
  });

  it('embeds STX marker for unknown cards too', () => {
    const def = pool['unknown-card'];
    const result = formatCardName(def);
    expect(result).toContain('\x02unknown-card\x02');
  });
});

describe('stripCardMarkers', () => {
  it('removes STX markers from text', () => {
    const input = 'Hello \x02tw-120\x02Aragorn II world';
    expect(stripCardMarkers(input)).toBe('Hello Aragorn II world');
  });

  it('handles text without markers', () => {
    expect(stripCardMarkers('no markers')).toBe('no markers');
  });

  it('handles multiple markers', () => {
    const input = '\x02a\x02X and \x02b\x02Y';
    expect(stripCardMarkers(input)).toBe('X and Y');
  });
});

describe('formatCardList', () => {
  it('returns (empty) for empty list', () => {
    expect(formatCardList([], pool)).toBe('(empty)');
  });

  it('groups duplicate cards with count prefix', () => {
    const ids = [pool['tw-206'].id, pool['tw-206'].id]; // 2x Dagger
    const result = stripCardMarkers(formatCardList(ids, pool));
    expect(result).toContain('2 x');
    expect(result).toContain('Dagger of Westernesse');
  });
});
