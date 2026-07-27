/**
 * @module cli/scenarios
 *
 * Build and maintain the fixed sample set of positions that H2 modules are
 * explained and regression-tested against.
 *
 * Usage:
 *   npm run scenarios -w @meccg/sim -- list [--module combat]
 *   npm run scenarios -w @meccg/sim -- capture --game <id> --seq 412 --as combat/orc-ambush-3v1
 *   npm run scenarios -w @meccg/sim -- capture --seed 7 --decks a,b --at 'turn=14,phase=movement-hazard' --as x/y
 *   npm run scenarios -w @meccg/sim -- verify
 *
 * Capturing from a seed rather than a live game is what keeps the corpus cheap
 * to grow: a scenario can be minted from self-play without anyone having
 * played the position by hand.
 */

import { loadCardPool, setEngineConsoleLog } from '@meccg/shared';
import type { GameState, PlayerId } from '@meccg/shared';
import { projectPlayerView } from '@meccg/game-server';
import { playGame } from '../runner.js';
import { parseCliArgs, numberFlag, stringFlag, resolveAgent, resolvePair, resolveDecks } from './common.js';
import type { GameObserver } from '../types.js';
import type { Scenario, ScenarioSource } from '../ai/h2/scenario-store.js';
import { hashState, listScenarioIds, loadScenario, saveScenario, scenarioView, withStandardCardPool } from '../ai/h2/scenario-store.js';
import { findGameLogRecord } from '../ai/h2/game-log.js';
import { DEFAULT_TUNABLES } from '../ai/h2/core/tunables.js';
import { loadWinProbModel } from '../ai/h2/core/winprob.js';
import { computeStanding } from '../ai/h2/services/standing.js';
import { ALL_MODULES, evaluateDecision } from '../ai/h2/core/registry.js';

/** Flag reference, printed by `--help`. */
const USAGE = `scenarios — the fixed sample set of positions H2 modules are tested against

Usage:
  npm run scenarios -w @meccg/sim -- list [--module <name>]
  npm run scenarios -w @meccg/sim -- capture --as <id> (--game <id> --seq <n> | --at <cond>)
  npm run scenarios -w @meccg/sim -- verify

Capturing from a recorded game:
  --game <id|path>    a game log (~/.meccg/logs/games/<id>.jsonl)
  --seq <n>           engine state sequence number within it

Capturing from self-play (cheaper, and needs nobody to have played it):
  --seed <n>          seed of the self-play game (default 1)
  --decks <a,b>       deck IDs (default challenge-deck-a,challenge-deck-b)
  --agents <a,b>      agent specs (default heuristic,heuristic)
  --at <conditions>   comma-separated key=value pairs; the first decision
                      matching all of them is captured. Keys:
                        turn, phase, step, seq, stateSeq, player,
                        combat (true|false), combatPhase, creatureBody,
                        strikes, companySize (characters in the defending
                        company), action (an action type that must be offered)
                      e.g. --at 'combat=true,combatPhase=resolve-strike,strikes=2'

Describing what was captured:
  --as <id>           path-like scenario ID, e.g. combat/orc-ambush-3v1
  --module <name>     the module the position exercises
  --description <s>   what the position is and why it is interesting
  --expectation <s>   what a good player should do here

Other:
  --engine-log        include the engine's own legal-action trace
  --help              this message
`;

const args = parseCliArgs(process.argv.slice(2));
if (args.flags['help'] === true || args.flags['h'] === true) {
  console.log(USAGE);
  process.exit(0);
}
setEngineConsoleLog(args.flags['engine-log'] === true);
const command = args.positional[0] ?? 'list';

/**
 * Parse `--at 'turn=14,phase=movement-hazard'` into a predicate over snapshots.
 *
 * The `action` clause is sorted last because it has to project a view to
 * answer, and `every` short-circuits: a cheap `combat=true` in front of it
 * keeps a whole-game scan from computing legal actions at every decision.
 */
function parseAtCondition(spec: string): (state: GameState, decisionSeq: number, player: PlayerId) => boolean {
  const clauses = spec.split(',').map(c => c.trim()).filter(c => c.length > 0).map(clause => {
    const eq = clause.indexOf('=');
    if (eq === -1) throw new Error(`--at expects key=value pairs, got "${clause}"`);
    return [clause.slice(0, eq).trim(), clause.slice(eq + 1).trim()] as const;
  }).sort(([a], [b]) => Number(a === 'action') - Number(b === 'action'));
  return (state, decisionSeq, player) => clauses.every(([key, value]) => {
    switch (key) {
      case 'turn': return state.turnNumber === Number(value);
      case 'phase': return state.phaseState.phase === value;
      case 'step': return (state.phaseState as { setupStep?: { step: string } }).setupStep?.step === value;
      case 'seq': return decisionSeq === Number(value);
      case 'stateSeq': return state.stateSeq === Number(value);
      case 'player': return (player as string) === value;
      // Combat is a phase-independent sub-state, so it cannot be addressed by
      // phase alone — and it is where the first H2 module lives.
      case 'combat': return (state.combat !== null) === (value === 'true' || value === 'yes');
      case 'combatPhase': return state.combat?.phase === value;
      // Whether the attack has a body at all decides whether a parry defeats
      // the strike outright or has to survive the creature's own body check —
      // two different branches of the model, both worth a scenario.
      case 'creatureBody': return (state.combat?.creatureBody !== null && state.combat?.creatureBody !== undefined)
        === (value === 'true' || value === 'yes');
      case 'strikes': return state.combat?.strikesTotal === Number(value);
      // How many characters the defending company can put in front of the
      // attack. With more strikes than bodies the sequential model's
      // degradation bites, so this is how those positions get mined.
      case 'companySize': {
        const combat = state.combat;
        if (!combat) return false;
        const defender = state.players.find(p => p.id === combat.defendingPlayerId);
        const company = defender?.companies.find(c => c.id === combat.companyId);
        return company?.characters.length === Number(value);
      }
      // An action type that must be on offer — the way to mine positions where
      // a specific option (a strike event, the stay-untapped choice) exists.
      case 'action': return projectPlayerView(state, player).legalActions
        .some(e => e.viable && e.action.type === value);
      default: throw new Error(`--at: unknown key "${key}" `
        + '(turn, phase, step, seq, stateSeq, player, combat, combatPhase, creatureBody, '
        + 'strikes, companySize, action)');
    }
  });
}

