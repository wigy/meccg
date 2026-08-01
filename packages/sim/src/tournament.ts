/**
 * @module tournament
 *
 * Paired-seed tournament and match harness — the "Elo ladder" (P2) of the
 * AI training plan. Every pairing plays each scheduled seed twice with the
 * seats swapped (side-swap), so seat order, deck assignment, and shuffle
 * luck cancel out of the comparison. Rounds are Glicko-2 rating periods:
 * after each round every participant's rating updates simultaneously
 * against the opponents' pre-round ratings. Head-to-head matches also
 * report an Elo difference estimated from the score rate with a 95%
 * confidence interval — the statistic the regression gate checks.
 */

import type { Agent, GameOutcome, GameResultRecord } from './types.js';
import type { LoadedDeck } from './decks.js';
import { playGame } from './runner.js';
import type { PlayGameOptions } from './runner.js';
import { INITIAL_RATING, updateRating, ratingInterval } from './glicko2.js';
import type { Glicko2Rating, RatedGame } from './glicko2.js';

// ---- Elo-from-score estimation ----

/** An Elo-difference estimate from a win/draw/loss record, with 95% bounds. */
export interface EloEstimate {
  /** Rated (completed) games behind the estimate. */
  readonly games: number;
  /** Score rate in [0, 1] from the first player's perspective. */
  readonly score: number;
  /** Point estimate of the Elo difference. */
  readonly diff: number;
  /** Lower 95% confidence bound of the difference. */
  readonly low: number;
  /** Upper 95% confidence bound of the difference. */
  readonly high: number;
}

/** Converts a score rate to an Elo difference (clamped away from 0 and 1). */
export function scoreToEloDiff(score: number): number {
  const clamped = Math.min(Math.max(score, 0.001), 0.999);
  const diff = -400 * Math.log10(1 / clamped - 1);
  return diff === 0 ? 0 : diff; // normalize an even score's -0 to 0
}

/**
 * Estimates the Elo difference implied by a win/draw/loss record. The 95%
 * interval comes from the per-game score variance under a normal
 * approximation; with paired seeds it is conservative (pairing reduces the
 * true variance) — see {@link estimatePairedEloDiff}, which spends the pairing
 * the schedule already paid for.
 */
export function estimateEloDiff(wins: number, draws: number, losses: number): EloEstimate {
  const games = wins + draws + losses;
  if (games === 0) {
    return { games: 0, score: 0.5, diff: 0, low: -Infinity, high: Infinity };
  }
  const score = (wins + 0.5 * draws) / games;
  const variance = Math.max((wins + 0.25 * draws) / games - score * score, 0);
  const margin = 1.96 * Math.sqrt(variance / games);
  return {
    games,
    score,
    diff: scoreToEloDiff(score),
    low: scoreToEloDiff(score - margin),
    high: scoreToEloDiff(score + margin),
  };
}

/**
 * Fewest complete pairs worth quoting a paired interval from.
 *
 * The normal approximation behind the margin needs a sample; below this the
 * unpaired estimate over every completed game is the more honest number even
 * though it is wider.
 */
export const MIN_PAIRS_FOR_INTERVAL = 20;

/**
 * The same estimate, but spending the pairing the schedule already paid for.
 *
 * A gate plays every seed twice, once per seating, from one RNG stream — the
 * `seed` on {@link TournamentGameRecord} is shared by both games of a pair.
 * Treating those 2N games as N independent trials is conservative, and
 * {@link estimateEloDiff} says so, but it throws the design away: whatever the
 * seed and the seating are worth is common to both games of a pair and cancels
 * inside it. What is left is the agent difference, which is the only thing a
 * gate is trying to resolve. It is the same argument `agents/mc-agent` already
 * makes for common random numbers across its own candidates.
 *
 * Measured on a real gate (87 completed games, 38 intact pairs): the per-game
 * reading is −86 [−166, −13] and the paired one −84 [−158, −17], so **about 8%**
 * off the width for no extra play. Not a transformation — the per-pair variance
 * came out 0.088 against the 0.118 two independent seatings would give, so the
 * seating effect being cancelled is only about a quarter of it. The gain is
 * larger the more the seating decides, and that run lost 12 of 50 pairs to
 * non-completed games; a clean run keeps them all.
 *
 * Only seeds whose *both* seatings completed can be paired, so a run with
 * non-completed games loses whole pairs. When fewer than
 * {@link MIN_PAIRS_FOR_INTERVAL} survive, this returns null and the caller
 * should stay with the unpaired estimate rather than quote a tighter interval
 * off a handful of pairs.
 */
