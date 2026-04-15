/**
 * @module legal-actions/long-event
 *
 * Legal actions during the long-event phase. The resource player may play
 * resource long-events and resource short-events from hand. At entry, the
 * engine already discarded the resource player's old resource long-events;
 * on pass, hazard long-events belonging to the opponent are discarded
 * automatically.
 *
 * When a resource short-event with interactive DSL effects (e.g.
 * `fetch-to-deck`) is played, the game enters an effect resolution
 * sub-flow driven by {@link GameState.pendingEffects}, which is handled
 * at the top level of {@link computeLegalActions}.
 *
 * Returns {@link EvaluatedAction} entries so the UI can highlight playable
 * cards and show reasons for non-playable ones.
 */

import type { GameState, PlayerId, EvaluatedAction, HeroResourceEventCard, PlayTargetEffect, CardInstanceId, PlayerState } from '../../index.js';
import type { PlayOptionEffect } from '../../types/effects.js';
import { matchesCondition, CardStatus } from '../../index.js';
import { logHeading, logDetail } from './log.js';
import { getPlayTargetEffect, getPlayOptionEffects, buildPlayOptionContext, grantedActionActivations, ANY_PHASE_GRANT_ACTIONS } from './organization.js';

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

      // Skip cards that declare a play-window restricting them to a
      // different phase/step (e.g. Stealth plays only at end-of-org).
      const playWindow = def.effects?.find(e => e.type === 'play-window') as { phase?: string; step?: string } | undefined;
      if (playWindow && playWindow.phase !== 'long-event') {
        const where = `${playWindow.phase ?? '?'}${playWindow.step ? '/' + playWindow.step : ''}`;
        logDetail(`${def.name}: play-window restricts it to ${where}, not playable in long-event phase`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId },
          viable: false,
          reason: `${def.name} can only be played during ${playWindow.phase ?? 'a different phase'}${playWindow.step ? ' (' + playWindow.step + ')' : ''}`,
        });
        continue;
      }

      // Skip short events whose effects are only usable during combat
      // (e.g. Concealment's cancel-attack). These require an active attack.
      const combatOnlyTypes = new Set(['cancel-attack', 'cancel-strike', 'halve-strikes', 'dodge-strike']);
      const hasEffects = def.effects && def.effects.length > 0;
      const allCombatOnly = hasEffects && def.effects.every(e => combatOnlyTypes.has(e.type));
      if (allCombatOnly) {
        logDetail(`${def.name}: combat-only short-event, not playable outside combat`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId },
          viable: false,
          reason: `${def.name} can only be played during combat`,
        });
        continue;
      }

      // Collect eligible discard-in-play targets up front. Cards with a
      // discard-in-play effect (e.g. Marvels Told) force the discard of an
      // in-play card matching the filter — the player picks which target
      // at play time as part of the play-short-event action. If no valid
      // target exists, the card is not playable.
      const discardInPlay = def.effects?.find(e => e.type === 'discard-in-play');
      let discardTargetIds: CardInstanceId[] | null = null;
      if (discardInPlay) {
        discardTargetIds = [];
        for (const p of state.players) {
          for (const c of p.cardsInPlay) {
            const cDef = state.cardPool[c.definitionId as string];
            if (cDef && matchesCondition(discardInPlay.filter, cDef as unknown as Record<string, unknown>)) {
              discardTargetIds.push(c.instanceId);
            }
          }
        }
        if (discardTargetIds.length === 0) {
          logDetail(`${def.name}: no eligible discard-in-play target — not playable`);
          actions.push({
            action: { type: 'not-playable', player: playerId, cardInstanceId },
            viable: false,
            reason: `${def.name} has no valid target to discard`,
          });
          continue;
        }
      }

      // If the card has a play-target with a tap cost (e.g. Marvels Told taps
      // a sage), emit one action per eligible target. Otherwise emit a single
      // action with no target. When a discard-in-play target is also required,
      // emit the cross-product of sage × discard-target.
      const playTarget = getPlayTargetEffect(def);
      const emitPlay = (sageId: CardInstanceId | undefined) => {
        if (discardTargetIds) {
          for (const discardId of discardTargetIds) {
            logDetail(`Resource short-event playable (sage ${String(sageId)}, discard ${String(discardId)}): ${def.name}`);
            actions.push({
              action: {
                type: 'play-short-event',
                player: playerId,
                cardInstanceId,
                ...(sageId ? { targetScoutInstanceId: sageId } : {}),
                discardTargetInstanceId: discardId,
              },
              viable: true,
            });
          }
        } else {
          logDetail(`Resource short-event playable${sageId ? ` (target ${String(sageId)})` : ''}: ${def.name}`);
          actions.push({
            action: {
              type: 'play-short-event',
              player: playerId,
              cardInstanceId,
              ...(sageId ? { targetScoutInstanceId: sageId } : {}),
            },
            viable: true,
          });
        }
      };

      // Cards with play-option effects (e.g. Many Turns and Doublings)
      // must go through the option path even when the play-target has a
      // tap cost, so the option's `when` gate is evaluated.
      const playOptions = getPlayOptionEffects(def);
      if (playOptions.length > 0 && playTarget) {
        const optionActions = playOptionActionsForLongEvent(
          state, player, playerId, cardInstanceId, def, playTarget, playOptions,
        );
        if (optionActions.length === 0) {
          logDetail(`${def.name}: no eligible play-option targets — not playable`);
          actions.push({
            action: { type: 'not-playable', player: playerId, cardInstanceId },
            viable: false,
            reason: `${def.name} requires a matching character and condition`,
          });
        } else {
          actions.push(...optionActions);
        }
      } else if (playTarget && playTarget.cost?.tap === 'character') {
        const targets = eligibleTapTargets(state, player, playTarget);
        if (targets.length === 0) {
          logDetail(`${def.name}: no eligible targets — not playable`);
          actions.push({
            action: { type: 'not-playable', player: playerId, cardInstanceId },
            viable: false,
            reason: `No eligible ${playTarget.target} to target`,
          });
        } else {
          for (const targetId of targets) emitPlay(targetId);
        }
      } else if (playTarget && playTarget.target === 'character') {
        const optionActions = playOptionActionsForLongEvent(
          state, player, playerId, cardInstanceId, def, playTarget, getPlayOptionEffects(def),
        );
        if (optionActions.length === 0) {
          logDetail(`${def.name}: no eligible character targets — not playable`);
          actions.push({
            action: { type: 'not-playable', player: playerId, cardInstanceId },
            viable: false,
            reason: `${def.name} requires a matching character`,
          });
        } else {
          actions.push(...optionActions);
        }
      } else {
        emitPlay(undefined);
      }
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

  // Rule 2.1.1: resource player may activate any-phase grant-actions (e.g. Cram untap-bearer)
  actions.push(...grantedActionActivations(state, playerId, ANY_PHASE_GRANT_ACTIONS));

  actions.push({ action: { type: 'pass', player: playerId }, viable: true });
  const playableCount = actions.filter(a => a.viable).length - 1; // exclude pass
  logDetail(`Long-event phase: ${playableCount} playable events + pass, ${actions.length - playableCount - 1} not playable`);
  return actions;
}

