/**
 * @module engine/event-maintenance
 *
 * The `event-maintenance` upkeep subsystem: an in-play event whose controller
 * must pay every turn to keep it on the table, and — optionally — a bidding war
 * in which the opponent may pay to remove it.
 *
 * Two cards drive the design:
 *
 * - *Thrice Outnumbered* (le-142), a hazard permanent-event: "Discard this card
 *   or a Man hazard creature from your hand at the end of opponent's long-event
 *   phase." Upkeep only, one card, no contest.
 * - *Balance Between Powers* (dm-118), a hero resource permanent-event: "At the
 *   start of your organization phase, discard this card **or** keep it in play
 *   by discarding an environment card from your hand. Your opponent can then
 *   discard an environment card from his hand to discard this card, which you
 *   can counter by discarding two environment cards from your hand, which he
 *   can counter by discarding one, which you can counter with two, he with one,
 *   etc."
 *
 * The whole exchange runs as a sequence of `event-maintenance` pending
 * resolutions, one per *stage*, alternating actors:
 *
 * ```text
 *   upkeep (controller, 1 card)
 *     ├─ discard-self ─────────────────────────────► source discarded, done
 *     └─ pays ──► challenge (opponent, challengeCount)
 *                   ├─ decline ─────────────────────► source stays, done
 *                   └─ pays ──► counter (controller, counterCount)
 *                                 ├─ decline ───────► source discarded, done
 *                                 └─ pays ──► challenge (opponent) …
 * ```
 *
 * A stage is only enqueued when its actor actually holds enough matching hand
 * cards to finish it; if they cannot, the stage is skipped and its "declined"
 * outcome applied immediately. That keeps the engine from prompting a player
 * for a decision they have no way to make, and guarantees a part-paid stage can
 * always be completed (payments are one card per action).
 */

import type { CardDefinitionId, CardInstanceId, GameState, PendingResolution, PlayerId } from '../index.js';
import type { Condition, EventMaintenanceEffect } from '../types/effects.js';
import { getPlayerIndex } from '../state-utils.js';
import { cardName, defById, findEventMaintenanceEffect, matchesDefinition, toCardInstance, updatePlayer } from './reducer-utils.js';
import { logDetail } from './legal-actions/log.js';
import { enqueueResolution } from './pending.js';

/** The stages of one maintenance exchange, in the order they can occur. */
export type EventMaintenanceStage = 'upkeep' | 'challenge' | 'counter';

/**
 * Instance IDs of the given player's hand cards whose definitions satisfy
 * `filter` — the cards they may spend on a maintenance payment.
 */
export function matchingMaintenanceHandCards(
  state: GameState,
  playerIndex: number,
  filter: Condition,
): readonly CardInstanceId[] {
  const player = state.players[playerIndex];
  if (!player) return [];
  return player.hand
    .filter(c => {
      const def = defById(state, c.definitionId);
      return def !== undefined && def !== null && matchesDefinition(def, filter);
    })
    .map(c => c.instanceId);
}

/**
 * Cost in matching hand cards of the given stage. The controller's opening
 * upkeep is always a single card ("keep it in play by discarding an environment
 * card"); the contested stages read their size off the effect's `counterChain`.
 */
export function maintenanceStageCount(
  effect: EventMaintenanceEffect,
  stage: EventMaintenanceStage,
): number {
  if (stage === 'upkeep') return 1;
  if (!effect.counterChain) return 0;
  return stage === 'challenge' ? effect.counterChain.challengeCount : effect.counterChain.counterCount;
}

/**
 * Enqueue the opening `upkeep` stage for one in-play event, making its
 * controller choose between discarding the card and paying to keep it.
 * Called from each trigger site (`opponent-long-event-end` at the long-event
 * exit, `controller-organization-phase-start` at the untap → organization
 * transition).
 */