export function estimatePairedEloDiff(
  games: readonly TournamentGameRecord[],
  challengerName: string,
): EloEstimate | null {
  // Score the challenger's completed games, keyed by the seed the pair shares.
  const bySeed = new Map<number, number[]>();
  for (const game of games) {
    if (game.outcome !== 'completed') continue;
    if (!game.seats.includes(challengerName)) continue;
    const score = game.winner === null ? 0.5 : game.winner === challengerName ? 1 : 0;
    const scores = bySeed.get(game.seed);
    if (scores) scores.push(score); else bySeed.set(game.seed, [score]);
  }

  // A pair is a seed both of whose seatings completed. One-sided seeds carry
  // the seating effect uncancelled, which is the bias this exists to remove.
  const pairs: number[] = [];
  for (const scores of bySeed.values()) {
    if (scores.length === 2) pairs.push((scores[0] + scores[1]) / 2);
  }
  if (pairs.length < MIN_PAIRS_FOR_INTERVAL) return null;

  const score = pairs.reduce((sum, p) => sum + p, 0) / pairs.length;
  const variance = pairs.reduce((sum, p) => sum + (p - score) ** 2, 0) / pairs.length;
  const margin = 1.96 * Math.sqrt(variance / pairs.length);
  return {
    games: pairs.length * 2,
    score,
    diff: scoreToEloDiff(score),
    low: scoreToEloDiff(score - margin),
    high: scoreToEloDiff(score + margin),
  };
}

// ---- Tournament ----

/** One entrant: a display name (unique within the event) driving an agent. */
export interface TournamentParticipant {
  readonly name: string;
  readonly agent: Agent;
}

/** The slice of {@link playGame} the harness needs — injectable for tests. */
export type TournamentPlayFn = (options: PlayGameOptions) => {
  readonly result: Pick<GameResultRecord, 'outcome' | 'decisions' | 'turns' | 'error'>;
  readonly winnerIndex: number | null;
};

/** Options for {@link runTournament}. */
export interface TournamentOptions {
  /** Entrants — at least two, with unique names. */
  readonly participants: readonly TournamentParticipant[];
  /** Decks by seat (player index); side-swap gives every agent both decks. */
  readonly decks: readonly [LoadedDeck, LoadedDeck];
  /** First seed; each scheduled pair of games consumes one consecutive seed. */
  readonly baseSeed: number;
  /** Rating periods (default 1): ratings update after each round. */
  readonly rounds?: number;
  /** Seeds per pairing per round; each is played twice, seats swapped (default 5). */
  readonly pairsPerRound?: number;
  /** Decision cap per game, passed through to the runner. */
  readonly maxDecisions?: number;
  /** Glicko-2 volatility constraint τ (default 0.5). */
  readonly tau?: number;
  /** Game player, injectable for tests (default {@link playGame}). */
  readonly play?: TournamentPlayFn;
  /** Progress hook called after every game. */
  readonly onGame?: (finished: number, total: number, record: TournamentGameRecord) => void;
}

/** One scheduled game and its outcome. */
export interface TournamentGameRecord {
  /** 0-based round (rating period) the game belongs to. */
  readonly round: number;
  /** RNG seed — shared by the two side-swapped games of a pair. */
  readonly seed: number;
  /** Participant names by seat (player index 0 and 1). */
  readonly seats: readonly [string, string];
  /** How the game ended. */
  readonly outcome: GameOutcome;
  /** Winning participant's name; null = draw or non-completed game. */
  readonly winner: string | null;
  /** Decisions the game took. */
  readonly decisions: number;
  /** Turns the game took. */
  readonly turns: number;
  /** Error detail for non-completed games. */
  readonly error?: string;
}

/** Head-to-head record of one pairing, from participant `a`'s perspective. */
export interface PairingSummary {
  readonly a: string;
  readonly b: string;
  readonly aWins: number;
  readonly bWins: number;
  readonly draws: number;
  /** Games that did not complete (excluded from ratings). */
  readonly failures: number;
  /** Score-rate Elo difference, a − b. */
  readonly elo: EloEstimate;
}

