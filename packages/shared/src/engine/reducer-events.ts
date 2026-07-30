/**
 * @module reducer-events
 *
 * Event card handlers for the game reducer. Covers playing permanent events,
 * short events, long events, and resource short events. These handlers are
 * shared across multiple phases (organization, long-event, movement/hazard).
 */

import type { GameState, CardInstance, CardInstanceId, ChainEntryPayload, PendingEffect, GameAction } from '../index.js';
import { parseConstraintScope } from './constraint-kind.js';
import { enterMovementHazardPhase } from './mh-phase-state.js';
import { getPlayerIndex } from '../state-utils.js';
import { CardStatus, cardStatusFromName, Race } from '../types/common.js';
import { Phase } from '../types/state-phases.js';
import { logDetail, logHeading } from './legal-actions/log.js';
import { oneRingWin } from './reducer-free-council.js';
import { initiateOrPushChain } from './chain-reducer.js';
import { ownerOf, resolveInstanceId } from '../types/state.js';
import { resolveDef, getEffectiveSkills } from './effects/index.js';
import { revealInstances } from './visibility.js';
import type { ReducerResult } from './reducer-utils.js';
import { makeCombatState, clearPlannedMovement, companyById, deckSearchCancellerFor, companySiteName, companySubphaseScope, defById, diceRollEffect, discardOrRecyclePlayedEvent, findById, findCharacterCompany, findDuplicationLimitEffect, gateDeckSearchFetch, getCardEffects, getOnEventEffects, matchesDefinition, removeAttachment, removeById, roll2d6, toCardInstance, updateCharacter, updatePlayer, wrongActionType } from './reducer-utils.js';
import { triggerCouncilCall } from './reducer-end-of-turn.js';
import { addRemovalProtection } from './removal-protection.js';
import { addConstraint, enqueueCorruptionCheck, enqueueResolution, sweepExpired } from './pending.js';
import { enqueueMaintenanceUpkeep } from './event-maintenance.js';
import type { RingTestTableEffect, RingCategory } from '../types/effects.js';
import { applyMove, findMoveEffectByShape, moveToFetchToDeckPayload } from './reducer-move.js';
import { shuffle } from '../rng.js';
import { matchesCondition } from '../effects/condition-matcher.js';
import { handleGrantActionApply } from './grant-action-apply.js';
import { isCharacterCard, isItemCard, isAllyCard, isResourceEventCard } from '../types/cards.js';
import { allyEffectiveBody } from './ally-stats.js';
import type { CardDefinition } from '../types/cards.js';
import { evaluateExpr } from './effects/expression-eval.js';
import { applyCost } from './cost-evaluator.js';
import { buildInPlayNames } from './recompute-derived.js';
import { hazardLongEventsRetained } from './retain-hazard-long-events.js';
import { cvccSides } from './cvcc-sides.js';


/**
 * Handle playing a permanent-event resource card.
 * Removes the card from hand, places it on the chain, and initiates/pushes
 * a chain of effects. The card enters play upon resolution (see chain-reducer).
 */
export function handlePlayPermanentEvent(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'play-permanent-event') return wrongActionType(state, action, 'play-permanent-event');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const handCard = findById(player.hand, action.cardInstanceId);
  if (!handCard) return { state, error: 'Card not found in hand' };
  const def = state.cardPool[handCard.definitionId] as import('../types/cards-resources.js').HeroResourceEventCard;

  logDetail(`Playing permanent event: ${def.name} → enters chain`);

  // Remove card from hand — it now resides on the chain
  const newHand = removeById(player.hand, handCard.instanceId);
  let newState: GameState = updatePlayer(state, playerIndex, p => ({ ...p, hand: newHand }));

  // Discard a card as a play cost (e.g. Sapling of the White Tree for The White Tree)
  if (action.discardCardInstanceId) {
    logDetail(`Discarding ${action.discardCardInstanceId as string} as play cost for ${def.name}`);
    // Check character items
    const removed = removeAttachment(newState.players[playerIndex], 'items', action.discardCardInstanceId);
    if (removed) {
      newState = updatePlayer(newState, playerIndex, () => ({
        ...removed.player,
        discardPile: [...removed.player.discardPile, toCardInstance(removed.attachment)],
      }));
      logDetail(`Discarded item ${removed.attachment.definitionId as string} from character ${removed.charId as string}`);
    } else {
      // Check the marshalling point pile (killPile), where successfully stored
      // items are placed per CoE rule 2.II.4.1 (e.g. a Sapling of the White
      // Tree stored at Minas Tirith).
      const killIdx = newState.players[playerIndex].killPile.findIndex(
        c => c.instanceId === action.discardCardInstanceId,
      );
      if (killIdx !== -1) {
        const card = newState.players[playerIndex].killPile[killIdx];
        const newKill = [...newState.players[playerIndex].killPile];
        newKill.splice(killIdx, 1);
        newState = updatePlayer(newState, playerIndex, p => ({
          ...p,
          killPile: newKill,
          discardPile: [...p.discardPile, toCardInstance(card)],
        }));
        logDetail(`Discarded stored card ${card.definitionId as string} from marshalling point pile`);
      }
    }
  }

  // Initiate or push onto chain — card enters play upon resolution.
  // Forward targetCharacterId / targetSiteDefinitionId / targetCompanyId (if any)
  // through the payload so that the chain resolver can set the correct binding
  // on the resulting CardInPlay entry.
  const payload: import('../index.js').ChainEntryPayload = {
    type: 'permanent-event',
    ...(action.targetCharacterId ? { targetCharacterId: action.targetCharacterId } : {}),
    ...(action.targetSiteDefinitionId ? { targetSiteDefinitionId: action.targetSiteDefinitionId } : {}),
    ...(action.targetCompanyId ? { targetCompanyId: action.targetCompanyId } : {}),
    ...(action.targetItemInstanceId ? { targetItemInstanceId: action.targetItemInstanceId } : {}),
    ...(action.targetFactionInstanceId ? { targetFactionInstanceId: action.targetFactionInstanceId } : {}),
    ...(action.targetLongEventInstanceId ? { targetLongEventInstanceId: action.targetLongEventInstanceId } : {}),
    ...(action.besiegedSiteInstanceId ? { besiegedSiteInstanceId: action.besiegedSiteInstanceId } : {}),
    ...(action.companionCardInstanceId ? { companionCardInstanceId: action.companionCardInstanceId } : {}),
    ...(action.storeItemInstanceId ? { storeItemInstanceId: action.storeItemInstanceId } : {}),
    ...(action.storeCharacterId ? { storeCharacterId: action.storeCharacterId } : {}),
    ...(action.opposedCharacterId ? { opposedCharacterId: action.opposedCharacterId } : {}),
  };
  newState = initiateOrPushChain(newState, action.player, handCard, payload);

  return { state: newState };
}

/**
 * Handle playing a short-event as a resource (e.g. Twilight).
 * Moves the short event from hand to discard and initiates (or pushes onto)
 * a chain of effects. The target environment remains in play until the chain
 * entry resolves — giving both players a chance to respond.
 */
export function handlePlayShortEvent(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'play-short-event') return wrongActionType(state, action, 'play-short-event');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const handCard = findById(player.hand, action.cardInstanceId);
  if (!handCard) return { state, error: 'Card not found in hand' };
  const def = state.cardPool[handCard.definitionId] as import('../types/cards-hazards.js').HazardEventCard;

  // Tookish Blood (tw-104) resource mode: "For the rest of the turn, the target
  // Hobbit cannot be discarded or returned to its owner's hand for any reason."
  // A `playable-as-resource` hazard-event carrying a `protect-from-removal`
  // effect and a chosen own-character target installs a turn-scoped removal
  // protection and discards the spent card. (The card's hazard mode is a
  // separate `play-hazard` path via `call-of-home-check`.)
  const protectEffect = getCardEffects(def).find(
    (e): e is import('../types/effects.js').ProtectFromRemovalEffect => e.type === 'protect-from-removal',
  );
  if (protectEffect && action.targetCharacterId) {
    const targetChar = player.characters[action.targetCharacterId];
    if (!targetChar) return { state, error: `${def.name}: target character not found` };
    logDetail(`${def.name}: protecting ${action.targetCharacterId as string} from discard/return-to-hand for the rest of the turn`);
    state = revealInstances(state, [handCard]);
    let afterProtect = updatePlayer(state, playerIndex, p => ({
      ...p,
      hand: removeById(p.hand, handCard.instanceId),
      discardPile: [...p.discardPile, handCard],
    }));
    afterProtect = addRemovalProtection(afterProtect, action.targetCharacterId, handCard.instanceId, handCard.definitionId);
    return { state: afterProtect };
  }

  const targetDef = resolveDef(state, action.targetInstanceId!);
  logDetail(`Playing short event ${def.name}: targeting environment ${targetDef?.name ?? action.targetInstanceId} (chain will resolve the cancel)`);

  // Move short event from hand → discard
  const newHand = removeById(player.hand, handCard.instanceId);

  let newState: GameState = updatePlayer(state, playerIndex, p => ({
    ...p,
    hand: newHand,
    discardPile: [...p.discardPile, handCard],
  }));

  // Initiate chain or push onto existing chain — target stored in payload
  const payload: ChainEntryPayload = { type: 'short-event', targetInstanceId: action.targetInstanceId };
  newState = initiateOrPushChain(newState, action.player, handCard, payload);

  return { state: newState };
}

/**
 * Handle actions during the long-event phase.
 *
 * The resource player may play resource long-events and short-events from
 * hand. On pass, the hazard player's hazard long-events are discarded and
 * the phase advances. Resource short events with fetch-to-deck effects
 * enter a sub-flow for card selection.
 */
export function handleLongEvent(state: GameState, action: GameAction): ReducerResult {
  if (action.type === 'play-long-event') {
    return handlePlayLongEvent(state, action);
  }
  if (action.type === 'play-short-event') {
    return handlePlayResourceShortEvent(state, action);
  }
  // Rule 2.1.1: any-phase grant-actions (Cram, Orc-draughts). The
  // legal-action emitter filters to `anyPhase: true` effects during
  // long-event phase, so we delegate unconditionally.
  if (action.type === 'activate-granted-action') {
    return handleGrantActionApply(state, action);
  }
  if (action.type === 'pass') {
    // [2.III.3] At end of long-event phase: hazard player discards own hazard long-events
    const activePlayer = state.activePlayer!;
    const hazardPlayerIndex = (getPlayerIndex(state, activePlayer) + 1) % state.players.length;
    const hazardPlayer = state.players[hazardPlayerIndex];
    // The Will of Sauron (tw-100): while a `retain-hazard-long-events` card is
    // in play, hazard long-events survive this sweep and accumulate; they are
    // discarded en masse when that card leaves play instead.
    const retained = hazardLongEventsRetained(state);
    if (retained) {
      logDetail('Long-event exit: hazard long-events retained in play by a retain-hazard-long-events card');
    }
    const discardedEvents: CardInstance[] = [];
    const remainingCards = hazardPlayer.cardsInPlay.filter(card => {
      const def = defById(state, card.definitionId);
      if (!retained && def && def.cardType === 'hazard-event' && def.eventType === 'long') {
        logDetail(`Long-event exit: discarding hazard long-event "${def.name}" (${card.instanceId as string})`);
        discardedEvents.push(toCardInstance(card));
        return false;
      }
      return true;
    });

    let afterPass = updatePlayer(state, hazardPlayerIndex, p => ({
      ...p,
      cardsInPlay: remainingCards,
      discardPile: [...p.discardPile, ...discardedEvents],
    }));

    // [2.III.3] boundary: a long-event whose *effect* outlives its card
    // (Witch-king of Angmar tw-113 — discarded the moment his long-event
    // resolves, so the card sweep above can never reach it) records its
    // duration as a `next-long-event-phase` constraint instead. Sweep it here,
    // at the same moment the hazard player's long-event cards would go.
    afterPass = sweepExpired(afterPass, {
      kind: 'long-event-phase-end',
      hazardPlayerId: hazardPlayer.id,
      turnNumber: state.turnNumber,
    });

    // Check for event-maintenance effects in remaining cardsInPlay.
    // Fire once per permanent hazard event that has an event-maintenance effect
    // with trigger: 'opponent-long-event-end'. The hazard player (non-active)
    // must pay the maintenance cost (discard self or matching hand card).
    for (const card of afterPass.players[hazardPlayerIndex].cardsInPlay) {
      const def = defById(afterPass, card.definitionId);
      if (!def) continue;
      for (const effect of getCardEffects(def)) {
        if (effect.type !== 'event-maintenance') continue;
        if (effect.trigger !== 'opponent-long-event-end') continue;
        logDetail(`Long-event exit: queuing event-maintenance for "${def.name}" (${card.instanceId as string})`);
        afterPass = enqueueMaintenanceUpkeep(afterPass, {
          controllerId: afterPass.players[hazardPlayerIndex].id,
          sourceInstanceId: card.instanceId,
          sourceDefinitionId: card.definitionId,
          scope: { kind: 'phase', phase: Phase.LongEvent },
        });
      }
    }

    // Reset moved flags on the active player's companies for the new M/H phase.
    // `specialMovement` and `extraRegionDistance` must survive this transition:
    // they are granted during this turn's organization phase (Gwaihir, Cram) and
    // consumed by the upcoming M/H phase — rule 2.II.7.ii anchors path legality
    // at organization-phase declaration time. They are cleared after movement
    // resolves, at the M/H → Site transition.
    const activeIndex = getPlayerIndex(state, activePlayer);
    afterPass = updatePlayer(afterPass, activeIndex, p => ({
      ...p,
      companies: p.companies.map(c => ({ ...c, moved: false })),
    }));

    // Rule 5.28: if the resource player has no companies, skip the M/H phase entirely
    if (afterPass.players[activeIndex].companies.length === 0) {
      logDetail(`Long-event: active player ${activePlayer as string} has no companies → skipping M/H phase (rule 5.28) and Site phase (rule 6.17), advancing to End-of-Turn`);
      return {
        state: {
          ...afterPass,
          phaseState: { phase: Phase.EndOfTurn, step: 'discard' as const, discardDone: [false, false] as const, resetHandDone: [false, false] as const },
        },
      };
    }

    logDetail(`Long-event: active player ${action.player as string} passed → advancing to Movement/Hazard phase`);
    return {
      state: {
        ...afterPass,
        phaseState: enterMovementHazardPhase(),
      },
    };
  }
  return { state, error: `Unexpected action '${action.type}' in long-event phase` };
}

