/**
 * @module game-session-observer.test
 *
 * The session's half of Ask AI (`specs/2026-08-17-ask-ai-observer.md`): an
 * observer attaches without taking a seat, its presence is announced so the
 * browser can offer the control, and one question is relayed to it and its
 * answer back to the asker — to the asker alone, because the explanation is
 * derived from one seat's private view.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { describe, test, expect, vi } from 'vitest';
import { Alignment } from '@meccg/shared';
import type { CardDefinitionId } from '@meccg/shared';
import { ASK_AI_TIMEOUT_MS, GameSession } from './game-session.js';

// GameSession and its loggers resolve SAVE_DIR / LOG_DIR / the home directory
// once at import time, so these must be redirected before the imports above
// run — which is exactly what vi.hoisted guarantees.
const { TMP_HOME } = vi.hoisted(() => {
  const home = `${process.env.TMPDIR ?? '/tmp'}/meccg-session-observer-test`;
  process.env.HOME = home;
  process.env.SAVE_DIR = `${home}/saves`;
  process.env.LOG_DIR = `${home}/logs`;
  delete process.env.JWT_SECRET;
  return { TMP_HOME: home };
});

// Wiped on the way in rather than torn down afterwards: the loggers open their
// streams asynchronously, so deleting the tree in afterAll races them.
fs.rmSync(TMP_HOME, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP_HOME, 'logs'), { recursive: true });
fs.mkdirSync(path.join(TMP_HOME, '.meccg', 'logs', 'games'), { recursive: true });

const BALIN = 'tw-123' as CardDefinitionId;
const GANDALF = 'tw-156' as CardDefinitionId;
const THRAIN = 'tw-149' as CardDefinitionId;
const RIVENDELL = 'tw-258' as CardDefinitionId;

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

  join(name: string): void {
    this.message({
      type: 'join',
      name,
      alignment: Alignment.Wizard,
      draftPool: [BALIN, THRAIN],
      playDeck: [GANDALF],
      siteDeck: [RIVENDELL],
      sideboard: [],
    });
  }

  /** Attach as an Ask AI observer offering `agent`. */
  observe(name: string, agent: string): void {
    this.message({
      type: 'join',
      name,
      alignment: Alignment.Wizard,
      draftPool: [],
      playDeck: [],
      siteDeck: [],
      sideboard: [],
      observer: { agent },
    });
  }

  latest(type: string): Record<string, unknown> | undefined {
    return [...this.sent].reverse().find(m => m.type === type);
  }

  all(type: string): Record<string, unknown>[] {
    return this.sent.filter(m => m.type === type);
  }
}

/** A session with Alice and Bob seated and their sockets returned. */
function seatedGame(): { alice: FakeSocket; bob: FakeSocket; session: GameSession } {
  const session = new GameSession({ dev: true, playerNames: ['Alice', 'Bob'] });
  const alice = new FakeSocket();
  const bob = new FakeSocket();
  session.addConnection(alice as never);
  session.addConnection(bob as never);
  alice.join('Alice');
  bob.join('Bob');
  return { alice, bob, session };
}

/** A seated game with an observer attached, offering `agent`. */
function observedGame(agent = 'h2'): {
  alice: FakeSocket; bob: FakeSocket; observer: FakeSocket; session: GameSession;
} {
  const { alice, bob, session } = seatedGame();
  const observer = new FakeSocket();
  session.addConnection(observer as never);
  observer.observe('Observer', agent);
  return { alice, bob, observer, session };
}

