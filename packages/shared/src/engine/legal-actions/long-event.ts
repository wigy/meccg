/**
 * @module legal-actions/long-event
 *
 * Legal actions during the long-event phase. The resource player may play
 * resource long-events from hand. At entry, the engine already discarded
 * the resource player's old resource long-events; on pass, hazard
 * long-events belonging to the opponent are discarded automatically.
 *
 * Returns {@link EvaluatedAction} entries so the UI can highlight playable
 * cards and show reasons for non-playable ones.
 */

import type { GameState, PlayerId, EvaluatedAction, HeroResourceEventCard } from '../../index.js';
import { logHeading, logDetail } from './log.js';

/**
 * Computes the legal actions for the active player during the long-event phase.
 *
 * The resource player (active player) may play resource long-events from hand.
 * Non-long-event hand cards are annotated as not-playable with a reason.
 * Always includes pass to advance to the Movement/Hazard phase.
 */
export function longEventActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  logHeading(`Long-event phase: computing actions for ${playerId as string}`);

  const actions: EvaluatedAction[] = [];
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) {
    return [{ action: { type: 'pass', player: playerId }, viable: true }];
  }
  const player = state.players[playerIndex];

  // Track which hand cards have been evaluated so we can mark the rest not-playable
  const evaluatedInstances = new Set<string>();

  // Scan hand for resource long-events
  for (const cardInstanceId of player.hand) {
    const inst = state.instanceMap[cardInstanceId as string];
    if (!inst) continue;
    const def = state.cardPool[inst.definitionId as string] as HeroResourceEventCard | undefined;
    if (!def || def.cardType !== 'hero-resource-event' || def.eventType !== 'long') continue;

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
  }

  // Mark remaining hand cards as not playable during long-event phase
  for (const cardInstanceId of player.hand) {
    if (evaluatedInstances.has(cardInstanceId as string)) continue;
    actions.push({
      action: { type: 'not-playable', player: playerId, cardInstanceId },
      viable: false,
      reason: 'Only resource long-events can be played during the long-event phase',
    });
  }

  actions.push({ action: { type: 'pass', player: playerId }, viable: true });
  const playableCount = actions.filter(a => a.viable).length - 1; // exclude pass
  logDetail(`Long-event phase: ${playableCount} playable long-events + pass, ${actions.length - playableCount - 1} not playable`);
  return actions;
}
