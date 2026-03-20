import { describe, it, expect } from 'vitest';
import { cardImageProxyPath, cardImageRawUrl } from '../card-images.js';
import { loadCardPool } from '../data/index.js';

const pool = loadCardPool();

describe('cardImageProxyPath', () => {
  it('converts GitHub raw URL to proxy path', () => {
    const card = pool['tw-156']; // Gandalf
    const path = cardImageProxyPath(card);
    expect(path).toBe('/cards/images/tw/Gandalf.jpg');
  });

  it('returns undefined for non-GitHub URLs', () => {
    const card = pool['unknown-card'];
    const path = cardImageProxyPath(card);
    expect(path).toBeUndefined();
  });
});

describe('cardImageRawUrl', () => {
  it('constructs raw GitHub URL from set and filename', () => {
    const url = cardImageRawUrl('tw', 'Gandalf.jpg');
    expect(url).toContain('raw.githubusercontent.com');
    expect(url).toContain('tw/Gandalf.jpg');
  });
});
