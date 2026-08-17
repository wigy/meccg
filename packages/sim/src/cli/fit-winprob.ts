/**
 * @module cli/fit-winprob
 *
 * Fits the Heuristics-2 win-probability model `W(tsd, turn)` from self-play
 * and writes the versioned coefficient file the agent loads.
 *
 * Usage:
 *   npm run fit-winprob -w @meccg/sim -- [--games 400] [--seed 1]
 *     [--agents heuristic,heuristic] [--decks a,b] [--holdout 0.25] [--out path]
 *
 * Why self-play rather than the lobby's game logs: `W` needs a *winner*, and
 * almost no recorded lobby game reaches game-over — they are abandoned. A
 * seeded self-play batch is both complete and reproducible from the seed
 * recorded in the output file.
 *
 * Games, not decisions, are the sample unit (`docs/ai-training-system.md` §9):
 * every observation from one game shares that game's label, so the holdout
 * split is by game or the reported Brier score flatters itself.
 */

import * as fs from 'fs';
import * as path from 'path';
import { playGame } from '../runner.js';
import { parseCliArgs, numberFlag, stringFlag, resolveAgent, resolvePair, resolveDecks } from './common.js';
import type { GameObserver } from '../types.js';
import type { WinProbModel } from '../ai/h2/core/winprob.js';
import { MODEL_PATH } from '../ai/h2/core/winprob.js';
import type { WinProbSample } from '../ai/h2/core/winprob-fit.js';
import { evaluateModel, fitCoefficients } from '../ai/h2/core/winprob-fit.js';

const args = parseCliArgs(process.argv.slice(2));
const games = numberFlag(args, 'games', 400);
const baseSeed = numberFlag(args, 'seed', 1);
const holdoutFraction = numberFlag(args, 'holdout', 0.25);
// `heuristic:sample` keeps the fitting set the shape it had when the shipped
// coefficients were fitted: W(tsd, turn) is a map from position to outcome, and
// an argmax self-play batch would sample that map along one line per seed.
const agentNames = resolvePair(args, 'agents', ['heuristic:sample', 'heuristic:sample']);
const decks = resolveDecks(args);
const outPath = stringFlag(args, 'out') ?? MODEL_PATH;

console.log(`Fitting W(tsd, turn) from ${games} self-play games: ${agentNames.join(' vs ')}, `
  + `decks ${decks[0].id} vs ${decks[1].id}, seeds ${baseSeed}..${baseSeed + games - 1}`);

// ---- Collect (tsd, turn) → eventual winner ----

interface RawSample {
  readonly gameIndex: number;
  readonly turn: number;
  /** TSD from player 0's perspective. */
  readonly tsd: number;
}

const raw: RawSample[] = [];
const winnerByGame: (number | null)[] = [];
const turnsPerGame: number[] = [];
const startedAt = Date.now();
let lastReport = startedAt;

for (let i = 0; i < games; i++) {
  // One observation per turn: the score at the last transition of that turn.
  const scoreByTurn = new Map<number, readonly [number, number]>();
  const observer: GameObserver = {
    onTransition(record) {
      scoreByTurn.set(record.turn, record.scores);
    },
  };
  const run = playGame({
    agents: [resolveAgent(agentNames[0]), resolveAgent(agentNames[1])],
    decks,
    seed: baseSeed + i,
    observers: [observer],
  });
  winnerByGame.push(run.result.outcome === 'completed' ? run.winnerIndex : null);
  turnsPerGame.push(run.result.turns);
  for (const [turn, scores] of scoreByTurn) {
    raw.push({ gameIndex: i, turn, tsd: scores[0] - scores[1] });
  }

  const now = Date.now();
  if (now - lastReport > 5000) {
    lastReport = now;
    console.log(`  … ${i + 1}/${games} games (${(((i + 1) * 1000) / (now - startedAt)).toFixed(2)} games/sec)`);
  }
}

const usableGames = winnerByGame.filter(w => w !== null).length;
if (usableGames === 0) throw new Error('No completed games with a winner — nothing to fit.');

