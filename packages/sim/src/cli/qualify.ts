/**
 * @module cli/qualify
 *
 * Deck-matchup qualification: plays every requested deck pairing and
 * reports which ones the engine can actually complete, so training and
 * evaluation only ever use matchups known to work.
 *
 * This exists because deck coverage turned out to be far worse than
 * spot-checks suggested. Probing one deck against nine opponents found
 * five clean pairings, two with deadlocks, one with a single engine
 * error, and one that failed *every* game — and the short 4-game probes
 * used previously had passed several pairings whose defects only appeared
 * over longer runs. A matchup that fails is an engine bug, not a bad
 * deck: the report records the first failing seed and the error text for
 * each signature so it can be reproduced directly with `npm run bench`.
 *
 * Random play is included alongside heuristic play because it explores
 * far more of the action space per game and surfaces different defects.
 *
 * Usage:
 *   npm run qualify -w @meccg/sim -- [--decks a,b,c | --all]
 *     [--vs challenge-deck-a] [--games N] [--jobs N] [--agents modes]
 *     [--out report.json]
 *
 * `--agents` takes one or more agent pairs separated by ';', each pair being
 * two comma-separated specs — e.g. `--agents 'random,random;bc:model.json,heuristic'`.
 * Defaults to random and heuristic self-play.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listDecks, listApprovedDecks } from '../decks.js';
import { parseCliArgs, numberFlag, stringFlag, resolveList } from './common.js';
import { runChildren } from './jobs.js';

/** One game's recorded outcome, as written by `bench --results`. */
interface GameResult {
  readonly seed: number;
  readonly outcome: string;
  readonly decisions: number;
  readonly turns: number;
  readonly error?: string;
}

/** Qualification verdict for one deck pairing under one agent mode. */
interface ModeReport {
  readonly games: number;
  readonly completed: number;
  readonly outcomes: Record<string, number>;
  /** First failing game per distinct error signature, for reproduction. */
  readonly failures: { readonly seed: number; readonly outcome: string; readonly error: string }[];
}

/** Qualification verdict for one deck pairing. */
interface PairReport {
  readonly deckA: string;
  readonly deckB: string;
  readonly clean: boolean;
  readonly modes: Record<string, ModeReport>;
}

const args = parseCliArgs(process.argv.slice(2));
const games = numberFlag(args, 'games', 12);
const jobs = numberFlag(args, 'jobs', Number(process.env.SIM_JOBS ?? 4) || 4);
const baseSeed = numberFlag(args, 'seed', 424242);
const maxDecisions = numberFlag(args, 'max-decisions', 25000);
const outFile = stringFlag(args, 'out');
// Each mode is itself a comma-separated agent *pair* ("random,random"), so
// modes cannot be comma-separated from each other the way `resolveList`
// splits — they are separated by ';'. A single mode needs no separator.
const agentsFlag = args.flags['agents'];
const modes = typeof agentsFlag === 'string'
  ? agentsFlag.split(';').map(m => m.trim()).filter(m => m.length > 0)
  : ['random,random', 'heuristic,heuristic'];
// Default to the approved set; `--all` opens the whole catalog, which is
// the mode used to gather evidence for approving more decks.
const catalogIds = (args.flags['all'] === true ? listDecks() : listApprovedDecks()).map(d => d.id);
const deckIds = resolveList(args, 'decks', catalogIds);
/** When set, test this deck against every other one (specialist workflow). */
const anchor = stringFlag(args, 'vs');

/** The pairings to test: anchored fan-out, or every unordered pair. */
function buildPairs(): [string, string][] {
  if (anchor !== undefined) {
    return deckIds.filter(id => id !== anchor).map(id => [anchor, id] as [string, string]);
  }
  const pairs: [string, string][] = [];
  for (let i = 0; i < deckIds.length; i++) {
    for (let j = i + 1; j < deckIds.length; j++) pairs.push([deckIds[i], deckIds[j]]);
  }
  return pairs;
}

