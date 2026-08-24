/**
 * @module index
 *
 * Public surface of `@meccg/sim` — the headless simulation harness for
 * AI training and evaluation: the agent seam, baseline agents, the
 * in-process game runner, deck catalog loading, replay persistence and
 * verification, statistics collection, and text transcripts. Also hosts
 * the AI strategy module (heuristic evaluators) shared with the text
 * clients.
 */

export type {
  Agent,
  AgentContext,
  AgentDecision,
  ConsideredAction,
  GameObserver,
  ReplayHeader,
  ReplayPlayerInfo,
  ReplayRecord,
  DecisionRecord,
  TransitionRecord,
  CandidateRecord,
  GameResultRecord,
  GameOutcome,
  GameStatsSummary,
  DistributionSummary,
} from './types.js';

export { playGame } from './runner.js';
export type { PlayGameOptions, GameRunResult } from './runner.js';

export { createRandomAgent } from './agents/random-agent.js';
export { createHeuristicAgent } from './agents/heuristic-agent.js';
export { createNoisyHeuristicAgent } from './agents/noisy-heuristic-agent.js';
export { createBcAgent, loadBcWeights, bcForward, runBcSelfTest } from './agents/bc-agent.js';
export { createAgentFromWeights } from './agents/from-weights.js';
export { createRouteAgent } from './agents/route-agent.js';
export type { BcWeightsFile, BcOutput, TensorJson } from './agents/bc-agent.js';

export { INITIAL_RATING, updateRating, ratingInterval } from './glicko2.js';
export type { Glicko2Rating, RatedGame } from './glicko2.js';

export { runTournament, runMatch, estimateEloDiff, estimatePairedEloDiff, MIN_PAIRS_FOR_INTERVAL, scoreToEloDiff } from './tournament.js';
export type {
  TournamentOptions,
  TournamentResult,
  TournamentStanding,
  TournamentParticipant,
  TournamentGameRecord,
  TournamentPlayFn,
  PairingSummary,
  MatchOptions,
  MatchResult,
  EloEstimate,
} from './tournament.js';

export { loadDeck, listDecks, listApprovedDecks, expandEntries, deckToPlayerConfig, DECK_CATALOG_DIR, DECK_ALIGNMENT_MAP } from './decks.js';
export type { DeckEntry, DeckFile, LoadedDeck } from './decks.js';

export { ReplayWriter, readReplay, verifyReplay } from './replay.js';
export type { Replay, ReplayVerification } from './replay.js';

export { StatsCollector, aggregateStats, summarizeDistribution } from './stats.js';
export type { AggregateStats } from './stats.js';

export { renderHeader, renderTransition, renderDecision, renderResult, TranscriptPrinter } from './transcript.js';
export type { TranscriptOptions } from './transcript.js';

export { createRandomStream, agentStreamSeed } from './random-stream.js';

export {
  FEATURE_SPEC_VERSION,
  buildCardVocab,
  ACTION_TYPES,
  actionTypeIndex,
  featurizeState,
  featurizeActions,
  GLOBAL_FEATURE_NAMES,
  GLOBAL_FEATURE_WIDTH,
  ENTITY_FEATURE_NAMES,
  ENTITY_FEATURE_WIDTH,
  ENTITY_ZONES,
  ACTION_FEATURE_NAMES,
  ACTION_FEATURE_WIDTH,
} from './features/index.js';
export type { CardVocab, StateFeatures, ActionFeatures } from './features/index.js';

// AI strategy module (lifted from the text client; shared by all clients).
export { loadAiStrategy, sampleWeighted, pickBest } from './ai/index.js';
export type { AiStrategy, AiContext, WeightedAction } from './ai/index.js';
export { heuristicStrategy } from './ai/heuristic.js';

// The agent registry, so hosts outside the sim CLIs (the lobby's headless
// AI client) can spawn any agent from the same `name:params` spec string.
export { resolveAgent, AGENT_NAMES } from './cli/common.js';

export { createMcAgent } from './agents/mc-agent.js';
export type { McAgentOptions } from './agents/mc-agent.js';

export { determinize, isDeterminizableView } from './search/determinize.js';
export type { DeterminizeOptions } from './search/determinize.js';

export { determinizeNull, UNKNOWN_CARD_DEFINITION } from './search/determinize-null.js';
export type { DetermizeNullOptions, NullWorld } from './search/determinize-null.js';

export { rollout, stateTsd, filterUnknownCardActions, WIN_TSD } from './search/rollout.js';
export type { RolloutOptions, RolloutResult, RolloutEnd } from './search/rollout.js';

export { searchBestAction } from './search/puct.js';
export type { SearchOptions, SearchResult } from './search/puct.js';
export { createSearchAgent } from './agents/search-agent.js';
export type { SearchAgentOptions } from './agents/search-agent.js';

export { viewSignature } from './state-signature.js';

// Heuristics 2 — modular, probabilistic, explainable AI
// (`specs/2026-07-27-heuristics-2-ai.md`). Modules score actions in one
// common currency (change in win probability) and return the derivation
// alongside the number.
export { createHeuristic2Agent } from './ai/h2/agent.js';
export type { Heuristic2Options } from './ai/h2/agent.js';
export type { Evaluation, H2Module, ModuleContext, Outcome, Rationale } from './ai/h2/core/types.js';
export { DEFAULT_TUNABLES, withTunable } from './ai/h2/core/tunables.js';
export type { Tunables } from './ai/h2/core/tunables.js';
export { MP_SOURCES, marginalMpValue, netTsdDelta, tsd, tsdAfter } from './ai/h2/core/tsd.js';
export type { MpDelta, MpSource, TsdComponents } from './ai/h2/core/tsd.js';
export { loadWinProbModel, winProbability, winProbabilitySlope } from './ai/h2/core/winprob.js';
export type { WinProbModel } from './ai/h2/core/winprob.js';
export { riskPosture, scoreMeanVariance, scoreOutcomes } from './ai/h2/core/risk.js';
export type { RiskPosture } from './ai/h2/core/risk.js';
export { computeStanding } from './ai/h2/services/standing.js';
export type { Standing } from './ai/h2/services/standing.js';
export { renderRationale, collectTunables } from './ai/h2/core/rationale.js';
export { renderExplanation } from './ai/h2/explain.js';
export { H2_SPEC_GRAMMAR, isH2Spec, parseH2Spec } from './ai/h2/spec.js';
export type { H2Spec } from './ai/h2/spec.js';
export { listScenarioIds, loadScenario, saveScenario, scenarioView } from './ai/h2/scenario-store.js';
export type { Scenario, ScenarioSource } from './ai/h2/scenario-store.js';

// One decision explained in text, for any agent in the registry — the shared
// renderer behind `explain`, the AI client's decision log, and the Ask AI
// observer (`specs/2026-08-17-ask-ai-observer.md`).
export {
  analyzeH2Position,
  decisionCandidates,
  explainDecision,
  makeActionDescriber,
  renderCandidateRanking,
} from './ai/explain-decision.js';
export type {
  CandidateRankingInput,
  DecisionExplanation,
  DecisionExplanationInput,
  H2Analysis,
  H2AnalysisOptions,
} from './ai/explain-decision.js';

// Game-log reader: the game server's per-game JSONL, which carries the full
// state for every position a real game reached.
export { gameLogDir, readGameLog, findGameLogRecord, resolveGameLogPath } from './ai/h2/game-log.js';
export type { GameLogRecord } from './ai/h2/game-log.js';