export function enqueueMaintenanceUpkeep(
  state: GameState,
  opts: {
    readonly controllerId: PlayerId;
    readonly sourceInstanceId: CardInstanceId;
    readonly sourceDefinitionId: CardDefinitionId;
    readonly scope: PendingResolution['scope'];
  },
): GameState {
  logDetail(
    `event-maintenance: queuing upkeep for "${cardName(state, opts.sourceDefinitionId)}" `
    + `(${opts.sourceInstanceId as string}), controller ${opts.controllerId as string}`,
  );
  return enqueueResolution(state, {
    source: opts.sourceInstanceId,
    actor: opts.controllerId,
    scope: opts.scope,
    kind: {
      type: 'event-maintenance',
      sourceInstanceId: opts.sourceInstanceId,
      sourceDefinitionId: opts.sourceDefinitionId,
      stage: 'upkeep',
      remainingToPay: 1,
      stageCount: 1,
      controllerId: opts.controllerId,
    },
  });
}

/**
 * Discard the maintained event from its controller's `cardsInPlay` to their
 * discard pile. Used when the controller pays nothing at `upkeep`, when they
 * decline to `counter` a challenge, and when they cannot afford to counter.
 */
export function discardMaintainedEvent(
  state: GameState,
  controllerId: PlayerId,
  sourceInstanceId: CardInstanceId,
): GameState {
  const controllerIdx = getPlayerIndex(state, controllerId);
  if (controllerIdx < 0) return state;
  const card = state.players[controllerIdx].cardsInPlay.find(c => c.instanceId === sourceInstanceId);
  if (!card) {
    logDetail(`event-maintenance: source ${sourceInstanceId as string} already gone from play — nothing to discard`);
    return state;
  }
  logDetail(`event-maintenance: discarding "${cardName(state, card.definitionId)}" from play`);
  return updatePlayer(state, controllerIdx, p => ({
    ...p,
    cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== sourceInstanceId),
    discardPile: [...p.discardPile, toCardInstance(card)],
  }));
}

/**
 * Hand the bidding war to the other side after a stage has been paid in full.
 *
 * - after `upkeep` or `counter` (the controller kept/saved the card) the
 *   opponent may `challenge`;
 * - after `challenge` (the opponent bid to kill it) the controller may
 *   `counter`.
 *
 * When the next actor cannot afford the stage — or the effect declares no
 * `counterChain` at all — the exchange ends here: a `challenge` that cannot be
 * mounted leaves the card in play, a `counter` that cannot be paid discards it.
 */
export function advanceMaintenanceChain(
  state: GameState,
  top: PendingResolution,
  paidStage: EventMaintenanceStage,
): GameState {
  if (top.kind.type !== 'event-maintenance') return state;
  const { sourceInstanceId, sourceDefinitionId, controllerId } = top.kind;

  const effect = findEventMaintenanceEffect(defById(state, sourceDefinitionId));
  if (!effect?.counterChain) {
    logDetail(`event-maintenance: "${cardName(state, sourceDefinitionId)}" has no counter chain — exchange over`);
    return state;
  }

  const nextStage: EventMaintenanceStage = paidStage === 'challenge' ? 'counter' : 'challenge';
  const controllerIdx = getPlayerIndex(state, controllerId);
  const opponentIdx = controllerIdx === 0 ? 1 : 0;
  const actorIdx = nextStage === 'counter' ? controllerIdx : opponentIdx;
  const actorId = state.players[actorIdx].id;
  const stageCount = maintenanceStageCount(effect, nextStage);

  const affordable = matchingMaintenanceHandCards(state, actorIdx, effect.handCardFilter).length;
  if (affordable < stageCount) {
    if (nextStage === 'counter') {
      logDetail(
        `event-maintenance: controller ${actorId as string} holds ${affordable} matching card(s), `
        + `needs ${stageCount} to counter — "${cardName(state, sourceDefinitionId)}" is discarded`,
      );
      return discardMaintainedEvent(state, controllerId, sourceInstanceId);
    }
    logDetail(
      `event-maintenance: opponent ${actorId as string} holds ${affordable} matching card(s), `
      + `needs ${stageCount} to challenge — "${cardName(state, sourceDefinitionId)}" stays in play`,
    );
    return state;
  }

  logDetail(
    `event-maintenance: offering ${nextStage} (${stageCount} card(s)) to ${actorId as string} `
    + `over "${cardName(state, sourceDefinitionId)}"`,
  );
  return enqueueResolution(state, {
    source: sourceInstanceId,
    actor: actorId,
    scope: top.scope,
    kind: {
      type: 'event-maintenance',
      sourceInstanceId,
      sourceDefinitionId,
      stage: nextStage,
      remainingToPay: stageCount,
      stageCount,
      controllerId,
    },
  });
}