/** Runs one pairing under one agent mode and summarises the outcomes. */
async function runMode(deckA: string, deckB: string, mode: string, tempDir: string): Promise<ModeReport> {
  const benchScript = path.join(path.dirname(process.argv[1]), 'bench.ts');
  const perJob = Math.max(1, Math.ceil(games / jobs));
  const slices: number[] = [];
  for (let start = 0; start < games; start += perJob) slices.push(start);

  // Agent specs may be file paths (`bc:/home/…/model.json`), so everything
  // that is not alphanumeric has to go — a raw spec would otherwise be read
  // as nested directories that do not exist.
  const modeSlug = mode.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 48);
  const files = slices.map((start, i) => path.join(tempDir, `${deckA}-${deckB}-${modeSlug}-${i}.jsonl`));
  await runChildren(benchScript, slices.map((start, i) => [
    '--agents', mode,
    '--decks', `${deckA},${deckB}`,
    '--games', String(Math.min(perJob, games - start)),
    '--seed', String(baseSeed + start),
    '--max-decisions', String(maxDecisions),
    '--results', files[i],
  ]));

  const outcomes: Record<string, number> = {};
  const failures: { seed: number; outcome: string; error: string }[] = [];
  const seenSignatures = new Set<string>();
  let completed = 0;
  let total = 0;
  for (const file of files) {
    for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      const result = JSON.parse(line) as GameResult;
      total++;
      outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
      if (result.outcome === 'completed') {
        completed++;
        continue;
      }
      // Keep one example per distinct error signature: the message minus
      // the volatile sequence numbers, so repeats collapse.
      const signature = (result.error ?? result.outcome).replace(/\d+/g, '#');
      if (!seenSignatures.has(signature)) {
        seenSignatures.add(signature);
        failures.push({ seed: result.seed, outcome: result.outcome, error: result.error ?? result.outcome });
      }
    }
  }
  return { games: total, completed, outcomes, failures };
}

async function main(): Promise<void> {
  const pairs = buildPairs();
  console.log(`Qualifying ${pairs.length} pairing(s) × ${modes.length} mode(s) × ${games} games (jobs ${jobs})`);
  const reports: PairReport[] = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meccg-qualify-'));

  for (const [deckA, deckB] of pairs) {
    const modeReports: Record<string, ModeReport> = {};
    let clean = true;
    for (const mode of modes) {
      const report = await runMode(deckA, deckB, mode, tempDir);
      modeReports[mode] = report;
      if (report.completed !== report.games) clean = false;
    }
    reports.push({ deckA, deckB, clean, modes: modeReports });
    const summary = modes
      .map(mode => `${mode.split(',')[0]} ${modeReports[mode].completed}/${modeReports[mode].games}`)
      .join(', ');
    console.log(`  ${clean ? 'OK  ' : 'FAIL'} ${deckA} vs ${deckB}: ${summary}`);
    for (const mode of modes) {
      for (const failure of modeReports[mode].failures) {
        console.log(`         seed ${failure.seed} (${mode}): ${failure.outcome} — ${failure.error.slice(0, 120)}`);
      }
    }
  }
  fs.rmSync(tempDir, { recursive: true, force: true });

  const cleanPairs = reports.filter(r => r.clean);
  console.log('');
  console.log(`── Qualified: ${cleanPairs.length}/${reports.length} pairings ──`);
  for (const report of cleanPairs) console.log(`  ${report.deckA},${report.deckB}`);
  if (cleanPairs.length < reports.length) {
    console.log('');
    console.log('Failing pairings are engine bugs. Reproduce one with:');
    const first = reports.find(r => !r.clean);
    if (first) {
      const mode = modes.find(m => first.modes[m].failures.length > 0) ?? modes[0];
      const failure = first.modes[mode].failures[0];
      console.log(`  npm run bench -w @meccg/sim -- --agents ${mode} --decks ${first.deckA},${first.deckB} --games 1 --seed ${failure?.seed ?? baseSeed}`);
    }
  }

  if (outFile !== undefined) {
    fs.writeFileSync(outFile, JSON.stringify({
      config: { games, modes, baseSeed, maxDecisions, anchor },
      qualified: cleanPairs.map(r => [r.deckA, r.deckB]),
      pairs: reports,
    }, null, 2) + '\n', 'utf-8');
    console.log(`\nReport written to ${outFile}`);
  }
  if (cleanPairs.length === 0) process.exitCode = 1;
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
