/**
 * @module ai/h2/calibrate
 *
 * The calibration harness: check a module's claimed probabilities against the
 * real reducer.
 *
 * A module says `P(wounded) = 44.4%`. The harness takes the position, replays
 * the same action thousands of times through the engine with a fresh seed each
 * time, classifies what actually happened, and asserts the empirical frequency
 * lies inside the binomial confidence interval of the claim. A module whose
 * probabilities are wrong is caught immediately and unambiguously — the
 * property that Heuristics 1's weights, being unitless preferences rather than
 * predictions, can never have.
 *
 * The classification is made from the engine's own record of what happened —
 * the strike assignment's `result`, then the character's fate and where the
 * creature card came to rest — never from a re-derivation, so the harness
 * cannot agree with the module by sharing its mistakes.
 */

import { CardStatus, computeTournamentScore, reduce } from '@meccg/shared';
import type { CardInstanceId, GameAction, GameState, PlayerId, RngState } from '@meccg/shared';
import { projectPlayerView } from '@meccg/game-server';
import type { CharacterFate, StrikeFate } from './services/strike/strike-model.js';

/** How a rollout ended, in the same vocabulary the module predicts in. */
export interface RolloutOutcome {
  /** What happened to the struck character. */
  readonly character: CharacterFate;
  /** What happened to the strike. */
  readonly strike: StrikeFate;
}

/** Result of comparing one claimed probability against the reducer. */
export interface CalibrationRow {
  /** The outcome being checked. */
  readonly label: string;
  /** The probability the module claimed. */
  readonly claimed: number;
  /** The frequency the reducer produced. */
  readonly observed: number;
  /** Rollouts that produced this outcome. */
  readonly hits: number;
  /** Total rollouts that resolved. */
  readonly rollouts: number;
  /** Half-width of the confidence interval around `claimed`. */
  readonly tolerance: number;
  /** Whether `observed` lies inside the interval. */
  readonly withinInterval: boolean;
}

/**
 * Z score for a 99% two-sided normal interval — wide enough that a passing
 * suite is not a coin flip on ordinary sampling noise, tight enough to catch a
 * model that is systematically wrong.
 */
const Z_99 = 2.576;

/** Safety bound on the follow-through after the measured action. */
const MAX_FOLLOW_THROUGH_STEPS = 8;

/** Binomial confidence half-width for `p` over `n` samples. */
export function binomialTolerance(p: number, n: number): number {
  return Z_99 * Math.sqrt(Math.max(p * (1 - p), 1e-9) / n);
}

/**
 * The next action to take while driving a strike to its conclusion.
 *
 * The policy is exactly the one the module's claim assumes, and no more:
 *
 * - a body check is forced, so it is simply taken;
 * - a strike the defender has not resolved yet is faced by tapping to fight,
 *   which is what a support tap or a prowess-adding strike event is *for*;
 * - every other window — the attacker's response to a declared card, a chain
 *   the defender opened — is passed, because the module states as an
 *   assumption that the attacker plays nothing into the combat.
 *
 * Anything that cannot be resolved by that policy returns null, and the
 * rollout is reported as unmeasured rather than guessed at.
 */
function nextFollowThroughAction(state: GameState, defenderId: PlayerId): GameAction | null {
  const combat = state.combat;
  if (!combat) return null;

  if (combat.phase === 'body-check') {
    const roller = combat.bodyCheckTarget === 'attacker-character' ? defenderId : combat.attackingPlayerId;
    const forced = viableFor(state, roller);
    return forced.length === 1 ? forced[0] : null;
  }

  const defenderActions = viableFor(state, defenderId);
  const faceStrike = defenderActions.find(a =>
    a.type === 'resolve-strike' && (a as unknown as { tapToFight?: boolean }).tapToFight === true);
  if (faceStrike) return faceStrike;

  for (const playerId of [defenderId, combat.attackingPlayerId]) {
    const actions = playerId === defenderId ? defenderActions : viableFor(state, playerId);
    if (actions.length === 0) continue;
    const pass = actions.find(a => a.type === 'pass');
    if (pass) return pass;
    if (actions.length === 1) return actions[0];
    return null;
  }
  return null;
}

/** The viable actions a player has right now. */
function viableFor(state: GameState, playerId: PlayerId): GameAction[] {
  return projectPlayerView(state, playerId).legalActions.filter(e => e.viable).map(e => e.action);
}

/**
 * Replay a corruption check and report whether the character survived it.
 *
 * The engine removes a character that fails (`removeFailedCorruptionCharacter`
 * routes it to the discard pile or out of play), so presence afterwards is the
 * verdict — read from the state rather than re-derived from the roll.
 */
