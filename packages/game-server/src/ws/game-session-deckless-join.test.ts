/**
 * @module game-session-deckless-join.test
 *
 * Regression test: a browser with no current deck loaded joins with a
 * minimal "rejoin" message (alignment 0, empty piles), expecting the server
 * to restore a saved game. With no save to restore, the server started a
 * brand-new game from that deckless seat and the engine threw on the
 * unknown alignment, so the joining player only saw
 * "Internal error handling 'join'" and the game never began — see the
 * "Internal error handling 'join'" bug report (game `mvwnbzg4-xucgv6`).
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { describe, test, expect, vi } from 'vitest';
import { Alignment } from '@meccg/shared';
import type { CardDefinitionId } from '@meccg/shared';
import { GameSession } from './game-session.js';

// GameSession and its loggers resolve SAVE_DIR / LOG_DIR / the home directory
// once at import time, so these must be redirected before the imports above
// run — which is exactly what vi.hoisted guarantees.
const { TMP_HOME } = vi.hoisted(() => {
  const home = `${process.env.TMPDIR ?? '/tmp'}/meccg-deckless-join-test`;
  process.env.HOME = home;
  process.env.SAVE_DIR = `${home}/saves`;
  process.env.LOG_DIR = `${home}/logs`;
  delete process.env.JWT_SECRET;
  return { TMP_HOME: home };
});

fs.rmSync(TMP_HOME, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP_HOME, 'logs'), { recursive: true });
fs.mkdirSync(path.join(TMP_HOME, '.meccg', 'logs', 'games'), { recursive: true });

const GANDALF = 'tw-156' as CardDefinitionId; // hero avatar (Wizard)
const BALIN = 'tw-123' as CardDefinitionId;
const THRAIN = 'tw-149' as CardDefinitionId;
const PELARGIR = 'tw-419' as CardDefinitionId;

/** A stand-in for the `ws` WebSocket carrying only what GameSession touches. */
class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  readonly sent: Record<string, unknown>[] = [];

  send(raw: string): void {
    this.sent.push(JSON.parse(raw) as Record<string, unknown>);
  }

  close(): void {
    this.readyState = 3;
    this.emit('close');
  }

  message(msg: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(msg)));
  }

  all(type: string): Record<string, unknown>[] {
    return this.sent.filter(m => m.type === type);
  }
}

describe('deckless join with no saved game', () => {
  test('refuses the deckless seat with a clear error instead of crashing', () => {
    const session = new GameSession({ dev: true, playerNames: ['Alice', 'Bob'] });
    const alice = new FakeSocket();
    const bob = new FakeSocket();
    session.addConnection(alice as never);
    session.addConnection(bob as never);

    alice.message({
      type: 'join',
      name: 'Alice',
      alignment: Alignment.Wizard,
      draftPool: [BALIN, THRAIN],
      playDeck: [GANDALF],
      siteDeck: [PELARGIR],
      sideboard: [],
    });
    // The browser's minimal rejoin, sent when no current deck is loaded.
    bob.message({
      type: 'join',
      name: 'Bob',
      alignment: 0,
      draftPool: [],
      playDeck: [],
      siteDeck: [],
      sideboard: [],
    });

    const bobErrors = bob.all('error').map(m => m.message as string);
    expect(bobErrors.some(m => m.startsWith('Internal error'))).toBe(false);
    expect(bobErrors.some(m => m.includes('No deck selected'))).toBe(true);
    expect(alice.all('assigned')).toHaveLength(0);
    expect(alice.all('state')).toHaveLength(0);

    // Once Bob rejoins with a real deck, the game starts normally.
    bob.message({
      type: 'join',
      name: 'Bob',
      alignment: Alignment.Wizard,
      draftPool: [BALIN, THRAIN],
      playDeck: [GANDALF],
      siteDeck: [PELARGIR],
      sideboard: [],
    });
    expect(bob.all('assigned')).toHaveLength(1);
    expect(alice.all('assigned')).toHaveLength(1);
    expect(bob.all('state').length).toBeGreaterThan(0);
  });
});
