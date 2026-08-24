/**
 * @module json-store
 *
 * The lobby's tiny JSON-file persistence idiom, written once. Every on-disk
 * store (player records, decks, mail, credit history, scoreboard game
 * records) keeps one JSON document per file and treats a missing or
 * malformed file as "no data" rather than an error. These helpers carry that
 * contract so the stores don't each re-spell the try/catch and mkdir
 * boilerplate.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Read and parse one JSON file. Returns `null` when the file is missing,
 * unreadable, or not valid JSON — the caller decides what "no data" means.
 */
export function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

/**
 * Parse every `.json` file in `dir`. Unreadable or malformed files are
 * skipped — one corrupt record must not take the whole listing down — and a
 * missing directory yields an empty list.
 */
export function readJsonDir<T>(dir: string): T[] {
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  } catch {
    return [];
  }
  const records: T[] = [];
  for (const file of files) {
    const record = readJson<T>(path.join(dir, file));
    if (record !== null) records.push(record);
  }
  return records;
}

/** Per-process counter making each temp file name unique (see {@link writeJson}). */
let tmpCounter = 0;

/**
 * Write `value` to `filePath` as pretty-printed JSON, creating the parent
 * directory first. Overwrites an existing file **atomically**: the data is
 * written to a temp file in the same directory and then renamed over the
 * target. `rename` is atomic on a POSIX filesystem, so a reader (or a crash)
 * never observes a half-written file — the old durability hole where a torn
 * write to a record like `info.json` or `credits.json` left invalid JSON that
 * {@link readJson} then silently reports as "no data", losing the account.
 *
 * The temp name carries the pid and a per-process counter so a concurrent
 * writer (e.g. `bin/credits` alongside the lobby) cannot clobber this one's
 * temp file mid-write.
 */
export function writeJson(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${tmpCounter++}.tmp`);
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2));
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    // Best-effort cleanup so a failed write does not leave a stray temp file.
    try { fs.unlinkSync(tmpPath); } catch { /* already gone */ }
    throw err;
  }
}