/**
 * Generates `play-short-event` actions for a card with {@link PlayTargetEffect}
 * targeting characters and {@link PlayOptionEffect}s during the long-event phase.
 * One action per (target, option) pair whose `when` (if any) matches the
 * target context.
 */
function playOptionActionsForLongEvent(
  state: GameState,
  player: PlayerState,
  playerId: PlayerId,
  cardInstanceId: CardInstanceId,
  def: { name: string },
  playTarget: PlayTargetEffect,
  options: readonly PlayOptionEffect[],
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const targets = playTarget.cost?.tap === 'character'
    ? eligibleTapTargets(state, player, playTarget)
    : eligibleCharacterTargets(state, player, playTarget);
  const hasTapCost = playTarget.cost?.tap === 'character';
  for (const targetId of targets) {
    const char = player.characters[targetId as string];
    if (!char) continue;
    const ctx = buildPlayOptionContext(state, char, player);
    if (options.length === 0) {
      logDetail(`${def.name} playable on ${targetId as string} (no options)`);
      actions.push({
        action: {
          type: 'play-short-event',
          player: playerId,
          cardInstanceId,
          targetCharacterId: targetId,
          ...(hasTapCost ? { targetScoutInstanceId: targetId } : {}),
        },
        viable: true,
      });
    } else {
      for (const opt of options) {
        if (opt.when && !matchesCondition(opt.when, ctx)) continue;
        logDetail(`${def.name} playable on ${targetId as string}: option "${opt.id}"`);
        actions.push({
          action: {
            type: 'play-short-event',
            player: playerId,
            cardInstanceId,
            targetCharacterId: targetId,
            optionId: opt.id,
            ...(hasTapCost ? { targetScoutInstanceId: targetId } : {}),
          },
          viable: true,
        });
      }
    }
  }
  return actions;
}

/**
 * Returns eligible character IDs for a play-target with character filter.
 * Characters matching the DSL filter condition are eligible.
 */
function eligibleCharacterTargets(
  state: GameState,
  player: PlayerState,
  playTarget: PlayTargetEffect,
): CardInstanceId[] {
  if (playTarget.target !== 'character') return [];
  const out: CardInstanceId[] = [];
  for (const [charIdStr, char] of Object.entries(player.characters)) {
    if (playTarget.filter
        && !matchesCondition(playTarget.filter, buildPlayOptionContext(state, char, player))) {
      continue;
    }
    out.push(charIdStr as unknown as CardInstanceId);
  }
  return out;
}

/**
 * Returns eligible target character IDs for a play-target with tap cost.
 * Only untapped characters matching the filter are eligible.
 */
function eligibleTapTargets(
  state: GameState,
  player: { characters: Record<string, import('../../index.js').CharacterInPlay> },
  playTarget: PlayTargetEffect,
): CardInstanceId[] {
  if (playTarget.target !== 'character') return [];
  const out: CardInstanceId[] = [];
  for (const [charIdStr, char] of Object.entries(player.characters)) {
    if (char.status !== CardStatus.Untapped) continue;
    if (playTarget.filter
        && !matchesCondition(playTarget.filter, buildPlayOptionContext(state, char, player as PlayerState))) {
      continue;
    }
    out.push(charIdStr as unknown as CardInstanceId);
  }
  return out;
}
