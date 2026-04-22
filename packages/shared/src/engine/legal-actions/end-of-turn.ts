/**
 * @module legal-actions/end-of-turn
 *
 * Legal actions during the end-of-turn phase (CoE 2.VI).
 *
 * The phase has three steps:
 * 1. **discard** — Either player may voluntarily discard a card from hand.
 * 2. **reset-hand** — Both players draw or discard to reach base hand size (8).
 * 3. **signal-end** — Resource player signals end of turn and may call the
 *    Free Council to trigger the endgame.
 */

import type { GameState, PlayerId, GameAction, EndOfTurnPhaseState, EvaluatedAction } from '../../index.js';
import { getPlayerIndex, CardStatus } from '../../index.js';
import type { CardEffect } from '../../types/effects.js';
import { resolveHandSize } from '../effects/index.js';
import { canCallEndgameNow, isMinionOrBalrog } from '../../state-utils.js';
import { logHeading, logDetail } from './log.js';
import { deckExhaustExchangeActions } from './movement-hazard.js';
import { heroResourceShortEventActions } from './long-event.js';

/**
 * Compute legal actions for a player during the end-of-turn phase.
 *
 * During the 'discard' step, both players may discard any card from hand
 * or pass. During 'reset-hand', players with too many cards must discard
 * and players with too few draw. During 'signal-end', only the active
 * player may pass (ending the turn) or call the Free Council.
 *
 * Rule 2.1.1: the active (resource) player may also play resource
 * short-events during the voluntary `discard` and `signal-end` steps.
 * They are not offered during `reset-hand`, which is a mandatory
 * draw/discard step enforced sequentially by the reducer.
 */
export function endOfTurnActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const eotState = state.phaseState as EndOfTurnPhaseState;
  const step = eotState.step;
  logHeading(`End-of-Turn legal actions: step '${step}' for player ${playerId as string}`);

  const viable = (actions: GameAction[]): EvaluatedAction[] =>
    actions.map(action => ({ action, viable: true }));

  switch (step) {
    case 'discard': {
      const base = viable(discardStepActions(state, playerId));
      if (state.activePlayer === playerId) {
        base.push(...heroResourceShortEventActions(state, playerId, 'end-of-turn'));
      }
      return base;
    }
    case 'reset-hand':
      return viable(resetHandStepActions(state, playerId));
    case 'signal-end': {
      const base = viable(signalEndStepActions(state, playerId));
      if (state.activePlayer === playerId) {
        base.push(...heroResourceShortEventActions(state, playerId, 'end-of-turn'));
      }
      return base;
    }
    default:
      return [];
  }
}

/**
 * Step 1: Either player may discard a card from their own hand, or pass.
 * Both players pass to advance to reset-hand.
 */
function discardStepActions(state: GameState, playerId: PlayerId): GameAction[] {
  const eotState = state.phaseState as EndOfTurnPhaseState;
  const playerIndex = state.players[0].id === playerId ? 0 : 1;
  const player = state.players[playerIndex];

  // Already acted this step — no actions
  if (eotState.discardDone[playerIndex]) {
    logDetail(`End-of-Turn discard: player ${player.name} already acted, no actions`);
    return [];
  }

  const actions: GameAction[] = [];

  // Each card in hand can be discarded
  for (const card of player.hand) {
    actions.push({ type: 'discard-card', player: playerId, cardInstanceId: card.instanceId });
  }

  // Grant-action activations (e.g. Saruman's spell fetch) for the resource player
  if (state.activePlayer === playerId) {
    const grantActions = endOfTurnGrantActions(state, playerId);
    for (const ea of grantActions) {
      actions.push(ea.action);
    }
  }

  // Always offer pass
  actions.push({ type: 'pass', player: playerId });

  logDetail(`End-of-Turn discard: player ${player.name} has ${player.hand.length} cards in hand, ${actions.length - 1} discard options + pass`);
  return actions;
}

/**
 * Step 2: Both players draw or discard to reach base hand size.
 * Players above hand size must discard; players below draw; at hand size, pass.
 */
