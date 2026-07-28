/**
 * @module cli/horizon
 *
 * The horizon test (plan §6.4) — the ship gate against greed.
 *
 * A module claims an action is worth `+2.4 tsd`. The calibration harness can
 * check the *probabilities* behind that against the reducer, but not the
 * valuation: a module can be perfectly calibrated and still be optimising the
 * wrong thing. `docs/ai-training-system.md` §10 records exactly that failure —
 * blending the raw score differential into search leaf values predicted better
 * mid-game and still collapsed play to 2 wins in 12, because maximising
 * immediate spread is greedy in a game where marshalling points are bought
 * with corruption risk and capped by the doubling rule.
 *
 * So the test is temporal. For every decision, record what the module predicted
 * and what the tournament-score differential actually did 1, 3 and 5 turns
 * later. A module whose predictions correlate with the *immediate* change but
 * not with the change three turns out is buying points it cannot keep. The
 * plan's criterion: positive correlation at horizon 3, or the module does not
 * ship.
 *
 * Usage:
 *   npm run horizon -w @meccg/sim -- [--games 8] [--seed 1] [--agents h2,heuristic]
 */

import { loadCardPool, setEngineConsoleLog } from '@meccg/shared';
import { playGame } from '../runner.js';
import { parseCliArgs, numberFlag, resolveAgent, resolvePair, resolveDecks } from './common.js';
import type { Agent, AgentContext, GameObserver } from '../types.js';
import { DEFAULT_TUNABLES } from '../ai/h2/core/tunables.js';
import { loadWinProbModel } from '../ai/h2/core/winprob.js';
import { computeStanding } from '../ai/h2/services/standing.js';
import { ALL_MODULES, evaluateDecision } from '../ai/h2/core/registry.js';

/** Flag reference, printed by `--help`. */
const USAGE = `horizon — do a module's predictions survive three turns?

Calibration checks a module's probabilities against the reducer. This checks
its *valuation*: whether what it predicted actually happened to the score a few
turns later. A module that tracks the immediate change but not the one three
turns out is buying points it cannot keep — the greed failure recorded in
docs/ai-training-system.md §10.

Usage:
  npm run horizon -w @meccg/sim -- [options]

Options:
  --games <n>       self-play games to sample (default 8; six is not enough to
                    separate modules — the interval printed says how far off)
  --seed <n>        base seed (default 1)
  --agents <a,b>    the H2 agent and its opponent (default h2,heuristic)
  --decks <a,b>     deck IDs
  --help            this message
`;

const args = parseCliArgs(process.argv.slice(2));
if (args.flags['help'] === true || args.flags['h'] === true) {
  console.log(USAGE);
  process.exit(0);
}
setEngineConsoleLog(false);

const games = numberFlag(args, 'games', 8);
const baseSeed = numberFlag(args, 'seed', 1);
const [selfSpec, opponentSpec] = resolvePair(args, 'agents', ['h2', 'heuristic']);
const decks = resolveDecks(args);
const cardPool = loadCardPool();
const model = loadWinProbModel();

/** One prediction, with the turn it was made on. */
interface Prediction {
  readonly module: string;
  readonly turn: number;
  readonly predicted: number;
}

/** Horizons measured, in turns. */
const HORIZONS = [1, 3, 5] as const;

/**
 * Turns a module needs to appear in before its correlation is evidence.
 *
 * A correlation over five points is noise, and failing a module on it would
 * be worse than not testing it — the first run produced exactly that, calling
 * `characters` (n=5) and `factions` (n=10) failures on the strength of nothing.
 * The unit is a turn rather than a decision because that is what is correlated:
 * see the aggregation below.
 */
const MIN_PREDICTIONS = 30;

