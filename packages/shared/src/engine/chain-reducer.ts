/**
 * @module chain-reducer
 *
 * Reducer logic for the chain of effects sub-state.
 *
 * Handles chain initiation, priority passing, resolution loop, nested chains
 * (on-guard interrupts, body checks), and deferred passive condition processing.
 *
 * The chain reducer is called from the main {@link reduce} function when the
 * action type is chain-specific (`pass-chain-priority`, `order-passives`).
 * Card-play actions that are chain-aware (short events, creatures, etc.) call
 * helpers from this module to push entries onto the chain stack.
 */

import type { GameState, GameAction, PlayerId, PlayerState, CardInstance, CardInstanceId, CardDefinitionId, ChainState, ChainEntry, ChainEntryPayload, ChainRestriction, DeferredPassive, CombatState, CreatureCard, PendingEffect, CancelReturnToOriginAction, CounterCancelAttackAction } from '../index.js';
import type { HavenJumpOffer, PostAttackEffect, StrikeAssignment } from '../types/state-combat.js';
import { nextStrikePhase } from './combat-strike.js';
import type { OnEventEffect, PlayTargetEffect, TriggerAttackOnPlayEffect, ForceCheckAllCompanyTopEffect, FlatteryCancelAttackEffect, RiddlingAttemptEffect, TapSitesInPlayEffect, CombatBodyPerDefenderSkillEffect, CombatStrikeEffectEffect } from '../types/effects.js';
import { matchesCondition } from '../effects/condition-matcher.js';
import { hasPlayFlag } from '../effects/play-flags.js';
import { getPlayerIndex, isMinionOrBalrog, companyContainsBalrogAvatar } from '../state-utils.js';
import { isSiteCard, isAvatarCharacter, isAllyCard, isCharacterCard, isFactionCard, isItemCard, printedMind } from '../types/cards.js';
import { placeCardSetAside } from './set-aside.js';
import { ownerOf } from '../types/state.js';
import { CardStatus, cardStatusFromName, SiteType, Race, RegionType } from '../types/common.js';
import { resolveInstanceId } from '../types/state.js';
import { formatSignedNumber } from '../format-helpers.js';
import { logHeading, logDetail } from './legal-actions/log.js';
import { applyMove, moveToFetchToDeckPayload } from './reducer-move.js';
import { availableDI } from './legal-actions/organization.js';
import type { ReducerResult } from './reducer.js';
import { resolveAttackProwess, resolveAttackStrikes, resolveAttackBody, isWardedAgainst, normalizeCreatureRace, resolveDef, resolveHandSize, getEffectiveSkills } from './effects/index.js';
import { buildInPlayNames } from './recompute-derived.js';
import { siteAttacksCanceled, getEffectiveSiteType } from './effective.js';
import { allyEffectiveMind, allyEffectiveProwess } from './ally-stats.js';
import { addConstraint, removeConstraint, enqueueResolution, enqueueCorruptionCheck, characterPossessions, characterPossessionsById, hasCancelReturnAndSiteTap } from './pending.js';
import { Phase } from '../types/state-phases.js';
import { currentHazardLimit } from './hazard-limit.js';
import { roll2d6, diceRollEffect, makeCombatState, resolveAttackerChoosesDefenders, characterIds, companyById, companySubphaseScope, countSpawnCardsInPlay, defById, discardCardsInPlayWhere, drawCardsExhausting, findById, findCharacterCompany, findPlayerAvatar, gateDeckSearchFetch, getCardEffects, getOnEventEffects, hazardPlayer, isCardNameInPlayOrCharacters, isCardPlayableAtSiteDef, isHavenForPlayer, matchesDefinition, playerById, playerConvertsDetainmentToNormal, companyKeyedAttacksNormalSiteTypes, purgeCompanyAlliesAndFollowers, regionTypeCounts, removeAttachment, removeById, removeSpentEventFromGame, sweepAutoDiscardResourceEvents, toCardInstance, updateCharacter, updatePlayer, wrongActionType, effectiveGeneralInfluence, buildTargetCompanyConditionContext, stageCardsHeld, deriveFacedRaces, applyTapSiteOnPlayFlag, raceForCardTextFilter } from './reducer-utils.js';
import { evaluateExpr } from './effects/expression-eval.js';
import { applyEffect, buildChainApplyContext, shouldFireOnChainResolution } from './apply-dispatcher.js';
import { buildConstraintKind, parseConstraintScope } from './constraint-kind.js';
import { applyCost } from './cost-evaluator.js';
import { isDetainmentAttack, defenderAlignmentLabel } from './detainment.js';
import { isReduceAttacksToOneInPlay, getActiveAutoAttacks } from './manifestations.js';
import { resolveWinConditionRoll } from './reducer-win-conditions.js';
import { interceptSkipNextUntap } from './reducer-untap.js';
import { revealInstances } from './visibility.js';
import { findRevealAndAttackEffect, kickoffGreatHunt } from './great-hunt.js';
import { findLongDarkReachCandidates, fizzleLongDarkReach } from './long-dark-reach.js';
import { applyShortEventDiscardAllInPlay, applyShortEventDiscardInPlay } from './short-event-discard.js';
import { fireStageCardPlayedTriggers } from './stage-card-played.js';
import { shuffle } from '../rng.js';

/**
 * Returns the opponent of the given player in a two-player game.
 */
function opponent(state: GameState, playerId: PlayerId): PlayerId {
  return state.players[0].id === playerId ? state.players[1].id : state.players[0].id;
}

/**
 * Creates a new chain of effects with the given first entry.
 *
 * The initiating player's opponent receives priority first (CoE rule 672:
 * the non-initiator may respond before resolution begins).
 *
 * @param state - Current game state (chain must be null).
 * @param declaredBy - The player initiating the chain.
 * @param card - The card being played (physically held by the chain), or null for non-card entries.
 * @param payload - What kind of chain entry this is.
 * @param restriction - Chain restriction mode (default: 'normal').
 * @param countsAgainstHazardLimit - Whether declaring this entry counted one against the
 *   active company's hazard limit (see {@link ChainEntry.countsAgainstHazardLimit}).
 * @returns New game state with chain active.
 */
export function initiateChain(
  state: GameState,
  declaredBy: PlayerId,
  card: CardInstance | null,
  payload: ChainEntryPayload,
  restriction: ChainRestriction = 'normal',
  countsAgainstHazardLimit = false,
): GameState {
  logHeading(`Initiating chain of effects`);
  logDetail(`Declared by player ${declaredBy as string}, payload type: ${payload.type}, restriction: ${restriction}`);

  const entry: ChainEntry = {
    index: 0,
    declaredBy,
    card,
    payload,
    resolved: false,
    negated: false,
    ...(countsAgainstHazardLimit ? { countsAgainstHazardLimit: true } : {}),
  };

  const chain: ChainState = {
    mode: 'declaring',
    entries: [entry],
    priority: opponent(state, declaredBy),
    priorityPlayerPassed: false,
    nonPriorityPlayerPassed: false,
    deferredPassives: [],
    parentChain: state.chain,
    restriction,
  };

  logDetail(`Priority goes to opponent ${chain.priority as string}`);

  return { ...state, chain };
}

/**
 * Pushes a new entry onto an existing chain's stack and flips priority.
 *
 * Called when a player declares an action in response during the declaring phase.
 * The responder's opponent receives priority next.
 *
 * @param state - Current game state (chain must be non-null and in declaring mode).
 * @param declaredBy - The player declaring the response.
 * @param card - The card being played (physically held by the chain), or null.
 * @param payload - What kind of chain entry this is.
 * @param countsAgainstHazardLimit - Whether declaring this entry counted one against the
 *   active company's hazard limit (see {@link ChainEntry.countsAgainstHazardLimit}).
 * @returns New game state with entry added and priority flipped.
 */
export function pushChainEntry(
  state: GameState,
  declaredBy: PlayerId,
  card: CardInstance | null,
  payload: ChainEntryPayload,
  countsAgainstHazardLimit = false,
): GameState {
  const chain = state.chain!;
  logDetail(`Pushing chain entry #${chain.entries.length} by player ${declaredBy as string}, payload: ${payload.type}`);

  const entry: ChainEntry = {
    index: chain.entries.length,
    declaredBy,
    card,
    payload,
    resolved: false,
    negated: false,
    ...(countsAgainstHazardLimit ? { countsAgainstHazardLimit: true } : {}),
  };

  const newChain: ChainState = {
    ...chain,
    entries: [...chain.entries, entry],
    priority: opponent(state, declaredBy),
    priorityPlayerPassed: false,
    nonPriorityPlayerPassed: false,
  };

  logDetail(`Priority flips to ${newChain.priority as string}`);

  return { ...state, chain: newChain };
}

/**
 * Start a new chain when none is active, otherwise push a response entry onto
 * the current one. Folds the ubiquitous `state.chain === null ?
 * initiateChain(...) : pushChainEntry(...)` dispatch that every card-play
 * reducer repeats; both branches share the `(state, declaredBy, card, payload)`
 * signature.
 */
export function initiateOrPushChain(
  state: GameState,
  declaredBy: PlayerId,
  card: CardInstance | null,
  payload: ChainEntryPayload,
  countsAgainstHazardLimit = false,
): GameState {
  return state.chain === null
    ? initiateChain(state, declaredBy, card, payload, 'normal', countsAgainstHazardLimit)
    : pushChainEntry(state, declaredBy, card, payload, countsAgainstHazardLimit);
}

/**
 * Handles chain-specific actions (`pass-chain-priority`, `order-passives`).
 *
 * Called by the main reducer when `state.chain` is non-null and the action
 * type is a chain action.
 */
export function handleChainAction(state: GameState, action: GameAction): ReducerResult {
  const chain = state.chain;
  if (!chain) {
    return { state, error: 'No active chain' };
  }

  switch (action.type) {
    case 'pass-chain-priority':
      return handlePassChainPriority(state, chain, action.player);
    case 'order-passives':
      return handleOrderPassives(state, chain, action);
    case 'reveal-on-guard':
      return handleChainRevealOnGuard(state, chain, action);
    case 'cancel-return-to-origin':
      return handleCancelReturnToOrigin(state, chain, action);
    case 'cancel-hazard-event':
      return handleCancelHazardEvent(state, chain, action);
    case 'counter-cancel-roll':
      return handleCounterCancelRoll(state, chain, action);
    case 'counter-cancel-attack':
      return handleCounterCancelAttack(state, chain, action);
    default:
      return { state, error: `Unexpected chain action: ${action.type}` };
  }
}

/**
 * Handles a player passing priority in the chain's declaring phase.
 *
 * When a player passes:
 * - If the opponent hasn't passed yet, priority flips to the opponent.
 * - If both players have now passed consecutively, the chain transitions
 *   to resolving mode and auto-resolution begins.
 */
function handlePassChainPriority(state: GameState, chain: ChainState, playerId: PlayerId): ReducerResult {
  logHeading(`Chain: player ${playerId as string} passes priority`);

  if (chain.mode !== 'declaring') {
    return { state, error: 'Cannot pass priority: chain is resolving' };
  }
  if (playerId !== chain.priority) {
    return { state, error: 'Cannot pass priority: you do not have priority' };
  }

  // Check if the other player (now the non-priority player) already passed.
  // After the first pass, priority flips and the passer becomes the
  // non-priority player with nonPriorityPlayerPassed = true.
  const otherAlreadyPassed = chain.nonPriorityPlayerPassed;

  // The current priority player is passing. If they were the first to pass,
  // flip priority to the opponent. The "priorityPlayerPassed" always tracks
  // whether the CURRENT priority player has passed.
  // Since we're about to flip priority, the current player's pass becomes
  // the "nonPriorityPlayerPassed" from the new priority holder's perspective.

  if (!otherAlreadyPassed) {
    // First pass — flip priority to opponent, they get a chance to respond
    const newPriority = opponent(state, playerId);
    logDetail(`First pass — priority flips to ${newPriority as string}`);

    const newChain: ChainState = {
      ...chain,
      priority: newPriority,
      priorityPlayerPassed: false,
      nonPriorityPlayerPassed: true,
    };

    return { state: { ...state, chain: newChain } };
  }

  // Both players passed consecutively — transition to resolving and auto-advance
  logDetail(`Both players passed — chain transitions to resolving`);

  const resolvingChain: ChainState = {
    ...chain,
    mode: 'resolving',
    priorityPlayerPassed: false,
    nonPriorityPlayerPassed: false,
  };

  return autoResolve({ ...state, chain: resolvingChain });
}

/**
 * Handles the `order-passives` action, which lets the resource player
 * reorder simultaneously-triggered passive conditions before they are
 * declared in a follow-up chain.
 *
 * The `order` array must contain exactly the card instance IDs from
 * the chain's deferred passives, in the desired declaration order.
 */
function handleOrderPassives(state: GameState, chain: ChainState, action: GameAction): ReducerResult {
  if (action.type !== 'order-passives') return wrongActionType(state, action, 'order-passives');

  if (chain.deferredPassives.length < 2) {
    return { state, error: 'No passives to order (fewer than 2 deferred)' };
  }

  const ordered = action.order;
  if (ordered.length !== chain.deferredPassives.length) {
    return { state, error: `Expected ${chain.deferredPassives.length} entries, got ${ordered.length}` };
  }

  // Validate all IDs are present
  const deferredIds = new Set(chain.deferredPassives.map(p => p.sourceCardId as string));
  for (const id of ordered) {
    if (!deferredIds.has(id as string)) {
      return { state, error: `Unknown passive source: ${id as string}` };
    }
  }

  // Reorder deferred passives to match the requested order
  const reordered: DeferredPassive[] = ordered.map(id =>
    chain.deferredPassives.find(p => p.sourceCardId === id)!,
  );

  logDetail(`Passives reordered: ${reordered.map(p => p.sourceCardId as string).join(', ')}`);

  const newChain: ChainState = {
    ...chain,
    deferredPassives: reordered,
  };

  return { state: { ...state, chain: newChain } };
}

/**
 * Handles a reveal-on-guard action during chain declaring.
 *
 * Removes the on-guard card from the company, pushes it as a new chain entry
 * (permanent-event or short-event based on the card definition), and flips
 * priority to the opponent.
 */
function handleChainRevealOnGuard(state: GameState, chain: ChainState, action: GameAction): ReducerResult {
  if (action.type !== 'reveal-on-guard') return wrongActionType(state, action, 'reveal-on-guard');
  if (chain.mode !== 'declaring') return { state, error: 'Cannot reveal on-guard: chain is resolving' };
  if (action.player !== chain.priority) return { state, error: 'Cannot reveal on-guard: you do not have priority' };

  const siteState = state.phaseState as import('../index.js').SitePhaseState;
  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const resourcePlayer = state.players[activeIndex];
  const company = resourcePlayer.companies[siteState.activeCompanyIndex];
  if (!company) return { state, error: 'No active company' };

  const ogIdx = company.onGuardCards.findIndex(c => c.instanceId === action.cardInstanceId);
  if (ogIdx === -1) return { state, error: 'Card not in on-guard cards' };

  const revealedCard = company.onGuardCards[ogIdx];
  const def = defById(state, revealedCard.definitionId);
  logDetail(`Chain: hazard player reveals on-guard "${def?.name ?? revealedCard.definitionId}"`);

  // Remove from on-guard
  const newOnGuardCards = [...company.onGuardCards];
  newOnGuardCards.splice(ogIdx, 1);
  const newCompanies = [...resourcePlayer.companies];
  newCompanies[siteState.activeCompanyIndex] = { ...company, onGuardCards: newOnGuardCards };
  const newPlayers: [import('../index.js').PlayerState, import('../index.js').PlayerState] = [state.players[0], state.players[1]];
  newPlayers[activeIndex] = { ...resourcePlayer, companies: newCompanies };

  let newState: GameState = { ...state, players: newPlayers };

  // Push as chain entry. `fromOnGuard` marks the reveal origin so cancels
  // that "cannot be used against an on-guard card" (The Great Eye as-85)
  // can exclude this entry.
  const isPermanent = def && 'eventType' in def && (def as { eventType?: string }).eventType === 'permanent';
  const payload: ChainEntryPayload = isPermanent
    ? { type: 'permanent-event' as const, targetCharacterId: action.targetCharacterId, fromOnGuard: true }
    : { type: 'short-event' as const, fromOnGuard: true };
  const cardInstance: CardInstance = toCardInstance(revealedCard);

  // Revealed short events mirror hand-played ones: the card moves to its
  // owner's discard pile at reveal time and resolves off the chain (a
  // permanent event instead lands in play at resolution). Without this the
  // instance would vanish from state once the chain completes.
  if (!isPermanent) {
    const revealerIndex = getPlayerIndex(newState, action.player);
    newState = updatePlayer(newState, revealerIndex, p => ({
      ...p,
      discardPile: [...p.discardPile, cardInstance],
    }));
  }
  newState = pushChainEntry(newState, action.player, cardInstance, payload);

  return { state: newState };
}

/**
 * Handles a `cancel-return-to-origin` action: taps the ally (Goldberry) and
 * marks the target chain entry as negated. Priority then flips to the opponent
 * so they may respond — following the same pattern as `pushChainEntry`.
 */
function handleCancelReturnToOrigin(
  state: GameState,
  chain: ChainState,
  action: CancelReturnToOriginAction,
): ReducerResult {
  logHeading(`Chain: cancel-return-to-origin by player ${action.player as string}`);

  if (chain.mode !== 'declaring') {
    return { state, error: 'cancel-return-to-origin: chain is not in declaring mode' };
  }
  if (action.player !== chain.priority) {
    return { state, error: 'cancel-return-to-origin: player does not have priority' };
  }

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const mhState = state.phaseState as import('../index.js').MovementHazardPhaseState;
  const company = player.companies[mhState.activeCompanyIndex];
  if (!company) return { state, error: 'cancel-return-to-origin: active company not found' };

  // Tap the ally
  let tapped = false;
  const updatedChars = { ...player.characters };
  for (const charId of company.characters) {
    const charData = updatedChars[charId];
    if (!charData) continue;
    const allyIdx = charData.allies.findIndex(a => a.instanceId === action.allyInstanceId);
    if (allyIdx === -1) continue;
    const newAllies = [...charData.allies];
    newAllies[allyIdx] = { ...newAllies[allyIdx], status: CardStatus.Tapped };
    updatedChars[charId] = { ...charData, allies: newAllies };
    const allyName = (state.cardPool[newAllies[allyIdx].definitionId] as { name?: string })?.name
      ?? (action.allyInstanceId as string);
    logDetail(`cancel-return-to-origin: tapping ${allyName}`);
    tapped = true;
    break;
  }
  if (!tapped) return { state, error: 'cancel-return-to-origin: ally not found in active company' };

  // Negate the target chain entry
  const entryIdx = chain.entries.findIndex(
    e => e.card?.instanceId === action.targetInstanceId && !e.resolved && !e.negated,
  );
  if (entryIdx === -1) return { state, error: 'cancel-return-to-origin: target chain entry not found' };

  const targetName = (state.cardPool[chain.entries[entryIdx].card!.definitionId] as { name?: string })?.name
    ?? (action.targetInstanceId as string);
  logDetail(`cancel-return-to-origin: negating chain entry "${targetName}"`);

  const newEntries = chain.entries.map((e, i) =>
    i === entryIdx ? { ...e, negated: true } : e,
  );

  const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
  newPlayers[playerIndex] = { ...player, characters: updatedChars };

  // Flip priority to opponent so they may respond
  const newPriority = opponent(state, action.player);
  logDetail(`cancel-return-to-origin: priority flips to ${newPriority as string}`);

  const newChain: ChainState = {
    ...chain,
    entries: newEntries,
    priority: newPriority,
    priorityPlayerPassed: false,
    nonPriorityPlayerPassed: false,
  };

  return { state: { ...state, players: newPlayers, chain: newChain } };
}

/**
 * Handles a `cancel-hazard-event` action (The Great Eye as-85): the acting
 * player discards an in-play card carrying `cancel-hazard-event-play` to
 * negate an unresolved hazard *event* chain entry declared by the opponent,
 * before it resolves. Entries revealed from on-guard (`payload.fromOnGuard`)
 * are rejected — "this cannot be used against an on-guard card".
 *
 * The negated entry's card is routed to its owner's discard by
 * {@link completeChain}'s negated-entry flush (short events, already discarded
 * at play time, are not duplicated thanks to the flush's already-in-discard
 * guard). Priority then flips to the opponent so they may respond — the same
 * pattern as {@link handleCancelReturnToOrigin}.
 */
function handleCancelHazardEvent(
  state: GameState,
  chain: ChainState,
  action: import('../index.js').CancelHazardEventAction,
): ReducerResult {
  logHeading(`Chain: cancel-hazard-event by player ${action.player as string}`);

  if (chain.mode !== 'declaring') {
    return { state, error: 'cancel-hazard-event: chain is not in declaring mode' };
  }
  if (action.player !== chain.priority) {
    return { state, error: 'cancel-hazard-event: player does not have priority' };
  }

  // The source card must be in the acting player's cardsInPlay and carry the effect.
  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const sourceCard = findById(player.cardsInPlay, action.cardInstanceId);
  if (!sourceCard) return { state, error: 'cancel-hazard-event: source card not in play' };
  const sourceDef = defById(state, sourceCard.definitionId);
  if (!getCardEffects(sourceDef).some(e => e.type === 'cancel-hazard-event-play')) {
    return { state, error: 'cancel-hazard-event: source card has no cancel-hazard-event-play effect' };
  }
  const sourceName = (sourceDef as { name?: string } | undefined)?.name ?? (sourceCard.definitionId as string);

  // The target must be an unresolved, un-negated hazard-event entry declared
  // by the opponent, not revealed from on-guard.
  const entryIdx = chain.entries.findIndex(
    e => e.card?.instanceId === action.targetInstanceId && !e.resolved && !e.negated,
  );
  if (entryIdx === -1) return { state, error: 'cancel-hazard-event: target chain entry not found' };
  const entry = chain.entries[entryIdx];
  if (entry.declaredBy === action.player) {
    return { state, error: 'cancel-hazard-event: cannot target your own event' };
  }
  const targetDef = defById(state, entry.card!.definitionId);
  if (targetDef?.cardType !== 'hazard-event') {
    return { state, error: 'cancel-hazard-event: target is not a hazard event' };
  }
  if ((entry.payload.type === 'short-event' || entry.payload.type === 'permanent-event')
      && entry.payload.fromOnGuard) {
    return { state, error: 'cancel-hazard-event: cannot be used against an on-guard card' };
  }
  const targetName = (targetDef as { name?: string }).name ?? (action.targetInstanceId as string);

  // Pay the cost: discard the source card from play.
  logDetail(`cancel-hazard-event: discarding ${sourceName} to cancel "${targetName}"`);
  const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
  newPlayers[playerIndex] = {
    ...player,
    cardsInPlay: player.cardsInPlay.filter(c => c.instanceId !== action.cardInstanceId),
    discardPile: [...player.discardPile, toCardInstance(sourceCard)],
  };

  // Negate the target chain entry
  const newEntries = chain.entries.map((e, i) =>
    i === entryIdx ? { ...e, negated: true } : e,
  );

  // Flip priority to opponent so they may respond
  const newPriority = opponent(state, action.player);
  logDetail(`cancel-hazard-event: priority flips to ${newPriority as string}`);

  const newChain: ChainState = {
    ...chain,
    entries: newEntries,
    priority: newPriority,
    priorityPlayerPassed: false,
    nonPriorityPlayerPassed: false,
  };

  return { state: { ...state, players: newPlayers, chain: newChain } };
}

/**
 * Handles a `counter-cancel-roll` action (Black Vapour ba-14): the attacking
 * (hazard) player plays the card — from hand or from an on-guard slot on the
 * defending company — to counter an opponent-declared chain entry that would
 * cancel a creature attack of a matching race (Spider).
 *
 * Unlike Goldberry's {@link handleCancelReturnToOrigin}, the counter is not
 * automatic: the card is pushed onto the chain as a short-event entry carrying
 * the target's instance id in `payload.targetInstanceId`. When that entry
 * resolves (LIFO, before the cancel it targets) it enqueues a `dice-check`
 * (roll 2d6 + the attack's prowess) in {@link resolveEntry}. On a total greater
 * than the card's threshold the cancel entry is negated and the attack gains
 * prowess; otherwise the cancel resolves and ends the attack.
 */
function handleCounterCancelRoll(
  state: GameState,
  chain: ChainState,
  action: import('../index.js').PlayCounterCancelRollAction,
): ReducerResult {
  logHeading(`Chain: counter-cancel-roll by player ${action.player as string}`);

  if (chain.mode !== 'declaring') {
    return { state, error: 'counter-cancel-roll: chain is not in declaring mode' };
  }
  if (action.player !== chain.priority) {
    return { state, error: 'counter-cancel-roll: player does not have priority' };
  }

  const combat = state.combat;
  if (!combat) {
    return { state, error: 'counter-cancel-roll: no attack in progress' };
  }
  if (combat.attackingPlayerId !== action.player) {
    return { state, error: 'counter-cancel-roll: only the attacking player may counter-cancel' };
  }

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  // Locate the card: in the attacker's hand, or on-guard on the defending
  // company (the hazard player owns the on-guard cards during a site-phase
  // attack, so an on-guard reveal plays exactly like a hand card here).
  let handCard = findById(player.hand, action.cardInstanceId);
  let onGuard: { defenderIndex: number; companyIndex: number; ogIndex: number } | undefined;
  if (!handCard) {
    const defenderIndex = getPlayerIndex(state, combat.defendingPlayerId);
    const defender = state.players[defenderIndex];
    const companyIndex = defender.companies.findIndex(c => c.id === combat.companyId);
    if (companyIndex >= 0) {
      const ogIndex = defender.companies[companyIndex].onGuardCards.findIndex(
        og => !og.revealed && og.instanceId === action.cardInstanceId,
      );
      if (ogIndex >= 0) {
        const og = defender.companies[companyIndex].onGuardCards[ogIndex];
        handCard = { instanceId: og.instanceId, definitionId: og.definitionId };
        onGuard = { defenderIndex, companyIndex, ogIndex };
      }
    }
  }
  if (!handCard) return { state, error: 'counter-cancel-roll: card not in hand or on-guard' };

  const cardDef = defById(state, handCard.definitionId);
  const rollEffect = getCardEffects(cardDef).find(
    (e): e is import('../types/effects.js').CounterCancelAttackRollEffect => e.type === 'counter-cancel-attack-roll',
  );
  if (!rollEffect) return { state, error: 'counter-cancel-roll: card has no counter-cancel-attack-roll effect' };

  // The attack being defended must be of a race this card can counter.
  const attackRace = combat.creatureRace;
  if (attackRace === undefined || !rollEffect.race.includes(attackRace)) {
    return { state, error: `counter-cancel-roll: attack race "${attackRace}" not counterable by this card` };
  }

  // The target must be an unresolved, un-negated chain entry declared by the
  // opponent that carries a cancel-attack effect (the effect being countered).
  const entryIdx = chain.entries.findIndex(
    e => e.card?.instanceId === action.targetInstanceId && !e.resolved && !e.negated,
  );
  if (entryIdx === -1) return { state, error: 'counter-cancel-roll: target chain entry not found' };
  const targetEntry = chain.entries[entryIdx];
  if (targetEntry.declaredBy === action.player) {
    return { state, error: 'counter-cancel-roll: cannot target your own chain entry' };
  }
  const targetDef = defById(state, targetEntry.card!.definitionId);
  if (!getCardEffects(targetDef).some(e => e.type === 'cancel-attack')) {
    return { state, error: 'counter-cancel-roll: target does not cancel an attack' };
  }

  const cardName = (cardDef as { name?: string })?.name ?? (handCard.definitionId as string);
  const targetName = (targetDef as { name?: string })?.name ?? (action.targetInstanceId as string);
  logDetail(`counter-cancel-roll: ${cardName} targets "${targetName}" (attack prowess ${combat.strikeProwess}, threshold ${rollEffect.threshold})`);

  // Remove the card from its source and place it in the attacker's discard pile
  // (short events are physically discarded at play time; the chain holds only a
  // reference).
  const discarded = toCardInstance(handCard);
  let resultState: GameState;
  if (onGuard) {
    const og = onGuard;
    const withoutOnGuard = updatePlayer(state, og.defenderIndex, p => {
      const companies = [...p.companies];
      const company = companies[og.companyIndex];
      const onGuardCards = [...company.onGuardCards];
      onGuardCards.splice(og.ogIndex, 1);
      companies[og.companyIndex] = { ...company, onGuardCards };
      return { ...p, companies };
    });
    resultState = updatePlayer(withoutOnGuard, playerIndex, p => ({ ...p, discardPile: [...p.discardPile, discarded] }));
  } else {
    resultState = updatePlayer(state, playerIndex, p => ({
      ...p,
      hand: removeById(p.hand, handCard.instanceId),
      discardPile: [...p.discardPile, discarded],
    }));
  }

  // Push Black Vapour as a short-event chain entry carrying the target. It sits
  // above the cancel entry (LIFO) so it resolves first; priority flips to the
  // opponent so they may respond further.
  resultState = pushChainEntry(resultState, action.player, discarded, {
    type: 'short-event',
    counterCancelTargetInstanceId: action.targetInstanceId,
  });

  return { state: resultState };
}

/**
 * Handles a `counter-cancel-attack` action (Great Fissure ba-61): the Balrog
 * player, whose company is attacking an opponent's company (CvCC), plays the
 * card from hand to negate an unresolved chain entry — declared by the
 * opponent — that carries a `cancel-attack` effect and would cancel the attack.
 *
 * Mirrors {@link handleCancelReturnToOrigin} (Goldberry) but the source is a
 * discarded hand card, not a tapped ally: the card is moved hand → discard, the
 * target entry is negated, and priority flips to the opponent so they may
 * respond further.
 */
function handleCounterCancelAttack(
  state: GameState,
  chain: ChainState,
  action: CounterCancelAttackAction,
): ReducerResult {
  logHeading(`Chain: counter-cancel-attack by player ${action.player as string}`);

  if (chain.mode !== 'declaring') {
    return { state, error: 'counter-cancel-attack: chain is not in declaring mode' };
  }
  if (action.player !== chain.priority) {
    return { state, error: 'counter-cancel-attack: player does not have priority' };
  }

  const combat = state.combat;
  if (!combat || !combat.isCvCC || combat.attackSource.type !== 'company-attack') {
    return { state, error: 'counter-cancel-attack: no company-vs-company attack in progress' };
  }
  if (combat.attackingPlayerId !== action.player) {
    return { state, error: 'counter-cancel-attack: only the attacking player may counter-cancel' };
  }

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  // The attack must be by The Balrog's company (the attacking company must
  // contain the Balrog avatar).
  const attackingCompany = companyById(player.companies, combat.attackSource.attackingCompanyId);
  if (!attackingCompany || !companyContainsBalrogAvatar(state, player, attackingCompany)) {
    return { state, error: 'counter-cancel-attack: attacking company is not The Balrog’s company' };
  }

  // The played card must be in hand and carry the cancel-chain-attack-cancel marker.
  const handCard = findById(player.hand, action.cardInstanceId);
  if (!handCard) return { state, error: 'counter-cancel-attack: card not in hand' };
  const cardDef = defById(state, handCard.definitionId);
  const hasMarker = getCardEffects(cardDef).some(e => e.type === 'cancel-chain-attack-cancel');
  if (!hasMarker) return { state, error: 'counter-cancel-attack: card has no cancel-chain-attack-cancel effect' };

  // The target must be an unresolved, un-negated chain entry declared by the
  // opponent that carries a cancel-attack effect (the effect being countered).
  const entryIdx = chain.entries.findIndex(
    e => e.card?.instanceId === action.targetInstanceId && !e.resolved && !e.negated,
  );
  if (entryIdx === -1) return { state, error: 'counter-cancel-attack: target chain entry not found' };
  const targetEntry = chain.entries[entryIdx];
  if (targetEntry.declaredBy === action.player) {
    return { state, error: 'counter-cancel-attack: cannot target your own chain entry' };
  }
  const targetDef = defById(state, targetEntry.card!.definitionId);
  const targetCancels = getCardEffects(targetDef).some(e => e.type === 'cancel-attack');
  if (!targetCancels) {
    return { state, error: 'counter-cancel-attack: target does not cancel an attack' };
  }

  const targetName = (targetDef as { name?: string })?.name ?? (action.targetInstanceId as string);
  const cardName = (cardDef as { name?: string })?.name ?? (handCard.definitionId as string);
  logDetail(`counter-cancel-attack: ${cardName} negates chain entry "${targetName}" — the Balrog’s attack survives`);

  // Discard the played card (short events are physically discarded at play time).
  const newHand = removeById(player.hand, handCard.instanceId);
  const newDiscard = [...player.discardPile, toCardInstance(handCard)];

  const newEntries = chain.entries.map((e, i) =>
    i === entryIdx ? { ...e, negated: true } : e,
  );

  const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
  newPlayers[playerIndex] = { ...player, hand: newHand, discardPile: newDiscard };

  // Flip priority to opponent so they may respond.
  const newPriority = opponent(state, action.player);
  logDetail(`counter-cancel-attack: priority flips to ${newPriority as string}`);

  const newChain: ChainState = {
    ...chain,
    entries: newEntries,
    priority: newPriority,
    priorityPlayerPassed: false,
    nonPriorityPlayerPassed: false,
  };

  return { state: { ...state, players: newPlayers, chain: newChain } };
}

/**
 * Auto-resolves chain entries in LIFO order until the chain is complete
 * or player input is needed.
 *
 * Entries are resolved from the last declared (top of stack) to the first.
 * Each entry is checked for validity before resolution — if the entry's
 * conditions are no longer met, it is negated instead of resolved.
 *
 * When all entries are resolved, the chain completes via {@link completeChain}.
 */
export function autoResolve(state: GameState): ReducerResult {
  let current = state;
  const allEffects: import('../index.js').GameEffect[] = [];

  while (current.chain && current.chain.mode === 'resolving') {
    const chain = current.chain;

    // Find the next unresolved entry (LIFO = iterate from end to start)
    const nextIndex = findNextUnresolved(chain);

    if (nextIndex === -1) {
      // All entries resolved — complete the chain
      logDetail(`All chain entries resolved — completing chain`);
      current = completeChain(current);
      continue;
    }

    // Resolve this entry
    const result = resolveEntry(current, nextIndex);
    current = result.state;
    if (result.effects) allEffects.push(...result.effects);

    // If resolution needs player input, stop auto-advancing
    if (result.needsInput) {
      logDetail(`Entry #${nextIndex} needs player input — pausing auto-resolve`);
      break;
    }
  }

  return { state: current, ...(allEffects.length > 0 ? { effects: allEffects } : {}) };
}

/**
 * Finds the index of the next unresolved entry in LIFO order.
 * Returns -1 if all entries are resolved or negated.
 */
function findNextUnresolved(chain: ChainState): number {
  for (let i = chain.entries.length - 1; i >= 0; i--) {
    const entry = chain.entries[i];
    if (!entry.resolved && !entry.negated) {
      return i;
    }
  }
  return -1;
}

/**
 * Result of resolving a single chain entry. If `needsInput` is true,
 * auto-resolution should pause and wait for player action.
 */
interface ResolveResult {
  readonly state: GameState;
  readonly needsInput: boolean;
  /** Visual effects produced by this resolution (e.g. dice rolls). */
  readonly effects?: readonly import('../index.js').GameEffect[];
}

/**
 * After a move that may have discarded cards from cardsInPlay,
 * cascade discards to any linked cards.
 *
 * Crown of Flowers links a paired resource: when either card is discarded
 * from cardsInPlay, the other must follow immediately.
 */
function cascadeLinkedDiscards(stateBefore: GameState, stateAfter: GameState): GameState {
  let result = stateAfter;
  for (let pi = 0; pi < 2; pi++) {
    const before = stateBefore.players[pi].cardsInPlay;
    const after = stateAfter.players[pi].cardsInPlay;
    const afterIds = new Set(after.map(c => c.instanceId));
    for (const card of before) {
      if (afterIds.has(card.instanceId)) continue; // still in play
      if (!card.linkedInstanceId) continue; // no link
      // This card left cardsInPlay and had a link — discard the linked card too
      const linkedId = card.linkedInstanceId;
      logDetail(`Cascade discard: ${card.instanceId as string} was discarded with link → discarding linked ${linkedId as string}`);
      for (let lpi = 0; lpi < 2; lpi++) {
        const linkedIdx = result.players[lpi].cardsInPlay.findIndex(c => c.instanceId === linkedId);
        if (linkedIdx < 0) continue;
        const linkedCard = result.players[lpi].cardsInPlay[linkedIdx];
        result = updatePlayer(result, lpi, p => ({
          ...p,
          cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== linkedId),
          discardPile: [...p.discardPile, toCardInstance(linkedCard)],
        }));
        break;
      }
    }
  }
  return result;
}

/**
 * Cancel and discard an environment card targeted by a short-event (e.g. Twilight).
 *
 * The target may be in a player's cardsInPlay (hazard permanent events like Doors of Night),
 * in a player's cardsInPlay (resource permanent events like Gates of Morning),
 * or on the chain itself (an environment declared earlier in the same chain).
 *
 * If the target is on the chain, it is negated (marked as canceled) instead of
 * being physically moved — the chain entry's card was already discarded on declaration.
 *
 * If the target has already been negated or removed (e.g. another Twilight canceled
 * it first), this is a no-op — the cancel fizzles.
 */