/** Final standing of one participant. */
export interface TournamentStanding {
  readonly name: string;
  readonly rating: Glicko2Rating;
  /** 95% confidence interval of the rating. */
  readonly interval: { readonly low: number; readonly high: number };
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  /** Games involving this participant that did not complete. */
  readonly failures: number;
}

/** Result of a tournament run. */
export interface TournamentResult {
  /** Standings sorted by rating, best first. */
  readonly standings: readonly TournamentStanding[];
  /** Head-to-head summaries for every pairing. */
  readonly pairings: readonly PairingSummary[];
  /** Every game played, in schedule order. */
  readonly games: readonly TournamentGameRecord[];
  /** Total games that did not complete — each one is an engine bug. */
  readonly failures: number;
}

/**
 * Runs a round-robin tournament: every pairing plays `pairsPerRound` seeds
 * per round, each seed twice with seats swapped; every round is one
 * Glicko-2 rating period. Deterministic given (participants, decks,
 * baseSeed): reruns produce identical results.
 */
export function runTournament(options: TournamentOptions): TournamentResult {
  const participants = options.participants;
  if (participants.length < 2) throw new Error('a tournament needs at least two participants');
  if (new Set(participants.map(p => p.name)).size !== participants.length) {
    throw new Error('participant names must be unique');
  }
  const rounds = options.rounds ?? 1;
  const pairsPerRound = options.pairsPerRound ?? 5;
  const play = options.play ?? playGame;
  const tau = options.tau ?? 0.5;

  const pairings: readonly [number, number][] = participants.flatMap((_, i) =>
    participants.slice(i + 1).map((_, offset) => [i, i + 1 + offset] as [number, number]),
  );
  const totalGames = rounds * pairsPerRound * 2 * pairings.length;

  let ratings: Glicko2Rating[] = participants.map(() => INITIAL_RATING);
  const tally = participants.map(() => ({ wins: 0, losses: 0, draws: 0, failures: 0 }));
  const pairTally = pairings.map(() => ({ aWins: 0, bWins: 0, draws: 0, failures: 0 }));
  const games: TournamentGameRecord[] = [];
  let seedCursor = options.baseSeed;
  let finished = 0;

  for (let round = 0; round < rounds; round++) {
    const period: RatedGame[][] = participants.map(() => []);
    pairings.forEach(([i, j], pairingIndex) => {
      const pair = pairTally[pairingIndex];
      for (let p = 0; p < pairsPerRound; p++) {
        const seed = seedCursor++;
        for (const swapped of [false, true]) {
          const seats: readonly [number, number] = swapped ? [j, i] : [i, j];
          const run = play({
            agents: [participants[seats[0]].agent, participants[seats[1]].agent],
            decks: [options.decks[0], options.decks[1]],
            seed,
            names: [participants[seats[0]].name, participants[seats[1]].name],
            maxDecisions: options.maxDecisions,
          });

          let winnerName: string | null = null;
          if (run.result.outcome !== 'completed') {
            pair.failures++;
            tally[i].failures++;
            tally[j].failures++;
          } else if (run.winnerIndex === null) {
            pair.draws++;
            tally[i].draws++;
            tally[j].draws++;
            period[i].push({ opponent: ratings[j], score: 0.5 });
            period[j].push({ opponent: ratings[i], score: 0.5 });
          } else {
            const winner = seats[run.winnerIndex];
            const loser = seats[1 - run.winnerIndex];
            winnerName = participants[winner].name;
            if (winner === i) pair.aWins++;
            else pair.bWins++;
            tally[winner].wins++;
            tally[loser].losses++;
            period[winner].push({ opponent: ratings[winner === i ? j : i], score: 1 });
            period[loser].push({ opponent: ratings[loser === i ? j : i], score: 0 });
          }

          const record: TournamentGameRecord = {
            round,
            seed,
            seats: [participants[seats[0]].name, participants[seats[1]].name],
            outcome: run.result.outcome,
            winner: winnerName,
            decisions: run.result.decisions,
            turns: run.result.turns,
            ...(run.result.error !== undefined ? { error: run.result.error } : {}),
          };
          games.push(record);
          finished++;
          options.onGame?.(finished, totalGames, record);
        }
      }
    });
    // Simultaneous rating update: all of the period's games score against
    // the opponents' pre-period ratings.
    ratings = participants.map((_, k) => updateRating(ratings[k], period[k], tau));
  }

  const standings: TournamentStanding[] = participants
    .map((participant, k) => ({
      name: participant.name,
      rating: ratings[k],
      interval: ratingInterval(ratings[k]),
      ...tally[k],
    }))
    .sort((a, b) => b.rating.rating - a.rating.rating);

  const pairingSummaries: PairingSummary[] = pairings.map(([i, j], pairingIndex) => {
    const pair = pairTally[pairingIndex];
    return {
      a: participants[i].name,
      b: participants[j].name,
      ...pair,
      elo: estimateEloDiff(pair.aWins, pair.draws, pair.bWins),
    };
  });

  return {
    standings,
    pairings: pairingSummaries,
    games,
    failures: games.filter(game => game.outcome !== 'completed').length,
  };
}