/**
 * Resolve The Ring Leaves Its Mark (le-223) mode 2: "playable on your tapped
 * Ringwraith. Make a roll—if the result is greater than 6, untap your
 * Ringwraith." Rolls 2d6 (honouring `cheatRollTotal` for deterministic tests);
 * on a total at or above the apply's `threshold` (7) the `onSuccess` branch —
 * a `set-character-status untapped` on the targeted character — is applied.
 * The event card is then discarded to its owner's discard pile. Generic in the
 * `roll-then-apply`/`set-character-status` shape so any future "roll to change a
 * targeted character's status" short event can reuse it.
 */
function resolveShortEventRollUntap(
  state: GameState,
  targetId: CardInstanceId,
  def: CardDefinition,
  handCard: CardInstance,
  playerIndex: number,
  newHand: readonly CardInstance[],
  apply: import('../types/effects.js').RollThenApplyAction,
): ReducerResult {
  const player = state.players[playerIndex];
  const targetChar = player.characters[targetId];
  if (!targetChar) return { state, error: `${def.name}: target character ${targetId as string} not found` };

  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const total = roll.die1 + roll.die2;
  const targetDef = defById(state, targetChar.definitionId);
  const targetName = targetDef?.name ?? String(targetId);
  const success = total >= apply.threshold;
  logDetail(`${def.name}: ${player.name} rolls ${roll.die1} + ${roll.die2} = ${total} vs threshold ${apply.threshold} — ${success ? 'success' : 'failure'} (untap ${targetName})`);
  const rollEffect = diceRollEffect(player.name, roll, `${def.name}: untap ${targetName}`);

  let newCharacters = player.characters;
  const branch = success ? apply.onSuccess : apply.onFailure;
  if (branch && branch.type === 'set-character-status' && branch.status !== undefined) {
    const statusEnum = cardStatusFromName(branch.status);
    logDetail(`${def.name}: ${targetName} → status ${branch.status}`);
    newCharacters = { ...newCharacters, [targetId as string]: { ...targetChar, status: statusEnum } };
  }

  const finalState = updatePlayer({ ...state, rng, cheatRollTotal }, playerIndex, p => ({
    ...p,
    hand: newHand,
    characters: newCharacters,
    discardPile: [...p.discardPile, handCard],
  }));
  return { state: finalState, effects: [rollEffect] };
}

/**
 * Handle playing a resource short-event card during the long-event phase.
 *
 * Removes the card from hand, discards it, and if it has a `fetch-to-deck`
 * effect, sets up the pendingFetch sub-flow on the phase state.
 */
/**
 * Dispatch a `play-short-event` by the card's actual type: resource events
 * resolve through the resource flow, everything else (hazard events, chain
 * responses) through the chain/hazard flow. Used by phase reducers as the
 * shared fallback so a short event advertised as legal in ANY step (chains
 * and pending resolutions open response windows everywhere) is never
 * rejected by a rigid step handler.
 */
export function dispatchShortEventByCardType(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'play-short-event') return wrongActionType(state, action, 'play-short-event');
  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const card = action.cardInstanceId ? findById(player.hand, action.cardInstanceId) : undefined;
  const def = card ? state.cardPool[card.definitionId] : undefined;
  return isResourceEventCard(def)
    ? handlePlayResourceShortEvent(state, action)
    : handlePlayShortEvent(state, action);
}