function resolveEnvironmentCancel(state: GameState, targetInstanceId: CardInstanceId, chain: ChainState): GameState {
  const targetDef = resolveDef(state, targetInstanceId);
  const targetName = targetDef?.name ?? (targetInstanceId as string);

  // Check if target is on the chain (environment declared earlier in the same chain)
  const chainIdx = chain.entries.findIndex(
    e => e.card?.instanceId === targetInstanceId && !e.resolved && !e.negated,
  );
  if (chainIdx !== -1) {
    logDetail(`Environment cancel: negating chain entry #${chainIdx} (${targetName})`);
    const newEntries = chain.entries.map((e, i) =>
      i === chainIdx ? { ...e, negated: true } : e,
    );
    return { ...state, chain: { ...chain, entries: newEntries } };
  }

  // Check cardsInPlay across all players
  for (let pi = 0; pi < state.players.length; pi++) {
    const player = state.players[pi];
    if (player.cardsInPlay.some(c => c.instanceId === targetInstanceId)) {
      logDetail(`Environment cancel: removing ${targetName} from player ${pi} cardsInPlay → discard`);
      const removedCard = findById(player.cardsInPlay, targetInstanceId)!;
      const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
      newPlayers[pi as 0 | 1] = {
        ...player,
        cardsInPlay: player.cardsInPlay.filter(c => c.instanceId !== targetInstanceId),
        discardPile: [...player.discardPile, { instanceId: targetInstanceId, definitionId: removedCard.definitionId }],
      };
      const afterCancel = { ...state, players: newPlayers };
      return cascadeLinkedDiscards(state, afterCancel);
    }
  }

  // Check active constraints: a card's "ongoing effect" is typically
  // realised as an {@link ActiveConstraint} whose `source` is the played
  // card's instance (the card itself may have moved to discard — e.g.
  // Stealth leaves a `no-creature-hazards-on-company` constraint behind).
  // Searching Eye (le-136) uses this path to discard the ongoing effect
  // of a scout-skill resource.
  const matchingConstraintIds = state.activeConstraints
    .filter(c => c.source === targetInstanceId)
    .map(c => c.id);
  if (matchingConstraintIds.length > 0) {
    logDetail(`Environment cancel: removing ${matchingConstraintIds.length} active constraint(s) sourced from ${targetName}`);
    return {
      ...state,
      activeConstraints: state.activeConstraints.filter(c => c.source !== targetInstanceId),
    };
  }

  // Target already gone (fizzle) — e.g. another effect already canceled it
  logDetail(`Environment cancel: target ${targetName} already gone — fizzle`);
  return state;
}

/**
 * Resolve and add one declared `add-constraint` apply (scope → kind →
 * target → {@link addConstraint}) to the state. Shared by the chain's
 * short-event arrival trigger and the self-enters-play constraint path so
 * that plumbing lives in one place; each caller supplies the company it
 * resolved (its own way) and its target policy.
 *
 * `effectForKind` is the on-event effect carrying the specific apply — a
 * caller flattening a `sequence` passes `{ ...onEvent, apply }`. When
 * `untilClearedPlayerId` is given and the scope is `until-cleared`, the
 * constraint targets that player (used by self-enters-play cards whose
 * effect is global rather than company-bound); otherwise it targets the
 * resolved company. Returns whether a constraint was actually added, so
 * callers can implement first-match-wins across modes.
 */
function addDeclaredConstraint(
  state: GameState,
  source: { readonly instanceId: CardInstanceId; readonly definitionId: import('../types/common.js').CardDefinitionId },
  effectForKind: import('../types/effects.js').OnEventEffect,
  constraintKind: string,
  scopeName: string,
  companyId: import('../types/common.js').CompanyId | null,
  opts: {
    readonly boundSiteDefId?: import('../types/common.js').CardDefinitionId;
    readonly untilClearedPlayerId?: PlayerId;
    /**
     * Forces a player-wide target regardless of scope, bypassing the active-
     * company resolution entirely. Used when `effect.apply.target ===
     * "player"` (Praise to Elbereth tw-305: "characters gain +1
     * prowess" — every character the declaring player controls, not just the
     * one company active in the current M/H/Site sub-phase).
     */
    readonly declaringPlayerTarget?: PlayerId;
  } = {},
): { readonly state: GameState; readonly added: boolean } {
  const scope = parseConstraintScope(scopeName, companyId);
  if (!scope) {
    logDetail(`add-constraint(${constraintKind}): unsupported scope "${scopeName}" — fizzle`);
    return { state, added: false };
  }
  const kind = buildConstraintKind(state, effectForKind, constraintKind, opts.boundSiteDefId);
  if (!kind) {
    logDetail(`add-constraint: unsupported constraint kind "${constraintKind}" — fizzle`);
    return { state, added: false };
  }
  let target: import('../types/pending.js').ActiveConstraint['target'];
  if (opts.declaringPlayerTarget) {
    target = { kind: 'player', playerId: opts.declaringPlayerTarget };
  } else if (scopeName === 'until-cleared' && opts.untilClearedPlayerId) {
    target = { kind: 'player', playerId: opts.untilClearedPlayerId };
  } else if (companyId) {
    target = { kind: 'company', companyId };
  } else {
    logDetail(`add-constraint(${constraintKind}): no target — fizzle`);
    return { state, added: false };
  }
  return {
    state: addConstraint(state, {
      source: source.instanceId,
      sourceDefinitionId: source.definitionId,
      scope,
      target,
      kind,
    }),
    added: true,
  };
}

/**
 * Fire any `on-event company-arrives-at-site → add-constraint` effect
 * carried by a resolving short-event. The target company is the active
 * M/H company (the only company the hazard can be played against), so
 * the constraint can be added immediately on resolution — no deferred
 * tracking state is needed. The card itself has already been moved to
 * the discard pile at play time.
 */
function applyShortEventArrivalTrigger(state: GameState, entry: ChainEntry): GameState {
  const card = entry.card;
  if (!card) return state;
  const def = defById(state, card.definitionId);
  if (!def) return state;
  // Collect all on-event effects for company-arrives-at-site. Each
  // effect's apply is either an `add-constraint` (single) or a
  // `sequence` of `add-constraint`s (River — adds
  // site-phase-do-nothing + granted-action together).
  //
  // Multiple effects allow a card to declare several mutually-exclusive
  // modes (e.g. Choking Shadows' +2 prowess vs. type-override); the
  // first effect whose `when` condition matches is applied and the
  // rest skipped.
  const onEvents = getCardEffects(def).filter(
    (e): e is import('../types/effects.js').OnEventEffect =>
      e.type === 'on-event'
      && e.event === 'company-arrives-at-site'
      && (e.apply.type === 'add-constraint' || e.apply.type === 'sequence'),
  );
  if (onEvents.length === 0) return state;

  // New Moon (tw-68): a card offering a `tap-character` (or, Gloom tw-41,
  // a `play-target: "character"` + `character-stat-modifier`) mode alongside
  // these arrival-override modes. The two are mutually exclusive
  // ("Alternatively"): when the player chose the character-targeted mode (a
  // targetCharacterId rides on the payload), the arrival-override modes must
  // not also fire.
  if (
    entry.payload.type === 'short-event'
    && entry.payload.targetCharacterId
    && getCardEffects(def).some(e => e.type === 'tap-character' || (e.type === 'play-target' && e.target === 'character'))
  ) {
    logDetail(`Short-event "${def.name}" character-targeted mode chosen — skipping arrival-override modes`);
    return state;
  }

  // Only fire during M/H — outside of M/H there is no active company
  // for a "company arrives at site" trigger to attach to.
  if (state.phaseState.phase !== Phase.MovementHazard) {
    logDetail(`Short-event "${def.name}" on-event company-arrives-at-site skipped — not in M/H phase`);
    return state;
  }
  const activePlayerId = state.activePlayer;
  if (!activePlayerId) return state;
  const activeIndex = getPlayerIndex(state, activePlayerId);
  const companyIndex = state.phaseState.activeCompanyIndex;
  const targetCompany = state.players[activeIndex].companies[companyIndex];
  if (!targetCompany) return state;

  // "company-arrives-at-site" triggers fire only when a company is
  // actually moving. A non-moving company (no declared destination)
  // never "arrives" at its current site for rules purposes, so cards
  // like River — "A company moving to this site this turn must do
  // nothing…" — have no target and fizzle.
  if (!targetCompany.destinationSite) {
    logDetail(`Short-event "${def.name}" on-event company-arrives-at-site skipped — active company is not moving`);
    return state;
  }

  // Build the context for `when` condition evaluation so each mode can
  // gate on destination site-type / region / environment (Doors of Night).
  const ctx = buildArrivalContext(state);

  for (const onEvent of onEvents) {
    if (onEvent.when && !matchesCondition(onEvent.when, ctx)) {
      logDetail(`Short-event "${def.name}": skipping on-event mode — condition not met`);
      continue;
    }

    // Normalise: a `sequence` apply contains multiple sub-applies;
    // a single `add-constraint` apply is treated as a one-item list.
    const applies: readonly import('../types/effects.js').TriggeredAction[] =
      onEvent.apply.type === 'sequence'
        ? (onEvent.apply.apps ?? [])
        : [onEvent.apply];

    let addedAny = false;
    for (const apply of applies) {
      if (apply.type !== 'add-constraint') continue;
      const constraintKind = apply.constraint;
      const scopeName = apply.scope;
      if (!constraintKind || !scopeName) continue;

      // Arrival constraints always target the active moving company; the
      // company is the resolution context, so `until-cleared` keeps the
      // company target (no player override).
      const r = addDeclaredConstraint(state, card, { ...onEvent, apply }, constraintKind, scopeName, targetCompany.id);
      state = r.state;
      if (r.added) {
        logDetail(`Short-event "${def.name}" resolves → added ${constraintKind} constraint on company ${targetCompany.id as string}`);
        addedAny = true;
      }
    }

    // Preserve first-match semantics: once one on-event effect has
    // contributed at least one constraint, stop considering the rest.
    if (addedAny) return state;
  }

  logDetail(`Short-event "${def.name}": no on-event mode applied (no condition matched)`);
  return state;
}

/**
 * Fire any `on-event self-enters-play → add-constraint` effects carried by a
 * resolving hazard short-event (e.g. Lost in Free-domains). The card was
 * already discarded at play time; this fires the constraint on chain resolution.
 */
function applyShortEventSelfEntersPlayConstraints(state: GameState, entry: ChainEntry): GameState {
  const card = entry.card;
  if (!card) return state;
  const def = defById(state, card.definitionId);
  if (!def) return state;
  const onEvents = getCardEffects(def).filter(
    (e): e is OnEventEffect =>
      e.type === 'on-event'
      && e.event === 'self-enters-play'
      && e.apply.type === 'add-constraint',
  );
  if (onEvents.length === 0) return state;

  let newState = state;
  const cardName = (def as { name?: string }).name ?? (card.definitionId as string);
  // A hazard short-event played on a character (targetCharacterId) may carry
  // `character-stat-modifier` add-constraint applies — e.g. Glance of Arien
  // (ba-19): -2/-1 prowess/body on The Balrog, -4/-2 while Gates of Morning is
  // in play. Each effect targets the chosen character; its `when` gate is
  // evaluated against the current in-play names so the doubled modifier only
  // fires when its companion card is out.
  const targetCharId = entry.payload.type === 'short-event' ? entry.payload.targetCharacterId : undefined;
  for (const onEvent of onEvents) {
    if (onEvent.apply.type === 'add-constraint'
      && onEvent.apply.constraint === 'character-stat-modifier') {
      if (!targetCharId) {
        logDetail(`"${cardName}": character-stat-modifier self-enters-play — no target character, fizzle`);
        continue;
      }
      if (onEvent.when) {
        const ctx = { inPlay: buildInPlayNames(newState) };
        if (!matchesCondition(onEvent.when, ctx as unknown as Record<string, unknown>)) {
          logDetail(`"${cardName}": character-stat-modifier self-enters-play — when gate not met, skip`);
          continue;
        }
      }
      const stat = onEvent.apply.stat;
      const value = onEvent.apply.value;
      if ((stat !== 'prowess' && stat !== 'body' && stat !== 'direct-influence') || typeof value !== 'number') {
        logDetail(`"${cardName}": character-stat-modifier self-enters-play — missing/invalid stat or value, fizzle`);
        continue;
      }
      logDetail(`"${cardName}" resolved — character-stat-modifier ${stat} ${value > 0 ? '+' : ''}${value} on ${targetCharId as string} (scope turn)`);
      newState = addConstraint(newState, {
        source: card.instanceId,
        sourceDefinitionId: card.definitionId,
        scope: { kind: 'turn' },
        target: { kind: 'character', characterId: targetCharId },
        kind: { type: 'character-stat-modifier', stat, value, characterId: targetCharId },
      });
      continue;
    }
    // Lost in Dark-domains (tw-52) and any other hazard short-event whose
    // add-constraint apply is gated on the resolved site path (e.g. "if the
    // company has a Dark-domain in its site path"): evaluate `when` against
    // the M/H phase's resolved path before installing the constraint.
    if (onEvent.when) {
      const ctx: Record<string, unknown> = { inPlay: buildInPlayNames(newState) };
      if (newState.phaseState.phase === Phase.MovementHazard) {
        ctx['sitePath'] = regionTypeCounts(newState.phaseState.resolvedSitePath);
      }
      if (!matchesCondition(onEvent.when, ctx)) {
        logDetail(`"${cardName}": ${onEvent.apply.type} self-enters-play — when gate not met, skip`);
        continue;
      }
    }
    newState = applyAddConstraintFromOnEvent(newState, entry, onEvent, cardName);
  }
  return newState;
}

/**
 * Greed (le-113 / tw-42): install the turn-scoped `item-play-corruption-check`
 * constraint bound to the target site. The constraint targets the resource
 * (active) player — the one who plays items at the site during the site phase —
 * and is swept at turn-end. The site-phase item-play handler
 * (`fireItemPlayCorruptionChecks`) consults it to fire the checks.
 */
function applyItemPlayCorruptionCheckConstraint(
  state: GameState,
  entry: ChainEntry,
  siteDefinitionId: CardDefinitionId,
): GameState {
  const card = entry.card;
  if (!card) return state;
  const def = defById(state, card.definitionId);
  if (!def) return state;
  const effect = getCardEffects(def).find(
    (e): e is import('../types/effects.js').ItemPlayCorruptionCheckEffect =>
      e.type === 'item-play-corruption-check',
  );
  if (!effect) return state;
  // The player whose characters make the checks is the active/resource player
  // (the item-player during the upcoming site phase), i.e. the hazard's opponent.
  const targetPlayerId = state.activePlayer ?? entry.declaredBy;
  const cardName = (def as { name?: string }).name ?? (card.definitionId as string);
  const siteName = (defById(state, siteDefinitionId) as { name?: string } | undefined)?.name ?? (siteDefinitionId as string);
  logDetail(`${cardName}: installing item-play-corruption-check at ${siteName} (until end of turn) for player ${targetPlayerId as string}`);
  return addConstraint(state, {
    source: card.instanceId,
    sourceDefinitionId: card.definitionId,
    scope: { kind: 'turn' },
    target: { kind: 'player', playerId: targetPlayerId },
    kind: {
      type: 'item-play-corruption-check',
      siteDefinitionId,
      ...(effect.exemptFilter ? { exemptFilter: effect.exemptFilter } : {}),
    },
  });
}

/**
 * Build the evaluation context for a `company-arrives-at-site` `when`
 * clause. Exposes the active company's destination site type, destination
 * region type, and whether Doors of Night is in play — enough for a
 * card like Choking Shadows to pick between its modes.
 */
function buildArrivalContext(state: GameState): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};
  if (state.phaseState.phase !== Phase.MovementHazard) return ctx;
  const mh = state.phaseState;
  const company: Record<string, unknown> = {};
  if (mh.destinationSiteType) company.destinationSiteType = mh.destinationSiteType;
  if (mh.destinationSiteName) company.destinationSiteName = mh.destinationSiteName;
  // The destination region type is the last entry in the resolved path
  // (the region the destination site sits in).
  if (mh.resolvedSitePath.length > 0) {
    company.destinationRegionType = mh.resolvedSitePath[mh.resolvedSitePath.length - 1];
  }
  ctx.company = company;
  const inPlayNames = buildInPlayNames(state);
  ctx.inPlay = inPlayNames;
  ctx.environment = { doorsOfNightInPlay: inPlayNames.includes('Doors of Night') };
  return ctx;
}


/**
 * Queues pending {@link FetchToDeckEffect}s for a resolving hazard short-event.
 *
 * The card was discarded at play time (hazard short events go to discard
 * immediately). If the card carries `fetch-to-deck` effects whose `when`
 * conditions are satisfied, enqueue the effects as {@link PendingEffect}s
 * so the hazard player can interactively choose which cards to fetch.
 * The card remains in the discard pile throughout — hazard short events
 * are never placed in cardsInPlay.
 */
function queueFetchToDecEffects(state: GameState, entry: ChainEntry): GameState {
  const card = entry.card;
  if (!card) return state;
  const def = defById(state, card.definitionId);
  if (!def) return state;
  const inPlayNames = buildInPlayNames(state);
  const ctx: Record<string, unknown> = { inPlay: inPlayNames };

  const fetchEffects: PendingEffect[] = [];
  let anyFetchCanceled = false;
  for (const effect of getCardEffects(def)) {
    if (effect.type !== 'move') continue;
    const payload = moveToFetchToDeckPayload(effect);
    if (!payload) continue;
    if (effect.when && !matchesCondition(effect.when, ctx)) {
      logDetail(`${def.name}: fetch-to-deck skipped — condition not met`);
      continue;
    }
    // cancel-deck-search (Lady of the Golden Wood as-13): a minion player's
    // own play-deck / discard-pile searches are automatically canceled.
    const gated = gateDeckSearchFetch(state, entry.declaredBy, payload);
    if (!gated) {
      anyFetchCanceled = true;
      continue;
    }
    fetchEffects.push({
      type: 'card-effect',
      cardInstanceId: card.instanceId,
      effect: gated,
      actor: entry.declaredBy,
    });
  }

  if (fetchEffects.length === 0) {
    // When every fetch was canceled, a resource short-event riding the chain
    // entry has left the hand but is not yet in any pile — dispose it to the
    // declaring player's discard now (hazard short events are pre-discarded).
    if (anyFetchCanceled) {
      const declaringIdx = getPlayerIndex(state, entry.declaredBy);
      const declaring = state.players[declaringIdx];
      const placed = declaring.discardPile.some(c => c.instanceId === card.instanceId)
        || declaring.cardsInPlay.some(c => c.instanceId === card.instanceId);
      if (!placed) {
        logDetail(`${def.name}: all fetches canceled — discarding the event`);
        return updatePlayer(state, declaringIdx, p => ({
          ...p,
          discardPile: [...p.discardPile, toCardInstance(card)],
        }));
      }
    }
    return state;
  }

  // Hazard short events are discarded at play time and never enter cardsInPlay,
  // so the card is already in the declaring player's discard pile here. Resource
  // short events instead ride on the chain entry (they leave the hand at play
  // time but are not pre-discarded — see `handlePlayResourceShortEvent`). For
  // those, place the card into the declaring player's cardsInPlay now so it is
  // visible on the table while the fetch sub-flow runs and is disposed to the
  // discard pile by `discardEventCard` once the last pick resolves.
  let next = state;
  const declaringIndex = getPlayerIndex(state, entry.declaredBy);
  const declaringPlayer = state.players[declaringIndex];
  const alreadyPlaced = declaringPlayer.discardPile.some(c => c.instanceId === card.instanceId)
    || declaringPlayer.cardsInPlay.some(c => c.instanceId === card.instanceId);
  if (!alreadyPlaced) {
    logDetail(`${def.name}: resource short event → cardsInPlay while fetch resolves`);
    next = updatePlayer(next, declaringIndex, p => ({
      ...p,
      cardsInPlay: [...p.cardsInPlay, {
        instanceId: card.instanceId,
        definitionId: card.definitionId,
        status: CardStatus.Untapped,
      }],
    }));
  }

  logDetail(`${def.name}: queuing ${fetchEffects.length} fetch-to-deck effect(s)`);

  return {
    ...next,
    pendingEffects: [...next.pendingEffects, ...fetchEffects],
  };
}

/**
 * Applies a `company-return-to-origin` short-event effect on chain resolution.
 * Forces the active movement/hazard company to keep its site of origin (CoE
 * rule 2.IV.4 mechanism, shared with `agent-discard-return-to-origin`): sets
 * `returnedToOrigin` so {@link endCompanyMH} keeps the company at origin, and
 * adds a `site-phase-do-nothing` constraint so it cannot act during its site
 * phase. The optional `unless` company condition (Beorn / an untapped warrior
 * with prowess > 4 for ba-10) is evaluated against the target company; when it
 * matches, the return is skipped and the card resolves with no effect.
 */
function applyCompanyReturnToOrigin(state: GameState, entry: ChainEntry): GameState {
  const card = entry.card;
  if (!card) return state;
  const def = defById(state, card.definitionId);
  const effect = getCardEffects(def).find(e => e.type === 'company-return-to-origin');
  if (!effect) return state;

  if (state.phaseState.phase !== Phase.MovementHazard) return state;
  const mhState = state.phaseState;
  if (mhState.returnedToOrigin) return state;

  const resourceIndex = getPlayerIndex(state, state.activePlayer!);
  const resourcePlayer = state.players[resourceIndex];
  const company = resourcePlayer.companies[mhState.activeCompanyIndex];
  if (!company || !company.destinationSite) return state;

  if (effect.unless) {
    const ctx = buildTargetCompanyConditionContext(state, resourcePlayer, company);
    if (matchesCondition(effect.unless, ctx)) {
      logDetail(`${def?.name ?? 'card'}: return-to-origin skipped — company meets the exception`);
      return state;
    }
  }

  logDetail(`${def?.name ?? 'card'}: company ${company.id as string} must return to its site of origin (short-event, rule 2.IV.4)`);
  let next: GameState = { ...state, phaseState: { ...mhState, returnedToOrigin: true } };
  next = addConstraint(next, {
    source: card.instanceId,
    sourceDefinitionId: card.definitionId,
    scope: { kind: 'company-site-phase', companyId: company.id },
    target: { kind: 'company', companyId: company.id },
    kind: { type: 'site-phase-do-nothing' },
  });
  return next;
}

/**
 * Applies a `company-site-phase-do-nothing` short-event effect on chain
 * resolution: adds a `site-phase-do-nothing` constraint to the active
 * movement/hazard company so it cannot act during its upcoming site phase this
 * turn. Unlike {@link applyCompanyReturnToOrigin} the company keeps its
 * destination site (its movement is unaffected — only the site phase is
 * blocked). Used by Darkness Made by Malice (ba-15).
 *
 * The optional `unless` company condition (evaluated the same way as
 * {@link applyCompanyReturnToOrigin}'s) skips the restriction entirely when it
 * matches. The optional `escape` grant installs a companion `granted-action`
 * constraint sourced from the same card — same pattern River (tw-84/le-95)
 * uses for its ranger-tap cancel — so `remove-constraint` (`select:
 * "constraint-source"`) clears both together when the escape is paid. Used by
 * Fifteen Birds in Five Firtrees (dm-129): "unless it contains a Wizard or you
 * discard Eagle-mounts from your hand."
 */
function applyCompanySitePhaseDoNothing(state: GameState, entry: ChainEntry): GameState {
  const card = entry.card;
  if (!card) return state;
  const def = defById(state, card.definitionId);
  const effect = getCardEffects(def).find(
    (e): e is import('../types/effects.js').CompanySitePhaseDoNothingEffect => e.type === 'company-site-phase-do-nothing',
  );
  if (!effect) return state;

  if (state.phaseState.phase !== Phase.MovementHazard) return state;
  const mhState = state.phaseState;

  const resourceIndex = getPlayerIndex(state, state.activePlayer!);
  const resourcePlayer = state.players[resourceIndex];
  const company = resourcePlayer.companies[mhState.activeCompanyIndex];
  if (!company) return state;

  // Idempotent: don't stack a second constraint if one is already present.
  if (state.activeConstraints.some(c =>
    c.kind.type === 'site-phase-do-nothing'
    && c.target.kind === 'company'
    && c.target.companyId === company.id
  )) {
    return state;
  }

  if (effect.unless) {
    const ctx = buildTargetCompanyConditionContext(state, resourcePlayer, company);
    if (matchesCondition(effect.unless, ctx)) {
      logDetail(`${def?.name ?? 'card'}: site-phase-do-nothing skipped — company meets the exception`);
      return state;
    }
  }

  logDetail(`${def?.name ?? 'card'}: company ${company.id as string} must do nothing during its site phase this turn`);
  const scope = { kind: 'company-site-phase' as const, companyId: company.id };
  const target = { kind: 'company' as const, companyId: company.id };
  let next = addConstraint(state, {
    source: card.instanceId,
    sourceDefinitionId: card.definitionId,
    scope,
    target,
    kind: { type: 'site-phase-do-nothing' },
  });

  if (effect.escape) {
    logDetail(`${def?.name ?? 'card'}: installing escape grant "${effect.escape.action}" alongside site-phase-do-nothing`);
    next = addConstraint(next, {
      source: card.instanceId,
      sourceDefinitionId: card.definitionId,
      scope,
      target,
      kind: {
        type: 'granted-action',
        action: effect.escape.action,
        phase: effect.escape.phase as import('../types/state-phases.js').Phase | undefined,
        window: effect.escape.window,
        cost: effect.escape.cost,
        when: effect.escape.when,
        apply: effect.escape.apply,
      },
    });
  }

  return next;
}

/**
 * Forces the active M/H company back to its site of origin as a `play-option`
 * apply (rather than the card's own top-level `company-return-to-origin`
 * effect handled by {@link applyCompanyReturnToOrigin}). Shares the same CoE
 * rule 2.IV.4 mechanism: keeps the origin site and blocks the site phase.
 * Idempotent — a no-op if the company already returned this turn or isn't
 * moving.
 */
function performCompanyReturnToOriginOption(state: GameState, cardName: string, sourceInstanceId: import('../types/common.js').CardInstanceId, sourceDefinitionId: import('../types/common.js').CardDefinitionId): GameState {
  if (state.phaseState.phase !== Phase.MovementHazard) return state;
  const mhState = state.phaseState;
  if (mhState.returnedToOrigin) return state;

  const resourceIndex = getPlayerIndex(state, state.activePlayer!);
  const resourcePlayer = state.players[resourceIndex];
  const company = resourcePlayer.companies[mhState.activeCompanyIndex];
  if (!company || !company.destinationSite) return state;

  logDetail(`${cardName}: option resolved — company ${company.id as string} must return to its site of origin`);
  let next: GameState = { ...state, phaseState: { ...mhState, returnedToOrigin: true } };
  next = addConstraint(next, {
    source: sourceInstanceId,
    sourceDefinitionId,
    scope: { kind: 'company-site-phase', companyId: company.id },
    target: { kind: 'company', companyId: company.id },
    kind: { type: 'site-phase-do-nothing' },
  });
  return next;
}

/**
 * Resolves one `TriggeredAction` apply from a company-targeting hazard
 * short-event's `play-option` (see {@link applyCompanyPlayOption}). Recurses
 * into `sequence`'s sub-applies. Unsupported apply kinds are a no-op.
 */
function applyCompanyPlayOptionApply(
  state: GameState,
  apply: import('../types/effects.js').TriggeredAction,
  cardName: string,
  sourceInstanceId: import('../types/common.js').CardInstanceId,
  sourceDefinitionId: import('../types/common.js').CardDefinitionId,
): GameState {
  let current = state;
  if (apply.type === 'sequence') {
    for (const sub of apply.apps ?? []) {
      current = applyCompanyPlayOptionApply(current, sub, cardName, sourceInstanceId, sourceDefinitionId);
    }
    return current;
  }

  if (apply.type === 'company-return-to-origin') {
    return performCompanyReturnToOriginOption(current, cardName, sourceInstanceId, sourceDefinitionId);
  }

  if (apply.type === 'force-discard-one-company-item') {
    if (current.phaseState.phase !== Phase.MovementHazard) return current;
    const mhState = current.phaseState;
    const resourceIndex = getPlayerIndex(current, current.activePlayer!);
    const resourcePlayer = current.players[resourceIndex];
    const company = resourcePlayer.companies[mhState.activeCompanyIndex];
    if (!company) return current;
    const hasItems = company.characters.some(charId => {
      const ch = resourcePlayer.characters[charId];
      return ch && ch.items.length > 0;
    });
    if (!hasItems) {
      logDetail(`${cardName}: option resolved — company ${company.id as string} has no items to discard`);
      return current;
    }
    logDetail(`${cardName}: option resolved — company ${company.id as string} must discard one item, its choice`);
    return enqueueResolution(current, {
      source: sourceInstanceId,
      actor: resourcePlayer.id,
      scope: companySubphaseScope(current.phaseState.phase, company.id),
      kind: { type: 'discard-one-company-item', companyId: company.id },
    });
  }

  if (apply.type === 'random-discard-hand') {
    if (current.phaseState.phase !== Phase.MovementHazard) return current;
    const mhState = current.phaseState;
    const resourceIndex = getPlayerIndex(current, current.activePlayer!);
    const resourcePlayer = current.players[resourceIndex];
    const company = resourcePlayer.companies[mhState.activeCompanyIndex];
    if (!company) return current;
    const [shuffled, nextRng] = shuffle(resourcePlayer.hand, current.rng);
    const discardCount = Math.min(apply.count, shuffled.length);
    const toDiscard = shuffled.slice(0, discardCount);
    const kept = shuffled.slice(discardCount);
    logDetail(`${cardName}: option resolved — ${resourcePlayer.name} randomly discards ${discardCount}/${resourcePlayer.hand.length} hand card(s)`);
    current = { ...current, rng: nextRng };
    current = updatePlayer(current, resourceIndex, p => ({
      ...p,
      hand: kept,
      discardPile: [...p.discardPile, ...toDiscard],
    }));
    return current;
  }

  return current;
}

/**
 * Dispatches the chosen `play-option` on a company-targeting hazard
 * short-event (e.g. Drowning Seas tw-30) once its chain entry resolves
 * un-negated. The option was chosen at play time (`entry.payload.optionId`);
 * this only fires for cards whose `play-target` is `"company"` — character-
 * and untargeted-mode `play-option` dispatch live in their own blocks above.
 */
function applyCompanyPlayOption(state: GameState, entry: ChainEntry): GameState {
  const card = entry.card;
  if (!card || entry.payload.type !== 'short-event' || !entry.payload.optionId) return state;
  const def = defById(state, card.definitionId);
  const playTarget = getCardEffects(def).find(
    (e): e is import('../types/effects.js').PlayTargetEffect => e.type === 'play-target',
  );
  if (playTarget?.target !== 'company') return state;

  const optionId = entry.payload.optionId;
  const opt = getCardEffects(def).find(
    (e): e is import('../types/effects.js').PlayOptionEffect => e.type === 'play-option' && e.id === optionId,
  );
  if (!opt) return state;

  const cardName = (def as { name?: string })?.name ?? (card.definitionId as string);
  return applyCompanyPlayOptionApply(state, opt.apply, cardName, card.instanceId, card.definitionId);
}

/**
 * Applies a `site-type-remap` short-event effect on chain resolution: installs
 * the class-wide `site.type` override ("all Shadow-holds [{S}] become
 * Dark-holds [{D}]" — Witch-king of Angmar tw-113's on-tap long-event).
 *
 * The constraint is filtered by the sites' *printed* type rather than by any
 * definition id, so it retypes every matching site in the game at once, and it
 * is targeted at the declaring player (the effect is global; it must outlive
 * every company). With `duration: "long-event"` its scope is
 * `next-long-event-phase`, which expires it exactly when a hazard long-event
 * owned by the declarer would be discarded ([2.III.3]) — the card itself goes
 * to the discard pile immediately, so the constraint carries the whole
 * duration.
 */
function applySiteTypeRemap(state: GameState, entry: ChainEntry): GameState {
  const card = entry.card;
  if (!card || entry.payload.type !== 'short-event') return state;
  const def = defById(state, card.definitionId);
  const effect = getCardEffects(def).find(
    (e): e is import('../types/effects.js').SiteTypeRemapEffect => e.type === 'site-type-remap',
  );
  if (!effect) return state;

  const scope: import('../types/pending.js').ConstraintScope = effect.duration === 'long-event'
    ? { kind: 'next-long-event-phase', playerId: entry.declaredBy, afterTurn: state.turnNumber }
    : { kind: 'turn' };
  logDetail(
    `${def?.name ?? (card.definitionId as string)}: all ${effect.from} sites become ${effect.to} `
    + `(scope ${scope.kind}, owner ${entry.declaredBy as string})`,
  );
  return addConstraint(state, {
    source: card.instanceId,
    sourceDefinitionId: card.definitionId,
    scope,
    target: { kind: 'player', playerId: entry.declaredBy },
    kind: {
      type: 'attribute-modifier',
      attribute: 'site.type',
      op: 'override',
      value: effect.to,
      filter: { 'site.printedType': effect.from } as unknown as import('../types/effects.js').Condition,
    },
  });
}

/**
 * Applies a `tap-character` short-event effect on chain resolution: taps the
 * character chosen when the card was played/tapped (the chain entry payload's
 * `targetCharacterId`). Used by Adûnaphel tw-2's permanent-event on-tap ("causes
 * any one character to tap"). No-op if the card carries no `tap-character`
 * effect or the target is gone (e.g. eliminated before resolution).
 */
function applyTapCharacter(state: GameState, entry: ChainEntry): GameState {
  const card = entry.card;
  if (!card || entry.payload.type !== 'short-event') return state;
  const targetCharId = entry.payload.targetCharacterId;
  if (!targetCharId) return state;
  const def = defById(state, card.definitionId);
  if (!getCardEffects(def).some(e => e.type === 'tap-character')) return state;
  for (let pi = 0; pi < 2; pi++) {
    if (state.players[pi].characters[targetCharId]) {
      logDetail(`${def?.name ?? 'card'}: taps character ${targetCharId as string}`);
      const players: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
      players[pi] = updateCharacter(players[pi], targetCharId, ch => ({ ...ch, status: CardStatus.Tapped }));
      return { ...state, players };
    }
  }
  return state;
}

/**
 * Resolves a `force-check-all-in-play` effect (Ren the Unclean tw-83's on-tap
 * short-event conversion): every character in play — both players' — must
 * make a corruption check.
 *
 * One `corruption-check` pending resolution is enqueued per character, actor
 * = the character's controller, scope = the current M/H phase. The moving
 * player (the active player, in whose M/H phase the tap happened) checks
 * first: the other player's entries carry `blockedBy` naming every moving-
 * player check ID, so `topResolutionFor` hides them until the moving player's
 * queue drains. All entries carry `selectableOrder` ("each player decides the
 * order of the corruption checks for their characters"); the declaring
 * player's entries additionally carry `allowSupport` / `noResourceAid` per
 * the effect's `declarerMayTapSupport` / `declarerNoResourceAid` fields.
 */
function applyForceCheckAllInPlay(state: GameState, entry: ChainEntry): GameState {
  const card = entry.card;
  if (!card || entry.payload.type !== 'short-event') return state;
  const def = defById(state, card.definitionId);
  const effect = getCardEffects(def).find(
    (e): e is import('../types/effects.js').ForceCheckAllInPlayEffect => e.type === 'force-check-all-in-play',
  );
  if (!effect || effect.check !== 'corruption') return state;

  const cardName = (def as { name?: string })?.name ?? (card.definitionId as string);
  const declarer = entry.declaredBy;
  // "The moving player makes corruption checks first" — the moving player is
  // the active player: the tap happens during the opponent's M/H phase.
  const movingPlayerId = state.activePlayer ?? declarer;
  const ordered = [...state.players].sort((a, b) =>
    (a.id === movingPlayerId ? 0 : 1) - (b.id === movingPlayerId ? 0 : 1));

  let current = state;
  let movingCheckIds: readonly import('../index.js').ResolutionId[] = [];
  for (const player of ordered) {
    const isMoving = player.id === movingPlayerId;
    const isDeclarer = player.id === declarer;
    for (const charId of characterIds(player)) {
      const char = player.characters[charId];
      const possessions = characterPossessions(char);
      current = enqueueCorruptionCheck(current, {
        source: card.instanceId,
        actor: player.id,
        scope: { kind: 'phase', phase: Phase.MovementHazard },
        characterId: charId,
        reason: cardName,
        modifier: effect.modifier ?? 0,
        possessions,
        selectableOrder: true,
        allowSupport: isDeclarer && effect.declarerMayTapSupport ? true : undefined,
        noResourceAid: isDeclarer && effect.declarerNoResourceAid ? true : undefined,
        blockedBy: !isMoving && movingCheckIds.length > 0 ? movingCheckIds : undefined,
      });
      const minted = current.pendingResolutions[current.pendingResolutions.length - 1];
      if (isMoving) movingCheckIds = [...movingCheckIds, minted.id];
      logDetail(`${cardName}: corruption check enqueued for ${charId as string} (${player.name}${isMoving ? ' — moving player, checks first' : ' — waits for moving player'})`);
    }
  }
  const total = current.pendingResolutions.length - state.pendingResolutions.length;
  logDetail(`${cardName}: force-check-all-in-play — ${total} corruption check(s) enqueued, moving player ${movingPlayerId as string} first`);
  return current;
}

