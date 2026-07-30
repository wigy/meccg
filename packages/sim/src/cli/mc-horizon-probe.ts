/**
 * @module cli/mc-horizon-probe
 *
 * What does a longer playout horizon actually buy the flat Monte-Carlo
 * agent? — instrumentation, not a match.
 *
 * `gate` answers whether a deeper `mc` wins. It cannot say *why*, and the
 * two candidate mechanisms point in opposite directions: a longer playout
 * reaches more scoring moments (§2.2 of the rollout spec — most short
 * playouts return TSD = 0, so the estimator is a rare-event estimator), and
 * a longer playout under a uniform policy also drifts further from anything
 * either player would really do (§2.3).
 *
 * So this replays real self-play positions, replicates `mc-agent`'s decision
 * exactly at each one — same shortlist, same determinized worlds, same
 * playout seeds — and then runs the playout at several horizons **from the
 * same seed**. The policy is uniform over the same filtered candidate list
 * and the random stream is identical, so the h=4 trajectory is a
 * prefix-extension of the h=1 trajectory: horizons are compared on literally
 * the same futures, and every difference reported is the extra lookahead and
 * nothing else.
 *
 * Reported per horizon:
 *   - why playouts stop (horizon / game-over / cycle / decision-cap / …)
 *   - `zero`   the share of playouts returning TSD = 0 — the rare-event share
 *   - `noise`  sd of one candidate's playouts, pooled over positions
 *   - `signal` mean spread between the best and worst candidate mean
 *   - `t`      signal / (noise / √rounds) — the discrimination a decision gets
 *   - `flip`   how often the argmax differs from the h = 1 argmax
 *   - `cost`   mean decisions stepped per playout
 *
 * Usage:
 *   npm run mc-horizon-probe -w @meccg/sim -- [--games 2] [--seed 1]
 *     [--horizons 1,2,3,4,6,8] [--rounds 8] [--candidates 4]
 *     [--every 20] [--max-positions 40] [--agents heuristic,heuristic]
 */

import * as fs from 'fs';
import { loadCardPool, setEngineConsoleLog, reduce } from '@meccg/shared';
import type { GameAction, PlayerId } from '@meccg/shared';
import { playGame } from '../runner.js';
import { determinizeNull } from '../search/determinize-null.js';
import { isDeterminizableView } from '../search/determinize.js';
import { rollout, DEFAULT_CYCLE_LIMIT } from '../search/rollout.js';
import { createRandomStream } from '../random-stream.js';
import { createHeuristicAgent } from '../agents/heuristic-agent.js';
import { forwardActions } from '../ai/regress.js';
import type { Agent, AgentContext, AgentDecision } from '../types.js';
import { parseCliArgs, numberFlag, stringFlag, resolveAgent, resolvePair, resolveDecks } from './common.js';

/** Flag reference, printed by `--help`. */
const USAGE = `mc-horizon-probe — what does a longer playout horizon buy the estimator?

Replays self-play positions, rebuilds mc-agent's decision at each, and runs
the playouts at several horizons from the same seeds, so the horizons see the
same futures.

Options:
  --games <n>          games to walk (default 2)
  --seed <n>           base seed (default 1)
  --agents <a,b>       agents driving the game (default heuristic,heuristic)
  --decks <a,b>        deck IDs
  --horizons <list>    horizons in turns (default 1,2,3,4,6,8)
  --rounds <n>         playouts per candidate per horizon (default 8)
  --candidates <n>     shortlist size (default 4)
  --every <n>          probe every nth searchable position (default 20)
  --max-positions <n>  stop probing after this many (default 40)
  --max-decisions <n>  game decision cap (default 6000)
  --cycle-limit <n>    signature recurrences a playout may make before it is
                       called a cycle (default 12 — the guard, not the
                       horizon, is what ends most deep playouts)
  --out <path>         write the raw tallies as JSON, so runs on different
                       seeds can be merged (--merge)
  --merge <p1,p2,..>   print the report from previously written JSON files
                       instead of probing
  --help               this message
`;

const args = parseCliArgs(process.argv.slice(2));
if (args.flags['help'] === true || args.flags['h'] === true) {
  console.log(USAGE);
  process.exit(0);
}
setEngineConsoleLog(false);

const games = numberFlag(args, 'games', 2);
const baseSeed = numberFlag(args, 'seed', 1);
const rounds = numberFlag(args, 'rounds', 8);
const maxCandidates = numberFlag(args, 'candidates', 4);
const every = numberFlag(args, 'every', 20);
const maxPositions = numberFlag(args, 'max-positions', 40);
const maxDecisions = numberFlag(args, 'max-decisions', 6000);
const cycleLimit = numberFlag(args, 'cycle-limit', DEFAULT_CYCLE_LIMIT);
const horizons = (stringFlag(args, 'horizons') ?? '1,2,3,4,6,8')
  .split(',').map(part => Number(part.trim()));
const [specA, specB] = resolvePair(args, 'agents', ['heuristic', 'heuristic']);
const decks = resolveDecks(args);
const cardPool = loadCardPool();