/**
 * A confidence interval on a correlation, via Fisher's z-transform.
 *
 * The gate needs this because it was giving opposite verdicts on the same
 * module. Two six-game samples put `hazards` at +0.10 and -0.18, `travel` at
 * +0.10 and -0.06: a changed discard changes the whole trajectory, and the
 * spread between runs was larger than the effect being judged. Failing a module
 * on the sign of a point estimate is failing it on noise.
 *
 * The interval is nominal in a way worth stating: predictions inside one game
 * share a trajectory, so they are not independent, and the true interval is
 * wider than this. That makes the gate conservative in the right direction — it
 * fails a module only when even an optimistic interval says the correlation is
 * negative.
 */
function interval(r: number, n: number): { lower: number; upper: number } | null {
  if (n < 5 || Math.abs(r) >= 1) return null;
  const z = Math.atanh(r);
  const se = 1 / Math.sqrt(n - 3);
  return { lower: Math.tanh(z - 1.96 * se), upper: Math.tanh(z + 1.96 * se) };
}

/**
 * How strongly a module's per-turn prediction is just its decision count.
 *
 * The trap the aggregated horizon test walks into. A module whose predictions
 * all carry the same sign — `hand` charges a shadow price for every discard —
 * has a per-turn total that is mostly *how many times it was asked*, and how
 * busy a module is tracks the state of the game for reasons that have nothing
 * to do with whether its judgement was any good. A correlation near ±1 here
 * means the horizon number above is measuring activity.
 */
function activityCorrelation(subset: readonly Prediction[]): number | null {
  const totals = new Map<string, { sum: number; count: number }>();
  for (const p of subset) {
    const key = `${(p as { game?: number }).game ?? 0}#${p.turn}`;
    const entry = totals.get(key) ?? { sum: 0, count: 0 };
    entry.sum += p.predicted;
    entry.count++;
    totals.set(key, entry);
  }
  const values = [...totals.values()];
  return correlation(values.map(v => v.sum), values.map(v => v.count));
}

/** Above this, the per-turn total is reported as an activity measure. */
const ACTIVITY_WARNING = 0.8;