// ---- Head-to-head match (the regression-gate primitive) ----

/** Options for {@link runMatch}. */
export interface MatchOptions {
  /** The incumbent being defended. */
  readonly champion: TournamentParticipant;
  /** The agent under evaluation. */
  readonly challenger: TournamentParticipant;
  /** Decks by seat; side-swap gives both agents both decks. */
  readonly decks: readonly [LoadedDeck, LoadedDeck];
  /** First seed of the schedule. */
  readonly baseSeed: number;
  /** Rating periods (default 1). */
  readonly rounds?: number;
  /** Paired seeds per round — 2 games each (default 5). */
  readonly pairsPerRound?: number;
  /** Decision cap per game. */
  readonly maxDecisions?: number;
  /** Game player, injectable for tests. */
  readonly play?: TournamentPlayFn;
  /** Progress hook called after every game. */
  readonly onGame?: (finished: number, total: number, record: TournamentGameRecord) => void;
}

/** Result of a head-to-head match, from the challenger's perspective. */
export interface MatchResult {
  readonly challenger: TournamentStanding;
  readonly champion: TournamentStanding;
  /** Score-rate Elo difference, challenger − champion, with 95% bounds. */
  readonly elo: EloEstimate;
  /** Glicko-2 rating difference, challenger − champion, with 95% bounds. */
  readonly glickoDiff: { readonly diff: number; readonly low: number; readonly high: number };
  /** Games that did not complete — each one is an engine bug. */
  readonly failures: number;
  /** Every game played. */
  readonly games: readonly TournamentGameRecord[];
}

/**
 * Plays a paired-seed, side-swapped match between a challenger and the
 * champion and reports both rating views: the score-rate Elo difference
 * (the gate statistic) and the Glicko-2 ratings.
 */
export function runMatch(options: MatchOptions): MatchResult {
  let challengerName = options.challenger.name;
  let championName = options.champion.name;
  if (challengerName === championName) {
    challengerName = `${challengerName}-challenger`;
    championName = `${championName}-champion`;
  }

  const result = runTournament({
    participants: [
      { name: challengerName, agent: options.challenger.agent },
      { name: championName, agent: options.champion.agent },
    ],
    decks: options.decks,
    baseSeed: options.baseSeed,
    rounds: options.rounds,
    pairsPerRound: options.pairsPerRound,
    maxDecisions: options.maxDecisions,
    play: options.play,
    onGame: options.onGame,
  });

  const challenger = result.standings.find(s => s.name === challengerName);
  const champion = result.standings.find(s => s.name === championName);
  if (!challenger || !champion) throw new Error('match standings are missing a participant');
  const diff = challenger.rating.rating - champion.rating.rating;
  const spread = 1.96 * Math.sqrt(
    challenger.rating.rd * challenger.rating.rd + champion.rating.rd * champion.rating.rd,
  );

  return {
    challenger,
    champion,
    // Pairing 0 is (challenger, champion), so its Elo view is already
    // challenger − champion.
    elo: result.pairings[0].elo,
    glickoDiff: { diff, low: diff - spread, high: diff + spread },
    failures: result.failures,
    games: result.games,
  };
}
