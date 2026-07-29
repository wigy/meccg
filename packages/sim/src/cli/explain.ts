/**
 * @module cli/explain
 *
 * The primary Heuristics-2 development tool: print why the AI would do what it
 * does at one decision, in win-probability units, with the derivation shown.
 *
 * Run with `--help` for the flag list.
 */

import { formatGameState, formatPlayerView, loadCardPool, setEngineConsoleLog, stripCardMarkers } from '@meccg/shared';
import { forwardActions } from '../ai/regress.js';
import type { GameState, PlayerId, PlayerView } from '@meccg/shared';
import { projectPlayerView } from '@meccg/game-server';
import { parseCliArgs, numberFlag, stringFlag } from './common.js';
import { DEFAULT_TUNABLES } from '../ai/h2/core/tunables.js';
import { loadWinProbModel } from '../ai/h2/core/winprob.js';
import { evaluateDecision, resolveModules } from '../ai/h2/core/registry.js';
import { computeStanding } from '../ai/h2/services/standing.js';
import { computeBudget } from '../ai/h2/services/budget.js';
import { computeExposure } from '../ai/h2/services/exposure.js';
import { computeCardPrices } from '../ai/h2/services/card-price.js';
import { computeHazardPlan } from '../ai/h2/services/hazard-plan.js';
import { renderExplanation } from '../ai/h2/explain.js';
import { hashState, loadScenario, withStandardCardPool } from '../ai/h2/scenario-store.js';
import { findGameLogRecord } from '../ai/h2/game-log.js';
import { heuristicStrategy } from '../ai/heuristic.js';

/** Flag reference, printed by `--help`. */
const USAGE = `explain — why the Heuristics-2 AI would take one action over another

Usage:
  npm run explain -w @meccg/sim -- --scenario <id> [options]
  npm run explain -w @meccg/sim -- --game <gameId|path> --seq <n> [options]

Choosing the position (exactly one is required):
  --scenario <id>     a checked-in scenario; list them with
                      \`npm run scenarios -w @meccg/sim -- list\`
  --game <id|path>    a recorded game log (~/.meccg/logs/games/<id>.jsonl)
  --seq <n>           engine state sequence number within that game
  --hash <hash>       assert the position's content hash, so a stale
                      reference fails loudly instead of quietly explaining a
                      different position

Choosing what to explain:
  --player <p1|p2>    whose decision to explain (default: whoever can act)
  --module <name>     restrict to one module's opinions (default: all)
  --risk <lambda>     override the fitted risk posture, -1 (risk-averse) to
                      +1 (risk-seeking). Recentres the win-probability curve
                      on the standing with that curvature, and says so.
  --top <n>           how many candidates to expand in full (default 5)

Output:
  --state             also print the board as the acting player sees it
  --state full        print the omniscient game state instead (debug: shows
                      both hands, so never use it to judge the AI's choices)
  --json              machine-readable Evaluation[] for tests and tooling
  --engine-log        include the engine's own legal-action trace
  --help              this message
`;

const args = parseCliArgs(process.argv.slice(2));
if (args.flags['help'] === true || args.flags['h'] === true) {
  console.log(USAGE);
  process.exit(0);
}
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

// Regressive candidates are dropped, because every agent drops them: the
// engine marks the actions that undo this phase's own progress and explaining a
// ranking that includes them would explain a decision nobody makes.
const legalActions = forwardActions(view.legalActions.filter(e => e.viable).map(e => e.action));

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
const { modules: contributors, evaluations, uncovered } = evaluateDecision(modules, {
  view,
  cardPool,
  legalActions,
  tunables,
  standing,
});

const fallback = contributors.length === 0
  ? heuristicStrategy.weighActions({ view, cardPool, legalActions })
  : undefined;

// ---- Report ----

// The board, rendered by the same `format-state` helpers the server logs and
// the debug UI use. Two modes on purpose: the player view is what the agent
// actually saw, so a decision can be judged against the same information it
// had; the omniscient state is a debugging aid that shows both hands and must
// never be mistaken for the agent's input.
const stateFlag = args.flags['state'];
if (stateFlag !== undefined && !asJson) {
  if (stateFlag === 'full') {
    console.log('GAME STATE (omniscient — not what the agent sees)');
    console.log(formatGameState(state));
  } else {
    console.log(`BOARD as ${view.self.name} (${view.self.id}) sees it`);
    // `formatPlayerView` keeps the STX card-ID markers the browser client uses
    // for colouring; on a terminal they render as an ID glued to the name.
    // `formatGameState` already strips them, so do the same here.
    console.log(stripCardMarkers(formatPlayerView(view, cardPool)));
  }
  console.log('');
}

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
    modules: contributors,
    evaluations,
    fallback: fallback?.map(c => ({ type: c.action.type, weight: c.weight })),
  }, null, 2));
} else {
  console.log(renderExplanation({
    title,
    view,
    cardPool,
    standing,
    modules: contributors,
    uncovered,
    evaluations,
    fallback,
    topN,
    budget: computeBudget(view, cardPool),
    exposure: computeExposure(view, cardPool),
    prices: computeCardPrices(view, cardPool, standing, tunables),
    hazardPlan: computeHazardPlan(view, cardPool, standing, tunables),
  }).join('\n'));
}
