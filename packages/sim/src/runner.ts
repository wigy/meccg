/**
 * @module runner
 *
 * The headless in-process game runner. Wraps the pure engine —
 * `createGame` → loop `projectPlayerView` → agent → `reduce` — until the
 * game-over phase, with no WebSocket or child processes involved. Each
 * agent only ever sees its own projected {@link PlayerView}, preserving the
 * hidden-information boundary. Every decision is captured as a
 * {@link DecisionRecord} (candidates, weights, chosen action, effects) and
 * streamed to observers for replay writing, statistics, and live
 * transcripts. Given the same seed, decks, and agents, a game is
 * bit-reproducible.
 */

import {
  createGame,
  reduce,
  computeTournamentScore,
  describeAction,
  buildInstanceLookup,
  buildCompanyNames,
  stripCardMarkers,
  loadCardPool,
  setEngineConsoleLog,
  Phase,
} from '@meccg/shared';
import type {
  CardDefinition,
  GameAction,
  GameState,
  PlayerId,
  PlayerView,
  EvaluatedAction,
  GameConfig,
} from '@meccg/shared';
import { projectPlayerView } from '@meccg/game-server';
import type {
  Agent,
  CandidateRecord,
  DecisionRecord,
  GameObserver,
  GameResultRecord,
  ReplayHeader,
  ReplayPlayerInfo,
  TransitionRecord,
  GameOutcome,
} from './types.js';
import type { LoadedDeck } from './decks.js';
import { deckToPlayerConfig } from './decks.js';
import { StatsCollector } from './stats.js';
import { createRandomStream, agentStreamSeed } from './random-stream.js';

/** Options for {@link playGame}. */
export interface PlayGameOptions {
  /** Agents by player index. */
  readonly agents: readonly [Agent, Agent];
  /** Decks by player index. */
  readonly decks: readonly [LoadedDeck, LoadedDeck];
  /** RNG seed — determines shuffles, dice, and agent sampling streams. */
  readonly seed: number;
  /** Player display names; default `<agent>-1` / `<agent>-2`. */
  readonly names?: readonly [string, string];
  /** Abort the game after this many decisions (default 25000). */
  readonly maxDecisions?: number;
  /** Observers receiving the record stream as the game progresses. */
  readonly observers?: readonly GameObserver[];
  /** How many top-weighted candidates get description text (default 8). */
  readonly describeTopN?: number;
  /** Card pool override; loaded once per process by default. */
  readonly cardPool?: Readonly<Record<string, CardDefinition>>;
  /**
   * Emit engine trace logging to the console (default false — per-action
   * logging costs far more than the engine work itself).
   */
  readonly engineLog?: boolean;
}

/** Outcome of one simulated game. */
export interface GameRunResult {
  /** The final result record (also sent to observers). */
  readonly result: GameResultRecord;
  /** Winner's player index, or null (draw / non-completed). */
  readonly winnerIndex: number | null;
  /** The final game state, for callers that want to inspect it. */
  readonly finalState: GameState;
}

/** Lazily-loaded shared card pool. */
let defaultCardPool: Readonly<Record<string, CardDefinition>> | null = null;

function getDefaultCardPool(): Readonly<Record<string, CardDefinition>> {
  defaultCardPool ??= loadCardPool();
  return defaultCardPool;
}

/** The setup step label, when the phase carries one. */
function stepOf(state: { readonly phaseState: { readonly phase: string; readonly setupStep?: { readonly step: string } } }): string | undefined {
  const ps = state.phaseState as { phase: string; setupStep?: { step: string } };
  return ps.setupStep?.step;
}

/**
 * Per-decision action describer. Builds the instance/company lookups once
 * per view — rebuilding them per candidate would dominate the runtime.
 */
function makeDescriber(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  playerNames: Readonly<Record<string, string>>,
): (action: GameAction) => string {
  const lookup = buildInstanceLookup(view);
  const companies = buildCompanyNames(view.self.companies, view.self.characters, cardPool);
  return action => stripCardMarkers(describeAction(action, cardPool, lookup, companies, playerNames));
}

