/**
 * @module game-session-game-length.test
 *
 * Verifies that `GameSession` reconciles each player's declared deck
 * {@link GameLength} into a single `GameState.gameLength` at game creation
 * (CoE rule 1.1 / 10.2 — Starter/Short/Long/Campaign). Deck length is
 * per-deck metadata, not a per-match setting, so a mismatch between the two
 * players' decks must resolve to the longer/more permissive length rather
 * than silently forcing one player into a shorter game than their deck was
 * built for.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { describe, test, expect, vi } from 'vitest';
import { Alignment } from '@meccg/shared';
import type { CardDefinitionId, DeckList, GameLength } from '@meccg/shared';
import { GameSession } from './game-session.js';

// GameSession and its loggers resolve SAVE_DIR / LOG_DIR / the home directory
// once at import time, so these must be redirected before the imports above
// run — which is exactly what vi.hoisted guarantees.
const { TMP_HOME, SAVE_DIR } = vi.hoisted(() => {
  const home = `${process.env.TMPDIR ?? '/tmp'}/meccg-session-game-length-test`;
  const saves = `${home}/saves`;
  process.env.HOME = home;
  process.env.SAVE_DIR = saves;
  process.env.LOG_DIR = `${home}/logs`;
  delete process.env.JWT_SECRET;
  return { TMP_HOME: home, SAVE_DIR: saves };
});

fs.rmSync(TMP_HOME, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP_HOME, 'logs'), { recursive: true });
fs.mkdirSync(path.join(TMP_HOME, '.meccg', 'logs', 'games'), { recursive: true });

const BALIN = 'tw-123' as CardDefinitionId;
const GANDALF = 'tw-156' as CardDefinitionId;
const THRAIN = 'tw-149' as CardDefinitionId;
const RIVENDELL = 'tw-258' as CardDefinitionId;

/** Minimal (empty-sectioned) deck list — only `gameLength` matters here. */
function deckListWithLength(gameLength: GameLength | undefined): DeckList {
  return {
    id: 'test-deck',
    name: 'Test Deck',
    alignment: 'hero',
    gameLength,
    pool: [],
    deck: { characters: [], hazards: [], resources: [] },
    sites: [],
    sideboard: [],
  };
}

class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;

  send(): void { /* frames are irrelevant to these tests */ }

  join(name: string, gameLength: GameLength | undefined): void {
    this.emit('message', Buffer.from(JSON.stringify({
      type: 'join',
      name,
      alignment: Alignment.Wizard,
      draftPool: [BALIN, THRAIN],
      playDeck: [GANDALF],
      siteDeck: [RIVENDELL],
      sideboard: [],
      deckList: deckListWithLength(gameLength),
    })));
  }
}

function joinAs(session: GameSession, name: string, gameLength: GameLength | undefined): FakeSocket {
  const ws = new FakeSocket();
  session.addConnection(ws as never);
  ws.join(name, gameLength);
  return ws;
}

/** Reads the just-written autosave's full `GameState.gameLength`. */
function readAutosaveGameLength(): GameLength | undefined {
  const savePath = path.join(SAVE_DIR, 'alice_vs_bob-autosave.json');
  const saved = JSON.parse(fs.readFileSync(savePath, 'utf-8')) as { state: { gameLength?: GameLength } };
  return saved.state.gameLength;
}

describe('GameSession reconciles declared deck game lengths at game creation', () => {
  test('both decks declare Short (the default) → game length is Short', () => {
    const session = new GameSession({ playerNames: ['Alice', 'Bob'] });
    joinAs(session, 'Alice', 'short');
    joinAs(session, 'Bob', 'short');

    expect(readAutosaveGameLength()).toBe('short');
  });

  test('mismatched declared lengths (Short vs Long) reconcile to the longer, more permissive one', () => {
    const session = new GameSession({ playerNames: ['Alice', 'Bob'] });
    joinAs(session, 'Alice', 'short');
    joinAs(session, 'Bob', 'long');

    expect(readAutosaveGameLength()).toBe('long');
  });

  test('a deck declaring no length at all defaults to Short for reconciliation', () => {
    const session = new GameSession({ playerNames: ['Alice', 'Bob'] });
    joinAs(session, 'Alice', undefined);
    joinAs(session, 'Bob', 'starter');

    // Alice's undeclared length defaults to 'short', which outranks Bob's 'starter'.
    expect(readAutosaveGameLength()).toBe('short');
  });

  test('Campaign outranks every other declared length', () => {
    const session = new GameSession({ playerNames: ['Alice', 'Bob'] });
    joinAs(session, 'Alice', 'campaign');
    joinAs(session, 'Bob', 'long');

    expect(readAutosaveGameLength()).toBe('campaign');
  });
});