/**
 * Resolves a `force-discard-target-item` effect (Indûr Dawndeath tw-46's on-tap
 * short-event conversion): "makes any wounded character discard an item of his
 * choice (but not a ring)".
 *
 * The card-player already chose *which* character when the permanent-event was
 * tapped (the target rides on the chain entry payload, and the emitter only
 * offered characters matching the effect's `targetFilter` that bear a
 * `itemFilter`-eligible item). The *item* is the target's own choice, so this
 * enqueues the shared `discard-one-company-item` pending resolution — narrowed
 * to that one character and carrying the item filter — for the target's
 * controller. Routing through that resolution also inherits the Leaf Brooch
 * (dm-171) `discard-substitute` interposition for free.
 *
 * No-op if the card carries no such effect, no target rode along, the target is
 * gone (eliminated before the chain resolved), or nothing eligible remains on it.
 */
function applyForceDiscardTargetItem(state: GameState, entry: ChainEntry): GameState {
  const card = entry.card;
  if (!card || entry.payload.type !== 'short-event') return state;
  const targetCharId = entry.payload.targetCharacterId;
  if (!targetCharId) return state;
  const def = defById(state, card.definitionId);
  const effect = getCardEffects(def).find(
    (e): e is import('../types/effects.js').ForceDiscardTargetItemEffect => e.type === 'force-discard-target-item',
  );
  if (!effect) return state;
  const cardLabel = (def as { name?: string })?.name ?? (card.definitionId as string);

  const owner = state.players.find(p => p.characters[targetCharId]);
  if (!owner) {
    logDetail(`${cardLabel}: force-discard-target-item — target character ${targetCharId as string} is no longer in play`);
    return state;
  }
  const char = owner.characters[targetCharId];
  const charLabel = (defById(state, char.definitionId) as { name?: string } | undefined)?.name ?? (targetCharId as string);
  const eligible = char.items.filter(item => {
    const itemDef = defById(state, item.definitionId);
    if (!itemDef || !isItemCard(itemDef)) return false;
    return !effect.itemFilter || matchesDefinition(itemDef, effect.itemFilter);
  });
  if (eligible.length === 0) {
    logDetail(`${cardLabel}: force-discard-target-item — ${charLabel} bears no eligible item, nothing to discard`);
    return state;
  }
  const company = findCharacterCompany(owner.companies, targetCharId);
  if (!company) {
    logDetail(`${cardLabel}: force-discard-target-item — target character ${targetCharId as string} is in no company`);
    return state;
  }

  logDetail(`${cardLabel}: force-discard-target-item — ${charLabel} must discard one of ${eligible.length} eligible item(s), owner's choice`);
  return enqueueResolution(state, {
    source: card.instanceId,
    actor: owner.id,
    scope: companySubphaseScope(state.phaseState.phase, company.id),
    kind: {
      type: 'discard-one-company-item',
      companyId: company.id,
      characterId: targetCharId,
      ...(effect.itemFilter ? { itemFilter: effect.itemFilter } : {}),
    },
  });
}

/**
 * Resolves an `attack-race-boost` effect (Dwar of Waw tw-31's on-tap
 * short-event conversion: "gives +1 prowess to all Wolf, Spider, and Animal
 * attacks until the end of the turn").
 *
 * Installs one turn-scoped `creature-attack-boost` active constraint — the
 * kind Chill Douser (dm-106) already places — carrying the effect's race list
 * and bonuses. Unlike Chill Douser's company-bound constraint this one targets
 * the **opponent of the declaring player**: the side whose companies face
 * hazards this turn. A player target reaches every company that player
 * controls, so the boost lands on hazard-creature attacks and site
 * automatic-attacks alike, which is what "all X attacks" means.
 *
 * No-op if the card carries no such effect.
 */
function applyAttackRaceBoost(state: GameState, entry: ChainEntry): GameState {
  const card = entry.card;
  if (!card) return state;
  const def = defById(state, card.definitionId);
  const effect = getCardEffects(def).find(
    (e): e is import('../types/effects.js').AttackRaceBoostEffect => e.type === 'attack-race-boost',
  );
  if (!effect) return state;
  const cardLabel = (def as { name?: string })?.name ?? (card.definitionId as string);

  const opponent = state.players.find(p => p.id !== entry.declaredBy);
  if (!opponent) {
    logDetail(`${cardLabel}: attack-race-boost — no opposing player found, fizzle`);
    return state;
  }
  const prowess = effect.prowess ?? 0;
  const strikes = effect.strikes ?? 0;
  logDetail(`${cardLabel}: attack-race-boost — all ${effect.races.join('/')} attacks against ${opponent.name} receive +${prowess} prowess / +${strikes} strikes until the end of the turn`);
  return addConstraint(state, {
    source: card.instanceId,
    sourceDefinitionId: card.definitionId,
    scope: { kind: 'turn' },
    target: { kind: 'player', playerId: opponent.id },
    kind: { type: 'creature-attack-boost', race: effect.races, strikes, prowess },
  });
}

/**
 * Resolves a `target-character-stat-modifier` effect (Akhôrahil tw-4's on-tap
 * short-event conversion: "modifies any one character's body by -1 for the rest
 * of this turn").
 *
 * The character was named when the permanent-event was tapped and rides on the
 * chain entry payload. Resolution installs a turn-scoped
 * `character-stat-modifier` constraint bound to that instance — the same kind
 * Vilya / Glance of Arien (ba-19) place — so the modifier is picked up by
 * `collectCharacterStatModifierEffects` when the character's `effectiveStats`
 * are recomputed, and is swept by the existing end-of-turn sweep.
 *
 * No-op if the card carries no such effect, no target rode along, or the target
 * left play before the chain resolved.
 */
function applyTargetCharacterStatModifier(state: GameState, entry: ChainEntry): GameState {
  const card = entry.card;
  if (!card || entry.payload.type !== 'short-event') return state;
  const targetCharId = entry.payload.targetCharacterId;
  if (!targetCharId) return state;
  const def = defById(state, card.definitionId);
  const effect = getCardEffects(def).find(
    (e): e is import('../types/effects.js').TargetCharacterStatModifierEffect =>
      e.type === 'target-character-stat-modifier',
  );
  if (!effect) return state;
  const cardLabel = (def as { name?: string })?.name ?? (card.definitionId as string);

  const owner = state.players.find(p => p.characters[targetCharId]);
  if (!owner) {
    logDetail(`${cardLabel}: target-character-stat-modifier — target character ${targetCharId as string} is no longer in play`);
    return state;
  }
  const charLabel = (defById(state, owner.characters[targetCharId].definitionId) as { name?: string } | undefined)?.name
    ?? (targetCharId as string);
  logDetail(`${cardLabel}: target-character-stat-modifier — ${charLabel} ${effect.stat} ${effect.value > 0 ? '+' : ''}${effect.value} until the end of the turn`);
  return addConstraint(state, {
    source: card.instanceId,
    sourceDefinitionId: card.definitionId,
    scope: { kind: 'turn' },
    target: { kind: 'character', characterId: targetCharId },
    kind: { type: 'character-stat-modifier', stat: effect.stat, value: effect.value, characterId: targetCharId },
  });
}

/**
 * Resolves a `cycle-hand` effect (Revealed to all Watchers, dm-85).
 *
 * The playing player (`entry.declaredBy` — the hazard player for a hazard
 * event) reveals their hand to their opponent, keeps the cards matching the
 * effect's `keepInHand` filter, sets the rest aside, draws from the top of
 * their play deck until their hand reaches their effective hand size, and
 * places the set-aside cards face-down on top of the play deck. When two or
 * more cards were set aside, an `arrange-deck-top` pending resolution is
 * enqueued so the player chooses their final order.
 *
 * Cards never leave a pile: the set-aside cards are placed on top of the deck
 * immediately (in hand order); the ordering resolution only permutes them.
 */
function applyCycleHand(
  state: GameState,
  entry: ChainEntry,
  effect: import('../types/effects.js').CycleHandEffect,
): GameState {
  const card = entry.card!;
  const def = defById(state, card.definitionId);
  const cardName = (def as { name?: string })?.name ?? (card.definitionId as string);
  const playerIndex = getPlayerIndex(state, entry.declaredBy);
  let current = state;

  // 1. Reveal the playing player's hand to their opponent.
  if (effect.revealHand) {
    const revealHand = current.players[playerIndex].hand;
    logDetail(`${cardName}: ${entry.declaredBy as string} reveals their hand (${revealHand.length} card(s)) to opponent`);
    current = revealInstances(current, revealHand);
  }

  // 2. Partition the hand: matching (kept) vs non-matching (set aside).
  const hand = current.players[playerIndex].hand;
  const keep: CardInstance[] = [];
  const setAside: CardInstance[] = [];
  for (const c of hand) {
    const cDef = defById(current, c.definitionId);
    if (cDef && matchesDefinition(cDef, effect.keepInHand)) keep.push(c);
    else setAside.push(c);
  }
  logDetail(`${cardName}: keeping ${keep.length} card(s) in hand, setting aside ${setAside.length}`);

  // 3. Draw from the deck top until the hand reaches the effective hand size.
  const drawToHandSize = effect.drawToHandSize ?? true;
  let deck = current.players[playerIndex].playDeck;
  let drawn: CardInstance[] = [];
  if (drawToHandSize) {
    const handSize = resolveHandSize(current, playerIndex);
    const need = Math.max(0, handSize - keep.length);
    const drawCount = Math.min(need, deck.length);
    drawn = deck.slice(0, drawCount);
    logDetail(`${cardName}: drawing ${drawCount} card(s) to reach hand size ${handSize} (deck ${deck.length} → ${deck.length - drawCount})`);
    deck = deck.slice(drawCount);
  }

  // 4. New hand = kept + drawn; set-aside cards go face-down on top of the deck.
  const newHand = [...keep, ...drawn];
  const newDeck = [...setAside, ...deck];
  current = updatePlayer(current, playerIndex, p => ({
    ...p,
    hand: newHand,
    playDeck: newDeck,
  }));

  // If two or more cards were set aside, let the player order the top of deck
  // ("in any order you choose"). With 0 or 1 set-aside cards there is nothing
  // to arrange, so no resolution is enqueued. The resolution is independent of
  // the chain (like Rolled down to the Sea's force-discard-card): the chain
  // entry is still marked resolved by the caller, and the player resolves the
  // ordering afterward while the opponent waits.
  if (effect.setAsideTo === 'deck-top' && setAside.length >= 2) {
    logDetail(`${cardName}: enqueuing arrange-deck-top for ${setAside.length} set-aside card(s)`);
    current = enqueueResolution(current, {
      source: card.instanceId,
      actor: entry.declaredBy,
      scope: { kind: 'phase', phase: Phase.MovementHazard },
      kind: {
        type: 'arrange-deck-top',
        count: setAside.length,
        orderedInstanceIds: [],
        sourceDefinitionId: card.definitionId,
      },
    });
  }

  return current;
}

/**
 * Resolve a `displace-stored-item` hazard (Neither so Ancient Nor so Potent
 * dm-73). Returns the targeted stored item from whichever marshalling-point
 * pile it sits in to that pile-owner's hand (discarding any attached cards),
 * and places the resolving card into that same owner's marshalling-point pile,
 * where its `mp-in-pile` effect determines its marshalling-point value.
 *
 * No instance is lost: the stored item moves killPile → hand, the resolving
 * card moves chain → killPile. When the stored item can no longer be located
 * (an unusual race), the resolving card is routed to its declaring player's
 * discard pile instead.
 */
function resolveDisplaceStoredItem(state: GameState, entry: ChainEntry, storedItemId: CardInstanceId): GameState {
  const card = entry.card!;
  const def = defById(state, card.definitionId);

  // Locate the marshalling-point pile holding the stored item.
  let ownerIdx = -1;
  for (let pi = 0; pi < state.players.length; pi++) {
    if (state.players[pi].killPile.some(c => c.instanceId === storedItemId)) { ownerIdx = pi; break; }
  }
  if (ownerIdx < 0) {
    const declaringIdx = getPlayerIndex(state, entry.declaredBy);
    logDetail(`"${def?.name ?? card.definitionId}": stored item ${storedItemId as string} not in any marshalling-point pile — routing card to owner's discard`);
    return updatePlayer(state, declaringIdx, p => ({ ...p, discardPile: [...p.discardPile, toCardInstance(card)] }));
  }

  const owner = state.players[ownerIdx];
  const storedCard = owner.killPile.find(c => c.instanceId === storedItemId)!;
  const storedDef = defById(state, storedCard.definitionId);
  // Stored items are held in the marshalling-point pile as bare CardInstances
  // (attachments are stripped at store time), so there is normally nothing to
  // discard; this sweep stays faithful to the card text ("discarding all
  // attached cards") should any attached-card model exist.
  const attached = (storedCard as { attachedCards?: readonly CardInstance[] }).attachedCards ?? [];

  logDetail(
    `"${def?.name ?? card.definitionId}": returning stored item ${storedDef?.name ?? (storedCard.definitionId as string)} to ${owner.id as string}'s hand`
    + `${attached.length ? ` (discarding ${attached.length} attached card(s))` : ''} and placing card in their marshalling-point pile`,
  );

  return updatePlayer(state, ownerIdx, p => ({
    ...p,
    killPile: [...p.killPile.filter(c => c.instanceId !== storedItemId), toCardInstance(card)],
    hand: [...p.hand, { instanceId: storedCard.instanceId, definitionId: storedCard.definitionId }],
    discardPile: attached.length
      ? [...p.discardPile, ...attached.map(a => ({ instanceId: a.instanceId, definitionId: a.definitionId }))]
      : p.discardPile,
  }));
}

/**
 * Discard every in-play instance of a card named `cardName`, scanning both
 * players' `cardsInPlay` **and** every character's attached `items`/`hazards`
 * (a resource permanent-event played "on a character" — e.g. Bade to Rule
 * le-167 on a Ringwraith — lives in that character's `items`, not in
 * `cardsInPlay`). Each removed instance is routed to its *owner's* discard pile
 * (owner derived from the instance-id prefix `<owner>-<counter>`, matching the
 * move primitive). No instance is lost: every card removed from a collection is
 * pushed onto exactly one discard pile.
 *
 * Backs the `discard-named-in-play` self-enters-play apply of The Lidless Eye
 * (le-203) / Sauron (ba-43): "Discards ... Bade to Rule."
 */
function discardNamedCardsInPlay(state: GameState, cardName: string): GameState {
  const players: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
  const nameMatches = (definitionId: CardDefinitionId): boolean =>
    defById(state, definitionId)?.name === cardName;
  // Owner of a removed card: prefer the instance-id owner prefix
  // (`<owner>-<counter>`), falling back to the collection it was found in when
  // the prefix does not resolve to a player (e.g. synthetic test instance ids).
  const ownerIndexOf = (instanceId: CardInstanceId, containingIndex: number): number => {
    const idx = players.findIndex(p => (p.id as string) === (instanceId as string).split('-')[0]);
    return idx >= 0 ? idx : containingIndex;
  };
  const removed: { inst: CardInstance; ownerIndex: number }[] = [];
  const record = (inst: CardInstance, containingIndex: number): void => {
    removed.push({ inst, ownerIndex: ownerIndexOf(inst.instanceId, containingIndex) });
  };

  for (let pi = 0; pi < 2; pi++) {
    // Bare cards in play.
    const keptCip = players[pi].cardsInPlay.filter(c => {
      if (nameMatches(c.definitionId)) {
        logDetail(`discard-named-in-play: discarding "${cardName}" ${c.instanceId as string} from cardsInPlay`);
        record({ instanceId: c.instanceId, definitionId: c.definitionId }, pi);
        return false;
      }
      return true;
    });

    // Attached cards on each character (items where a resource permanent-event
    // played "on a character" lives, plus hazards).
    const chars = { ...players[pi].characters };
    let charsChanged = false;
    for (const [cid, char] of Object.entries(players[pi].characters)) {
      const keptItems = char.items.filter(it => {
        if (nameMatches(it.definitionId)) {
          logDetail(`discard-named-in-play: discarding "${cardName}" ${it.instanceId as string} from ${cid}'s items`);
          record({ instanceId: it.instanceId, definitionId: it.definitionId }, pi);
          return false;
        }
        return true;
      });
      const keptHazards = char.hazards.filter(hz => {
        if (nameMatches(hz.definitionId)) {
          logDetail(`discard-named-in-play: discarding "${cardName}" ${hz.instanceId as string} from ${cid}'s hazards`);
          record({ instanceId: hz.instanceId, definitionId: hz.definitionId }, pi);
          return false;
        }
        return true;
      });
      if (keptItems.length !== char.items.length || keptHazards.length !== char.hazards.length) {
        chars[cid as CardInstanceId] = { ...char, items: keptItems, hazards: keptHazards };
        charsChanged = true;
      }
    }

    players[pi] = {
      ...players[pi],
      ...(keptCip.length !== players[pi].cardsInPlay.length ? { cardsInPlay: keptCip } : {}),
      ...(charsChanged ? { characters: chars } : {}),
    };
  }

  if (removed.length === 0) {
    logDetail(`discard-named-in-play: no "${cardName}" in play — nothing to discard`);
    return state;
  }

  for (const { inst, ownerIndex } of removed) {
    players[ownerIndex] = { ...players[ownerIndex], discardPile: [...players[ownerIndex].discardPile, inst] };
  }

  return { ...state, players };
}

/**
 * Backs the `discard-bearer-corruption` self-enters-play apply of Three
 * Golden Hairs (td-157): "All corruption cards on the bearer are discarded
 * when this card comes into play." Scans only the target character's
 * `hazards` (not the whole board, unlike `discardNamedCardsInPlay`) for
 * attached corruption cards and routes each to its owner's discard pile
 * (owner derived from the instance-id prefix, matching the move primitive),
 * preserving the no-card-disappears invariant. A "corruption card" is one
 * with `cardType: "hazard-corruption"` **or** a `hazard-event` carrying the
 * `"corruption"` game keyword — the same CoE-7.2.1 test used by
 * `movement-hazard.ts` (one-corruption-card-per-turn) and
 * `organization.ts` (no-tap removal roll), since every printed "Corruption."
 * hazard in the data files is modeled as the latter.
 */
function discardBearerCorruptionCards(state: GameState, bearerId: CardInstanceId): GameState {
  const players = state.players;
  const bearerPi = players.findIndex(p => !!p.characters[bearerId]);
  if (bearerPi < 0) {
    logDetail(`discard-bearer-corruption: bearer ${bearerId as string} not found — nothing to discard`);
    return state;
  }
  const char = players[bearerPi].characters[bearerId];
  const removed: CardInstance[] = [];
  const keptHazards = char.hazards.filter(hz => {
    const hzDef = defById(state, hz.definitionId);
    const isCorruptionCard = hzDef?.cardType === 'hazard-corruption'
      || (hzDef && 'keywords' in hzDef && (hzDef as { keywords?: readonly string[] }).keywords?.includes('corruption') === true);
    if (isCorruptionCard && hzDef) {
      logDetail(`discard-bearer-corruption: discarding "${hzDef.name}" ${hz.instanceId as string} from ${bearerId as string}'s hazards`);
      removed.push({ instanceId: hz.instanceId, definitionId: hz.definitionId });
      return false;
    }
    return true;
  });
  if (removed.length === 0) {
    logDetail(`discard-bearer-corruption: no corruption cards on ${bearerId as string} — nothing to discard`);
    return state;
  }
  const ownerIndexOf = (instanceId: CardInstanceId): number => {
    const idx = players.findIndex(p => (p.id as string) === (instanceId as string).split('-')[0]);
    return idx >= 0 ? idx : bearerPi;
  };
  let newState = updatePlayer(state, bearerPi, p => ({
    ...p,
    characters: { ...p.characters, [bearerId]: { ...char, hazards: keptHazards } },
  }));
  for (const inst of removed) {
    const ownerIndex = ownerIndexOf(inst.instanceId);
    newState = updatePlayer(newState, ownerIndex, p => ({ ...p, discardPile: [...p.discardPile, inst] }));
  }
  return newState;
}

/**
 * Resolves a Wizard's Trove (wh-85) style permanent-event chain entry — a
 * `play-with-stored-card` or `storage-site-transfer` combo play. The
 * placement is handled here in full; in particular the site binding is NOT
 * stamped as `attachedToSite`: the orphaned-site sweep would otherwise
 * discard the card whenever no company occupies the site, but the trove
 * parks its cards at the Wizardhaven permanently.
 *
 * Returns `undefined` when the entry is not a combo play (the generic
 * {@link resolvePermanentEvent} path continues).
 */
function resolveStoredComboEvent(state: GameState, entry: ChainEntry): GameState | undefined {
  if (entry.payload.type !== 'permanent-event') return undefined;
  const payload = entry.payload;
  const card = entry.card!;
  const def = defById(state, card.definitionId);
  const playerIndex = getPlayerIndex(state, entry.declaredBy);
  const siteDefId = payload.targetSiteDefinitionId;

  const playWithStored = getCardEffects(def).find(
    (e): e is import('../types/effects.js').PlayWithStoredCardEffect => e.type === 'play-with-stored-card',
  );
  const storageTransfer = getCardEffects(def).find(
    (e): e is import('../types/effects.js').StorageSiteTransferEffect => e.type === 'storage-site-transfer',
  );

  // Mode 1 — play-with-stored-card: bring the companion (e.g. The White Tree)
  // from hand into play linked to the resolving card, pin its MP, ignore its
  // text, and protect the site.
  if (playWithStored && payload.companionCardInstanceId && siteDefId) {
    const player = state.players[playerIndex];
    const companion = findById(player.hand, payload.companionCardInstanceId);
    if (!companion) {
      // The companion left hand between declaration and resolution (e.g. a
      // forced discard). The combo cannot complete — the resolving card goes
      // to the discard pile; no instance is lost.
      logDetail(`"${def?.name ?? '?'}": companion ${payload.companionCardInstanceId as string} no longer in hand — card fizzles to discard`);
      return updatePlayer(state, playerIndex, p => ({ ...p, discardPile: [...p.discardPile, toCardInstance(card)] }));
    }
    const companionDef = defById(state, companion.definitionId);
    const companionMp = companionDef && 'marshallingPoints' in companionDef
      ? (companionDef as { marshallingPoints: number }).marshallingPoints
      : undefined;
    logDetail(
      `"${def?.name ?? '?'}": entering play with "${companionDef?.name ?? '?'}" at site ${siteDefId as string}`
      + (playWithStored.fullMarshallingPoints && companionMp !== undefined ? ` (mpPinned ${companionMp})` : '')
      + (playWithStored.ignoreCardText ? ' (text ignored)' : ''),
    );
    let next = revealInstances(state, [companion]);
    next = updatePlayer(next, playerIndex, p => ({
      ...p,
      hand: removeById(p.hand, companion.instanceId),
      cardsInPlay: [
        ...p.cardsInPlay,
        {
          instanceId: companion.instanceId,
          definitionId: companion.definitionId,
          status: CardStatus.Untapped,
          linkedInstanceId: card.instanceId,
          ...(playWithStored.fullMarshallingPoints && companionMp !== undefined ? { mpPinned: companionMp } : {}),
          ...(playWithStored.ignoreCardText ? { textIgnored: true } : {}),
        },
        {
          instanceId: card.instanceId,
          definitionId: card.definitionId,
          status: CardStatus.Untapped,
          linkedInstanceId: companion.instanceId,
        },
      ],
    }));
    if (playWithStored.siteBecomesProtected) {
      logDetail(`"${def?.name ?? '?'}": site ${siteDefId as string} becomes protected for ${entry.declaredBy as string}`);
      next = addConstraint(next, {
        source: card.instanceId,
        sourceDefinitionId: card.definitionId,
        scope: { kind: 'until-cleared' },
        target: { kind: 'player', playerId: entry.declaredBy },
        kind: { type: 'site-flag', flag: 'site-protected', siteDefinitionId: siteDefId },
      });
    }
    return next;
  }

  // Mode 2 — storage-site-transfer: store the chosen item at the target site
  // (mirroring the `store-item` flow: marshalling-point pile + initial-bearer
  // corruption check + bearer-cannot-untap cleanup), stamping the stored pile
  // entry with `storedAtSite` and linking the resolving card to it.
  if (storageTransfer && payload.storeItemInstanceId && payload.storeCharacterId && siteDefId) {
    const player = state.players[playerIndex];
    const removed = removeAttachment(player, 'items', payload.storeItemInstanceId);
    if (!removed || removed.charId !== payload.storeCharacterId) {
      logDetail(`"${def?.name ?? '?'}": item ${payload.storeItemInstanceId as string} no longer borne by ${payload.storeCharacterId as string} — card fizzles to discard`);
      return updatePlayer(state, playerIndex, p => ({ ...p, discardPile: [...p.discardPile, toCardInstance(card)] }));
    }
    const item = removed.attachment;
    const itemDef = defById(state, item.definitionId);
    logDetail(`"${def?.name ?? '?'}": storing ${itemDef?.name ?? '?'} at site ${siteDefId as string} (storage-site transfer)`);
    let next = updatePlayer(state, playerIndex, () => ({
      ...removed.player,
      killPile: [
        ...removed.player.killPile,
        { instanceId: item.instanceId, definitionId: item.definitionId, storedAtSite: siteDefId },
      ],
      cardsInPlay: [
        ...removed.player.cardsInPlay,
        {
          instanceId: card.instanceId,
          definitionId: card.definitionId,
          status: CardStatus.Untapped,
          attachedToStored: item.instanceId,
        },
      ],
    }));
    logDetail(`Enqueuing corruption check for ${payload.storeCharacterId as string} after storage-site transfer`);
    next = enqueueCorruptionCheck(next, {
      source: item.instanceId,
      actor: entry.declaredBy,
      scope: { kind: 'phase', phase: state.phaseState.phase },
      characterId: payload.storeCharacterId,
      reason: 'Store',
    });
    // Clear any bearer-cannot-untap constraints referencing the stored card
    // (Rescue Prisoners family), exactly as the store-item handler does.
    const bearerConstraints = next.activeConstraints.filter(
      c => c.kind.type === 'bearer-cannot-untap' && c.kind.cardInstanceId === item.instanceId,
    );
    for (const c of bearerConstraints) {
      logDetail(`"${def?.name ?? '?'}": clearing bearer-cannot-untap constraint from stored "${itemDef?.name ?? '?'}" (${c.id as string})`);
      next = removeConstraint(next, c.id);
    }
    return next;
  }

  return undefined;
}

/**
 * Locate an *eliminated* creature instance: one sitting in either player's
 * marshalling-point pile (`killPile` — a defeated creature kept as a trophy) or
 * out-of-play pile. Returns the instance together with the index of the player
 * holding the pile, or `null` when the instance is in neither.
 */
function locateEliminatedCard(
  state: GameState,
  instanceId: CardInstanceId,
): { instance: CardInstance; holderIndex: number; pile: 'killPile' | 'outOfPlayPile' } | null {
  for (let pi = 0; pi < state.players.length; pi++) {
    const p = state.players[pi];
    const inKill = p.killPile.find(c => c.instanceId === instanceId);
    if (inKill) return { instance: inKill, holderIndex: pi, pile: 'killPile' };
    const inOut = p.outOfPlayPile.find(c => c.instanceId === instanceId);
    if (inOut) return { instance: inOut, holderIndex: pi, pile: 'outOfPlayPile' };
  }
  return null;
}

/**
 * Resolve an `un-eliminate-creature` permanent-event option (Returned Beyond All
 * Hope as-35 mode 3): "make a roll—if the result is greater than 8, bring an
 * eliminated Elf or Maia hazard creature to its owner's discard pile **and**
 * place this card in your opponent's marshalling point pile, otherwise, discard
 * this card."
 *
 * The 2d6 total is compared against `apply.threshold` (9 = "greater than 8").
 *
 * On success the declared creature leaves the terminal pile it was in (a
 * trophy in someone's marshalling-point pile, or an out-of-play card) for its
 * **owner's** discard pile — owner derived from the instance-id prefix, falling
 * back to the opponent of the pile holder, since a creature only ever reaches
 * another player's kill/out-of-play pile by attacking them. Because the creature
 * is no longer in a terminal pile, {@link isManifestationDefeated} stops
 * reporting its chain as defeated, which is exactly the CRF 22 ruling that this
 * card "«un-eliminates» a hazard creature, allowing any manifestation of that
 * character to be played". The resolving card itself is then placed into the
 * opponent's marshalling-point pile, where its `mp-in-pile` effect scores it.
 *
 * On failure — or when the declared creature can no longer be located — the
 * resolving card goes to its own player's discard pile. Either way the card
 * rode the chain and lands in exactly one pile: no instance is lost, and it
 * never enters `cardsInPlay`.
 */
function resolveUnEliminateCreature(
  state: GameState,
  entry: ChainEntry,
  apply: import('../types/effects.js').UnEliminateCreatureAction,
): { state: GameState; effect: import('../index.js').GameEffect } {
  const card = entry.card!;
  const def = defById(state, card.definitionId);
  const cardNm = def?.name ?? (card.definitionId as string);
  const declarerIdx = getPlayerIndex(state, entry.declaredBy);
  const opponentIdx = 1 - declarerIdx;

  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const total = roll.die1 + roll.die2;
  const success = total >= apply.threshold;
  let current: GameState = { ...state, rng, cheatRollTotal };
  const rollEffect = diceRollEffect(
    current.players[declarerIdx].name,
    roll,
    `${cardNm}: un-eliminate a creature`,
  );
  logDetail(`${cardNm}: ${current.players[declarerIdx].name} rolls ${roll.die1} + ${roll.die2} = ${total} vs threshold ${apply.threshold} — ${success ? 'success' : 'failure'}`);

  const targetId = entry.payload.type === 'permanent-event'
    ? entry.payload.optionTargetInstanceId
    : undefined;
  const located = targetId ? locateEliminatedCard(current, targetId) : null;
  const targetDef = located ? defById(current, located.instance.definitionId) : undefined;
  const matches = !!located && !!targetDef && matchesDefinition(targetDef, apply.filter);

  if (!success || !located || !matches) {
    if (success && !located) {
      logDetail(`${cardNm}: declared creature ${String(targetId)} is no longer eliminated — nothing to recover`);
    } else if (success && !matches) {
      logDetail(`${cardNm}: declared card ${String(targetId)} does not match the recovery filter`);
    }
    logDetail(`${cardNm}: → ${current.players[declarerIdx].name}'s discard pile`);
    return {
      state: updatePlayer(current, declarerIdx, p => ({
        ...p,
        discardPile: [...p.discardPile, toCardInstance(card)],
      })),
      effect: rollEffect,
    };
  }

  // Owner of the recovered creature: the instance-id prefix is authoritative
  // (deck ownership never transfers). Fall back to the opponent of the pile
  // holder — a creature reaches another player's kill/out-of-play pile only by
  // having attacked them.
  const ownerId = ownerOf(located.instance.instanceId);
  const prefixIdx = current.players.findIndex(p => p.id === ownerId);
  const creatureOwnerIdx = prefixIdx >= 0 ? prefixIdx : 1 - located.holderIndex;
  const creatureName = targetDef && 'name' in targetDef ? targetDef.name : (located.instance.definitionId as string);

  logDetail(`${cardNm}: un-eliminating ${creatureName} from ${current.players[located.holderIndex].name}'s ${located.pile} → ${current.players[creatureOwnerIdx].name}'s discard pile`);
  const holderIdx = located.holderIndex;
  const pile = located.pile;
  current = updatePlayer(current, holderIdx, p => ({
    ...p,
    [pile]: p[pile].filter(c => c.instanceId !== located.instance.instanceId),
  }));
  current = updatePlayer(current, creatureOwnerIdx, p => ({
    ...p,
    discardPile: [...p.discardPile, located.instance],
  }));

  logDetail(`${cardNm}: → ${current.players[opponentIdx].name}'s marshalling-point pile`);
  current = updatePlayer(current, opponentIdx, p => ({
    ...p,
    killPile: [...p.killPile, toCardInstance(card)],
  }));

  return { state: current, effect: rollEffect };
}

/**
 * Resolves a permanent-event chain entry: moves the card from the chain
 * into the declaring player's `cardsInPlay` and executes `self-enters-play`
 * effects (e.g. Gates of Morning discarding hazard environments).
 */