export function handlePlayResourceShortEvent(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'play-short-event') return wrongActionType(state, action, 'play-short-event');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const handCard = findById(player.hand, action.cardInstanceId);
  if (!handCard) return { state, error: 'Card not found in hand' };
  const def = state.cardPool[handCard.definitionId] as import('../types/cards-resources.js').HeroResourceEventCard;

  logDetail(`Playing resource short-event: ${def.name} (${action.cardInstanceId as string})`);

  // Dark Tryst (as-80) and any other draw-cards short event: per CoE 9.4/9.5
  // a short event is an action that must be declared on the chain of effects
  // so the opponent has a chance to respond before it resolves. Place the
  // card on the chain (it leaves the hand and rides on the chain entry until
  // the chain resolves, where the draw + removal is applied — see
  // `resolveEntry` in chain-reducer). This mirrors the resource permanent-event
  // and hazard short-event flows, which also route through the chain rather
  // than resolving inline.
  const drawCardsEffect = def.effects?.find(
    (e): e is import('../types/effects.js').DrawCardsEffect => e.type === 'draw-cards',
  );
  if (drawCardsEffect) {
    const revealed = revealInstances(state, [handCard]);
    const afterReveal = updatePlayer(revealed, playerIndex, p => ({
      ...p,
      hand: removeById(p.hand, handCard.instanceId),
    }));
    logDetail(`${def.name} → chain of effects (draw resolves on chain resolution)`);
    const payload: ChainEntryPayload = { type: 'short-event' };
    const chained = initiateOrPushChain(afterReveal, action.player, handCard, payload);
    return { state: chained };
  }

  // Pure fetch-to-deck short event (e.g. Smoke Rings dm-159, Weigh All Things
  // to a Nicety le-253): a resource short event whose only effect is bringing a
  // card from the sideboard/discard into the play deck. Like draw-cards above,
  // CRF 22 errata the "immediately" wording out of Smoke Rings precisely because
  // the play must be declared on the chain of effects so the opponent has a
  // chance to respond before the retrieval resolves. The card leaves the hand
  // and rides on the chain entry; on resolution `queueFetchToDecEffects`
  // (chain-reducer) places it into cardsInPlay and queues the interactive fetch
  // sub-flow. We only take this path for self-contained fetches — cards that
  // also tap a character, choose a play-option, or discard a target in play
  // (Vilya, etc.) keep their inline play-time handling below.
  const allEffectsAreFetch = (def.effects ?? []).length > 0
    && (def.effects ?? []).every(e => e.type === 'move' && !!moveToFetchToDeckPayload(e));
  const hasActionTarget = !!(
    action.targetCharacterId
    || action.targetScoutInstanceId
    || action.optionId
    || action.discardTargetInstanceId
  );
  if (allEffectsAreFetch && !hasActionTarget) {
    const revealed = revealInstances(state, [handCard]);
    const afterReveal = updatePlayer(revealed, playerIndex, p => ({
      ...p,
      hand: removeById(p.hand, handCard.instanceId),
    }));
    logDetail(`${def.name} → chain of effects (fetch resolves on chain resolution)`);
    const payload: ChainEntryPayload = { type: 'short-event' };
    const chained = initiateOrPushChain(afterReveal, action.player, handCard, payload);
    return { state: chained };
  }

  // Influence-check-boost short events (e.g. Tempering Friendship tw-337,
  // Muster tw-288, A Friend or Three tw-189, Gifts as Given of Old le-188):
  // a `play-option` whose `apply` adds a `check-modifier` for the influence
  // check must be declared on the chain of effects (CoE 9.4/9.5) — like every
  // other short event — so the opponent gets a chance to respond before the
  // boost, and the influence roll it feeds, resolves. Historically this option
  // was applied inline (constraint added immediately, card discarded, no chain
  // entry), which silently skipped the opponent's response window. Route it
  // through the chain instead: the card rides the chain entry (carrying the
  // chosen target character and option id), and `resolveEntry` applies the
  // constraint + discards the spent card once both players pass priority.
  const influenceBoostOption = action.optionId
    ? (def.effects?.find(
        e => e.type === 'play-option' && e.id === action.optionId,
      ) as import('../types/effects.js').PlayOptionEffect | undefined)
    : undefined;
  if (
    influenceBoostOption
    && action.targetCharacterId
    && influenceBoostOption.apply.type === 'add-constraint'
    && influenceBoostOption.apply.constraint === 'check-modifier'
    && influenceBoostOption.apply.check === 'influence'
  ) {
    const revealed = revealInstances(state, [handCard]);
    const afterReveal = updatePlayer(revealed, playerIndex, p => ({
      ...p,
      hand: removeById(p.hand, handCard.instanceId),
    }));
    logDetail(`${def.name} → chain of effects (influence boost resolves on chain resolution)`);
    const payload: ChainEntryPayload = {
      type: 'short-event',
      targetCharacterId: action.targetCharacterId,
      optionId: action.optionId,
    };
    const chained = initiateOrPushChain(afterReveal, action.player, handCard, payload);
    return { state: chained };
  }

  // Resource short events skip the chain today — the played card goes
  // straight to the owner's face-down discard pile (see TODO in
  // `visibility.ts`). Announce the identity explicitly so the opponent
  // toast can name the card even though no public pile ever held it.
  state = revealInstances(state, [handCard]);

  const newHand = removeById(player.hand, handCard.instanceId);

  // The Ring Leaves Its Mark (le-223) mode 2: "playable on your tapped
  // Ringwraith. Make a roll—if the result is greater than 6, untap your
  // Ringwraith." The legal-action emitter targets the player's own tapped
  // revealed Ringwraith avatar via `targetCharacterId`; a self-enters-play
  // `roll-then-apply` carries the threshold (7 = "greater than 6") and the
  // untap (`set-character-status untapped`) branch. Mode 1 (the fetch) has no
  // `targetCharacterId` and falls through to the generic resolution below.
  const rollUntapOnEnter = action.type === 'play-short-event' && action.targetCharacterId
    ? getOnEventEffects(def, 'self-enters-play').find(
        (e): e is import('../types/effects.js').OnEventEffect & { apply: import('../types/effects.js').RollThenApplyAction } =>
          e.apply.type === 'roll-then-apply',
      )
    : undefined;
  if (action.type === 'play-short-event' && action.targetCharacterId && rollUntapOnEnter) {
    return resolveShortEventRollUntap(
      state, action.targetCharacterId, def, handCard, playerIndex, newHand, rollUntapOnEnter.apply,
    );
  }

  // Resource-side `call-council` (e.g. Sudden Call, le-235): the card
  // triggers the endgame — discard the card, bypass normal short-event
  // effects, and apply the council-call state transition (opponent gets
  // the last turn).
  const resourceCallCouncil = def.effects?.find(
    (e): e is import('../types/effects.js').CallCouncilEffect =>
      e.type === 'call-council' && e.lastTurnFor === 'opponent',
  );
  if (resourceCallCouncil) {
    const afterDiscard = updatePlayer(state, playerIndex, p => ({
      ...p,
      hand: newHand,
      discardPile: [...p.discardPile, handCard],
    }));
    return { state: triggerCouncilCall(afterDiscard, action.player, 'opponent') };
  }

  // grant-extra-mh-phase (Forced March le-185, Bridge tw-202, Leg It Double
  // Quick le-202): flag the active company so that once its current move
  // commits, `advanceAfterCompanyMH` offers it another movement/hazard phase.
  // The legal-action emitter has already verified the M/H window and the
  // destination requirement, so resolution simply sets the flag and discards
  // the spent event.
  const grantExtraMHPhase = def.effects?.find(
    (e): e is import('../types/effects.js').GrantExtraMHPhaseEffect => e.type === 'grant-extra-mh-phase',
  );
  if (grantExtraMHPhase && state.phaseState.phase === Phase.MovementHazard) {
    const companyIndex = state.phaseState.activeCompanyIndex;
    logDetail(`${def.name}: granting company (index ${companyIndex}) an extra movement/hazard phase this turn`);
    const afterFlag = updatePlayer(state, playerIndex, p => ({
      ...p,
      hand: newHand,
      discardPile: [...p.discardPile, handCard],
      companies: p.companies.map((c, idx) => idx === companyIndex ? { ...c, extraMHPhasePending: true } : c),
    }));
    return { state: afterFlag };
  }

  // Apply play-target tap cost (e.g. Stealth taps the chosen scout). The
  // legal-actions emitter generates one play-short-event action per eligible
  // target, so the targetScoutInstanceId here is guaranteed to be one of
  // them. We tap the character before any other effect resolution so the
  // visible state matches the player's expectation immediately.
  let workingState = state;
  if (action.targetScoutInstanceId) {
    const playTargetEff = def.effects?.find(
      (e): e is import('../types/effects.js').PlayTargetEffect => e.type === 'play-target',
    );
    if (playTargetEff?.cost) {
      const costResult = applyCost(state, playTargetEff.cost, action.targetScoutInstanceId, {
        playerIndex,
        label: def.name,
      });
      if ('error' in costResult) return { state, error: costResult.error };
      workingState = costResult.state;
    }
  }

  // A short event that discards a card in play (Voices of Malice le-250,
  // Marvels Told td-134, Ancient Secrets ba-36 mode 1, The Cock Crows tw-342
  // mode 2) is an action like any other, so per CoE 9.4/9.5 it must be
  // declared on the chain of effects — the opponent is owed a response window
  // before the target leaves play. Tapping the character above was an active
  // condition of the declaration (rule 9.5.2) and is therefore already paid;
  // the card itself now leaves the hand and rides the chain entry, carrying
  // the chosen target and the tapped character. `resolveEntry` performs the
  // discard and the follow-up corruption check once both players pass
  // priority. Previously this resolved inline, silently skipping the response
  // window.
  if (action.discardTargetInstanceId && findMoveEffectByShape(def, 'target', 'in-play', 'discard')) {
    const targetName = resolveDef(workingState, action.discardTargetInstanceId)?.name
      ?? (action.discardTargetInstanceId as string);
    logDetail(`${def.name} → chain of effects (discard of ${targetName} resolves on chain resolution)`);
    const afterHand = updatePlayer(workingState, playerIndex, p => ({ ...p, hand: newHand }));
    const payload: ChainEntryPayload = {
      type: 'short-event',
      discardTargetInstanceId: action.discardTargetInstanceId,
      ...(action.targetScoutInstanceId ? { costTapCharacterId: action.targetScoutInstanceId } : {}),
    };
    return { state: initiateOrPushChain(afterHand, action.player, handCard, payload) };
  }

  // The sweep sibling of the branch above: a short event that discards *every*
  // matching card in play (Wizard's River-horses tw-364, "All Nazgûl events are
  // discarded"). Same chain treatment — the opponent is owed a response window
  // before the sweep lands — but there is no chosen target to carry, so the
  // payload flags the mode instead. The flag also keeps the sweep from firing
  // when this card is played in its *other* mode (cancel-attack), which pushes
  // a bare `short-event` payload from `handleCancelAttack`.
  if (findMoveEffectByShape(def, 'filter-all', 'in-play', 'discard')) {
    logDetail(`${def.name} → chain of effects (discard-all-in-play resolves on chain resolution)`);
    const afterHand = updatePlayer(workingState, playerIndex, p => ({ ...p, hand: newHand }));
    const payload: ChainEntryPayload = {
      type: 'short-event',
      discardAllInPlay: true,
      ...(action.targetCharacterId ? { targetCharacterId: action.targetCharacterId } : {}),
    };
    return { state: initiateOrPushChain(afterHand, action.player, handCard, payload) };
  }

  const newCharacters = workingState.players[playerIndex].characters;

  // Handle DSL-declared play-option `set-character-status` applies (e.g.
  // And Forth He Hastened td-98, Halfling Strength's untap / heal options,
  // Above the Abyss as-77, Angband Revisited ba-49). Constraint-producing
  // applies are resolved below against the fully-updated state via
  // addConstraint.
  const selectedOption = action.optionId
    ? (def.effects?.find(
        e => e.type === 'play-option' && e.id === action.optionId,
      ) as import('../types/effects.js').PlayOptionEffect | undefined)
    : undefined;

  // Choosing a `set-character-status` play-option (untap/heal) is a declared
  // action like any other, so per CoE 9.4/9.5 it must ride the chain of
  // effects — the opponent is owed a response window before the character's
  // status actually changes. The card leaves the hand and rides the chain
  // entry, carrying the chosen target and option id; `resolveEntry` (in
  // chain-reducer) applies the status change (and the healing-affects-all
  // extension, if applicable) and discards the spent card once both players
  // pass priority. Previously this resolved inline — the status changed and
  // the card was discarded in the same step the action was declared —
  // silently skipping the opponent's response window.
  if (selectedOption && action.targetCharacterId && selectedOption.apply.type === 'set-character-status') {
    if (selectedOption.apply.status === undefined) {
      return { state, error: `${def.name} option '${selectedOption.id}': set-character-status missing status` };
    }
    const targetName = resolveDef(workingState, action.targetCharacterId)?.name
      ?? (action.targetCharacterId as string);
    logDetail(`${def.name} → chain of effects (option "${selectedOption.id}" status change on ${targetName} resolves on chain resolution)`);
    const afterHand = updatePlayer(workingState, playerIndex, p => ({ ...p, hand: newHand }));
    const payload: ChainEntryPayload = {
      type: 'short-event',
      targetCharacterId: action.targetCharacterId,
      optionId: action.optionId,
    };
    return { state: initiateOrPushChain(afterHand, action.player, handCard, payload) };
  }

  // Collect fetch-to-deck effects — these need a sub-flow because the player
  // picks from face-down piles (sideboard / discard) and the choice must be
  // serialised as a separate action. Discard-in-play is resolved inline
  // below: the target is already chosen on the play action.
  //
  // For move effects with a `when` guard, evaluate against a context that
  // includes the targeted character's current site name and the player's
  // deck count. This gates conditional fetches (e.g. Vilya's "at Rivendell
  // with ≥5 cards in deck") at enqueue time so no sub-flow is opened when
  // the condition fails.
  const targetCharId = action.type === 'play-short-event' ? (action.targetCharacterId ?? action.targetScoutInstanceId) : undefined;
  const targetCharSiteName = (() => {
    if (!targetCharId) return undefined;
    for (const p of workingState.players) {
      const company = findCharacterCompany(p.companies, targetCharId);
      if (!company?.currentSite) continue;
      const siteDef = defById(workingState, company.currentSite.definitionId);
      return siteDef?.name;
    }
    return undefined;
  })();
  // If the card has an enqueue-corruption-check on-event AND an interactive fetch
  // effect, the CC must fire AFTER the fetch completes (not upfront), to avoid
  // blocking fetch-from-pile resolution with an active pendingResolution.
  // We embed it as `postCorruptionCheck` on the pending effect entry instead.
  const enqueueCorruptionCheckEffect = targetCharId
    ? getOnEventEffects(def, 'self-enters-play').find(
        (e): e is import('../types/effects.js').OnEventEffect & { apply: import('../types/effects.js').EnqueueCorruptionCheckAction } =>
          e.apply.type === 'enqueue-corruption-check',
      )
    : undefined;

  // A dual-mode card whose alternative is a discard-in-play (Ancient Secrets
  // ba-36): mode 1 chooses a `discardTargetInstanceId` and must NOT also run
  // the sideboard fetch. When a discard target is present, skip all fetch
  // effects so only the discard resolves. Mode 2 (no discard target) enqueues
  // the fetch as normal.
  const choseDiscardMode = action.type === 'play-short-event' && !!action.discardTargetInstanceId;
  const interactiveEffects: PendingEffect[] = (def.effects ?? [])
    .flatMap(effect => {
      if (effect.type !== 'move') return [];
      if (choseDiscardMode) return [];
      const payload = moveToFetchToDeckPayload(effect);
      if (!payload) return [];
      if (effect.when) {
        const fetchWhenCtx = {
          target: { siteName: targetCharSiteName },
          player: { deckCount: workingState.players[playerIndex].playDeck.length },
        };
        if (!matchesCondition(effect.when, fetchWhenCtx)) {
          logDetail(`${def.name}: fetch condition not met — skipping`);
          return [];
        }
      }
      // cancel-deck-search (Lady of the Golden Wood as-13): a minion player's
      // own play-deck / discard-pile searches are automatically canceled.
      const gatedPayload = gateDeckSearchFetch(workingState, action.player, payload);
      if (!gatedPayload) return [];
      // Embed corruption check (if any) as postCorruptionCheck so it fires
      // after the last pick, not as a blocking pendingResolution upfront.
      const postCC = enqueueCorruptionCheckEffect ? {
        characterId: targetCharId!,
        modifier: (enqueueCorruptionCheckEffect.apply.modifier) ?? 0,
      } : undefined;
      return [{
        type: 'card-effect' as const,
        cardInstanceId: handCard.instanceId,
        effect: gatedPayload,
        ...(action.type === 'play-short-event' && action.targetScoutInstanceId ? { targetCharacterId: action.targetScoutInstanceId } : {}),
        ...(postCC ? { postCorruptionCheck: postCC } : {}),
      }];
    });

  let newState: GameState = updatePlayer(workingState, playerIndex, p => ({ ...p, hand: newHand, characters: newCharacters }));

  // Apply self-enters-play on-event effects (e.g. Stealth's add-constraint).
  // These are non-interactive and resolved immediately when the card is played.
  // When there are interactive fetch effects, skip enqueue-corruption-check here
  // because it's embedded as postCorruptionCheck on the pending effect instead.
  const skipEnqueueCorruptionCheck = interactiveEffects.length > 0 && !!enqueueCorruptionCheckEffect;
  newState = applyShortEventOnEntersPlay(newState, def, handCard, action, playerIndex, skipEnqueueCorruptionCheck);

  // If the selected play-option is an `add-constraint` apply targeting the
  // chosen character, add it via the generic DSL handler. The constraint
  // kind, scope, and optional numeric payload come straight from the card
  // JSON — no per-card branches here.
  if (selectedOption && action.targetCharacterId && selectedOption.apply.type === 'add-constraint') {
    const constraintResult = applyPlayOptionAddConstraint(
      newState, def, handCard, selectedOption, action.targetCharacterId,
    );
    if ('error' in constraintResult) return { state, error: constraintResult.error };
    newState = constraintResult.state;
  }

  // roll-remove-hazard-events (Glamour of Surpassing Excellance, as-49): enqueue one
  // dice-check (glamour) pending resolution per hazard permanent-event found on characters
  // in the active company. The player rolls for each; a roll exceeding the hazard's
  // removalThreshold (removalNumber on the card, or 8 by default) discards it.
  const rollRemoveEffect = def.effects?.find(
    (e): e is import('../types/effects.js').RollRemoveHazardEventsEffect => e.type === 'roll-remove-hazard-events',
  );
  if (rollRemoveEffect && newState.phaseState.phase === Phase.Site) {
    const sitePhaseState = newState.phaseState as { activeCompanyIndex: number };
    const company = newState.players[playerIndex].companies[sitePhaseState.activeCompanyIndex];
    if (company) {
      for (const charId of company.characters) {
        const char = newState.players[playerIndex].characters[charId];
        if (!char) continue;
        for (const hazard of char.hazards) {
          const hazDef = defById(newState, hazard.definitionId);
          if (!hazDef || !('eventType' in hazDef) || (hazDef as { eventType?: string }).eventType !== 'permanent') continue;
          const removalThreshold = (hazDef as { removalNumber?: number }).removalNumber ?? 8;
          logDetail(`${def.name}: enqueueing dice-check (glamour) for ${hazDef.name} (threshold >${removalThreshold})`);
          newState = enqueueResolution(newState, {
            source: handCard.instanceId,
            actor: action.player,
            scope: { kind: 'company-site-subphase', companyId: company.id },
            kind: {
              type: 'dice-check',
              label: `${def.name}: ${hazDef.name} (need > ${removalThreshold})`,
              modifiers: [],
              threshold: removalThreshold,
              comparison: 'gt',
              // total > threshold → hazard removed to its owner's discard.
              onPass: { type: 'move', select: 'target', from: 'attached-to-character', to: 'discard', toOwner: 'source-owner' },
              continuation: { kind: 'dequeue-only' },
              targetInstanceId: hazard.instanceId,
            },
          });
        }
      }
    }
  }

  // Handle bounce-to-opponent-hand move (e.g. Wizard Uncloaked):
  // return all hazards matching filter on characters in the target
  // wizard's company to the opponent's hand, then enqueue a corruption
  // check on the wizard.
  const bounceEffect = def.effects?.find(e =>
    e.type === 'move'
    && e.select === 'filter-all'
    && e.from === 'attached-to-target-company'
    && e.to === 'hand'
    && e.toOwner === 'opponent',
  );
  if (bounceEffect && bounceEffect.type === 'move' && action.targetCharacterId) {
    const wizardId = action.targetCharacterId;
    const company = newState.players[playerIndex].companies.find(
      c => c.characters.includes(wizardId),
    );
    if (company) {
      const opponentIndex = (playerIndex + 1) % newState.players.length;
      const bouncedCards: CardInstance[] = [];

      for (const charId of company.characters) {
        const char = newState.players[playerIndex].characters[charId];
        if (!char) continue;
        const remaining: import('../index.js').CardInPlay[] = [];
        for (const haz of char.hazards) {
          const hazDef = defById(newState, haz.definitionId);
          const matches = hazDef && bounceEffect.filter
            ? matchesDefinition(hazDef, bounceEffect.filter)
            : !!hazDef;
          if (matches) {
            logDetail(`${def.name}: returning ${hazDef?.name ?? '?'} from ${charId as string} to opponent's hand`);
            bouncedCards.push(toCardInstance(haz));
          } else {
            remaining.push(haz);
          }
        }
        if (remaining.length !== char.hazards.length) {
          newState = updatePlayer(newState, playerIndex, p =>
            updateCharacter(p, charId as string, c => ({ ...c, hazards: remaining })),
          );
        }
      }

      if (bouncedCards.length > 0) {
        newState = updatePlayer(newState, opponentIndex, p => ({
          ...p,
          hand: [...p.hand, ...bouncedCards],
        }));
        logDetail(`${def.name}: returned ${bouncedCards.length} hazard permanent-event(s) to opponent's hand`);
      }

      // Enqueue corruption check on the wizard
      if (bounceEffect.corruptionCheck) {
        newState = enqueueCorruptionCheck(newState, {
          source: handCard.instanceId,
          actor: action.player,
          scope: { kind: 'phase' as const, phase: newState.phaseState.phase },
          characterId: wizardId,
          modifier: bounceEffect.corruptionCheck.modifier,
          reason: def.name,
        });
      }
    }
  }

  // Remove all hazard permanent-events on the target character (The Sun
  // Unveiled as-56): a `move { select: filter-all, from: hazards-on-target,
  // to: discard }` discards each matching hazard to its owner's discard pile.
  // Distinct from the Wizard Uncloaked bounce above (whole company → opponent's
  // hand): this targets a single character and removes to the owner's discard.
  const removeHazardsOnTarget = def.effects?.find(
    (e): e is import('../types/effects.js').MoveEffect =>
      e.type === 'move'
      && e.select === 'filter-all'
      && e.from === 'hazards-on-target',
  );
  if (removeHazardsOnTarget && action.targetCharacterId) {
    const moveResult = applyMove(newState, removeHazardsOnTarget, {
      sourceCardId: handCard.instanceId,
      sourcePlayerIndex: playerIndex,
      targetCharacterId: action.targetCharacterId,
    });
    if ('error' in moveResult) {
      logDetail(`${def.name}: remove-hazards-on-target failed — ${moveResult.error}`);
    } else {
      logDetail(`${def.name}: removed hazard permanent-events on ${action.targetCharacterId as string}`);
      newState = moveResult.state;
    }
  }

  // Handle company-combat-boost effects: add attack-scoped character-stat-modifier
  // constraints for each matching character in the defending company.
  // Only active when this card is played during combat (state.combat non-null).
  const companyCombatBoosts = (def.effects ?? []).filter(
    (e): e is import('../types/effects.js').CompanyCombatBoostEffect => e.type === 'company-combat-boost',
  );
  if (companyCombatBoosts.length > 0 && newState.combat) {
    const combat = newState.combat;
    const defPlayerIndex = newState.players.findIndex(p => p.id === combat.defendingPlayerId);
    if (defPlayerIndex >= 0) {
      const defPlayer = newState.players[defPlayerIndex];
      const company = companyById(defPlayer.companies, combat.companyId);
      if (company) {
        const charCtx = (charCardDef: CardDefinition) => ({
          target: {
            race: 'race' in charCardDef ? (charCardDef as { race?: Race }).race : undefined,
            name: (charCardDef?.name) ?? '',
            skills: ('skills' in charCardDef ? (charCardDef as { skills?: readonly string[] }).skills : undefined) ?? [],
            keywords: ('keywords' in charCardDef ? (charCardDef as { keywords?: readonly string[] }).keywords : undefined) ?? [],
          },
        });
        for (const boostEffect of companyCombatBoosts) {
          // A `companyFilter` gates the whole company: only apply the boost (to
          // every character) if at least one member satisfies it (Foe Dismayed's
          // leader-or-Balrog gate). A `filter` restricts which members receive it.
          if (boostEffect.companyFilter) {
            const companyQualifies = company.characters.some(charId => {
              const char = defPlayer.characters[charId];
              const cDef = char ? defById(newState, char.definitionId) : undefined;
              return cDef ? matchesCondition(boostEffect.companyFilter!, charCtx(cDef)) : false;
            });
            if (!companyQualifies) {
              logDetail(`${def.name}: company does not satisfy companyFilter — no boost applied`);
              continue;
            }
          }
          for (const charId of company.characters) {
            const char = defPlayer.characters[charId];
            if (!char) continue;
            const charCardDef = defById(newState, char.definitionId);
            if (!charCardDef) continue;
            if (boostEffect.filter) {
              if (!matchesCondition(boostEffect.filter, charCtx(charCardDef))) continue;
            }
            logDetail(`${def.name}: adding attack-scoped +${boostEffect.value} ${boostEffect.stat} to ${charId as string}`);
            newState = addConstraint(newState, {
              source: handCard.instanceId,
              sourceDefinitionId: handCard.definitionId,
              scope: { kind: 'attack' },
              target: { kind: 'character', characterId: charId },
              kind: {
                type: 'character-stat-modifier',
                stat: boostEffect.stat,
                value: boostEffect.value,
                characterId: charId,
              },
            });
          }
        }
      }
    }
  }

  // Handle join-combat-force-strike (Vanguard of Might ba-79): bring the named
  // character into the defending company if absent (movement — only the company
  // membership arrays change), force it to face a strike from the current attack
  // (combat.forcedStrikeTargets), and schedule a post-attack tap if configured.
  const joinForceStrike = (def.effects ?? []).find(
    (e): e is import('../types/effects.js').JoinCombatForceStrikeEffect => e.type === 'join-combat-force-strike',
  );
  if (joinForceStrike && newState.combat) {
    const combat = newState.combat;
    const defPlayerIndex = newState.players.findIndex(p => p.id === combat.defendingPlayerId);
    if (defPlayerIndex >= 0) {
      const defPlayer = newState.players[defPlayerIndex];
      // Locate the named character among the defending player's characters.
      const namedEntry = Object.entries(defPlayer.characters).find(([, ch]) => {
        const chDef = defById(newState, ch.definitionId) as { name?: string } | undefined;
        return chDef?.name === joinForceStrike.characterName;
      });
      if (namedEntry) {
        const namedId = namedEntry[0] as CardInstanceId;
        const inTargetCompany = defPlayer.companies.some(
          c => c.id === combat.companyId && c.characters.includes(namedId),
        );
        // Move the character into the attacked company if it is elsewhere.
        // "Considered movement with no movement/hazard phase" — only membership
        // arrays change; the CharacterInPlay entry is untouched.
        if (!inTargetCompany) {
          const newCompanies = defPlayer.companies.map(c => {
            if (c.characters.includes(namedId) && c.id !== combat.companyId) {
              return { ...c, characters: c.characters.filter(id => id !== namedId) };
            }
            if (c.id === combat.companyId && !c.characters.includes(namedId)) {
              return { ...c, characters: [...c.characters, namedId] };
            }
            return c;
          });
          const nps: [import('../types/state-player.js').PlayerState, import('../types/state-player.js').PlayerState] =
            [newState.players[0], newState.players[1]];
          nps[defPlayerIndex] = { ...defPlayer, companies: newCompanies };
          newState = { ...newState, players: nps };
          logDetail(`${def.name}: ${joinForceStrike.characterName} joins the attacked company ${combat.companyId as string}`);
        }
        // Force the character to face a strike and schedule the post-attack tap.
        const forced = [...(combat.forcedStrikeTargets ?? []), namedId];
        const postAttack = joinForceStrike.tapAfterAttack
          ? [...(combat.postAttackEffects ?? []), { targetCharacterId: namedId, tapIfUntapped: true }]
          : combat.postAttackEffects;
        newState = {
          ...newState,
          combat: {
            ...newState.combat!,
            forcedStrikeTargets: forced,
            ...(postAttack ? { postAttackEffects: postAttack } : {}),
          },
        };
        logDetail(`${def.name}: ${joinForceStrike.characterName} must face a strike${joinForceStrike.tapAfterAttack ? ' and taps after the attack' : ''}`);
      } else {
        logDetail(`${def.name}: ${joinForceStrike.characterName} not found in play — no join/force-strike applied`);
      }
    }
  }

  // Scourge of Fire (ba-75): a Balrog CvCC resource short-event. If The Balrog
  // is untapped and in the current company-vs-company combat on the player's
  // side, the player chooses and discards one item borne by the *opposing*
  // company (a discard-one-company-item pending resolution on that company). The
  // legal-action emitter (combatDiscardOpponentItemActions) already gated on the
  // Balrog being untapped in the acting company and the opponent bearing an
  // item, so here we resolve against the current CvCC state directly.
  const discardOppItemEffect = (def.effects ?? []).find(
    (e): e is import('../types/effects.js').CombatDiscardOpponentItemEffect =>
      e.type === 'combat-discard-opponent-item',
  );
  if (discardOppItemEffect && newState.combat?.isCvCC) {
    const combat = newState.combat;
    // Identify the opposing company relative to the acting player.
    const oppCompanyId = cvccSides(combat, action.player)?.oppCompanyId;

    // Discard the spent short-event to the player's discard pile first.
    let working = updatePlayer(newState, playerIndex, p => ({
      ...p,
      discardPile: [...p.discardPile, handCard],
    }));

    // Record the turn-scoped duplication marker ("cannot be duplicated on a
    // given turn"): each play leaves a turn-scoped constraint from this
    // definition, which the legal-action scanner counts to block a second copy.
    if (findDuplicationLimitEffect(def, 'turn')) {
      working = addConstraint(working, {
        source: handCard.instanceId,
        sourceDefinitionId: handCard.definitionId,
        scope: { kind: 'turn' },
        target: { kind: 'player', playerId: action.player },
        kind: { type: 'attack-card-played' },
      });
      logDetail(`${def.name}: added turn-scoped duplication marker (cannot be duplicated on a given turn)`);
    }

    // Enqueue the item-discard choice on the opposing company (actor = the
    // ba-75 player). Skips silently if the opposing company can't be resolved
    // or bears no items (the emitter should have prevented the latter).
    if (oppCompanyId) {
      const oppPlayer = working.players.find(p => p.companies.some(co => co.id === oppCompanyId));
      const oppCompany = oppPlayer ? companyById(oppPlayer.companies, oppCompanyId) : undefined;
      const hasItem = (oppCompany?.characters ?? []).some(charId => {
        const ch = oppPlayer!.characters[charId];
        return !!ch && ch.items.some(it => isItemCard(defById(working, it.definitionId)));
      });
      if (hasItem) {
        logDetail(`${def.name}: opponent must discard one item from company ${oppCompanyId as string}`);
        working = enqueueResolution(working, {
          source: handCard.instanceId,
          actor: action.player,
          scope: companySubphaseScope(working.phaseState.phase, oppCompanyId),
          kind: { type: 'discard-one-company-item', companyId: oppCompanyId },
        });
      } else {
        logDetail(`${def.name}: opposing company bears no items — nothing to discard`);
      }
    } else {
      logDetail(`${def.name}: no opposing CvCC company resolved — nothing to discard`);
    }
    return { state: working };
  }

  // Crowned with Storm (ba-54): a Balrog CvCC resource short-event that
  // devastates *everyone at the site* — both companies participating in the
  // company-vs-company combat. On resolution, in order: (1) discard all no-body
  // allies at the site; (2) tap every untapped ally and every untapped
  // character with a mind stat; (3) enqueue one wound-or-eliminate roll per
  // character with a mind stat < characterMindBelow and per ally normally worth
  // < allyMpBelow MP. The emitter (siteStormAtSiteActions) already gated on the
  // combat being CvCC, the Balrog's company being present and not at an
  // Under-deeps site, and the opposing company containing a Wizard.
  const stormEffect = (def.effects ?? []).find(
    (e): e is import('../types/effects.js').SiteStormDevastationEffect =>
      e.type === 'site-storm-devastation',
  );
  if (stormEffect && newState.combat?.isCvCC) {
    const combat = newState.combat;
    // Resolve the two participating companies (owner index + company id).
    const sides = cvccSides(combat, action.player);
    const myCompanyId = sides?.myCompanyId;
    const oppPlayerId = sides?.oppPlayerId;
    const oppCompanyId = sides?.oppCompanyId;

    // Discard the spent short-event to the Balrog player's discard pile first.
    let working = updatePlayer(newState, playerIndex, p => ({
      ...p,
      discardPile: [...p.discardPile, handCard],
    }));

    // The set of companies "at the site" = the two CvCC participants.
    const participants: Array<{ ownerIndex: number; companyId: import('../types/common.js').CompanyId }> = [];
    if (myCompanyId) participants.push({ ownerIndex: playerIndex, companyId: myCompanyId });
    if (oppPlayerId !== undefined && oppCompanyId) {
      const oi = getPlayerIndex(working, oppPlayerId);
      if (oi >= 0) participants.push({ ownerIndex: oi, companyId: oppCompanyId });
    }

    // (1) Discard all no-body allies (effective body 0/absent) at the site.
    for (const { ownerIndex, companyId } of participants) {
      const company = companyById(working.players[ownerIndex].companies, companyId);
      if (!company) continue;
      for (const charId of company.characters) {
        const host = working.players[ownerIndex].characters[charId];
        if (!host) continue;
        const noBodyAllies = host.allies.filter(a => {
          const b = allyEffectiveBody(working, a);
          return b === undefined || b === 0;
        });
        if (noBodyAllies.length === 0) continue;
        for (const a of noBodyAllies) {
          logDetail(`${def.name}: discarding no-body ally ${a.instanceId as string} at the site`);
        }
        working = updatePlayer(working, ownerIndex, p => {
          const withRemoved = updateCharacter(p, charId, c => ({
            ...c,
            allies: c.allies.filter(a => !noBodyAllies.some(n => n.instanceId === a.instanceId)),
          }));
          return { ...withRemoved, discardPile: [...withRemoved.discardPile, ...noBodyAllies.map(a => toCardInstance(a))] };
        });
      }
    }

    // (2) Tap every untapped ally and every untapped character with a mind stat.
    for (const { ownerIndex, companyId } of participants) {
      const company = companyById(working.players[ownerIndex].companies, companyId);
      if (!company) continue;
      for (const charId of company.characters) {
        const host = working.players[ownerIndex].characters[charId];
        if (!host) continue;
        const charDef = defById(working, host.definitionId);
        const hasMind = !!charDef && isCharacterCard(charDef) && charDef.mind !== null;
        const tapChar = hasMind && host.status === CardStatus.Untapped;
        const anyUntappedAlly = host.allies.some(a => a.status === CardStatus.Untapped);
        if (!tapChar && !anyUntappedAlly) continue;
        working = updatePlayer(working, ownerIndex, p =>
          updateCharacter(p, charId, c => ({
            ...c,
            status: tapChar && c.status === CardStatus.Untapped ? CardStatus.Tapped : c.status,
            allies: c.allies.map(a => (a.status === CardStatus.Untapped ? { ...a, status: CardStatus.Tapped } : a)),
          })));
        if (tapChar) logDetail(`${def.name}: tapping character ${charId as string} (has a mind stat)`);
      }
    }

    // (3) Enqueue one wound-or-eliminate roll per qualifying character/ally.
    // The Balrog's controller rolls 2d6 per target; on roll - 1 > body (i.e.
    // roll > body + 1) the target is wounded, or eliminated if already wounded.
    const scope = companySubphaseScope(working.phaseState.phase, myCompanyId ?? (participants[0]?.companyId));
    for (const { ownerIndex, companyId } of participants) {
      const company = companyById(working.players[ownerIndex].companies, companyId);
      if (!company) continue;
      for (const charId of company.characters) {
        const host = working.players[ownerIndex].characters[charId];
        if (!host) continue;
        const charDef = defById(working, host.definitionId);
        if (charDef && isCharacterCard(charDef) && charDef.mind !== null && charDef.mind < stormEffect.characterMindBelow) {
          const body = charDef.body ?? 0;
          logDetail(`${def.name}: enqueueing storm roll for character ${charDef.name} (mind ${charDef.mind} < ${stormEffect.characterMindBelow}, body ${body})`);
          working = enqueueResolution(working, {
            source: handCard.instanceId,
            actor: action.player,
            scope,
            kind: {
              type: 'dice-check',
              label: `${def.name}: ${charDef.name} (roll - 1 > body ${body} → wound/eliminate)`,
              modifiers: [{ kind: 'constant', value: -1 }],
              threshold: body,
              comparison: 'gt',
              onPass: { type: 'wound-or-eliminate' },
              continuation: { kind: 'dequeue-only' },
              requireTargetPresent: true,
              targetCharacterId: charId,
            },
          });
        }
        for (const ally of host.allies) {
          const allyDef = defById(working, ally.definitionId);
          const allyMp = isAllyCard(allyDef) ? allyDef.marshallingPoints : 0;
          if (allyMp < stormEffect.allyMpBelow) {
            const body = allyEffectiveBody(working, ally) ?? 0;
            logDetail(`${def.name}: enqueueing storm roll for ally ${ally.instanceId as string} (MP ${allyMp} < ${stormEffect.allyMpBelow}, body ${body})`);
            working = enqueueResolution(working, {
              source: handCard.instanceId,
              actor: action.player,
              scope,
              kind: {
                type: 'dice-check',
                label: `${def.name}: ally (roll - 1 > body ${body} → wound/eliminate)`,
                modifiers: [{ kind: 'constant', value: -1 }],
                threshold: body,
                comparison: 'gt',
                onPass: { type: 'wound-or-eliminate' },
                continuation: { kind: 'dequeue-only' },
                requireTargetPresent: true,
                targetInstanceId: ally.instanceId,
              },
            });
          }
        }
      }
    }

    return { state: working };
  }

  if (interactiveEffects.length > 0) {
    // Card goes to player's cardsInPlay (visible on table) while effects resolve
    logDetail(`${def.name} → cardsInPlay, resolving ${interactiveEffects.length} effect(s)`);
    const withCardInPlay = updatePlayer(newState, playerIndex, p => ({
      ...p,
      cardsInPlay: [...p.cardsInPlay, { instanceId: handCard.instanceId, definitionId: handCard.definitionId, status: CardStatus.Untapped }],
    }));
    return {
      state: {
        ...withCardInPlay,
        pendingEffects: [...withCardInPlay.pendingEffects, ...interactiveEffects],
      },
    };
  }

  // deck-search-attack (Lucky Search tw-269): reveal cards from the play deck
  // one at a time until a valid non-special item is found or the deck ends,
  // then create an uncancelable attack against the scout. Post-combat
  // handling (item assignment + reshuffle) is done in finalizeCombat.
  const deckSearchEffect = def.effects?.find(
    (e): e is import('../types/effects.js').DeckSearchAttackEffect => e.type === 'deck-search-attack',
  );
  if (deckSearchEffect) {
    const scoutId = action.targetScoutInstanceId!;
    const deck = newState.players[playerIndex].playDeck;
    const inPlayNames = buildInPlayNames(newState);

    // Scan deck for first non-special item whose uniqueness constraint is met
    let foundIdx = -1;
    for (let i = 0; i < deck.length; i++) {
      const cardDef = newState.cardPool[deck[i].definitionId];
      if (!cardDef || !('cardType' in cardDef)) continue;
      const ct = (cardDef as { cardType: string }).cardType;
      if (!ct.endsWith('-item')) continue;
      if ('subtype' in cardDef && (cardDef as { subtype: string }).subtype === 'special') continue;
      if ('unique' in cardDef && (cardDef as { unique: boolean }).unique) {
        const itemName = (cardDef as { name: string }).name;
        // Skip if a copy is already in play (attached to any character)
        const alreadyInPlay = newState.players.some(p =>
          Object.values(p.characters).some(ch =>
            ch.items.some(item => {
              const iDef = defById(newState, item.definitionId);
              return iDef && iDef.name === itemName;
            }),
          ),
        );
        if (alreadyInPlay) continue;
        // Also check inPlayNames for permanent-event items
        if (inPlayNames.includes(itemName)) continue;
      }
      foundIdx = i;
      break;
    }

    const revealedCount = foundIdx >= 0 ? foundIdx + 1 : deck.length;
    const revealedCardInstanceIds = deck.slice(0, revealedCount).map(c => c.instanceId);
    const foundItemInstanceId = foundIdx >= 0 ? deck[foundIdx].instanceId : null;
    const prowess = deckSearchEffect.baseProwess + revealedCount;

    logDetail(
      `${def.name}: revealed ${revealedCount} card(s), found item: ${foundItemInstanceId ? String(foundItemInstanceId) : 'none'}, ` +
      `attack prowess = ${prowess} (${deckSearchEffect.baseProwess} + ${revealedCount})`,
    );

    // Short event goes to discard; attack is created immediately
    const stateWithDiscard = updatePlayer(newState, playerIndex, p => ({
      ...p,
      discardPile: [...p.discardPile, handCard],
    }));

    const defPlayer = stateWithDiscard.players[playerIndex];
    const atkPlayerIndex = stateWithDiscard.players.findIndex((_, i) => i !== playerIndex);
    const atkPlayer = stateWithDiscard.players[atkPlayerIndex];
    const company = findCharacterCompany(defPlayer.companies, scoutId);
    if (!company) return { state: stateWithDiscard, error: `${def.name}: scout not in any company` };

    const combat: import('../types/state-combat.js').CombatState = makeCombatState({
      attackSource: {
        type: 'lucky-search-attack',
        scoutInstanceId: scoutId,
        foundItemInstanceId,
        revealedCardInstanceIds,
      },
      companyId: company.id,
      defendingPlayerId: defPlayer.id,
      attackingPlayerId: atkPlayer.id,
      strikesTotal: deckSearchEffect.strikes,
      strikeProwess: prowess,
      creatureBody: null,
      assignmentPhase: 'defender',
      detainment: false,
      uncancelable: deckSearchEffect.uncancelable,
    });
    return { state: { ...stateWithDiscard, combat } };
  }

  // draw-cards (Dark Tryst as-80): draw `count` cards from the top of the
  // player's play deck into their hand. When `removeFromGame` is set, the
  // spent event card goes to the out-of-play pile instead of the discard
  // pile so it can never be recurred. Drawing stops early if the deck runs
  // out (no card disappears: the deck is simply exhausted).
  const drawEffect = def.effects?.find(
    (e): e is import('../types/effects.js').DrawCardsEffect => e.type === 'draw-cards',
  );
  if (drawEffect) {
    const deck = newState.players[playerIndex].playDeck;
    const drawCount = Math.min(drawEffect.count, deck.length);
    const drawnCards = deck.slice(0, drawCount);
    logDetail(`${def.name}: drawing ${drawCount}/${drawEffect.count} card(s) from play deck (deck size ${deck.length})`);
    if (drawCount < drawEffect.count) {
      logDetail(`${def.name}: play deck exhausted — drew only ${drawCount} of ${drawEffect.count}`);
    }
    const disposalLog = drawEffect.removeFromGame ? 'out-of-play (removed from game)' : 'discard';
    logDetail(`${def.name}: event card → ${disposalLog}`);
    return {
      state: updatePlayer(newState, playerIndex, p => ({
        ...p,
        hand: [...p.hand, ...drawnCards],
        playDeck: p.playDeck.slice(drawCount),
        ...(drawEffect.removeFromGame
          ? { outOfPlayPile: [...p.outOfPlayPile, handCard] }
          : { discardPile: [...p.discardPile, handCard] }),
      })),
    };
  }

  // reshuffle-from-discard (Horns, Horns, Horns dm-140): each affected
  // player pulls every card matching the filter (here: factions) out of
  // their discard pile and shuffles them into their play deck. Resolved
  // here before the spent event card lands in the discard pile, so the
  // event itself can never be swept up (it is a short-event, not a match).
  const reshuffleEffect = def.effects?.find(
    (e): e is import('../types/effects.js').ReshuffleFromDiscardEffect =>
      e.type === 'reshuffle-from-discard',
  );
  if (reshuffleEffect) {
    const scope = reshuffleEffect.scope ?? 'all-players';
    let working = newState;
    working.players.forEach((p, idx) => {
      if (scope === 'self' && idx !== playerIndex) return;
      const matching = p.discardPile.filter(c =>
        matchesDefinition(defById(working, c.definitionId)!, reshuffleEffect.filter),
      );
      if (matching.length === 0) {
        logDetail(`${def.name}: player ${p.id as string} has no matching cards in discard pile`);
        return;
      }
      const matchingIds = new Set(matching.map(c => c.instanceId));
      const remainingDiscard = p.discardPile.filter(c => !matchingIds.has(c.instanceId));
      const [shuffledDeck, nextRng] = shuffle([...p.playDeck, ...matching], working.rng);
      logDetail(`${def.name}: player ${p.id as string} reshuffles ${matching.length} card(s) from discard into play deck (deck ${p.playDeck.length} → ${shuffledDeck.length})`);
      working = {
        ...updatePlayer(working, idx, pl => ({
          ...pl,
          discardPile: remainingDiscard,
          playDeck: shuffledDeck,
        })),
        rng: nextRng,
      };
    });
    return {
      state: updatePlayer(working, playerIndex, p => ({
        ...p,
        discardPile: [...p.discardPile, handCard],
      })),
    };
  }

  // reveal-choose-shuffle (Eyes of Mandos dm-126): reveal the top up-to-`count`
  // cards of the play deck, then let the player choose one to put into hand and
  // shuffle the remaining ones back into the deck. The revealed cards stay
  // physically on top of the play deck while a `reveal-choose-to-hand` pending
  // resolution collects the choice (no instance floats). The event card itself
  // goes to the discard pile immediately (before the choice resolves).
  const revealChooseEffect = def.effects?.find(
    (e): e is import('../types/effects.js').RevealChooseShuffleEffect =>
      e.type === 'reveal-choose-shuffle',
  );
  if (revealChooseEffect) {
    // Discard the spent event card first (the reveal is a separate action).
    let working = updatePlayer(newState, playerIndex, p => ({
      ...p,
      discardPile: [...p.discardPile, handCard],
    }));
    const deck = working.players[playerIndex].playDeck;
    const revealCount = Math.min(revealChooseEffect.count, deck.length);
    if (revealCount === 0) {
      logDetail(`${def.name}: play deck empty — nothing to reveal, event fizzles`);
      return { state: working };
    }
    const revealedCards = deck.slice(0, revealCount);
    // Reveal the top cards to the opponent (recorded in revealedInstances).
    working = revealInstances(working, revealedCards);
    logDetail(
      `${def.name}: revealed ${revealCount}/${revealChooseEffect.count} top card(s) of play deck ` +
      `(deck size ${deck.length}) — awaiting choice`,
    );
    working = enqueueResolution(working, {
      source: handCard.instanceId,
      actor: action.player,
      scope: { kind: 'phase', phase: working.phaseState.phase },
      kind: {
        type: 'reveal-choose-to-hand',
        revealedInstanceIds: revealedCards.map(c => c.instanceId),
        sourceDefinitionId: handCard.definitionId,
      },
    });
    return { state: working };
  }

  // peek-shuffle-deck-top (Mirror of Galadriel tw-282): look at the opponent's
  // whole hand, then choose any one play deck whose top `count` cards are
  // looked at, shuffled, and returned to the top. The hand look is a "may" with
  // no cost or downside, so it happens on play; the deck choice comes after it
  // (the card's own ordering) via a `choose-peek-deck` pending resolution, which
  // also carries the optional "you may … choose" pass. The event card goes to
  // the discard pile immediately, before the choice resolves.
  const peekShuffleEffect = def.effects?.find(
    (e): e is import('../types/effects.js').PeekShuffleDeckTopEffect =>
      e.type === 'peek-shuffle-deck-top',
  );
  if (peekShuffleEffect) {
    let working = updatePlayer(newState, playerIndex, p => ({
      ...p,
      discardPile: [...p.discardPile, handCard],
    }));
    const opponentIndex = 1 - playerIndex;
    if (peekShuffleEffect.revealOpponentHand) {
      const opponentHand = working.players[opponentIndex].hand;
      working = revealInstances(working, opponentHand);
      logDetail(
        `${def.name}: ${action.player as string} looks at the opponent's hand ` +
        `(${opponentHand.length} card(s))`,
      );
    }
    const count = peekShuffleEffect.count ?? 5;
    const deckChoice = peekShuffleEffect.deckChoice ?? 'any';
    const ownDeckSize = working.players[playerIndex].playDeck.length;
    const opponentDeckSize = working.players[opponentIndex].playDeck.length;
    // An in-play `cancel-deck-search` (Bane of the Ithil-stone tw-13 against a
    // non-minion, Lady of the Golden Wood as-13 against a minion) cancels
    // looking at the player's OWN play deck; the opponent's deck is outside
    // what those cards cover ("any portion of *his* play deck").
    const ownDeckCanceller = deckSearchCancellerFor(working, action.player);
    if (ownDeckCanceller) {
      logDetail(`${def.name}: "${ownDeckCanceller}" cancels looking at ${action.player as string}'s own play deck`);
    }
    const selfEligible = deckChoice !== 'opponent' && !ownDeckCanceller && ownDeckSize > 0;
    const opponentEligible = deckChoice !== 'self' && opponentDeckSize > 0;
    if (!selfEligible && !opponentEligible) {
      logDetail(`${def.name}: no play deck with cards to look at — deck step fizzles`);
      return { state: working };
    }
    logDetail(
      `${def.name}: awaiting deck choice (own deck ${ownDeckSize}, opponent deck ${opponentDeckSize}, top ${count})`,
    );
    working = enqueueResolution(working, {
      source: handCard.instanceId,
      actor: action.player,
      scope: { kind: 'phase', phase: working.phaseState.phase },
      kind: {
        type: 'choose-peek-deck',
        count,
        deckChoice,
        sourceDefinitionId: handCard.definitionId,
      },
    });
    return { state: working };
  }

  // Withdrawn to Mordor (dm-165): a `withdraw-agent` short event either
  // removes an opponent's face-up agent (agent mode, `targetAgentId`) or
  // discards one of the opponent's unrevealed on-guard cards (on-guard mode,
  // `discardTargetInstanceId`). The event card itself always goes to the
  // playing player's discard pile.
  const withdrawAgentEffect = def.effects?.find(
    (e): e is import('../types/effects.js').WithdrawAgentEffect => e.type === 'withdraw-agent',
  );
  if (withdrawAgentEffect) {
    // The card is "playable on a face-up agent" (agent mode) or, alternatively,
    // on an unrevealed on-guard card (on-guard mode). Both modes require a
    // target; with neither a face-up agent nor an on-guard card present the
    // card has no legal target and must not be played (CoE 9.2.2 / CRF 22).
    // The legal-action layer already withholds a play action in that case, so
    // reaching here with no target is an illegal action — reject it and leave
    // the card in hand rather than silently discarding (wasting) it.
    if (!action.targetAgentId && !action.discardTargetInstanceId) {
      logDetail(`${def.name}: play attempted with no face-up agent or on-guard target — rejected`);
      return { state, error: `${def.name} has no valid target` };
    }

    let working = updatePlayer(newState, playerIndex, p => ({
      ...p,
      discardPile: [...p.discardPile, handCard],
    }));

    // On-guard mode: discard the named unrevealed on-guard card to its owner's
    // discard pile (CRF 22: this must happen before the card is revealed).
    if (action.discardTargetInstanceId) {
      const ogId = action.discardTargetInstanceId;
      let removed: import('../types/state-cards.js').OnGuardCard | undefined;
      let holderIndex = -1;
      let holderCompanyId: import('../types/common.js').CompanyId | undefined;
      for (let pi = 0; pi < working.players.length && !removed; pi++) {
        for (const company of working.players[pi].companies) {
          const og = company.onGuardCards.find(o => o.instanceId === ogId);
          if (og) {
            removed = og;
            holderIndex = pi;
            holderCompanyId = company.id;
            break;
          }
        }
      }
      if (!removed) return { state, error: 'Target on-guard card not found' };
      working = updatePlayer(working, holderIndex, p => ({
        ...p,
        companies: p.companies.map(c =>
          c.id === holderCompanyId
            ? { ...c, onGuardCards: c.onGuardCards.filter(o => o.instanceId !== ogId) }
            : c,
        ),
      }));
      // On-guard cards are always the opponent's hazards placed on the holder's
      // company, so the card returns to the other player's discard pile.
      const ownerIndex = holderIndex === 0 ? 1 : 0;
      logDetail(`${def.name}: discarding on-guard card ${removed.definitionId as string} (${ogId as string}) to owner ${working.players[ownerIndex].id as string}`);
      working = updatePlayer(working, ownerIndex, p => ({
        ...p,
        discardPile: [...p.discardPile, toCardInstance(removed)],
      }));
      return { state: working };
    }

    // Agent mode: locate the targeted agent, then judge it by printed mind.
    if (action.targetAgentId) {
      let agentOwnerIdx = -1;
      let agentIdx = -1;
      for (let i = 0; i < working.players.length && agentOwnerIdx === -1; i++) {
        const idx = working.players[i].agents.findIndex(a => a.id === action.targetAgentId);
        if (idx !== -1) {
          agentOwnerIdx = i;
          agentIdx = idx;
        }
      }
      if (agentOwnerIdx === -1) return { state, error: 'Target agent not found' };
      const agent = working.players[agentOwnerIdx].agents[agentIdx];
      const agentDef = defById(working, agent.character.definitionId);
      const mind = (agentDef && isCharacterCard(agentDef) ? agentDef.mind : 0) ?? 0;
      const returnToHand = mind >= withdrawAgentEffect.returnMindThreshold;
      logDetail(
        `${def.name}: agent ${agentDef?.name ?? (agent.character.definitionId as string)} mind ${mind} ` +
        `${returnToHand ? `≥ ${withdrawAgentEffect.returnMindThreshold} → returned to owner's hand` : `< ${withdrawAgentEffect.returnMindThreshold} → discarded`}`,
      );

      // Preserve the "no card disappears" invariant: any cards attached to the
      // agent (agents normally carry none) go to their owners' discard piles,
      // and the agent's face-down site stack returns to the location deck.
      const attachments = [
        ...agent.character.items,
        ...agent.character.allies,
        ...agent.character.hazards,
        ...(agent.character.trophies ?? []),
      ];
      const agentInstance = toCardInstance(agent.character);
      working = updatePlayer(working, agentOwnerIdx, p => ({
        ...p,
        agents: p.agents.filter((_, i) => i !== agentIdx),
        siteDeck: [...p.siteDeck, ...agent.siteStack],
        ...(returnToHand
          ? { hand: [...p.hand, agentInstance] }
          : { discardPile: [...p.discardPile, agentInstance] }),
      }));
      for (const att of attachments) {
        const ownerIdx = getPlayerIndex(working, ownerOf(att.instanceId));
        working = updatePlayer(working, ownerIdx, p => ({
          ...p,
          discardPile: [...p.discardPile, toCardInstance(att)],
        }));
      }
      return { state: working };
    }

    // Unreachable: the no-target case is rejected at the top of this block, and
    // the two supported modes each return above. Kept as a defensive fallback.
    return { state: working };
  }

  // Discard the card and return. If dice-check (glamour) resolutions were
  // enqueued, the legal-action system will automatically surface only roll
  // actions until all resolutions are cleared. A magic card cast by a player
  // whose Ringwraith is Akhôrahil (le-51) is instead shuffled back into their
  // play deck (see `discardOrRecyclePlayedEvent`).
  return {
    state: discardOrRecyclePlayedEvent(newState, playerIndex, handCard),
  };
}

