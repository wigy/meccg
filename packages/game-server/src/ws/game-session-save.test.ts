/**
 * @module game-session-save.test
 *
 * Tests for the save-file lifecycle of {@link GameSession}. Saves are keyed by
 * the pair of player names alone, so a stale save leaks into *every* later game
 * between the same two players. A save of a finished game must therefore never
 * survive: if it does, the next game restores it and both players are seated in
 * `game-over` with no legal actions — the game never starts.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { describe, test, expect, vi } from 'vitest';
import { createGame, loadCardPool, Alignment, Phase } from '@meccg/shared';
import type { CardDefinitionId, GameConfig, GameState, PlayerId } from '@meccg/shared';
import { GameSession } from './game-session.js';

// GameSession and its loggers resolve SAVE_DIR / LOG_DIR / the home directory
// once at import time, so these must be redirected before the imports above
// run — which is exactly what vi.hoisted guarantees. Only string work happens
// here; the directories are created below, since the loggers do not open a
// file until a session is constructed.
const { TMP_HOME, SAVE_DIR } = vi.hoisted(() => {
  const home = `${process.env.TMPDIR ?? '/tmp'}/meccg-session-save-test`;
  const saves = `${home}/saves`;
  process.env.HOME = home;
  process.env.SAVE_DIR = saves;
  process.env.LOG_DIR = `${home}/logs`;
  delete process.env.JWT_SECRET;
  return { TMP_HOME: home, SAVE_DIR: saves };
});

// A fixed directory wiped on the way in, not a fresh mkdtemp torn down on the
// way out: the loggers open their streams asynchronously, so deleting the tree
// in afterAll races the last session's still-opening log files. The log writers
// also append to streams opened without creating their directory first.
fs.rmSync(TMP_HOME, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP_HOME, 'logs'), { recursive: true });
fs.mkdirSync(path.join(TMP_HOME, '.meccg', 'logs', 'games'), { recursive: true });

const ALICE = 'p1' as PlayerId;
const BOB = 'p2' as PlayerId;
const BALIN = 'tw-123' as CardDefinitionId;
const GANDALF = 'tw-156' as CardDefinitionId;
const THRAIN = 'tw-149' as CardDefinitionId;
const RIVENDELL = 'tw-258' as CardDefinitionId;

const pool = loadCardPool();

const AUTOSAVE = path.join(SAVE_DIR, 'alice_vs_bob-autosave.json');

/**
 * A stand-in for the `ws` WebSocket carrying only what GameSession touches:
 * `on('message'|'close')`, `send`, `close`, and the `readyState`/`OPEN` pair
 * its `send` guard reads. Sent frames are collected for assertions.
 */
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

  join(name: string): void {
    this.emit('message', Buffer.from(JSON.stringify({
      type: 'join',
      name,
      alignment: Alignment.Wizard,
      draftPool: [BALIN, THRAIN],
      playDeck: [GANDALF],
      siteDeck: [RIVENDELL],
      sideboard: [],
    })));
  }

  action(action: Record<string, unknown>): void {
    this.emit('message', Buffer.from(JSON.stringify({ type: 'action', action })));
  }
}

/** A real created game forced into game over, with `finishedPlayers` as given. */
function finishedState(finishedPlayers: string[]): GameState {
  const config: GameConfig = {
    players: [
      { id: ALICE, name: 'Alice', alignment: Alignment.Wizard,
        draftPool: [BALIN], playDeck: [GANDALF], siteDeck: [RIVENDELL], sideboard: [] },
      { id: BOB, name: 'Bob', alignment: Alignment.Wizard,
        draftPool: [THRAIN], playDeck: [], siteDeck: [RIVENDELL], sideboard: [] },
    ],
    seed: 12345,
  };
  const state = createGame(config, pool);
  return {
    ...state,
    turnNumber: 14,
    phaseState: {
      phase: Phase.GameOver,
      winner: ALICE,
      finalScores: { [ALICE]: 13, [BOB]: 4 },
      finishedPlayers,
      winReason: { kind: 'marshalling-points' },
    },
  };
}

/** Write an autosave for the Alice/Bob pair holding the given state. */
function writeAutosave(state: GameState): void {
  fs.mkdirSync(SAVE_DIR, { recursive: true });
  fs.writeFileSync(AUTOSAVE, JSON.stringify({
    state,
    nameToPlayerId: { alice: ALICE, bob: BOB },
    deckInfo: {},
    aiPlayers: ['bob'],
  }), 'utf-8');
}