function resolvePermanentEvent(state: GameState, entry: ChainEntry): GameState {
  const card = entry.card!;
  const def = defById(state, card.definitionId);
  const playerIndex = getPlayerIndex(state, entry.declaredBy);

  // Neither so Ancient Nor so Potent (dm-73): a hazard played on an opponent's
  // stored item. Rather than entering the hazard player's `cardsInPlay`, it
  // returns the targeted stored item to its owner's hand and places itself into
  // that owner's marshalling-point pile. Handle this entirely and return.
  const displaceEffect = getCardEffects(def).find(
    (e): e is import('../types/effects.js').DisplaceStoredItemEffect => e.type === 'displace-stored-item',
  );
  const storedItemId = entry.payload.type === 'permanent-event'
    ? entry.payload.targetStoredItemInstanceId
    : undefined;
  if (displaceEffect && storedItemId) {
    return resolveDisplaceStoredItem(state, entry, storedItemId);
  }

  // Wizard's Trove (wh-85) family: `play-with-stored-card` /
  // `storage-site-transfer` combo plays are placed by their dedicated
  // resolver (which must not stamp `attachedToSite` — see its doc comment).
  const comboResolved = resolveStoredComboEvent(state, entry);
  if (comboResolved) return comboResolved;

  logDetail(`Permanent event resolves: "${def?.name ?? card.definitionId}" enters play for player ${entry.declaredBy as string}`);

  // Place the resolving card via the move primitive. The card lives only on
  // the chain entry (removed from hand at declaration), so every destination
  // sources it with `from: 'chain'` (ctx.chainCard, no-op removal).
  const targetCharId = entry.payload.type === 'permanent-event' ? entry.payload.targetCharacterId : undefined;
  const targetItemId = entry.payload.type === 'permanent-event' ? entry.payload.targetItemInstanceId : undefined;
  // Helms of Iron (dm-64): the Nazgûl permanent-event chosen at declaration
  // to discard via this card's self-enters-play move.
  const targetNazgulId = entry.payload.type === 'permanent-event' ? entry.payload.targetNazgulInstanceId : undefined;
  const moveCtx: import('./reducer-move.js').MoveContext = {
    sourceCardId: card.instanceId,
    sourcePlayerIndex: playerIndex,
    chainCard: toCardInstance(card),
    ...(targetCharId ? { targetCharacterId: targetCharId } : {}),
  };
  const placeMove = (to: import('../types/effects.js').MoveZone): GameState => {
    const r = applyMove(state, { type: 'move', select: 'self', from: 'chain', to }, moveCtx);
    if ('error' in r) {
      logDetail(`Permanent event "${def?.name ?? card.definitionId}" placement failed (${r.error}) — card not placed`);
      return state;
    }
    return r.state;
  };

  let working: GameState;
  if (targetCharId) {
    // "Playable on a character" — attach to the target character. Resource
    // permanent events (e.g. Align Palantír) go into items; hazard permanent
    // events into hazards (the `in-play-on-character` destination picks the
    // slot by card type via the shared `inPlayOnCharacterSlot` helper).
    const isResource = def && (def.cardType === 'hero-resource-event' || def.cardType === 'minion-resource-event');
    let bearerPi = -1;
    for (let pi = 0; pi < 2; pi++) {
      if (state.players[pi].characters[targetCharId]) { bearerPi = pi; break; }
    }
    // Ward check: a hazard permanent-event attaching to a character with a
    // matching ward (e.g. Adamant Helmet vs. dark enchantments) is cancelled —
    // the card goes straight to its owner's discard pile instead of attaching.
    if (!isResource && def && bearerPi >= 0 && isWardedAgainst(state, bearerPi, targetCharId, def)) {
      logDetail(`Ward on ${targetCharId as string} cancels incoming "${def.name}" — routing to owner's discard`);
      working = placeMove('discard');
    } else {
      logDetail(`Attaching "${def?.name ?? card.definitionId}" to character ${targetCharId as string} (${isResource ? 'items' : 'hazards'})`);
      working = placeMove('in-play-on-character');
    }
  } else {
    // General permanent event — add to cardsInPlay. Site-targeting permanent
    // hazards carry their site binding through the chain payload; record it on
    // the CardInPlay entry so the company-arrives-at-site event hook can match
    // arrivals against the bound site location. Company-targeting permanent
    // events (e.g. Fellowship) store the company ID so company-modifier effects
    // are scoped to that company only. The bindings are stamped onto the
    // just-placed entry (the move primitive carries no card-data bindings).
    working = placeMove('in-play-general');
    const targetSiteDefId = entry.payload.type === 'permanent-event' ? entry.payload.targetSiteDefinitionId : undefined;
    const targetCompanyId = entry.payload.type === 'permanent-event' ? entry.payload.targetCompanyId : undefined;
    // Inner Cunning (dm-68) mode 1: a permanent event bound to a face-down agent.
    const targetAgentId = entry.payload.type === 'permanent-event' ? entry.payload.targetAgentId : undefined;
    if (targetSiteDefId || targetCompanyId || targetAgentId || targetItemId) {
      working = updatePlayer(working, playerIndex, p => ({
        ...p,
        cardsInPlay: p.cardsInPlay.map(c => c.instanceId === card.instanceId
          ? {
              ...c,
              ...(targetSiteDefId ? { attachedToSite: targetSiteDefId } : {}),
              ...(targetCompanyId ? { companyId: targetCompanyId } : {}),
              ...(targetAgentId ? { attachedToAgentId: targetAgentId } : {}),
              ...(targetItemId ? { attachedToItem: targetItemId } : {}),
            }
          : c),
      }));
      if (targetSiteDefId) {
        logDetail(`"${def?.name ?? card.definitionId}" attached to site ${targetSiteDefId as string}`);
      }
      if (targetCompanyId) {
        logDetail(`"${def?.name ?? card.definitionId}" bound to company ${targetCompanyId as string}`);
      }
      if (targetAgentId) {
        logDetail(`"${def?.name ?? card.definitionId}" attached to face-down agent ${targetAgentId as string}`);
      }
      if (targetItemId) {
        logDetail(`"${def?.name ?? card.definitionId}" attached to item ${targetItemId as string}`);
      }
    }

    // Faction-targeting permanent event (Long Grievous Siege ba-40): bind the
    // host to the target faction instance, move the chosen location-deck site
    // off to the side with the host, and return every in-play faction playable
    // at that site to its owner's hand.
    const targetFactionId = entry.payload.type === 'permanent-event' ? entry.payload.targetFactionInstanceId : undefined;
    const besiegedSiteId = entry.payload.type === 'permanent-event' ? entry.payload.besiegedSiteInstanceId : undefined;
    if (targetFactionId) {
      working = updatePlayer(working, playerIndex, p => ({
        ...p,
        cardsInPlay: p.cardsInPlay.map(c => c.instanceId === card.instanceId
          ? { ...c, attachedTo: targetFactionId }
          : c),
      }));
      logDetail(`"${def?.name ?? card.definitionId}" attached to faction ${targetFactionId as string}`);
    }

    // Long-event-targeting permanent event (Echo of All Joy td-110): bind the
    // host to the target resource long-event instance via `attachedToLongEvent`.
    const targetLongEventId = entry.payload.type === 'permanent-event' ? entry.payload.targetLongEventInstanceId : undefined;
    if (targetLongEventId) {
      working = updatePlayer(working, playerIndex, p => ({
        ...p,
        cardsInPlay: p.cardsInPlay.map(c => c.instanceId === card.instanceId
          ? { ...c, attachedToLongEvent: targetLongEventId }
          : c),
      }));
      logDetail(`"${def?.name ?? card.definitionId}" attached to long-event ${targetLongEventId as string}`);
    }
    if (besiegedSiteId) {
      const siteInst = working.players[playerIndex].siteDeck.find(s => s.instanceId === besiegedSiteId);
      const siteDef = siteInst ? defById(working, siteInst.definitionId) : undefined;
      if (siteInst && siteDef && isSiteCard(siteDef)) {
        // Remove the site card from the controller's location deck and keep it
        // off to the side with the host; bind the host to the site definition
        // so its ongoing effects match every version of the site.
        working = updatePlayer(working, playerIndex, p => ({
          ...p,
          siteDeck: p.siteDeck.filter(s => s.instanceId !== besiegedSiteId),
          cardsInPlay: p.cardsInPlay.map(c => c.instanceId === card.instanceId
            ? { ...c, attachedToSite: siteInst.definitionId }
            : c),
        }));
        working = placeCardSetAside(working, card.instanceId, toCardInstance(siteInst));
        logDetail(`"${def?.name ?? card.definitionId}" besieges ${siteDef.name} — site card set aside from the location deck`);

        // "Return any faction playable at the Border-hold to its owner's hand."
        // Both players' in-play factions are checked against the besieged site
        // definition (isCardPlayableAtSiteDef covers named-site, site-type, and
        // region playableAt entries).
        for (let pi = 0; pi < 2; pi++) {
          const bounced = working.players[pi].cardsInPlay.filter(c => {
            if (c.setAsideHost !== undefined) return false;
            const fDef = defById(working, c.definitionId);
            return !!fDef && isFactionCard(fDef) && isCardPlayableAtSiteDef(fDef, siteDef, working);
          });
          if (bounced.length === 0) continue;
          const bouncedIds = new Set(bounced.map(c => c.instanceId as string));
          working = updatePlayer(working, pi, p => ({
            ...p,
            cardsInPlay: p.cardsInPlay.filter(c => !bouncedIds.has(c.instanceId as string)),
          }));
          for (const fc of bounced) {
            const fOwnerIdx = getPlayerIndex(working, ownerOf(fc.instanceId));
            working = updatePlayer(working, fOwnerIdx, p => ({
              ...p,
              hand: [...p.hand, toCardInstance(fc)],
            }));
            logDetail(`"${def?.name ?? card.definitionId}": faction ${defById(working, fc.definitionId)?.name ?? fc.definitionId as string} playable at ${siteDef.name} returned to owner's hand`);
          }
        }
      } else {
        logDetail(`"${def?.name ?? card.definitionId}": besieged site ${besiegedSiteId as string} not found in location deck — no site bound`);
      }
    }

    // A `trigger-attack-on-play` permanent event that lingers after its attacks
    // (Descent through Fire ba-56: kept in the marshalling-point pile) carries
    // ongoing effects that must NOT apply during the self-inflicted attacks it
    // is about to trigger. Mark the just-placed entry pending so
    // `collectGlobalEffects` ignores it until the bearer is chosen; the flag is
    // cleared on `move-to-mp-pile` keep, and the card is discarded otherwise.
    const hasTriggerAttack = getCardEffects(def).some(e => e.type === 'trigger-attack-on-play');
    if (hasTriggerAttack) {
      logDetail(`"${def?.name ?? card.definitionId}" trigger-attack-on-play: suppressing its ongoing effects until bearer selection`);
      working = updatePlayer(working, playerIndex, p => ({
        ...p,
        cardsInPlay: p.cardsInPlay.map(c => c.instanceId === card.instanceId
          ? { ...c, pendingTriggerAttack: true }
          : c),
      }));
    }
  }

  const newPlayers: [PlayerState, PlayerState] = [working.players[0], working.players[1]];

  // no-direct-influence flag (e.g. Rebel-talk le-132) — per CRF-22, "A character
  // removed from the control of direct influence outside the organization phase
  // does not need to be controlled by general influence until that player's next
  // organization phase." So attaching the restriction does NOT itself move the
  // bearer off its current controller's followers list — the company structure
  // stays exactly as it was. The release to general influence (and the CoE
  // 2.II.2.2.3 "moved back under control ... or discarded" resolution) happens
  // at the start of the bearer's owning player's next organization phase; see
  // the no-direct-influence sweep in reducer-untap.ts.
  if (targetCharId && hasPlayFlag(def as { effects?: readonly import('../types/effects.js').CardEffect[] }, 'no-direct-influence')) {
    for (let pi = 0; pi < 2; pi++) {
      const char = newPlayers[pi].characters[targetCharId];
      if (char && char.controlledBy !== 'general') {
        logDetail(
          `"${def?.name ?? '?'}" restricts ${targetCharId as string} from direct-influence control`
          + ' (stays under its current controller until its player\'s next organization phase — CRF-22)',
        );
        break;
      }
    }
  }

  let newState: GameState = { ...working, players: newPlayers };

  // Apply play-target character tap cost for permanent events (e.g. That's Been
  // Heard Before Tonight taps the targeted character on play). The cost is declared
  // on the play-target effect rather than the card root.
  if (targetCharId) {
    const playTargetEff = getCardEffects(def).find(
      (e): e is PlayTargetEffect => e.type === 'play-target' && e.target === 'character' && !!e.cost?.tap,
    );
    if (playTargetEff?.cost) {
      const costResult = applyCost(newState, playTargetEff.cost, targetCharId, {
        playerIndex,
        label: def?.name ?? '?',
      });
      if (!('error' in costResult)) {
        newState = costResult.state;
        logDetail(`"${def?.name ?? '?'}" applied play-target cost (tap) to ${targetCharId as string}`);
        // Place bearer-cannot-untap so the character stays tapped until the card
        // is stored (e.g. at a Darkhaven for le-241) — but only when the card's
        // text declares the untap lock via the play-flag. Cards like That Ain't
        // No Secret (le-240) tap the bearer on play yet untap it normally. The
        // store-item handler clears this constraint automatically when the card
        // leaves the character.
        if (hasPlayFlag(def as { effects?: readonly import('../types/effects.js').CardEffect[] }, 'bearer-cannot-untap-until-stored')) {
          newState = addConstraint(newState, {
            source: card.instanceId,
            sourceDefinitionId: card.definitionId,
            scope: { kind: 'until-cleared' },
            target: { kind: 'character', characterId: targetCharId },
            kind: { type: 'bearer-cannot-untap', cardInstanceId: card.instanceId },
          });
          logDetail(`"${def?.name ?? '?'}" placed bearer-cannot-untap constraint on ${targetCharId as string}`);
        }
      } else {
        logDetail(`"${def?.name ?? '?'}" play-target cost failed: ${costResult.error}`);
      }
    }
  }

  // tap-site-on-play: tap the active company's current site when the card enters play,
  // unless the site carries the never-taps site-rule (e.g. The Worthy Hills).
  newState = applyTapSiteOnPlayFlag(newState, def, playerIndex);

  // eddy-lock (Eddy in Fate's Tide ba-57): "Tap The Balrog and the site." The
  // site is tapped by the tap-site-on-play flag above; here we tap the player's
  // avatar (The Balrog) in the active company (its presence is guaranteed by
  // the company-context play-condition). The card attaches to the site
  // (targetSiteDefinitionId), so there is no targetCharId — the Balrog is a
  // play cost, not the attachment.
  if (getCardEffects(def).some(e => e.type === 'eddy-lock')) {
    const ps = newState.phaseState as { activeCompanyIndex?: number };
    const activeCompanyIndex = ps.activeCompanyIndex ?? 0;
    const company = newState.players[playerIndex].companies[activeCompanyIndex];
    const avatar = findPlayerAvatar(newState, newState.players[playerIndex]);
    const balrogId = avatar && company?.characters.includes(avatar.instanceId)
      ? avatar.instanceId
      : undefined;
    if (balrogId) {
      const balrog = newState.players[playerIndex].characters[balrogId];
      if (balrog && balrog.status !== CardStatus.Tapped) {
        logDetail(`"${def?.name ?? '?'}" eddy-lock: tapping The Balrog ${balrogId as string}`);
        newState = updatePlayer(newState, playerIndex, p => updateCharacter(p, balrogId, () => ({
          ...balrog,
          status: CardStatus.Tapped,
        })));
      }
    } else {
      logDetail(`"${def?.name ?? '?'}" eddy-lock: no The Balrog in active company to tap`);
    }
  }

  // tap-character-on-play: tap the targeted character when the card enters play.
  if (targetCharId && hasPlayFlag(def as { effects?: readonly import('../types/effects.js').CardEffect[] }, 'tap-character-on-play')) {
    for (let pi = 0; pi < 2; pi++) {
      const char = newState.players[pi].characters[targetCharId];
      if (char) {
        logDetail(`"${def?.name ?? '?'}" tap-character-on-play: tapping character ${targetCharId as string}`);
        newState = updatePlayer(newState, pi, p => updateCharacter(p, targetCharId, () => ({
          ...char,
          status: CardStatus.Tapped,
        })));
        break;
      }
    }
  }

  // tap-bearer-on-play: for an item-targeting permanent event, tap the character
  // bearing the targeted item (Barrow-blade dm-119: "Tap the bearer of a Dagger
  // of Westernesse … and play this with the Dagger").
  if (targetItemId && hasPlayFlag(def as { effects?: readonly import('../types/effects.js').CardEffect[] }, 'tap-bearer-on-play')) {
    for (let pi = 0; pi < 2; pi++) {
      const entry2 = Object.entries(newState.players[pi].characters).find(([, ch]) =>
        ch.items.some(it => it.instanceId === targetItemId),
      );
      if (entry2) {
        const [bearerId, bearer] = entry2;
        logDetail(`"${def?.name ?? '?'}" tap-bearer-on-play: tapping bearer ${bearerId} of item ${targetItemId as string}`);
        newState = updatePlayer(newState, pi, p => updateCharacter(p, bearerId as import('../types/common.js').CardInstanceId, () => ({
          ...bearer,
          status: CardStatus.Tapped,
        })));
        break;
      }
    }
  }

  // roll-untap-site (Fireworks dm-130): "Make a roll and add the mind of the
  // sage (+10 if a Wizard) — if the result is greater than 12, the site untaps."
  // Enqueue a generic dice-check whose onPass `untap-site` verb untaps the
  // target character's company's current site. The roll surfaces as its own
  // `resolve-dice-check` action.
  if (targetCharId) {
    const rollUntapEffect = getCardEffects(def).find(
      (e): e is import('../types/effects.js').RollUntapSiteEffect => e.type === 'roll-untap-site',
    );
    if (rollUntapEffect) {
      let bearerPi = -1;
      for (let pi = 0; pi < 2; pi++) {
        if (newState.players[pi].characters[targetCharId]) { bearerPi = pi; break; }
      }
      const bearer = bearerPi >= 0 ? newState.players[bearerPi].characters[targetCharId] : undefined;
      const bearerDef = bearer ? defById(newState, bearer.definitionId) : undefined;
      const effectiveMind = bearer?.effectiveStats.mind ?? printedMind(bearerDef);
      const bearerRace = raceForCardTextFilter(bearerDef);
      const isWizard = Array.isArray(bearerRace) ? bearerRace.includes(Race.Wizard) : bearerRace === Race.Wizard;
      const rollBonus = effectiveMind + (isWizard ? rollUntapEffect.wizardBonus : 0);
      logDetail(`"${def?.name ?? '?'}" roll-untap-site: enqueuing dice-check (roll + mind ${effectiveMind}${isWizard ? ` + wizard ${rollUntapEffect.wizardBonus}` : ''} = +${rollBonus} > ${rollUntapEffect.threshold}) on ${targetCharId as string}`);
      newState = enqueueResolution(newState, {
        source: card.instanceId,
        actor: entry.declaredBy,
        scope: { kind: 'phase', phase: newState.phaseState.phase },
        kind: {
          type: 'dice-check',
          label: `${def?.name ?? 'Fireworks'} — roll to untap site`,
          roller: entry.declaredBy,
          modifiers: [{ kind: 'constant', value: rollBonus }],
          threshold: rollUntapEffect.threshold,
          comparison: 'gt',
          onPass: { type: 'untap-site' },
          continuation: { kind: 'dequeue-only' },
          targetCharacterId: targetCharId,
        },
      });
    }
  }

  // opposed-roll (No More Nonsense le-210): "Make a roll for the leader. Choose
  // another character in the company and do the same." Enqueue the two-roll
  // contest between the play-target (challenger) and the second character
  // chosen at play time; the resolution surfaces one `opposed-roll` action per
  // roll and applies the effect's onWin/onLose outcomes after the second.
  const opposedEffect = getCardEffects(def).find(
    (e): e is import('../types/effects.js').OpposedRollEffect => e.type === 'opposed-roll',
  );
  const opposedCharId = entry.payload.type === 'permanent-event' ? entry.payload.opposedCharacterId : undefined;
  if (opposedEffect) {
    if (targetCharId && opposedCharId && opposedCharId !== targetCharId) {
      logDetail(`"${def?.name ?? '?'}" opposed-roll: enqueuing 2d6 + ${opposedEffect.addStat} contest — ${targetCharId as string} vs ${opposedCharId as string}`);
      newState = enqueueResolution(newState, {
        source: card.instanceId,
        actor: entry.declaredBy,
        scope: { kind: 'phase', phase: newState.phaseState.phase },
        kind: {
          type: 'opposed-roll',
          sourceInstanceId: card.instanceId,
          sourceDefinitionId: card.definitionId,
          challengerId: targetCharId,
          opponentId: opposedCharId,
          addStat: opposedEffect.addStat,
          comparison: opposedEffect.comparison ?? 'gt',
        },
      });
    } else {
      logDetail(`"${def?.name ?? '?'}" opposed-roll: no distinct opposing character chosen — contest fizzles`);
    }
  }

  // skip-next-untap-on-play (Fireworks dm-130): "The next time the sage would
  // otherwise become untapped make him tapped instead and discard this card."
  // Install the one-shot skip-next-untap constraint on the target character;
  // `performUntap` consumes it (holds him tapped once) and discards the source
  // card — which, for a resource permanent-event, sits in the character's items.
  if (targetCharId && getCardEffects(def).some(e => e.type === 'skip-next-untap-on-play')) {
    logDetail(`"${def?.name ?? '?'}" skip-next-untap-on-play: installing skip-next-untap on ${targetCharId as string}`);
    newState = addConstraint(newState, {
      source: card.instanceId,
      sourceDefinitionId: card.definitionId,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: targetCharId },
      kind: { type: 'skip-next-untap', cardInstanceId: card.instanceId },
    });
  }

  // storable-at on direct attachment: add bearer-cannot-untap constraint so the
  // character may not untap until the card is stored (e.g. To Satisfy the Questioner).
  // This mirrors what applySelectCardBearerResolution does for post-attack attachment.
  // Gated on the explicit untap-lock play-flag: storable permanent events that do
  // not lock the bearer (e.g. That Ain't No Secret, le-240) must not place it.
  const storableEffect = (getCardEffects(def)).find(
    (e): e is import('../types/effects.js').StorableAtEffect => e.type === 'storable-at',
  );
  const locksBearer = hasPlayFlag(def as { effects?: readonly import('../types/effects.js').CardEffect[] }, 'bearer-cannot-untap-until-stored');
  if (targetCharId && storableEffect && locksBearer) {
    const hasTriggeredAttack = getCardEffects(def).some(e => e.type === 'trigger-attack-on-play');
    if (!hasTriggeredAttack) {
      logDetail(`"${def?.name ?? '?'}" storable-at direct attachment: adding bearer-cannot-untap on ${targetCharId as string}`);
      newState = addConstraint(newState, {
        source: card.instanceId,
        sourceDefinitionId: (defById(newState, card.definitionId)
          ? card.definitionId
          : card.instanceId) as import('../types/common.js').CardDefinitionId,
        scope: { kind: 'until-cleared' },
        target: { kind: 'character', characterId: targetCharId },
        kind: { type: 'bearer-cannot-untap', cardInstanceId: card.instanceId },
      });
    }
  }

  // block-company-joins (Fell Rider le-183): on entering play bound to a
  // company, discard all of that company's allies and Ringwraith followers.
  // (The ongoing "none may join" gate is enforced in the legal-action layer
  // via `companyBlocksJoins`.)
  const boundCompanyId = entry.payload.type === 'permanent-event' ? entry.payload.targetCompanyId : undefined;
  if (boundCompanyId && hasPlayFlag(def as { effects?: readonly import('../types/effects.js').CardEffect[] }, 'block-company-joins')) {
    logDetail(`"${def?.name ?? '?'}" block-company-joins — purging allies and followers from company ${boundCompanyId as string}`);
    newState = purgeCompanyAlliesAndFollowers(newState, playerIndex, boundCompanyId);
  }

  // Execute self-enters-play effects (e.g. move (filter-all → discard), add-constraint)
  for (const effect of getCardEffects(def)) {
      if (effect.type !== 'on-event' || effect.event !== 'self-enters-play') continue;
      if (effect.apply.type === 'move') {
        logDetail(`"${def?.name ?? '?'}" entered play — running move apply`);
        const moveEffect = effect.apply as unknown as import('../types/effects.js').MoveEffect;
        const ctx: import('./reducer-move.js').MoveContext = {
          sourceCardId: entry.card!.instanceId,
          sourcePlayerIndex: playerIndex,
          ...(targetCharId ? { targetCharacterId: targetCharId } : {}),
          ...(targetNazgulId ? { targetCardId: targetNazgulId } : {}),
        };
        const stateBefore = newState;
        const r = applyMove(newState, moveEffect, ctx);
        if ('error' in r) {
          logDetail(`move apply failed on self-enters-play: ${r.error}`);
        } else {
          newState = cascadeLinkedDiscards(stateBefore, r.state);
        }
      } else if (effect.apply.type === 'add-constraint') {
        newState = applyAddConstraintFromOnEvent(newState, entry, effect, def?.name ?? '?');
      } else if (effect.apply.type === 'offer-resource-play') {
        // Crown of Flowers (dm-121) enters play unlinked and simply remains in
        // play as an environment with "no effect until you play a resource with
        // it". The one-time option to pair a resource is a non-blocking
        // organization-phase action (`pair-resource-with-cof`, see
        // `legal-actions/organization.ts`) — NOT a blocking pending resolution.
        // Enqueuing a resolution here would collapse the legal-action menu to
        // "pair or pass" and prevent the player from organizing at all.
        logDetail(`"${def?.name ?? card.definitionId as string}" entered play — resource-play offer available as an organization action`);
      } else if (effect.apply.type === 'heal-target-character') {
        // Set the target character's status from wounded (Inverted) to Tapped.
        if (targetCharId) {
          for (let pi = 0; pi < 2; pi++) {
            const charInPlay = newState.players[pi].characters[targetCharId];
            if (!charInPlay) continue;
            if (charInPlay.status === CardStatus.Inverted) {
              logDetail(`"${def?.name ?? '?'}" heal-target-character: healing ${targetCharId as string} (wounded → tapped)`);
              newState = updatePlayer(newState, pi, p => ({
                ...p,
                characters: { ...p.characters, [targetCharId as string]: { ...charInPlay, status: CardStatus.Tapped } },
              }));
            } else {
              logDetail(`"${def?.name ?? '?'}" heal-target-character: ${targetCharId as string} not wounded — no effect`);
            }
            break;
          }
        } else {
          logDetail(`"${def?.name ?? '?'}" heal-target-character: no target character — fizzle`);
        }
      } else if (effect.apply.type === 'set-character-status' && effect.apply.status) {
        // A permanent event attached to a character (e.g. Herb-lore dm-136:
        // "If untapped, tap Radagast afterwards") may set its own bearer's
        // status on entering play. `target` absent/"bearer"/"target-character"
        // all resolve to the character the event was just attached to.
        const statusTarget = effect.apply.target;
        if (targetCharId && (!statusTarget || statusTarget === 'bearer' || statusTarget === 'target-character')) {
          for (let pi = 0; pi < 2; pi++) {
            const charInPlay = newState.players[pi].characters[targetCharId];
            if (!charInPlay) continue;
            if (effect.apply.when && !matchesCondition(effect.apply.when, { target: { status: charInPlay.status as string } })) {
              logDetail(`"${def?.name ?? '?'}" set-character-status: when-condition not met on ${targetCharId as string} (status ${charInPlay.status})`);
              break;
            }
            const newStatus = cardStatusFromName(effect.apply.status);
            logDetail(`"${def?.name ?? '?'}" set-character-status: ${targetCharId as string} → ${effect.apply.status}`);
            newState = updatePlayer(newState, pi, p => ({
              ...p,
              characters: { ...p.characters, [targetCharId as string]: { ...charInPlay, status: newStatus } },
            }));
            break;
          }
        } else if (!targetCharId) {
          logDetail(`"${def?.name ?? '?'}" set-character-status: no target character — fizzle`);
        }
      } else if (effect.apply.type === 'enqueue-corruption-check') {
        // For permanent events, determine which character receives the corruption check.
        // When apply.target === "company-member", the check is made by the first
        // member of the target character's company whose definition matches
        // `apply.filter` — no match, no check. (Well-preserved as-108 selects the
        // company's shadow-magic user; Ringwraiths are exempt from the check, so
        // its filter excludes them.) Without a target specifier, target the
        // attached character (targetCharId).
        const applyTarget = effect.apply.target;
        let corrCheckCharId: import('../types/common.js').CardInstanceId | undefined;
        if (applyTarget === 'company-member' && targetCharId) {
          const memberFilter = effect.apply.filter;
          outer: for (let pi = 0; pi < 2; pi++) {
            if (!newState.players[pi].characters[targetCharId]) continue;
            const company = newState.players[pi].companies.find(co => co.characters.includes(targetCharId));
            if (!company) break;
            for (const memberId of company.characters) {
              const memberChar = newState.players[pi].characters[memberId];
              if (!memberChar) continue;
              const memberDef = defById(newState, memberChar.definitionId);
              if (!memberDef) continue;
              if (memberFilter && !matchesDefinition(memberDef, memberFilter)) continue;
              corrCheckCharId = memberId;
              break outer;
            }
            logDetail(`"${def?.name ?? '?'}" enqueue-corruption-check: no company member matches the target filter — no check`);
            break;
          }
        } else if (!applyTarget) {
          corrCheckCharId = targetCharId;
        }
        if (corrCheckCharId) {
          const modifier = effect.apply.modifier ?? 0;
          logDetail(`"${def?.name ?? '?'}" enqueue-corruption-check on ${corrCheckCharId as string} (modifier ${modifier})`);
          newState = enqueueCorruptionCheck(newState, {
            source: card.instanceId,
            actor: entry.declaredBy,
            scope: { kind: 'phase', phase: newState.phaseState.phase },
            characterId: corrCheckCharId,
            modifier,
            reason: def?.name ?? '?',
            // CoE 7.1.1: any corruption check declared but not yet resolved
            // may be supported by tapping untapped company mates for +1
            // each, not just item-transfer/store checks — see rule-3.35's
            // transfer fix.
            allowSupport: true,
          });
        }
      } else if (effect.apply.type === 'win-condition-roll') {
        // Challenge the Power (ba-52): roll immediately on entering play.
        // The card is attached to the avatar (targetCharId); the roll table
        // decides eliminate / discard / keep / win. (CoE 10.39.)
        if (targetCharId) {
          const rollResult = resolveWinConditionRoll(newState, {
            sourceInstanceId: card.instanceId,
            sourceDefinitionId: card.definitionId,
            ownerPlayerIndex: playerIndex,
            avatarCharId: targetCharId,
            apply: effect.apply,
          });
          newState = rollResult.state;
        } else {
          logDetail(`"${def?.name ?? '?'}" win-condition-roll: no avatar target — fizzle`);
        }
      } else if (effect.apply.type === 'discard-named-in-play') {
        // The Lidless Eye (le-203) / Sauron (ba-43): on entering play, discard
        // every in-play copy of the named card (Bade to Rule le-167) — wherever
        // it sits (bare in play, or attached to a Ringwraith as an item).
        logDetail(`"${def?.name ?? '?'}" entered play — discard-named-in-play "${effect.apply.cardName}"`);
        newState = discardNamedCardsInPlay(newState, effect.apply.cardName);
      } else if (effect.apply.type === 'discard-bearer-corruption') {
        // Three Golden Hairs (td-157): on entering play attached to a
        // character, discard every corruption card already attached to that
        // bearer.
        if (targetCharId) {
          logDetail(`"${def?.name ?? '?'}" entered play — discard-bearer-corruption on ${targetCharId as string}`);
          newState = discardBearerCorruptionCards(newState, targetCharId);
        } else {
          logDetail(`"${def?.name ?? '?'}" discard-bearer-corruption: no target character — fizzle`);
        }
      } else if (effect.apply.type === 'mount-slain') {
        newState = resolveMountSlain(newState, card, playerIndex);
      }
  }

  // offer-corruption-removal-at-site (Elf-song tw-223): shared with
  // `resolveLongEvent` below, since long-event resource cards resolve via a
  // separate, simpler path that does not run the generic self-enters-play
  // loop above.
  newState = applyOfferCorruptionRemovalOnResolve(newState, def, card);

  // The Great Hunt (wh-91): on entering play, kick off the reveal-and-attack
  // process (a `great-hunt-source` choice) and establish the ongoing discard
  // trigger. General permanent event (no character/site/item target).
  {
    const revealAndAttack = findRevealAndAttackEffect(def);
    if (revealAndAttack && !targetCharId) {
      newState = kickoffGreatHunt(newState, card.instanceId, card.definitionId, entry.declaredBy, revealAndAttack);
    }
  }

  // Trigger-auto-attack-on-play: initiate combat immediately after the card enters play.
  // Bearer selection happens post-attack via a select-card-bearer pending resolution.
  {
    const triggerEffect = getCardEffects(def).find(
      (e): e is TriggerAttackOnPlayEffect => e.type === 'trigger-attack-on-play',
    );
    if (triggerEffect) {
      // Find the active company — the declaring player's company currently being handled
      const ps = newState.phaseState as { activeCompanyIndex?: number };
      const activeCompanyIndex = ps.activeCompanyIndex ?? 0;
      const declarerIndex = getPlayerIndex(newState, entry.declaredBy);
      const companyId = newState.players[declarerIndex].companies[activeCompanyIndex]?.id;

      if (companyId) {
        const defPlayerIndex = declarerIndex;
        const defPlayer = newState.players[defPlayerIndex];
        const atkPlayer = newState.players[1 - defPlayerIndex];
        const inPlayNames = buildInPlayNames(newState);

        // Multi-attack form: use attacks[0] for first combat, pass rest as remainingAttacks.
        // Single-attack form: use the top-level fields (backward-compatible).
        let firstAttack: import('../types/effects.js').TriggerAttackEntry = triggerEffect.attacks?.length
          ? triggerEffect.attacks[0]
          : { creatureType: triggerEffect.creatureType!, strikes: triggerEffect.strikes!, prowess: triggerEffect.prowess! };
        let remaining: readonly import('../types/effects.js').TriggerAttackEntry[] =
          triggerEffect.attacks?.length ? triggerEffect.attacks.slice(1) : [];

        // Dynamic creature race: resolve every attack's creatureType from the
        // played site type when the effect declares `creatureTypeBySiteType`
        // (Tempest of Fire ba-77: Men at a Border-hold, Orcs at a Shadow-hold).
        if (triggerEffect.creatureTypeBySiteType) {
          const activeCompany = defPlayer.companies.find(co => co.id === companyId);
          const siteDef = activeCompany?.currentSite
            ? defById(newState, activeCompany.currentSite.definitionId)
            : undefined;
          const siteType = siteDef && 'siteType' in siteDef ? (siteDef as { siteType: string }).siteType : undefined;
          const mappedRace = siteType ? triggerEffect.creatureTypeBySiteType[siteType] : undefined;
          if (mappedRace) {
            logDetail(`"${def?.name ?? '?'}" creatureTypeBySiteType: site type ${siteType ?? '?'} → ${mappedRace} attacks`);
            firstAttack = { ...firstAttack, creatureType: mappedRace };
            remaining = remaining.map(a => ({ ...a, creatureType: mappedRace }));
          }
        }

        const creatureRace = normalizeCreatureRace(firstAttack.creatureType);
        const effectiveProwess = resolveAttackProwess(
          newState, firstAttack.prowess, inPlayNames, creatureRace, true, undefined,
          { companyId },
        );
        const effectiveStrikes = resolveAttackStrikes(
          newState, firstAttack.strikes, inPlayNames, creatureRace, true, { companyId },
        );
        logDetail(
          `"${def?.name ?? '?'}" entered play — triggering ${firstAttack.creatureType} auto-attack ` +
          `(${effectiveStrikes} strikes, ${effectiveProwess} prowess) on company ${companyId as string}; ` +
          `bearer selected post-attack` +
          (remaining.length > 0 ? `; ${remaining.length} more attack(s) queued` : ''),
        );
        const combat: CombatState = makeCombatState({
          attackSource: {
            type: 'card-triggered-attack',
            cardInstanceId: card.instanceId,
            ...(remaining.length > 0 ? { remainingAttacks: remaining } : {}),
          },
          companyId,
          defendingPlayerId: defPlayer.id,
          attackingPlayerId: atkPlayer.id,
          strikesTotal: effectiveStrikes,
          strikeProwess: effectiveProwess,
          creatureBody: null,
          creatureRace,
          assignmentPhase: 'defender',
          detainment: false,
        });
        newState = { ...newState, combat };
      }
    }
  }

  // Inner Rot (wh-23): a hazard riding the Fallen-wizard makes him check for
  // corruption "whenever his controlling player plays a stage card". Most stage
  // cards are permanent-events, so this is their entry point; the site-phase
  // stage item/ally/faction seams fire the same trigger in `reducer-site.ts`.
  newState = fireStageCardPlayedTriggers(newState, playerIndex, def);

  return newState;
}

/**
 * `mount-slain` self-enters-play orchestrator (Mount Slain as-50). The card
 * itself is discarded immediately — it never remains in play — and, if the
 * opponent has a revealed Ringwraith avatar in play ({@link findPlayerAvatar}),
 * enqueues a standalone body check on it: `onPass` (fails, CoE 3.I.2.1)
 * eliminates the avatar; `onFail` (survives) discards it anyway per the
 * card's forced "discard the Ringwraith". No avatar in play → fizzle.
 */
function resolveMountSlain(state: GameState, card: CardInstance, ownerIndex: number): GameState {
  const opponentIndex = ownerIndex === 0 ? 1 : 0;
  const opponent = state.players[opponentIndex];

  // The card is one-shot and never lingers in play — discard it immediately.
  const working = updatePlayer(state, ownerIndex, p => ({
    ...p,
    cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== card.instanceId),
    discardPile: [...p.discardPile, toCardInstance(card)],
  }));

  const avatar = findPlayerAvatar(working, opponent);
  const avatarDef = avatar ? defById(working, avatar.definitionId) : undefined;
  if (!avatar || !avatarDef || !isCharacterCard(avatarDef) || avatarDef.race !== Race.Ringwraith) {
    logDetail(`Mount Slain: opponent has no Ringwraith avatar in play — fizzle`);
    return working;
  }

  logDetail(`Mount Slain: forcing a body check on ${avatarDef.name} (body ${avatar.effectiveStats.body}) — discarded if still in play afterward`);
  return enqueueResolution(working, {
    source: card.instanceId,
    actor: opponent.id,
    scope: { kind: 'phase', phase: working.phaseState.phase },
    kind: {
      type: 'dice-check',
      label: `Mount Slain: ${avatarDef.name} body check`,
      modifiers: [],
      threshold: avatar.effectiveStats.body,
      comparison: 'gt',
      onPass: { type: 'eliminate-character' },
      onFail: { type: 'discard-character' },
      continuation: { kind: 'dequeue-only' },
      requireTargetPresent: true,
      targetCharacterId: avatar.instanceId,
    },
  });
}

/**
 * Resolve an `on-event: self-enters-play` effect with `apply.type === 'add-constraint'`.
 *
 * Reads `effect.apply.constraint` (the constraint kind name) and
 * `effect.apply.scope` (the scope name) and adds the resulting
 * {@link ActiveConstraint} to the state. The target is derived from
 * `effect.target`:
 *  - `"target-company"` — the active company at the time the chain entry resolved.
 *  - `"scout-company"` — same (alias used by Stealth).
 *  - `"arriving-company"` — same (alias used by River's company-arrives-at-site path; for self-enters-play it falls back to the active company).
 *  - otherwise — bearer's company (only meaningful for character-targeted permanent events).
 */
function applyAddConstraintFromOnEvent(
  state: GameState,
  entry: ChainEntry,
  effect: import('../types/effects.js').OnEventEffect,
  cardName: string,
): GameState {
  if (effect.apply.type !== 'add-constraint') return state;
  const constraintKind = effect.apply.constraint;
  const scopeName = effect.apply.scope;
  if (!constraintKind || !scopeName) return state;

  // Pick a target company. For now we use the active company in the
  // current MH/Site sub-phase, which matches all four cards in the
  // pending-effects plan.
  let companyId: import('../types/common.js').CompanyId | null = null;
  const activePlayer = state.activePlayer;
  if (activePlayer !== null) {
    const activePlayerObj = playerById(state, activePlayer);
    if (activePlayerObj) {
      const ps = state.phaseState;
      let activeCompanyIndex = -1;
      if (ps.phase === 'movement-hazard') activeCompanyIndex = ps.activeCompanyIndex;
      else if (ps.phase === 'site') activeCompanyIndex = ps.activeCompanyIndex;
      if (activeCompanyIndex >= 0) {
        companyId = activePlayerObj.companies[activeCompanyIndex]?.id ?? null;
      }
    }
  }

  // Site-targeting permanent events carry the site they were played on in the
  // chain payload (set by the play action's `targetSiteDefinitionId`). Pass it
  // through so site-bound constraints resolve correctly even outside the site
  // phase — e.g. Stage resources played during the organization phase (rule
  // 5.F1: The Fortress of Isen wh-68, Guarded Haven wh-74, …).
  const boundSiteDefId = entry.payload?.type === 'permanent-event'
    ? entry.payload.targetSiteDefinitionId
    : undefined;

  // For `until-cleared` scope, target the active player (the effect applies
  // globally, not to a specific company that may later disband); other scopes
  // target the resolved company — unless the effect explicitly requests a
  // player-wide target (`target: "player"`), which always wins.
  const r = addDeclaredConstraint(state, entry.card!, effect, constraintKind, scopeName, companyId, {
    boundSiteDefId,
    untilClearedPlayerId: activePlayer ?? undefined,
    declaringPlayerTarget: effect.apply.target === 'player' ? entry.declaredBy : undefined,
  });
  if (r.added) {
    logDetail(`"${cardName}" entered play — added constraint ${constraintKind}, scope ${scopeName}`);
  }
  return r.state;
}

/**
 * Apply a site-targeting Stage resource's `self-enters-play` add-constraint
 * effects (Hidden Haven, wh-75) to a site chosen at draft time, before the
 * game proper begins.
 *
 * Hidden Haven normally enters play during the site phase, binding its
 * Wizardhaven conversion (and any companion constraints) to "the site the card
 * is played at" — resolved from the active company's current site. At the
 * Fallen-wizard starting-stage reveal there is no active company/phase, so the
 * site is supplied explicitly (`siteDefId`) from the player's draft pairing.
 * This mirrors {@link applyAddConstraintFromOnEvent} but targets the owning
 * player directly and overrides the site resolution with `siteDefId`, so it has
 * no active-company or phase dependency.
 */
