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
export type { BcWeightsFile, BcOutput, TensorJson } from './agents/bc-agent.js';

export { INITIAL_RATING, updateRating, ratingInterval } from './glicko2.js';
export type { Glicko2Rating, RatedGame } from './glicko2.js';

export { runTournament, runMatch, estimateEloDiff, scoreToEloDiff } from './tournament.js';
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

export { loadDeck, listDecks, expandEntries, deckToPlayerConfig, DECK_CATALOG_DIR, DECK_ALIGNMENT_MAP } from './decks.js';
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
export { loadAiStrategy, sampleWeighted } from './ai/index.js';
export type { AiStrategy, AiContext, WeightedAction } from './ai/index.js';
export { heuristicStrategy } from './ai/heuristic.js';

export { determinize, isDeterminizableView } from './search/determinize.js';
export type { DeterminizeOptions } from './search/determinize.js';

export { searchBestAction } from './search/puct.js';
export type { SearchOptions, SearchResult } from './search/puct.js';
export { createSearchAgent } from './agents/search-agent.js';
export type { SearchAgentOptions } from './agents/search-agent.js';