function resetHandStepActions(state: GameState, playerId: PlayerId): GameAction[] {
  const eotState = state.phaseState as EndOfTurnPhaseState;
  const playerIndex = state.players[0].id === playerId ? 0 : 1;
  const player = state.players[playerIndex];
  const handSize = resolveHandSize(state, playerIndex);
  const actions: GameAction[] = [];

  // Already done this step — no actions
  if (eotState.resetHandDone[playerIndex]) {
    logDetail(`End-of-Turn reset-hand: player ${player.name} already done, no actions`);
    return [];
  }

  // Deck exhaust exchange sub-flow: only exchange + pass actions
  if (player.deckExhaustPending) {
    return deckExhaustExchangeActions(state, player, playerId);
  }

  if (player.hand.length > handSize) {
    // Must discard down — offer each card as a discard option
    logDetail(`End-of-Turn reset-hand: player ${player.name} has ${player.hand.length} cards, must discard to ${handSize}`);
    for (const card of player.hand) {
      actions.push({ type: 'discard-card', player: playerId, cardInstanceId: card.instanceId });
    }
  } else if (player.hand.length < handSize) {
    if (player.playDeck.length === 0 && player.discardPile.length > 0) {
      // Deck empty but discard has cards — must exhaust before drawing
      logDetail(`End-of-Turn reset-hand: player ${player.name} deck empty — must exhaust`);
      actions.push({ type: 'deck-exhaust', player: playerId });
    } else if (player.playDeck.length === 0) {
      // No cards anywhere — pass
      logDetail(`End-of-Turn reset-hand: player ${player.name} has no cards to draw`);
      actions.push({ type: 'pass', player: playerId });
    } else {
      // Must draw up
      const drawCount = handSize - player.hand.length;
      logDetail(`End-of-Turn reset-hand: player ${player.name} has ${player.hand.length} cards, must draw ${drawCount} to reach ${handSize}`);
      actions.push({ type: 'draw-cards', player: playerId, count: drawCount });
    }
  } else {
    // At hand size — pass (nothing to do)
    logDetail(`End-of-Turn reset-hand: player ${player.name} already at hand size (${handSize})`);
    actions.push({ type: 'pass', player: playerId });
  }

  return actions;
}

/**
 * Step 3: Resource player signals end of turn. May also call the Free Council.
 * Only the active (resource) player has actions here.
 */
function signalEndStepActions(state: GameState, playerId: PlayerId): GameAction[] {
  if (state.activePlayer !== playerId) {
    logDetail(`End-of-Turn signal-end: not the resource player, no actions`);
    return [];
  }

  const actions: GameAction[] = [];

  // Offer call-free-council if eligible (Short game rules).
  // Per CoE rule 10.41, Ringwraith and Balrog players cannot freely call —
  // they must play Sudden Call instead.
  const playerIndex = getPlayerIndex(state, playerId);
  const player = state.players[playerIndex];
  if (!player.freeCouncilCalled && state.lastTurnFor === null) {
    if (isMinionOrBalrog(player)) {
      logDetail(`End-of-Turn signal-end: ${player.name} (${player.alignment}) cannot freely call Free Council per rule 10.41 — must play Sudden Call`);
    } else if (canCallEndgameNow(player)) {
      const mp = player.marshallingPoints;
      const rawScore = mp.character + mp.item + mp.faction + mp.ally + mp.kill + mp.misc;
      logDetail(`End-of-Turn signal-end: ${player.name} eligible to call Free Council (raw MP ${rawScore}, exhaustions ${player.deckExhaustionCount})`);
      actions.push({ type: 'call-free-council', player: playerId });
    }
  }

  actions.push({ type: 'pass', player: playerId });
  logDetail(`End-of-Turn signal-end: resource player ${playerId as string} may pass to end turn`);
  return actions;
}

/**
 * Scans the resource player's characters for grant-action effects
 * that activate during the end-of-turn phase (e.g. Saruman's spell fetch).
 *
 * Generates one action per eligible spell card in the discard pile.
 */
function endOfTurnGrantActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const playerIndex = getPlayerIndex(state, playerId);
  const player = state.players[playerIndex];
  const actions: EvaluatedAction[] = [];

  for (const [charIdStr, char] of Object.entries(player.characters)) {
    const charDef = state.cardPool[char.definitionId as string];
    if (!charDef || !('effects' in charDef)) continue;
    const effects = (charDef as { effects?: readonly CardEffect[] }).effects;
    if (!effects) continue;

    for (const effect of effects) {
      if (effect.type !== 'grant-action') continue;

      if (effect.action !== 'saruman-fetch-spell') continue;

      if (effect.cost.tap === 'self' && char.status !== CardStatus.Untapped) {
        logDetail(`Grant-action saruman-fetch-spell: ${charDef.name} is tapped, cannot activate`);
        continue;
      }

      const spellCards = player.discardPile.filter(card => {
        const def = state.cardPool[card.definitionId as string];
        return def && 'keywords' in def &&
          Array.isArray((def as { keywords?: readonly string[] }).keywords) &&
          (def as { keywords: readonly string[] }).keywords.includes('spell');
      });

      if (spellCards.length === 0) {
        logDetail(`Grant-action saruman-fetch-spell: no spell cards in discard pile`);
        continue;
      }

      const charId = charIdStr as unknown as import('../../index.js').CardInstanceId;
      for (const spell of spellCards) {
        const spellDef = state.cardPool[spell.definitionId as string];
        logDetail(`Grant-action saruman-fetch-spell available: ${charDef.name} can fetch ${spellDef?.name ?? '?'} from discard`);
        actions.push({
          action: {
            type: 'activate-granted-action',
            player: playerId,
            characterId: charId,
            sourceCardId: char.instanceId,
            sourceCardDefinitionId: char.definitionId,
            actionId: 'saruman-fetch-spell',
            rollThreshold: 0,
            targetCardId: spell.instanceId,
          },
          viable: true,
        });
      }
    }
  }

  return actions;
}
