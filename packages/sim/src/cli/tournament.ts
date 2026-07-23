/**
 * @module cli/tournament
 *
 * Round-robin Elo ladder over the agent registry: paired seeds with
 * side-swap, one Glicko-2 rating period per round, standings with 95%
 * confidence intervals — the P2 evaluation harness of the AI training
 * plan.
 *
 * Usage:
 *   npm run tournament -w @meccg/sim -- [--agents a,b,c] [--pairs N]
 *     [--rounds N] [--seed S] [--decks d1,d2] [--max-decisions N]
 *     [--out file.json]
 */

import * as fs from 'fs';
import { runTournament } from '../tournament.js';
import { parseCliArgs, numberFlag, resolveAgent, resolveDecks, resolveList } from './common.js';

const args = parseCliArgs(process.argv.slice(2));
const agentSpecs = resolveList(args, 'agents', ['random', 'heuristic']);
const pairsPerRound = numberFlag(args, 'pairs', 5);
const rounds = numberFlag(args, 'rounds', 2);
const baseSeed = numberFlag(args, 'seed', 1);
const maxDecisions = numberFlag(args, 'max-decisions', 25000);
const decks = resolveDecks(args);

// The same spec may enter twice (self-play sanity checks); dedupe the
// display names with an index suffix.
const specCounts = new Map<string, number>();
const participants = agentSpecs.map(spec => {
  const seen = specCounts.get(spec) ?? 0;
  specCounts.set(spec, seen + 1);
  return { name: seen === 0 ? spec : `${spec}#${seen + 1}`, agent: resolveAgent(spec) };
});

const pairingCount = (participants.length * (participants.length - 1)) / 2;
const totalGames = rounds * pairsPerRound * 2 * pairingCount;
console.log(`Tournament: ${participants.map(p => p.name).join(', ')}`);
console.log(`  ${rounds} round(s) × ${pairsPerRound} paired seed(s) per pairing, side-swapped = ${totalGames} games; decks ${decks[0].id}/${decks[1].id}; seeds from ${baseSeed}`);

let lastReport = Date.now();
const result = runTournament({
  participants,
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

console.log('');
console.log('── Standings (Glicko-2, ±95% CI) ──');
for (const standing of result.standings) {
  const rating = `${standing.rating.rating.toFixed(0)} ±${(1.96 * standing.rating.rd).toFixed(0)}`;
  const failures = standing.failures > 0 ? `  (${standing.failures} failed games)` : '';
  console.log(`  ${standing.name.padEnd(24)} ${rating.padStart(11)}   ${standing.wins}W-${standing.losses}L-${standing.draws}D${failures}`);
}
console.log('');
console.log('── Head-to-head (Elo diff of first vs second, 95% CI) ──');
for (const pairing of result.pairings) {
  const sign = pairing.elo.diff >= 0 ? '+' : '';
  const failures = pairing.failures > 0 ? ` (${pairing.failures} failed)` : '';
  console.log(`  ${pairing.a} vs ${pairing.b}: ${pairing.aWins}-${pairing.bWins}-${pairing.draws} → Elo ${sign}${pairing.elo.diff.toFixed(0)} [${pairing.elo.low.toFixed(0)}, ${pairing.elo.high.toFixed(0)}]${failures}`);
}
if (result.failures > 0) {
  console.log(`\nWARNING: ${result.failures} game(s) did not complete — every one is an engine bug (P0 invariant).`);
}

const outFile = args.flags['out'];
if (typeof outFile === 'string') {
  const payload = {
    config: { agents: agentSpecs, pairsPerRound, rounds, baseSeed, maxDecisions, decks: [decks[0].id, decks[1].id] },
    standings: result.standings,
    pairings: result.pairings,
    failures: result.failures,
  };
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  console.log(`\nResults written to ${outFile}`);
}
