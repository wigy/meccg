/**
 * @module games/scoreboard
 *
 * Scoreboard built from the completed-game records the game-server writes
 * to `~/.meccg/games/<gameId>.json` (see `game-record.ts` in
 * `@meccg/game-server`; the directory convention is shared via the
 * `GAME_RECORDS_DIR` env variable, the same way `PLAYERS_DIR` is). With no
 * ratings yet, rows are ordered by games played.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Marshalling points by category, as the game-server records them.
 * Structural for the same reason as {@link ScoreboardGameRecord}.
 */
export interface ScoreboardMp {
  readonly character?: number;
  readonly item?: number;
  readonly faction?: number;
  readonly ally?: number;
  readonly kill?: number;
  readonly misc?: number;
}

/** One player's slice of a completed-game record, as read off disk. */
export interface ScoreboardRecordPlayer {
  readonly name?: string;
  readonly human?: boolean;
  readonly alignment?: string;
  readonly wizard?: string | null;
  readonly deck?: { readonly name?: string | null; readonly gameLength?: string | null };
  readonly startingPlayer?: boolean;
  readonly finalScore?: number;
  readonly mp?: ScoreboardMp;
  readonly tournamentMp?: ScoreboardMp;
  readonly stagePoints?: number;
}

/**
 * The slice of a completed-game record the scoreboard reads. Structural
 * rather than imported: the lobby does not depend on `@meccg/game-server`,
 * and older records may lack newer fields (e.g. `human`).
 */
export interface ScoreboardGameRecord {
  readonly gameId?: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly durationSeconds?: number;
  readonly turns?: number;
  readonly winner?: string | null;
  readonly winReason?: string;
  readonly winCard?: string | null;
  readonly players?: readonly ScoreboardRecordPlayer[];
}

/** One scoreboard row: a player and their completed-game tally. */
export interface ScoreboardRow {
  readonly name: string;
  readonly human: boolean;
  readonly games: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  /** `endedAt` of the player's most recent game, ISO timestamp. */
  readonly lastPlayed: string | null;
}

/** Where the game-server writes completed-game records. */
function gameRecordsDir(): string {
  return process.env.GAME_RECORDS_DIR ?? path.join(os.homedir(), '.meccg', 'games');
}

/**
 * Aggregate records into per-player rows, sorted by games played
 * (descending), ties by name. Records that predate the `human` flag fall
 * back to the lobby's `AI-` naming convention.
 */
export function aggregateScoreboard(records: readonly ScoreboardGameRecord[]): ScoreboardRow[] {
  const byName = new Map<string, {
    name: string; human: boolean; games: number; wins: number; losses: number; draws: number;
    lastPlayed: string | null;
  }>();

  for (const record of records) {
    for (const player of record.players ?? []) {
      if (!player.name) continue;
      const key = player.name.toLowerCase();
      let row = byName.get(key);
      if (!row) {
        row = { name: player.name, human: true, games: 0, wins: 0, losses: 0, draws: 0, lastPlayed: null };
        byName.set(key, row);
      }
      row.human = player.human ?? !/^ai-/i.test(player.name);
      row.games++;
      if (record.winner == null) row.draws++;
      else if (record.winner.toLowerCase() === key) row.wins++;
      else row.losses++;
      if (record.endedAt && (row.lastPlayed === null || record.endedAt > row.lastPlayed)) {
        row.lastPlayed = record.endedAt;
      }
    }
  }

  return [...byName.values()].sort((a, b) =>
    b.games - a.games || a.name.localeCompare(b.name));
}

/** One side of a game as shown on the player detail page. */
export interface PlayerGameSide {
  readonly name: string;
  readonly human: boolean;
  readonly alignment: string | null;
  readonly wizard: string | null;
  readonly deckName: string | null;
  readonly gameLength: string | null;
  readonly startingPlayer: boolean;
  readonly finalScore: number | null;
  readonly mp: Required<ScoreboardMp> | null;
  readonly tournamentMp: Required<ScoreboardMp> | null;
  readonly stagePoints: number | null;
}

/**
 * One completed game from a single player's point of view: the outcome
 * plus both sides' scoring detail. `self` is always the requested player.
 */
export interface PlayerGame {
  readonly gameId: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly durationSeconds: number | null;
  readonly turns: number | null;
  readonly result: 'win' | 'loss' | 'draw';
  readonly winner: string | null;
  readonly winReason: string | null;
  readonly winCard: string | null;
  readonly self: PlayerGameSide;
  readonly opponent: PlayerGameSide | null;
}

const ZERO_MP: Required<ScoreboardMp> =
  { character: 0, item: 0, faction: 0, ally: 0, kill: 0, misc: 0 };

/** Fill in missing categories so the client can render a fixed table. */
function normalizeMp(mp: ScoreboardMp | undefined): Required<ScoreboardMp> | null {
  return mp ? { ...ZERO_MP, ...mp } : null;
}

/** Project a record's player slice into a detail-page side. */
function toSide(player: ScoreboardRecordPlayer): PlayerGameSide {
  const name = player.name ?? '?';
  return {
    name,
    human: player.human ?? !/^ai-/i.test(name),
    alignment: player.alignment ?? null,
    wizard: player.wizard ?? null,
    deckName: player.deck?.name ?? null,
    gameLength: player.deck?.gameLength ?? null,
    startingPlayer: player.startingPlayer ?? false,
    finalScore: player.finalScore ?? null,
    mp: normalizeMp(player.mp),
    tournamentMp: normalizeMp(player.tournamentMp),
    stagePoints: player.stagePoints ?? null,
  };
}

/**
 * Every game the named player took part in, most recently finished first.
 * Name matching is case-insensitive, the same way {@link aggregateScoreboard}
 * keys its rows. Games missing `endedAt` sort last.
 */
export function playerGames(
  records: readonly ScoreboardGameRecord[],
  playerName: string,
): PlayerGame[] {
  const key = playerName.toLowerCase();
  const games: PlayerGame[] = [];

  for (const record of records) {
    const self = (record.players ?? []).find(p => p.name?.toLowerCase() === key);
    if (!self) continue;
    const opponent = (record.players ?? []).find(p => p !== self);
    const result = record.winner == null
      ? 'draw'
      : record.winner.toLowerCase() === key ? 'win' : 'loss';

    games.push({
      gameId: record.gameId ?? null,
      startedAt: record.startedAt ?? null,
      endedAt: record.endedAt ?? null,
      durationSeconds: record.durationSeconds ?? null,
      turns: record.turns ?? null,
      result,
      winner: record.winner ?? null,
      winReason: record.winReason ?? null,
      winCard: record.winCard ?? null,
      self: toSide(self),
      opponent: opponent ? toSide(opponent) : null,
    });
  }

  return games.sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''));
}

/**
 * Read every record in the games directory. Unreadable or malformed files
 * are skipped — a corrupt record must not take the scoreboard down.
 * Returns an empty list when the directory does not exist (no completed
 * games yet).
 */
function readGameRecords(): ScoreboardGameRecord[] {
  const dir = gameRecordsDir();
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  } catch {
    return [];
  }
  const records: ScoreboardGameRecord[] = [];
  for (const file of files) {
    try {
      records.push(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) as ScoreboardGameRecord);
    } catch {
      // Skip malformed records.
    }
  }
  return records;
}

/** Aggregate every record on disk into scoreboard rows. */
export function loadScoreboard(): ScoreboardRow[] {
  return aggregateScoreboard(readGameRecords());
}

/** Every game on disk that the named player took part in, newest first. */
export function loadPlayerGames(playerName: string): PlayerGame[] {
  return playerGames(readGameRecords(), playerName);
}
