/**
 * @module ai/h2/oracle
 *
 * Exact lookahead over a combat, in the combat module's own currency.
 *
 * The combat module prices each candidate with a one-step model of the
 * strike (`services/strike`). This oracle prices the same candidates by
 * solving the rest of the combat exactly against the real reducer: every
 * defender choice maximises, every attacker choice minimises, every 2d6 is
 * enumerated through `cheatRollTotal`, and each terminal state is priced by
 * the same services the module uses — tap and loss costs from
 * `character-value`, the wound tempo tunable, `eliminationCost`, the kill MP
 * on offer and the provisional card price. The resulting distribution is
 * scored with the same `standing.score`, so a disagreement between the two
 * is a defect in the module's model, never a difference of taste.
 *
 * The attacker is restricted to the actions that do not play a card, which
 * is the module's own stated assumption ("the attacker plays no cards into
 * this combat"). Leaf prices are relative to the node being checked, so a
 * check partway through a combat asks exactly the question the module
 * answers there: what this decision is worth from here.
 *
 * `checkAgainstAgent` walks the play tree the H2 agent itself generates —
 * its own choice at each defender decision, over every dice outcome and
 * every attacker reply — and solves each reached decision. That is the
 * regression check `modules/combat/oracle.test.ts` runs on the checked-in
 * `combat-oracle/*` scenarios.
 */

import { CardStatus, Phase, reduce } from '@meccg/shared';
import type { CardDefinition, CardInstanceId, EvaluatedAction, GameAction, GameState, PlayerId, PlayerView } from '@meccg/shared';
import { projectPlayerView } from '@meccg/game-server';
import type { Agent } from '../../types.js';
import type { Outcome, Standing } from './core/types.js';
import type { Tunables } from './core/tunables.js';
import type { WinProbModel } from './core/winprob.js';
import { netTsdDelta } from './core/tsd.js';
import { computeStanding } from './services/standing.js';
import { computeCharacterValue } from './services/character-value.js';
import type { CharacterValue } from './services/character-value.js';
import { killMpOnOffer } from './services/attack-value.js';
import { eliminationCost } from './modules/combat/mp-value.js';

/** Ways of rolling 2d6 to each total, over 36. */
const WAYS_2D6: Readonly<Record<number, number>> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };

/**
 * Attacker actions the oracle allows. Everything that plays a card from hand
 * is excluded, matching the combat module's assumption; what remains is the
 * bookkeeping the rules force on the attacker (assignment, ordering, rolls).
 */
const ATTACKER_ACTIONS: ReadonlySet<string> = new Set([
  'pass', 'pass-chain-priority', 'assign-strike', 'choose-strike-order', 'body-check-roll',
  'agent-strike-roll', 'allocate-cvcc-excess', 'take-trophy', 'order-effects',
]);

/** A distribution of TSD deltas: `p` sums to 1 over the list. */
export type TsdDistribution = readonly { readonly p: number; readonly dtsd: number }[];

/** Everything fixed for one solve: the node whose decision is being priced. */
interface Node {
  readonly state: GameState;
  readonly defender: PlayerId;
  readonly view: PlayerView;
  readonly cardPool: Readonly<Record<string, CardDefinition>>;
  readonly tunables: Tunables;
  readonly standing: Standing;
  readonly characterValue: CharacterValue;
  readonly companyCharacterIds: readonly CardInstanceId[];
  readonly statusBefore: ReadonlyMap<CardInstanceId, CardStatus>;
  readonly killMp: number;
  readonly killBefore: number;
  readonly handBefore: number;
}

/** What the oracle says about one decision. */
export interface OracleDecision {
  /** The candidates, in the order the engine offered them. */
  readonly actions: readonly GameAction[];
  /** Exact outcome distribution of each candidate, from this node. */
  readonly distributions: readonly TsdDistribution[];
  /** `standing.score` utility of each distribution — the module's own objective. */
  readonly utilities: readonly number[];
  /** Expected TSD delta of each distribution. */
  readonly expectations: readonly number[];
  /** Index of the best candidate by utility. */
  readonly best: number;
}

/** Search bookkeeping for one solve. */
interface Search {
  readonly memo: Map<string, TsdDistribution>;
  readonly deadline: number;
  decisions: number;
  reduces: number;
}

/** Thrown when a solve runs past its time budget. */
export class OracleBudgetError extends Error {
  constructor(readonly decisions: number, readonly reduces: number) {
    super(`combat oracle budget exceeded after ${decisions} decisions and ${reduces} reducer calls`);
  }
}

function mergeDistribution(entries: TsdDistribution): TsdDistribution {
  const buckets = new Map<number, number>();
  for (const entry of entries) {
    const key = Math.round(entry.dtsd * 1e6) / 1e6;
    buckets.set(key, (buckets.get(key) ?? 0) + entry.p);
  }
  return [...buckets].map(([dtsd, p]) => ({ p, dtsd }));
}

