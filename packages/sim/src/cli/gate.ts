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
 * `--jobs N` pre-plays the match schedule in parallel: the paired-seed
 * schedule is deterministic (each of `rounds × pairs` consecutive seeds is
 * played once per seating), so bench children play seed slices of both
 * seatings concurrently and the cached outcomes feed the unchanged rating
 * harness — results are identical to a serial run.
 *
 * Usage:
 *   npm run gate -w @meccg/sim -- --challenger <agent> [--champion heuristic]
 *     [--pairs N] [--rounds N] [--seed S] [--min-elo E] [--decks d1,d2]
 *     [--max-decisions N] [--jobs N]
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runMatch } from '../tournament.js';
import type { TournamentPlayFn } from '../tournament.js';
import { parseCliArgs, numberFlag, stringFlag, resolveAgent, resolveDecks } from './common.js';
import { sliceGames, runChildren } from './jobs.js';

const args = parseCliArgs(process.argv.slice(2));
const championSpec = stringFlag(args, 'champion') ?? 'heuristic';
const challengerFlag = stringFlag(args, 'challenger');
if (challengerFlag === undefined) {
  throw new Error('gate: --challenger <agent> is required');
}
const challengerSpec: string = challengerFlag;
const pairsPerRound = numberFlag(args, 'pairs', 25);
const rounds = numberFlag(args, 'rounds', 8);
const baseSeed = numberFlag(args, 'seed', 1);
const minElo = numberFlag(args, 'min-elo', -75);
const maxDecisions = numberFlag(args, 'max-decisions', 25000);
// SIM_JOBS lets a driver script (e.g. selfplay_loop.sh) parallelize every
// CLI call it makes without threading a flag through its own interface.
const jobs = numberFlag(args, 'jobs', Number(process.env.SIM_JOBS ?? 1) || 1);
const decks = resolveDecks(args);

const totalGames = rounds * pairsPerRound * 2;
console.log(`Gate: challenger ${challengerSpec} vs champion ${championSpec}`);
console.log(`  ${totalGames} games (${rounds} round(s) × ${pairsPerRound} paired seeds, side-swapped${jobs > 1 ? `, ${jobs} jobs` : ''}); decks ${decks[0].id}/${decks[1].id}; seeds from ${baseSeed}`);
console.log(`  criterion: Elo-diff 95% lower bound ≥ ${minElo}, and all games complete`);

const signed = (value: number): string => `${value >= 0 ? '+' : ''}${value.toFixed(0)}`;

/** One cached game outcome from a bench child. */
interface CachedResult {
  readonly seed: number;
  readonly winnerIndex: number | null;
  readonly outcome: string;
  readonly decisions: number;
  readonly turns: number;
  readonly error?: string;
}

/**
 * Pre-plays every scheduled game with bench children: the schedule uses
 * seeds `baseSeed .. baseSeed + rounds*pairs - 1`, each seed once per
 * seating. Returns a play function serving the cached outcomes.
 */
async function prePlaySchedule(): Promise<TournamentPlayFn> {
  const totalSeeds = rounds * pairsPerRound;
  const slices = sliceGames(totalSeeds, jobs);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meccg-gate-'));
  const benchScript = path.join(path.dirname(process.argv[1]), 'bench.ts');

  const argLists: string[][] = [];
  const shardMeta: { arrangement: number; file: string }[] = [];
  for (const arrangement of [0, 1]) {
    // Semicolon, not comma: an agent spec may be a module *set*
    // (`h2:combat,kill`), and passing those to the child on a comma made the
    // child read fifteen agents. See `resolvePair`.
    const agents = arrangement === 0
      ? `${challengerSpec};${championSpec}`
      : `${championSpec};${challengerSpec}`;
    for (const slice of slices) {
      const file = path.join(tempDir, `results-${arrangement}-${slice.index}.jsonl`);
      shardMeta.push({ arrangement, file });
      argLists.push([
        '--agents', agents,
        '--decks', `${decks[0].id},${decks[1].id}`,
        '--games', String(slice.games),
        '--seed', String(baseSeed + slice.firstGame),
        '--max-decisions', String(maxDecisions),
        '--results', file,
      ]);
    }
  }
  await runChildren(benchScript, argLists);

  const cache = new Map<string, CachedResult>();
  for (const { arrangement, file } of shardMeta) {
    for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      const record = JSON.parse(line) as CachedResult;
      cache.set(`${record.seed}:${arrangement}`, record);
    }
  }
  fs.rmSync(tempDir, { recursive: true, force: true });

  // Names as runMatch will assign them (suffixed only on spec collision).
  const challengerName = challengerSpec === championSpec ? `${challengerSpec}-challenger` : challengerSpec;

  return options => {
    const arrangement = options.names?.[0] === challengerName ? 0 : 1;
    const cached = cache.get(`${options.seed}:${arrangement}`);
    if (!cached) throw new Error(`gate --jobs: no pre-played result for seed ${options.seed} arrangement ${arrangement}`);
    return {
      result: {
        outcome: cached.outcome as 'completed',
        decisions: cached.decisions,
        turns: cached.turns,
        error: cached.error,
      },
      winnerIndex: cached.winnerIndex,
    };
  };
}

async function main(): Promise<void> {
  const play = jobs > 1 ? await prePlaySchedule() : undefined;
  let lastReport = Date.now();
  const match = runMatch({
    champion: { name: championSpec, agent: resolveAgent(championSpec) },
    challenger: { name: challengerSpec, agent: resolveAgent(challengerSpec) },
    decks,
    baseSeed,
    rounds,
    pairsPerRound,
    maxDecisions,
    play,
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
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
