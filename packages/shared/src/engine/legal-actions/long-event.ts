/**
 * @module legal-actions/long-event
 *
 * Legal actions during the long-event phase. The resource player may play
 * resource long-events and resource short-events from hand. At entry, the
 * engine already discarded the resource player's old resource long-events;
 * on pass, hazard long-events belonging to the opponent are discarded
 * automatically.
 *
 * When a resource short-event with a `fetch-to-deck` effect is played,
 * the phase enters a fetch sub-flow where the player must select a card
 * from their sideboard or discard pile.
 *
 * Returns {@link EvaluatedAction} entries so the UI can highlight playable
 * cards and show reasons for non-playable ones.
 */

import type { GameState, PlayerId, EvaluatedAction, HeroResourceEventCard, LongEventPhaseState, CardInstanceId } from '../../index.js';
import { matchesCondition } from '../../index.js';
import { logHeading, logDetail } from './log.js';

/**
 * Computes legal actions for the fetch-to-deck sub-flow.
 *
 * When {@link LongEventPhaseState.pendingFetch} is active, the player must
 * select one eligible card from the specified source piles.
 */
function fetchFromPileActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const leState = state.phaseState as LongEventPhaseState;
  const pending = leState.pendingFetch;
  if (!pending) return [];

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) return [];
  const player = state.players[playerIndex];

  const actions: EvaluatedAction[] = [];

  for (const source of pending.sources) {
    const pile = source === 'sideboard' ? player.sideboard : player.discardPile;
    const pileSource = source === 'sideboard' ? 'sideboard' : 'discard-pile';

    for (const card of pile) {
      const def = state.cardPool[card.definitionId as string];
      if (!def) continue;

      // Apply filter
      if (!matchesCondition(pending.filter, def as unknown as Record<string, unknown>)) {
        continue;
      }

      logDetail(`Fetch eligible: ${def.name} from ${source} (${card.instanceId as string})`);
      actions.push({
        action: {
          type: 'fetch-from-pile',
          player: playerId,
          cardInstanceId: card.instanceId,
          source: pileSource,
        } as { type: 'fetch-from-pile'; player: PlayerId; cardInstanceId: CardInstanceId; source: 'sideboard' | 'discard-pile' },
        viable: true,
      });
    }
  }

  // If no eligible cards, allow pass to skip
  if (actions.length === 0) {
    logDetail('Fetch sub-flow: no eligible cards — pass to skip');
  }
  actions.push({ action: { type: 'pass', player: playerId }, viable: true });

  logDetail(`Fetch sub-flow: ${actions.length - 1} eligible cards + pass`);
  return actions;
}

/**
 * Computes the legal actions for the active player during the long-event phase.
 *
 * The resource player (active player) may play resource long-events and
 * resource short-events from hand. Non-event hand cards are annotated as
 * not-playable with a reason. Always includes pass to advance to the
 * Movement/Hazard phase.
 */
export function longEventActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  logHeading(`Long-event phase: computing actions for ${playerId as string}`);

  // Only the active (resource) player acts during the long-event phase
  if (playerId !== state.activePlayer) {
    logDetail('Not active player — no actions during long-event phase');
    return [];
  }

  // If fetch sub-flow is active, only fetch actions are legal
  const leState = state.phaseState as LongEventPhaseState;
  if (leState.pendingFetch) {
    logHeading('Fetch-to-deck sub-flow active');
    return fetchFromPileActions(state, playerId);
  }

  const actions: EvaluatedAction[] = [];
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) {
    return [{ action: { type: 'pass', player: playerId }, viable: true }];
  }
  const player = state.players[playerIndex];

  // Track which hand cards have been evaluated so we can mark the rest not-playable
  const evaluatedInstances = new Set<string>();

  // Scan hand for resource events (long and short)
  for (const handCard of player.hand) {
    const cardInstanceId = handCard.instanceId;
    const def = state.cardPool[handCard.definitionId as string] as HeroResourceEventCard | undefined;
    if (!def || def.cardType !== 'hero-resource-event') continue;

    if (def.eventType === 'long') {
      evaluatedInstances.add(cardInstanceId as string);

      // Check uniqueness: unique long-events can't be played if already in play
      if (def.unique) {
        const alreadyInPlay = state.players.some(p =>
          p.cardsInPlay.some(c => c.definitionId === def.id),
        );
        if (alreadyInPlay) {
          logDetail(`${def.name}: unique and already in play`);
          actions.push({
            action: { type: 'not-playable', player: playerId, cardInstanceId },
            viable: false,
            reason: `${def.name} is unique and already in play`,
          });
          continue;
        }
      }

      // Check duplication-limit with scope "game"
      if (def.effects) {
        let blocked = false;
        for (const effect of def.effects) {
          if (effect.type !== 'duplication-limit' || effect.scope !== 'game') continue;
          const copiesInPlay = state.players.reduce((count, p) =>
            count + p.cardsInPlay.filter(c => {
              const cDef = state.cardPool[c.definitionId as string];
              return cDef && cDef.name === def.name;
            }).length, 0,
          );
          if (copiesInPlay >= effect.max) {
            logDetail(`${def.name}: duplication limit reached (${copiesInPlay}/${effect.max})`);
            actions.push({
              action: { type: 'not-playable', player: playerId, cardInstanceId },
              viable: false,
              reason: `${def.name} cannot be duplicated`,
            });
            blocked = true;
            break;
          }
        }
        if (blocked) continue;
      }

      logDetail(`Resource long-event playable: ${def.name} (${cardInstanceId as string})`);
      actions.push({
        action: { type: 'play-long-event', player: playerId, cardInstanceId },
        viable: true,
      });
    } else if (def.eventType === 'short') {
      evaluatedInstances.add(cardInstanceId as string);

      logDetail(`Resource short-event playable: ${def.name} (${cardInstanceId as string})`);
      actions.push({
        action: { type: 'play-resource-short-event', player: playerId, cardInstanceId },
        viable: true,
      });
    }
  }

  // Mark remaining hand cards as not playable during long-event phase
  for (const handCard of player.hand) {
    if (evaluatedInstances.has(handCard.instanceId as string)) continue;
    actions.push({
      action: { type: 'not-playable', player: playerId, cardInstanceId: handCard.instanceId },
      viable: false,
      reason: 'Only resource events can be played during the long-event phase',
    });
  }

  actions.push({ action: { type: 'pass', player: playerId }, viable: true });
  const playableCount = actions.filter(a => a.viable).length - 1; // exclude pass
  logDetail(`Long-event phase: ${playableCount} playable events + pass, ${actions.length - playableCount - 1} not playable`);
  return actions;
}
