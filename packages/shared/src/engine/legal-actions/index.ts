/**
 * @module legal-actions
 *
 * Computes the complete list of candidate actions a player can take
 * given the current game state. Each phase has its own module under this
 * directory. This index dispatches to the appropriate phase module.
 *
 * Setup phases return {@link EvaluatedAction} with viability and reasons
 * via the rules engine. Other phases wrap their actions as viable.
 *
 * The function is pure: `(GameState, PlayerId) → EvaluatedAction[]`.
 */

import type { GameState, PlayerId, GameAction, EvaluatedAction, CardInstanceId, FetchToDeckEffect } from '../../index.js';
import { matchesCondition } from '../../index.js';
import { setupActions } from './setup.js';
import { untapActions } from './untap.js';
import { organizationActions } from './organization.js';
import { longEventActions } from './long-event.js';
import { movementHazardActions } from './movement-hazard.js';
import { siteActions } from './site.js';
import { endOfTurnActions } from './end-of-turn.js';
import { freeCouncilActions } from './free-council.js';
import { chainActions } from './chain.js';
import { combatActions } from './combat.js';
import { logHeading, logResult } from './log.js';
import { topResolutionFor } from '../pending.js';
import { resolutionLegalActions, applyConstraints } from './pending.js';

/**
 * Computes legal actions when a pending card effect is being resolved.
 * Dispatches to the appropriate handler based on the effect type.
 */
function pendingEffectLegalActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const current = state.pendingEffects[0];
  if (current.type === 'card-effect' && current.effect.type === 'fetch-to-deck') {
    return fetchFromPileLegalActions(state, playerId, current.effect);
  }
  // Unknown effect type: allow pass to skip
  return [{ action: { type: 'pass', player: playerId }, viable: true }];
}

/** Computes legal fetch-from-pile actions for a fetch-to-deck effect. */
function fetchFromPileLegalActions(state: GameState, playerId: PlayerId, effect: FetchToDeckEffect): EvaluatedAction[] {
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) return [];
  const player = state.players[playerIndex];
  const actions: EvaluatedAction[] = [];

  for (const source of effect.source) {
    const pile = source === 'sideboard' ? player.sideboard : player.discardPile;
    const pileSource = source === 'sideboard' ? 'sideboard' : 'discard-pile';
    for (const card of pile) {
      const def = state.cardPool[card.definitionId as string];
      if (!def || !matchesCondition(effect.filter, def as unknown as Record<string, unknown>)) continue;
      actions.push({
        action: { type: 'fetch-from-pile', player: playerId, cardInstanceId: card.instanceId, source: pileSource } as
          { type: 'fetch-from-pile'; player: PlayerId; cardInstanceId: CardInstanceId; source: 'sideboard' | 'discard-pile' },
        viable: true,
      });
    }
  }

  actions.push({ action: { type: 'pass', player: playerId }, viable: true });
  return actions;
}

/** Wraps plain GameActions as viable EvaluatedActions (for non-setup phases). */
function asViable(actions: GameAction[]): EvaluatedAction[] {
  return actions.map(action => ({ action, viable: true }));
}

/**
 * Collects all card instance IDs referenced by any evaluated action so
 * that we can detect hand cards with no coverage at all.
 */
function referencedInstanceIds(evaluated: EvaluatedAction[]): Set<string> {
  const ids = new Set<string>();
  for (const ea of evaluated) {
    const a = ea.action as unknown as Record<string, unknown>;
    if (typeof a['cardInstanceId'] === 'string') ids.add(a['cardInstanceId']);
    if (typeof a['characterInstanceId'] === 'string') ids.add(a['characterInstanceId']);
  }
  return ids;
}

/**
 * Appends not-playable entries for hand cards that no phase handler
 * evaluated — guarantees every hand card gets a tooltip in the UI.
 */
function fillNotPlayable(state: GameState, playerId: PlayerId, evaluated: EvaluatedAction[]): EvaluatedAction[] {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return evaluated;
  const covered = referencedInstanceIds(evaluated);
  const extras: EvaluatedAction[] = [];
  for (const card of player.hand) {
    if (covered.has(card.instanceId as string)) continue;
    const def = state.cardPool[card.definitionId as string];
    const name = def ? (def as unknown as Record<string, unknown>)['name'] as string : card.definitionId as string;
    extras.push({
      action: { type: 'not-playable', player: playerId, cardInstanceId: card.instanceId },
      viable: false,
      reason: `${name} cannot be played during this step`,
    });
  }
  if (extras.length > 0) {
    return [...evaluated, ...extras];
  }
  return evaluated;
}

/**
 * Returns every candidate action the given player could take in the current
 * game state, annotated with viability. Non-viable actions include a
 * human-readable reason explaining why they cannot be taken.
 */
