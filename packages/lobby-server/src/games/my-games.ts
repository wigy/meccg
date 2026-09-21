/**
 * @module games/my-games
 *
 * Finds a player's unfinished/left-off games: saved games still on disk
 * under SAVE_DIR that have not (yet) reached game-over, so they never show
 * up in the completed-game records `scoreboard.ts` reads. This is the data
 * behind "My Games -> Unfinished" — solving "I left a game yesterday and
 * have no way to find it again".
 *
 * The game server writes one save/autosave pair per pairing, named
 * `<name1>_vs_<name2>[-autosave].json` with both names lowercased and
 * sorted (see `routes.ts`'s `/api/saves/*` and `game-session.ts`'s
 * `autosaveFilePath`/`saveFilePath`). A save and its autosave for the same
 * opponent are the same game; only the newer of the pair is read.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Where the game server writes save/autosave files. Mirrors `routes.ts`'s `SAVE_DIR`. */
function saveDir(): string {
  return process.env.SAVE_DIR ?? path.join(os.homedir(), '.meccg', 'saves');
}

/** The slice of a save file this module reads. Structural: older saves may lack newer fields. */
interface SavedGameFile {
  readonly state?: {
    readonly gameId?: string;
    readonly players?: readonly { readonly name?: string }[];
  };
  /** Present only in tutorial saves — see `game-session.ts`'s `GameSave`. */
  readonly tutorialCursor?: number;
}

/** One of the caller's unfinished/left-off games, found on disk. */
export interface MySavedGame {
  /** The game server's own game id, or null for saves written before it recorded one. */
  readonly gameId: string | null;
  /** The opponent's display name, as recorded in the save's own state. */
  readonly opponent: string;
  /** ISO timestamp of the newer of the save/autosave pair's mtime. */
  readonly savedAt: string;
}

/** Read one save file, tolerating anything malformed as "not a game". */
function readSave(filePath: string): SavedGameFile | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SavedGameFile;
  } catch {
    return null;
  }
}

/**
 * Every unfinished/left-off game the named player is part of, newest first.
 * Matches save/autosave file names keyed `<name1>_vs_<name2>` where the
 * player is one of the two (case-insensitive). Tutorial saves (which carry
 * `tutorialCursor`) are excluded — a tutorial chapter is not "a game left
 * off". A missing SAVE_DIR yields an empty list.
 */
export function listMySavedGames(playerName: string): MySavedGame[] {
  const dir = saveDir();
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const lowerName = playerName.toLowerCase();
  const newestPerOpponent = new Map<string, { mtimeMs: number; filePath: string }>();

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const base = file.slice(0, -'.json'.length);
    const key = base.endsWith('-autosave') ? base.slice(0, -'-autosave'.length) : base;
    const names = key.split('_vs_');
    if (names.length !== 2) continue;
    const [a, b] = names;
    const opponent = a === lowerName ? b : b === lowerName ? a : null;
    if (!opponent) continue;

    const filePath = path.join(dir, file);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }
    const existing = newestPerOpponent.get(opponent);
    if (!existing || stat.mtimeMs > existing.mtimeMs) {
      newestPerOpponent.set(opponent, { mtimeMs: stat.mtimeMs, filePath });
    }
  }

  const games: MySavedGame[] = [];
  for (const [opponentKey, { mtimeMs, filePath }] of newestPerOpponent) {
    const save = readSave(filePath);
    if (!save || save.tutorialCursor !== undefined) continue;
    const opponentDisplay = save.state?.players?.find(
      p => p.name?.toLowerCase() === opponentKey,
    )?.name ?? opponentKey;
    games.push({
      gameId: save.state?.gameId ?? null,
      opponent: opponentDisplay,
      savedAt: new Date(mtimeMs).toISOString(),
    });
  }

  return games.sort((x, y) => y.savedAt.localeCompare(x.savedAt));
}
