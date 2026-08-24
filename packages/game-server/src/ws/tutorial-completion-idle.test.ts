/**
 * @module tutorial-completion-idle.test
 *
 * The end of a tutorial chapter, driven through the real session: the human
 * seat plays chapter one action by action (the script's gate leaves exactly
 * one viable choice at a time), the Mentor's beats run on the paced pump,
 * and the last beat must leave the player with a completion snapshot on the
 * view — `done`, plus the recap the card renders.
 *
 * The session must then let go at once. A finished tutorial has nothing to
 * come back to, so holding the seat for the no-humans grace period would
 * keep the lobby showing the player "In game" for a minute after they
 * pressed Exit Tutorial.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { Alignment } from '@meccg/shared';
import type { CardDefinitionId, EvaluatedAction, PlayerView } from '@meccg/shared';
import { GameSession, IDLE_EXIT_GRACE_MS } from './game-session.js';

// GameSession and its loggers resolve SAVE_DIR / LOG_DIR / the home directory
// once at import time, so these must be redirected before the imports above
// run — which is exactly what vi.hoisted guarantees.
const { TMP_HOME } = vi.hoisted(() => {
  const home = `${process.env.TMPDIR ?? '/tmp'}/meccg-tutorial-completion-test`;
  process.env.HOME = home;
  process.env.SAVE_DIR = `${home}/saves`;
  process.env.LOG_DIR = `${home}/logs`;
  delete process.env.JWT_SECRET;
  return { TMP_HOME: home };
});

fs.rmSync(TMP_HOME, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP_HOME, 'logs'), { recursive: true });
fs.mkdirSync(path.join(TMP_HOME, '.meccg', 'logs', 'games'), { recursive: true });

const BALIN = 'tw-123' as CardDefinitionId;
const GANDALF = 'tw-156' as CardDefinitionId;
const THRAIN = 'tw-149' as CardDefinitionId;
const RIVENDELL = 'tw-258' as CardDefinitionId;

/** The Mentor pump's pacing delay (game-session's MENTOR_ACTION_DELAY_MS). */
const MENTOR_DELAY_MS = 1000;

/**
 * A stand-in for the `ws` WebSocket that keeps the latest player view: the
 * tutorial gate publishes the one legal action per beat there, so the test
 * plays the chapter straight out of the frames the session sends.
 */
class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  view: PlayerView | null = null;

  send(data: string): void {
    const msg = JSON.parse(data) as { type: string; view?: PlayerView };
    if (msg.type === 'state' && msg.view) this.view = msg.view;
  }

  close(): void {
    this.readyState = 3;
    this.emit('close');
  }

  post(msg: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(msg)));
  }

  join(name: string): void {
    this.post({
      type: 'join',
      name,
      alignment: Alignment.Wizard,
      // Ignored by a tutorial session: both decks come from the shared
      // tutorial module.
      draftPool: [BALIN, THRAIN],
      playDeck: [GANDALF],
      siteDeck: [RIVENDELL],
      sideboard: [],
    });
  }
}

/**
 * Play the tutorial to the end of the chapter and return the human's final
 * view. Each iteration takes the one action the gate left viable, answers a
 * continue gate, or lets the Mentor's paced pump tick.
 */
function playChapter(ws: FakeSocket): PlayerView {
  for (let guard = 0; guard < 500; guard++) {
    const view = ws.view;
    if (view?.tutorial?.done === true) return view;
    if (view?.tutorial?.awaitingContinue === true) {
      ws.post({ type: 'tutorial-continue' });
      continue;
    }
    const viable = (view?.legalActions ?? []).filter((a): a is EvaluatedAction => a.viable === true);
    // Chain priority is always allowed alongside the scripted beat; taking it
    // first would pass on a card the script means to play.
    const next = viable.find(a => a.action.type !== 'pass-chain-priority') ?? viable[0];
    if (next) {
      ws.post({ type: 'action', action: next.action });
      continue;
    }
    vi.advanceTimersByTime(MENTOR_DELAY_MS);
  }
  throw new Error('the tutorial chapter never reported itself complete');
}

beforeEach(() => {
  vi.useFakeTimers();
  // A finished chapter is only started fresh when no resumable save exists,
  // and disconnects autosave — wipe between tests.
  fs.rmSync(path.join(TMP_HOME, 'saves'), { recursive: true, force: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('finishing a tutorial chapter', () => {
  test('the last beat leaves the player a completion recap, and quitting ends the session at once', () => {
    const onIdle = vi.fn();
    const session = new GameSession({ playerNames: ['Wigy', 'Mentor'], tutorial: true, onIdle });
    const ws = new FakeSocket();
    session.addConnection(ws as never);
    ws.join('Wigy');

    const view = playChapter(ws);
    expect(view.tutorial?.title).toBe('Chapter one complete');
    expect(view.tutorial?.learned?.length, 'the completion card has nothing to recap').toBeGreaterThan(0);
    // Nothing is left to do: every human action is gated off behind the card.
    expect(view.legalActions.filter(a => a.viable === true)).toEqual([]);

    expect(onIdle).not.toHaveBeenCalled();
    ws.close();
    expect(onIdle, 'a finished tutorial should not hold the lobby seat').toHaveBeenCalledTimes(1);
  });

  test('quitting mid-chapter still waits out the grace period', () => {
    const onIdle = vi.fn();
    const session = new GameSession({ playerNames: ['Wigy', 'Mentor'], tutorial: true, onIdle });
    const ws = new FakeSocket();
    session.addConnection(ws as never);
    ws.join('Wigy');

    ws.close();
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(IDLE_EXIT_GRACE_MS);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});