export function rolloutCorruptionCheck(
  state: GameState,
  action: GameAction,
  rng: RngState,
): { survived: boolean | null; rng: RngState } {
  const characterId = (action as unknown as { characterId?: CardInstanceId }).characterId;
  const playerId = (action as unknown as { player?: PlayerId }).player;
  if (!characterId || !playerId) return { survived: null, rng };
  const applied = reduce({ ...state, rng }, action);
  if (applied.error) return { survived: null, rng };
  const player = applied.state.players.find(p => p.id === playerId);
  return { survived: player?.characters[characterId] !== undefined, rng: applied.state.rng };
}

/**
 * Replay a faction influence attempt and report whether it landed.
 *
 * The attempt does not resolve on the spot: it enqueues a pending
 * `faction-influence-roll` (`chain-reducer.ts`), so the harness follows that
 * forced step through before reading the verdict. The verdict is where the
 * faction card came to rest — in play, or in the discard pile — not a
 * re-derivation of the roll.
 */
export function rolloutInfluenceAttempt(
  state: GameState,
  action: GameAction,
  rng: RngState,
): { succeeded: boolean | null; rng: RngState } {
  const factionId = (action as unknown as { factionInstanceId?: CardInstanceId }).factionInstanceId;
  const playerId = (action as unknown as { player?: PlayerId }).player;
  if (!factionId || !playerId) return { succeeded: null, rng };

  const applied = reduce({ ...state, rng }, action);
  if (applied.error) return { succeeded: null, rng };
  let current = applied.state;

  // Playing a faction opens a chain, and nothing resolves until the opponent
  // releases priority — so the harness passes for them, which is the module's
  // stated assumption that the opponent plays nothing into the attempt. Then
  // the queued `faction-influence-roll` is taken, and the card lands.
  const landed = (s: GameState): boolean | null => {
    const p = s.players.find(x => x.id === playerId);
    if (!p) return null;
    if (p.cardsInPlay.some(c => c.instanceId === factionId)) return true;
    if (p.discardPile.some(c => c.instanceId === factionId)) return false;
    return null;
  };

  for (let step = 0; step < MAX_FOLLOW_THROUGH_STEPS * 2; step++) {
    if (landed(current) !== null) break;
    let acted = false;
    for (const id of [playerId, ...current.players.map(x => x.id).filter(x => x !== playerId)]) {
      const actions = viableFor(current, id);
      if (actions.length === 0) continue;
      // Prefer the roll, then any way of declining to respond, then a lone
      // forced action. Anything else is a real choice and stops the rollout.
      const chosen = actions.find(a => a.type === 'faction-influence-roll')
        ?? actions.find(a => a.type.startsWith('pass'))
        ?? (actions.length === 1 ? actions[0] : undefined);
      if (!chosen) continue;
      const next = reduce(current, chosen);
      if (next.error) return { succeeded: null, rng: current.rng };
      current = next.state;
      acted = true;
      break;
    }
    if (!acted) break;
  }

  const player = current.players.find(p => p.id === playerId);
  if (!player) return { succeeded: null, rng: current.rng };
  if (player.cardsInPlay.some(c => c.instanceId === factionId)) return { succeeded: true, rng: current.rng };
  if (player.discardPile.some(c => c.instanceId === factionId)) return { succeeded: false, rng: current.rng };
  // Still unresolved. On the corpus position this happens on *every* rollout,
  // so an influenced faction evidently does not come to rest in `cardsInPlay`
  // — it may attach to the influencing character, or the pending roll may need
  // a step this loop does not take. Until that is established the classifier
  // reports "unknown" rather than guessing, and the CLI refuses to call a run
  // with nothing measured a pass.
  return { succeeded: null, rng: current.rng };
}

/**
 * Replay a deterministic play and report the tournament-score differential it
 * actually produced, from the engine's own marshalling-point totals.
 *
 * This checks a different kind of claim from the dice classifiers. `resources`
 * says "playing this card gains 5.0 tsd" — no probability, just arithmetic
 * through the tournament scorer on a projected total. Measuring it against the
 * real totals afterwards is what catches a module that has the doubling rule
 * or the diversity cap subtly wrong, which no amount of unit testing against
 * my own fixtures would.
 */