describe('attaching', () => {
  test('is announced to both players with the agent it offers', () => {
    const { alice, bob } = observedGame('mc:ms=2000');
    expect(alice.latest('observer')).toMatchObject({ attached: true, agent: 'mc:ms=2000' });
    expect(bob.latest('observer')).toMatchObject({ attached: true, agent: 'mc:ms=2000' });
  });

  test('tells the observer the real gameId, which is how it finds the log', () => {
    const { observer } = observedGame();
    const assigned = observer.latest('assigned');
    expect(assigned).toMatchObject({ playerId: 'observer' });
    expect(assigned?.gameId).toEqual(expect.stringMatching(/.+/));
    expect(assigned?.gameId).not.toBe('unknown');
  });

  test('takes no seat and no place in the watcher list', () => {
    const { alice, observer } = observedGame();
    // An observer is a tool, not a person watching.
    expect(alice.latest('spectators')?.names).toEqual([]);
    // And it is never sent the board.
    expect(observer.all('state')).toEqual([]);
  });

  test('detaching is announced', () => {
    const { alice, observer } = observedGame();
    observer.close();
    expect(alice.latest('observer')).toMatchObject({ attached: false, agent: null });
  });

  test('a second observer replaces the first', () => {
    const { alice, observer, session } = observedGame('h2');

    const replacement = new FakeSocket();
    session.addConnection(replacement as never);
    replacement.observe('Observer', 'heuristic');

    expect(alice.latest('observer')).toMatchObject({ attached: true, agent: 'heuristic' });
    // The displaced one is told why, and closed — otherwise a restarted
    // observer leaves its predecessor holding the name.
    expect(observer.latest('error')?.message).toContain('Replaced by another observer');
    expect(observer.readyState).toBe(3);
  });

  test('is refused for a name that plays in this game', () => {
    const { alice, session } = seatedGame();
    const impostor = new FakeSocket();
    session.addConnection(impostor as never);
    impostor.observe('Alice', 'h2');

    expect(impostor.latest('error')?.message).toContain('plays in this game');
    // Alice's own socket keeps the seat: nothing was taken over.
    expect(alice.latest('observer')).toBeUndefined();
  });

  test('a client seated after the observer is still told about it', () => {
    const { session } = observedGame('h2');
    const watcher = new FakeSocket();
    session.addConnection(watcher as never);
    watcher.join('Rodrigo');
    expect(watcher.latest('observer')).toMatchObject({ attached: true, agent: 'h2' });
  });
});