/** `list` — every checked-in scenario with its description. */
function commandList(): void {
  const moduleFilter = stringFlag(args, 'module');
  const ids = listScenarioIds();
  if (ids.length === 0) {
    console.log('No scenarios captured yet. Add one with `scenarios capture`.');
    return;
  }
  for (const id of ids) {
    const scenario = loadScenario(id);
    if (moduleFilter && scenario.module !== moduleFilter) continue;
    const source = scenario.source.kind === 'game'
      ? `${scenario.source.gameId}#${scenario.source.stateSeq}`
      : `seed ${scenario.source.seed} @${scenario.source.decisionSeq}`;
    console.log(`${id.padEnd(36)} ${(scenario.module ?? '-').padEnd(10)} ${source}`);
    console.log(`  ${scenario.description}`);
    if (scenario.expectation) console.log(`  expect: ${scenario.expectation}`);
  }
}

/** Build and persist a scenario, reporting where it landed. */
function persist(
  id: string,
  state: GameState,
  actingPlayer: PlayerId,
  source: ScenarioSource,
): void {
  const scenario: Scenario = {
    id,
    description: stringFlag(args, 'description') ?? `captured from ${source.kind}`,
    module: stringFlag(args, 'module'),
    actingPlayer,
    expectation: stringFlag(args, 'expectation'),
    source,
    hash: hashState(state),
    state,
  };
  const file = saveScenario(scenario);
  console.log(`Captured ${id} (hash ${scenario.hash}, acting ${actingPlayer as string}) → ${file}`);
}

/** `capture` — from a recorded game log, or by replaying a self-play seed. */
function commandCapture(): void {
  const id = stringFlag(args, 'as');
  if (!id) throw new Error('capture requires --as <scenario-id>');
  const gameRef = stringFlag(args, 'game');

  if (gameRef) {
    const seq = numberFlag(args, 'seq', NaN);
    if (!Number.isFinite(seq)) throw new Error('capture --game requires --seq <stateSeq>');
    const record = findGameLogRecord(gameRef, seq);
    const state = withStandardCardPool(record.state);
    const actingPlayer = (stringFlag(args, 'player') as PlayerId | undefined)
      ?? record.activePlayer
      ?? state.players[0].id;
    persist(id, state, actingPlayer, { kind: 'game', gameId: gameRef, stateSeq: seq });
    return;
  }

  const atSpec = stringFlag(args, 'at');
  if (!atSpec) throw new Error('capture requires either --game/--seq or --seed with --at');
  const matches = parseAtCondition(atSpec);
  const seed = numberFlag(args, 'seed', 1);
  const decks = resolveDecks(args);
  const agentNames = resolvePair(args, 'agents', ['heuristic', 'heuristic']);

  let captured: { state: GameState; player: PlayerId; decisionSeq: number } | null = null;
  const observer: GameObserver = {
    onStateSnapshot(state, decisionSeq, actingPlayer) {
      if (captured) return;
      if (matches(state, decisionSeq, actingPlayer)) captured = { state, player: actingPlayer, decisionSeq };
    },
  };
  playGame({
    agents: [resolveAgent(agentNames[0]), resolveAgent(agentNames[1])],
    decks,
    seed,
    observers: [observer],
  });

  if (!captured) throw new Error(`No decision in seed ${seed} matched --at '${atSpec}'`);
  const { state, player, decisionSeq } = captured;
  persist(id, state, player, {
    kind: 'selfplay',
    seed,
    decks: [decks[0].id, decks[1].id],
    agents: [agentNames[0], agentNames[1]],
    decisionSeq,
  });
}

/** `verify` — every scenario still loads, projects, and evaluates. */
function commandVerify(): void {
  const cardPool = loadCardPool();
  const model = loadWinProbModel();
  const ids = listScenarioIds();
  let failures = 0;
  for (const id of ids) {
    try {
      const scenario = loadScenario(id);
      const view = scenarioView(scenario);
      const legalActions = view.legalActions.filter(e => e.viable).map(e => e.action);
      const standing = computeStanding(view, model, DEFAULT_TUNABLES);
      const { modules: contributors } = evaluateDecision(ALL_MODULES, {
        view, cardPool, legalActions, tunables: DEFAULT_TUNABLES, standing,
      });
      const owner = contributors.length > 0 ? contributors.join('+') : 'h1 fallback';
      console.log(`ok   ${id.padEnd(36)} ${legalActions.length} actions, TSD ${standing.tsd >= 0 ? '+' : ''}${standing.tsd}, ${owner}`);
    } catch (err) {
      failures++;
      console.log(`FAIL ${id.padEnd(36)} ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`\n${ids.length - failures}/${ids.length} scenarios verified`);
  if (failures > 0) process.exit(1);
}

switch (command) {
  case 'list': commandList(); break;
  case 'capture': commandCapture(); break;
  case 'verify': commandVerify(); break;
  default:
    console.error(`Unknown command "${command}" — expected list, capture, or verify`);
    process.exit(2);
}