// Both perspectives of every game are emitted. That doubles the corpus and,
// more importantly, makes the odd-in-TSD symmetry of the model an exact
// property of the data rather than something the fit has to discover.
const samples: WinProbSample[] = [];
for (const r of raw) {
  const winner = winnerByGame[r.gameIndex];
  if (winner === null) continue;
  samples.push({ tsd: r.tsd, turn: r.turn, won: winner === 0 ? 1 : 0, gameIndex: r.gameIndex });
  samples.push({ tsd: -r.tsd, turn: r.turn, won: winner === 1 ? 1 : 0, gameIndex: r.gameIndex });
}

// ---- Split by game, fit, score ----

const completedIndices = winnerByGame.map((w, i) => (w === null ? -1 : i)).filter(i => i >= 0);
const holdoutCount = Math.max(1, Math.round(completedIndices.length * holdoutFraction));
// Deterministic split: the last N completed games are held out. With seeded
// self-play the batch order is itself arbitrary, so no shuffle is needed.
const holdoutGames = new Set(completedIndices.slice(-holdoutCount));
const trainSamples = samples.filter(s => !holdoutGames.has(s.gameIndex));
const holdoutSamples = samples.filter(s => holdoutGames.has(s.gameIndex));

/** Median game length, used to normalise the turn feature. */
const sortedTurns = [...turnsPerGame].sort((a, b) => a - b);
const turnScale = sortedTurns[Math.floor(sortedTurns.length / 2)] || 1;

const coefficients = fitCoefficients(trainSamples, { turnScale });
const scaffold = {
  version: 1 as const,
  fittedAt: new Date().toISOString(),
  turnScale,
  tsd: coefficients.tsd,
  tsdTurn: coefficients.tsdTurn,
  corpus: {
    games: completedIndices.length - holdoutCount,
    samples: trainSamples.length,
    agents: agentNames,
    decks: [decks[0].id, decks[1].id] as readonly string[],
    seedBase: baseSeed,
    holdoutFraction,
  },
};
// Scoring needs a model, and the model records its own score — so the metrics
// are computed against the freshly fitted coefficients before the file is
// assembled around them.
const holdout = evaluateModel(
  { ...scaffold, holdout: { games: 0, samples: 0, brier: 0, logLoss: 0, signAccuracy: 0, reliability: [] } },
  holdoutSamples,
);
const model: WinProbModel = { ...scaffold, holdout: { games: holdoutCount, ...holdout } };

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(model, null, 2)}\n`, 'utf-8');

// ---- Report ----

console.log('');
console.log('── Fit ──');
console.log(`completed games:  ${completedIndices.length}/${games} (${games - completedIndices.length} unfinished or drawn, excluded)`);
console.log(`turn scale:       ${turnScale} (median game length)`);
console.log(`coefficients:     tsd ${coefficients.tsd.toFixed(5)}, tsd·t̂ ${coefficients.tsdTurn.toFixed(5)}`);
console.log(`train samples:    ${trainSamples.length} from ${completedIndices.length - holdoutCount} games`);
console.log('');
console.log('── Held-out games ──');
console.log(`games / samples:  ${holdoutCount} / ${holdoutSamples.length}`);
console.log(`Brier:            ${model.holdout.brier.toFixed(4)}  (0.25 = coin flip)`);
console.log(`log loss:         ${model.holdout.logLoss.toFixed(4)}  (0.693 = coin flip)`);
console.log(`sign accuracy:    ${(model.holdout.signAccuracy * 100).toFixed(1)}%`);
console.log('');
console.log('reliability (predicted → actual, held out):');
for (const bin of model.holdout.reliability) {
  if (bin.count === 0) continue;
  console.log(`  ${bin.from.toFixed(1)}–${bin.to.toFixed(1)}  n=${String(bin.count).padStart(6)}  `
    + `predicted ${(bin.predicted * 100).toFixed(1)}%  actual ${(bin.actual * 100).toFixed(1)}%`);
}
console.log('');
console.log(`Model written to ${outPath}`);