export function rolloutDeterministicPlay(
  state: GameState,
  action: GameAction,
  rng: RngState,
): { tsdChange: number | null; rng: RngState } {
  const playerId = (action as unknown as { player?: PlayerId }).player;
  if (!playerId) return { tsdChange: null, rng };
  const differential = (s: GameState): number | null => {
    const index = s.players.findIndex(p => p.id === playerId);
    if (index < 0) return null;
    const self = s.players[index].marshallingPoints;
    const opponent = s.players[1 - index].marshallingPoints;
    return computeTournamentScore(self, opponent) - computeTournamentScore(opponent, self);
  };
  const before = differential(state);
  if (before === null) return { tsdChange: null, rng };

  const applied = reduce({ ...state, rng }, action);
  if (applied.error) return { tsdChange: null, rng };
  let current = applied.state;

  // A resource play can open a chain, exactly as a faction does; the opponent
  // is passed for, which is the module's assumption that nothing is played
  // into it.
  for (let step = 0; step < MAX_FOLLOW_THROUGH_STEPS; step++) {
    let acted = false;
    for (const id of current.players.map(p => p.id)) {
      const actions = viableFor(current, id).filter(a => a.type.startsWith('pass'));
      if (actions.length === 0) continue;
      const next = reduce(current, actions[0]);
      if (next.error) return { tsdChange: null, rng: current.rng };
      current = next.state;
      acted = true;
      break;
    }
    if (!acted) break;
  }

  const after = differential(current);
  return { tsdChange: after === null ? null : after - before, rng: current.rng };
}

/** The creature card whose fate says whether the attack was defeated. */
function attackingCreatureId(state: GameState): CardInstanceId | null {
  const source = state.combat?.attackSource;
  if (!source) return null;
  if (source.type === 'creature') return source.instanceId;
  if (source.type === 'on-guard-creature') return source.cardInstanceId;
  return null;
}

/** Character fate read from the defender's state after the strike. */
function characterFateOf(state: GameState, defenderId: PlayerId, targetId: CardInstanceId): CharacterFate {
  const defender = state.players.find(p => p.id === defenderId);
  const character = defender?.characters[targetId];
  const ally = character
    ? undefined
    : Object.values(defender?.characters ?? {}).flatMap(c => c.allies).find(a => a.instanceId === targetId);
  const status = character?.status ?? ally?.status;
  if (status === undefined) return 'eliminated';
  if (status === CardStatus.Inverted) return 'wounded';
  if (status === CardStatus.Tapped) return 'tapped';
  return 'untapped';
}

/** One rollout's verdict plus the RNG state to continue the stream with. */
export interface RolloutResult {
  /** What happened, or null when the rollout could not be classified. */
  readonly outcome: RolloutOutcome | null;
  /** RNG state after the rollout — feed this into the next one. */
  readonly rng: RngState;
}

/**
 * Apply an action and drive the engine forward until the current strike has
 * finished resolving, then report what happened to it.
 *
 * The RNG is threaded through rather than re-seeded per rollout, and that is
 * not a detail: mulberry32's first output is correlated across nearby seeds,
 * so re-seeding with 1, 2, 3, … skews the 2d6 distribution by several
 * percentage points at a few thousand samples — enough to fail a correct model
 * and, worse, to pass a wrong one. Drawing from one continuous stream is what
 * a real game does.
 *
 * Only forced continuations are taken: a body check has exactly one legal
 * action, so following it introduces no policy of its own. The harness
 * measures one strike, not a whole combat, and stops as soon as any real
 * decision would be required.
 */