/** Tallies accumulated per horizon over every probed position. */
interface HorizonStats {
  playouts: number;
  zero: number;
  decisions: number;
  ends: Record<string, number>;
  /** Pooled within-candidate variance contributions. */
  varSum: number;
  varCount: number;
  /** Best-minus-worst candidate mean, one per position. */
  spreads: number[];
  /** Positions where the argmax differs from the shortest horizon's. */
  flips: number;
  positions: number;
  /** Mean TSD magnitude, to show the value scale a horizon reaches. */
  absSum: number;
}

const stats = new Map<number, HorizonStats>();
for (const h of horizons) {
  stats.set(h, {
    playouts: 0, zero: 0, decisions: 0, ends: {}, varSum: 0, varCount: 0,
    spreads: [], flips: 0, positions: 0, absSum: 0,
  });
}

const heuristic = createHeuristicAgent();
let probed = 0;
let searchable = 0;

/** mc-agent's shortlist rule: forward candidates, ranked by H1's weights. */
function shortlist(context: AgentContext, limit: number): readonly GameAction[] {
  const actions = forwardActions(context.legalActions);
  if (actions.length <= limit) return actions;
  const decision = heuristic.chooseAction(context);
  const weights = new Map<GameAction, number>();
  for (const candidate of decision.considered ?? []) weights.set(candidate.action, candidate.weight);
  const ranked = [...actions].sort((a, b) => (weights.get(b) ?? 0) - (weights.get(a) ?? 0));
  const kept = ranked.slice(0, limit);
  if (!kept.includes(decision.action)) kept[kept.length - 1] = decision.action;
  return kept;
}

/** Sample variance, or 0 with fewer than two samples. */
function variance(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
}

/** Runs the multi-horizon comparison at one position. */
function probe(context: AgentContext): void {
  const actions = shortlist(context, maxCandidates);
  if (actions.length < 2) return;
  const view = context.view;
  const searcher: PlayerId = view.self.id;
  const playerIds: [PlayerId, PlayerId] = view.selfIndex === 0
    ? [searcher, view.opponent.id]
    : [view.opponent.id, searcher];
  const baseRoundSeed = Math.floor(context.random() * 0x7fffffff);

  // samples[h][candidate] — filled from the same worlds and playout seeds for
  // every horizon, which is what makes the horizons paired.
  const samples = new Map<number, number[][]>();
  for (const h of horizons) samples.set(h, actions.map(() => []));

  for (let round = 0; round < rounds; round++) {
    const roundSeed = (baseRoundSeed + round * 0x9e3779b9) | 0;
    const world = determinizeNull({ view, seed: roundSeed, cardPool });
    for (let i = 0; i < actions.length; i++) {
      const applied = reduce(world.state, actions[i]);
      if (applied.error) continue;
      for (const h of horizons) {
        const result = rollout(applied.state, {
          playerIds,
          searcher,
          unknownInstances: world.unknownInstances,
          horizonTurns: h,
          maxDecisions: h * 120,
          cycleLimit,
          random: createRandomStream(roundSeed ^ 0x2545f491),
        });
        const stat = stats.get(h)!;
        stat.playouts++;
        stat.decisions += result.decisions;
        stat.absSum += Math.abs(result.tsd);
        if (result.tsd === 0) stat.zero++;
        stat.ends[result.end] = (stat.ends[result.end] ?? 0) + 1;
        samples.get(h)![i].push(result.tsd);
      }
    }
  }

  // Per-horizon signal, noise and argmax, and the flip against horizons[0].
  let referenceArgmax = -1;
  for (const h of horizons) {
    const stat = stats.get(h)!;
    const perCandidate = samples.get(h)!;
    const means: number[] = [];
    for (const values of perCandidate) {
      if (values.length === 0) { means.push(-Infinity); continue; }
      means.push(values.reduce((a, b) => a + b, 0) / values.length);
      if (values.length >= 2) { stat.varSum += variance(values); stat.varCount++; }
    }
    const finite = means.filter(Number.isFinite);
    if (finite.length < 2) continue;
    stat.positions++;
    stat.spreads.push(Math.max(...finite) - Math.min(...finite));
    let argmax = 0;
    for (let i = 1; i < means.length; i++) if (means[i] > means[argmax]) argmax = i;
    if (h === horizons[0]) referenceArgmax = argmax;
    else if (referenceArgmax >= 0 && argmax !== referenceArgmax) stat.flips++;
  }
}

/** Drives the game with `inner` while probing every nth searchable position. */
function probingAgent(inner: Agent): Agent {
  return {
    name: `probe(${inner.name})`,
    chooseAction(context: AgentContext): AgentDecision {
      if (context.legalActions.length > 1 && isDeterminizableView(context.view)) {
        searchable++;
        if (searchable % every === 0 && probed < maxPositions) {
          probe(context);
          probed++;
          if (probed % 5 === 0) console.log(`  … ${probed}/${maxPositions} positions probed`);
        }
      }
      return inner.chooseAction(context);
    },
  };
}