/**
 * Resolves a {@link PlayOptionEffect} whose `apply.type` is `add-constraint`
 * into a concrete {@link ActiveConstraint} placed on the targeted character.
 * Reads constraint kind, scope, and optional numeric payload straight from
 * the DSL so no per-card code is needed.
 */
function applyPlayOptionAddConstraint(
  state: GameState,
  def: { name: string },
  handCard: CardInstance,
  option: import('../types/effects.js').PlayOptionEffect,
  targetCharacterId: import('../types/common.js').CardInstanceId,
): { state: GameState } | { error: string } {
  const apply = option.apply;
  if (apply.type !== 'add-constraint') {
    return { error: `${def.name} option '${option.id}': expected an add-constraint apply` };
  }
  const constraintName = apply.constraint;
  const scopeName = apply.scope;
  if (!constraintName || !scopeName) {
    return { error: `${def.name} option '${option.id}': add-constraint missing constraint or scope` };
  }

  // Company-targeted constraints: resolve the company from the target character
  const isCompanyTargeted = constraintName === 'hazard-limit-modifier'
    || constraintName === 'site-type-override'
    || constraintName === 'region-type-override';
  let companyId: import('../types/common.js').CompanyId | undefined;
  if (isCompanyTargeted) {
    const playerIndex = state.players.findIndex(p => targetCharacterId as string in p.characters);
    if (playerIndex < 0) {
      return { error: `${def.name} option '${option.id}': target character not found` };
    }
    const company = findCharacterCompany(state.players[playerIndex].companies, targetCharacterId);
    if (!company) {
      return { error: `${def.name} option '${option.id}': target character not in any company` };
    }
    companyId = company.id;
  }

  const scope = parseConstraintScope(scopeName, companyId ?? null);
  if (!scope) {
    return { error: `${def.name} option '${option.id}': unsupported scope '${scopeName}' for add-constraint` };
  }

  type Kind = import('../types/pending.js').ActiveConstraint['kind'];
  let kind: Kind;
  switch (constraintName) {
    case 'check-modifier': {
      if (typeof apply.check !== 'string') {
        return { error: `${def.name} option '${option.id}': check-modifier requires 'check'` };
      }
      let constraintValue: number;
      if (typeof apply.valueExpr === 'string') {
        const charPlayerIdx = state.players.findIndex(p => targetCharacterId as string in p.characters);
        const charInPlay = charPlayerIdx >= 0 ? state.players[charPlayerIdx].characters[targetCharacterId] : undefined;
        const charDef = charInPlay ? defById(state, charInPlay.definitionId) : undefined;
        const baseProwess = charDef && isCharacterCard(charDef) ? charDef.prowess : 0;
        const targetCompany = charPlayerIdx >= 0
          ? findCharacterCompany(state.players[charPlayerIdx].companies, targetCharacterId)
          : undefined;
        const characterCount = targetCompany?.characters.length ?? 1;
        constraintValue = Math.round(evaluateExpr(apply.valueExpr, { target: { baseProwess }, company: { characterCount } }));
      } else if (typeof apply.value === 'number') {
        constraintValue = apply.value;
      } else if (apply.prowessSubstitution) {
        // Threats (le-244): the payload is a resolution-time prowess
        // substitution, not a baked value — the modifier is computed when the
        // influence check consumes the constraint.
        constraintValue = 0;
      } else {
        return { error: `${def.name} option '${option.id}': check-modifier requires 'value' (number) or 'valueExpr' (expression)` };
      }
      kind = {
        type: 'check-modifier',
        check: apply.check,
        value: constraintValue,
        ...(apply.prowessSubstitution ? { prowessSubstitution: apply.prowessSubstitution } : {}),
      };
      break;
    }
    case 'hazard-limit-modifier':
      if (typeof apply.value !== 'number') {
        return { error: `${def.name} option '${option.id}': hazard-limit-modifier requires numeric 'value'` };
      }
      kind = { type: 'hazard-limit-modifier', value: apply.value };
      break;
    case 'site-type-override': {
      // Changes destination site type during M/H phase (e.g. Deeper Shadow: R→S).
      const overrideType = (apply as { overrideType?: string }).overrideType;
      if (!overrideType) {
        return { error: `${def.name} option '${option.id}': site-type-override requires 'overrideType'` };
      }
      if (state.phaseState.phase !== Phase.MovementHazard) {
        return { error: `${def.name} option '${option.id}': site-type-override only valid during M/H phase` };
      }
      const mh = state.phaseState;
      // Resolve the destination site definition ID from the active company
      const charPlayerIdx2 = state.players.findIndex(p => targetCharacterId as string in p.characters);
      const charCompany2 = charPlayerIdx2 >= 0
        ? findCharacterCompany(state.players[charPlayerIdx2].companies, targetCharacterId)
        : undefined;
      let destSiteDefId: string | null = null;
      if (charCompany2?.destinationSite?.instanceId) {
        const resolved = resolveInstanceId(state, charCompany2.destinationSite.instanceId);
        if (resolved) destSiteDefId = resolved as string;
      }
      if (!destSiteDefId && mh.destinationSiteName) {
        for (const [defId, d] of Object.entries(state.cardPool)) {
          const ct = (d as { cardType?: string }).cardType;
          const name = (d as { name?: string }).name;
          if (ct?.includes('site') && name === mh.destinationSiteName) {
            destSiteDefId = defId;
            break;
          }
        }
      }
      if (!destSiteDefId) {
        logDetail(`${def.name} option '${option.id}': site-type-override — no destination site found, fizzle`);
        return { state };
      }
      kind = {
        type: 'attribute-modifier',
        attribute: 'site.type',
        op: 'override',
        value: overrideType,
        filter: { 'site.definitionId': destSiteDefId },
      };
      break;
    }
    case 'region-type-override': {
      // Changes a region type in the site path during M/H phase (e.g. Deeper Shadow: w→s).
      const overrideType = (apply as { overrideType?: string }).overrideType;
      let regionName = (apply as { regionName?: string }).regionName;
      if (!overrideType || !regionName) {
        return { error: `${def.name} option '${option.id}': region-type-override requires 'overrideType' and 'regionName'` };
      }
      if (state.phaseState.phase !== Phase.MovementHazard) {
        return { error: `${def.name} option '${option.id}': region-type-override only valid during M/H phase` };
      }
      const mhRt = state.phaseState;
      // Resolve 'destination' token to the last region in the resolved path
      if (regionName === 'destination') {
        if (mhRt.resolvedSitePathNames.length === 0) {
          logDetail(`${def.name} option '${option.id}': region-type-override — no resolved path names, fizzle`);
          return { state };
        }
        regionName = mhRt.resolvedSitePathNames[mhRt.resolvedSitePathNames.length - 1];
      }
      kind = {
        type: 'attribute-modifier',
        attribute: 'region.type',
        op: 'override',
        value: overrideType,
        filter: { 'region.name': regionName },
      };
      break;
    }
    default:
      return { error: `${def.name} option '${option.id}': unsupported constraint kind '${constraintName}'` };
  }

  const target: import('../types/pending.js').ActiveConstraint['target'] = isCompanyTargeted
    ? { kind: 'company', companyId: companyId! }
    : { kind: 'character', characterId: targetCharacterId };

  // METD §5: hazard-limit-modifier additions during the site phase have
  // no effect — the hazard limit is locked at the moment a company
  // reveals its new site.
  if (kind.type === 'hazard-limit-modifier' && state.phaseState.phase === Phase.Site) {
    logDetail(`${def.name} option "${option.id}": hazard-limit-modifier ignored — site-phase additions have no effect (METD §5)`);
    return { state };
  }

  logDetail(`${def.name} option "${option.id}": add ${constraintName} on ${isCompanyTargeted ? `company ${companyId as string}` : `character ${targetCharacterId as string}`}, scope ${scopeName}`);
  return {
    state: addConstraint(state, {
      source: handCard.instanceId,
      sourceDefinitionId: handCard.definitionId,
      scope,
      target,
      kind,
    }),
  };
}