export function applyStageResourceSiteConstraints(
  state: GameState,
  playerId: PlayerId,
  hhCard: CardInstance,
  siteDefId: CardDefinitionId,
): GameState {
  const def = defById(state, hhCard.definitionId);
  let next = state;
  for (const onEvent of getOnEventEffects(def, 'self-enters-play')) {
    if (onEvent.apply.type !== 'add-constraint') continue;
    const constraintKind = onEvent.apply.constraint;
    if (!constraintKind) continue;
    const kind = buildConstraintKind(next, onEvent, constraintKind, siteDefId);
    if (!kind) {
      logDetail(`Hidden Haven draft conversion: unsupported constraint "${constraintKind}" — skip`);
      continue;
    }
    logDetail(`Hidden Haven draft conversion: adding constraint ${constraintKind} for player ${playerId as string} at site ${siteDefId as string}`);
    next = addConstraint(next, {
      source: hhCard.instanceId,
      sourceDefinitionId: hhCard.definitionId,
      scope: { kind: 'until-cleared' },
      target: { kind: 'player', playerId },
      kind,
    });
  }
  return next;
}

/**
 * Resolves a long-event chain entry: moves the card from the chain
 * into the declaring player's `cardsInPlay`.
 *
 * The CoE 2.IV.iii.1 hazard-limit check that used to live here is now applied
 * uniformly to every hazard entry by {@link hazardLimitExceededAtResolution},
 * called from {@link resolveEntry} before any effect runs.
 */
function resolveLongEvent(state: GameState, entry: ChainEntry): GameState {
  const card = entry.card!;
  const def = defById(state, card.definitionId);
  const playerIndex = getPlayerIndex(state, entry.declaredBy);

  logDetail(`Long event resolves: "${def?.name ?? card.definitionId}" enters play for player ${entry.declaredBy as string}`);

  // The resolving card lives only on the chain entry; route it into play via
  // the move primitive (`from: 'chain'` → `in-play-general`), the same path a
  // general permanent event uses. Equivalent to the former inline cardsInPlay
  // push, but the placement now lives in one place (reducer-move's pushOne).
  const moved = applyMove(state, { type: 'move', select: 'self', from: 'chain', to: 'in-play-general' }, {
    sourceCardId: card.instanceId,
    sourcePlayerIndex: playerIndex,
    chainCard: toCardInstance(card),
  });
  const afterPlay = 'error' in moved
    ? (logDetail(`Long event enters-play move failed (${moved.error}) — card not placed`), state)
    : moved.state;

  // prohibit-card-play (The Under-roads, as-106): on entering play, discard
  // every named card already in play (either player) to its owner's discard
  // pile. The ongoing "may not be played" lock is enforced separately in the
  // hazard legal-action layer.
  const afterProhibit = applyProhibitCardPlayOnResolve(afterPlay, def);

  // Apply any tap-sites-in-play clause now that the environment is in play
  // (e.g. Foul Fumes / Long Winter "if Doors of Night is in play, ... tapped").
  const afterTapSites = applyTapSitesInPlayOnResolve(afterProhibit, def);

  // Elf-song (tw-223): "each character at a Haven may immediately remove one
  // corruption card."
  return applyOfferCorruptionRemovalOnResolve(afterTapSites, def, card);
}

/**
 * Apply a resolving card's `offer-corruption-removal-at-site` self-enters-play
 * clause (Elf-song tw-223): offer every character — either player's —
 * currently at a site whose effective type is in the clause's `siteTypes`
 * and bearing at least one corruption card the one-time option to remove one
 * of them. One `remove-corruption-offer` pending resolution is enqueued per
 * eligible character, each an independent "may" choice.
 *
 * Called from both `resolveLongEvent` (Elf-song's own resolution path,
 * which does not run the generic self-enters-play loop `resolvePermanentEvent`
 * uses) and that generic loop, so any future permanent-event carrying the
 * same clause is covered too.
 */
function applyOfferCorruptionRemovalOnResolve(
  state: GameState,
  def: import('../index.js').CardDefinition | undefined,
  card: CardInstance,
): GameState {
  const clauses = getCardEffects(def).filter(
    (e): e is OnEventEffect => e.type === 'on-event' && e.event === 'self-enters-play'
      && e.apply.type === 'offer-corruption-removal-at-site',
  );
  if (clauses.length === 0) return state;

  let newState = state;
  for (const clause of clauses) {
    const siteTypes = (clause.apply as import('../types/effects.js').OfferCorruptionRemovalAtSiteAction).siteTypes;
    let offered = 0;
    for (let pi = 0; pi < newState.players.length; pi++) {
      const p = newState.players[pi];
      for (const [charIdStr, c] of Object.entries(p.characters)) {
        const charId = charIdStr as CardInstanceId;
        const hasCorruption = c.hazards.some(h => {
          const hDef = defById(newState, h.definitionId);
          const hKeywords = hDef && 'keywords' in hDef ? (hDef as { keywords?: readonly string[] }).keywords : undefined;
          return hDef?.cardType === 'hazard-corruption' || hKeywords?.includes('corruption') === true;
        });
        if (!hasCorruption) continue;
        const company = findCharacterCompany(p.companies, charId);
        if (!company?.currentSite) continue;
        const siteDef = defById(newState, company.currentSite.definitionId);
        if (!isSiteCard(siteDef)) continue;
        const effectiveType = getEffectiveSiteType(
          newState, company.currentSite.definitionId, siteDef.siteType, company.currentSite.instanceId,
        );
        if (!siteTypes.includes(effectiveType)) continue;
        offered++;
        newState = enqueueResolution(newState, {
          source: card.instanceId,
          actor: p.id,
          scope: { kind: 'phase', phase: newState.phaseState.phase },
          kind: { type: 'remove-corruption-offer', characterId: charId, sourceDefinitionId: card.definitionId },
        });
      }
    }
    logDetail(`"${def?.name ?? '?'}" entered play — offered corruption removal to ${offered} character(s) at a matching site`);
  }
  return newState;
}

/**
 * Apply a resolving card's {@link ProhibitCardPlayEffect} clauses: discard
 * every **named** card already in play (from either player's `cardsInPlay`) to
 * its owner's discard pile. One-time effect applied at resolution; the ongoing
 * play-lock is enforced centrally in `computeLegalActions`.
 *
 * Only `cardNames` sweeps the table — that is the "discards *and* prohibits"
 * wording of The Under-roads (as-106). A class-wide `filter` lock is purely
 * forward-looking ("No environment cards can be played", Balance Between Powers
 * dm-118) and never touches what is already in play.
 */
function applyProhibitCardPlayOnResolve(
  state: GameState,
  def: import('../index.js').CardDefinition | undefined,
): GameState {
  const prohibitEffects = getCardEffects(def).filter(
    (e): e is import('../types/effects.js').ProhibitCardPlayEffect => e.type === 'prohibit-card-play',
  );
  if (prohibitEffects.length === 0) return state;
  const prohibited = new Set<string>();
  for (const eff of prohibitEffects) for (const name of eff.cardNames ?? []) prohibited.add(name);
  if (prohibited.size === 0) return state;

  return discardCardsInPlayWhere(
    state,
    card => {
      const cDef = defById(state, card.definitionId);
      return !!cDef?.name && prohibited.has(cDef.name);
    },
    card => {
      const cDef = state.cardPool[card.definitionId] as { name?: string } | undefined;
      logDetail(`prohibit-card-play (${def?.name ?? '?'}): discarding "${cDef?.name ?? card.definitionId}" from play`);
    },
  ).state;
}

/**
 * Apply a resolving environment's {@link TapSitesInPlayEffect} clauses: when
 * the optional `requiresInPlay` card is in play, tap every distinct site in
 * play (a company's current site, on either side) whose attributes satisfy the
 * effect's per-site condition. One-time effect applied at resolution.
 */
function applyTapSitesInPlayOnResolve(
  state: GameState,
  def: import('../index.js').CardDefinition | undefined,
): GameState {
  const tapEffects = getCardEffects(def).filter(
    (e): e is TapSitesInPlayEffect => e.type === 'tap-sites-in-play',
  );
  if (tapEffects.length === 0) return state;

  let newState = state;
  for (const eff of tapEffects) {
    if (eff.requiresInPlay && !isCardNameInPlayOrCharacters(newState, eff.requiresInPlay)) {
      logDetail(`tap-sites-in-play (${def?.name ?? '?'}): "${eff.requiresInPlay}" not in play — no sites tapped`);
      continue;
    }
    let tappedCount = 0;
    const players: [PlayerState, PlayerState] = [newState.players[0], newState.players[1]];
    for (let pIdx = 0; pIdx < 2; pIdx++) {
      const player = players[pIdx];
      const ownerIsMinion = isMinionOrBalrog(player);
      const companies = player.companies.map(co => {
        const site = co.currentSite;
        if (!site || site.status === CardStatus.Tapped) return co;
        // Promptings of Wisdom (wh-34) / Piercing All Shadows (wh-47) /
        // Govern the Storms (wh-45): a `cancel-return-and-site-tap`
        // constraint on this company negates a hazard effect that would tap
        // its current or new site.
        if (hasCancelReturnAndSiteTap(newState, co.id)) {
          logDetail(`tap-sites-in-play (${def?.name ?? '?'}): company ${co.id as string} is shielded by cancel-return-and-site-tap — site not tapped`);
          return co;
        }
        const siteDef = defById(newState, site.definitionId);
        if (!siteDef || !isSiteCard(siteDef)) return co;
        const ctx = {
          site: { type: siteDef.siteType },
          sitePath: {
            wildernessCount: siteDef.sitePath.filter(r => r === RegionType.Wilderness).length,
            shadowCount: siteDef.sitePath.filter(r => r === RegionType.Shadow).length,
            darkCount: siteDef.sitePath.filter(r => r === RegionType.Dark).length,
          },
          // Owning player's alignment, so a card with "no effect on a minion
          // player" can exclude minion/Balrog-owned sites (Foul Fumes tw-36).
          player: { minion: ownerIsMinion },
        };
        if (eff.condition && !matchesCondition(eff.condition, ctx as unknown as Record<string, unknown>)) return co;
        tappedCount++;
        logDetail(`tap-sites-in-play (${def?.name ?? '?'}): tapping site "${siteDef.name}" (${site.instanceId as string})`);
        return { ...co, currentSite: { ...site, status: CardStatus.Tapped } };
      });
      players[pIdx] = { ...player, companies };
    }
    if (tappedCount > 0) newState = { ...newState, players };
  }
  return newState;
}

/**
 * Returns the creature races already faced by the active company during the
 * site phase, derived from the site's automatic attacks that have already
 * been initiated (`phaseState.automaticAttacksResolved`). Used by on-guard
 * creature self-effects (e.g. Orc-lieutenant +4 prowess if an Orc attack
 * was already faced this turn).
 */
function deriveSiteFacedRaces(state: GameState): Race[] {
  if (state.phaseState.phase !== 'site') return [];
  const siteState = state.phaseState;
  const activePlayerIndex = getPlayerIndex(state, state.activePlayer!);
  const company = state.players[activePlayerIndex].companies[siteState.activeCompanyIndex];
  if (!company?.currentSite) return [];
  const siteDef = defById(state, company.currentSite.definitionId);
  if (!siteDef || !isSiteCard(siteDef)) return [];
  const autoAttacks = getActiveAutoAttacks(state, siteDef, company.currentSite.instanceId);
  const resolved = Math.min(siteState.automaticAttacksResolved, autoAttacks.length);
  const races = new Set<Race>();
  for (let i = 0; i < resolved; i++) {
    const race = normalizeCreatureRace(autoAttacks[i].creatureType);
    if (race) races.add(race);
  }
  return Array.from(races);
}

/**
 * Returns the definition of the site that would be the venue for an attack
 * against the given company. Prefers the company's explicit destination
 * (M/H) or current site references, because the same site name (e.g.
 * "Moria") exists in both hero and minion card pools and a name-based
 * lookup is ambiguous. Used to read both the site's `effects` (consulted
 * by the detainment helper for `site-rule: attacks-not-detainment`) and
 * its `name` (for `site-rule: keyed-creatures-detainment`, which matches
 * attacking creatures keyed to the site by name — e.g. Moria).
 */
function resolveDefendingSiteDef(
  state: GameState,
  company: {
    currentSite?: { definitionId: import('../types/common.js').CardDefinitionId } | null,
    destinationSite?: { instanceId: import('../types/common.js').CardInstanceId } | null,
  },
): { readonly name?: string, readonly effects?: readonly import('../types/effects.js').CardEffect[] } | undefined {
  let siteDefinitionId: import('../types/common.js').CardDefinitionId | null = null;
  if (company.destinationSite?.instanceId) {
    siteDefinitionId = resolveInstanceId(state, company.destinationSite.instanceId) ?? null;
  }
  if (!siteDefinitionId && company.currentSite) {
    siteDefinitionId = company.currentSite.definitionId;
  }
  if (!siteDefinitionId) return undefined;
  return state.cardPool[siteDefinitionId] as
    { readonly name?: string, readonly effects?: readonly import('../types/effects.js').CardEffect[] } | undefined;
}

/**
 * Scan the defending player's characters (across all their companies) for
 * `on-event: creature-attack-begins` effects with `apply: offer-char-join-attack`.
 * Each match whose bearer is at a haven and whose company differs from the
 * attacked company becomes a {@link HavenJumpOffer} the player may accept
 * during the cancel-window. Used by Alatar — generalizable to any card that
 * lets a specific character jump from a haven into an attack.
 */
