/**
 * @module cli/gate
 *
 * Regression gate: the challenger agent plays a paired-seed, side-swapped
 * match against the champion, and the gate passes only when the 95% lower
 * confidence bound of the challenger's Elo difference stays at or above
 * `--min-elo` (default −75) and every game completes. The process exits
 * non-zero on failure so CI can block a weaker agent from promotion. Use
 * `--min-elo 0` for a strict promotion gate ("must demonstrably beat the
 * champion"); tighter bounds need more games (the CI narrows as 1/√N).
 *
 * Usage:
 *   npm run gate -w @meccg/sim -- --challenger <agent> [--champion heuristic]
 *     [--pairs N] [--rounds N] [--seed S] [--min-elo E] [--decks d1,d2]
 *     [--max-decisions N]
 */

import { runMatch } from '../tournament.js';
import { parseCliArgs, numberFlag, stringFlag, resolveAgent, resolveDecks } from './common.js';

const args = parseCliArgs(process.argv.slice(2));
const championSpec = stringFlag(args, 'champion') ?? 'heuristic';
const challengerSpec = stringFlag(args, 'challenger');
if (challengerSpec === undefined) {
  throw new Error('gate: --challenger <agent> is required');
}
const pairsPerRound = numberFlag(args, 'pairs', 25);
const rounds = numberFlag(args, 'rounds', 8);
const baseSeed = numberFlag(args, 'seed', 1);
const minElo = numberFlag(args, 'min-elo', -75);
const maxDecisions = numberFlag(args, 'max-decisions', 25000);
const decks = resolveDecks(args);

const totalGames = rounds * pairsPerRound * 2;
console.log(`Gate: challenger ${challengerSpec} vs champion ${championSpec}`);
console.log(`  ${totalGames} games (${rounds} round(s) × ${pairsPerRound} paired seeds, side-swapped); decks ${decks[0].id}/${decks[1].id}; seeds from ${baseSeed}`);
console.log(`  criterion: Elo-diff 95% lower bound ≥ ${minElo}, and all games complete`);

const signed = (value: number): string => `${value >= 0 ? '+' : ''}${value.toFixed(0)}`;

let lastReport = Date.now();
const match = runMatch({
  champion: { name: championSpec, agent: resolveAgent(championSpec) },
  challenger: { name: challengerSpec, agent: resolveAgent(challengerSpec) },
  decks,
  baseSeed,
  rounds,
  pairsPerRound,
  maxDecisions,
  onGame: (finished, total, record) => {
    if (record.outcome !== 'completed') {
      console.log(`  seed ${record.seed} (${record.seats.join(' vs ')}): ${record.outcome}${record.error ? ` — ${record.error}` : ''}`);
    }
    const now = Date.now();
    if (now - lastReport > 5000) {
      lastReport = now;
      console.log(`  … ${finished}/${total} games`);
    }
  },
});

const challenger = match.challenger;
const champion = match.champion;
console.log('');
console.log(`score:     ${challenger.wins}W-${challenger.losses}L-${challenger.draws}D (score ${(match.elo.score * 100).toFixed(1)}%) over ${match.elo.games} rated games`);
console.log(`elo diff:  ${signed(match.elo.diff)} [${signed(match.elo.low)}, ${signed(match.elo.high)}] (95% CI, challenger − champion)`);
console.log(`glicko-2:  challenger ${challenger.rating.rating.toFixed(0)} ±${(1.96 * challenger.rating.rd).toFixed(0)}, champion ${champion.rating.rating.toFixed(0)} ±${(1.96 * champion.rating.rd).toFixed(0)} → diff ${signed(match.glickoDiff.diff)} [${signed(match.glickoDiff.low)}, ${signed(match.glickoDiff.high)}]`);
console.log(`failures:  ${match.failures}`);
console.log('');

const eloOk = match.elo.low >= minElo;
const cleanOk = match.failures === 0;
if (eloOk && cleanOk) {
  console.log(`PASS — Elo-diff lower bound ${signed(match.elo.low)} ≥ ${minElo} and all games completed`);
} else {
  if (!eloOk) console.log(`FAIL — Elo-diff lower bound ${signed(match.elo.low)} < ${minElo}: challenger is too weak`);
  if (!cleanOk) console.log(`FAIL — ${match.failures} game(s) did not complete (engine bug or decision limit)`);
  process.exitCode = 1;
}