/** Expected value of a distribution. */
export function expectedTsd(distribution: TsdDistribution): number {
  return distribution.reduce((sum, o) => sum + o.p * o.dtsd, 0);
}

function utilityOf(node: Node, distribution: TsdDistribution): number {
  const outcomes: Outcome[] = distribution.map(o => ({ p: o.p, label: '', dtsd: o.dtsd }));
  return node.standing.score(outcomes).utility;
}

/**
 * Identity of a state for memoisation and for merging dice outcomes that
 * land in the same place. The RNG cursor, the sequence number, the consumed
 * cheat roll, the static card pool and the cosmetic last-roll record are
 * not part of it.
 */
export function positionKey(state: GameState): string {
  const { rng: _rng, stateSeq: _seq, cheatRollTotal: _cheat, cardPool: _pool, ...rest } = state as unknown as Record<string, unknown>;
  const players = (rest['players'] as readonly Record<string, unknown>[]).map(player => {
    const { lastDiceRoll: _roll, ...kept } = player;
    return kept;
  });
  return JSON.stringify({ ...rest, players });
}

function isTerminal(state: GameState): boolean {
  return !state.combat || state.phaseState.phase === Phase.GameOver;
}

/**
 * Whose turn it is and what they may do, the way the sim runner decides it:
 * the active player first, then the opponent, whoever has a viable action.
 * The attacker's menu is narrowed to {@link ATTACKER_ACTIONS}.
 */
function actor(state: GameState, defender: PlayerId): { player: PlayerId; view: PlayerView; evaluated: EvaluatedAction[]; actions: GameAction[] } | null {
  const ids = state.players.map(p => p.id);
  const order = state.activePlayer === ids[1] ? [ids[1], ids[0]] : [ids[0], ids[1]];
  for (const player of order) {
    const view = projectPlayerView(state, player);
    const evaluated = view.legalActions.filter(e => e.viable && !(e.action as { regress?: boolean }).regress);
    let actions = evaluated.map(e => e.action);
    if (player !== defender) {
      const allowed = actions.filter(a => ATTACKER_ACTIONS.has(a.type));
      if (allowed.length > 0) actions = allowed;
    }
    if (actions.length > 0) return { player, view, evaluated, actions };
  }
  return null;
}

/**
 * Price a terminal state relative to the node, term by term as the combat
 * module prices a projected outcome: tap cost for a newly tapped character,
 * wound tempo for a newly wounded one, elimination cost and loss cost for
 * one that is gone, the kill MP once banked, and the provisional card price
 * per card that left the hand.
 */
function leafDelta(node: Node, leaf: GameState): number {
  const defender = leaf.players.find(p => p.id === node.defender);
  if (!defender) throw new Error('defender vanished from the state');
  const alive = new Set(defender.companies.flatMap(c => c.characters));
  const characters = defender.characters as unknown as Readonly<Record<string, { readonly status: CardStatus }>>;
  let realized = 0;
  let tempo = 0;
  for (const id of node.companyCharacterIds) {
    const before = node.statusBefore.get(id);
    const now = alive.has(id) ? characters[id as string] : undefined;
    if (!now) {
      const cost = eliminationCost(node.view, node.cardPool, id, node.companyCharacterIds);
      realized += node.standing.tsdAfter(cost.delta) - node.standing.tsd;
      tempo += node.characterValue.lossCost(id).tsd;
    } else if (now.status === CardStatus.Inverted) {
      if (before !== CardStatus.Inverted) tempo += node.tunables.woundTempoCost;
    } else if (now.status === CardStatus.Tapped) {
      if (before === CardStatus.Untapped) tempo += node.characterValue.tapCost(id).tsd;
    }
  }
  if (node.killMp > 0 && defender.marshallingPoints.kill > node.killBefore) {
    realized += node.standing.tsdAfter({ kill: node.killMp }) - node.standing.tsd;
  }
  tempo += node.tunables.provisionalCardPrice * Math.max(0, node.handBefore - defender.hand.length);
  return netTsdDelta({ realized, tempo }, node.tunables);
}

function solve(node: Node, state: GameState, search: Search): TsdDistribution {
  if (isTerminal(state)) return [{ p: 1, dtsd: leafDelta(node, state) }];
  const key = positionKey(state);
  const cached = search.memo.get(key);
  if (cached) return cached;
  if (performance.now() > search.deadline) throw new OracleBudgetError(search.decisions, search.reduces);
  const turn = actor(state, node.defender);
  if (!turn) throw new Error(`combat oracle: no player has a viable action (${state.combat?.phase ?? 'no combat'})`);
  search.decisions++;
  const distributions = turn.actions.map(action => applyWithDice(node, state, action, search));
  let best = distributions[0];
  if (turn.player === node.defender) {
    let bestUtility = -Infinity;
    for (const distribution of distributions) {
      const utility = utilityOf(node, distribution);
      if (utility > bestUtility) { bestUtility = utility; best = distribution; }
    }
  } else {
    let bestExpectation = Infinity;
    for (const distribution of distributions) {
      const expectation = expectedTsd(distribution);
      if (expectation < bestExpectation) { bestExpectation = expectation; best = distribution; }
    }
  }
  search.memo.set(key, best);
  return best;
}

