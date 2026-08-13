/**
 * @module elo
 *
 * Classic Elo ratings for finished games: pure arithmetic and pure state
 * transitions, no I/O. {@link rating-store} is the side that reads and writes
 * `~/.meccg/players/<name>/rating.json` with these results.
 *
 * The lobby renders the ratings but never recomputes them — `games/ratings.ts`
 * in `@meccg/lobby-server` reads the stored files and declares their shape
 * structurally, the same way `games/scoreboard.ts` reads game records. So this
 * module deliberately stays in the game-server rather than in `@meccg/shared`,
 * which holds only the engine and is bundled for the browser.
 */

/** Every player starts here, the conventional Elo seed. */
export const INITIAL_RATING = 1500;

/**
 * A rating stays provisional until the player has this many rated games.
 * Provisional ratings move faster ({@link K_PROVISIONAL}) so a new account
 * converges on its true strength instead of crawling up from 1500.
 */
export const PROVISIONAL_GAMES = 15;

/** K-factor while the rating is still provisional. */
export const K_PROVISIONAL = 40;

/** K-factor once the rating is established. */
export const K_ESTABLISHED = 32;

/** A game's outcome from one player's point of view. */
export type RatingScore = 0 | 0.5 | 1;

/** One rated game as it appears in a player's rating history. */
export interface RatingHistoryEntry {
  /** Engine game id — the same id that names `~/.meccg/games/<gameId>.json`. */
  readonly gameId: string;
  /** ISO timestamp the game ended, and the key the replay order sorts on. */
  readonly endedAt: string;
  readonly opponent: string;
  /** The opponent's rating *before* the game, for context on the swing. */
  readonly opponentRating: number;
  readonly score: RatingScore;
  readonly before: number;
  readonly after: number;
  /** `after - before`, denormalised so the UI need not subtract. */
  readonly delta: number;
}

/** A player's rating and the games that produced it. */
export interface PlayerRating {
  /** The player's name as the game record spells it. */
  readonly name: string;
  /** False when the seat is played by an AI client. */
  readonly human: boolean;
  readonly rating: number;
  /** Highest rating ever held, after any game. */
  readonly peak: number;
  readonly games: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  /** True while {@link games} is below {@link PROVISIONAL_GAMES}. */
  readonly provisional: boolean;
  /** ISO timestamp of the most recent rated game. */
  readonly updatedAt: string | null;
  /** Every rated game, oldest first. */
  readonly history: readonly RatingHistoryEntry[];
}

/** The unrated starting point for a player who has finished no games yet. */
export function initialRating(name: string, human: boolean): PlayerRating {
  return {
    name,
    human,
    rating: INITIAL_RATING,
    peak: INITIAL_RATING,
    games: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    provisional: true,
    updatedAt: null,
    history: [],
  };
}

/**
 * The logistic expectation that a player rated `rating` scores against an
 * opponent rated `opponentRating`: 0.5 when equal, rising towards 1 as the
 * gap widens. A 400-point lead means a 10:1 expected score.
 */
export function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + Math.pow(10, (opponentRating - rating) / 400));
}

/** How far a single game may move a rating, given how many games back it. */
export function kFactor(gamesPlayed: number): number {
  return gamesPlayed < PROVISIONAL_GAMES ? K_PROVISIONAL : K_ESTABLISHED;
}

/** True when this game has already been folded into the rating. */
export function hasRatedGame(rating: PlayerRating, gameId: string): boolean {
  return rating.history.some(entry => entry.gameId === gameId);
}

/** One finished game, reduced to what rating needs from it. */
export interface RatedGameResult {
  readonly gameId: string;
  readonly endedAt: string;
  /** The winning player's name, or null for a draw. Matched case-insensitively. */
  readonly winner: string | null;
}

/** `a`'s score in `game`, given the two players' names. */
function scoreFor(name: string, winner: string | null): RatingScore {
  if (winner === null) return 0.5;
  return winner.toLowerCase() === name.toLowerCase() ? 1 : 0;
}

/** Fold one game into one side's rating. `expected` is computed by the caller. */
function applyOneSide(
  rating: PlayerRating,
  game: RatedGameResult,
  opponent: PlayerRating,
  score: RatingScore,
  expected: number,
): PlayerRating {
  const after = Math.round(rating.rating + kFactor(rating.games) * (score - expected));
  const games = rating.games + 1;
  return {
    ...rating,
    rating: after,
    peak: Math.max(rating.peak, after),
    games,
    wins: rating.wins + (score === 1 ? 1 : 0),
    losses: rating.losses + (score === 0 ? 1 : 0),
    draws: rating.draws + (score === 0.5 ? 1 : 0),
    provisional: games < PROVISIONAL_GAMES,
    updatedAt: game.endedAt,
    history: [...rating.history, {
      gameId: game.gameId,
      endedAt: game.endedAt,
      opponent: opponent.name,
      opponentRating: opponent.rating,
      score,
      before: rating.rating,
      after,
      delta: after - rating.rating,
    }],
  };
}

/**
 * Fold one finished game into both players' ratings and return the updated
 * pair. Both sides' expectations are computed from the *pre-game* ratings, so
 * the update is simultaneous and the order of the pair does not matter.
 *
 * Idempotent: a game already present in either player's history is ignored,
 * which is what keeps a rewritten game record (the game-server rewrites the
 * file if game over is re-reached after an undo) from being counted twice.
 * The rewritten outcome is *not* retroactively applied — `bin/ratings rebuild`
 * exists to reconcile that.
 */
export function applyRatedGame(
  a: PlayerRating,
  b: PlayerRating,
  game: RatedGameResult,
): readonly [PlayerRating, PlayerRating] {
  if (hasRatedGame(a, game.gameId) || hasRatedGame(b, game.gameId)) return [a, b];

  const scoreA = scoreFor(a.name, game.winner);
  const scoreB = (1 - scoreA) as RatingScore;
  const expectedA = expectedScore(a.rating, b.rating);

  return [
    applyOneSide(a, game, b, scoreA, expectedA),
    applyOneSide(b, game, a, scoreB, 1 - expectedA),
  ];
}