describe('GameSession save lifecycle', () => {
  test('a new game starts fresh when the autosave holds a finished game', () => {
    writeAutosave(finishedState([ALICE, BOB]));

    const session = new GameSession({ dev: true, playerNames: ['Alice', 'Bob'] });
    const alice = new FakeSocket();
    const bob = new FakeSocket();
    session.addConnection(alice as never);
    session.addConnection(bob as never);
    alice.join('Alice');
    bob.join('Bob');

    const view = [...alice.sent].reverse().find(m => m.type === 'state');
    expect(view).toBeDefined();
    expect((view!.view as { phaseState: { phase: string } }).phaseState.phase).toBe(Phase.Setup);
    // The autosave is kept current from the moment the fresh game starts (see
    // the "in-progress action" test below) — it must reflect the new Setup
    // game, never the stale finished one it replaced.
    const saved = JSON.parse(fs.readFileSync(AUTOSAVE, 'utf-8')) as { state: { phaseState: { phase: string } } };
    expect(saved.state.phaseState.phase).toBe(Phase.Setup);
  });

  test('a game over but not yet acknowledged is still restored', () => {
    writeAutosave(finishedState([ALICE]));

    const session = new GameSession({ dev: true, playerNames: ['Alice', 'Bob'] });
    const alice = new FakeSocket();
    const bob = new FakeSocket();
    session.addConnection(alice as never);
    session.addConnection(bob as never);
    alice.join('Alice');
    bob.join('Bob');

    const view = [...alice.sent].reverse().find(m => m.type === 'state');
    expect(view).toBeDefined();
    expect((view!.view as { phaseState: { phase: string } }).phaseState.phase).toBe(Phase.GameOver);
  });

  test('shutdown does not rewrite the autosave once both players acknowledged', () => {
    // Restore an unacknowledged game over, then let both players acknowledge:
    // that deletes the saves. The shutdown that follows must not put them back.
    writeAutosave(finishedState([]));

    const session = new GameSession({ dev: true, playerNames: ['Alice', 'Bob'] });
    const alice = new FakeSocket();
    const bob = new FakeSocket();
    session.addConnection(alice as never);
    session.addConnection(bob as never);
    alice.join('Alice');
    bob.join('Bob');
    alice.action({ type: 'finished' });
    bob.action({ type: 'finished' });
    expect(alice.sent.filter(m => m.type === 'error')).toEqual([]);
    expect(bob.sent.filter(m => m.type === 'error')).toEqual([]);
    expect(fs.existsSync(AUTOSAVE)).toBe(false);

    session.gracefulShutdown();
    expect(fs.existsSync(AUTOSAVE)).toBe(false);
  });

  test('disconnect does not rewrite the autosave once both players acknowledged', () => {
    writeAutosave(finishedState([]));

    const session = new GameSession({ dev: true, playerNames: ['Alice', 'Bob'] });
    const alice = new FakeSocket();
    const bob = new FakeSocket();
    session.addConnection(alice as never);
    session.addConnection(bob as never);
    alice.join('Alice');
    bob.join('Bob');
    alice.action({ type: 'finished' });
    bob.action({ type: 'finished' });
    expect(fs.existsSync(AUTOSAVE)).toBe(false);

    // Closing the tab after the result screen must not resurrect the save.
    alice.close();
    bob.close();
    expect(fs.existsSync(AUTOSAVE)).toBe(false);
  });

  test('disconnect mid-game still writes an autosave', () => {
    fs.rmSync(AUTOSAVE, { force: true });

    const session = new GameSession({ dev: true, playerNames: ['Alice', 'Bob'] });
    const alice = new FakeSocket();
    const bob = new FakeSocket();
    session.addConnection(alice as never);
    session.addConnection(bob as never);
    alice.join('Alice');
    bob.join('Bob');
    alice.close();

    expect(fs.existsSync(AUTOSAVE)).toBe(true);
  });

  test('an in-progress action keeps the autosave current, without waiting for a disconnect', () => {
    // A stale autosave that predates already-applied actions is exactly what
    // let a crash silently revert an in-progress game (e.g. a completed
    // gold-ring test discarded, reverting the player to before the card was
    // played) with no clean disconnect to trigger a fresh write.
    fs.rmSync(AUTOSAVE, { force: true });

    const session = new GameSession({ dev: true, playerNames: ['Alice', 'Bob'] });
    const alice = new FakeSocket();
    const bob = new FakeSocket();
    session.addConnection(alice as never);
    session.addConnection(bob as never);
    alice.join('Alice');
    bob.join('Bob');

    const assigned = alice.sent.find(m => m.type === 'assigned');
    const aliceId = assigned!.playerId as string;
    const view = [...alice.sent].reverse().find(m => m.type === 'state')!.view as {
      stateSeq: number;
      legalActions: readonly { action: Record<string, unknown>; viable: boolean }[];
    };
    const viableAction = view.legalActions.find(a => a.viable && a.action.player === aliceId);
    expect(viableAction).toBeDefined();

    // The autosave is already fresh as of the game starting (join/new-game) —
    // the point of this test is that it keeps up after every action too.
    expect(fs.existsSync(AUTOSAVE)).toBe(true);
    const beforeAction = JSON.parse(fs.readFileSync(AUTOSAVE, 'utf-8')) as { state: { stateSeq: number } };
    expect(beforeAction.state.stateSeq).toBe(view.stateSeq);

    alice.action(viableAction!.action);

    expect(fs.existsSync(AUTOSAVE)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(AUTOSAVE, 'utf-8')) as { state: { stateSeq: number } };
    const nextView = [...alice.sent].reverse().find(m => m.type === 'state')!.view as { stateSeq: number };
    expect(saved.state.stateSeq).toBe(nextView.stateSeq);
    expect(saved.state.stateSeq).toBeGreaterThan(view.stateSeq);
  });
});