export function computeLegalActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const phase = state.phaseState.phase;
  logHeading(`Computing legal actions for player ${playerId as string} in phase '${phase}'`);

  // Chain of effects takes priority over everything else — except when the
  // chain is paused mid-resolution awaiting a pending resolution (e.g. a
  // faction-influence-roll). In that case the pending resolution drives
  // the legal actions; the chain entry stays alive (so its card is still
  // findable) and is marked resolved by the pending reducer afterwards.
  if (state.chain != null) {
    if (state.chain.mode === 'resolving') {
      const top = topResolutionFor(state, playerId);
      if (top !== null) {
        logHeading(`Chain paused mid-resolution by pending ${top.kind.type} — delegating to resolution actions`);
        const evaluated = resolutionLegalActions(state, playerId, top);
        const viableCount = evaluated.filter(e => e.viable).length;
        logResult(viableCount, evaluated.filter(e => e.viable).map(e => e.action) as unknown as Record<string, unknown>[]);
        return evaluated;
      }
      // Chain resolving but no pending resolution for this player — they
      // must wait for the other player (or for auto-resolve to finish).
      if (state.pendingResolutions.length > 0) {
        logHeading(`Chain paused mid-resolution; pending resolution belongs to other player — waiting`);
        logResult(0, []);
        return [];
      }
    }
    logHeading(`Chain active (${state.chain.mode}) — delegating to chain actions`);
    const evaluated = chainActions(state, playerId);
    const viableCount = evaluated.filter(e => e.viable).length;
    logResult(viableCount, evaluated.filter(e => e.viable).map(e => e.action) as unknown as Record<string, unknown>[]);
    return evaluated;
  }

  // Combat sub-state takes priority over phase actions
  if (state.combat != null) {
    logHeading(`Combat active (phase: ${state.combat.phase}) — delegating to combat actions`);
    const evaluated = combatActions(state, playerId);
    const viableCount = evaluated.filter(e => e.viable).length;
    logResult(viableCount, evaluated.filter(e => e.viable).map(e => e.action) as unknown as Record<string, unknown>[]);
    return evaluated;
  }

  // Pending card effects take priority over phase actions
  if (state.pendingEffects.length > 0) {
    const effectActor = state.pendingEffects[0].actor ?? state.activePlayer;
    if (playerId !== effectActor) {
      logResult(0, []);
      return [];
    }
    logHeading(`Pending effects active (${state.pendingEffects[0].type}) — delegating to effect actions`);
    const evaluated = pendingEffectLegalActions(state, playerId);
    const viableCount = evaluated.filter(e => e.viable).length;
    logResult(viableCount, evaluated.filter(e => e.viable).map(e => e.action) as unknown as Record<string, unknown>[]);
    return evaluated;
  }

  // Pending resolutions short-circuit (Shape A — see types/pending.ts).
  // While any resolution is queued for this player, only its resolution
  // actions are legal. While a resolution is queued for the *other*
  // player, this player must wait — they have no legal actions.
  const top = topResolutionFor(state, playerId);
  if (top !== null) {
    logHeading(`Pending resolution active (${top.kind.type}) — delegating to resolution actions`);
    const evaluated = resolutionLegalActions(state, playerId, top);
    const viableCount = evaluated.filter(e => e.viable).length;
    logResult(viableCount, evaluated.filter(e => e.viable).map(e => e.action) as unknown as Record<string, unknown>[]);
    return evaluated;
  }
  if (state.pendingResolutions.length > 0) {
    logHeading(`Pending resolution active for another player — waiting`);
    logResult(0, []);
    return [];
  }

  let evaluated: EvaluatedAction[];
  switch (phase) {
    case 'setup':             evaluated = setupActions(state, playerId); break;
    case 'untap':             evaluated = untapActions(state, playerId); break;
    case 'organization':      evaluated = organizationActions(state, playerId); break;
    case 'long-event':        evaluated = longEventActions(state, playerId); break;
    case 'movement-hazard':   evaluated = movementHazardActions(state, playerId); break;
    case 'site':              evaluated = siteActions(state, playerId); break;
    case 'end-of-turn':       evaluated = asViable(endOfTurnActions(state, playerId)); break;
    case 'free-council':      evaluated = asViable(freeCouncilActions(state, playerId)); break;
    case 'game-over': {
      const goState = state.phaseState as { finishedPlayers: readonly string[] };
      evaluated = goState.finishedPlayers.includes(playerId as string)
        ? []
        : asViable([{ type: 'finished', player: playerId }]);
      break;
    }
    default:                  evaluated = []; break;
  }

  // Active constraints filter (Shape B — see types/pending.ts). Pass-through
  // when no constraints are in scope.
  evaluated = applyConstraints(state, playerId, evaluated);

  // Catch-all: mark remaining hand cards that have no evaluated action as
  // not-playable so the UI can show a tooltip for every dimmed card.
  evaluated = fillNotPlayable(state, playerId, evaluated);

  const viableCount = evaluated.filter(e => e.viable).length;
  logResult(viableCount, evaluated.filter(e => e.viable).map(e => e.action) as unknown as Record<string, unknown>[]);
  return evaluated;
}