function collectHavenJumpOffers(
  state: GameState,
  defendingPlayer: PlayerState,
  attackedCompanyId: import('../types/common.js').CompanyId,
): HavenJumpOffer[] {
  const offers: HavenJumpOffer[] = [];
  for (const company of defendingPlayer.companies) {
    if (company.id === attackedCompanyId) continue;
    const siteDef = company.currentSite
      ? defById(state, company.currentSite.definitionId)
      : undefined;
    // "at a Haven" for this player. For a Fallen-wizard (Alatar wh-1) that
    // means one of *his* Wizardhavens only, not any METW haven — `isHavenForPlayer`
    // encodes that alignment distinction (and Hidden Haven conversions), so the
    // same effect data restricts wh-1 to Wizardhavens while tw-117 (wizard) still
    // triggers at any haven.
    const atHaven = isHavenForPlayer(siteDef, defendingPlayer.alignment, {
      state,
      siteDefinitionId: company.currentSite?.definitionId,
      playerId: defendingPlayer.id,
    });
    if (!atHaven) continue;
    // CRF 22, Movement/Hazard Phase Annotation 25: "Removing the site of
    // origin and resetting to hand size are simultaneous actions, and they
    // are the last actions in any movement/hazard phase. This means a moving
    // company is not at a site until the site phase." A company that
    // completed its own move this M/H phase (`moved`) has not formally
    // arrived yet — it cannot lend a haven-resident character to another
    // company's attack until the site phase begins.
    if (company.moved) continue;
    for (const charId of company.characters) {
      const charInPlay = defendingPlayer.characters[charId];
      if (!charInPlay) continue;
      const charDef = defById(state, charInPlay.definitionId);
      const effects = (charDef as { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined)?.effects ?? [];
      for (const effect of effects) {
        if (effect.type !== 'on-event') continue;
        const onEvent: OnEventEffect = effect;
        if (onEvent.event !== 'creature-attack-begins') continue;
        if (onEvent.apply.type !== 'offer-char-join-attack') continue;
        if (onEvent.when) {
          const ctx = {
            bearer: { atHaven: true, siteType: SiteType.Haven },
            attack: { attackedCompanyId: attackedCompanyId as string, bearerCompanyId: company.id as string },
          };
          if (!matchesCondition(onEvent.when, ctx)) continue;
        }
        const postAttackEffects: PostAttackEffect[] = [];
        const post = onEvent.apply.postAttack;
        if (post && (post.tapIfUntapped || post.corruptionCheck)) {
          postAttackEffects.push({
            targetCharacterId: charInPlay.instanceId,
            tapIfUntapped: post.tapIfUntapped,
            corruptionCheck: post.corruptionCheck,
          });
        }
        offers.push({
          characterId: charInPlay.instanceId,
          bearerPlayerId: defendingPlayer.id,
          originCompanyId: company.id,
          targetCompanyId: attackedCompanyId,
          discardOwnedAllies: !!onEvent.apply.discardOwnedAllies,
          forceStrike: !!onEvent.apply.forceStrike,
          postAttackEffects,
        });
        logDetail(`Haven-join offer: ${(charDef as { name?: string })?.name ?? charInPlay.definitionId as string} at haven may join attacked company`);
      }
    }
  }
  return offers;
}

/**
 * Finds a creature's `on-event: creature-attack-begins` +
 * `apply: force-check-all-company` corruption effect (Corpse-candle,
 * tw-23/le-67), if any. The card text is conditional ("if this attack is not
 * canceled"), so the caller must defer enqueueing the actual checks until
 * the pre-assignment cancel-window closes rather than firing immediately.
 */
function findAttackBeginsCorruptionEffect(creatureDef: CreatureCard): { modifier: number } | null {
  for (const effect of creatureDef.effects ?? []) {
    if (effect.type !== 'on-event') continue;
    const onEvent: OnEventEffect = effect;
    if (onEvent.event !== 'creature-attack-begins') continue;
    if (onEvent.apply.type !== 'force-check-all-company') continue;
    if (onEvent.apply.check !== 'corruption') continue;
    return { modifier: onEvent.apply.modifier ?? 0 };
  }
  return null;
}

/**
 * Creates a CombatState when a creature chain entry resolves.
 *
 * The creature card was already moved to the hazard player's discard pile
 * at play time. Combat will determine whether it moves to the defending
 * player's marshalling point pile (all strikes defeated) or stays in discard.
 */
function initiateCreatureCombat(state: GameState, entry: ChainEntry): GameState {
  const creatureDef = state.cardPool[entry.card?.definitionId as CardDefinitionId] as CreatureCard | undefined;
  if (!creatureDef || creatureDef.cardType !== 'hazard-creature') {
    logDetail(`Creature resolution: definition not found or not a creature — fizzle`);
    return state;
  }

  // Determine defending company from phase state (M/H or Site phase)
  let activeCompanyIndex: number;
  if (state.phaseState.phase === 'movement-hazard') {
    activeCompanyIndex = state.phaseState.activeCompanyIndex;
  } else if (state.phaseState.phase === 'site') {
    activeCompanyIndex = state.phaseState.activeCompanyIndex;
  } else {
    logDetail(`Creature resolution: not in M/H or Site phase — fizzle`);
    return state;
  }
  const activePlayerIndex = getPlayerIndex(state, state.activePlayer!);
  const resourcePlayer = state.players[activePlayerIndex];
  const company = resourcePlayer.companies[activeCompanyIndex];
  if (!company) {
    logDetail(`Creature resolution: no active company — fizzle`);
    return state;
  }

  const hazardPlayerId = hazardPlayer(state).id;

  // Hidden Haven (wh-75): "If one of your companies is at this site, all attacks
  // against it are canceled." A creature keyed against a company occupying a site
  // under a `cancel-attacks-at-site` constraint is canceled — the creature is
  // discarded to its owner without combat. This only applies while the company is
  // *at* the site (not moving away from it); a moving company has a non-null
  // destinationSite. (The Site phase's on-guard creature path cancels separately
  // in reducer-site.ts; this covers the movement/hazard keyed-creature path.)
  const cancelSiteDefId = company.currentSite?.definitionId;
  if (!company.destinationSite && cancelSiteDefId && siteAttacksCanceled(state, cancelSiteDefId)) {
    const cancelSiteName = defById(state, cancelSiteDefId)?.name ?? (cancelSiteDefId as string);
    logDetail(`Creature "${creatureDef.name}" attack canceled by Hidden Haven at ${cancelSiteName} — discarding without combat`);
    const hazardIdx = getPlayerIndex(state, hazardPlayerId);
    return updatePlayer(state, hazardIdx, p => ({
      ...p,
      discardPile: [...p.discardPile, {
        instanceId: entry.card!.instanceId,
        definitionId: entry.card!.definitionId,
        status: CardStatus.Untapped,
      }],
    }));
  }

  // Check for attacker-chooses-defenders combat rule (e.g. Cave-drake). A
  // `scope: "all-attacks"` copy is a permanent-event's *global* grant, not the
  // creature's own printed rule, so it is excluded here and picked up by
  // `resolveAttackerChoosesDefenders` from `cardsInPlay` instead (Alatar the
  // Hunter as-7 carries both).
  const attackerChooses = resolveAttackerChoosesDefenders(
    state,
    (creatureDef.effects?.some(
      e => e.type === 'combat-attacker-chooses-defenders' && e.scope !== 'all-attacks',
    ) ?? false)
      // Fell Beast (tw-33): a consumed `nazgul-boost-pending` constraint
      // grants "attacker chooses defending characters" to this creature's
      // play, on top of any rule the card itself carries.
      || (entry.payload.type === 'creature' && entry.payload.grantAttackerChoosesDefenders === true),
    creatureDef.race,
  );
  if (attackerChooses) {
    logDetail('Creature has attacker-chooses-defenders — skipping defender assignment');
  }

  // Check for multi-attack combat rule (e.g. Assassin — three attacks of one strike each)
  const multiAttackEffect = creatureDef.effects?.find(
    e => e.type === 'combat-multi-attack',
  );
  const rawMultiAttackCount = multiAttackEffect?.count ?? 1;
  // Forewarned Is Forearmed: reduce any multi-attack creature to 1 attack
  const forewarnedActive = rawMultiAttackCount > 1 && isReduceAttacksToOneInPlay(state, activePlayerIndex);
  if (forewarnedActive) {
    logDetail(`Forewarned Is Forearmed: reducing multi-attack from ${rawMultiAttackCount} to 1`);
  }
  const multiAttackCount = forewarnedActive ? 1 : rawMultiAttackCount;

  // Check for one-strike-per-character combat rule (e.g. Wandering Eldar,
  // Watcher in the Water — "Each character in the company faces one strike").
  // When present, the creature's raw strikes value is ignored; total strikes
  // equals the defending company's character count. When excludeAvatars is
  // true (e.g. Neeker-breekers), avatars (mind === null) are excluded.
  const oneStrikePerCharacterEffect = creatureDef.effects?.find(
    e => e.type === 'combat-one-strike-per-character',
  );
  const oneStrikePerCharacter = oneStrikePerCharacterEffect !== undefined;
  const excludeAvatarStrikes = oneStrikePerCharacterEffect?.excludeAvatars === true;
  // Carrion Feeders (ba-11): "Each wounded character faces one strike." Only
  // wounded (inverted) characters face a strike, one pre-assigned per wounded.
  const onlyWounded = oneStrikePerCharacterEffect?.onlyWounded === true;
  const defenderProwessFromMind = hasPlayFlag(creatureDef, 'combat-defender-prowess-from-mind');

  // combat-body-check-modifier (Carrion Feeders ba-11): +N to every character
  // body check produced by this attack (threaded into CombatState.bodyCheckModifier).
  const bodyCheckModEffect = creatureDef.effects?.find(
    e => e.type === 'combat-body-check-modifier',
  );
  const attackBodyCheckModifier = bodyCheckModEffect?.value ?? 0;

  // combat-tap-to-cancel-strike (Carrion Feeders ba-11): untapped company
  // characters may tap to cancel a strike against a wounded character.
  const tapToCancelStrike = creatureDef.effects?.some(
    e => e.type === 'combat-tap-to-cancel-strike',
  ) ?? false;

  // Check for tap-low-mind combat rule (e.g. Wisp of Pale Sheen — facing
  // characters with mind ≤ strike prowess tap after the strike resolves).
  const tapLowMindAfterStrike = creatureDef.effects?.some(
    e => e.type === 'combat-tap-low-mind',
  ) ?? false;
  if (tapLowMindAfterStrike) {
    logDetail('Creature has tap-low-mind — facing characters with mind ≤ strike prowess tap after their strike');
  }

  // combat-strike-effect (Thief tw-102, Pick-pocket tw-79): a successful
  // strike discards an item instead of wounding the defending character —
  // scope (company vs. struck character alone) depends on strikeEffect.
  const strikeEffect = creatureDef.effects?.find(
    (e): e is CombatStrikeEffectEffect => e.type === 'combat-strike-effect',
  )?.strikeEffect;
  if (strikeEffect) {
    logDetail(`Creature has combat-strike-effect: ${strikeEffect} — successful strikes replaced accordingly`);
  }

  // Check for cancel-attack-by-tap combat rule (e.g. Assassin — tap to cancel attacks)
  const cancelByTapEffect = creatureDef.effects?.find(
    e => e.type === 'combat-cancel-attack-by-tap',
  );
  const cancelByTapMax = cancelByTapEffect?.maxCancels ?? 0;
  const cancelByTapAllowTarget = cancelByTapEffect?.allowTargetToCancel ?? false;

  const reservingCardInstanceId = entry.payload.type === 'creature'
    ? entry.payload.reservingCardInstanceId
    : undefined;
  const attackSource = state.phaseState.phase === 'site'
    ? { type: 'on-guard-creature' as const, cardInstanceId: entry.card!.instanceId }
    : {
        type: 'creature' as const,
        instanceId: entry.card!.instanceId,
        ...(reservingCardInstanceId ? { reservingCardInstanceId } : {}),
      };

  const inPlayNames = buildInPlayNames(state);
  // A creature card already stores canonical races, so it is read directly —
  // `normalizeCreatureRace` is only for the printed labels on site attacks.
  const creatureRace = creatureDef.race;
  const creatureRaces = creatureDef.additionalRaces?.length
    ? [creatureRace, ...creatureDef.additionalRaces]
    : undefined;
  // Union the phase-local derivation with the turn-scoped races stamped on
  // the company itself (`facedHazardRaces`, recorded at every attack
  // teardown) — the persisted set is what survives the M/H → Site phase
  // transition and covers on-guard attacks faced earlier in the site phase.
  const derivedFacedRaces = state.phaseState.phase === 'movement-hazard'
    ? deriveFacedRaces(state, state.phaseState.hazardsEncountered)
    : deriveSiteFacedRaces(state);
  const targetCompanyForFacedRaces = state.players[activePlayerIndex]
    .companies[state.phaseState.phase === 'movement-hazard' || state.phaseState.phase === 'site'
      ? state.phaseState.activeCompanyIndex
      : -1];
  const companyFacedRaces = Array.from(new Set([
    ...derivedFacedRaces,
    ...(targetCompanyForFacedRaces?.facedHazardRaces ?? []),
  ]));
  const defenderAlignment = defenderAlignmentLabel(state.players[activePlayerIndex].alignment);
  // A creature's `keyedTo` can list several independent ways it may be
  // played (e.g. Orc-watch: region type Shadow/Dark *or* site type
  // Shadow-hold/Dark-hold). When the hazard player declared a specific
  // match to justify this play (`keyedBy`), the attack is keyed *only* to
  // that match — not to every alternative the card could have used. This
  // matters for cards like Stinker ("keyed to Wilderness or Shadow-land",
  // region types only): an Orc-watch played on the strength of its
  // site-type match alone must not be cancelable as if it were also keyed
  // to the Shadow-land region type. Falls back to the union of the card's
  // `keyedTo` when no declared match is available (on-guard reveals, etc.).
  // Computed here (before prowess/strikes/body resolution) so a creature's
  // own self stat-modifier can gate on `attack.keying` — e.g. Pirates
  // (le-88): "+2 prowess when keyed to Coastal Seas."
  const declaredKeyedBy = entry.payload.type === 'creature' ? entry.payload.keyedBy : undefined;
  const attackKeying = declaredKeyedBy
    ? (declaredKeyedBy.method === 'region-type' ? [declaredKeyedBy.value as RegionType] : [])
    : Array.from(new Set(
        creatureDef.keyedTo.flatMap(k => k.regionTypes ?? []),
      ));
  const attackSiteKeyingTypes = declaredKeyedBy
    ? (declaredKeyedBy.method === 'site-type' ? [declaredKeyedBy.value as SiteType] : [])
    : Array.from(new Set(
        creatureDef.keyedTo.flatMap(k => k.siteTypes ?? []),
      ));
  const attackKeyingRegionNames = declaredKeyedBy
    ? (declaredKeyedBy.method === 'region-name' ? [declaredKeyedBy.value] : [])
    : Array.from(new Set(
        creatureDef.keyedTo.flatMap(k => k.regionNames ?? []),
      ));
  const creatureSelf = creatureDef.effects?.length
    ? {
        effects: creatureDef.effects,
        companyFacedRaces,
        defenderAlignment,
        attackKeying: attackKeying.length > 0 ? attackKeying : undefined,
      }
    : undefined;
  const attackBoostCtx = { companyId: company.id, creatureInstanceId: entry.card!.instanceId };
  const prowessBonus = entry.payload.type === 'creature' ? (entry.payload.prowessBonus ?? 0) : 0;
  const strikesBonus = entry.payload.type === 'creature' ? (entry.payload.strikesBonus ?? 0) : 0;
  const effectiveProwess = resolveAttackProwess(state, creatureDef.prowess, inPlayNames, creatureRace, false, creatureSelf, attackBoostCtx) + prowessBonus;
  const effectiveStrikes = resolveAttackStrikes(state, creatureDef.strikes, inPlayNames, creatureRace, false, attackBoostCtx) + strikesBonus;
  let effectiveBody = resolveAttackBody(state, creatureDef.body, inPlayNames, creatureRace, attackBoostCtx);

  // combat-body-per-defender-skill (Little Snuffler dm-108): "Each ranger in
  // attacked company lowers Little Snuffler's body by 2." Self-bound to the
  // creature — count defending company members with the given skill and
  // apply the per-member delta to the creature's own body.
  const bodyPerSkillEffect = creatureDef.effects?.find(
    (e): e is CombatBodyPerDefenderSkillEffect => e.type === 'combat-body-per-defender-skill',
  );
  if (bodyPerSkillEffect && effectiveBody !== null) {
    const matchingCount = company.characters.filter(charId => {
      const charData = resourcePlayer.characters[charId];
      const charDef = charData ? state.cardPool[charData.definitionId] : undefined;
      return charData && charDef && isCharacterCard(charDef)
        && getEffectiveSkills(state, charData, charDef).includes(bodyPerSkillEffect.skill);
    }).length;
    if (matchingCount > 0) {
      const delta = bodyPerSkillEffect.value * matchingCount;
      const newBody = Math.max(0, effectiveBody + delta);
      logDetail(`combat-body-per-defender-skill: ${matchingCount} ${bodyPerSkillEffect.skill}(s) in defending company × ${bodyPerSkillEffect.value} = ${delta} → creature body ${effectiveBody} → ${newBody}`);
      effectiveBody = newBody;
    }
  }

  // Wounded (inverted) characters in the defending company — the strike
  // targets for `onlyWounded` mode (Carrion Feeders ba-11).
  const woundedCharacters = onlyWounded
    ? company.characters.filter(
        charId => resourcePlayer.characters[charId]?.status === CardStatus.Inverted,
      )
    : [];

  // Total strikes resolution. Precedence:
  //   0. onlyWounded                     → strikes = wounded characters
  //   1. combat-one-strike-per-character → strikes = company.characters.length
  //   2. combat-multi-attack             → strikes = count × printed strikes
  //   3. default                         → strikes = effectiveStrikes
  let totalStrikes: number;
  // Multi-attack "N attacks, all against one character" creatures (Assassin
  // tw-8, Slayer le-90/tw-89, Nameless Thing dm-109): each attack's real
  // strike count is the creature's own *printed* strikes, never a boosted
  // value. Per CRF 22 Assassin: "If an attack ... is given more than one
  // strike, each additional strike becomes an excess strike (-1 prowess
  // modification) against the attacked character" — a global strikes boost
  // (e.g. Rank upon Rank dm-80) doesn't create a genuine extra strike per
  // attack, it becomes a per-attack excess-strike penalty instead.
  let excessStrikesPerAttack = 0;
  if (onlyWounded) {
    totalStrikes = woundedCharacters.length;
    logDetail(`One strike per wounded character: ${totalStrikes} wounded character(s) in company → ${totalStrikes} total strikes`);
  } else if (oneStrikePerCharacter) {
    if (excludeAvatarStrikes) {
      const nonAvatarCount = company.characters.filter(charId => {
        const def = resolveDef(state, charId);
        return !isAvatarCharacter(def);
      }).length;
      totalStrikes = nonAvatarCount;
      logDetail(`One strike per non-avatar character: ${nonAvatarCount} non-avatar character(s) → ${totalStrikes} total strikes`);
    } else {
      totalStrikes = company.characters.length;
      logDetail(`One strike per character: ${totalStrikes} character(s) in company → ${totalStrikes} total strikes`);
    }
  } else if (rawMultiAttackCount > 1) {
    // Gate on the creature's *printed* multi-attack count, not the
    // Forewarned-reduced `multiAttackCount`: even when Forewarned Is
    // Forearmed reduces Assassin to a single remaining attack, that attack
    // still keeps Assassin's "one character only" restriction — a strikes
    // boost (Rank upon Rank) must still become a same-character excess
    // strike, not a genuine second strike assignable to a different
    // character.
    totalStrikes = creatureDef.strikes * multiAttackCount;
    excessStrikesPerAttack = Math.max(0, effectiveStrikes - creatureDef.strikes);
    logDetail(
      `Multi-attack: ${multiAttackCount} attacks × ${creatureDef.strikes} strike(s) = ${totalStrikes} total strikes`
      + (excessStrikesPerAttack > 0 ? ` (+${excessStrikesPerAttack} excess strike(s) each from boosted strikes)` : ''),
    );
  } else {
    totalStrikes = effectiveStrikes;
  }

  // onlyWounded with no wounded characters: the creature has no target and no
  // effect — discard it to the hazard player without initiating combat (so no
  // trivial "all strikes defeated" kill MP is awarded).
  if (onlyWounded && woundedCharacters.length === 0) {
    logDetail(`Creature "${creatureDef.name}" has no wounded targets — discarding without combat`);
    const hazardIdx = getPlayerIndex(state, hazardPlayerId);
    return updatePlayer(state, hazardIdx, p => ({
      ...p,
      discardPile: [...p.discardPile, {
        instanceId: entry.card!.instanceId,
        definitionId: entry.card!.definitionId,
        status: CardStatus.Untapped,
      }],
    }));
  }

  // Pre-assign one strike per wounded character (onlyWounded mode).
  const preAssignedWoundedStrikes: StrikeAssignment[] = woundedCharacters.map(
    charId => ({ characterId: charId, excessStrikes: 0, resolved: false }),
  );
  // Untapped company characters that may tap to cancel a strike (ba-11).
  const untappedCancelCount = onlyWounded
    ? company.characters.filter(
        charId => resourcePlayer.characters[charId]?.status === CardStatus.Untapped,
      ).length
    : 0;

  // Scan for on-event: creature-attack-begins → offer-char-join-attack
  // (e.g. Alatar). If any pending offers match, force a cancel-window so
  // the defender has an explicit opt-in before strike assignment begins.
  const havenJumpOffers = collectHavenJumpOffers(state, resourcePlayer, company.id);
  const defendingSiteDef = resolveDefendingSiteDef(state, company);
  // Scan for on-event: creature-attack-begins → force-check-all-company
  // corruption (Corpse-candle). Also forces a cancel-window: the check is
  // conditioned on "if this attack is not canceled," so it must wait for the
  // defender's pre-assignment cancel opportunity to close (see
  // `pendingAttackBeginsCorruption` handling in reducer-combat.ts).
  const attackBeginsCorruption = findAttackBeginsCorruptionEffect(creatureDef);

  let combat: CombatState = makeCombatState({
    attackSource,
    companyId: company.id,
    defendingPlayerId: state.activePlayer!,
    attackingPlayerId: hazardPlayerId,
    strikesTotal: totalStrikes,
    strikeProwess: effectiveProwess,
    creatureBody: effectiveBody,
    creatureRace,
    creatureRaces,
    attackKeying: attackKeying.length > 0 ? attackKeying : undefined,
    attackSiteKeyingTypes: attackSiteKeyingTypes.length > 0 ? attackSiteKeyingTypes : undefined,
    attackKeyingRegionNames: attackKeyingRegionNames.length > 0 ? attackKeyingRegionNames : undefined,
    assignmentPhase: (attackerChooses || havenJumpOffers.length > 0 || attackBeginsCorruption) ? 'cancel-window' : 'defender',
    havenJumpOffers: havenJumpOffers.length > 0 ? havenJumpOffers : undefined,
    pendingAttackBeginsCorruption: attackBeginsCorruption ? {
      source: entry.card!.instanceId,
      reason: creatureDef.name,
      modifier: attackBeginsCorruption.modifier,
    } : undefined,
    attackerChoosesDefenders: attackerChooses ? true : undefined,
    detainment: isDetainmentAttack({
      attackEffects: creatureDef.effects,
      attackRace: creatureRace,
      attackKeyedTo: creatureDef.keyedTo,
      inPlayNames,
      defendingAlignment: state.players[activePlayerIndex].alignment,
      defendingSiteEffects: defendingSiteDef?.effects,
      defendingSiteName: defendingSiteDef?.name,
      defenderForcesNormalAttacks: playerConvertsDetainmentToNormal(state, state.players[activePlayerIndex]),
      // Pass the actual site-type/region-type keying even when empty (e.g. a
      // declared region-name keying), so neither the override nor the
      // §3.II.2.R1/R2 detainment checks fall back to the union of everything
      // the creature *could* have keyed to.
      attackDeclaredSiteTypes: attackSiteKeyingTypes,
      attackDeclaredRegionTypes: attackKeying,
      normalIfKeyedToSiteTypes: companyKeyedAttacksNormalSiteTypes(state, company.id),
    }),
    forceSingleTarget: rawMultiAttackCount > 1 ? true : undefined,
    multiAttackCount: rawMultiAttackCount > 1 ? multiAttackCount : undefined,
    strikesPerAttack: rawMultiAttackCount > 1 ? creatureDef.strikes : undefined,
    excessStrikesPerAttack: rawMultiAttackCount > 1 && excessStrikesPerAttack > 0 ? excessStrikesPerAttack : undefined,
    cancelByTapRemaining: cancelByTapMax > 0 ? cancelByTapMax : undefined,
    cancelByTapAllowTarget: cancelByTapAllowTarget ? true : undefined,
    excludeAvatarStrikes: excludeAvatarStrikes ? true : undefined,
    // "Each character in the company faces one strike" (Wandering Eldar le-97,
    // Watcher in the Water le-99, …): assignment is fully determined, so the
    // engine assigns the strikes itself when the defender closes the
    // pre-assignment window instead of walking both players through a menu of
    // forced choices (see `handleCombatPass`).
    eachCharacterFacesOneStrike: oneStrikePerCharacter ? true : undefined,
    defenderProwessFromMind: defenderProwessFromMind ? true : undefined,
    tapLowMindAfterStrike: tapLowMindAfterStrike ? true : undefined,
    strikeEffect: strikeEffect ?? undefined,
    bodyCheckModifier: attackBodyCheckModifier !== 0 ? attackBodyCheckModifier : undefined,
    ...(forewarnedActive ? { isolated: true, uncancelable: true } : {}),
  });

  // Carrion Feeders (ba-11): strikes are pre-assigned one per wounded character.
  // Either open the tap-to-cancel window, or (no untapped defender / no such
  // ability) go straight to strike resolution — the defender's pre-assignment
  // cancel window is skipped exactly as for site "each character faces one
  // strike" attacks (cancel-attack items still apply at resolve-strike Step 1).
  if (onlyWounded) {
    const useCancelWindow = tapToCancelStrike && untappedCancelCount > 0 && preAssignedWoundedStrikes.length > 0;
    if (useCancelWindow) {
      logDetail(`Carrion Feeders: ${preAssignedWoundedStrikes.length} strike(s) pre-assigned to wounded; opening tap-to-cancel window (${untappedCancelCount} untapped defender(s))`);
      combat = {
        ...combat,
        strikeAssignments: preAssignedWoundedStrikes,
        phase: 'assign-strikes',
        assignmentPhase: 'cancel-by-tap',
        cancelByTapRemaining: untappedCancelCount,
        cancelStrikeAgainstWounded: true,
        eachCharacterFacesOneStrike: true,
      };
    } else {
      const base: CombatState = { ...combat, strikeAssignments: preAssignedWoundedStrikes, assignmentPhase: 'done', eachCharacterFacesOneStrike: true };
      const next = nextStrikePhase(base);
      combat = next ? { ...base, ...next } : base;
      logDetail(`Carrion Feeders: ${preAssignedWoundedStrikes.length} strike(s) pre-assigned to wounded; no cancel window → phase ${combat.phase}`);
    }
  }

  logDetail(`Creature combat initiated: ${creatureDef.name} (${creatureDef.strikes} strikes${effectiveStrikes !== creatureDef.strikes ? ` → ${effectiveStrikes}` : ''}, ${creatureDef.prowess} prowess${effectiveProwess !== creatureDef.prowess ? ` → ${effectiveProwess}` : ''}${effectiveStrikes !== creatureDef.strikes || effectiveProwess !== creatureDef.prowess ? ' after global effects' : ''}) vs company ${company.id as string}`);

  // Place the creature card in the hazard player's cardsInPlay during combat.
  // After combat, finalizeCombat moves it to discard or the defender's kill pile.
  // A creature attacking from an alt-permanent-event state (Shelob tw-86,
  // `attacksAsCreature`) is already sitting there — it was never removed, so
  // its own passive effects keep boosting its own attack — so skip re-adding
  // it and avoid a duplicate cardsInPlay entry.
  const hazardIndex = getPlayerIndex(state, hazardPlayerId);
  const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
  const alreadyInPlay = newPlayers[hazardIndex].cardsInPlay.some(c => c.instanceId === entry.card!.instanceId);
  if (!alreadyInPlay) {
    newPlayers[hazardIndex] = {
      ...newPlayers[hazardIndex],
      cardsInPlay: [...newPlayers[hazardIndex].cardsInPlay, {
        instanceId: entry.card!.instanceId,
        definitionId: entry.card!.definitionId,
        status: CardStatus.Untapped,
      }],
    };
  }

  // `pendingAttackBeginsCorruption` (Corpse-candle) is deferred — enqueued
  // when the defender passes out of the cancel-window (reducer-combat.ts)
  // instead of immediately, since the check only applies "if this attack is
  // not canceled."
  return { ...state, players: newPlayers, combat };
}

/**
 * Resolves a single chain entry at the given index.
 *
 * Marks the entry as resolved and applies its effects. Short-events targeting
 * environments cancel and discard the target. Other entry types currently
 * resolve as no-ops (effects via DSL resolver to be added).
 */
/**
 * CoE 2.IV.iii.1 — the hazard limit is an active condition for the *entirety* of
 * a movement/hazard phase: "there must be no more declared actions that count
 * against the hazard limit when compared to that hazard limit at resolution".
 *
 * A hazard is therefore legal to declare and still fizzle, if the limit drops
 * between the two moments. The card that does this is Many Turns and Doublings
 * (td-132): with Gates of Morning in play it decreases the company's hazard limit
 * by one, and its CRF 22 ruling spells the consequence out — "Many Turns and
 * Doublings can cancel hazards by reducing the hazard limit to the point where
 * the hazard resolving is no longer playable".
 *
 * Only entries flagged {@link ChainEntry.countsAgainstHazardLimit} are checked:
 * an exempt hazard (`no-hazard-limit`, race-exempt creature) never incremented
 * the count, so lowering the limit cannot invalidate it. Resource plays and
 * non-card entries are never flagged.
 */
function hazardLimitExceededAtResolution(state: GameState, entry: ChainEntry): boolean {
  if (!entry.countsAgainstHazardLimit) return false;
  if (state.phaseState.phase !== Phase.MovementHazard) return false;

  const mhState = state.phaseState;
  const activePlayerIndex = state.players.findIndex(p => p.id === state.activePlayer);
  if (activePlayerIndex < 0) return false;
  const company = state.players[activePlayerIndex].companies[mhState.activeCompanyIndex];
  if (!company) return false;

  const limit = currentHazardLimit(state, mhState, company.id);
  return mhState.hazardsPlayedThisCompany > limit;
}

/**
 * Shared preamble of the race-threshold attempt short events (Flatter a Foe
 * td-116, Riddling Talk td-148). When `entry` is an un-negated short event
 * targeting a character while an attack is being faced, and its card carries
 * an effect of `effectType` whose thresholds list the attacking creature's
 * race, returns the matched effect and threshold entry together with the
 * target character and the resolution source/actor/scope to enqueue the
 * attempt with. Returns undefined when any part does not apply (the caller
 * then falls through without enqueuing anything).
 */
function matchRaceThresholdEffect<E extends FlatteryCancelAttackEffect | RiddlingAttemptEffect>(
  state: GameState,
  entry: ChainEntry,
  effectType: E['type'],
) {
  if (entry.payload.type !== 'short-event'
    || !entry.payload.targetCharacterId
    || entry.negated
    || !entry.card
    || !state.combat) return undefined;
  const cardDef = defById(state, entry.card.definitionId);
  const effect = getCardEffects(cardDef).find((e): e is E => e.type === effectType);
  if (!effect) return undefined;
  // An attack counts as EVERY race it carries — primary plus additionalRaces
  // ("Orcs. Men." creatures like Goblin-faces wh-13 populate
  // `combat.creatureRaces`) — so match the thresholds against the full list
  // and, when several entries match, use the most favorable (lowest) one.
  const races = state.combat.creatureRaces
    ?? (state.combat.creatureRace !== undefined ? [state.combat.creatureRace] : []);
  const matching = effect.thresholds.filter(t => t.races.some(r => races.includes(r)));
  if (matching.length === 0) return undefined;
  const matchedEntry = matching.reduce((best, t) => (t.threshold < best.threshold ? t : best));
  const creatureRace = matchedEntry.races.find(r => races.includes(r))!;
  return {
    effect,
    creatureRace,
    threshold: matchedEntry.threshold,
    characterInstanceId: entry.payload.targetCharacterId,
    source: entry.card.instanceId,
    actor: state.combat.defendingPlayerId,
    scope: companySubphaseScope(state.phaseState.phase, state.combat.companyId),
  };
}

function resolveEntry(state: GameState, entryIndex: number): ResolveResult {
  const chain = state.chain!;
  const entry = chain.entries[entryIndex];

  logDetail(`Resolving chain entry #${entryIndex}: ${entry.payload.type} by player ${entry.declaredBy as string}`);

  // CoE 2.IV.iii.1: re-check the hazard limit now, before any of this entry's
  // effects run. Negating rather than special-casing each payload type means a
  // creature never reaches `initiateCreatureCombat`, a short event never fires
  // its triggers, and a permanent event never enters play. The card itself is
  // flushed to its declarer's discard pile by `completeChain`, which already
  // handles negated entries (and skips short events, discarded at play time).
  if (hazardLimitExceededAtResolution(state, entry) && state.phaseState.phase === Phase.MovementHazard) {
    const mhState = state.phaseState;
    const def = entry.card ? defById(state, entry.card.definitionId) : undefined;
    const activeCompany = state.players[state.players.findIndex(p => p.id === state.activePlayer)]
      .companies[mhState.activeCompanyIndex];
    const limit = currentHazardLimit(state, mhState, activeCompany.id);
    logDetail(`Hazard "${def?.name ?? entry.payload.type}" fizzles — hazard limit exceeded at resolution (${mhState.hazardsPlayedThisCompany} declared > limit ${limit})`);
    const negatedEntries = chain.entries.map((e, i) =>
      i === entryIndex ? { ...e, negated: true, resolved: true } : e,
    );
    return {
      state: { ...state, chain: { ...chain, entries: negatedEntries } },
      needsInput: false,
    };
  }

  // TODO: check validity (CoE rule 681: conditions must still be legal)

  let current = state;
  const resolveEffects: import('../index.js').GameEffect[] = [];

  // Apply card effects based on payload type
  if (entry.payload.type === 'short-event' && entry.payload.targetInstanceId) {
    // Wrath of the West (le-151): a `cancel-chain-entry` apply carrying a
    // `threshold` gates the cancel on a 2d6 roll — "Make a roll—if the
    // result is greater than 6, the event is canceled and discarded" — rather
    // than negating the target unconditionally (Ire of the East wh-24, Twilight).
    const rollThreshold = entry.card
      ? getCardEffects(defById(current, entry.card.definitionId)).find(
          (e): e is OnEventEffect & { apply: import('../types/effects.js').CancelChainEntryAction } =>
            e.type === 'on-event' && e.event === 'self-enters-play'
            && e.apply?.type === 'cancel-chain-entry' && e.apply.select === 'target'
            && typeof e.apply.threshold === 'number',
        )?.apply.threshold
      : undefined;
    if (rollThreshold != null) {
      const cardName = defById(current, entry.card!.definitionId)?.name ?? (entry.card!.definitionId as string);
      const declarerIdx = getPlayerIndex(current, entry.declaredBy);
      const { roll, rng, cheatRollTotal } = roll2d6(current);
      const total = roll.die1 + roll.die2;
      const success = total >= rollThreshold;
      current = { ...current, rng, cheatRollTotal };
      resolveEffects.push(diceRollEffect(current.players[declarerIdx].name, roll, `${cardName}: cancel roll`));
      logDetail(`${cardName}: ${current.players[declarerIdx].name} rolls ${roll.die1} + ${roll.die2} = ${total} vs threshold ${rollThreshold} — ${success ? 'success, canceling target' : 'failure, target unaffected'}`);
      if (success) {
        current = resolveEnvironmentCancel(current, entry.payload.targetInstanceId, chain);
      }
    } else {
      current = resolveEnvironmentCancel(current, entry.payload.targetInstanceId, chain);
    }
  }

  // "Remove this card from the game." — a short-event whose self-enters-play
  // `cancel-chain-entry` apply carries `removeFromGame` (Ire of the East
  // wh-24) moves the spent card from its player's discard pile (where it was
  // placed at play time) to their out-of-play pile once its entry resolves
  // un-negated, so it can never be recurred. A negated entry leaves the card
  // in the discard pile — a canceled card's instructions never execute.
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    const def = defById(current, entry.card.definitionId);
    const removesSelf = getCardEffects(def).some(
      e => e.type === 'on-event'
        && e.event === 'self-enters-play'
        && e.apply?.type === 'cancel-chain-entry'
        && e.apply.removeFromGame === true,
    );
    if (removesSelf) {
      const cardName = (def as { name?: string } | undefined)?.name ?? (entry.card.definitionId as string);
      current = removeSpentEventFromGame(current, entry.declaredBy, entry.card.instanceId, cardName);
    }
  }

  // Short events that carry an on-event company-arrives-at-site → add-
  // constraint effect (e.g. *River*) have the target company fully
  // determined at play time (the active M/H company). Fire the trigger
  // directly on resolution so the card can go to discard as a normal
  // short event — no deferred tracking needed.
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    current = applyShortEventArrivalTrigger(current, entry);
  }

  // Short events with self-enters-play → add-constraint effects (e.g. Lost in
  // Free-domains): fire the constraint immediately on resolution. The card was
  // already moved to discard at play time.
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    current = applyShortEventSelfEntersPlayConstraints(current, entry);
  }

  // Greed (le-113 / tw-42): a hazard short-event played on a site installs a
  // turn-scoped `item-play-corruption-check` constraint bound to that site, so
  // every item played at the site for the rest of the turn triggers corruption
  // checks on the (non-exempt) characters there. The target site rode on the
  // chain payload; the card goes to discard as a normal short event.
  if (
    entry.payload.type === 'short-event'
    && !entry.negated
    && entry.card
    && entry.payload.targetSiteDefinitionId
  ) {
    current = applyItemPlayCorruptionCheckConstraint(current, entry, entry.payload.targetSiteDefinitionId);
  }

  // Short events with fetch-to-deck effects (e.g. An Unexpected Outpost):
  // move the card from the declaring player's discard pile to cardsInPlay
  // and queue the pending effects so the player can pick cards to fetch.
  // A dual-mode card played in its discard-in-play mode (Ancient Secrets
  // ba-36 mode 1) carries a discard target on the payload and must NOT also
  // run its sideboard fetch — the same guard the play-time handler applies.
  if (entry.payload.type === 'short-event'
    && !entry.negated
    && entry.card
    && !entry.payload.discardTargetInstanceId) {
    current = queueFetchToDecEffects(current, entry);
  }

  // Short events that force the active M/H company back to its site of origin
  // (e.g. Beorning Skin-changers ba-10 played as a short-event) — unless the
  // effect's `unless` company condition (Beorn / an untapped warrior with
  // prowess > 4) is met.
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    current = applyCompanyReturnToOrigin(current, entry);
  }

  // Company-targeting short events declaring play-option modes (e.g. Drowning
  // Seas tw-30): the hazard player chose one mutually-exclusive option at
  // play time, carried on the chain entry as `optionId`. Dispatch the chosen
  // option's `apply` now that the entry resolved un-negated.
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card && entry.payload.optionId) {
    current = applyCompanyPlayOption(current, entry);
  }

  // Short events that forbid the active M/H company from acting during its site
  // phase this turn without moving it back to origin (Darkness Made by Malice
  // ba-15).
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    current = applyCompanySitePhaseDoNothing(current, entry);
  }

  // Short events that tap one chosen character (e.g. Adûnaphel tw-2's on-tap
  // "causes any one character to tap"). The target was chosen at play/tap time
  // and rides on the chain entry's payload.
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    current = applyTapCharacter(current, entry);
  }

  // Short events that force every character in play — both players' — to make
  // a corruption check (Ren the Unclean tw-83's on-tap short-event conversion).
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    current = applyForceCheckAllInPlay(current, entry);
  }

  // Short events that make one chosen character give up an item of the owner's
  // choice (Indûr Dawndeath tw-46's on-tap short-event conversion). The victim
  // was chosen at tap time and rides on the chain entry's payload.
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    current = applyForceDiscardTargetItem(current, entry);
  }

  // Short events that boost every attack of a set of races for the rest of the
  // turn (Dwar of Waw tw-31's on-tap short-event conversion).
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    current = applyAttackRaceBoost(current, entry);
  }

  // Short events that modify one named character's stat for the rest of the
  // turn (Akhôrahil tw-4's on-tap short-event conversion: body -1). The target
  // was chosen at tap time and rides on the chain entry's payload.
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    current = applyTargetCharacterStatModifier(current, entry);
  }

  // Short events that retype a whole class of sites (Witch-king of Angmar
  // tw-113's on-tap long-event: "all Shadow-holds become Dark-holds").
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    current = applySiteTypeRemap(current, entry);
  }

  // draw-cards (Dark Tryst as-80): a resource short event that draws cards
  // routes through the chain (see handlePlayResourceShortEvent) and resolves
  // here once both players pass priority. Draw `count` cards from the top of
  // the declaring player's play deck into their hand, then dispose of the
  // spent event card: out-of-play when `removeFromGame` is set (so it can
  // never be recurred), otherwise the discard pile. The card rode on the chain
  // entry (it left the hand at play time), so dispose it now. Per CoE rule
  // 2.4, a play deck that runs dry mid-draw is exhausted and reshuffled
  // immediately, and the draw resumes from the reshuffled deck —
  // `drawCardsExhausting` handles that; it only stops short if the discard
  // pile is also empty (nothing left to shuffle in).
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    const def = defById(current, entry.card.definitionId);
    const drawEffect = getCardEffects(def).find(
      (e): e is import('../types/effects.js').DrawCardsEffect => e.type === 'draw-cards',
    );
    if (drawEffect) {
      const declaringIndex = getPlayerIndex(current, entry.declaredBy);
      const cardName = (def as { name?: string }).name ?? (entry.card.definitionId as string);
      const deckSizeBefore = current.players[declaringIndex].playDeck.length;
      logDetail(`${cardName}: chain resolves draw-cards — drawing ${drawEffect.count} card(s) from play deck (deck size ${deckSizeBefore})`);
      const { state: afterDraw, drawnCards } = drawCardsExhausting(current, declaringIndex, drawEffect.count);
      current = afterDraw;
      if (drawnCards.length < drawEffect.count) {
        logDetail(`${cardName}: play deck and discard pile both exhausted — drew only ${drawnCards.length} of ${drawEffect.count}`);
      }
      const spentCard = toCardInstance(entry.card);
      logDetail(`${cardName}: spent event card → ${drawEffect.removeFromGame ? 'out-of-play (removed from game)' : 'discard'}`);
      current = updatePlayer(current, declaringIndex, p => ({
        ...p,
        hand: [...p.hand, ...drawnCards],
        ...(drawEffect.removeFromGame
          ? { outOfPlayPile: [...p.outOfPlayPile, spentCard] }
          : { discardPile: [...p.discardPile, spentCard] }),
      }));
    }
  }

  // new-hand (Favor of the Valar tw-239): a resource short event that shuffles
  // the declaring player's hand and discard pile into their play deck and
  // draws a fresh hand of `handSize` cards. Routes through the chain (see
  // handlePlayResourceShortEvent) and resolves here once both players pass
  // priority. Site cards are structurally unaffected — they live in the
  // separate siteDeck/siteDiscardPile zones, never in the play-deck discard
  // pile. The spent event card rode on the chain entry (it left the hand at
  // play time), so it is never swept into the deck; it lands in the discard
  // pile AFTER the shuffle, where the `play-flag: remove-from-game` branch
  // below relocates it to the out-of-play pile. This card-driven reshuffle is
  // not a rule-1.31 deck exhaustion (deckExhaustionCount is untouched).
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    const def = defById(current, entry.card.definitionId);
    const newHandEffect = getCardEffects(def).find(
      (e): e is import('../types/effects.js').NewHandEffect => e.type === 'new-hand',
    );
    if (newHandEffect) {
      const declaringIndex = getPlayerIndex(current, entry.declaredBy);
      const player = current.players[declaringIndex];
      const cardName = (def as { name?: string }).name ?? (entry.card.definitionId as string);
      const pooled = [...player.playDeck, ...player.hand, ...player.discardPile];
      const [shuffledDeck, nextRng] = shuffle(pooled, current.rng);
      const drawCount = Math.min(newHandEffect.handSize, shuffledDeck.length);
      logDetail(`${cardName}: chain resolves new-hand — shuffling hand (${player.hand.length}) and discard pile (${player.discardPile.length}) into play deck (${player.playDeck.length} → ${shuffledDeck.length}), drawing a new hand of ${drawCount}/${newHandEffect.handSize}`);
      if (drawCount < newHandEffect.handSize) {
        logDetail(`${cardName}: play deck exhausted — new hand is only ${drawCount} card(s)`);
      }
      const spentCard = toCardInstance(entry.card);
      current = {
        ...updatePlayer(current, declaringIndex, p => ({
          ...p,
          hand: shuffledDeck.slice(0, drawCount),
          playDeck: shuffledDeck.slice(drawCount),
          discardPile: [spentCard],
        })),
        rng: nextRng,
      };
    }
  }

  // grant-extra-mh-phase (Forced March le-185, Bridge tw-202, Leg It Double
  // Quick le-202, World Gnawed by the Nameless as-110): a resource short
  // event that flags the target company so that once its current move
  // commits, `advanceAfterCompanyMH` offers it another movement/hazard
  // phase. Routes through the chain (see handlePlayResourceShortEvent) and
  // resolves here once both players pass priority — CoE 9.4/9.5 gives the
  // opponent a chance to respond (e.g. cancel the event) before the company
  // is flagged.
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    const card = entry.card;
    const def = defById(current, card.definitionId);
    const grantExtraMHPhase = getCardEffects(def).find(
      (e): e is import('../types/effects.js').GrantExtraMHPhaseEffect => e.type === 'grant-extra-mh-phase',
    );
    const targetCompanyId = entry.payload.targetCompanyId;
    if (grantExtraMHPhase && targetCompanyId) {
      const declaringIndex = getPlayerIndex(current, entry.declaredBy);
      const cardName = (def as { name?: string }).name ?? (card.definitionId as string);
      const pendingValue = grantExtraMHPhase.movement === 'under-deeps' ? 'under-deeps' as const : true;
      logDetail(`${cardName}: chain resolves grant-extra-mh-phase — flagging company ${targetCompanyId as string} for an extra ${pendingValue === 'under-deeps' ? 'Under-deeps ' : ''}movement/hazard phase this turn`);
      const spentCard = toCardInstance(card);
      // "Return this card to your hand" (World Gnawed by the Nameless as-110):
      // the spent event goes back to its owner's hand instead of the discard
      // pile, so it can be replayed in a later M/H phase this turn.
      current = updatePlayer(current, declaringIndex, p => ({
        ...p,
        hand: grantExtraMHPhase.returnToHand ? [...p.hand, spentCard] : p.hand,
        discardPile: grantExtraMHPhase.returnToHand ? p.discardPile : [...p.discardPile, spentCard],
        companies: p.companies.map(c => c.id === targetCompanyId ? { ...c, extraMHPhasePending: pendingValue } : c),
      }));
      if (grantExtraMHPhase.returnToHand) {
        logDetail(`${cardName}: returned to its owner's hand`);
      }
      // Companion keyed-attacks-normal effect (as-110): "All hazard creatures
      // the company faces this turn keyed to Shadow-holds attack normally,
      // not as detainment" — a turn-scoped constraint on the target company.
      const keyedNormal = getCardEffects(def).find(
        (e): e is import('../types/effects.js').KeyedAttacksNormalEffect => e.type === 'keyed-attacks-normal',
      );
      if (keyedNormal) {
        logDetail(`${cardName}: attacks keyed to [${keyedNormal.siteTypes.join(', ')}] against company ${targetCompanyId as string} are normal (not detainment) this turn`);
        current = addConstraint(current, {
          source: card.instanceId,
          sourceDefinitionId: card.definitionId,
          scope: { kind: 'turn' },
          target: { kind: 'company', companyId: targetCompanyId },
          kind: { type: 'keyed-attacks-normal', siteTypes: keyedNormal.siteTypes },
        });
      }
    }
  }

  // `play-flag: remove-from-game` — "Remove this card from the game." A hazard
  // short event is discarded at play time, so once its own chain entry resolves
  // un-negated the spent card moves on from the declaring player's discard pile
  // to their out-of-play pile, where nothing can recur it (a resource short
  // event with `new-hand`, e.g. Favor of the Valar tw-239, lands its spent
  // card in the discard pile only just above, via the shuffle — this block
  // relocates it from there in the same pass). A negated entry leaves the
  // card in the discard pile.
  //
  // A card whose OTHER effect pauses resolution with `needsInput: true`
  // ahead of this point (e.g. `multi-faction-check`'s per-faction dice-checks)
  // must perform its own removal inline before pausing — once a chain entry
  // is later marked resolved via `resolveChainEntryAndContinue` rather than a
  // fresh call into this function, this block never runs for it.
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    const cardDef = defById(current, entry.card.definitionId);
    if (hasPlayFlag(cardDef as { effects?: readonly import('../types/effects.js').CardEffect[] }, 'remove-from-game')) {
      current = removeSpentEventFromGame(current, entry.declaredBy, entry.card.instanceId, cardDef?.name ?? (entry.card.definitionId as string));
    }
  }

  // Resource short events that discard a card in play (Voices of Malice
  // le-250, Marvels Told td-134, Ancient Secrets ba-36, The Cock Crows
  // tw-342) ride the chain from the player's hand (see
  // handlePlayResourceShortEvent) so the opponent gets the response window
  // every action is owed (CoE 9.4/9.5). Now that the entry resolved
  // un-negated, perform the discard plus its follow-up corruption check and
  // dispose of the spent event card. A negated entry never discards anything;
  // `completeChain` flushes its card to the declaring player's discard.
  if (entry.payload.type === 'short-event'
    && !entry.negated
    && entry.card
    && entry.payload.discardTargetInstanceId) {
    const def = defById(current, entry.card.definitionId);
    if (def) {
      const result = applyShortEventDiscardInPlay(
        current,
        def,
        entry.card.instanceId,
        entry.declaredBy,
        entry.payload.discardTargetInstanceId,
        entry.payload.costTapCharacterId,
      );
      if (result.error) {
        logDetail(`${def.name}: discard-in-play did not resolve — ${result.error}`);
      } else {
        current = result.state;
      }
      const declaringIndex = getPlayerIndex(current, entry.declaredBy);
      logDetail(`${def.name}: spent event card → discard`);
      current = updatePlayer(current, declaringIndex, p => ({
        ...p,
        discardPile: [...p.discardPile, toCardInstance(entry.card!)],
      }));
    }
  }

  // The sweep sibling of the branch above (Wizard's River-horses tw-364, "All
  // Nazgûl events are discarded"): the mode was flagged on the payload at
  // declaration time — there was no single target to carry — so on un-negated
  // resolution every in-play card matching the effect's filter goes to its
  // owner's discard pile, the `play-target` Wizard makes the follow-up
  // corruption check, and the spent event card is disposed of.
  if (entry.payload.type === 'short-event'
    && !entry.negated
    && entry.card
    && entry.payload.discardAllInPlay) {
    const def = defById(current, entry.card.definitionId);
    if (def) {
      const result = applyShortEventDiscardAllInPlay(
        current,
        def,
        entry.card.instanceId,
        entry.declaredBy,
        entry.payload.targetCharacterId,
      );
      if (result.error) {
        logDetail(`${def.name}: discard-all-in-play did not resolve — ${result.error}`);
      } else {
        current = result.state;
      }
      const declaringIndex = getPlayerIndex(current, entry.declaredBy);
      logDetail(`${def.name}: spent event card → discard`);
      current = updatePlayer(current, declaringIndex, p => ({
        ...p,
        discardPile: [...p.discardPile, toCardInstance(entry.card!)],
      }));
    }
  }

  // Rolled down to the Sea (wh-29): a hazard short-event carrying a
  // force-opponent-discard effect. When it resolves un-negated, gather the
  // card-player's opponent's rings from the named sources; if any exist,
  // enqueue a force-discard-card pending resolution so the opponent picks one
  // ring to discard. If none exist and fallbackRevealHand is set, reveal the
  // opponent's hand identities to the card-player instead. The chain entry is
  // still marked resolved below (the pending resolution is independent of the
  // chain, like Brigands' discard-one-company-item).
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    const def = defById(current, entry.card.definitionId);
    const forceDiscard = getCardEffects(def).find(
      (e): e is import('../types/effects.js').ForceOpponentDiscardEffect => e.type === 'force-opponent-discard',
    );
    if (forceDiscard) {
      const cardName = (def as { name?: string }).name ?? (entry.card.definitionId as string);
      const opponentId = opponent(current, entry.declaredBy);
      const opponentIdx = getPlayerIndex(current, opponentId);
      const opponentState = current.players[opponentIdx];

      if (forceDiscard.match === 'any') {
        // Count-based discard from hand (Khamûl the Easterling tw-47). The
        // number of cards was fixed at declaration time and threaded via the
        // payload (see handleTapAltPermanentEvent); fall back to 1. The opponent
        // chooses which cards to discard, so any hand card is a candidate.
        const rawCount = entry.payload.type === 'short-event' ? entry.payload.forcedDiscardCount ?? 1 : 1;
        const remaining = Math.min(rawCount, opponentState.hand.length);
        if (remaining > 0) {
          logDetail(`${cardName}: ${opponentState.name} must discard ${remaining} card(s) of their choice from hand — enqueuing force-discard-card`);
          current = enqueueResolution(current, {
            source: entry.card.instanceId,
            actor: opponentId,
            scope: { kind: 'phase', phase: Phase.MovementHazard },
            kind: {
              type: 'force-discard-card',
              candidateInstanceIds: [],
              sourceDefinitionId: entry.card.definitionId,
              anyFromHand: true,
              remaining,
            },
          });
        } else if (forceDiscard.fallbackRevealHand) {
          logDetail(`${cardName}: opponent's hand is empty — revealing hand to ${entry.declaredBy as string}`);
          current = revealInstances(current, opponentState.hand);
        } else {
          logDetail(`${cardName}: opponent's hand is empty — no cards to discard`);
        }
      } else {
        // A "ring" is any card carrying the `ring` keyword or the `gold-ring`
        // subtype (the MECCG definition of a ring). The matcher is keyed off the
        // effect's `match` category so it can be reused by future cards.
        const isRing = (defId: CardDefinitionId): boolean => {
          const cardDef = defById(current, defId);
          if (!cardDef) return false;
          const keywords: readonly string[] = 'keywords' in cardDef ? (cardDef as { keywords?: readonly string[] }).keywords ?? [] : [];
          const subtype = 'subtype' in cardDef ? (cardDef as { subtype?: string }).subtype : undefined;
          return keywords.includes('ring') || subtype === 'gold-ring';
        };

        const candidateInstanceIds: CardInstanceId[] = [];
        if (forceDiscard.sources.includes('hand')) {
          for (const c of opponentState.hand) {
            if (isRing(c.definitionId)) candidateInstanceIds.push(c.instanceId);
          }
        }
        if (forceDiscard.sources.includes('carried')) {
          for (const ch of Object.values(opponentState.characters)) {
            for (const item of ch.items) {
              if (isRing(item.definitionId)) candidateInstanceIds.push(item.instanceId);
            }
          }
        }

        if (candidateInstanceIds.length > 0) {
          logDetail(`${cardName}: ${opponentState.name} must discard one of ${candidateInstanceIds.length} ring(s) — enqueuing force-discard-card`);
          current = enqueueResolution(current, {
            source: entry.card.instanceId,
            actor: opponentId,
            scope: { kind: 'phase', phase: Phase.MovementHazard },
            kind: {
              type: 'force-discard-card',
              candidateInstanceIds,
              sourceDefinitionId: entry.card.definitionId,
            },
          });
        } else if (forceDiscard.fallbackRevealHand) {
          logDetail(`${cardName}: no rings available — ${opponentState.name} reveals their hand (${opponentState.hand.length} card(s)) to ${entry.declaredBy as string}`);
          current = revealInstances(current, opponentState.hand);
        } else {
          logDetail(`${cardName}: no rings available and no reveal-hand fallback — no effect`);
        }
      }
    }
  }

  // Revealed to all Watchers (dm-85): a hazard short-event carrying a
  // cycle-hand effect. When it resolves un-negated, reveal the playing player's
  // hand, keep the matching (hazard) cards, refill the hand from the deck, and
  // place the set-aside (non-hazard) cards on top of the play deck — then let
  // the player order them via an arrange-deck-top pending resolution.
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    const def = defById(current, entry.card.definitionId);
    const cycle = getCardEffects(def).find(
      (e): e is import('../types/effects.js').CycleHandEffect => e.type === 'cycle-hand',
    );
    if (cycle) {
      current = applyCycleHand(current, entry, cycle);
    }
  }

  // Aware of their Ways (dm-46): a hazard short-event carrying a
  // reveal-remove-from-discard effect. When it resolves un-negated, reveal a
  // random subset of the opponent's discard pile to the card-player; if any
  // revealed card is non-unique (sites treated as unique per errata), enqueue a
  // reveal-remove-from-discard pending resolution so the card-player may remove
  // one of them from the game. The un-chosen revealed cards stay in the discard
  // pile ("Opponent discards the other three"). Like the other discard-pick
  // resolutions, the pending resolution is independent of the chain (the entry
  // is still marked resolved below).
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    const def = defById(current, entry.card.definitionId);
    const revealRemove = getCardEffects(def).find(
      (e): e is import('../types/effects.js').RevealRemoveFromDiscardEffect =>
        e.type === 'reveal-remove-from-discard',
    );
    if (revealRemove) {
      const cardName = (def as { name?: string }).name ?? (entry.card.definitionId as string);
      const opponentId = opponent(current, entry.declaredBy);
      const opponentIdx = getPlayerIndex(current, opponentId);
      const opponentState = current.players[opponentIdx];
      const pile = opponentState.discardPile;

      if (pile.length === 0) {
        logDetail(`${cardName}: ${opponentState.name}'s discard pile is empty — no effect`);
      } else {
        // Pick `count` cards at random from the discard pile (the seeded RNG
        // keeps replays deterministic). If fewer than `count` are present, all
        // are revealed.
        const [shuffled, nextRng] = shuffle(pile, current.rng);
        current = { ...current, rng: nextRng };
        const revealCount = Math.min(revealRemove.count, shuffled.length);
        const revealed = shuffled.slice(0, revealCount);
        current = revealInstances(current, revealed);
        logDetail(
          `${cardName}: ${opponentState.name} reveals ${revealCount} random card(s) from their ` +
          `discard pile (pile size ${pile.length}) to ${entry.declaredBy as string}`,
        );

        // A card is removable only if it is non-unique; sites are treated as
        // unique per the French errata ("les sites sont considérés comme uniques").
        const isRemovable = (defId: CardDefinitionId): boolean => {
          const cardDef = defById(current, defId);
          if (!cardDef) return false;
          if (isSiteCard(cardDef)) return false;
          const unique = 'unique' in cardDef ? (cardDef as { unique?: boolean }).unique : undefined;
          return unique !== true;
        };
        const removableInstanceIds = revealed
          .filter(c => isRemovable(c.definitionId))
          .map(c => c.instanceId);

        if (removableInstanceIds.length > 0) {
          logDetail(
            `${cardName}: ${removableInstanceIds.length} of the revealed card(s) are non-unique — ` +
            `enqueuing reveal-remove-from-discard for ${entry.declaredBy as string}`,
          );
          current = enqueueResolution(current, {
            source: entry.card.instanceId,
            actor: entry.declaredBy,
            scope: { kind: 'phase', phase: Phase.MovementHazard },
            kind: {
              type: 'reveal-remove-from-discard',
              removableInstanceIds,
              opponentId,
              sourceDefinitionId: entry.card.definitionId,
            },
          });
        } else {
          logDetail(`${cardName}: none of the revealed card(s) are non-unique — nothing to remove`);
        }
      }
    }
  }

  // Desire All for Thy Belly (ba-16): a hazard short-event carrying a
  // `reveal-deck-choose-penalty` effect. When it resolves un-negated, reveal the
  // top N cards of the opponent's play deck (N = the number of in-play cards
  // matching the effect's filter — Spawn cards — across either player's
  // cardsInPlay, so eliminated spawn do not count). The card-player then chooses
  // one to show (step-1 pending resolution `desire-belly-choose-card`) and the
  // opponent chooses the penalty (step-2 `desire-belly-choose-penalty`). The
  // event card is always removed from the game.
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    const def = defById(current, entry.card.definitionId);
    const penaltyEff = getCardEffects(def).find(
      (e): e is import('../types/effects.js').RevealDeckChoosePenaltyEffect =>
        e.type === 'reveal-deck-choose-penalty',
    );
    if (penaltyEff) {
      const cardName = (def as { name?: string }).name ?? (entry.card.definitionId as string);
      const opponentId = opponent(current, entry.declaredBy);
      const opponentIdx = getPlayerIndex(current, opponentId);

      // Count matching cards in play across both players' cardsInPlay.
      let inPlayCount = 0;
      for (const p of current.players) {
        for (const cip of p.cardsInPlay) {
          const cipDef = defById(current, cip.definitionId);
          if (cipDef && matchesCondition(penaltyEff.countInPlayMatching, cipDef as unknown as Record<string, unknown>)) {
            inPlayCount++;
          }
        }
      }

      const deck = current.players[opponentIdx].playDeck;
      const revealCount = Math.min(inPlayCount, deck.length);
      logDetail(
        `${cardName}: ${inPlayCount} matching card(s) in play → revealing ${revealCount} card(s) ` +
        `from the top of ${current.players[opponentIdx].name}'s play deck (deck ${deck.length})`,
      );

      // "Remove this card from the game." — move the event from the card-player's
      // discard pile (where it was placed at play time) to their out-of-play pile.
      current = removeSpentEventFromGame(current, entry.declaredBy, entry.card.instanceId, cardName);

      if (revealCount === 0) {
        logDetail(`${cardName}: nothing to reveal — the event fizzles`);
      } else {
        const revealed = deck.slice(0, revealCount);
        current = revealInstances(current, revealed);
        current = enqueueResolution(current, {
          source: entry.card.instanceId,
          actor: entry.declaredBy,
          scope: { kind: 'phase', phase: Phase.MovementHazard },
          kind: {
            type: 'desire-belly-choose-card',
            revealedInstanceIds: revealed.map(c => c.instanceId),
            opponentId,
            cardPlayerId: entry.declaredBy,
            sourceDefinitionId: entry.card.definitionId,
          },
        });
      }
    }
  }

  // Long Dark Reach (dm-70): a hazard short-event carrying a
  // `reveal-deck-choose-attacker` effect. When it resolves un-negated, the
  // card-player reveals the top N cards of THEIR OWN play deck (unlike
  // reveal-deck-choose-penalty's opponent-deck reveal). If at least one
  // revealed card is an eligible attacker (Nazgûl, Dragon, or non-unique
  // creature, playable outside Coastal Sea), enqueue a mandatory
  // reveal-deck-choose-attacker pending resolution so the card-player names
  // one to immediately attack the targeted company. With none eligible, every
  // revealed card is shuffled straight back to the top of the deck (no
  // pending resolution — see `engine/long-dark-reach.ts`).
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    const def = defById(current, entry.card.definitionId);
    const attackerEff = getCardEffects(def).find(
      (e): e is import('../types/effects.js').RevealDeckChooseAttackerEffect =>
        e.type === 'reveal-deck-choose-attacker',
    );
    if (attackerEff) {
      const cardName = (def as { name?: string }).name ?? (entry.card.definitionId as string);
      const cardPlayerId = entry.declaredBy;
      const targetCompanyId = entry.payload.targetCompanyId;
      const defendingPlayerId = current.activePlayer;
      const deck = current.players[getPlayerIndex(current, cardPlayerId)].playDeck;
      const revealCount = Math.min(attackerEff.count, deck.length);

      if (revealCount === 0 || !targetCompanyId || !defendingPlayerId) {
        logDetail(`${cardName}: nothing to reveal — the event fizzles`);
      } else {
        const revealed = deck.slice(0, revealCount);
        current = revealInstances(current, revealed);
        const revealedInstanceIds = revealed.map(c => c.instanceId);
        logDetail(`${cardName}: ${cardPlayerId as string} reveals the top ${revealCount} card(s) of their own play deck`);

        const eligible = findLongDarkReachCandidates(current, revealedInstanceIds, cardPlayerId);
        if (eligible.length === 0) {
          current = fizzleLongDarkReach(current, cardPlayerId, revealedInstanceIds);
        } else {
          current = enqueueResolution(current, {
            source: entry.card.instanceId,
            actor: cardPlayerId,
            scope: { kind: 'phase', phase: Phase.MovementHazard },
            kind: {
              type: 'reveal-deck-choose-attacker',
              revealedInstanceIds,
              eligibleInstanceIds: eligible.map(c => c.instanceId),
              cardPlayerId,
              targetCompanyId,
              defendingPlayerId,
              sourceInstanceId: entry.card.instanceId,
            },
          });
        }
      }
    }
  }

  // Inner Cunning (dm-68) mode 2: a hazard short-event carrying a
  // `fetch-agent-to-hand` effect. When it resolves un-negated, enqueue a
  // fetch-to-deck pending effect (source: play deck, to: hand) restricted to
  // agents whose printed home site is one of the listed types; the deck is
  // reshuffled and the chosen agent is revealed to the opponent. The card was
  // already discarded at play time (short-event mode), so skipDiscard is set.
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    const def = defById(current, entry.card.definitionId);
    const fetchEff = getCardEffects(def).find(
      (e): e is import('../types/effects.js').FetchAgentToHandEffect => e.type === 'fetch-agent-to-hand',
    );
    if (fetchEff) {
      // cancel-deck-search (as-13): a minion hazard player's play-deck tutor
      // is automatically canceled (the card stays discarded, nothing fetched).
      const agentFetch = gateDeckSearchFetch(current, entry.declaredBy, {
        type: 'fetch-to-deck' as const,
        source: ['deck'],
        filter: { keywords: { $includes: 'agent' } },
        count: 1,
        shuffle: true,
        to: 'hand' as const,
        homeSiteTypes: fetchEff.homeSiteTypes,
        revealToOpponent: true,
      });
      if (agentFetch) {
        logDetail(`fetch-agent-to-hand: enqueuing agent tutor for ${entry.declaredBy as string} (home-site types ${fetchEff.homeSiteTypes.join(', ')})`);
        current = {
          ...current,
          pendingEffects: [
            ...current.pendingEffects,
            {
              type: 'card-effect' as const,
              cardInstanceId: entry.card.instanceId,
              // The tutoring player is the hazard player (non-active), so the
              // pending-effect actor must be set explicitly (it defaults to the
              // active/resource player otherwise).
              actor: entry.declaredBy,
              effect: agentFetch,
              skipDiscard: true,
            },
          ],
        };
      }
    }
  }

  // Flattery-cancel-attack (e.g. Flatter a Foe): when the chain entry resolves
  // un-negated, create a flattery-attempt pending resolution for the defending
  // player to roll 2d6. The roll determines whether the attack is cancelled and
  // the hazard limit reduced. Do NOT immediately cancel the attack here.
  const flattery = matchRaceThresholdEffect<FlatteryCancelAttackEffect>(current, entry, 'flattery-cancel-attack');
  if (flattery) {
    const { effect, creatureRace, threshold, characterInstanceId, source, actor, scope } = flattery;
    logDetail(`Flattery-cancel-attack: enqueuing flattery-attempt for character ${characterInstanceId as string} (race "${creatureRace}", threshold ${threshold})`);
    current = enqueueResolution(current, {
      source,
      actor,
      scope,
      kind: {
        type: 'flattery-attempt',
        characterInstanceId,
        creatureRace,
        threshold,
        diplomatBonus: effect.diplomatBonus,
        hazardLimitReduction: effect.hazardLimitReduction,
      },
    });
    return { state: current, needsInput: true };
  }

  // Riddling-attempt (Riddling Talk td-148): when the chain entry resolves
  // un-negated, create a riddling-attempt pending resolution for the defending
  // player to roll 2d6. The roll only determines whether a follow-up guess is
  // offered — it does not itself cancel the attack. Do NOT cancel here.
  const riddling = matchRaceThresholdEffect<RiddlingAttemptEffect>(current, entry, 'riddling-attempt');
  if (riddling) {
    const { effect, creatureRace, threshold, characterInstanceId, source, actor, scope } = riddling;
    logDetail(`Riddling-attempt: enqueuing riddling-attempt for character ${characterInstanceId as string} (race "${creatureRace}", threshold ${threshold})`);
    current = enqueueResolution(current, {
      source,
      actor,
      scope,
      kind: {
        type: 'riddling-attempt',
        characterInstanceId,
        creatureRace,
        threshold,
        sageBonus: effect.sageBonus,
        hobbitBonus: effect.hobbitBonus,
        hazardLimitReduction: effect.hazardLimitReduction,
      },
    });
    return { state: current, needsInput: true };
  }

  // Goodwill-cancel-attack (Token of Goodwill dm-160): when the chain entry
  // resolves un-negated, enqueue a corruption check on the target diplomat.
  // If he survives, the `enqueue-goodwill-attempt` onSuccess hook (resolved in
  // pending-reducers.ts) raises a `goodwill-attempt` resolution for the item
  // discard + influence roll. Do NOT immediately cancel the attack here.
  if (entry.payload.type === 'short-event'
    && entry.payload.targetCharacterId
    && !entry.negated
    && entry.card
    && current.combat) {
    const cardDef = defById(current, entry.card.definitionId);
    const goodwillEffect = getCardEffects(cardDef).find(
      (e): e is import('../types/effects.js').GoodwillCancelAttackEffect => e.type === 'goodwill-cancel-attack',
    );
    if (goodwillEffect) {
      const creatureRace = current.combat.creatureRace;
      const isAgentAttack = current.combat.attackSource.type === 'agent';
      const matchedEntry = goodwillEffect.thresholds.find(t =>
        (creatureRace !== undefined && t.races.includes(creatureRace))
        || (t.matchAnyAgentAttack === true && isAgentAttack));
      if (matchedEntry) {
        const defPlayerId = current.combat.defendingPlayerId;
        const scope = companySubphaseScope(current.phaseState.phase, current.combat.companyId);
        logDetail(`Goodwill-cancel-attack: enqueuing corruption check for diplomat ${entry.payload.targetCharacterId as string} (item ${matchedEntry.itemSubtype}, threshold ${matchedEntry.threshold})`);
        current = enqueueCorruptionCheck(current, {
          source: entry.card.instanceId,
          actor: defPlayerId,
          scope,
          characterId: entry.payload.targetCharacterId,
          reason: cardDef?.name ?? (entry.card.definitionId as string),
          onSuccess: {
            type: 'enqueue-goodwill-attempt',
            companyId: current.combat.companyId,
            itemSubtype: matchedEntry.itemSubtype,
            threshold: matchedEntry.threshold,
          },
        });
        return { state: current, needsInput: true };
      }
    }
  }

  // Counter-cancel-attack-roll (Black Vapour ba-14): when the countering short
  // event resolves un-negated, enqueue a `dice-check` for the attacking (hazard)
  // player: roll 2d6 + the attack's current prowess. On a total greater than the
  // threshold, negate the targeted cancel entry and boost the attack (the onPass
  // `counter-cancel-attack` verb); otherwise the cancel resolves normally. The
  // check's `continuation` marks this entry resolved and resumes the chain, so
  // the (now negated or intact) cancel entry is processed next.
  if (entry.payload.type === 'short-event'
    && entry.payload.counterCancelTargetInstanceId
    && !entry.negated
    && entry.card
    && current.combat) {
    const cardDef = defById(current, entry.card.definitionId);
    const rollEffect = getCardEffects(cardDef).find(
      (e): e is import('../types/effects.js').CounterCancelAttackRollEffect => e.type === 'counter-cancel-attack-roll',
    );
    if (rollEffect) {
      const attackProwess = current.combat.strikeProwess;
      const scope = companySubphaseScope(current.phaseState.phase, current.combat.companyId);
      const targetInstanceId = entry.payload.counterCancelTargetInstanceId;
      logDetail(`Counter-cancel-attack-roll: enqueuing dice-check (roll + attack prowess ${attackProwess} > ${rollEffect.threshold}) to counter "${targetInstanceId as string}"`);
      current = enqueueResolution(current, {
        source: entry.card.instanceId,
        actor: entry.declaredBy,
        scope,
        kind: {
          type: 'dice-check',
          label: 'Black Vapour counter-cancel',
          roller: entry.declaredBy,
          modifiers: [{ kind: 'constant', value: attackProwess }],
          threshold: rollEffect.threshold,
          comparison: 'gt',
          onPass: { type: 'counter-cancel-attack', prowessBonus: rollEffect.prowessBonus },
          continuation: { kind: 'chain-entry', match: 'source' },
          targetInstanceId,
        },
      });
      return { state: current, needsInput: true };
    }
  }

  // Short events that cancel the current attack (e.g. Concealment, Dark
  // Quarrels, Many Turns and Doublings, Vanishment) or resolve a strike
  // effect (e.g. Dodge, Lucky Strike, Risky Blow): when the chain entry
  // resolves un-negated, fire each matching effect through the shared apply
  // dispatcher. The opponent had a chance to negate this entry during chain
  // declaration.
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    const def = defById(current, entry.card.definitionId);
    {
      const ctx = buildChainApplyContext(current, entry);
      for (const effect of getCardEffects(def)) {
        if (!shouldFireOnChainResolution(effect, entry)) continue;
        logDetail(`Chain resolves ${effect.type} from "${(def as { name?: string }).name ?? (entry.card.definitionId as string)}"`);
        const r = applyEffect(current, effect, ctx);
        if ('error' in r) {
          logDetail(`applyEffect ${effect.type} failed: ${r.error}`);
          continue;
        }
        current = r.state;
        if (r.effects) resolveEffects.push(...r.effects);
      }
    }
  }

  // set-character-status{inverted, target-character} (e.g. Escape): when the
  // cancel-attack resolves, wound the targeted character without a body check.
  // The targetCharacterId was captured on the chain entry at declaration time.
  if (
    entry.payload.type === 'short-event' &&
    !entry.negated &&
    entry.card &&
    entry.payload.targetCharacterId
  ) {
    const def = defById(current, entry.card.definitionId);
    if (getCardEffects(def).some(e => e.type === 'set-character-status' && (e as { status?: string }).status === 'inverted' && (e as { target?: string }).target === 'target-character')) {
      const targetId = entry.payload.targetCharacterId;
      for (let pi = 0; pi < current.players.length; pi++) {
        if (current.players[pi].characters[targetId]) {
          logDetail(`set-character-status{inverted}: wounding ${targetId as string} (no body check)`);
          current = updatePlayer(current, pi, p =>
            updateCharacter(p, targetId, c => ({ ...c, status: CardStatus.Inverted })),
          );
          break;
        }
      }
    }
  }

  // Faction-targeting short events (e.g. Muster Disperses): enqueue a
  // dice-check (muster) pending resolution so the faction's owner rolls 2d6 +
  // unused GI vs 11. The entry stays resolved on the chain; the pending
  // resolution drives the actual roll + discard.
  if (entry.payload.type === 'short-event' && !entry.negated && entry.payload.targetFactionInstanceId) {
    const factionInstId = entry.payload.targetFactionInstanceId;
    const factionDefId = resolveInstanceId(current, factionInstId);
    if (factionDefId) {
      // Find the faction's owner
      let factionOwner: PlayerId | null = null;
      for (const p of current.players) {
        if (p.cardsInPlay.some(c => c.instanceId === factionInstId)) {
          factionOwner = p.id;
          break;
        }
      }
      if (factionOwner) {
        logDetail(`Enqueuing dice-check (muster) pending resolution for faction ${factionDefId as string}`);
        current = enqueueResolution(current, {
          source: entry.card!.instanceId,
          actor: factionOwner,
          scope: { kind: 'phase', phase: Phase.MovementHazard },
          kind: {
            type: 'dice-check',
            label: `Muster: ${defById(current, factionDefId)?.name ?? (factionDefId as string)}`,
            roller: factionOwner,
            modifiers: [{ kind: 'unused-gi', player: factionOwner }],
            threshold: 11,
            comparison: 'gte',
            // total >= 11 → faction stays (no onPass); < 11 → discarded.
            onFail: { type: 'move', select: 'target', from: 'in-play', to: 'discard', toOwner: 'source-owner' },
            continuation: { kind: 'chain-entry', match: 'target-faction' },
            targetInstanceId: factionInstId,
          },
        });
        return { state: current, needsInput: true };
      }
    }
  }

  // News of Doom (le-127): a `multi-faction-check` hazard short event sweeps
  // EVERY faction in play — both players' — rather than one targeted faction
  // (Muster Disperses above). Enqueue one dice-check per faction found,
  // draining on the same source so the chain entry stays unresolved until
  // every roll is in (mirrors force-check-all-company's "all company
  // members" pattern).
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    const cardDef = defById(current, entry.card.definitionId);
    const multiFactionEffect = getCardEffects(cardDef).find(
      (e): e is import('../types/effects.js').MultiFactionCheckEffect => e.type === 'multi-faction-check',
    );
    if (multiFactionEffect) {
      const cardLabel = (cardDef as { name?: string } | undefined)?.name ?? (entry.card.definitionId as string);
      const factions: { instanceId: CardInstanceId; ownerId: PlayerId; name: string }[] = [];
      for (const p of current.players) {
        for (const cip of p.cardsInPlay) {
          const fDef = defById(current, cip.definitionId);
          if (fDef && isFactionCard(fDef)) {
            factions.push({ instanceId: cip.instanceId, ownerId: p.id, name: fDef.name });
          }
        }
      }
      logDetail(`${cardLabel}: enqueuing faction checks for ${factions.length} faction(s) in play`);
      for (const f of factions) {
        current = enqueueResolution(current, {
          source: entry.card.instanceId,
          actor: f.ownerId,
          scope: { kind: 'phase', phase: Phase.MovementHazard },
          kind: {
            type: 'dice-check',
            label: `${cardLabel}: ${f.name}`,
            roller: f.ownerId,
            modifiers: [{ kind: 'unused-gi', player: f.ownerId }],
            threshold: multiFactionEffect.threshold,
            comparison: multiFactionEffect.comparison,
            alwaysFailRolls: multiFactionEffect.alwaysFailRolls,
            onFail: { type: 'move', select: 'target', from: 'in-play', to: 'discard', toOwner: 'source-owner' },
            continuation: { kind: 'chain-entry', match: 'source', drainSameSource: true },
            targetInstanceId: f.instanceId,
          },
        });
      }
      if (factions.length > 0) {
        // `play-flag: remove-from-game` performed inline: this block pauses
        // resolution below, and once the drained entry is later marked
        // resolved via `resolveChainEntryAndContinue` this function never
        // runs again for it, so the generic remove-from-game block further
        // down would never fire for News of Doom.
        if (hasPlayFlag(cardDef as { effects?: readonly import('../types/effects.js').CardEffect[] }, 'remove-from-game')) {
          current = removeSpentEventFromGame(current, entry.declaredBy, entry.card.instanceId, cardLabel);
        }
        return { state: current, needsInput: true };
      }
    }
  }

  // Call of Home: hazard short event targeting a character. Enqueue a
  // pending resolution so the character's player rolls 2d6. Like the
  // influence-attempt pattern, do NOT mark the entry resolved yet.
  if (entry.payload.type === 'short-event'
    && entry.payload.targetCharacterId
    && !entry.negated
    && entry.card) {
    const cardDef = defById(current, entry.card.definitionId);
    const cohEffect = getCardEffects(cardDef).find(
      (e): e is import('../index.js').CallOfHomeCheckEffect => e.type === 'call-of-home-check',
    );
    if (cohEffect) {
      const resourcePlayerId = current.activePlayer!;
      const cohCharDefId = resolveInstanceId(current, entry.payload.targetCharacterId);
      const cohCharDef = cohCharDefId ? defById(current, cohCharDefId) : undefined;
      const cohCharName = cohCharDef && 'name' in cohCharDef ? cohCharDef.name : (entry.payload.targetCharacterId as string);
      const cohModifiers: import('../types/pending.js').DiceCheckModifier[] = [
        { kind: 'unused-gi', player: resourcePlayerId },
      ];
      // Call of the Sea (tw-19): roll modified by -3 if the target's company
      // moved this turn using a site path containing a Coastal Sea. Evaluated
      // against the active company's resolved path (the target always belongs
      // to the company currently in its M/H sub-phase).
      if (cohEffect.rollModifiers && cohEffect.rollModifiers.length > 0) {
        const cohMhState = current.phaseState as import('../index.js').MovementHazardPhaseState;
        const cohCtx = { company: { sitePathRegionTypes: cohMhState.resolvedSitePath } };
        let cohModTotal = 0;
        for (const m of cohEffect.rollModifiers) {
          if (matchesCondition(m.when, cohCtx)) cohModTotal += m.value;
        }
        if (cohModTotal !== 0) {
          logDetail(`Call of Home roll modifier: ${cohModTotal} (site path: ${cohMhState.resolvedSitePath.join(', ')})`);
          cohModifiers.push({ kind: 'constant', value: cohModTotal });
        }
      }
      logDetail(`Enqueuing dice-check (call-of-home) pending resolution for character ${entry.payload.targetCharacterId as string}`);
      current = enqueueResolution(current, {
        source: entry.card.instanceId,
        actor: resourcePlayerId,
        scope: { kind: 'phase-step', phase: Phase.MovementHazard, step: 'play-hazards' },
        kind: {
          type: 'dice-check',
          label: `Call of Home: ${cohCharName}`,
          modifiers: cohModifiers,
          threshold: cohEffect.threshold,
          comparison: 'gte',
          // roll + unused GI < threshold → character returns to hand.
          // One item may transfer to a company-mate (Pilfer Anything
          // Unwatched precedent); the rest of the character's cards discard.
          onFail: { type: 'return-character-to-hand', allowItemTransfer: true },
          continuation: { kind: 'chain-entry', match: 'target-character' },
          requireTargetPresent: true,
          targetCharacterId: entry.payload.targetCharacterId,
        },
      });
      return { state: current, needsInput: true };
    }
  }

  // A Lie in Your Eyes (as-23): hazard short-event targeting a character.
  // Enqueue a tap-or-roll-choice pending resolution so the character's
  // controller (the defending player) picks how to respond. Like Call of
  // Home, do NOT mark the entry resolved yet — the pending resolution (and,
  // if "roll" is picked, the follow-up dice-check) does that.
  if (entry.payload.type === 'short-event'
    && entry.payload.targetCharacterId
    && !entry.negated
    && entry.card) {
    const cardDef = defById(current, entry.card.definitionId);
    const tapOrRollEffect = getCardEffects(cardDef).find(
      (e): e is import('../types/effects.js').OpponentChooseTapOrRollEffect => e.type === 'opponent-choose-tap-or-roll',
    );
    if (tapOrRollEffect) {
      const targetCharId = entry.payload.targetCharacterId;
      const defenderIndex = current.players.findIndex(p => !!p.characters[targetCharId]);
      if (defenderIndex === -1) {
        logDetail(`A Lie in Your Eyes: target character ${targetCharId as string} no longer in play — no effect`);
      } else {
        const defenderId = current.players[defenderIndex].id;
        logDetail(`A Lie in Your Eyes: enqueuing tap-or-roll-choice pending resolution for ${defenderId as string}`);
        current = enqueueResolution(current, {
          source: entry.card.instanceId,
          actor: defenderId,
          scope: { kind: 'phase-step', phase: Phase.MovementHazard, step: 'play-hazards' },
          kind: {
            type: 'tap-or-roll-choice',
            characterInstanceId: targetCharId,
            rollingPlayer: entry.declaredBy,
            rollAddend: tapOrRollEffect.rollAddend,
          },
        });
        return { state: current, needsInput: true };
      }
    }
  }

  // Stay Her Appetite (le-140): hazard short-event targeting an ally.
  // Enqueue a stay-her-appetite-roll pending resolution so the hazard player
  // rolls 2d6 for the condition check.
  if (entry.payload.type === 'short-event'
    && !entry.negated
    && entry.card
    && entry.payload.targetAllyId) {
    const cardDef = defById(current, entry.card.definitionId);
    const shaEffect = getCardEffects(cardDef).find(
      (e): e is import('../types/effects.js').StayHerAppetiteEffect => e.type === 'stay-her-appetite',
    );
    if (shaEffect) {
      const allyInstId = entry.payload.targetAllyId;
      const activeIdx = getPlayerIndex(current, current.activePlayer!);
      const resourcePlayer = current.players[activeIdx];
      const hazardIdx = 1 - activeIdx;
      const hazardPlayerState = current.players[hazardIdx];

      // Find the host character and ally
      let hostCharId: import('../index.js').CardInstanceId | null = null;
      let allyInst: import('../types/state-cards.js').AllyInPlay | undefined;
      for (const [charId, char] of Object.entries(resourcePlayer.characters)) {
        const found = char.allies.find(a => a.instanceId === allyInstId);
        if (found) {
          hostCharId = charId as import('../index.js').CardInstanceId;
          allyInst = found;
          break;
        }
      }

      if (hostCharId && allyInst) {
        const allyDefId = resolveInstanceId(current, allyInstId);
        const allyDef = allyDefId ? defById(current, allyDefId) : undefined;
        // A converted-creature ally (Ready to His Will) carries its stats on the
        // instance override even though its definition is not an ally card.
        if (allyInst.statOverride || (allyDef && isAllyCard(allyDef))) {
          const allyMindVal = allyEffectiveMind(current, allyInst);
          const allyProwessVal = allyEffectiveProwess(current, allyInst);
          const allyDisplayName = (allyDef?.name ?? allyDefId) as string;
          const activeCompanyIdx = current.phaseState.phase === 'movement-hazard'
            ? (current.phaseState as { activeCompanyIndex: number }).activeCompanyIndex
            : 0;
          const targetCompany = resourcePlayer.companies[activeCompanyIdx];
          const controllerUnusedDI = availableDI(current, hostCharId, resourcePlayer);
          const opponentUnusedGI = effectiveGeneralInfluence(current, hazardPlayerState.id) - hazardPlayerState.generalInfluenceUsed;

          logDetail(`Stay Her Appetite: targeting ally "${allyDisplayName}" (mind ${allyMindVal}, prowess ${allyProwessVal}) on character ${hostCharId as string}; opp.GI=${opponentUnusedGI}, controller.DI=${controllerUnusedDI}`);

          current = enqueueResolution(current, {
            source: entry.card.instanceId,
            actor: hazardPlayerState.id,
            scope: { kind: 'phase', phase: Phase.MovementHazard },
            kind: {
              type: 'stay-her-appetite-roll',
              allyInstanceId: allyInstId,
              allyOwnerPlayerIndex: activeIdx,
              hostCharacterInstanceId: hostCharId,
              allyMind: allyMindVal,
              allyProwess: allyProwessVal,
              opponentUnusedGI,
              controllerUnusedDI,
              companyId: targetCompany.id,
              sourceDefinitionId: entry.card.definitionId,
            },
          });
          return { state: current, needsInput: true };
        }
      }
    }
  }

  // Tidings of Bold Spies (le-143): duplicate-site-auto-attacks — hazard short
  // event that creates immediate M/H-phase combat attacks mirroring every
  // automatic-attack at the destination site. The first attack is initiated now;
  // remaining attacks are stored in a `tidings-attacks-queue` constraint and
  // each subsequent attack is initiated by finalizeCombat after the previous one
  // completes. The created attacks are NOT automatic-attacks.
  if (entry.payload.type === 'short-event'
    && !entry.negated
    && entry.card
    && current.phaseState.phase === Phase.MovementHazard) {
    const tadCardDef = defById(current, entry.card.definitionId);
    const dupEffect = getCardEffects(tadCardDef).find(
      (e): e is import('../index.js').DuplicateSiteAutoAttacksEffect => e.type === 'duplicate-site-auto-attacks',
    );
    if (dupEffect) {
      const activePlayerId = current.activePlayer!;
      const activeIndex = getPlayerIndex(current, activePlayerId);
      const company = current.players[activeIndex].companies[current.phaseState.activeCompanyIndex];
      const destSiteInst = company?.destinationSite ?? company?.currentSite ?? null;
      const destSiteDefId = destSiteInst ? resolveInstanceId(current, destSiteInst.instanceId) : null;
      const destSiteDef = destSiteDefId ? defById(current, destSiteDefId) : undefined;
      if (company && destSiteDef && isSiteCard(destSiteDef)) {
        const autoAttacks = getActiveAutoAttacks(current, destSiteDef, destSiteInst?.instanceId);
        if (autoAttacks.length > 0) {
          const hazardPlayerId = hazardPlayer(current, activePlayerId).id;
          const inPlayNames = buildInPlayNames(current);
          const aa0 = autoAttacks[0];
          const race0 = normalizeCreatureRace(aa0.creatureType);
          const tidings0BoostCtx = { companyId: company.id };
          const prowess0 = resolveAttackProwess(current, aa0.prowess, inPlayNames, race0, true, undefined, tidings0BoostCtx);
          const strikes0 = resolveAttackStrikes(current, aa0.strikes, inPlayNames, race0, true, tidings0BoostCtx);
          const body0 = resolveAttackBody(current, aa0.body ?? null, inPlayNames, race0, tidings0BoostCtx);
          const aaAttackerChooses0 = resolveAttackerChoosesDefenders(
            current, aa0.combatRules?.includes('attacker-chooses-defenders') ?? false, race0,
          );
          logDetail(`Tidings of Bold Spies: initiating attack 1/${autoAttacks.length}: ${aa0.creatureType} (${strikes0} strikes, ${prowess0} prowess) — NOT an auto-attack`);
          const combat0: import('../types/state-combat.js').CombatState = makeCombatState({
            attackSource: { type: 'tidings-attack', eventInstanceId: entry.card.instanceId, attackIndex: 0 },
            companyId: company.id,
            defendingPlayerId: activePlayerId,
            attackingPlayerId: hazardPlayerId,
            strikesTotal: strikes0,
            strikeProwess: prowess0,
            creatureBody: body0,
            creatureRace: race0,
            assignmentPhase: aaAttackerChooses0 ? 'cancel-window' : 'defender',
            detainment: isDetainmentAttack({
              attackEffects: destSiteDef.effects,
              attackRace: race0 ?? null,
              defendingAlignment: current.players[activeIndex].alignment,
              defendingSiteEffects: destSiteDef.effects,
              defenderForcesNormalAttacks: playerConvertsDetainmentToNormal(current, current.players[activeIndex]),
            }),
            ...(aaAttackerChooses0 ? { attackerChoosesDefenders: true } : {}),
          });
          current = { ...current, combat: combat0 };
          // If more attacks follow, queue them in a constraint on the company.
          if (autoAttacks.length > 1) {
            current = addConstraint(current, {
              source: entry.card.instanceId,
              sourceDefinitionId: entry.card.definitionId,
              scope: { kind: 'company-mh-phase', companyId: company.id },
              target: { kind: 'company', companyId: company.id },
              kind: {
                type: 'tidings-attacks-queue',
                attacks: autoAttacks,
                attackIndex: 1,
              },
            });
          }
        } else {
          logDetail(`Tidings of Bold Spies: destination site "${destSiteDef.name}" has no auto-attacks — fizzle`);
        }
      }
    }
  }

  // FEAR! FIRE! FOES! (as-29) Mode A: create-site-auto-attack — hazard short
  // event played in M/H on a company moving to a Free-hold/Border-hold. Install
  // a turn-scoped `extra-automatic-attack` constraint keyed to the destination
  // site instance (which becomes the company's currentSite on arrival), so the
  // company faces one additional real automatic-attack at the site this turn.
  if (entry.payload.type === 'short-event'
    && !entry.negated
    && entry.card
    && current.phaseState.phase === Phase.MovementHazard) {
    const fffCardDef = defById(current, entry.card.definitionId);
    const createEffect = getCardEffects(fffCardDef).find(
      (e): e is import('../index.js').CreateSiteAutoAttackEffect => e.type === 'create-site-auto-attack',
    );
    if (createEffect) {
      const activeIndex = getPlayerIndex(current, current.activePlayer!);
      const company = current.players[activeIndex].companies[current.phaseState.activeCompanyIndex];
      const destSiteInst = company?.destinationSite ?? company?.currentSite ?? null;
      if (company && destSiteInst) {
        const injected: import('../types/cards-sites.js').AutomaticAttack = {
          creatureType: createEffect.attack.creatureType,
          strikes: createEffect.attack.strikes,
          prowess: createEffect.attack.prowess,
          ...(createEffect.attack.body !== undefined ? { body: createEffect.attack.body } : {}),
          ...(createEffect.attack.detainment ? { forceDetainment: true } : {}),
        };
        current = addConstraint(current, {
          source: entry.card.instanceId,
          sourceDefinitionId: entry.card.definitionId,
          scope: { kind: 'turn' },
          target: { kind: 'company', companyId: company.id },
          kind: {
            type: 'extra-automatic-attack',
            siteInstanceId: destSiteInst.instanceId,
            attack: injected,
          },
        });
        const destSiteName = (defById(current, destSiteInst.definitionId) as { name?: string } | undefined)?.name ?? (destSiteInst.definitionId as string);
        logDetail(`FEAR! FIRE! FOES!: additional automatic-attack (${injected.strikes} strikes, ${injected.prowess} prowess${injected.forceDetainment ? ', detainment' : ''}, no attack type) created at ${destSiteName} this turn`);
      }
    }
  }

  // Arouse Defenders (le-101): auto-attack-boost — hazard short event played in
  // M/H on a company moving to a Free-hold/Border-hold. Install a single-use
  // `auto-attack-boost` constraint against the moving company (scope
  // company-site-phase, keyed to the destination site definition), so the first
  // automatic-attack the company faces at the site this turn gets +prowessBonus
  // and (if flagged) cannot be canceled.
  if (entry.payload.type === 'short-event'
    && !entry.negated
    && entry.card
    && current.phaseState.phase === Phase.MovementHazard) {
    const boostCardDef = defById(current, entry.card.definitionId);
    const boostEffect = getCardEffects(boostCardDef).find(
      (e): e is import('../index.js').AutoAttackBoostEffect => e.type === 'auto-attack-boost',
    );
    if (boostEffect) {
      const activeIndex = getPlayerIndex(current, current.activePlayer!);
      const company = current.players[activeIndex].companies[current.phaseState.activeCompanyIndex];
      const destSiteInst = company?.destinationSite ?? company?.currentSite ?? null;
      if (company && destSiteInst) {
        current = addConstraint(current, {
          source: entry.card.instanceId,
          sourceDefinitionId: entry.card.definitionId,
          scope: { kind: 'company-site-phase', companyId: company.id },
          target: { kind: 'company', companyId: company.id },
          kind: {
            type: 'auto-attack-boost',
            prowessBonus: boostEffect.prowessBonus,
            uncancelable: boostEffect.uncancelable,
            siteDefinitionId: destSiteInst.definitionId,
          },
        });
        const destSiteName = (defById(current, destSiteInst.definitionId) as { name?: string } | undefined)?.name ?? (destSiteInst.definitionId as string);
        logDetail(`Arouse Defenders: one automatic-attack at ${destSiteName} gets +${boostEffect.prowessBonus} prowess${boostEffect.uncancelable ? ' and cannot be canceled' : ''} this turn`);
      }
    }
  }

  // Veils Flung Away / force-check-all-company{body}: hazard short event targeting the whole
  // company. Enqueue one body-check-company pending resolution per character in
  // the active M/H company so each character rolls 2d6 against their body.
  if (entry.payload.type === 'short-event'
    && !entry.payload.targetCharacterId
    && !entry.negated
    && entry.card) {
    const cardDef = defById(current, entry.card.definitionId);
    const fcacEffect = getCardEffects(cardDef).find(
      (e): e is ForceCheckAllCompanyTopEffect =>
          e.type === 'force-check-all-company' && (e as { check?: string }).check === 'body',
    );
    if (fcacEffect && current.phaseState.phase === Phase.MovementHazard) {
      const activePlayerId = current.activePlayer!;
      const activeIndex = getPlayerIndex(current, activePlayerId);
      const targetCompany = current.players[activeIndex].companies[current.phaseState.activeCompanyIndex];
      if (targetCompany) {
        const bodyCheckSourceName = (cardDef as { name?: string }).name ?? '?';
        const bodyModifier = fcacEffect.modifier ?? 0;
        logDetail(`force-check-all-company (body) "${bodyCheckSourceName}": enqueuing body checks (modifier ${bodyModifier}) for ${targetCompany.characters.length} characters`);
        for (const charId of targetCompany.characters) {
          const cChar = current.players[activeIndex].characters[charId];
          const cDef = cChar ? defById(current, cChar.definitionId) : undefined;
          // CoE 3.I.1: the check's modifier applies to the ROLL, and the check
          // fails when the modified total is HIGHER than the character's body
          // (rolling low is good) — the card's -1 makes survival easier.
          // CoE 3.I.4: effects modifying body shift the printed Orc/Troll
          // discard numbers by the same amount, so both the threshold and the
          // discard values track effectiveStats.body's delta from print.
          const cPrintedBody = cDef && isCharacterCard(cDef) && cDef.body != null ? cDef.body : 9;
          const cBody = cChar?.effectiveStats.body ?? cPrintedBody;
          const cBodyDelta = cBody - cPrintedBody;
          const cRace = cDef && isCharacterCard(cDef) ? cDef.race : '';
          const cOrcTroll = cRace === 'orc' || cRace === 'troll';
          const cDiscardValues = cOrcTroll && cDef && isCharacterCard(cDef) && cDef.cardType === 'minion-character' && cDef.discardBodyCheck != null
            ? cDef.discardBodyCheck.map(v => v + cBodyDelta)
            : [];
          const cName = cDef && isCharacterCard(cDef) ? cDef.name : (charId as string);
          // "Determine if each Orc or Troll character is discarded as
          // indicated on their cards": a modified total landing exactly on a
          // printed discard number discards (`matchOutcome`). "Otherwise, the
          // body checks have no effect unless an untapped character fails his
          // check, in which case he becomes tapped": every other failed check
          // — Orc/Troll included — merely taps. The `comparison: 'gt'`
          // resolver reports "passed" when total > threshold, so the bad
          // outcome (tap) goes on `onPass` and the good outcome (no effect)
          // is `onFail`.
          current = enqueueResolution(current, {
            source: entry.card.instanceId,
            actor: activePlayerId,
            scope: { kind: 'phase-step', phase: Phase.MovementHazard, step: 'play-hazards' },
            kind: {
              type: 'dice-check',
              label: `Body check (${bodyCheckSourceName}): ${cName}`,
              modifiers: [{ kind: 'constant', value: bodyModifier }],
              threshold: cBody,
              comparison: 'gt',
              ...(cDiscardValues.length > 0
                ? { matchOutcome: { values: cDiscardValues, action: { type: 'discard-character' as const } } }
                : {}),
              onPass: { type: 'set-character-status' as const, status: 'tapped' as const, when: { 'target.status': 'untapped' } },
              continuation: { kind: 'chain-entry', match: 'source', drainSameSource: true },
              requireTargetPresent: true,
              targetCharacterId: charId,
            },
          });
        }
        if (targetCompany.characters.length > 0) {
          return { state: current, needsInput: true };
        }
      }
    }
  }

  // Cruel Caradhras (td-9): company-strike — hazard short event that makes each
  // character in the active M/H company face one strike (not a creature attack).
  // Initiate a single combat with strikesTotal = company size and no creature
  // race; the strike prowess is fixed, the attack is uncancelable, and any
  // resulting body check is modified by `bodyCheckModifier`. The normal combat
  // machinery resolves one strike per character (each unassigned character is
  // offered exactly one strike), runs body checks, and finalizes.
  if (entry.payload.type === 'short-event'
    && !entry.payload.targetCharacterId
    && !entry.negated
    && entry.card
    && current.phaseState.phase === Phase.MovementHazard) {
    const csCardDef = defById(current, entry.card.definitionId);
    const csEffect = getCardEffects(csCardDef).find(
      (e): e is import('../index.js').CompanyStrikeEffect => e.type === 'company-strike',
    );
    if (csEffect) {
      const activePlayerId = current.activePlayer!;
      const activeIndex = getPlayerIndex(current, activePlayerId);
      const company = current.players[activeIndex].companies[current.phaseState.activeCompanyIndex];
      if (company && company.characters.length > 0) {
        const hazardPlayerId = hazardPlayer(current, activePlayerId).id;
        const totalStrikes = company.characters.length;
        logDetail(
          `company-strike "${(csCardDef as { name?: string }).name ?? '?'}": each of ${totalStrikes} character(s) ` +
          `faces one ${csEffect.prowess}-prowess strike (not an attack)` +
          `${csEffect.uncancelable ? ', uncancelable' : ''}` +
          `${csEffect.bodyCheckModifier ? `, body check ${formatSignedNumber(csEffect.bodyCheckModifier)}` : ''}`,
        );
        const combat: import('../types/state-combat.js').CombatState = makeCombatState({
          attackSource: { type: 'company-strike-event', eventInstanceId: entry.card.instanceId },
          companyId: company.id,
          defendingPlayerId: activePlayerId,
          attackingPlayerId: hazardPlayerId,
          strikesTotal: totalStrikes,
          strikeProwess: csEffect.prowess,
          creatureBody: null,
          creatureRace: undefined,
          assignmentPhase: 'defender',
          detainment: false,
          ...(csEffect.uncancelable ? { uncancelable: true } : {}),
          ...(csEffect.bodyCheckModifier ? { bodyCheckModifier: csEffect.bodyCheckModifier } : {}),
        });
        // Set combat and fall through so the chain entry is marked resolved (the
        // event card is discarded with the chain). The combat then surfaces from
        // `state.combat` — mirrors Tidings of Bold Spies. Returning needsInput
        // here would leave the entry unresolved and re-initiate combat after it
        // finalizes.
        current = { ...current, combat };
      }
    }
  }

  // The Reek (ba-23): company-tap-characters — hazard short event that taps every
  // untapped character in the active M/H company whose effective mind is below a
  // threshold (here "2 + spawnCardsInPlay") and that matches the effect filter
  // (excluding Wizards and Ringwraiths). Applied directly here, then the chain
  // entry is marked resolved and the event is discarded with the chain.
  if (entry.payload.type === 'short-event'
    && !entry.payload.targetCharacterId
    && !entry.negated
    && entry.card
    && current.phaseState.phase === Phase.MovementHazard) {
    const reekCardDef = defById(current, entry.card.definitionId);
    const tapEffect = getCardEffects(reekCardDef).find(
      (e): e is import('../index.js').CompanyTapCharactersEffect => e.type === 'company-tap-characters',
    );
    if (tapEffect) {
      const activePlayerId = current.activePlayer!;
      const activeIndex = getPlayerIndex(current, activePlayerId);
      const company = current.players[activeIndex].companies[current.phaseState.activeCompanyIndex];
      if (company) {
        const spawnCardsInPlay = countSpawnCardsInPlay(current);
        // mindBelow is optional: absent means no mind gate — tap every
        // untapped character matching the filter.
        const threshold = tapEffect.mindBelow !== undefined
          ? evaluateExpr(tapEffect.mindBelow, { spawnCardsInPlay })
          : Infinity;
        logDetail(
          `company-tap-characters "${(reekCardDef as { name?: string }).name ?? '?'}": ` +
          `${spawnCardsInPlay} Spawn card(s) in play → tapping untapped characters with mind < ${threshold}`,
        );
        for (const charId of company.characters) {
          const ch = current.players[activeIndex].characters[charId];
          if (!ch || ch.status !== CardStatus.Untapped) continue;
          const charDef = defById(current, ch.definitionId);
          if (!charDef || !isCharacterCard(charDef)) continue;
          const effMind = ch.effectiveStats.mind ?? charDef.mind ?? 0;
          if (effMind >= threshold) continue;
          if (tapEffect.filter) {
            const ctx = { target: { race: charDef.race, mind: effMind, name: charDef.name, skills: charDef.skills } };
            if (!matchesCondition(tapEffect.filter, ctx)) continue;
          }
          logDetail(`  tapping "${charDef.name}" (mind ${effMind})`);
          current = updatePlayer(current, activeIndex, p =>
            updateCharacter(p, charId, c => ({ ...c, status: CardStatus.Tapped })),
          );
        }
      }
    }
  }

  // Heedless Revelry (le-114) played normally: company-tap-roll — hazard short
  // event that rolls 2d6 per untapped character matching the filter (with
  // per-character modifiers, e.g. -2 for hero characters); roll > mind taps
  // the character. Enqueue one pending resolution carrying every qualifying
  // character; the company's controller rolls them one at a time. With no
  // qualifying characters the entry resolves as a no-op.
  if (entry.payload.type === 'short-event'
    && !entry.payload.targetCharacterId
    && !entry.negated
    && entry.card
    && current.phaseState.phase === Phase.MovementHazard) {
    const revelryCardDef = defById(current, entry.card.definitionId);
    const tapRollEffect = getCardEffects(revelryCardDef).find(
      (e): e is import('../index.js').CompanyTapRollEffect => e.type === 'company-tap-roll',
    );
    if (tapRollEffect) {
      const activePlayerId = current.activePlayer!;
      const activeIndex = getPlayerIndex(current, activePlayerId);
      const company = current.players[activeIndex].companies[current.phaseState.activeCompanyIndex];
      const rollTargets: { characterId: import('../index.js').CardInstanceId; modifier: number }[] = [];
      if (company) {
        for (const charId of company.characters) {
          const ch = current.players[activeIndex].characters[charId];
          if (!ch || ch.status !== CardStatus.Untapped) continue;
          const charDef = defById(current, ch.definitionId);
          if (!charDef || !isCharacterCard(charDef)) continue;
          const effMind = ch.effectiveStats.mind ?? charDef.mind ?? 0;
          const ctx = { target: { race: charDef.race, mind: effMind, name: charDef.name, skills: charDef.skills, cardType: charDef.cardType } };
          if (tapRollEffect.filter && !matchesCondition(tapRollEffect.filter, ctx)) {
            logDetail(`company-tap-roll: "${charDef.name}" excluded by filter`);
            continue;
          }
          let modifier = 0;
          for (const m of tapRollEffect.rollModifiers ?? []) {
            if (matchesCondition(m.when, ctx)) modifier += m.value;
          }
          rollTargets.push({ characterId: charId, modifier });
        }
      }
      if (rollTargets.length > 0) {
        logDetail(
          `company-tap-roll "${(revelryCardDef as { name?: string }).name ?? '?'}": ` +
          `${rollTargets.length} character(s) roll (taps if roll + modifier > mind)`,
        );
        current = enqueueResolution(current, {
          source: entry.card.instanceId,
          actor: activePlayerId,
          scope: { kind: 'phase-step', phase: Phase.MovementHazard, step: 'play-hazards' },
          kind: {
            type: 'company-tap-roll',
            hazardDefinitionId: entry.card.definitionId,
            remaining: rollTargets,
          },
        });
        return { state: current, needsInput: true };
      }
      logDetail(`company-tap-roll "${(revelryCardDef as { name?: string }).name ?? '?'}": no qualifying untapped characters — no-op`);
    }
  }

  // Heedless Revelry (le-114) revealed from on-guard during the site phase:
  // the on-guard-reveal effect's `company-tap-characters` apply taps every
  // untapped character in the active company matching the filter (no rolls,
  // no mind threshold). The deferred resource play it responded to is not
  // interfered with — it runs when the on-guard window closes.
  if (entry.payload.type === 'short-event'
    && !entry.payload.targetCharacterId
    && !entry.negated
    && entry.card
    && current.phaseState.phase === Phase.Site) {
    const ogCardDef = defById(current, entry.card.definitionId);
    const ogRevealEffect = getCardEffects(ogCardDef).find(
      (e): e is import('../index.js').OnGuardRevealEffect =>
        e.type === 'on-guard-reveal'
        && (e as { apply?: { type?: string } }).apply?.type === 'company-tap-characters',
    );
    const tapApply = ogRevealEffect?.apply as import('../index.js').CompanyTapCharactersTriggeredAction | undefined;
    if (tapApply) {
      const activePlayerId = current.activePlayer!;
      const activeIndex = getPlayerIndex(current, activePlayerId);
      const siteState = current.phaseState;
      const company = current.players[activeIndex].companies[siteState.activeCompanyIndex];
      if (company) {
        logDetail(
          `on-guard company-tap-characters "${(ogCardDef as { name?: string }).name ?? '?'}": ` +
          `tapping all untapped characters matching the filter`,
        );
        for (const charId of company.characters) {
          const ch = current.players[activeIndex].characters[charId];
          if (!ch || ch.status !== CardStatus.Untapped) continue;
          const charDef = defById(current, ch.definitionId);
          if (!charDef || !isCharacterCard(charDef)) continue;
          const effMind = ch.effectiveStats.mind ?? charDef.mind ?? 0;
          const ctx = { target: { race: charDef.race, mind: effMind, name: charDef.name, skills: charDef.skills, cardType: charDef.cardType } };
          if (tapApply.filter && !matchesCondition(tapApply.filter, ctx)) {
            logDetail(`  "${charDef.name}" excluded by filter`);
            continue;
          }
          logDetail(`  tapping "${charDef.name}"`);
          current = updatePlayer(current, activeIndex, p =>
            updateCharacter(p, charId, c => ({ ...c, status: CardStatus.Tapped })),
          );
        }
      }
    }
  }

  // Seized by Terror: hazard short event targeting a character. Enqueue a
  // pending resolution so the character's player rolls 2d6 + mind.
  if (entry.payload.type === 'short-event'
    && entry.payload.targetCharacterId
    && !entry.negated
    && entry.card) {
    const cardDef = defById(current, entry.card.definitionId);
    const sbtEffect = getCardEffects(cardDef).find(
      (e): e is import('../index.js').SeizedByTerrorCheckEffect => e.type === 'seized-by-terror-check',
    );
    if (sbtEffect) {
      const resourcePlayerId = current.activePlayer!;
      const activeIndex = getPlayerIndex(current, resourcePlayerId);
      const mhState = current.phaseState as import('../index.js').MovementHazardPhaseState;
      const company = current.players[activeIndex].companies[mhState.activeCompanyIndex] ?? null;
      const originSiteInstanceId = company?.currentSite?.instanceId ?? null;
      logDetail(`Enqueuing seized-by-terror-roll pending resolution for character ${entry.payload.targetCharacterId as string}`);
      current = enqueueResolution(current, {
        source: entry.card.instanceId,
        actor: resourcePlayerId,
        scope: { kind: 'phase-step', phase: Phase.MovementHazard, step: 'play-hazards' },
        kind: {
          type: 'seized-by-terror-roll',
          targetCharacterId: entry.payload.targetCharacterId,
          hazardDefinitionId: entry.card.definitionId,
          threshold: sbtEffect.threshold,
          originSiteInstanceId: originSiteInstanceId ?? ('' as import('../index.js').CardInstanceId),
        },
      });
      return { state: current, needsInput: true };
    }
  }

  // Hazard short events declaring play-option modes (e.g. Weariness of the
  // Heart le-149): the hazard player chose one mutually-exclusive option at
  // play time, carried on the chain entry as `optionId`. Dispatch the chosen
  // option's `apply` clause now that the entry resolved un-negated.
  if (entry.payload.type === 'short-event'
    && entry.payload.targetCharacterId
    && entry.payload.optionId
    && !entry.negated
    && entry.card) {
    const targetCharId = entry.payload.targetCharacterId;
    const optionId = entry.payload.optionId;
    const cardDef = defById(current, entry.card.definitionId);
    const cardNm = cardDef?.name ?? '';
    const opt = getCardEffects(cardDef).find(
      (e): e is import('../types/effects.js').PlayOptionEffect =>
        e.type === 'play-option' && e.id === optionId,
    );
    if (opt) {
      const apply = opt.apply;
      if (apply.type === 'add-constraint'
        && apply.constraint === 'character-stat-modifier'
        && (apply.stat === 'prowess' || apply.stat === 'body' || apply.stat === 'direct-influence')
        && typeof apply.value === 'number') {
        logDetail(`${cardNm} option "${opt.id}": character-stat-modifier ${apply.stat} ${apply.value > 0 ? '+' : ''}${apply.value} on ${targetCharId as string} (scope turn)`);
        current = addConstraint(current, {
          source: entry.card.instanceId,
          sourceDefinitionId: entry.card.definitionId,
          scope: { kind: 'turn' },
          target: { kind: 'character', characterId: targetCharId },
          kind: { type: 'character-stat-modifier', stat: apply.stat, value: apply.value, characterId: targetCharId },
        });
      } else if (apply.type === 'force-check' && apply.check === 'corruption') {
        const resourcePlayerId = current.activePlayer!;
        const possessions = characterPossessionsById(current, targetCharId);
        logDetail(`${cardNm} option "${opt.id}": enqueuing corruption check (modifier ${apply.modifier ?? 0}) for character ${targetCharId as string}`);
        current = enqueueCorruptionCheck(current, {
          source: entry.card.instanceId,
          actor: resourcePlayerId,
          scope: { kind: 'phase', phase: Phase.MovementHazard },
          characterId: targetCharId,
          reason: cardNm,
          modifier: apply.modifier ?? 0,
          possessions,
        });
      } else if (apply.type === 'add-constraint'
        && apply.constraint === 'check-modifier'
        && typeof apply.check === 'string') {
        // Influence-check-boost short events (e.g. Tempering Friendship
        // tw-337) route through the chain (see handlePlayResourceShortEvent)
        // so the opponent can respond before the boost resolves. Add the
        // `check-modifier` constraint on the targeted character now that the
        // entry resolved un-negated; the pending influence roll consumes it.
        // The spent event card rode the chain entry from the player's hand, so
        // dispose it to their discard pile here (unlike hazard short events,
        // which are pre-discarded at play time).
        const charPlayerIdx = current.players.findIndex(p => targetCharId as string in p.characters);
        let constraintValue: number | undefined;
        if (typeof apply.value === 'number') {
          constraintValue = apply.value;
        } else if (typeof apply.valueExpr === 'string') {
          const charInPlay = charPlayerIdx >= 0 ? current.players[charPlayerIdx].characters[targetCharId] : undefined;
          const charDef = charInPlay ? defById(current, charInPlay.definitionId) : undefined;
          const baseProwess = charDef && isCharacterCard(charDef) ? charDef.prowess : 0;
          const targetCompany = charPlayerIdx >= 0
            ? findCharacterCompany(current.players[charPlayerIdx].companies, targetCharId)
            : undefined;
          const characterCount = targetCompany?.characters.length ?? 1;
          constraintValue = Math.round(evaluateExpr(apply.valueExpr, { target: { baseProwess }, company: { characterCount } }));
        } else if (apply.prowessSubstitution) {
          // Threats (le-244): resolution-time prowess substitution — no baked
          // value; the influence check computes the modifier when it consumes
          // the constraint.
          constraintValue = 0;
        }
        const scope = parseConstraintScope(apply.scope ?? 'until-cleared', null);
        if (constraintValue !== undefined && scope) {
          logDetail(`${cardNm} option "${opt.id}": check-modifier ${apply.check} ${constraintValue >= 0 ? '+' : ''}${constraintValue} on ${targetCharId as string} (scope ${apply.scope ?? 'until-cleared'})`);
          current = addConstraint(current, {
            source: entry.card.instanceId,
            sourceDefinitionId: entry.card.definitionId,
            scope,
            target: { kind: 'character', characterId: targetCharId },
            kind: {
              type: 'check-modifier',
              check: apply.check,
              value: constraintValue,
              // Carry the optional target-gating condition so an opponent-influence
              // booster (Mine or No One's ba-68) fires only on a matching attempt.
              ...(apply.constraintWhen ? { when: apply.constraintWhen } : {}),
              // Carry the failure fate for the boosted faction (The Dark Power
              // as-79: failed check → shuffle the faction into the play deck).
              ...(apply.onFailure ? { onFailure: apply.onFailure } : {}),
              // Carry the success bonus (Lordly Presence tw-267: successful
              // check → draw a card).
              ...(apply.onSuccess ? { onSuccess: apply.onSuccess } : {}),
              // Carry the prowess substitution (Threats le-244: unused DI
              // replaced by min(effective prowess, max) at resolution).
              ...(apply.prowessSubstitution ? { prowessSubstitution: apply.prowessSubstitution } : {}),
            },
          });
        } else {
          logDetail(`${cardNm} option "${opt.id}": check-modifier could not resolve value/scope — fizzle`);
        }
        const declaringIndex = getPlayerIndex(current, entry.declaredBy);
        current = updatePlayer(current, declaringIndex, p => ({
          ...p,
          discardPile: [...p.discardPile, toCardInstance(entry.card!)],
        }));
      } else if (apply.type === 'set-character-status' && apply.status !== undefined) {
        // set-character-status play-options (And Forth He Hastened td-98,
        // Halfling Strength's untap/heal tw-253, Above the Abyss as-77,
        // Angband Revisited ba-49) route through the chain (see
        // handlePlayResourceShortEvent) so the opponent can respond before
        // the status change resolves. Apply the status change now that the
        // entry resolved un-negated, then dispose the spent event card to
        // the declaring player's discard pile — it rode the chain entry from
        // their hand.
        const statusEnum = cardStatusFromName(apply.status);
        const charPlayerIdx = current.players.findIndex(p => targetCharId as string in p.characters);
        if (charPlayerIdx >= 0) {
          const targetChar = current.players[charPlayerIdx].characters[targetCharId];
          const isHeal = targetChar.status === CardStatus.Inverted && statusEnum !== CardStatus.Inverted;
          // Fireworks (dm-130) / Fled into Darkness (ba-18): "the next time
          // the character would otherwise become untapped, make him tapped
          // instead and discard this card." That one-shot constraint must
          // intercept ANY untap attempt on the character, not just the
          // untap-phase sweep — a resource short event like And Forth He
          // Hastened (td-98) untapping the character directly must honor it
          // too, or the constraint silently leaks the character untapped
          // without ever discarding its source card.
          const isUntapAttempt = statusEnum === CardStatus.Untapped && targetChar.status !== CardStatus.Untapped;
          const skipResult = isUntapAttempt ? interceptSkipNextUntap(current, targetCharId) : { state: current, intercepted: false };
          current = skipResult.state;
          if (skipResult.intercepted) {
            logDetail(`${cardNm} option "${opt.id}": skip-next-untap active on ${targetCharId as string} — stays tapped instead of untapping, constraint's source card discarded`);
          } else {
            logDetail(`${cardNm} option "${opt.id}": set ${targetCharId as string} status → ${apply.status}`);
            current = updatePlayer(current, charPlayerIdx, p =>
              updateCharacter(p, targetCharId as string, c => ({ ...c, status: statusEnum })));

            // healing-affects-all — if this was a heal (wounded → well), extend
            // the healing to all other wounded characters in the same company.
            // Triggers either from a character in the company carrying the
            // `healing-affects-all` play-flag (e.g. Ioreth) or from the
            // company's current site carrying the `site-rule` variant (e.g.
            // Rhosgobel, Old Forest).
            if (isHeal) {
              const company = findCharacterCompany(current.players[charPlayerIdx].companies, targetCharId);
              if (company) {
                const hasCompanyFlag = company.characters.some(charId => {
                  const ch = current.players[charPlayerIdx].characters[charId];
                  if (!ch) return false;
                  const charDef = defById(current, ch.definitionId);
                  return hasPlayFlag(charDef as { effects?: readonly import('../types/effects.js').CardEffect[] }, 'healing-affects-all');
                });
                let hasSiteRule = false;
                if (company.currentSite) {
                  const siteDef = defById(current, company.currentSite.definitionId);
                  hasSiteRule = !!(siteDef && 'effects' in siteDef &&
                    (siteDef as { effects?: readonly import('../types/effects.js').CardEffect[] }).effects?.some(
                      e => e.type === 'site-rule' && e.rule === 'healing-affects-all',
                    ));
                }
                if (hasCompanyFlag || hasSiteRule) {
                  const source = hasCompanyFlag ? 'play-flag' : 'site-rule';
                  for (const charId of company.characters) {
                    if (charId === targetCharId) continue;
                    const ch = current.players[charPlayerIdx].characters[charId];
                    if (ch && ch.status === CardStatus.Inverted) {
                      logDetail(`${source} healing-affects-all: extending heal to ${charId as string}`);
                      current = updatePlayer(current, charPlayerIdx, p =>
                        updateCharacter(p, charId as string, c => ({ ...c, status: statusEnum })));
                    }
                  }
                }
              }
            }
          }
        }
        const declaringIndex = getPlayerIndex(current, entry.declaredBy);
        current = updatePlayer(current, declaringIndex, p => ({
          ...p,
          discardPile: [...p.discardPile, toCardInstance(entry.card!)],
        }));
      }
    }
  }

  // Hazard short events declaring an **untargeted** play-option mode (Echoes of
  // the Song wh-17 mode A): the option was chosen at play time and rides the
  // chain entry as `optionId` with no `targetCharacterId`. Dispatch its `apply`
  // now that the entry resolved un-negated.
  if (entry.payload.type === 'short-event'
    && !entry.payload.targetCharacterId
    && entry.payload.optionId
    && !entry.negated
    && entry.card) {
    const cardDef = defById(current, entry.card.definitionId);
    const cardNm = cardDef?.name ?? '';
    const untargetedOptionId = entry.payload.optionId;
    const opt = getCardEffects(cardDef).find(
      (e): e is import('../types/effects.js').PlayOptionEffect =>
        e.type === 'play-option' && e.id === untargetedOptionId && !!e.untargeted,
    );
    if (opt?.apply.type === 'force-discard-stage-card') {
      // "he must discard one stage card of his choice" — the opponent (the
      // resource player this hazard was played against) picks, so raise a
      // `force-discard-card` pending resolution actored by them with every
      // Stage card they have in play as a candidate.
      const opponentId = opponent(current, entry.declaredBy);
      const opponentIdx = getPlayerIndex(current, opponentId);
      const candidates = stageCardsHeld(current, current.players[opponentIdx]);
      if (candidates.length === 0) {
        logDetail(`${cardNm} option "${opt.id}": ${current.players[opponentIdx].name} has no stage card in play — fizzle`);
      } else {
        logDetail(`${cardNm} option "${opt.id}": ${current.players[opponentIdx].name} must discard one of ${candidates.length} stage card(s) in play`);
        current = enqueueResolution(current, {
          source: entry.card.instanceId,
          actor: opponentId,
          scope: { kind: 'phase', phase: current.phaseState.phase },
          kind: {
            type: 'force-discard-card',
            candidateInstanceIds: candidates,
            sourceDefinitionId: entry.card.definitionId,
          },
        });
      }
    } else if (opt?.apply.type === 'move') {
      // An untargeted option whose apply is a plain `move` on one declared card
      // instance (Returned Beyond All Hope as-35 modes 1 and 2: a creature from
      // the player's own discard pile, or a Maia permanent-event from their own
      // cards in play, back to their hand). The instance was named at play time
      // and rides the chain payload; the move primitive does the rest, routing
      // the card to its owner's hand (`toOwner: 'source-owner'`).
      const optTargetId = entry.payload.optionTargetInstanceId;
      if (!optTargetId) {
        logDetail(`${cardNm} option "${opt.id}": no target instance declared — fizzle`);
      } else {
        const declaringIdx = getPlayerIndex(current, entry.declaredBy);
        const moved = applyMove(current, opt.apply, {
          sourceCardId: entry.card.instanceId,
          sourcePlayerIndex: declaringIdx,
          targetCardId: optTargetId,
        });
        if ('error' in moved) {
          logDetail(`${cardNm} option "${opt.id}": move failed (${moved.error}) — fizzle`);
        } else {
          logDetail(`${cardNm} option "${opt.id}": moved ${optTargetId as string} → ${opt.apply.to}`);
          current = moved.state;
        }
      }
    }
  }

  // Hazard short events with play-target cost: corruption check (e.g. Dragon-sickness).
  // When the chain entry resolves, enqueue a corruption check on the targeted character.
  if (entry.payload.type === 'short-event'
    && entry.payload.targetCharacterId
    && !entry.negated
    && entry.card) {
    const cardDef = defById(current, entry.card.definitionId);
    const playTargetWithCostCorruption = getCardEffects(cardDef).find(
      (e): e is PlayTargetEffect => e.type === 'play-target' && (e).cost?.check === 'corruption',
    );
    if (playTargetWithCostCorruption) {
      const targetCharId = entry.payload.targetCharacterId;
      const modifier = playTargetWithCostCorruption.cost?.modifier ?? 0;
      const resourcePlayerId = current.activePlayer!;
      const possessions = characterPossessionsById(current, targetCharId);
      const cardName = cardDef?.name ?? '';
      const failureMode = playTargetWithCostCorruption.cost?.failureMode;
      logDetail(`${cardName}: enqueuing corruption check (modifier ${modifier}${failureMode ? `, failureMode: ${failureMode}` : ''}) for character ${targetCharId as string}`);
      current = enqueueCorruptionCheck(current, {
        source: entry.card.instanceId,
        actor: resourcePlayerId,
        scope: { kind: 'phase', phase: Phase.MovementHazard },
        characterId: targetCharId,
        reason: cardName,
        modifier,
        possessions,
        failureMode,
      });
    }
  }

  if (entry.payload.type === 'creature' && entry.card) {
    current = initiateCreatureCombat(current, entry);
  }

  if (entry.payload.type === 'permanent-event' && !entry.negated && entry.card) {
    // A card played in a permanent-event `play-option` mode whose apply is
    // `un-eliminate-creature` (Returned Beyond All Hope as-35 mode 3) resolves
    // entirely here — like dm-73 it never enters `cardsInPlay`, so the normal
    // permanent-event placement must be skipped.
    const permOptionId = entry.payload.optionId;
    const permOption = permOptionId
      ? getCardEffects(defById(current, entry.card.definitionId)).find(
          (e): e is import('../types/effects.js').PlayOptionEffect =>
            e.type === 'play-option' && e.id === permOptionId,
        )
      : undefined;
    if (permOption?.apply.type === 'un-eliminate-creature') {
      const result = resolveUnEliminateCreature(current, entry, permOption.apply);
      current = result.state;
      resolveEffects.push(result.effect);
    } else {
      current = resolvePermanentEvent(current, entry);
      current = sweepAutoDiscardResourceEvents(current);
    }
  }

  // Great Secrets Buried There (dm-63): once the host permanent-event enters
  // play (above), reveal the top N cards of the active player's play deck
  // (the deck owner — see PlayConditionEffect.minDeckSize doc for why
  // activePlayer is always correct regardless of hazard-mode vs.
  // playable-as-resource self-cast). At least one eligible item enqueues a
  // choice; none means the reveal alone showed the cards and they are all
  // shuffled back immediately.
  if (entry.payload.type === 'permanent-event' && !entry.negated && entry.card) {
    const hostDef = defById(current, entry.card.definitionId);
    const revealEff = getCardEffects(hostDef).find(
      (e): e is import('../types/effects.js').RevealDeckChooseSetAsideEffect =>
        e.type === 'reveal-deck-choose-set-aside',
    );
    if (revealEff) {
      const hostName = (hostDef as { name?: string } | undefined)?.name ?? (entry.card.definitionId as string);
      const deckOwnerId = current.activePlayer!;
      const deckOwnerIdx = getPlayerIndex(current, deckOwnerId);
      const deckOwnerName = current.players[deckOwnerIdx].name;
      const deck = current.players[deckOwnerIdx].playDeck;
      const revealCount = Math.min(revealEff.count, deck.length);
      logDetail(`${hostName}: revealing ${revealCount} card(s) from the top of ${deckOwnerName}'s play deck (deck ${deck.length})`);
      if (revealCount === 0) {
        logDetail(`${hostName}: play deck is empty — nothing to reveal`);
      } else {
        const revealed = deck.slice(0, revealCount);
        current = revealInstances(current, revealed);
        const eligible = revealed.filter(c => {
          const d = defById(current, c.definitionId);
          return d && matchesCondition(revealEff.itemFilter, d as unknown as Record<string, unknown>);
        });
        if (eligible.length > 0) {
          logDetail(`${hostName}: ${eligible.length} eligible item(s) revealed — ${deckOwnerName} must choose one to set aside`);
          current = enqueueResolution(current, {
            source: entry.card.instanceId,
            actor: deckOwnerId,
            scope: { kind: 'phase', phase: current.phaseState.phase },
            kind: {
              type: 'great-secrets-choose-item',
              revealedInstanceIds: revealed.map(c => c.instanceId),
              eligibleInstanceIds: eligible.map(c => c.instanceId),
              deckOwnerId,
              hostInstanceId: entry.card.instanceId,
            },
          });
        } else {
          logDetail(`${hostName}: no eligible item among the revealed cards — shuffling all ${revealed.length} back on top`);
          const rest = deck.slice(revealCount);
          const [shuffled, nextRng] = shuffle(revealed, current.rng);
          current = { ...current, rng: nextRng };
          current = updatePlayer(current, deckOwnerIdx, p => ({ ...p, playDeck: [...shuffled, ...rest] }));
        }
      }
    }
  }

  if (entry.payload.type === 'long-event' && !entry.negated && entry.card) {
    current = resolveLongEvent(current, entry);
  }

  // Influence attempt: enqueue a pending resolution so the UI can display
  // the situation banner (target number, DI, modifiers) before the roll.
  // Do NOT mark the entry resolved — leave it on the chain (card and all)
  // so `buildInstanceLookup` can still find the faction while the player
  // confirms the roll. The pending faction-influence-roll resolver will
  // mark the entry resolved and re-enter auto-resolution after the roll.
  if (entry.payload.type === 'influence-attempt' && !entry.negated && entry.card) {
    logDetail(`Enqueuing faction-influence-roll pending resolution for ${entry.card.definitionId as string}`);
    current = enqueueResolution(current, {
      source: entry.card.instanceId,
      actor: entry.declaredBy,
      scope: { kind: 'phase-step', phase: Phase.Site, step: 'play-resources' },
      kind: {
        type: 'faction-influence-roll',
        factionInstanceId: entry.card.instanceId,
        factionDefinitionId: entry.card.definitionId,
        influencingCharacterId: entry.payload.influencingCharacterId,
        placeUnderLeaderControl: entry.payload.placeUnderLeaderControl,
        bonusModifier: entry.payload.bonusModifier,
      },
    });
    return { state: current, needsInput: true };
  }

  // Mark entry as resolved
  const resolvedChain = current.chain!;
  const newEntries = resolvedChain.entries.map((e, i) =>
    i === entryIndex ? { ...e, resolved: true } : e,
  );

  // Scan for passive conditions triggered by this resolution
  const triggeredPassives = detectTriggeredPassives(current, entry);
  const newDeferredPassives = triggeredPassives.length > 0
    ? [...resolvedChain.deferredPassives, ...triggeredPassives]
    : resolvedChain.deferredPassives;

  if (triggeredPassives.length > 0) {
    logDetail(`${triggeredPassives.length} passive condition(s) triggered — deferred for follow-up chain`);
  }

  const newChain: ChainState = {
    ...resolvedChain,
    entries: newEntries,
    deferredPassives: newDeferredPassives,
  };

  return {
    state: { ...current, chain: newChain },
    needsInput: false,
    ...(resolveEffects.length > 0 ? { effects: resolveEffects } : {}),
  };
}

