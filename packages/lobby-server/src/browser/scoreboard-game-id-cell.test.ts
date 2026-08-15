import { describe, test, expect } from 'vitest';
import { gameIdCell } from './scoreboard-game-id-cell.js';

/**
 * The replay link is the only clickable thing in the scoreboard's game meta
 * list, and the page finds it by the `data-replay-game` attribute alone (the
 * click handler is delegated). These tests pin that contract, and the rule
 * that a game with no ID is not offered a replay it cannot load.
 */
describe('gameIdCell', () => {
  test('offers a replay link carrying the game ID', () => {
    const html = gameIdCell('mr9jvlnw-2ldyce');
    expect(html).toContain('mr9jvlnw-2ldyce');
    expect(html).toContain('data-replay-game="mr9jvlnw-2ldyce"');
    expect(html).toContain('class="scoreboard-replay-link"');
    expect(html).toContain('>Replay</button>');
  });

  test('a game with no recorded ID gets an em dash and no link', () => {
    const html = gameIdCell(null);
    expect(html).toBe('<dd class="scoreboard-game-id">—</dd>');
    expect(html).not.toContain('data-replay-game');
  });

  test('escapes the ID rather than trusting it in an attribute', () => {
    const html = gameIdCell('a"><script>x</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;');
  });
});