/**
 * Process `on-event: self-enters-play` effects for a resource short-event.
 * Currently handles `add-constraint` effects, where the target company is
 * derived from the action's target scout.
 */
function applyShortEventOnEntersPlay(
  state: GameState,
  def: CardDefinition,
  handCard: CardInstance,
  action: GameAction,
  playerIndex: number,
  skipEnqueueCorruptionCheck = false,
): GameState {
  for (const onEvent of getOnEventEffects(def, 'self-enters-play')) {

    // win-game: a One Ring win played directly on resolution (no roll),
    // e.g. Gollum's Fate (tw-247). The game ends immediately for the
    // controller; final scores are still computed for the result screen.
    if (onEvent.apply.type === 'win-game') {
      const winner = state.players[playerIndex].id;
      logHeading(`"${def.name}" resolves — ${state.players[playerIndex].name} wins with The One Ring (CoE 10.39)`);
      state = oneRingWin(state, winner, handCard.definitionId, onEvent.apply.destroysOneRing);
      continue;
    }

    if (onEvent.apply.type === 'enqueue-corruption-check') {
      // When a fetch sub-flow is active, the corruption check is deferred as
      // postCorruptionCheck on the pending effect so it fires after the last
      // pick (not as a blocking pendingResolution during the fetch).
      if (skipEnqueueCorruptionCheck) {
        logDetail(`enqueue-corruption-check: deferred to postCorruptionCheck (fetch sub-flow active)`);
        continue;
      }
      const characterId = action.type === 'play-short-event' ? action.targetCharacterId : undefined;
      if (!characterId) {
        logDetail(`enqueue-corruption-check: no target character — fizzle`);
        continue;
      }
      // If the effect has a `when` condition, evaluate it against the target
      // character's definition. Used e.g. by Deeper Shadow to skip the check
      // for Ringwraith characters ("Unless he is a Ringwraith, ...").
      if (onEvent.when) {
        const charInPlay = state.players[playerIndex].characters[characterId];
        const charDef = charInPlay ? defById(state, charInPlay.definitionId) : undefined;
        const targetRace = charDef && isCharacterCard(charDef) ? charDef.race : undefined;
        const whenCtx = { target: { race: targetRace } };
        if (!matchesCondition(onEvent.when, whenCtx)) {
          logDetail(`"${def.name}" enqueue-corruption-check: when condition not met for ${characterId as string} — skipping`);
          continue;
        }
      }
      const modifier = (onEvent.apply.modifier) ?? 0;
      logDetail(`"${def.name}" played — enqueuing corruption check on ${characterId as string} (modifier ${modifier})`);
      state = enqueueCorruptionCheck(state, {
        source: handCard.instanceId,
        actor: state.players[playerIndex].id,
        scope: { kind: 'phase', phase: state.phaseState.phase },
        characterId,
        modifier,
        reason: def.name,
        onSuccess: onEvent.apply.onSuccess,
      });
      continue;
    }

    // Where There's a Whip (le-254): the target (an untapped Orc/Troll bearing
    // a Whip) disciplines his own company. Every other tapped character with a
    // mind and lower prowess makes a body check (modifier added to the roll);
    // per CoE 3.I.3 a failing Orc/Troll is discarded instead of wounded, every
    // other race is wounded instead of eliminated. Members excluded from the
    // check (untapped, no mind, or prowess not lower than the bearer's) are
    // untapped immediately since their outcome never depended on a roll.
    if (onEvent.apply.type === 'whip-discipline') {
      const bearerId = action.type === 'play-short-event' ? action.targetCharacterId : undefined;
      const bearer = bearerId ? state.players[playerIndex].characters[bearerId] : undefined;
      const bearerDef = bearer ? defById(state, bearer.definitionId) : undefined;
      const company = bearerId ? findCharacterCompany(state.players[playerIndex].companies, bearerId) : undefined;
      if (!bearerId || !bearer || !bearerDef || !isCharacterCard(bearerDef) || !company) {
        logDetail(`"${def.name}": whip-discipline — bearer or company not found — fizzle`);
        continue;
      }
      const bearerProwess = bearer.effectiveStats.prowess;
      const modifier = onEvent.apply.modifier;
      const toCheck: CardInstanceId[] = [];
      for (const charId of company.characters) {
        const char = state.players[playerIndex].characters[charId];
        const charDef = char ? defById(state, char.definitionId) : undefined;
        if (!char || !charDef || !isCharacterCard(charDef)) continue;
        const mind = char.effectiveStats.mind ?? charDef.mind;
        const eligible = char.status === CardStatus.Tapped
          && mind != null && mind > 0
          && char.effectiveStats.prowess < bearerProwess;
        if (eligible) {
          toCheck.push(charId);
        } else if (char.status !== CardStatus.Inverted) {
          // Not disciplined this round (excluded, or already untapped) —
          // unwounded, so untap immediately; its fate never depended on a roll.
          state = updatePlayer(state, playerIndex, p => updateCharacter(p, charId, c => ({ ...c, status: CardStatus.Untapped })));
        }
      }
      logDetail(`"${def.name}" played on ${bearerDef.name} (prowess ${bearerProwess}) — disciplining ${toCheck.length} follower(s)`);
      for (const charId of toCheck) {
        const char = state.players[playerIndex].characters[charId];
        const charDef = defById(state, char.definitionId);
        if (!charDef || !isCharacterCard(charDef)) continue;
        const isOrcTroll = charDef.race === Race.Orc || charDef.race === Race.Troll;
        const discardValues = isOrcTroll && charDef.cardType === 'minion-character' && charDef.discardBodyCheck != null
          ? charDef.discardBodyCheck
          : [];
        const threshold = discardValues.length > 0 ? Math.min(...discardValues) : char.effectiveStats.body;
        logDetail(`"${def.name}": ${charDef.name} makes a body check (threshold ${threshold}, roll modifier ${modifier})`);
        state = enqueueResolution(state, {
          source: handCard.instanceId,
          actor: state.players[playerIndex].id,
          scope: { kind: 'phase', phase: state.phaseState.phase },
          kind: {
            type: 'dice-check',
            label: `Body check (${def.name}): ${charDef.name}`,
            modifiers: [{ kind: 'constant', value: modifier }],
            threshold,
            comparison: 'gt',
            onPass: isOrcTroll ? { type: 'discard-character' } : { type: 'set-character-status', status: 'inverted' },
            onFail: { type: 'set-character-status', status: 'untapped' },
            continuation: { kind: 'dequeue-only' },
            requireTargetPresent: true,
            targetCharacterId: charId,
          },
        });
      }
      continue;
    }

    // A Malady Without Healing (le-159): the target (possibly an opponent's
    // character) makes a corruption check (-1) then, if it survives, a body
    // check (+1 if tapped); a hero eliminated by either credits the caster his
    // kill MP. Separately, unless the caster's shadow-magic user at the target's
    // site is a Ringwraith, that user makes a corruption check (-5).
    if (onEvent.apply.type === 'malady-without-healing') {
      const targetId = action.type === 'play-short-event' ? action.targetCharacterId : undefined;
      if (!targetId) {
        logDetail(`"${def.name}": malady-without-healing — no target character — fizzle`);
        continue;
      }
      const ownerIdx = state.players.findIndex(p => !!p.characters[targetId]);
      if (ownerIdx < 0) {
        logDetail(`"${def.name}": malady-without-healing — target ${targetId as string} not in play — fizzle`);
        continue;
      }
      const casterId = state.players[playerIndex].id;
      const targetOwnerId = state.players[ownerIdx].id;
      const targetCompany = findCharacterCompany(state.players[ownerIdx].companies, targetId);
      // Co-location is matched by site *name*: an opposing target stands at the
      // other alignment's version of the same location (e.g. hero Rivendell vs
      // minion Rivendell), so definition ids would never match.
      const targetSiteName = companySiteName(state, targetCompany);

      // Collect the caster's shadow-magic users co-located with the target
      // (excluding the target itself). A Ringwraith among them lets the caster
      // avoid the -5 check; otherwise the first non-Ringwraith user makes it.
      const caster = state.players[playerIndex];
      const enablers: { id: CardInstanceId; isRingwraith: boolean }[] = [];
      for (const co of caster.companies) {
        if (!targetSiteName || companySiteName(state, co) !== targetSiteName) continue;
        for (const cid of co.characters) {
          if (cid === targetId) continue;
          const ch = caster.characters[cid];
          if (!ch) continue;
          const cDef = defById(state, ch.definitionId);
          if (!cDef || !isCharacterCard(cDef)) continue;
          const isRingwraith = cDef.race === Race.Ringwraith;
          const usesShadowMagic = isRingwraith
            || getEffectiveSkills(state, ch, cDef).includes('shadow-magic');
          if (usesShadowMagic) enablers.push({ id: cid, isRingwraith });
        }
      }

      const targetMod = onEvent.apply.targetCorruptionModifier;
      logDetail(`"${def.name}" played on ${targetId as string} (owner ${targetOwnerId as string}) — enqueuing corruption check (modifier ${targetMod}) + follow-up body check`);
      state = enqueueCorruptionCheck(state, {
        source: handCard.instanceId,
        actor: targetOwnerId,
        scope: { kind: 'phase', phase: state.phaseState.phase },
        characterId: targetId,
        modifier: targetMod,
        reason: def.name,
        awardKillMpTo: casterId,
        onSuccess: {
          type: 'enqueue-body-check',
          rollerPlayerId: casterId,
          plusOneIfTapped: true,
          awardKillMpTo: casterId,
          reason: `${def.name} (body)`,
        },
      });

      const ringwraithEnabler = enablers.find(e => e.isRingwraith);
      if (!ringwraithEnabler && enablers.length > 0) {
        const casterMod = onEvent.apply.casterCorruptionModifier;
        logDetail(`"${def.name}": shadow-magic user ${enablers[0].id as string} is not a Ringwraith — enqueuing corruption check (modifier ${casterMod})`);
        state = enqueueCorruptionCheck(state, {
          source: handCard.instanceId,
          actor: casterId,
          scope: { kind: 'phase', phase: state.phaseState.phase },
          characterId: enablers[0].id,
          modifier: casterMod,
          reason: `${def.name} (shadow-magic user)`,
        });
      } else if (ringwraithEnabler) {
        logDetail(`"${def.name}": shadow-magic user is a Ringwraith — no corruption check for the caster`);
      }
      continue;
    }

    if (onEvent.apply.type === 'set-site-phase-flag') {
      const flagName = onEvent.apply.flag;
      if (!flagName) {
        logDetail(`"${def.name}": set-site-phase-flag missing flag name — ignored`);
        continue;
      }
      if (state.phaseState.phase !== Phase.Site) {
        logDetail(`"${def.name}": set-site-phase-flag(${flagName}) played outside site phase — no effect`);
        continue;
      }
      logDetail(`"${def.name}" played — ${flagName} set`);
      state = { ...state, phaseState: { ...state.phaseState, [flagName]: true } };
      continue;
    }

    // set-character-status: untap/tap/wound the target character (e.g. Hundreds of Butterflies).
    if (onEvent.apply.type === 'set-character-status') {
      const characterId = action.type === 'play-short-event' ? action.targetCharacterId : undefined;
      if (!characterId) {
        logDetail(`"${def.name}": set-character-status — no target character — fizzle`);
        continue;
      }
      const targetChar = state.players[playerIndex].characters[characterId];
      if (!targetChar) {
        logDetail(`"${def.name}": set-character-status — target character not found — fizzle`);
        continue;
      }
      const nextStatus = onEvent.apply.status;
      // Preserve the historical default: a set-character-status apply with no
      // declared status inverts (wounds) the target here.
      const statusEnum = nextStatus === undefined ? CardStatus.Inverted : cardStatusFromName(nextStatus);
      logDetail(`"${def.name}" played — set ${characterId as string} status → ${nextStatus ?? 'unknown'}`);
      state = updatePlayer(state, playerIndex, p => ({
        ...p,
        characters: { ...p.characters, [characterId as string]: { ...targetChar, status: statusEnum } },
      }));
      continue;
    }

    if (onEvent.apply.type === 'add-constraint') {
      const constraintKind = onEvent.apply.constraint;
      const scopeName = onEvent.apply.scope;
      if (!constraintKind || !scopeName) continue;

      // auto-attack-prowess-boost: a site-scoped modifier on the prowess of
      // every automatic-attack the active site-phase company faces (Come By
      // Night Upon Them le-176). Resolved against the active company's current
      // site (no target character); the modifier persists for the whole site
      // phase (not consumed after the first attack). The `value` is doubled at
      // play time when Doors of Night is in play (the card is played immediately
      // before the auto-attacks resolve, so baking the doubled amount is exact).
      if (constraintKind === 'auto-attack-prowess-boost') {
        if (state.phaseState.phase !== Phase.Site) {
          logDetail(`"${def.name}": auto-attack-prowess-boost played outside site phase — no effect`);
          continue;
        }
        const activeIndex = state.phaseState.activeCompanyIndex;
        const activeCompany = state.players[playerIndex].companies[activeIndex];
        if (!activeCompany?.currentSite) {
          logDetail(`"${def.name}": auto-attack-prowess-boost — active company has no current site — fizzle`);
          continue;
        }
        const baseValue = onEvent.apply.value;
        const siteType = onEvent.apply.siteType;
        if (typeof baseValue !== 'number' || !siteType) {
          logDetail(`"${def.name}": auto-attack-prowess-boost missing value or siteType — fizzle`);
          continue;
        }
        const scope = parseConstraintScope(scopeName, activeCompany.id);
        if (!scope) {
          logDetail(`"${def.name}": auto-attack-prowess-boost unknown scope "${scopeName}" — fizzle`);
          continue;
        }
        const doorsOfNight = onEvent.apply.doublesWithDoorsOfNight === true
          && buildInPlayNames(state).includes('Doors of Night');
        const value = doorsOfNight ? baseValue * 2 : baseValue;
        logDetail(`"${def.name}" played — adding persistent auto-attack.prowess ${value} to all automatic-attacks at ${activeCompany.currentSite.definitionId as string} (site type ${siteType}${doorsOfNight ? ', doubled: Doors of Night in play' : ''}), scope ${scopeName}`);
        state = addConstraint(state, {
          source: handCard.instanceId,
          sourceDefinitionId: handCard.definitionId,
          scope,
          target: { kind: 'company', companyId: activeCompany.id },
          kind: {
            type: 'attribute-modifier',
            attribute: 'auto-attack.prowess',
            op: 'add',
            value,
            filter: { 'site.type': siteType },
            persistent: true,
          },
        });
        continue;
      }

      // character-stat-modifier: applied to a single targeted character (e.g. Vilya).
      if (constraintKind === 'character-stat-modifier') {
        const characterId = action.type === 'play-short-event' ? action.targetCharacterId : undefined;
        if (!characterId) {
          logDetail(`add-constraint(character-stat-modifier): no target character — fizzle`);
          continue;
        }
        const stat = onEvent.apply.stat;
        const value = onEvent.apply.value;
        if (!stat || typeof value !== 'number') {
          logDetail(`add-constraint(character-stat-modifier): missing stat or value — fizzle`);
          continue;
        }
        // Optional "while <card> is in play" gate (Heart of Dark Fire ba-63):
        // the bonus is re-checked by the resolver and lapses if the named card
        // leaves play mid-turn.
        const requiresCardInPlay = onEvent.apply.requiresCardInPlay;
        const gateSuffix = requiresCardInPlay ? ` while ${requiresCardInPlay} in play` : '';
        logDetail(`"${def.name}" played — adding character-stat-modifier ${stat} ${value > 0 ? '+' : ''}${value} on ${characterId as string} (scope ${scopeName})${gateSuffix}`);
        state = addConstraint(state, {
          source: handCard.instanceId,
          sourceDefinitionId: handCard.definitionId,
          scope: { kind: 'turn' },
          target: { kind: 'character', characterId },
          kind: { type: 'character-stat-modifier', stat, value, characterId, ...(requiresCardInPlay ? { requiresCardInPlay } : {}) },
        });
        continue;
      }

      // Player-scoped check-modifier (e.g. Terror Heralds Doom ba-78: "+2 to all
      // influence attempts this turn by any of your characters"). Unlike the
      // one-shot character-targeted check-modifier (Muster), a `target: 'player'`
      // modifier applies to *every* influence check the player's characters make
      // for the constraint's scope and is never consumed. Read by the faction
      // influence resolution (reducer-site.ts / legal-actions/site.ts).
      if (constraintKind === 'check-modifier' && onEvent.apply.target === 'player') {
        const check = onEvent.apply.check;
        const value = onEvent.apply.value;
        if (!check || typeof value !== 'number') {
          logDetail(`add-constraint(check-modifier, player): missing check or value — fizzle`);
          continue;
        }
        const scope = parseConstraintScope(scopeName, null);
        if (!scope) {
          logDetail(`add-constraint(check-modifier, player): unknown scope "${scopeName}" — fizzle`);
          continue;
        }
        const playerId = state.players[playerIndex].id;
        logDetail(`"${def.name}" played — adding player-scoped check-modifier ${check} ${value > 0 ? '+' : ''}${value} for ${playerId as string} (scope ${scopeName})`);
        state = addConstraint(state, {
          source: handCard.instanceId,
          sourceDefinitionId: handCard.definitionId,
          scope,
          target: { kind: 'player', playerId },
          kind: { type: 'check-modifier', check, value },
        });
        continue;
      }

      // Player-scoped site-path-reduction (Roam the Waste ba-73: "Each of your
      // companies this turn is considered to have one fewer Wilderness and one
      // fewer Shadow-land in its site path"). Turn-scoped, player-targeted; read
      // when each moving company's resolved site path is built.
      if (constraintKind === 'site-path-reduction' && onEvent.apply.target === 'player') {
        const reductions = onEvent.apply.regionReductions;
        if (!reductions || Object.keys(reductions).length === 0) {
          logDetail(`add-constraint(site-path-reduction): missing regionReductions — fizzle`);
          continue;
        }
        const scope = parseConstraintScope(scopeName, null);
        if (!scope) {
          logDetail(`add-constraint(site-path-reduction): unknown scope "${scopeName}" — fizzle`);
          continue;
        }
        const playerId = state.players[playerIndex].id;
        logDetail(`"${def.name}" played — adding player-scoped site-path-reduction ${JSON.stringify(reductions)} for ${playerId as string} (scope ${scopeName})`);
        state = addConstraint(state, {
          source: handCard.instanceId,
          sourceDefinitionId: handCard.definitionId,
          scope,
          target: { kind: 'player', playerId },
          kind: { type: 'site-path-reduction', reductions: reductions as Partial<Record<import('../types/common.js').RegionType, number>> },
        });
        continue;
      }

      // Company-targeting constraints: resolve the target company from targetCompanyId
      // (company-targeted events, e.g. Great-road) or from the scout/character instance
      // (tap-cost events, e.g. Stealth, or filter-character events, e.g. Hundreds of Butterflies).
      const player = state.players[playerIndex];
      let company: import('../types/state-cards.js').Company | undefined;
      if (action.type === 'play-short-event' && action.targetCompanyId) {
        company = companyById(player.companies, action.targetCompanyId);
        if (!company) {
          logDetail(`add-constraint(${constraintKind}): company ${action.targetCompanyId as string} not found — fizzle`);
          continue;
        }
      } else {
        const targetCharId = action.type === 'play-short-event'
          ? (action.targetScoutInstanceId ?? action.targetCharacterId)
          : undefined;
        if (!targetCharId) {
          logDetail(`add-constraint(${constraintKind}): no target character — fizzle`);
          continue;
        }
        company = findCharacterCompany(player.companies, targetCharId);
        if (!company) {
          logDetail(`add-constraint(${constraintKind}): scout ${targetCharId as string} not in any company — fizzle`);
          continue;
        }
      }

      const scope = parseConstraintScope(scopeName, company.id);
      if (!scope) {
        logDetail(`add-constraint(${constraintKind}): unknown scope "${scopeName}" — fizzle`);
        continue;
      }

      // Map constraint name to kind
      type Kind = import('../types/pending.js').ActiveConstraint['kind'];
      let kind: Kind;
      switch (constraintKind) {
        case 'no-creature-hazards-on-company':
          kind = { type: 'no-creature-hazards-on-company' };
          break;
        case 'only-creatures-keyed-to-site':
          kind = { type: 'only-creatures-keyed-to-site' };
          break;
        case 'only-creatures-keyed-to-site-at-ruins-lairs':
          kind = { type: 'only-creatures-keyed-to-site-at-ruins-lairs' };
          break;
        case 'extra-mh-phase': {
          // Master of Esgaroth (td-135): "Playable at the end of the
          // organization phase on a moving company. If the company moves to a
          // Border-hold, it can take a second movement/hazard phase." The
          // destination is not final at play time, so the site-type gate rides
          // on the constraint and is evaluated by `advanceAfterCompanyMH`.
          const required = onEvent.apply.requiresDestinationSiteType as
            import('../types/common.js').SiteType | undefined;
          kind = { type: 'extra-mh-phase', ...(required ? { requiresDestinationSiteType: required } : {}) };
          break;
        }
        case 'no-creatures-keyed-to-site': {
          const unless = onEvent.apply.unlessSiteRegionType as import('../types/common.js').RegionType | undefined;
          kind = { type: 'no-creatures-keyed-to-site', ...(unless ? { unlessSiteRegionType: unless } : {}) };
          break;
        }
        case 'company-cannot-move':
          // "The company may not move to another site this turn" (Hiding
          // tw-256). End-of-org cards are played *alongside* the other
          // organization actions, so the company may already have declared a
          // destination — locking it stationary has to strip that declaration
          // (returning the site card to the location deck) as well as barring a
          // fresh one, exactly as Siege's `lock-company-movement` does. A no-op
          // for a company that never planned a move (Hide in Dark Places
          // le-192, which may only target a non-moving company).
          if (company.destinationSite) {
            logDetail(`"${def.name}": company ${company.id as string} may not move this turn — dropping its declared destination`);
            state = clearPlannedMovement(state, playerIndex, company.id);
          }
          kind = { type: 'company-cannot-move' };
          break;
        case 'site-phase-do-nothing':
          kind = { type: 'site-phase-do-nothing' };
          break;
        case 'deny-scout-resources':
          kind = { type: 'deny-scout-resources' };
          break;
        case 'hazard-limit-modifier': {
          if (typeof onEvent.apply.value !== 'number') {
            logDetail(`add-constraint(hazard-limit-modifier): missing numeric value — fizzle`);
            continue;
          }
          kind = { type: 'hazard-limit-modifier', value: onEvent.apply.value };
          break;
        }
        case 'granted-action': {
          const payload = onEvent.apply.grantedAction;
          if (!payload) {
            logDetail(`add-constraint(granted-action): missing grantedAction payload — fizzle`);
            continue;
          }
          kind = {
            type: 'granted-action',
            action: payload.action,
            phase: payload.phase as import('../types/state-phases.js').Phase,
            window: payload.window,
            cost: payload.cost,
            when: payload.when,
            apply: payload.apply,
          };
          break;
        }
        case 'hazard-draw-multiplier': {
          const multiplier = typeof onEvent.apply.value === 'number' ? onEvent.apply.value : 2;
          kind = { type: 'hazard-draw-multiplier', multiplier };
          break;
        }
        case 'haven-return-option': {
          if (!company.currentSite) {
            logDetail(`add-constraint(haven-return-option): company has no current site — fizzle`);
            continue;
          }
          kind = {
            type: 'haven-return-option',
            originHavenInstanceId: company.currentSite.instanceId,
            originHavenDefinitionId: company.currentSite.definitionId,
            originHavenStatus: company.currentSite.status,
          };
          break;
        }
        default:
          logDetail(`add-constraint: unknown constraint kind "${constraintKind}" — fizzle`);
          continue;
      }

      logDetail(`"${def.name}" played — adding constraint ${constraintKind} on company ${company.id as string}, scope ${scopeName}`);
      state = addConstraint(state, {
        source: handCard.instanceId,
        sourceDefinitionId: handCard.definitionId,
        scope,
        target: { kind: 'company', companyId: company.id },
        kind,
      });
    }

    if (onEvent.apply.type === 'enqueue-ring-play-offer') {
      // "Secrets of Their Forging" path: bypass gold-ring dice roll and offer
      // ALL categories from the ring's test table (minus any excluded ones).
      // The action must carry the gold ring to discard as targetGoldRingInstanceId.
      const goldRingInstanceId = action.type === 'play-short-event'
        ? action.targetGoldRingInstanceId
        : undefined;
      if (!goldRingInstanceId) {
        logDetail(`"${def.name}": enqueue-ring-play-offer — no gold ring instance — fizzle`);
        continue;
      }

      // Locate the gold ring in any character's items (resource player's characters).
      const actor = state.players[playerIndex];
      const removedRing = removeAttachment(actor, 'items', goldRingInstanceId);
      if (!removedRing) {
        logDetail(`"${def.name}": enqueue-ring-play-offer — gold ring ${goldRingInstanceId as string} not found — fizzle`);
        continue;
      }

      // Compute all eligible categories from the ring's test table, minus excluded ones.
      const ringCard = removedRing.attachment;
      const ringDef = resolveDef(state, ringCard.instanceId);
      const ringEffects: readonly unknown[] = ringDef && 'effects' in (ringDef as object)
        ? ((ringDef as unknown as { effects?: readonly unknown[] }).effects ?? [])
        : [];
      const tableEffect = ringEffects.find(
        (e): e is RingTestTableEffect => (e as { type?: string }).type === 'ring-test-table',
      );
      const excludeCategories: readonly string[] = (onEvent.apply as unknown as { excludeCategories?: readonly string[] }).excludeCategories ?? [];
      let eligibleCategories: readonly RingCategory[];
      if (tableEffect) {
        // Collect every unique category from the table regardless of roll bounds —
        // Secrets of Their Forging bypasses the dice roll entirely.
        const seen = new Set<string>();
        const allCategories: RingCategory[] = [];
        for (const row of tableEffect.table) {
          if (!seen.has(row.category)) {
            seen.add(row.category);
            allCategories.push(row.category);
          }
        }
        eligibleCategories = allCategories.filter(c => !excludeCategories.includes(c));
      } else {
        eligibleCategories = [];
      }
      logDetail(`"${def.name}": enqueue-ring-play-offer — ring ${String(ringDef?.name ?? goldRingInstanceId)}, eligible: ${eligibleCategories.join(', ') || 'none'}`);

      // Discard the gold ring from the bearer.
      state = updatePlayer(state, playerIndex, () => ({
        ...removedRing.player,
        discardPile: [...removedRing.player.discardPile, ringCard],
      }));

      // Tap the active company's current site (site phase only), unless it carries never-taps.
      if (state.phaseState.phase === Phase.Site) {
        const siteState = state.phaseState;
        const activePlayerIndex = getPlayerIndex(state, state.activePlayer!);
        const companies = state.players[activePlayerIndex].companies;
        const company = companies[siteState.activeCompanyIndex];
        if (company?.currentSite) {
          const siteDef = defById(state, company.currentSite.definitionId);
          const neverTaps = siteDef && 'effects' in (siteDef as object)
            && ((siteDef as unknown as { effects?: readonly { type: string; rule?: string }[] }).effects ?? [])
              .some(e => e.type === 'site-rule' && e.rule === 'never-taps');
          if (!neverTaps) {
            const updatedCompanies = [...companies];
            updatedCompanies[siteState.activeCompanyIndex] = {
              ...company,
              currentSite: { ...company.currentSite, status: CardStatus.Tapped },
            };
            state = updatePlayer(state, activePlayerIndex, p => ({ ...p, companies: updatedCompanies }));
          }
        }
      }

      // Enqueue the ring-play-offer pending resolution.
      state = enqueueResolution(state, {
        source: handCard.instanceId,
        actor: actor.id,
        scope: { kind: 'phase', phase: state.phaseState.phase },
        kind: {
          type: 'ring-play-offer',
          characterInstanceId: removedRing.charId,
          eligibleCategories,
          rollTotal: 999,
          storedPlacement: false,
        },
      });
    }

    if (onEvent.apply.type === 'enqueue-gold-ring-test') {
      // "Test of Fire" path (le-239): run the full Rule 6.2 gold-ring test on
      // the chosen gold ring borne by a character in a sage's company. The
      // action carries the gold ring as `targetGoldRingInstanceId`; the shared
      // `gold-ring-test` pending resolution rolls 2d6 (plus this rollModifier),
      // consults the ring's own `ring-test-table`, discards the ring, and
      // offers a matching special ring to replace it.
      const goldRingInstanceId = action.type === 'play-short-event'
        ? action.targetGoldRingInstanceId
        : undefined;
      if (!goldRingInstanceId) {
        logDetail(`"${def.name}": enqueue-gold-ring-test — no gold ring instance — fizzle`);
        continue;
      }

      // Locate the bearer of the gold ring. The ring stays in the character's
      // items; the pending resolution finds and discards it on resolution.
      const actor = state.players[playerIndex];
      let bearerId: CardInstanceId | undefined;
      for (const [charIdStr, char] of Object.entries(actor.characters)) {
        if (char.items.some(i => i.instanceId === goldRingInstanceId)) {
          bearerId = charIdStr as CardInstanceId;
          break;
        }
      }
      if (!bearerId) {
        logDetail(`"${def.name}": enqueue-gold-ring-test — gold ring ${goldRingInstanceId as string} not borne by any character — fizzle`);
        continue;
      }

      const rollModifier = (onEvent.apply as { rollModifier?: number }).rollModifier ?? 0;
      // rollCount > 1 (Wizard's Test tw-365): the player rolls that many times
      // and then chooses which result the test uses.
      const rollCount = (onEvent.apply as { rollCount?: number }).rollCount ?? 1;
      logDetail(`"${def.name}": enqueue-gold-ring-test on ring ${goldRingInstanceId as string} (bearer ${bearerId as string}, roll modifier ${rollModifier}${rollCount > 1 ? `, ${rollCount} rolls — player chooses one` : ''})`);
      state = enqueueResolution(state, {
        source: handCard.instanceId,
        actor: actor.id,
        scope: { kind: 'phase', phase: state.phaseState.phase },
        kind: {
          type: 'gold-ring-test',
          goldRingInstanceId,
          rollModifier,
          characterInstanceId: bearerId,
          ...(rollCount > 1 ? { rollCount } : {}),
        },
      });
    }
  }

  return state;
}