/**
 * Scans in-play cards for `on-event` effects triggered by the given
 * resolved entry. Triggered passives are queued for a follow-up chain
 * rather than added to the current chain (CoE rules 678-680).
 *
 * Currently matches on the `event` string of `on-event` effects against
 * the resolved entry's payload type. More sophisticated matching
 * (specific card targets, conditions) will be added as cards require it.
 */
function detectTriggeredPassives(state: GameState, resolvedEntry: ChainEntry): DeferredPassive[] {
  const passives: DeferredPassive[] = [];

  // Scan all in-play cards for on-event triggers
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const def = defById(state, card.definitionId);
      if (!def) continue;
      for (const effect of getCardEffects(def)) {
        if (effect.type !== 'on-event') continue;

        // Match the event trigger against what just resolved
        if (matchesTrigger(effect.event, resolvedEntry)) {
          logDetail(`Passive triggered: "${def.name}" on-event "${effect.event}"`);
          passives.push({
            sourceCardId: card.instanceId,
            trigger: effect.event,
            payload: { type: 'passive-condition', trigger: effect.event },
          });
        }
      }
    }
  }

  return passives;
}

/**
 * Checks whether a resolved chain entry matches an `on-event` trigger string.
 *
 * Current trigger matching is basic — it maps known trigger strings to
 * entry payload types. As more cards define triggers, this will be extended
 * to support conditions on specific targets, card types, etc.
 */
