/**
 * @module atomic-write
 *
 * A single crash-safe file writer for the game-server's persistence — the
 * completed-game records, the Elo rating files, the per-player games history,
 * and game saves. Every one of these is loaded elsewhere with a "malformed =
 * no data" contract (the lobby's scoreboard/ratings readers skip a file that
 * fails to parse; a corrupt save just fails to restore), so a torn write —
 * from a crash or a full disk mid-`writeFileSync` — silently destroys a
 * finished game's record, a player's whole rating history, or an in-progress
 * game.
 *
 * `writeFileAtomic` removes that hole: it writes to a temp file in the same
 * directory and renames it over the target. `rename` is atomic on a POSIX
 * filesystem (guaranteed same filesystem, since the temp sits beside the
 * target), so a reader — or a crash — never observes a half-written file.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Per-process counter making each temp file name unique. */
let tmpCounter = 0;

/**
 * Write `data` to `filePath` atomically (temp file + rename), creating the
 * parent directory first.
 *
 * The temp name carries the pid and a per-process counter so a concurrent
 * writer cannot clobber this write's temp file, and it ends in `.tmp` — never
 * `.json` — so the directory listers that enumerate records/ratings by a
 * `.json` suffix never pick it up. A failed write cleans up its temp file.
 */
export function writeFileAtomic(filePath: string, data: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${tmpCounter++}.tmp`);
  try {
    fs.writeFileSync(tmpPath, data);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* already gone */ }
    throw err;
  }
}