/**
 * Handle fetching a card from sideboard or discard pile into the play deck.
 *
 * Part of the fetch-to-deck effect resolution. The current effect is the
 * first entry in {@link GameState.pendingEffects}. After the fetch,
 * the effect is consumed; if no more effects remain, the event card moves
 * from cardsInPlay to the player's discard pile.
 */


/**
 * Handle playing a resource long-event card during the long-event phase.
 * Removes the card from hand, places it on the chain, and initiates/pushes
 * a chain of effects. The card enters play upon resolution (see chain-reducer).
 */
function handlePlayLongEvent(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'play-long-event') return wrongActionType(state, action, 'play-long-event');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const handCard = findById(player.hand, action.cardInstanceId);
  if (!handCard) return { state, error: 'Card not found in hand' };
  const def = state.cardPool[handCard.definitionId] as import('../types/cards-resources.js').HeroResourceEventCard;

  logDetail(`Playing resource long-event: ${def.name} → enters chain`);

  // Remove card from hand — it now resides on the chain
  const newHand = removeById(player.hand, handCard.instanceId);

  let newState: GameState = updatePlayer(state, playerIndex, p => ({ ...p, hand: newHand }));

  // Initiate or push onto chain — card enters play upon resolution
  newState = initiateOrPushChain(newState, action.player, handCard, { type: 'long-event' });

  return { state: newState };
}

/**
 * Handle actions during the Movement/Hazard phase.
 *
 * The phase begins with the 'select-company' step where the resource player
 * picks which company to handle next. After all companies are handled, the
 * phase advances to the Site phase.
 */

