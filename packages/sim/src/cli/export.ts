/**
 * @module cli/export
 *
 * Behavioral-cloning training-data exporter (P3): plays headless games and
 * writes one JSONL line per decision with the featurized state (global +
 * entity vectors), the featurized candidate set with viability mask, the
 * index of the action the teacher agent chose, and the teacher's candidate
 * weights as soft targets. Game results follow as separate lines keyed by
 * game index, so the learning side can join outcomes for value targets.
 *
 * `--jobs N` fans the batch out over N child processes (contiguous seed
 * slices; see cli/jobs). The merged file is bit-identical to a serial run:
 * children write headerless shards with globally-correct game ids
 * (`--game-offset`), and the parent writes the header and concatenates
 * shards in seed order.
 *
 * Usage:
 *   npm run export-training -w @meccg/sim -- [--games N] [--seed S]
 *     [--agents a,b] [--decks d1,d2] [--out training.jsonl]
 *     [--max-decisions N] [--jobs N]
 */

import * as fs from 'fs';
import { loadCardPool } from '@meccg/shared';
import { playGame } from '../runner.js';
import type { Agent, AgentContext, AgentDecision } from '../types.js';
import {
  FEATURE_SPEC_VERSION,
  ACTION_TYPES,
  buildCardVocab,
  featurizeState,
  featurizeActions,
  GLOBAL_FEATURE_WIDTH,
  ENTITY_FEATURE_WIDTH,
  ACTION_FEATURE_WIDTH,
} from '../features/index.js';
import { parseCliArgs, numberFlag, resolveAgent, resolvePair, resolveDecks, stringFlag } from './common.js';
import { sliceGames, runChildren } from './jobs.js';

const args = parseCliArgs(process.argv.slice(2));
const games = numberFlag(args, 'games', 10);
const baseSeed = numberFlag(args, 'seed', 1);
const maxDecisions = numberFlag(args, 'max-decisions', 25000);
const agentNames = resolvePair(args, 'agents', ['heuristic', 'heuristic']);
const outFile = stringFlag(args, 'out') ?? 'training.jsonl';
// SIM_JOBS lets a driver script (e.g. selfplay_loop.sh) parallelize every
// CLI call it makes without threading a flag through its own interface.
const jobs = numberFlag(args, 'jobs', Number(process.env.SIM_JOBS ?? 1) || 1);
const gameOffset = numberFlag(args, 'game-offset', 0);
const noHeader = args.flags['no-header'] === true;
const decks = resolveDecks(args);

/** Appends one file to an open stream, resolving when fully flushed. */
function appendFile(target: fs.WriteStream, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const source = fs.createReadStream(path);
    source.on('error', reject);
    source.on('end', resolve);
    source.pipe(target, { end: false });
  });
}

/** Parent mode: fan out to children, then merge shards in seed order. */
async function runParent(): Promise<void> {
  const startedAt = Date.now();
  const slices = sliceGames(games, jobs);
  console.log(`Export: ${games} games over ${slices.length} jobs, agents ${agentNames.join(' vs ')}, decks ${decks[0].id}/${decks[1].id}, seeds ${baseSeed}..${baseSeed + games - 1}`);
  const shardPaths = slices.map(slice => `${outFile}.shard${slice.index}`);
  const outputs = await runChildren(process.argv[1], slices.map((slice, i) => [
    '--agents', agentNames.join(','),
    '--decks', `${decks[0].id},${decks[1].id}`,
    '--games', String(slice.games),
    '--seed', String(baseSeed + slice.firstGame),
    '--game-offset', String(gameOffset + slice.firstGame),
    '--max-decisions', String(maxDecisions),
    '--out', shardPaths[i],
    '--no-header',
    '--jobs', '1', // explicit: children inherit SIM_JOBS and must not fan out again
  ]));
  // Surface the children's noteworthy lines (non-completed games).
  for (const output of outputs) {
    for (const line of output.split('\n')) {
      if (line.includes('outcome') || line.includes('—')) console.log(line);
    }
  }

  const cardPool = loadCardPool();
  const vocab = buildCardVocab(cardPool);
  const out = fs.createWriteStream(outFile, { encoding: 'utf-8' });
  out.write(JSON.stringify(headerRecord(vocab.size, vocab.hash)) + '\n');
  for (const shardPath of shardPaths) {
    await appendFile(out, shardPath);
    fs.unlinkSync(shardPath);
  }
  await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));

  const totalExamples = outputs.reduce((sum, output) => {
    const match = /Wrote (\d+) examples/.exec(output);
    return sum + (match ? Number(match[1]) : 0);
  }, 0);
  const wallSec = (Date.now() - startedAt) / 1000;
  console.log(`\nWrote ${totalExamples} examples from ${games} games to ${outFile} in ${wallSec.toFixed(1)}s (${slices.length} jobs)`);
}