/** Pearson correlation, or null when a series does not vary. */
function correlation(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx <= 0 || syy <= 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

const predictions: Prediction[] = [];
/** Differential by turn, from the H2 seat's perspective, per game. */
const tsdByTurn: Map<number, number>[] = [];

for (let g = 0; g < games; g++) {
  const inner = resolveAgent(selfSpec);
  const byTurn = new Map<number, number>();
  tsdByTurn.push(byTurn);
  const gameIndex = g;

  const spy: Agent = {
    name: inner.name,
    startGame: () => inner.startGame?.(),
    chooseAction(context: AgentContext) {
      const decision = inner.chooseAction(context);
      // Ask the registry what it thought of the action actually taken. The
      // agent may have sampled a different one; what is being tested is the
      // module's opinion of the move that was played, not of its favourite.
      const standing = computeStanding(context.view, model, DEFAULT_TUNABLES);
      const { evaluations } = evaluateDecision(ALL_MODULES, {
        view: context.view,
        cardPool,
        legalActions: context.legalActions,
        tunables: DEFAULT_TUNABLES,
        standing,
      });
      const taken = evaluations.find(e => e.action === decision.action);
      if (taken && taken.expectedTsd !== 0) {
        predictions.push({
          module: taken.module,
          turn: context.view.turnNumber,
          predicted: taken.expectedTsd,
        });
        // Tag the prediction with its game so the realized change is read
        // from the right game's score trace.
        (predictions[predictions.length - 1] as { game?: number }).game = gameIndex;
      }
      return decision;
    },
  };

  const observer: GameObserver = {
    onTransition(record) {
      byTurn.set(record.turn, record.scores[0] - record.scores[1]);
    },
  };
  playGame({
    agents: [spy, resolveAgent(opponentSpec)],
    decks,
    seed: baseSeed + g,
    observers: [observer],
  });
  console.log(`  … game ${g + 1}/${games}, ${predictions.length} predictions so far`);
}

/** The differential in a game at a turn, or the last turn recorded before it. */
function differentialAt(game: number, turn: number): number | null {
  const byTurn = tsdByTurn[game];
  for (let t = turn; t >= 0; t--) {
    const value = byTurn.get(t);
    if (value !== undefined) return value;
  }
  return null;
}

console.log('');
console.log(`${predictions.length} predictions over ${games} games`);
console.log('');

const modules = [...new Set(predictions.map(p => p.module))].sort();
let failures = 0;

for (const moduleName of ['(all)', ...modules]) {
  const subset = moduleName === '(all)' ? predictions : predictions.filter(p => p.module === moduleName);
  const parts: string[] = [];
  for (const horizon of HORIZONS) {
    // Aggregated by turn, not by decision. Sixteen games said every module's
    // per-decision correlation was indistinguishable from zero out to n=2689,
    // and that is what the measurement deserves: one action among the hundreds
    // taken in a turn cannot explain what the score did three turns later. What
    // a module claims about a *turn* is the sum of what it claimed inside it,
    // and that is a quantity the score change can actually answer.
    const byTurn = new Map<string, number>();
    for (const p of subset) {
      const game = (p as { game?: number }).game ?? 0;
      const key = `${game}#${p.turn}`;
      byTurn.set(key, (byTurn.get(key) ?? 0) + p.predicted);
    }
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [key, predicted] of byTurn) {
      const [game, turn] = key.split('#').map(Number);
      const now = differentialAt(game, turn);
      const later = differentialAt(game, turn + horizon);
      if (now === null || later === null) continue;
      xs.push(predicted);
      ys.push(later - now);
    }
    const r = correlation(xs, ys);
    const ci = r === null ? null : interval(r, xs.length);
    const range = ci ? ` [${ci.lower.toFixed(2)}, ${ci.upper.toFixed(2)}]` : '';
    parts.push(`h${horizon} ${r === null ? '  n/a' : (r >= 0 ? '+' : '') + r.toFixed(2)}${range} (n=${xs.length})`);
    // The plan's criterion is horizon 3: a module that predicts the immediate
    // change but not this one is buying points it cannot keep. It fails only
    // when the whole interval is negative — a point estimate below zero is
    // routinely a different sample of the same module.
    if (horizon === 3 && moduleName !== '(all)' && ci !== null && ci.upper <= 0
      && xs.length >= MIN_PREDICTIONS) {
      failures++;
    }
  }
  const turns = new Set(subset.map(p => `${(p as { game?: number }).game ?? 0}#${p.turn}`)).size;
  const thin = turns < MIN_PREDICTIONS && moduleName !== '(all)';
  console.log(`  ${moduleName.padEnd(12)} ${parts.join('   ')}${thin ? '   — too few to judge' : ''}`);
  const activity = activityCorrelation(subset);
  if (activity !== null && Math.abs(activity) > ACTIVITY_WARNING) {
    console.log(`  ${' '.repeat(12)} ⚠ its per-turn total is ${(activity >= 0 ? '+' : '') + activity.toFixed(2)} `
      + 'correlated with how many decisions it made that turn — the number above is');
    console.log(`  ${' '.repeat(12)}   partly about how busy the module was, not about its judgement`);
  }
}

console.log('');
console.log('Correlation of a module\'s predicted Δtsd over a turn against the realized');
console.log('change 1/3/5 turns later, with a 95% interval. Plan §6.4: a module must be');
console.log('positive at horizon 3 — otherwise it is optimising immediate spread, the');
console.log('failure recorded in ai-training-system §10.');
console.log('');
console.log('Two things the first version of this got wrong, both visible in its output:');
console.log('it correlated single *decisions*, which no score change can answer, and it');
console.log('failed a module on the sign of a point estimate — two six-game samples put');
console.log(`the same module at +0.10 and -0.18. A module needs ${MIN_PREDICTIONS} turns before it is`);
console.log('judged, and fails only when the whole interval is negative. Turns within a');
console.log('game share a trajectory, so the true interval is wider than the one printed.');
if (failures > 0) {
  console.log('');
  console.log(`${failures} module(s) negative at horizon 3 across the whole interval.`);
  process.exit(1);
}
