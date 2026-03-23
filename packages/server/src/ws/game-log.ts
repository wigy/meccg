/**
 * @module game-log
 *
 * Machine-readable JSONL (JSON Lines) loggers for game analysis.
 *
 * Two log streams:
 * 1. **Server log** (`~/.meccg/logs/server/YYYY-MM-DD.jsonl`) — one file per
 *    day, records server lifecycle, connections, messages, and actions.
 *    Does NOT include full game state to keep file sizes manageable.
 *
 * 2. **Game log** (`~/.meccg/logs/games/{gameId}.jsonl`) — one file per game,
 *    records full game state snapshots after every event for replay/analysis.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SERVER_LOG_DIR = process.env.LOG_DIR ?? path.join(os.homedir(), '.meccg', 'logs', 'server');
const GAME_LOG_DIR = path.join(os.homedir(), '.meccg', 'logs', 'games');

/** A single log entry — serialized as one JSON line. */
interface LogEntry {
  /** ISO 8601 timestamp. */
  ts: string;
  /** Event type identifier. */
  event: string;
  /** Event-specific payload. */
  [key: string]: unknown;
}

/** Write a log entry to a stream. */
function writeEntry(stream: fs.WriteStream, event: string, data?: Record<string, unknown>): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    event,
    ...data,
  };
  stream.write(JSON.stringify(entry) + '\n');
}

/**
 * Server-level JSONL logger. One file per day, appended across restarts.
 * Logs connections, messages, actions, and lifecycle events — but NOT full game state.
 */
export class ServerLog {
  private readonly stream: fs.WriteStream;

  constructor() {
    fs.mkdirSync(SERVER_LOG_DIR, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const filePath = path.join(SERVER_LOG_DIR, `${date}.jsonl`);
    this.stream = fs.createWriteStream(filePath, { flags: 'a' });
    console.log(`Server log: ${filePath}`);
  }

  /** Write a server log entry. */
  log(event: string, data?: Record<string, unknown>): void {
    writeEntry(this.stream, event, data);
  }

  /** Flush and close. */
  close(): void {
    this.stream.end();
  }
}

/**
 * Per-game JSONL logger. One file per game ID.
 * Logs full game state snapshots after every event for replay/analysis.
 */
export class GameLog {
  private stream: fs.WriteStream | null = null;
  private currentGameId: string | null = null;

  /** Start or switch to a new game log file. */
  open(gameId: string): void {
    if (this.currentGameId === gameId) return;
    this.close();
    fs.mkdirSync(GAME_LOG_DIR, { recursive: true });
    const filePath = path.join(GAME_LOG_DIR, `${gameId}.jsonl`);
    this.stream = fs.createWriteStream(filePath, { flags: 'a' });
    this.currentGameId = gameId;
    console.log(`Game log: ${filePath}`);
  }

  /**
   * Write static game data to a separate JSON file: card definitions and
   * the instance-to-definition mapping. Both are immutable within a game,
   * so they are written once at game start and omitted from every JSONL entry.
   */
  writeStaticData(cardPool: Record<string, unknown>, instanceMap: Record<string, { definitionId: string }>): void {
    if (!this.currentGameId) return;
    // Compact instance map: { "i-0": "tw-156", ... }
    const instances: Record<string, string> = {};
    for (const [id, inst] of Object.entries(instanceMap)) {
      instances[id] = inst.definitionId;
    }
    // Only include card definitions actually referenced
    const usedDefIds = new Set(Object.values(instances));
    const cards: Record<string, unknown> = {};
    for (const defId of usedDefIds) {
      if (cardPool[defId]) {
        cards[defId] = cardPool[defId];
      }
    }
    const data = { instances, cards };
    const filePath = path.join(GAME_LOG_DIR, `${this.currentGameId}-cards.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    console.log(`Static game data: ${filePath} (${Object.keys(instances).length} instances, ${usedDefIds.size} definitions)`);
  }

  /** Write a game log entry (typically a state snapshot). */
  log(event: string, data?: Record<string, unknown>): void {
    if (this.stream) {
      writeEntry(this.stream, event, data);
    }
  }

  /**
   * Truncate the game log to remove all entries with stateSeq > the given value.
   * Used when loading an old save to keep the log consistent with the game state.
   */
  truncateAfterSeq(seq: number): void {
    if (!this.currentGameId) return;
    const filePath = path.join(GAME_LOG_DIR, `${this.currentGameId}.jsonl`);

    // Close the current stream before reading/rewriting
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }

    if (!fs.existsSync(filePath)) return;

    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim());
    const kept: string[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        const entrySeq = typeof entry.stateSeq === 'number' ? entry.stateSeq : -1;
        // Keep entries without stateSeq or with stateSeq <= target
        if (entrySeq <= seq) {
          kept.push(line);
        }
      } catch {
        kept.push(line); // keep unparseable lines
      }
    }

    fs.writeFileSync(filePath, kept.join('\n') + '\n', 'utf-8');
    console.log(`Game log truncated: kept entries with stateSeq <= ${seq} (${kept.length}/${lines.length} lines)`);

    // Reopen the stream for appending
    this.stream = fs.createWriteStream(filePath, { flags: 'a' });
  }

  /** Flush and close the current game log file. */
  close(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
      this.currentGameId = null;
    }
  }
}