/** Serializable form of the tallies, for `--out` / `--merge`. */
interface ProbeDump {
  readonly horizons: readonly number[];
  readonly rounds: number;
  readonly probed: number;
  readonly searchable: number;
  readonly stats: Record<string, HorizonStats>;
}

const mergeFlag = stringFlag(args, 'merge');
if (mergeFlag !== undefined) {
  const files = mergeFlag.split(',').map(part => part.trim());
  let first: ProbeDump | null = null;
  for (const file of files) {
    const dump = JSON.parse(fs.readFileSync(file, 'utf-8')) as ProbeDump;
    if (first === null) {
      first = dump;
      horizons.length = 0;
      horizons.push(...dump.horizons);
      stats.clear();
      for (const h of dump.horizons) stats.set(h, { ...dump.stats[String(h)], ends: { ...dump.stats[String(h)].ends }, spreads: [...dump.stats[String(h)].spreads] });
      probed = dump.probed;
      searchable = dump.searchable;
      continue;
    }
    if (dump.rounds !== first.rounds || dump.horizons.join() !== first.horizons.join()) {
      throw new Error(`--merge: ${file} used different horizons or rounds`);
    }
    probed += dump.probed;
    searchable += dump.searchable;
    for (const h of dump.horizons) {
      const into = stats.get(h)!;
      const from = dump.stats[String(h)];
      into.playouts += from.playouts;
      into.zero += from.zero;
      into.decisions += from.decisions;
      into.varSum += from.varSum;
      into.varCount += from.varCount;
      into.flips += from.flips;
      into.positions += from.positions;
      into.absSum += from.absSum;
      into.spreads.push(...from.spreads);
      for (const [name, count] of Object.entries(from.ends)) into.ends[name] = (into.ends[name] ?? 0) + count;
    }
  }
  report(0);
  process.exit(0);
}

console.log(`Horizon probe: ${games} game(s) from seed ${baseSeed}, agents ${specA} vs ${specB}`);
console.log(`  horizons ${horizons.join(',')}; ${rounds} rounds × ≤${maxCandidates} candidates per position`);
console.log(`  probing every ${every}th searchable position, at most ${maxPositions}`);
console.log(`  cycle limit ${cycleLimit}${cycleLimit === DEFAULT_CYCLE_LIMIT ? ' (default)' : ''}`);

const startedAt = Date.now();
for (let g = 0; g < games && probed < maxPositions; g++) {
  playGame({
    agents: [probingAgent(resolveAgent(specA)), resolveAgent(specB)],
    decks,
    seed: baseSeed + g,
    maxDecisions,
    cardPool,
  });
}
const wallMs = Date.now() - startedAt;

const outPath = stringFlag(args, 'out');
if (outPath !== undefined) {
  const dump: ProbeDump = {
    horizons, rounds, probed, searchable,
    stats: Object.fromEntries(horizons.map(h => [String(h), stats.get(h)!])),
  };
  fs.writeFileSync(outPath, JSON.stringify(dump), 'utf-8');
  console.log(`  wrote ${outPath}`);
}

report(wallMs);

/** Prints the per-horizon table and the ending breakdown. */
function report(elapsedMs: number): void {
const pct = (n: number, d: number): string => (d === 0 ? '   —' : `${((100 * n) / d).toFixed(1)}%`);
const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

console.log('');
console.log(`── ${probed} positions probed (${searchable} searchable seen)`
  + `${elapsedMs > 0 ? ` in ${(elapsedMs / 1000).toFixed(1)}s` : ''} ──`);
console.log('');
console.log('  h   playouts   zero   |tsd|  noise  signal      t   flip%   cost');
for (const h of horizons) {
  const stat = stats.get(h)!;
  const noise = Math.sqrt(stat.varCount === 0 ? 0 : stat.varSum / stat.varCount);
  const signal = mean(stat.spreads);
  const t = noise === 0 ? Infinity : signal / (noise / Math.sqrt(rounds));
  const flip = h === horizons[0] ? '  ref' : pct(stat.flips, stat.positions);
  console.log(
    `  ${String(h).padStart(2)}   ${String(stat.playouts).padStart(8)}  `
    + `${pct(stat.zero, stat.playouts).padStart(5)}  `
    + `${(stat.absSum / Math.max(1, stat.playouts)).toFixed(2).padStart(5)}  `
    + `${noise.toFixed(2).padStart(5)}   ${signal.toFixed(2).padStart(5)}  `
    + `${(Number.isFinite(t) ? t.toFixed(2) : '∞').padStart(5)}  ${flip.padStart(6)}  `
    + `${(stat.decisions / Math.max(1, stat.playouts)).toFixed(0).padStart(5)}`,
  );
}

console.log('');
console.log('  playout endings');
const endNames = [...new Set(horizons.flatMap(h => Object.keys(stats.get(h)!.ends)))].sort();
console.log(`   h  ${endNames.map(name => name.padStart(13)).join('')}`);
for (const h of horizons) {
  const stat = stats.get(h)!;
  console.log(
    `  ${String(h).padStart(2)}  `
    + endNames.map(name => pct(stat.ends[name] ?? 0, stat.playouts).padStart(13)).join(''),
  );
}
}
