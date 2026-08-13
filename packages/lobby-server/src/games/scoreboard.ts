/**
 * @module games/scoreboard
 *
 * Scoreboard built from the completed-game records the game-server writes
 * to `~/.meccg/games/<gameId>.json` (see `game-record.ts` in
 * `@meccg/game-server`; the directory convention is shared via the
 * `GAME_RECORDS_DIR` env variable, the same way `PLAYERS_DIR` is). Rows are
 * ordered by Elo rating, which `ratings.ts` reads from the rating files the
 * game-server maintains alongside the records.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadRatingHistory, loadRatings } from './ratings.js';
import type { PlayerRatingSummary, StoredRatingHistoryEntry } from './ratings.js';

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
  /**
   * The player's avatar (Wizard, Ringwraith, fallen Istar, or the Balrog).
   * Absent on records written before the game-server recovered it from the
   * player's cards — those carry a `wizard` field that is always null.
   */
  readonly avatar?: string | null;
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
  /**
   * Elo rating, or null for a player whose games predate the rating files and
   * have not been replayed yet (`bin/ratings rebuild` fixes that).
   */
  readonly rating: number | null;
  /** Highest rating ever held. Null alongside a null {@link rating}. */
  readonly peak: number | null;
  /** True while the rating rests on too few games to be trusted. */
  readonly provisional: boolean;
  /** `endedAt` of the player's most recent game, ISO timestamp. */
  readonly lastPlayed: string | null;
}

/** Where the game-server writes completed-game records. */
function gameRecordsDir(): string {
  return process.env.GAME_RECORDS_DIR ?? path.join(os.homedir(), '.meccg', 'games');
}

/**
 * Aggregate records into per-player rows, sorted by rating (descending), then
 * by games played, ties by name. Unrated players sort below every rated one.
 * Records that predate the `human` flag fall back to the lobby's `AI-` naming
 * convention.
 */
export function aggregateScoreboard(
  records: readonly ScoreboardGameRecord[],
  ratings: ReadonlyMap<string, PlayerRatingSummary> = new Map(),
): ScoreboardRow[] {
  const byName = new Map<string, {
    name: string; human: boolean; games: number; wins: number; losses: number; draws: number;
    rating: number | null; peak: number | null; provisional: boolean;
    lastPlayed: string | null;
  }>();

  for (const record of records) {
    for (const player of record.players ?? []) {
      if (!player.name) continue;
      const key = player.name.toLowerCase();
      let row = byName.get(key);
      if (!row) {
        const rating = ratings.get(key);
        row = {
          name: player.name, human: true, games: 0, wins: 0, losses: 0, draws: 0,
          rating: rating?.rating ?? null,
          peak: rating?.peak ?? null,
          provisional: rating?.provisional ?? true,
          lastPlayed: null,
        };
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
    (b.rating ?? -Infinity) - (a.rating ?? -Infinity)
    || b.games - a.games
    || a.name.localeCompare(b.name));
}

/** One side of a game as shown on the player detail page. */
export interface PlayerGameSide {
  readonly name: string;
  readonly human: boolean;
  readonly alignment: string | null;
  readonly avatar: string | null;
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
  /** The requested player's rating before this game, null if it was unrated. */
  readonly ratingBefore: number | null;
  /** Their rating after it. */
  readonly ratingAfter: number | null;
  /** `ratingAfter - ratingBefore`, the swing this game caused. */
  readonly ratingDelta: number | null;
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
    avatar: player.avatar ?? null,
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
 *
 * `ratingHistory` annotates each game with the rating swing it caused; games
 * absent from it (finished before ratings existed) report null deltas.
 */
export function playerGames(
  records: readonly ScoreboardGameRecord[],
  playerName: string,
  ratingHistory: ReadonlyMap<string, StoredRatingHistoryEntry> = new Map(),
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

    const rated = record.gameId ? ratingHistory.get(record.gameId) : undefined;

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
      ratingBefore: rated?.before ?? null,
      ratingAfter: rated?.after ?? null,
      ratingDelta: rated?.delta ?? null,
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

/** Aggregate every record on disk into scoreboard rows, rated and ranked. */
export function loadScoreboard(): ScoreboardRow[] {
  return aggregateScoreboard(readGameRecords(), loadRatings());
}

/** Every game on disk that the named player took part in, newest first. */
export function loadPlayerGames(playerName: string): PlayerGame[] {
  return playerGames(readGameRecords(), playerName, loadRatingHistory(playerName));
}
