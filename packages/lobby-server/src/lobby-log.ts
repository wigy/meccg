/**
 * @module lobby-log
 *
 * Machine-readable JSONL logger for the lobby server.
 *
 * Writes to `~/.meccg/logs/lobby/YYYY-MM-DD.jsonl` — one file per day,
 * appended across restarts. Records server lifecycle, player auth events,
 * lobby presence, game launches, and errors.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const LOBBY_LOG_DIR = process.env.LOG_DIR ?? path.join(os.homedir(), '.meccg', 'logs', 'lobby');

/** A single log entry — serialized as one JSON line. */
interface LogEntry {
  /** ISO 8601 timestamp. */
  ts: string;
  /** Event type identifier. */
  event: string;
  /** Event-specific payload. */
  [key: string]: unknown;
}

/**
 * Lobby server JSONL logger. One file per day, appended across restarts.
 * Logs auth, presence, matchmaking, game lifecycle, and error events.
 */
class LobbyLog {
  private stream: fs.WriteStream;

  constructor() {
    fs.mkdirSync(LOBBY_LOG_DIR, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const filePath = path.join(LOBBY_LOG_DIR, `${date}.jsonl`);
    this.stream = fs.createWriteStream(filePath, { flags: 'a' });
  }

  /** Write a log entry. */
  log(event: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      event,
      ...data,
    };
    this.stream.write(JSON.stringify(entry) + '\n');
  }

  /** Flush and close. */
  close(): void {
    this.stream.end();
  }
}

/** Singleton lobby log instance. */
export const lobbyLog = new LobbyLog();
