/**
 * @module cli/explain
 *
 * The primary Heuristics-2 development tool: print why the AI would do what it
 * does at one decision, in win-probability units, with the derivation shown.
 *
 * Usage:
 *   npm run explain -w @meccg/sim -- --scenario combat/orc-ambush-3v1
 *   npm run explain -w @meccg/sim -- --game <gameId> --seq 412 [--player p1]
 *   npm run explain -w @meccg/sim -- --scenario travel/moria-detour --risk +0.6
 *
 * Flags:
 *   --scenario <id>    a checked-in scenario from the fixed sample set
 *   --game <id|path>   a recorded game log (`~/.meccg/logs/games/<id>.jsonl`)
 *   --seq <n>          engine state sequence number within that game
 *   --hash <h>         assert the position's content hash, so a stale
 *                      reference fails loudly instead of explaining a
 *                      different position
 *   --player <p1|p2>   whose decision to explain (default: whoever can act)
 *   --module <name>    restrict to one module's opinions
 *   --risk <λ>         override the fitted risk posture
 *   --top <n>          how many candidates to expand fully (default 5)
 *   --json             machine-readable output for tests and tooling
 */

import { loadCardPool, setEngineConsoleLog } from '@meccg/shared';
import type { GameState, PlayerId, PlayerView } from '@meccg/shared';
import { projectPlayerView } from '@meccg/game-server';
import { parseCliArgs, numberFlag, stringFlag } from './common.js';
import { DEFAULT_TUNABLES } from '../ai/h2/core/tunables.js';
import { loadWinProbModel } from '../ai/h2/core/winprob.js';
import { evaluateDecision, resolveModules } from '../ai/h2/core/registry.js';
import { computeStanding } from '../ai/h2/services/standing.js';
import { renderExplanation } from '../ai/h2/explain.js';
import { hashState, loadScenario, withStandardCardPool } from '../ai/h2/scenario-store.js';
import { findGameLogRecord } from '../ai/h2/game-log.js';
import { heuristicStrategy } from '../ai/heuristic.js';

const args = parseCliArgs(process.argv.slice(2));
// Projecting a view recomputes legal actions, and the engine narrates that at
// length. The explanation is the output here, so the trace is off unless asked
// for — a reader who wanted the engine's reasoning would pass --engine-log.
setEngineConsoleLog(args.flags['engine-log'] === true);
const scenarioId = stringFlag(args, 'scenario');
const gameRef = stringFlag(args, 'game');
const asJson = args.flags['json'] === true;
const topN = numberFlag(args, 'top', 5);

if (!scenarioId && !gameRef) {
  console.error('explain: pass either --scenario <id> or --game <id> --seq <n>');
  process.exit(2);
}

// ---- Resolve the position ----

let state: GameState;
let title: string;
let preferredPlayer: PlayerId | null;

if (scenarioId) {
  const scenario = loadScenario(scenarioId);
  state = scenario.state;
  preferredPlayer = scenario.actingPlayer;
  title = `scenario ${scenario.id} — ${scenario.description}`;
} else {
  const seq = numberFlag(args, 'seq', NaN);
  if (!Number.isFinite(seq)) throw new Error('--game requires --seq <stateSeq>');
  const record = findGameLogRecord(gameRef!, seq);
  state = withStandardCardPool(record.state);
  preferredPlayer = record.activePlayer;
  title = `game ${gameRef}#${seq}`;
}

const expectedHash = stringFlag(args, 'hash');
if (expectedHash !== undefined) {
  const actual = hashState(state);
  if (actual !== expectedHash) {
    console.error(`explain: content hash mismatch — expected ${expectedHash}, got ${actual}`);
    process.exit(1);
  }
}

// ---- Pick the acting player ----

const cardPool = loadCardPool();
const requested = stringFlag(args, 'player') as PlayerId | undefined;

/** The projected view for a player, when they have at least one viable action. */
function viewIfActable(playerId: PlayerId): PlayerView | null {
  const view = projectPlayerView(state, playerId);
  return view.legalActions.some(e => e.viable) ? view : null;
}

const candidates: PlayerId[] = requested
  ? [requested]
  : ([preferredPlayer, ...state.players.map(p => p.id)].filter(Boolean) as PlayerId[]);

let view: PlayerView | null = null;
for (const id of candidates) {
  view = viewIfActable(id);
  if (view) break;
}
if (!view) {
  // An explicitly requested player with nothing to do is still worth
  // explaining — the standing is meaningful even with no decision to make.
  view = projectPlayerView(state, requested ?? (preferredPlayer ?? state.players[0].id));
}

const legalActions = view.legalActions.filter(e => e.viable).map(e => e.action);

// ---- Evaluate ----

const tunables = DEFAULT_TUNABLES;
const model = loadWinProbModel();
const riskFlag = stringFlag(args, 'risk');
const riskOverride = riskFlag === undefined ? undefined : Number(riskFlag);
if (riskOverride !== undefined && !Number.isFinite(riskOverride)) {
  throw new Error(`--risk expects a number in [-1, 1], got "${riskFlag}"`);
}

const standing = computeStanding(view, model, tunables, riskOverride);
const modules = resolveModules(stringFlag(args, 'module'));
const { module, evaluations } = evaluateDecision(modules, {
  view,
  cardPool,
  legalActions,
  tunables,
  standing,
});

const fallback = module === null
  ? heuristicStrategy.weighActions({ view, cardPool, legalActions })
  : undefined;

// ---- Report ----

if (asJson) {
  console.log(JSON.stringify({
    title,
    hash: hashState(state),
    player: view.self.id,
    turn: view.turnNumber,
    phase: view.phaseState.phase,
    standing: {
      tsd: standing.tsd,
      selfScore: standing.selfScore,
      opponentScore: standing.opponentScore,
      marginal: standing.marginal,
      winProbability: standing.risk.standing.winProbability,
      lambda: standing.risk.lambda,
      riskSource: standing.risk.source,
    },
    module: module?.name ?? null,
    evaluations,
    fallback: fallback?.map(c => ({ type: c.action.type, weight: c.weight })),
  }, null, 2));
} else {
  console.log(renderExplanation({
    title,
    view,
    cardPool,
    standing,
    module: module?.name ?? null,
    evaluations,
    fallback,
    topN,
  }).join('\n'));
}
