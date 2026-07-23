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
 * Usage:
 *   npm run export-training -w @meccg/sim -- [--games N] [--seed S]
 *     [--agents a,b] [--decks d1,d2] [--out training.jsonl]
 *     [--max-decisions N]
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

const args = parseCliArgs(process.argv.slice(2));
const games = numberFlag(args, 'games', 10);
const baseSeed = numberFlag(args, 'seed', 1);
const maxDecisions = numberFlag(args, 'max-decisions', 25000);
const agentNames = resolvePair(args, 'agents', ['heuristic', 'heuristic']);
const outFile = stringFlag(args, 'out') ?? 'training.jsonl';
const decks = resolveDecks(args);

const cardPool = loadCardPool();
const vocab = buildCardVocab(cardPool);

console.log(`Export: ${games} games, agents ${agentNames.join(' vs ')}, decks ${decks[0].id}/${decks[1].id}, seeds ${baseSeed}..${baseSeed + games - 1}`);
console.log(`  feature spec v${FEATURE_SPEC_VERSION}, vocab ${vocab.size} cards (${vocab.hash}), widths: global ${GLOBAL_FEATURE_WIDTH}, entity ${ENTITY_FEATURE_WIDTH}, action ${ACTION_FEATURE_WIDTH}`);

const out = fs.createWriteStream(outFile, { encoding: 'utf-8' });
out.write(JSON.stringify({
  k: 'h',
  formatVersion: 1,
  featureSpecVersion: FEATURE_SPEC_VERSION,
  vocabSize: vocab.size,
  vocabHash: vocab.hash,
  actionTypeCount: ACTION_TYPES.length,
  globalWidth: GLOBAL_FEATURE_WIDTH,
  entityWidth: ENTITY_FEATURE_WIDTH,
  actionWidth: ACTION_FEATURE_WIDTH,
  agents: agentNames,
  decks: [decks[0].id, decks[1].id],
  games,
  baseSeed,
  maxDecisions,
  createdAt: new Date().toISOString(),
}) + '\n');

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
  const seq = { n: 0 };
  const run = playGame({
    agents: [
      recordingAgent(resolveAgent(agentNames[0]), i, 0, seq),
      recordingAgent(resolveAgent(agentNames[1]), i, 1, seq),
    ],
    decks,
    seed: baseSeed + i,
    maxDecisions,
    cardPool,
  });
  totalExamples += seq.n;
  out.write(JSON.stringify({
    k: 'r',
    game: i,
    seed: baseSeed + i,
    outcome: run.result.outcome,
    winnerIndex: run.winnerIndex,
    winReason: run.result.winReason,
    finalScores: run.result.finalScores,
    decisions: run.result.decisions,
    turns: run.result.turns,
  }) + '\n');
  if (run.result.outcome !== 'completed') {
    console.log(`  game ${i} (seed ${baseSeed + i}): ${run.result.outcome}${run.result.error ? ` — ${run.result.error}` : ''}`);
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
