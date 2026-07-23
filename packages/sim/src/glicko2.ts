/**
 * @module glicko2
 *
 * Glicko-2 rating system (Glickman, "Example of the Glicko-2 system",
 * 2013). A rating is a triple of rating, rating deviation (RD), and
 * volatility. Ratings update per *rating period*: all of a player's games
 * in the period are applied at once against the opponents' pre-period
 * ratings. The tournament harness treats each round as one rating period.
 * RD gives a 95% confidence interval of ±1.96·RD around the rating.
 */

/** A Glicko-2 rating: rating points, deviation (uncertainty), volatility. */
export interface Glicko2Rating {
  /** Rating on the classic Elo-like scale (new players start at 1500). */
  readonly rating: number;
  /** Rating deviation — standard error of the rating (new players 350). */
  readonly rd: number;
  /** Volatility — expected rating fluctuation over time (typically 0.06). */
  readonly volatility: number;
}

/** The unrated starting point: 1500 ± 350 with volatility 0.06. */
export const INITIAL_RATING: Glicko2Rating = { rating: 1500, rd: 350, volatility: 0.06 };

/** One game inside a rating period, from the rated player's perspective. */
export interface RatedGame {
  /** The opponent's rating *at the start of the rating period*. */
  readonly opponent: Glicko2Rating;
  /** Score: 1 = win, 0.5 = draw, 0 = loss. */
  readonly score: number;
}

/** Conversion between the public scale and the internal Glicko-2 scale. */
const SCALE = 173.7178;
/** Convergence tolerance of the volatility iteration. */
const CONVERGENCE = 1e-6;
/** RD never inflates past the unrated deviation. */
const MAX_RD = 350;

/** The g() weighting: discounts games against uncertain opponents. */
function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

/** Expected score against an opponent on the internal scale. */
function expectedScore(mu: number, muOpponent: number, phiOpponent: number): number {
  return 1 / (1 + Math.exp(-g(phiOpponent) * (mu - muOpponent)));
}

/**
 * Applies one rating period of games and returns the updated rating. With
 * no games the rating is unchanged and the deviation inflates by the
 * volatility (capped at the unrated 350). `tau` constrains how fast
 * volatility itself can change; 0.5 is the conventional default.
 */
export function updateRating(
  player: Glicko2Rating,
  games: readonly RatedGame[],
  tau = 0.5,
): Glicko2Rating {
  const mu = (player.rating - 1500) / SCALE;
  const phi = player.rd / SCALE;

  if (games.length === 0) {
    const phiIdle = Math.sqrt(phi * phi + player.volatility * player.volatility);
    return {
      rating: player.rating,
      rd: Math.min(phiIdle * SCALE, MAX_RD),
      volatility: player.volatility,
    };
  }

  // Estimated variance (v) of the rating from game outcomes alone, and the
  // estimated improvement (delta).
  let vInverse = 0;
  let deltaSum = 0;
  for (const game of games) {
    const muOpp = (game.opponent.rating - 1500) / SCALE;
    const phiOpp = game.opponent.rd / SCALE;
    const weight = g(phiOpp);
    const expected = expectedScore(mu, muOpp, phiOpp);
    vInverse += weight * weight * expected * (1 - expected);
    deltaSum += weight * (game.score - expected);
  }
  const v = 1 / vInverse;
  const delta = v * deltaSum;

  // New volatility via the Illinois-method iteration on f(x).
  const a = Math.log(player.volatility * player.volatility);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const phiSquaredPlusV = phi * phi + v + ex;
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * phiSquaredPlusV * phiSquaredPlusV)
      - (x - a) / (tau * tau);
  };
  let lower = a;
  let upper: number;
  if (delta * delta > phi * phi + v) {
    upper = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    upper = a - k * tau;
  }
  let fLower = f(lower);
  let fUpper = f(upper);
  while (Math.abs(upper - lower) > CONVERGENCE) {
    const mid = lower + ((lower - upper) * fLower) / (fUpper - fLower);
    const fMid = f(mid);
    if (fMid * fUpper <= 0) {
      lower = upper;
      fLower = fUpper;
    } else {
      fLower = fLower / 2;
    }
    upper = mid;
    fUpper = fMid;
  }
  const volatility = Math.exp(lower / 2);

  // New deviation and rating.
  const phiPre = Math.sqrt(phi * phi + volatility * volatility);
  const phiNew = 1 / Math.sqrt(1 / (phiPre * phiPre) + 1 / v);
  const muNew = mu + phiNew * phiNew * deltaSum;

  return {
    rating: 1500 + SCALE * muNew,
    rd: phiNew * SCALE,
    volatility,
  };
}

/** 95% confidence interval of a rating: rating ± 1.96·RD. */
export function ratingInterval(rating: Glicko2Rating): { readonly low: number; readonly high: number } {
  return { low: rating.rating - 1.96 * rating.rd, high: rating.rating + 1.96 * rating.rd };
}