/**
 * Play one full game between two agents and return the result. Observer
 * hooks fire in order: header, then decisions/transitions, then result.
 */
export function playGame(options: PlayGameOptions): GameRunResult {
  const cardPool = options.cardPool ?? getDefaultCardPool();
  const maxDecisions = options.maxDecisions ?? 25000;
  const describeTopN = options.describeTopN ?? 8;
  const observers = options.observers ?? [];
  setEngineConsoleLog(options.engineLog ?? false);

  const playerIds: [PlayerId, PlayerId] = ['p1' as PlayerId, 'p2' as PlayerId];
  const names: [string, string] = [
    options.names?.[0] ?? `${options.agents[0].name}-1`,
    options.names?.[1] ?? `${options.agents[1].name}-2`,
  ];
  const playerNames: Record<string, string> = {
    [playerIds[0] as string]: names[0],
    [playerIds[1] as string]: names[1],
  };

  const config: GameConfig = {
    players: [
      deckToPlayerConfig(options.decks[0], playerIds[0], names[0]),
      deckToPlayerConfig(options.decks[1], playerIds[1], names[1]),
    ],
    seed: options.seed,
  };

  const header: ReplayHeader = {
    kind: 'header',
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    seed: options.seed,
    players: [0, 1].map(i => ({
      id: playerIds[i],
      name: names[i],
      agent: options.agents[i].name,
      deckId: options.decks[i].id,
      deckName: options.decks[i].name,
      alignment: options.decks[i].alignmentLabel,
    })) as unknown as [ReplayPlayerInfo, ReplayPlayerInfo],
    maxDecisions,
  };
  for (const o of observers) o.onHeader?.(header);

  const stats = new StatsCollector(options.seed);
  const randomStreams = [
    createRandomStream(agentStreamSeed(options.seed, 0)),
    createRandomStream(agentStreamSeed(options.seed, 1)),
  ];

  let state = createGame(config, cardPool);
  const startedAt = Date.now();
  let decisions = 0;
  let maxTurn = state.turnNumber;
  let outcome: GameOutcome = 'completed';
  let errorDetail: string | undefined;

  const emitTransition = (seq: number): void => {
    const record: TransitionRecord = {
      kind: 'transition',
      seq,
      turn: state.turnNumber,
      phase: state.phaseState.phase,
      step: stepOf(state),
      activePlayer: state.activePlayer,
      scores: [
        computeTournamentScore(state.players[0].marshallingPoints, state.players[1].marshallingPoints),
        computeTournamentScore(state.players[1].marshallingPoints, state.players[0].marshallingPoints),
      ],
      marshallingPoints: [state.players[0].marshallingPoints, state.players[1].marshallingPoints],
    };
    stats.onTransition(record);
    for (const o of observers) o.onTransition?.(record);
  };
  emitTransition(0);

  while (state.phaseState.phase !== Phase.GameOver) {
    if (decisions >= maxDecisions) {
      outcome = 'decision-limit';
      errorDetail = `decision limit of ${maxDecisions} reached`;
      break;
    }

    try {
      // Determine the acting player: the active player gets priority, then
      // the opponent. Whoever has at least one viable action acts; the engine
      // is built so that (outside simultaneous setup steps) at most one
      // player has viable actions at a time.
      const order: number[] = state.activePlayer === playerIds[1] ? [1, 0] : [0, 1];
      let actingIndex = -1;
      let view: PlayerView | null = null;
      let viable: EvaluatedAction[] = [];
      for (const i of order) {
        const candidate = projectPlayerView(state, playerIds[i]);
        const candidateViable = candidate.legalActions.filter(e => e.viable);
        if (candidateViable.length > 0) {
          actingIndex = i;
          view = candidate;
          viable = candidateViable;
          break;
        }
      }
      if (actingIndex === -1 || view === null) {
        outcome = 'deadlock';
        errorDetail = `no player has a viable action (phase ${state.phaseState.phase}, stateSeq ${state.stateSeq})`;
        break;
      }

      const agent = options.agents[actingIndex];
      const legalActions = viable.map(e => e.action);
      const actionIds = new Map<GameAction, string | undefined>(viable.map(e => [e.action, e.actionId]));

      const thinkStart = Date.now();
      const decision = agent.chooseAction({
        view,
        cardPool,
        legalActions,
        evaluated: view.legalActions,
        random: randomStreams[actingIndex],
      });
      const thinkMs = Date.now() - thinkStart;

      if (!legalActions.includes(decision.action)) {
        outcome = 'engine-error';
        errorDetail = `agent ${agent.name} returned an action not among the viable candidates (type ${decision.action.type})`;
        break;
      }

      const reduced = reduce(state, decision.action);
      if (reduced.error) {
        outcome = 'engine-error';
        errorDetail = `engine rejected '${decision.action.type}' (seq ${decisions}, stateSeq ${state.stateSeq}): ${reduced.error}`;
        break;
      }

      // Build the decision record: full weighted candidate list, with
      // descriptions for the top-weighted candidates and the chosen action.
      const describe = makeDescriber(view, cardPool, playerNames);
      const considered = decision.considered ?? legalActions.map(action => ({ action, weight: 1 }));
      const ranked = [...considered].sort((a, b) => b.weight - a.weight);
      const describedSet = new Set(ranked.slice(0, describeTopN).map(c => c.action));
      describedSet.add(decision.action);
      const candidates: CandidateRecord[] = ranked.map(c => ({
        type: c.action.type,
        actionId: actionIds.get(c.action),
        weight: c.weight,
        ...(describedSet.has(c.action) ? { description: describe(c.action) } : {}),
      }));

      const record: DecisionRecord = {
        kind: 'decision',
        seq: decisions,
        stateSeq: state.stateSeq,
        turn: state.turnNumber,
        phase: state.phaseState.phase,
        step: stepOf(state),
        player: playerIds[actingIndex],
        playerName: names[actingIndex],
        agent: agent.name,
        viableCount: legalActions.length,
        candidateCount: view.legalActions.length,
        candidates,
        action: decision.action,
        actionId: actionIds.get(decision.action),
        description: describe(decision.action),
        note: decision.note,
        effects: reduced.effects,
        thinkMs,
      };
      stats.onDecision(record, actingIndex);
      for (const o of observers) o.onDecision?.(record);

      const prevPhase = state.phaseState.phase;
      const prevStep = stepOf(state);
      const prevTurn = state.turnNumber;
      state = reduced.state;
      decisions++;
      maxTurn = Math.max(maxTurn, state.turnNumber);
      if (state.phaseState.phase !== prevPhase || state.turnNumber !== prevTurn || stepOf(state) !== prevStep) {
        emitTransition(decisions);
      }
    } catch (err) {
      // A thrown engine exception is a bug worth recording, not a reason to
      // lose the whole batch — capture it and end this game.
      outcome = 'engine-error';
      errorDetail = `unhandled engine exception at decision ${decisions}, stateSeq ${state.stateSeq}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`;
      break;
    }
  }

  const durationMs = Date.now() - startedAt;
  let winner: PlayerId | null = null;
  let winReason: string | undefined;
  let finalScores: Record<string, number> | undefined;
  if (state.phaseState.phase === Phase.GameOver) {
    winner = state.phaseState.winner;
    winReason = state.phaseState.winReason.kind;
    finalScores = state.phaseState.finalScores as unknown as Record<string, number>;
  }

  const result: GameResultRecord = {
    kind: 'result',
    outcome,
    winner,
    winReason,
    finalScores,
    decisions,
    turns: maxTurn,
    durationMs,
    error: errorDetail,
    stats: stats.summary(maxTurn, durationMs),
  };
  for (const o of observers) o.onResult?.(result);

  const winnerIndex = winner === null ? null : winner === playerIds[0] ? 0 : 1;
  return { result, winnerIndex, finalState: state };
}