export function rolloutStrike(state: GameState, action: GameAction, rng: RngState): RolloutResult {
  const combat = state.combat;
  if (!combat) return { outcome: null, rng };
  const strikeIndex = combat.currentStrikeIndex;
  const targetId = combat.strikeAssignments[strikeIndex]?.characterId;
  if (!targetId) return { outcome: null, rng };
  const defenderId = combat.defendingPlayerId;
  const creatureId = attackingCreatureId(state);

  // Whether every *other* strike of this attack was already defeated. It
  // decides whether the creature's final resting place can stand in for this
  // strike's verdict once combat has finalized and the record is gone.
  const othersAllDefeated = combat.strikeAssignments.every((assignment, index) =>
    index === strikeIndex || (assignment.resolved && assignment.result === 'success'));

  const applied = reduce({ ...state, rng }, action);
  if (applied.error) return { outcome: null, rng };
  let current = applied.state;

  // The strike's own result is written before any body check, so read it while
  // it exists: a later body check can only refine 'wounded' into 'eliminated'
  // or 'success' into 'survived'.
  const recorded = current.combat?.strikeAssignments[strikeIndex]?.result;

  // Follow the forced body-check roll. The *attacking* player rolls it — for
  // the creature's check and for our own character's alike (`handleBodyCheckRoll`
  // in `combat-actions.ts`); only a CvCC check against an attacking character
  // is rolled by the defender.
  let wentThroughBodyCheck = false;
  // Bounded: a strike resolves through at most a handful of steps, and a
  // reducer that failed to advance would otherwise hang the harness.
  for (let step = 0; step < MAX_FOLLOW_THROUGH_STEPS; step++) {
    if (!current.combat) break;
    if (current.combat.strikeAssignments[strikeIndex]?.resolved === true
      && current.combat.phase !== 'body-check') break;

    const chosen = nextFollowThroughAction(current, defenderId);
    if (!chosen) break;
    if (current.combat.phase === 'body-check') wentThroughBodyCheck = true;
    const next = reduce(current, chosen);
    if (next.error) return { outcome: null, rng: current.rng };
    current = next.state;
  }

  // A strike that never resolved cannot be classified — a set-up action whose
  // continuation the harness could not drive must be reported as unmeasured,
  // never folded into whichever bucket happens to fit.
  if (current.combat && current.combat.strikeAssignments[strikeIndex]?.resolved !== true) {
    return { outcome: null, rng: current.rng };
  }

  const characterFate = characterFateOf(current, defenderId, targetId);
  const postResult = current.combat?.strikeAssignments[strikeIndex]?.result;
  // `recorded` is the verdict *before* any body check, where a parry always
  // reads 'success'; only the post-check record distinguishes a defeated
  // attack from one that survived. So it is usable only when no check ran.
  const verdict = postResult ?? (wentThroughBodyCheck ? undefined : recorded);

  let strikeFate: StrikeFate | null;
  if (verdict === 'tie') {
    strikeFate = 'tie';
  } else if (verdict === 'wounded' || verdict === 'eliminated') {
    strikeFate = 'struck';
  } else if (verdict === 'success') {
    strikeFate = 'defeated';
  } else if (verdict === 'survived') {
    strikeFate = 'survived';
  } else if (characterFate === 'wounded' || characterFate === 'eliminated') {
    // The record is gone because combat finalized, but the character's own
    // state is unambiguous: the strike got through.
    strikeFate = 'struck';
  } else if (!othersAllDefeated) {
    // Combat finalized with the record gone and another strike already failed,
    // so the creature's destination says nothing about *this* strike. Better
    // to report an unclassified rollout than to guess one.
    strikeFate = null;
  } else if (creatureId === null) {
    // An automatic attack leaves no card to follow. Only a body check produces
    // 'survived', and a body check would have kept combat alive.
    strikeFate = wentThroughBodyCheck ? 'survived' : 'defeated';
  } else {
    // Every other strike was defeated, so the creature reaching our kill pile
    // means this one was too (`combat-finalize.ts`). Failing that, it was a
    // tie if no body check ran and a surviving attack if one did.
    const defender = current.players.find(p => p.id === defenderId);
    const banked = defender?.killPile.some(c => c.instanceId === creatureId) === true;
    strikeFate = banked ? 'defeated' : wentThroughBodyCheck ? 'survived' : 'tie';
  }

  if (strikeFate === null) return { outcome: null, rng: current.rng };
  return { outcome: { character: characterFate, strike: strikeFate }, rng: current.rng };
}

/**
 * Replay a granted action and report whether the roll succeeded.
 *
 * `grants` claims a probability straight off the threshold the engine publishes
 * on the action — `pAtLeast(rollThreshold)` — which is the most directly
 * falsifiable claim any module makes: no modelling assumption stands between
 * the number and the dice.
 *
 * Success is read from where the granting card came to rest. A
 * `remove-self-on-roll` that succeeds moves the card to its owner's discard
 * pile; one that fails leaves it attached. That is the engine's own record of
 * what happened, not a re-derivation of the rule.
 */
export function rolloutGrantedAction(
  state: GameState,
  action: GameAction,
  rng: RngState,
): { succeeded: boolean | null; rng: RngState } {
  const sourceId = (action as unknown as { sourceCardId?: CardInstanceId }).sourceCardId;
  if (!sourceId) return { succeeded: null, rng };

  const applied = reduce({ ...state, rng }, action);
  if (applied.error) return { succeeded: null, rng };
  let current = applied.state;

  /** True once the granting card has left play for a discard pile. */
  const gone = (s: GameState): boolean =>
    s.players.some(p => p.discardPile.some(c => c.instanceId === sourceId));
  /** True while it is still attached to somebody. */
  const attached = (s: GameState): boolean =>
    s.players.some(p => Object.values(p.characters)
      .some(character => character.hazards.some(h => h.instanceId === sourceId)));

  // Follow through only forced steps and passes: anything that is a real choice
  // would make the harness measure the *agent's* judgement rather than the die.
  for (let step = 0; step < MAX_FOLLOW_THROUGH_STEPS; step++) {
    if (gone(current) || !attached(current)) break;
    let acted = false;
    for (const id of current.players.map(p => p.id)) {
      const actions = viableFor(current, id);
      const chosen = actions.find(a => a.type.startsWith('pass'))
        ?? (actions.length === 1 ? actions[0] : undefined);
      if (!chosen) continue;
      const next = reduce(current, chosen);
      if (next.error) return { succeeded: null, rng: current.rng };
      current = next.state;
      acted = true;
      break;
    }
    if (!acted) break;
  }

  if (gone(current)) return { succeeded: true, rng: current.rng };
  if (attached(current)) return { succeeded: false, rng: current.rng };
  return { succeeded: null, rng: current.rng };
}
