/**
 * @module client-log
 *
 * Machine-readable JSONL logger for the text client.
 * Writes to `~/.meccg/logs/client-text/YYYY-MM-DD.jsonl`.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const LOG_DIR = path.join(os.homedir(), '.meccg', 'logs', 'client-text');

/** Append-only JSONL logger for the text client. */
export class ClientLog {
  private readonly stream: fs.WriteStream;

  constructor() {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const filePath = path.join(LOG_DIR, `${date}.jsonl`);
    this.stream = fs.createWriteStream(filePath, { flags: 'a' });
  }

  /** Write a log entry. */
  log(event: string, data?: Record<string, unknown>): void {
    const entry = { ts: new Date().toISOString(), event, ...data };
    this.stream.write(JSON.stringify(entry) + '\n');
  }

  /** Flush and close. */
  close(): void {
    this.stream.end();
  }
}
