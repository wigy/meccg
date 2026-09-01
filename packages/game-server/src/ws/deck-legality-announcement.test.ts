/**
 * @module deck-legality-announcement.test
 *
 * Regression test: when a joining player's deck fails {@link validateDeck},
 * the broadcast "deck is not legal" info message must say *which* card and
 * *why* — not just that the deck is illegal. Previously the server ran
 * validation, logged the full per-error detail to a server-only log file, and
 * broadcast the players nothing but the bare "<name> deck is not legal"
 * string. A player with one bad card (e.g. an extra copy of a non-haven site
 * beyond its 1-copy limit) had no way to find it from the client — see the
 * "Improvement: Crash 5" bug report (game `mtindhrm-xs64ic`).
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
  const home = `${process.env.TMPDIR ?? '/tmp'}/meccg-deck-legality-announcement-test`;
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
// A non-haven hero site: rule 1.24 permits at most one copy in the location deck.
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

describe('deck legality announcement', () => {
  test('names the offending card instead of only saying the deck is illegal', () => {
    const session = new GameSession({ dev: true, playerNames: ['Alice', 'Bob'] });
    const alice = new FakeSocket();
    const bob = new FakeSocket();
    session.addConnection(alice as never);
    session.addConnection(bob as never);

    // Two copies of a non-haven site: illegal under rule 1.24 (max 1 copy).
    alice.message({
      type: 'join',
      name: 'Alice',
      alignment: Alignment.Wizard,
      draftPool: [BALIN, THRAIN],
      playDeck: [GANDALF],
      siteDeck: [PELARGIR, PELARGIR],
      sideboard: [],
    });
    bob.message({
      type: 'join',
      name: 'Bob',
      alignment: Alignment.Wizard,
      draftPool: [BALIN, THRAIN],
      playDeck: [GANDALF],
      siteDeck: [PELARGIR],
      sideboard: [],
    });

    const aliceInfo = alice.all('info').find(m => (m.message as string).includes('Alice deck'));
    expect(aliceInfo?.tone).toBe('error');
    expect(aliceInfo?.message).toContain('Pelargir');
    expect(aliceInfo?.message).not.toBe('Alice deck is not legal');
  });
});
