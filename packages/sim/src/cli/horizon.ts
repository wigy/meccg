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
  --games <n>       self-play games to sample (default 8)
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
 * Predictions a module needs before its correlation is treated as evidence.
 *
 * A correlation over five points is noise, and failing a module on it would
 * be worse than not testing it — the first run produced exactly that, calling
 * `characters` (n=5) and `factions` (n=10) failures on the strength of nothing.
 */
const MIN_PREDICTIONS = 30;

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
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of subset) {
      const game = (p as { game?: number }).game ?? 0;
      const now = differentialAt(game, p.turn);
      const later = differentialAt(game, p.turn + horizon);
      if (now === null || later === null) continue;
      xs.push(p.predicted);
      ys.push(later - now);
    }
    const r = correlation(xs, ys);
    parts.push(`h${horizon} ${r === null ? '  n/a' : (r >= 0 ? '+' : '') + r.toFixed(2)} (n=${xs.length})`);
    // The plan's criterion is horizon 3: a module that predicts the immediate
    // change but not this one is buying points it cannot keep.
    if (horizon === 3 && moduleName !== '(all)' && r !== null && r <= 0 && xs.length >= MIN_PREDICTIONS) {
      failures++;
    }
  }
  const thin = subset.length < MIN_PREDICTIONS && moduleName !== '(all)';
  console.log(`  ${moduleName.padEnd(12)} ${parts.join('   ')}${thin ? '   — too few to judge' : ''}`);
}

console.log('');
console.log('Correlation of predicted Δtsd against the realized change, 1/3/5 turns later.');
console.log('Plan §6.4: a module must be positive at horizon 3 — otherwise it is optimising');
console.log(`immediate spread, the failure recorded in ai-training-system §10. Modules with`);
console.log(`fewer than ${MIN_PREDICTIONS} predictions are reported but not judged.`);
if (failures > 0) {
  console.log('');
  console.log(`${failures} module(s) non-positive at horizon 3.`);
  process.exit(1);
}