describe('asking', () => {
  test('is refused when no observer is attached', () => {
    const { alice } = seatedGame();
    alice.message({ type: 'ask-ai', requestId: 'r1' });
    expect(alice.latest('ai-explanation')).toMatchObject({
      requestId: 'r1',
      status: 'unavailable',
    });
    expect(alice.latest('ai-explanation')?.message).toContain('bin/observe');
  });

  test('forwards the question with the current position and the asker\'s own seat', () => {
    const { alice, observer } = observedGame();
    alice.message({ type: 'ask-ai', requestId: 'r1' });

    const question = observer.latest('ai-question');
    expect(question).toMatchObject({ requestId: 'r1', forPlayer: 'p1' });
    expect(typeof question?.stateSeq).toBe('number');
    expect(typeof question?.turn).toBe('number');
  });

  test('a spectator asks about whoever is to act', () => {
    const { observer, session } = observedGame();
    const watcher = new FakeSocket();
    session.addConnection(watcher as never);
    watcher.join('Rodrigo');

    watcher.message({ type: 'ask-ai', requestId: 'r1' });
    // No dev gate: watching an AI game and asking what another agent would
    // play is a main use of the feature.
    expect(observer.latest('ai-question')).toMatchObject({ requestId: 'r1' });
  });

  test('the answer reaches the asker and nobody else', () => {
    const { alice, bob, observer } = observedGame();
    alice.message({ type: 'ask-ai', requestId: 'r1' });
    observer.message({
      type: 'ai-answer',
      requestId: 'r1',
      lines: ['PICK  pass'],
      agent: 'h2',
      elapsedMs: 12,
    });

    expect(alice.latest('ai-explanation')).toMatchObject({
      requestId: 'r1',
      status: 'ok',
      agent: 'h2',
      forPlayer: 'p1',
      lines: ['PICK  pass'],
      elapsedMs: 12,
    });
    // Derived from Alice's private view, so Bob must never see it.
    expect(bob.all('ai-explanation')).toEqual([]);
  });

  test('an observer failure is relayed as the reason', () => {
    const { alice, observer } = observedGame();
    alice.message({ type: 'ask-ai', requestId: 'r1' });
    observer.message({ type: 'ai-error', requestId: 'r1', message: 'game log unreadable' });

    expect(alice.latest('ai-explanation')).toMatchObject({ requestId: 'r1', status: 'error' });
    expect(alice.latest('ai-explanation')?.message).toContain('game log unreadable');
  });

  test('a second question from the same client is refused while one is in flight', () => {
    const { alice, observer } = observedGame();
    alice.message({ type: 'ask-ai', requestId: 'r1' });
    alice.message({ type: 'ask-ai', requestId: 'r2' });

    expect(alice.latest('ai-explanation')).toMatchObject({ requestId: 'r2', status: 'error' });
    expect(alice.latest('ai-explanation')?.message).toContain('Still thinking');
    // The first is still the only one the observer was asked.
    expect(observer.all('ai-question')).toHaveLength(1);
  });

  test('answers from anyone but the observer are refused', () => {
    const { alice, bob } = observedGame();
    alice.message({ type: 'ask-ai', requestId: 'r1' });

    // Bob forging an answer to Alice's question: it would be an explanation of
    // Alice's own hand, written by her opponent.
    bob.message({ type: 'ai-answer', requestId: 'r1', lines: ['play your Vilya'], agent: 'h2', elapsedMs: 1 });

    expect(bob.latest('error')?.message).toContain('Only the attached observer');
    expect(alice.all('ai-explanation')).toEqual([]);
  });

  test('a question outstanding when the observer leaves is answered, not left hanging', () => {
    const { alice, observer } = observedGame();
    alice.message({ type: 'ask-ai', requestId: 'r1' });
    observer.close();

    expect(alice.latest('ai-explanation')).toMatchObject({ requestId: 'r1', status: 'unavailable' });
    expect(alice.latest('ai-explanation')?.message).toContain('detached');
  });

  test('times out, and a late answer is dropped rather than delivered', () => {
    vi.useFakeTimers();
    try {
      const { alice, observer } = observedGame();
      alice.message({ type: 'ask-ai', requestId: 'r1' });
      vi.advanceTimersByTime(ASK_AI_TIMEOUT_MS + 1);

      expect(alice.latest('ai-explanation')).toMatchObject({ requestId: 'r1', status: 'timeout' });

      const before = alice.all('ai-explanation').length;
      observer.message({
        type: 'ai-answer', requestId: 'r1', lines: ['too late'], agent: 'h2', elapsedMs: 99_000,
      });
      expect(alice.all('ai-explanation')).toHaveLength(before);
    } finally {
      vi.useRealTimers();
    }
  });

  test('asking never taints the game', () => {
    const { alice, observer } = observedGame();
    alice.message({ type: 'ask-ai', requestId: 'r1' });
    observer.message({ type: 'ai-answer', requestId: 'r1', lines: ['x'], agent: 'h2', elapsedMs: 1 });

    // Reading is not cheating: the dev commands stamp the game because they
    // rewrite it, and Ask AI changes nothing.
    for (const msg of alice.all('state')) {
      expect((msg.view as { cheated?: boolean }).cheated ?? false).toBe(false);
    }
  });
});

describe('keeping the game alive', () => {
  test('an attached observer alone does not hold an abandoned game open', () => {
    vi.useFakeTimers();
    try {
      const onIdle = vi.fn();
      const session = new GameSession({ dev: true, playerNames: ['Alice', 'Bob'], onIdle });
      const alice = new FakeSocket();
      const bob = new FakeSocket();
      session.addConnection(alice as never);
      session.addConnection(bob as never);
      alice.join('Alice');
      bob.join('Bob');

      const observer = new FakeSocket();
      session.addConnection(observer as never);
      observer.observe('Observer', 'h2');

      alice.close();
      bob.close();
      vi.advanceTimersByTime(60_001);

      expect(onIdle).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
