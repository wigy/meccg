/**
 * @module cli/bench
 *
 * Throughput and statistics benchmark: runs a batch of headless games and
 * reports games/sec, decisions/game, branching factors, outcome and
 * action-type distributions. This is the P0 gate of the AI training plan —
 * the games/sec number decides how the later phases are shaped.
 *
 * Usage:
 *   npm run bench -w @meccg/sim -- [--games N] [--seed S]
 *     [--agents a,b] [--decks d1,d2] [--max-decisions N] [--out stats.json]
 */

import * as fs from 'fs';
import { playGame } from '../runner.js';
import { aggregateStats } from '../stats.js';
import type { GameRunResult } from '../runner.js';
import { parseCliArgs, numberFlag, resolveAgent, resolvePair, resolveDecks } from './common.js';

const args = parseCliArgs(process.argv.slice(2));
const games = numberFlag(args, 'games', 100);
const baseSeed = numberFlag(args, 'seed', 1);
const maxDecisions = numberFlag(args, 'max-decisions', 25000);
const agentNames = resolvePair(args, 'agents', ['random', 'random']);
const decks = resolveDecks(args);

console.log(`Benchmark: ${games} games, agents ${agentNames.join(' vs ')}, decks ${decks[0].id} vs ${decks[1].id}, seeds ${baseSeed}..${baseSeed + games - 1}`);

const results: GameRunResult[] = [];
const startedAt = Date.now();
let lastReport = startedAt;

for (let i = 0; i < games; i++) {
  const run = playGame({
    agents: [resolveAgent(agentNames[0]), resolveAgent(agentNames[1])],
    decks,
    seed: baseSeed + i,
    maxDecisions,
  });
  results.push(run);
  if (run.result.outcome !== 'completed') {
    console.log(`  game ${i} (seed ${baseSeed + i}): ${run.result.outcome}${run.result.error ? ` — ${run.result.error}` : ''}`);
  }
  const now = Date.now();
  if (now - lastReport > 5000) {
    lastReport = now;
    const rate = ((i + 1) * 1000) / (now - startedAt);
    console.log(`  … ${i + 1}/${games} games (${rate.toFixed(2)} games/sec)`);
  }
}

const wallMs = Date.now() - startedAt;
const aggregate = aggregateStats(results.map(r => ({ result: r.result, winnerIndex: r.winnerIndex })), wallMs);

console.log('');
console.log(`── Results ──`);
console.log(`games:            ${aggregate.games} in ${(wallMs / 1000).toFixed(1)}s`);
console.log(`throughput:       ${aggregate.gamesPerSec.toFixed(2)} games/sec, ${aggregate.decisionsPerSec.toFixed(0)} decisions/sec`);
console.log(`outcomes:         ${JSON.stringify(aggregate.outcomes)}`);
console.log(`wins by seat:     ${agentNames[0]}=${aggregate.winsByPlayer[0]}, ${agentNames[1]}=${aggregate.winsByPlayer[1]}, draws=${aggregate.draws}`);
console.log(`win reasons:      ${JSON.stringify(aggregate.winReasons)}`);
console.log(`decisions/game:   mean ${aggregate.decisionsPerGame.mean.toFixed(0)}, p50 ${aggregate.decisionsPerGame.p50}, p90 ${aggregate.decisionsPerGame.p90}, max ${aggregate.decisionsPerGame.max}`);
console.log(`turns/game:       mean ${aggregate.turnsPerGame.mean.toFixed(1)}, p50 ${aggregate.turnsPerGame.p50}, max ${aggregate.turnsPerGame.max}`);
console.log(`branching:        mean-of-means ${aggregate.branchingMeanPerGame.mean.toFixed(2)}, max ${aggregate.branchingMax}`);
console.log(`branching hist:   ${JSON.stringify(aggregate.branchingHistogram)}`);
console.log(`decisions/phase:  ${JSON.stringify(aggregate.decisionsByPhase)}`);

const outFile = args.flags['out'];
if (typeof outFile === 'string') {
  const payload = {
    config: { games, baseSeed, maxDecisions, agents: agentNames, decks: [decks[0].id, decks[1].id] },
    aggregate,
    games: results.map(r => r.result.stats),
  };
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  console.log(`\nStats written to ${outFile}`);
}