/**
 * Apply one action. When the reducer rolled dice, re-apply it for every 2d6
 * total through `cheatRollTotal`, merging totals that reach the same state.
 */
function applyWithDice(node: Node, state: GameState, action: GameAction, search: Search): TsdDistribution {
  search.reduces++;
  const result = reduce(state, action);
  if (result.error) throw new Error(`combat oracle: reducer rejected ${action.type}: ${result.error}`);
  if (result.state.rng.counter === state.rng.counter) return solve(node, result.state, search);
  const branches = new Map<string, { p: number; state: GameState }>();
  for (let total = 2; total <= 12; total++) {
    search.reduces++;
    const rolled = reduce({ ...state, cheatRollTotal: total }, action);
    if (rolled.error) throw new Error(`combat oracle: reducer rejected ${action.type} on a ${total}: ${rolled.error}`);
    const key = positionKey(rolled.state);
    const branch = branches.get(key);
    if (branch) branch.p += WAYS_2D6[total] / 36;
    else branches.set(key, { p: WAYS_2D6[total] / 36, state: rolled.state });
  }
  const merged: { p: number; dtsd: number }[] = [];
  for (const branch of branches.values()) {
    for (const outcome of solve(node, branch.state, search)) merged.push({ p: outcome.p * branch.p, dtsd: outcome.dtsd });
  }
  return mergeDistribution(merged);
}

/** Options for {@link solveDecision} and {@link checkAgainstAgent}. */
export interface OracleOptions {
  readonly cardPool: Readonly<Record<string, CardDefinition>>;
  readonly tunables: Tunables;
  readonly model: WinProbModel;
  /** Wall-clock budget for the whole call, in milliseconds. */
  readonly budgetMs: number;
}

function nodeFor(state: GameState, options: OracleOptions): Node {
  const combat = state.combat;
  if (!combat) throw new Error('combat oracle: no combat in progress');
  const defender = combat.defendingPlayerId;
  const view = projectPlayerView(state, defender);
  const standing = computeStanding(view, options.model, options.tunables);
  const player = state.players.find(p => p.id === defender);
  const company = player?.companies.find(c => c.id === combat.companyId);
  if (!player || !company) throw new Error('combat oracle: defending company not found');
  const characters = player.characters as unknown as Readonly<Record<string, { readonly status: CardStatus }>>;
  return {
    state,
    defender,
    view,
    cardPool: options.cardPool,
    tunables: options.tunables,
    standing,
    characterValue: computeCharacterValue(view, options.cardPool, standing, options.tunables),
    companyCharacterIds: [...company.characters],
    statusBefore: new Map(company.characters.map(id => [id, characters[id as string].status])),
    killMp: killMpOnOffer(options.cardPool, combat, view),
    killBefore: player.marshallingPoints.kill,
    handBefore: player.hand.length,
  };
}

/**
 * Solve the defender's decision at `state` exactly.
 *
 * Throws {@link OracleBudgetError} past the budget and a plain error when
 * `state` is not a defender decision in a combat.
 */
export function solveDecision(state: GameState, options: OracleOptions): OracleDecision {
  const node = nodeFor(state, options);
  const turn = actor(state, node.defender);
  if (!turn || turn.player !== node.defender) throw new Error('combat oracle: not a defender decision');
  const search: Search = { memo: new Map(), deadline: performance.now() + options.budgetMs, decisions: 0, reduces: 0 };
  const distributions = turn.actions.map(action => applyWithDice(node, state, action, search));
  const utilities = distributions.map(d => utilityOf(node, d));
  const expectations = distributions.map(expectedTsd);
  let best = 0;
  for (let i = 1; i < utilities.length; i++) if (utilities[i] > utilities[best]) best = i;
  return { actions: turn.actions, distributions, utilities, expectations, best };
}

/** One defender decision the agent reached, with what it chose and what was best. */
export interface AgreementRecord {
  readonly state: GameState;
  readonly decision: OracleDecision;
  /** Index into `decision.actions` of the agent's choice. */
  readonly chosen: number;
  /** Utility the agent gave up by not choosing the best candidate (0 when it agreed). */
  readonly regret: number;
}