/** The export header line (identical fields in serial and parallel runs). */
function headerRecord(vocabSize: number, vocabHash: string): Record<string, unknown> {
  return {
    k: 'h',
    formatVersion: 1,
    featureSpecVersion: FEATURE_SPEC_VERSION,
    vocabSize,
    vocabHash,
    actionTypeCount: ACTION_TYPES.length,
    // The names behind the type indices in candidate column 0, so the learning
    // side can address a type by name rather than by a spec-dependent index.
    actionTypes: ACTION_TYPES,
    globalWidth: GLOBAL_FEATURE_WIDTH,
    entityWidth: ENTITY_FEATURE_WIDTH,
    actionWidth: ACTION_FEATURE_WIDTH,
    agents: agentNames,
    decks: [decks[0].id, decks[1].id],
    games,
    baseSeed,
    maxDecisions,
    createdAt: new Date().toISOString(),
  };
}

function runSerial(): void {
  const cardPool = loadCardPool();
  const vocab = buildCardVocab(cardPool);

  console.log(`Export: ${games} games, agents ${agentNames.join(' vs ')}, decks ${decks[0].id}/${decks[1].id}, seeds ${baseSeed}..${baseSeed + games - 1}`);
  console.log(`  feature spec v${FEATURE_SPEC_VERSION}, vocab ${vocab.size} cards (${vocab.hash}), widths: global ${GLOBAL_FEATURE_WIDTH}, entity ${ENTITY_FEATURE_WIDTH}, action ${ACTION_FEATURE_WIDTH}`);

  const out = fs.createWriteStream(outFile, { encoding: 'utf-8' });
  if (!noHeader) {
    out.write(JSON.stringify(headerRecord(vocab.size, vocab.hash)) + '\n');
  }

  /**
   * Wraps a teacher agent: every decision is featurized from the exact
   * context the agent saw and written as a training example.
   */
  function recordingAgent(inner: Agent, game: number, playerIndex: number, seq: { n: number }): Agent {
    return {
      name: inner.name,
      chooseAction(context: AgentContext): AgentDecision {
        const decision = inner.chooseAction(context);
        const state = featurizeState(context.view, context.cardPool, vocab);
        const actions = featurizeActions(context.view, context.cardPool, vocab);
        const chosen = context.evaluated.findIndex(e => e.action === decision.action);
        const indexOfAction = new Map(context.evaluated.map((e, i) => [e.action, i]));
        const weights = (decision.considered ?? [])
          .map(c => [indexOfAction.get(c.action) ?? -1, c.weight] as const)
          .filter(([index]) => index >= 0)
          .map(([index, weight]) => [index, weight]);
        out.write(JSON.stringify({
          k: 'd',
          game,
          seq: seq.n++,
          player: playerIndex,
          phase: context.view.phaseState.phase,
          global: state.global,
          entities: state.entities,
          candidates: actions.candidates,
          mask: actions.mask,
          chosen,
          weights,
        }) + '\n');
        return decision;
      },
    };
  }

  let totalExamples = 0;
  const startedAt = Date.now();
  let lastReport = startedAt;

  for (let i = 0; i < games; i++) {
    const gameId = gameOffset + i;
    const seq = { n: 0 };
    const run = playGame({
      agents: [
        recordingAgent(resolveAgent(agentNames[0]), gameId, 0, seq),
        recordingAgent(resolveAgent(agentNames[1]), gameId, 1, seq),
      ],
      decks,
      seed: baseSeed + i,
      maxDecisions,
      cardPool,
    });
    totalExamples += seq.n;
    out.write(JSON.stringify({
      k: 'r',
      game: gameId,
      seed: baseSeed + i,
      outcome: run.result.outcome,
      winnerIndex: run.winnerIndex,
      winReason: run.result.winReason,
      error: run.result.error,
      finalScores: run.result.finalScores,
      decisions: run.result.decisions,
      turns: run.result.turns,
    }) + '\n');
    if (run.result.outcome !== 'completed') {
      console.log(`  game ${gameId} (seed ${baseSeed + i}): ${run.result.outcome}${run.result.error ? ` — ${run.result.error}` : ''}`);
    }
    const now = Date.now();
    if (now - lastReport > 5000) {
      lastReport = now;
      console.log(`  … ${i + 1}/${games} games, ${totalExamples} examples`);
    }
  }

  out.end();
  const wallSec = (Date.now() - startedAt) / 1000;
  console.log(`\nWrote ${totalExamples} examples from ${games} games to ${outFile} in ${wallSec.toFixed(1)}s`);
}

if (jobs > 1) {
  runParent().catch(err => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
} else {
  runSerial();
}
