/**
 * @module legal-actions/organization-events
 *
 * Event card play actions during the organization phase. Evaluates permanent
 * resource events (played directly to the table) and short events with
 * special play-as-resource effects (e.g. Twilight cancelling environments).
 */

import type {
  GameState,
  PlayerId,
  EvaluatedAction,
  CardInstanceId,
  HeroResourceEventCard,
  HazardEventCard,
} from '../../index.js';
import { hasPlayFlag } from '../../index.js';
import { logDetail } from './log.js';

/**
 * Evaluates permanent-event resource cards in hand for play during organization.
 * Permanent resource events can be played directly to the table without a site.
 * Unique permanent events cannot be played if one with the same name is already in play.
 */
export function playPermanentEventActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = state.players.find(p => p.id === playerId)!;
  const actions: EvaluatedAction[] = [];

  for (const handCard of player.hand) {
    const cardInstanceId = handCard.instanceId;
    const def = state.cardPool[handCard.definitionId as string] as HeroResourceEventCard | undefined;
    if (!def || def.cardType !== 'hero-resource-event' || def.eventType !== 'permanent') continue;

    // Check uniqueness: unique permanent events can't be played if already in play
    if (def.unique) {
      const alreadyInPlay = state.players.some(p =>
        p.cardsInPlay.some(c => {
          const cDef = state.cardPool[c.definitionId as string];
          return cDef && cDef.name === def.name;
        }),
      );
      if (alreadyInPlay) {
        logDetail(`Permanent event ${def.name}: unique and already in play`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId },
          viable: false,
          reason: `${def.name} is unique and already in play`,
        });
        continue;
      }
    }

    // Check duplication-limit with scope "game": cannot play if a copy is already in play
    const dupLimit = def.effects?.find((e): e is import('../../index.js').DuplicationLimitEffect => {
      if (e.type !== 'duplication-limit') return false;
      return e.scope === 'game';
    });
    if (dupLimit) {
      const copiesInPlay = state.players.reduce((count, p) =>
        count + p.cardsInPlay.filter(c => {
          const cDef = state.cardPool[c.definitionId as string];
          return cDef && cDef.name === def.name;
        }).length, 0,
      );
      if (copiesInPlay >= dupLimit.max) {
        logDetail(`Permanent event ${def.name}: cannot be duplicated (${copiesInPlay}/${dupLimit.max} in play)`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId },
          viable: false,
          reason: `${def.name} cannot be duplicated`,
        });
        continue;
      }
    }

    logDetail(`Permanent event ${def.name}: playable`);
    actions.push({
      action: { type: 'play-permanent-event', player: playerId, cardInstanceId },
      viable: true,
    });
  }

  return actions;
}

/**
 * Evaluates short-event cards with `playable-as-resource` in hand (e.g. Twilight).
 * These cancel and discard an environment card in play. One action is offered per
 * valid (card, target) pair. If no environment is in play the card is not playable.
 */
export function playShortEventActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = state.players.find(p => p.id === playerId)!;
  const actions: EvaluatedAction[] = [];

  for (const handCard of player.hand) {
    const cardInstanceId = handCard.instanceId;
    const def = state.cardPool[handCard.definitionId as string] as HazardEventCard | undefined;
    if (!def || def.cardType !== 'hazard-event' || def.eventType !== 'short') continue;

    // Only cards with the playable-as-resource flag
    if (!hasPlayFlag(def, 'playable-as-resource')) continue;

    // Find environment cards — in a player's cardsInPlay (permanent events
    // like Doors of Night / Gates of Morning), or declared earlier in the
    // same chain of effects.
    const isEnv = (defId: string): boolean => {
      const d = state.cardPool[defId];
      return !!d && 'keywords' in d
        && !!(d as { keywords?: readonly string[] }).keywords?.includes('environment');
    };
    const envTargets: { instanceId: CardInstanceId; definitionId: string }[] = [];
    for (const p of state.players) {
      for (const c of p.cardsInPlay) {
        if (isEnv(c.definitionId as string)) envTargets.push(c);
      }
    }
    // Chain entries: environments declared earlier in the same chain
    if (state.chain) {
      for (const entry of state.chain.entries) {
        if (entry.resolved || entry.negated) continue;
        if (!entry.card) continue;
        if (isEnv(entry.card.definitionId as string)) {
          envTargets.push({ instanceId: entry.card.instanceId, definitionId: entry.card.definitionId as string });
        }
      }
    }

    if (envTargets.length === 0) {
      logDetail(`Short event ${def.name}: no environment in play to cancel`);
      actions.push({
        action: { type: 'not-playable', player: playerId, cardInstanceId },
        viable: false,
        reason: 'No environment to cancel',
      });
      continue;
    }

    for (const target of envTargets) {
      const targetDef = state.cardPool[target.definitionId];
      logDetail(`Short event ${def.name}: can cancel environment ${targetDef?.name ?? target.definitionId}`);
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