/** What {@link checkAgainstAgent} found. */
export interface AgreementReport {
  readonly records: readonly AgreementRecord[];
  /** Set when the walk stopped early — the budget or the node cap. */
  readonly stoppedEarly?: string;
}

/**
 * Walk the agent's own play tree from `root` and solve every defender
 * decision it reaches: its choice at each, every dice outcome of that
 * choice, and every attacker reply. Records are in visiting order, the root
 * first.
 */
export function checkAgainstAgent(
  root: GameState,
  agent: Agent,
  options: OracleOptions & { readonly maxDecisions?: number },
): AgreementReport {
  const combat = root.combat;
  if (!combat) throw new Error('combat oracle: no combat in progress');
  const defender = combat.defendingPlayerId;
  const deadline = performance.now() + options.budgetMs;
  const maxDecisions = options.maxDecisions ?? Infinity;
  const records: AgreementRecord[] = [];
  const queue: GameState[] = [root];
  const seen = new Set<string>([positionKey(root)]);
  const push = (state: GameState): void => {
    if (isTerminal(state)) return;
    const key = positionKey(state);
    if (seen.has(key)) return;
    seen.add(key);
    queue.push(state);
  };
  const expand = (state: GameState, action: GameAction): void => {
    const result = reduce(state, action);
    if (result.error) throw new Error(`combat oracle: reducer rejected ${action.type}: ${result.error}`);
    if (result.state.rng.counter === state.rng.counter) { push(result.state); return; }
    for (let total = 2; total <= 12; total++) push(reduce({ ...state, cheatRollTotal: total }, action).state);
  };

  while (queue.length > 0) {
    if (records.length >= maxDecisions) return { records, stoppedEarly: `decision cap of ${maxDecisions} reached` };
    const remaining = deadline - performance.now();
    if (remaining <= 0) return { records, stoppedEarly: 'budget exhausted' };
    const state = queue.shift()!;
    const turn = actor(state, defender);
    if (!turn) throw new Error(`combat oracle: no player has a viable action (${state.combat?.phase ?? 'no combat'})`);
    if (turn.player !== defender) {
      for (const action of turn.actions) expand(state, action);
      continue;
    }
    let decision: OracleDecision;
    try {
      decision = solveDecision(state, { ...options, budgetMs: remaining });
    } catch (error) {
      if (error instanceof OracleBudgetError) return { records, stoppedEarly: error.message };
      throw error;
    }
    agent.startGame?.();
    const choice = agent.chooseAction({
      view: turn.view,
      cardPool: options.cardPool,
      legalActions: turn.actions,
      evaluated: turn.evaluated,
      random: () => 0.5,
    });
    const chosen = turn.actions.findIndex(action => sameAction(action, choice.action));
    if (chosen < 0) throw new Error(`combat oracle: the agent chose ${choice.action.type}, which the engine did not offer`);
    records.push({ state, decision, chosen, regret: decision.utilities[decision.best] - decision.utilities[chosen] });
    expand(state, choice.action);
  }
  return { records };
}

/** Whether two actions are the same choice, ignoring the engine's explanation text. */
function sameAction(a: GameAction, b: GameAction): boolean {
  const strip = (action: GameAction): string => {
    const { explanation: _explanation, ...rest } = action as unknown as Record<string, unknown>;
    return JSON.stringify(rest);
  };
  return strip(a) === strip(b);
}

/** A one-line description of a candidate for reports and test failures. */
export function describeAction(action: GameAction, view: PlayerView, cardPool: Readonly<Record<string, CardDefinition>>): string {
  const fields = action as unknown as Record<string, unknown>;
  const name = (id: unknown): string => {
    if (typeof id !== 'string') return '';
    const character = view.self.characters[id as CardInstanceId];
    if (character) return cardPool[character.definitionId]?.name ?? id;
    const card = view.self.hand.find(c => (c.instanceId as string) === id);
    return card ? (cardPool[card.definitionId]?.name ?? id) : id;
  };
  switch (action.type) {
    case 'resolve-strike': return `resolve-strike(${fields['tapToFight'] ? 'tap' : 'untapped'}, need ${String(fields['need'])})`;
    case 'play-strike-event': return `play-strike-event(${name(fields['cardInstanceId'])}, need ${String(fields['need'])})`;
    case 'assign-strike': return `assign-strike(${name(fields['characterId'])}${fields['tapped'] ? ', tapped' : ''})`;
    case 'choose-strike-order': return `choose-strike-order(${name(fields['characterId'])})`;
    case 'cancel-attack': return `cancel-attack(${name(fields['cardInstanceId'])})`;
    case 'cancel-by-tap': return `cancel-by-tap(${name(fields['characterId'])})`;
    case 'support-strike': return `support-strike(${name(fields['characterId'] ?? fields['supporterId'])})`;
    default: return action.type;
  }
}