function matchesTrigger(event: string, _entry: ChainEntry): boolean {
  // Map well-known trigger events to entry conditions
  switch (event) {
    case 'character-wounded-by-self':
      // Fires when a creature's strike wounds a character — requires combat resolution
      // which is not yet on the chain, so this won't match during chain resolution yet
      return false;
    default:
      // Unknown trigger — no match
      return false;
  }
}

/**
 * Completes the current chain and cleans up.
 *
 * If deferred passives were queued during resolution, creates a follow-up
 * chain for them. If this was a nested chain (e.g. on-guard interrupt),
 * restores the parent chain. Otherwise sets `state.chain` to null.
 */
function completeChain(state: GameState): GameState {
  const chain = state.chain!;
  logHeading(`Chain complete — ${chain.entries.length} entries resolved`);

  // Flush negated entries: cards still on the chain go to their declaring player's discard.
  // A card already sitting in a discard pile (short events are discarded at play
  // time; some cancel paths route the card themselves) is skipped — flushing it
  // again would duplicate the instance.
  let current = state;
  for (const entry of chain.entries) {
    if (entry.negated && entry.card) {
      const instanceId = entry.card.instanceId;
      const alreadyDiscarded = current.players.some(p =>
        p.discardPile.some(c => c.instanceId === instanceId),
      );
      if (alreadyDiscarded) {
        logDetail(`Negated card ${instanceId as string} already in a discard pile — not flushing again`);
        continue;
      }
      const playerIndex = getPlayerIndex(current, entry.declaredBy);
      const player = current.players[playerIndex];
      const def = defById(current, entry.card.definitionId);
      logDetail(`Flushing negated card "${def?.name ?? entry.card.definitionId}" to player ${entry.declaredBy as string} discard`);
      const newPlayers: [PlayerState, PlayerState] = [current.players[0], current.players[1]];
      newPlayers[playerIndex] = {
        ...player,
        discardPile: [...player.discardPile, toCardInstance(entry.card)],
      };
      current = { ...current, players: newPlayers };
    }
  }

  // If deferred passives were triggered, create a follow-up chain
  if (chain.deferredPassives.length > 0) {
    logDetail(`${chain.deferredPassives.length} deferred passive(s) — creating follow-up chain`);
    return createFollowUpChain(current, chain);
  }

  // Restore parent chain if this was a nested sub-chain
  if (chain.parentChain) {
    logDetail(`Restoring parent chain`);
    return { ...current, chain: chain.parentChain };
  }

  // Chain fully complete — clear it
  logDetail(`No parent chain — clearing chain state`);
  return { ...current, chain: null };
}

/**
 * Creates a follow-up chain from deferred passive conditions.
 *
 * When a single passive is deferred, it becomes the sole entry in the new chain.
 * When multiple passives are deferred, the resource player must choose the
 * declaration order (via the `order-passives` action) before the chain starts.
 * For now, if there's only one passive, it auto-declares; otherwise the chain
 * is created with all passives declared in the order they were queued.
 */
function createFollowUpChain(state: GameState, completedChain: ChainState): GameState {
  const passives = completedChain.deferredPassives;
  const parentChain = completedChain.parentChain;

  // Determine the resource player (active player initiates follow-up chains, CoE rule 673)
  const resourcePlayer = state.activePlayer!;

  // Create entries from deferred passives
  const entries: ChainEntry[] = passives.map((passive, index) => ({
    index,
    declaredBy: resourcePlayer,
    card: null, // Passive conditions don't move a card onto the chain — source card stays in play
    payload: passive.payload,
    resolved: false,
    negated: false,
  }));

  logDetail(`Follow-up chain with ${entries.length} passive condition(s)`);

  const followUpChain: ChainState = {
    mode: 'declaring',
    entries,
    priority: opponent(state, resourcePlayer),
    priorityPlayerPassed: false,
    nonPriorityPlayerPassed: false,
    deferredPassives: [],
    parentChain,
    restriction: 'normal',
  };

  return { ...state, chain: followUpChain };
}
