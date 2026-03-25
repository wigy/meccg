/**
 * @module legal-actions/chain
 *
 * Computes legal actions when a chain of effects is active.
 *
 * When `state.chain` is non-null, {@link computeLegalActions} delegates here
 * instead of to the phase-specific handler. This module determines what the
 * priority player can declare in response (playable cards, pass) while
 * respecting the chain's restriction mode.
 *
 * During the `'resolving'` mode, no player actions are needed — the reducer
 * auto-advances resolution. This function only returns actions during the
 * `'declaring'` mode for the player who currently has priority.
 */

import type { GameState, PlayerId, EvaluatedAction, PassChainPriorityAction, CardInstanceId, HazardEventCard } from '../../index.js';
import { logDetail } from './log.js';

/**
 * Returns the legal actions available to the given player while a chain
 * of effects is active. Only the priority player may act during the
 * declaring phase; during resolution the reducer auto-advances.
 */
export function chainActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const chain = state.chain!;

  // During resolution, the reducer auto-advances — no player input needed
  if (chain.mode === 'resolving') {
    logDetail(`Chain is resolving — no actions for player ${playerId as string}`);
    return [];
  }

  // Only the priority player may act
  if (playerId !== chain.priority) {
    logDetail(`Player ${playerId as string} does not have chain priority — no actions`);
    return [];
  }

  const actions: EvaluatedAction[] = [];

  // Short-event response actions (e.g. Twilight canceling an environment)
  if (chain.restriction === 'normal') {
    actions.push(...playShortEventChainActions(state, playerId));
  }

  // The priority player can always pass
  const passAction: PassChainPriorityAction = {
    type: 'pass-chain-priority',
    player: playerId,
  };
  actions.push({ action: passAction, viable: true });

  logDetail(`Chain declaring: player ${playerId as string} has ${actions.length} action(s) (pass${actions.length > 1 ? ' + responses' : ' only'})`);

  return actions;
}

/**
 * During chain declaring, the priority player may play short-event cards
 * with `playable-as-resource` (e.g. Twilight) to cancel an environment.
 * Targets include environments in eventsInPlay, cardsInPlay, and unresolved
 * chain entries with the environment keyword.
 */
function playShortEventChainActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = state.players.find(p => p.id === playerId)!;
  const actions: EvaluatedAction[] = [];

  for (const cardInstanceId of player.hand) {
    const inst = state.instanceMap[cardInstanceId as string];
    if (!inst) continue;
    const def = state.cardPool[inst.definitionId as string] as HazardEventCard | undefined;
    if (!def || def.cardType !== 'hazard-event' || def.eventType !== 'short') continue;
    if (!def.effects?.some(e => e.type === 'play-restriction' && e.rule === 'playable-as-resource')) continue;

    // Collect environment targets
    const isEnv = (defId: string): boolean => {
      const d = state.cardPool[defId];
      return !!d && 'keywords' in d
        && !!(d as { keywords?: readonly string[] }).keywords?.includes('environment');
    };
    const envTargets: { instanceId: CardInstanceId; definitionId: string }[] = [];
    for (const ev of state.eventsInPlay) {
      if (isEnv(ev.definitionId as string)) envTargets.push(ev);
    }
    for (const p of state.players) {
      for (const c of p.cardsInPlay) {
        if (isEnv(c.definitionId as string)) envTargets.push(c);
      }
    }
    if (state.chain) {
      for (const entry of state.chain.entries) {
        if (entry.resolved || entry.negated) continue;
        if (!entry.definitionId || !entry.cardInstanceId) continue;
        if (isEnv(entry.definitionId as string)) {
          envTargets.push({ instanceId: entry.cardInstanceId, definitionId: entry.definitionId as string });
        }
      }
    }

    for (const target of envTargets) {
      const targetDef = state.cardPool[target.definitionId];
      logDetail(`Chain response: ${def.name} can cancel ${targetDef?.name ?? target.definitionId}`);
      actions.push({
        action: {
          type: 'play-short-event',
          player: playerId,
          cardInstanceId,
          targetInstanceId: target.instanceId,
        },
        viable: true,
      });
    }
  }

  return actions;
}
