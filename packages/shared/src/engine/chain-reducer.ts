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

import type { GameState, GameAction, PlayerId, PlayerState, CardInstance, CardInstanceId, CardDefinitionId, ChainState, ChainEntry, ChainEntryPayload, ChainRestriction, DeferredPassive, CombatState, CreatureCard, PendingEffect, CancelReturnToOriginAction } from '../index.js';
import type { HavenJumpOffer, PostAttackEffect } from '../types/state-combat.js';
import type { OnEventEffect, PlayTargetEffect, TriggerAttackOnPlayEffect, ForceCheckAllCompanyTopEffect, FlatteryCancelAttackEffect, TapSitesInPlayEffect } from '../types/effects.js';
import { matchesCondition } from '../effects/condition-matcher.js';
import { hasPlayFlag } from '../effects/play-flags.js';
import { getPlayerIndex, isMinionOrBalrog } from '../state-utils.js';
import { isSiteCard, isAvatarCharacter, isAllyCard, isCharacterCard } from '../types/cards.js';
import { CardStatus, SiteType, Race, RegionType } from '../types/common.js';
import { resolveInstanceId } from '../types/state.js';
import { formatSignedNumber } from '../format-helpers.js';
import { logHeading, logDetail } from './legal-actions/log.js';
import { applyMove, moveToFetchToDeckPayload } from './reducer-move.js';
import { availableDI } from './legal-actions/organization.js';
import type { ReducerResult } from './reducer.js';
import { resolveAttackProwess, resolveAttackStrikes, resolveAttackBody, isWardedAgainst, normalizeCreatureRace, resolveDef, resolveHandSize } from './effects/index.js';
import { buildInPlayNames } from './recompute-derived.js';
import { siteAttacksCanceled } from './effective.js';
import { allyEffectiveMind, allyEffectiveProwess } from './ally-stats.js';
import { addConstraint, enqueueResolution, enqueueCorruptionCheck } from './pending.js';
import { Phase } from '../types/state-phases.js';
import { currentHazardLimit } from './hazard-limit.js';
import { makeCombatState, companySubphaseScope, countSpawnCardsInPlay, defById, findById, findCharacterCompany, getCardEffects, getOnEventEffects, hazardPlayer, isCardNameInPlayOrCharacters, isHavenForPlayer, matchesDefinition, playerById, playerConvertsDetainmentToNormal, purgeCompanyAlliesAndFollowers, sweepAutoDiscardResourceEvents, toCardInstance, updateCharacter, updatePlayer, wrongActionType, effectiveGeneralInfluence, buildTargetCompanyConditionContext } from './reducer-utils.js';
import { evaluateExpr } from './effects/expression-eval.js';
import { applyEffect, buildChainApplyContext, shouldFireOnChainResolution } from './apply-dispatcher.js';
import { buildConstraintKind, parseConstraintScope } from './constraint-kind.js';
import { applyCost } from './cost-evaluator.js';
import { isDetainmentAttack, defenderAlignmentLabel } from './detainment.js';
import { isReduceAttacksToOneInPlay, getActiveAutoAttacks } from './manifestations.js';
import { resolveWinConditionRoll } from './reducer-win-conditions.js';
import { revealInstances } from './visibility.js';
import { findRevealAndAttackEffect, kickoffGreatHunt } from './great-hunt.js';
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
 * @returns New game state with chain active.
 */
export function initiateChain(
  state: GameState,
  declaredBy: PlayerId,
  card: CardInstance | null,
  payload: ChainEntryPayload,
  restriction: ChainRestriction = 'normal',
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
 * @returns New game state with entry added and priority flipped.
 */
export function pushChainEntry(
  state: GameState,
  declaredBy: PlayerId,
  card: CardInstance | null,
  payload: ChainEntryPayload,
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
): GameState {
  return state.chain === null
    ? initiateChain(state, declaredBy, card, payload)
    : pushChainEntry(state, declaredBy, card, payload);
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

  // Push as chain entry
  const isPermanent = def && 'eventType' in def && (def as { eventType?: string }).eventType === 'permanent';
  const payload: ChainEntryPayload = isPermanent
    ? { type: 'permanent-event' as const, targetCharacterId: action.targetCharacterId }
    : { type: 'short-event' as const };
  const cardInstance: CardInstance = toCardInstance(revealedCard);
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
  if (scopeName === 'until-cleared' && opts.untilClearedPlayerId) {
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
    newState = applyAddConstraintFromOnEvent(newState, entry, onEvent, cardName);
  }
  return newState;
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
  for (const effect of getCardEffects(def)) {
    if (effect.type !== 'move') continue;
    const payload = moveToFetchToDeckPayload(effect);
    if (!payload) continue;
    if (effect.when && !matchesCondition(effect.when, ctx)) {
      logDetail(`${def.name}: fetch-to-deck skipped — condition not met`);
      continue;
    }
    fetchEffects.push({
      type: 'card-effect',
      cardInstanceId: card.instanceId,
      effect: payload,
      actor: entry.declaredBy,
    });
  }

  if (fetchEffects.length === 0) return state;

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

  logDetail(`Permanent event resolves: "${def?.name ?? card.definitionId}" enters play for player ${entry.declaredBy as string}`);

  // Place the resolving card via the move primitive. The card lives only on
  // the chain entry (removed from hand at declaration), so every destination
  // sources it with `from: 'chain'` (ctx.chainCard, no-op removal).
  const targetCharId = entry.payload.type === 'permanent-event' ? entry.payload.targetCharacterId : undefined;
  const targetItemId = entry.payload.type === 'permanent-event' ? entry.payload.targetItemInstanceId : undefined;
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

  // no-direct-influence flag — revert DI to GI on attach.
  // Per CoE 2.II.2.2.3, a follower removed from direct-influence control outside
  // an organization phase does NOT have its mind immediately subtracted from its
  // player's general influence — that is deferred to the player's next
  // organization phase. Rebel-talk is a hazard, so it always resolves during the
  // opponent's movement/hazard phase (never the bearer's org phase); mark the
  // character with `influenceUnsubtracted` so {@link recomputeDerived} skips its
  // mind until the flag is cleared at the start of the next organization phase.
  if (targetCharId && hasPlayFlag(def as { effects?: readonly import('../types/effects.js').CardEffect[] }, 'no-direct-influence')) {
    const deferSubtraction = state.phaseState.phase !== Phase.Organization;
    for (let pi = 0; pi < 2; pi++) {
      const char = newPlayers[pi].characters[targetCharId];
      if (char && char.controlledBy !== 'general') {
        logDetail(
          `"${def?.name ?? '?'}" forces ${targetCharId as string} from DI to GI`
          + (deferSubtraction ? ' (mind subtraction deferred to next organization phase — CoE 2.II.2.2.3)' : ''),
        );
        const oldControllerId = char.controlledBy;
        const oldCtrl = newPlayers[pi].characters[oldControllerId];
        if (oldCtrl) {
          newPlayers[pi] = {
            ...newPlayers[pi],
            characters: {
              ...newPlayers[pi].characters,
              [targetCharId as string]: {
                ...char,
                controlledBy: 'general',
                ...(deferSubtraction ? { influenceUnsubtracted: true } : {}),
              },
              [oldControllerId as string]: {
                ...oldCtrl,
                followers: oldCtrl.followers.filter(id => id !== targetCharId),
              },
            },
          };
        }
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
  if (hasPlayFlag(def as { effects?: readonly import('../types/effects.js').CardEffect[] }, 'tap-site-on-play')) {
    const ps = newState.phaseState as { activeCompanyIndex?: number };
    const activeCompanyIndex = ps.activeCompanyIndex ?? 0;
    const company = newState.players[playerIndex].companies[activeCompanyIndex];
    const siteInPlay = company?.currentSite;
    if (siteInPlay && siteInPlay.status !== CardStatus.Tapped) {
      const siteDef = defById(newState, siteInPlay.definitionId);
      const neverTaps = siteDef && isSiteCard(siteDef)
        && (siteDef.effects ?? []).some(e => e.type === 'site-rule' && e.rule === 'never-taps');
      if (neverTaps) {
        logDetail(`"${def?.name ?? '?'}" tap-site-on-play: site has never-taps — leaving site untapped`);
      } else {
        logDetail(`"${def?.name ?? '?'}" tap-site-on-play: tapping site ${siteInPlay.definitionId as string}`);
        const newCompanies = [...newState.players[playerIndex].companies];
        newCompanies[activeCompanyIndex] = {
          ...company,
          currentSite: { ...siteInPlay, status: CardStatus.Tapped },
        };
        newState = updatePlayer(newState, playerIndex, p => ({ ...p, companies: newCompanies }));
      }
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
        const activePlayer = newState.activePlayer ?? entry.declaredBy;
        newState = enqueueResolution(newState, {
          source: card.instanceId,
          actor: activePlayer,
          scope: { kind: 'phase', phase: newState.phaseState.phase },
          kind: {
            type: 'resource-play-offer',
            linkToInstanceId: card.instanceId,
          },
        });
        logDetail(`"${def?.name ?? card.definitionId as string}" entered play — queued resource-play-offer for player ${activePlayer as string}`);
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
      } else if (effect.apply.type === 'enqueue-corruption-check') {
        // For permanent events, determine which character receives the corruption check.
        // When apply.target === "company-shadow-magic-user", find the non-Ringwraith shadow-magic
        // user in the target character's company; Ringwraiths are exempt from the check.
        // Without a target specifier, target the attached character (targetCharId).
        const applyTarget = effect.apply.target;
        let corrCheckCharId: import('../types/common.js').CardInstanceId | undefined;
        if (applyTarget === 'company-shadow-magic-user' && targetCharId) {
          outer: for (let pi = 0; pi < 2; pi++) {
            if (!newState.players[pi].characters[targetCharId]) continue;
            const company = newState.players[pi].companies.find(co => co.characters.includes(targetCharId));
            if (!company) break;
            for (const memberId of company.characters) {
              const memberChar = newState.players[pi].characters[memberId];
              if (!memberChar) continue;
              const memberDef = defById(newState, memberChar.definitionId);
              if (!memberDef) continue;
              const memberRace = (memberDef as { race?: string }).race;
              if (memberRace === 'ringwraith') continue; // ringwraiths don't make the check
              const memberSkills = (memberDef as { skills?: readonly string[] }).skills ?? [];
              if (memberSkills.includes('shadow-magic')) {
                corrCheckCharId = memberId;
                break outer;
              }
            }
            // No non-ringwraith shadow-magic user found (all shadow-magic users are ringwraiths)
            logDetail(`"${def?.name ?? '?'}" enqueue-corruption-check: shadow-magic user is a Ringwraith — no check`);
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
      }
  }

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
        const firstAttack = triggerEffect.attacks?.length
          ? triggerEffect.attacks[0]
          : { creatureType: triggerEffect.creatureType!, strikes: triggerEffect.strikes!, prowess: triggerEffect.prowess! };
        const remaining = triggerEffect.attacks?.length ? triggerEffect.attacks.slice(1) : [];

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

  return newState;
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
  // target the resolved company.
  const r = addDeclaredConstraint(state, entry.card!, effect, constraintKind, scopeName, companyId, {
    boundSiteDefId,
    untilClearedPlayerId: activePlayer ?? undefined,
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
 * Per CoE rule 2.IV.iii.1, if the hazard limit has been decreased after
 * declaration (e.g. by Many Turns and Doublings) such that the number of
 * hazards played now exceeds the current limit at resolution, the long-event
 * fizzles — it is discarded without entering play.
 */
function resolveLongEvent(state: GameState, entry: ChainEntry): GameState {
  const card = entry.card!;
  const def = defById(state, card.definitionId);
  const playerIndex = getPlayerIndex(state, entry.declaredBy);

  // CoE rule 2.IV.iii.1: hazard limit active condition — check at resolution.
  if (state.phaseState.phase === Phase.MovementHazard) {
    const mhState = state.phaseState;
    const activePlayerIndex = state.players.findIndex(p => p.id === state.activePlayer);
    const company = activePlayerIndex >= 0
      ? state.players[activePlayerIndex].companies[mhState.activeCompanyIndex]
      : undefined;
    if (company) {
      const limit = currentHazardLimit(state, mhState, company.id);
      if (mhState.hazardsPlayedThisCompany > limit) {
        logDetail(`Long event "${def?.name ?? card.definitionId}" fizzles — hazard limit exceeded at resolution (${mhState.hazardsPlayedThisCompany} declared > limit ${limit})`);
        const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
        newPlayers[playerIndex] = {
          ...newPlayers[playerIndex],
          discardPile: [...newPlayers[playerIndex].discardPile, card],
        };
        return { ...state, players: newPlayers };
      }
    }
  }

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

  // Apply any tap-sites-in-play clause now that the environment is in play
  // (e.g. Foul Fumes / Long Winter "if Doors of Night is in play, ... tapped").
  return applyTapSitesInPlayOnResolve(afterPlay, def);
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
 * Derives the list of creature races the defending company has already
 * faced this M/H sub-phase by looking up each hazard name in
 * `phaseState.hazardsEncountered` and extracting its race. Used by
 * creature self-effects (e.g. Orc-lieutenant +4 prowess if an Orc attack
 * was already faced).
 */
function deriveFacedRaces(state: GameState, hazardNames: readonly string[]): string[] {
  const races = new Set<string>();
  for (const name of hazardNames) {
    for (const def of Object.values(state.cardPool)) {
      if ((def as { cardType?: string }).cardType !== 'hazard-creature') continue;
      if ((def as { name?: string }).name !== name) continue;
      const race = (def as { race?: string }).race;
      if (race) races.add(race);
      break;
    }
  }
  return Array.from(races);
}

/**
 * Returns the creature races already faced by the active company during the
 * site phase, derived from the site's automatic attacks that have already
 * been initiated (`phaseState.automaticAttacksResolved`). Used by on-guard
 * creature self-effects (e.g. Orc-lieutenant +4 prowess if an Orc attack
 * was already faced this turn).
 */
function deriveSiteFacedRaces(state: GameState): string[] {
  if (state.phaseState.phase !== 'site') return [];
  const siteState = state.phaseState;
  const activePlayerIndex = getPlayerIndex(state, state.activePlayer!);
  const company = state.players[activePlayerIndex].companies[siteState.activeCompanyIndex];
  if (!company?.currentSite) return [];
  const siteDef = defById(state, company.currentSite.definitionId);
  if (!siteDef || !isSiteCard(siteDef)) return [];
  const autoAttacks = getActiveAutoAttacks(state, siteDef);
  const resolved = Math.min(siteState.automaticAttacksResolved, autoAttacks.length);
  const races = new Set<string>();
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

  // Check for attacker-chooses-defenders combat rule (e.g. Cave-drake)
  const attackerChooses = creatureDef.effects?.some(
    e => e.type === 'combat-attacker-chooses-defenders',
  ) ?? false;
  if (attackerChooses) {
    logDetail('Creature has attacker-chooses-defenders — skipping defender assignment');
  }

  // Check for multi-attack combat rule (e.g. Assassin — three attacks of one strike each)
  const multiAttackEffect = creatureDef.effects?.find(
    e => e.type === 'combat-multi-attack',
  );
  const rawMultiAttackCount = multiAttackEffect?.count ?? 1;
  // Forewarned Is Forearmed: reduce any multi-attack creature to 1 attack
  const forewarnedActive = rawMultiAttackCount > 1 && isReduceAttacksToOneInPlay(state);
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
  const defenderProwessFromMind = hasPlayFlag(creatureDef, 'combat-defender-prowess-from-mind');

  // Check for tap-low-mind combat rule (e.g. Wisp of Pale Sheen — facing
  // characters with mind ≤ strike prowess tap after the strike resolves).
  const tapLowMindAfterStrike = creatureDef.effects?.some(
    e => e.type === 'combat-tap-low-mind',
  ) ?? false;
  if (tapLowMindAfterStrike) {
    logDetail('Creature has tap-low-mind — facing characters with mind ≤ strike prowess tap after their strike');
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
  const creatureRace = normalizeCreatureRace(creatureDef.race);
  const companyFacedRaces = state.phaseState.phase === 'movement-hazard'
    ? deriveFacedRaces(state, state.phaseState.hazardsEncountered)
    : deriveSiteFacedRaces(state);
  const defenderAlignment = defenderAlignmentLabel(state.players[activePlayerIndex].alignment);
  const creatureSelf = creatureDef.effects?.length
    ? { effects: creatureDef.effects, companyFacedRaces, defenderAlignment }
    : undefined;
  const attackBoostCtx = { companyId: company.id, creatureInstanceId: entry.card!.instanceId };
  const prowessBonus = entry.payload.type === 'creature' ? (entry.payload.prowessBonus ?? 0) : 0;
  const effectiveProwess = resolveAttackProwess(state, creatureDef.prowess, inPlayNames, creatureRace, false, creatureSelf, attackBoostCtx) + prowessBonus;
  const effectiveStrikes = resolveAttackStrikes(state, creatureDef.strikes, inPlayNames, creatureRace, false, attackBoostCtx);
  const effectiveBody = resolveAttackBody(state, creatureDef.body, inPlayNames, creatureRace, attackBoostCtx);

  // Total strikes resolution. Precedence:
  //   1. combat-one-strike-per-character → strikes = company.characters.length
  //   2. combat-multi-attack             → strikes = count × effectiveStrikes
  //   3. default                         → strikes = effectiveStrikes
  let totalStrikes: number;
  if (oneStrikePerCharacter) {
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
  } else {
    totalStrikes = effectiveStrikes * multiAttackCount;
    if (multiAttackCount > 1) {
      logDetail(`Multi-attack: ${multiAttackCount} attacks × ${effectiveStrikes} strike(s) = ${totalStrikes} total strikes`);
    }
  }

  const attackKeying = Array.from(new Set(
    creatureDef.keyedTo.flatMap(k => k.regionTypes ?? []),
  ));
  const attackSiteKeyingTypes = Array.from(new Set(
    creatureDef.keyedTo.flatMap(k => k.siteTypes ?? []),
  ));
  const attackKeyingRegionNames = Array.from(new Set(
    creatureDef.keyedTo.flatMap(k => k.regionNames ?? []),
  ));
  // Scan for on-event: creature-attack-begins → offer-char-join-attack
  // (e.g. Alatar). If any pending offers match, force a cancel-window so
  // the defender has an explicit opt-in before strike assignment begins.
  const havenJumpOffers = collectHavenJumpOffers(state, resourcePlayer, company.id);
  const defendingSiteDef = resolveDefendingSiteDef(state, company);

  const combat: CombatState = makeCombatState({
    attackSource,
    companyId: company.id,
    defendingPlayerId: state.activePlayer!,
    attackingPlayerId: hazardPlayerId,
    strikesTotal: totalStrikes,
    strikeProwess: effectiveProwess,
    creatureBody: effectiveBody,
    creatureRace,
    attackKeying: attackKeying.length > 0 ? attackKeying : undefined,
    attackSiteKeyingTypes: attackSiteKeyingTypes.length > 0 ? attackSiteKeyingTypes : undefined,
    attackKeyingRegionNames: attackKeyingRegionNames.length > 0 ? attackKeyingRegionNames : undefined,
    assignmentPhase: (attackerChooses || havenJumpOffers.length > 0) ? 'cancel-window' : 'defender',
    havenJumpOffers: havenJumpOffers.length > 0 ? havenJumpOffers : undefined,
    attackerChoosesDefenders: attackerChooses ? true : undefined,
    detainment: isDetainmentAttack({
      attackEffects: creatureDef.effects,
      attackRace: creatureRace as Race,
      attackKeyedTo: creatureDef.keyedTo,
      inPlayNames,
      defendingAlignment: state.players[activePlayerIndex].alignment,
      defendingSiteEffects: defendingSiteDef?.effects,
      defendingSiteName: defendingSiteDef?.name,
      defenderForcesNormalAttacks: playerConvertsDetainmentToNormal(state, state.players[activePlayerIndex]),
    }),
    forceSingleTarget: multiAttackCount > 1 ? true : undefined,
    multiAttackCount: multiAttackCount > 1 ? multiAttackCount : undefined,
    strikesPerAttack: multiAttackCount > 1 ? effectiveStrikes : undefined,
    cancelByTapRemaining: cancelByTapMax > 0 ? cancelByTapMax : undefined,
    cancelByTapAllowTarget: cancelByTapAllowTarget ? true : undefined,
    excludeAvatarStrikes: excludeAvatarStrikes ? true : undefined,
    defenderProwessFromMind: defenderProwessFromMind ? true : undefined,
    tapLowMindAfterStrike: tapLowMindAfterStrike ? true : undefined,
    ...(forewarnedActive ? { isolated: true, uncancelable: true } : {}),
  });

  logDetail(`Creature combat initiated: ${creatureDef.name} (${creatureDef.strikes} strikes${effectiveStrikes !== creatureDef.strikes ? ` → ${effectiveStrikes}` : ''}, ${creatureDef.prowess} prowess${effectiveProwess !== creatureDef.prowess ? ` → ${effectiveProwess}` : ''}${effectiveStrikes !== creatureDef.strikes || effectiveProwess !== creatureDef.prowess ? ' after global effects' : ''}) vs company ${company.id as string}`);

  // Place the creature card in the hazard player's cardsInPlay during combat.
  // After combat, finalizeCombat moves it to discard or the defender's kill pile.
  const hazardIndex = getPlayerIndex(state, hazardPlayerId);
  const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
  newPlayers[hazardIndex] = {
    ...newPlayers[hazardIndex],
    cardsInPlay: [...newPlayers[hazardIndex].cardsInPlay, {
      instanceId: entry.card!.instanceId,
      definitionId: entry.card!.definitionId,
      status: CardStatus.Untapped,
    }],
  };

  let finalState: GameState = { ...state, players: newPlayers, combat };

  // Scan for on-event: creature-attack-begins → force-check-all-company
  // (e.g. Corpse-candle). The attack was not canceled — enqueue a corruption
  // check for every character in the defending company before defender selection.
  if (creatureDef.effects) {
    for (const effect of creatureDef.effects) {
      if (effect.type !== 'on-event') continue;
      const onEvent: OnEventEffect = effect;
      if (onEvent.event !== 'creature-attack-begins') continue;
      if (onEvent.apply.type !== 'force-check-all-company') continue;
      if (onEvent.apply.check !== 'corruption') continue;
      const scope = companySubphaseScope(state.phaseState.phase, company.id);
      const modifier = onEvent.apply.modifier ?? 0;
      logDetail(`${creatureDef.name} (creature-attack-begins): enqueueing corruption check for all ${company.characters.length} character(s) in company`);
      for (const charInstanceId of company.characters) {
        finalState = enqueueCorruptionCheck(finalState, {
          source: entry.card!.instanceId,
          actor: state.activePlayer!,
          scope,
          characterId: charInstanceId,
          modifier,
          reason: creatureDef.name,
        });
      }
    }
  }

  return finalState;
}

/**
 * Resolves a single chain entry at the given index.
 *
 * Marks the entry as resolved and applies its effects. Short-events targeting
 * environments cancel and discard the target. Other entry types currently
 * resolve as no-ops (effects via DSL resolver to be added).
 */
function resolveEntry(state: GameState, entryIndex: number): ResolveResult {
  const chain = state.chain!;
  const entry = chain.entries[entryIndex];

  logDetail(`Resolving chain entry #${entryIndex}: ${entry.payload.type} by player ${entry.declaredBy as string}`);

  // TODO: check validity (CoE rule 681: conditions must still be legal)

  let current = state;

  // Apply card effects based on payload type
  if (entry.payload.type === 'short-event' && entry.payload.targetInstanceId) {
    current = resolveEnvironmentCancel(current, entry.payload.targetInstanceId, chain);
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

  // Short events with fetch-to-deck effects (e.g. An Unexpected Outpost):
  // move the card from the declaring player's discard pile to cardsInPlay
  // and queue the pending effects so the player can pick cards to fetch.
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    current = queueFetchToDecEffects(current, entry);
  }

  // Short events that force the active M/H company back to its site of origin
  // (e.g. Beorning Skin-changers ba-10 played as a short-event) — unless the
  // effect's `unless` company condition (Beorn / an untapped warrior with
  // prowess > 4) is met.
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    current = applyCompanyReturnToOrigin(current, entry);
  }

  // Short events that tap one chosen character (e.g. Adûnaphel tw-2's on-tap
  // "causes any one character to tap"). The target was chosen at play/tap time
  // and rides on the chain entry's payload.
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    current = applyTapCharacter(current, entry);
  }

  // draw-cards (Dark Tryst as-80): a resource short event that draws cards
  // routes through the chain (see handlePlayResourceShortEvent) and resolves
  // here once both players pass priority. Draw `count` cards from the top of
  // the declaring player's play deck into their hand, then dispose of the
  // spent event card: out-of-play when `removeFromGame` is set (so it can
  // never be recurred), otherwise the discard pile. The card rode on the chain
  // entry (it left the hand at play time), so dispose it now. Drawing stops
  // early if the deck runs out — no card instance disappears, the deck is
  // simply exhausted.
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    const def = defById(current, entry.card.definitionId);
    const drawEffect = getCardEffects(def).find(
      (e): e is import('../types/effects.js').DrawCardsEffect => e.type === 'draw-cards',
    );
    if (drawEffect) {
      const declaringIndex = getPlayerIndex(current, entry.declaredBy);
      const deck = current.players[declaringIndex].playDeck;
      const drawCount = Math.min(drawEffect.count, deck.length);
      const drawnCards = deck.slice(0, drawCount);
      const cardName = (def as { name?: string }).name ?? (entry.card.definitionId as string);
      logDetail(`${cardName}: chain resolves draw-cards — drawing ${drawCount}/${drawEffect.count} card(s) from play deck (deck size ${deck.length})`);
      if (drawCount < drawEffect.count) {
        logDetail(`${cardName}: play deck exhausted — drew only ${drawCount} of ${drawEffect.count}`);
      }
      const spentCard = toCardInstance(entry.card);
      logDetail(`${cardName}: spent event card → ${drawEffect.removeFromGame ? 'out-of-play (removed from game)' : 'discard'}`);
      current = updatePlayer(current, declaringIndex, p => ({
        ...p,
        hand: [...p.hand, ...drawnCards],
        playDeck: p.playDeck.slice(drawCount),
        ...(drawEffect.removeFromGame
          ? { outOfPlayPile: [...p.outOfPlayPile, spentCard] }
          : { discardPile: [...p.discardPile, spentCard] }),
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
      const declarerIdx = getPlayerIndex(current, entry.declaredBy);
      const eventInstId = entry.card.instanceId;
      if (current.players[declarerIdx].discardPile.some(c => c.instanceId === eventInstId)) {
        const eventCard = current.players[declarerIdx].discardPile.find(c => c.instanceId === eventInstId)!;
        current = updatePlayer(current, declarerIdx, p => ({
          ...p,
          discardPile: p.discardPile.filter(c => c.instanceId !== eventInstId),
          outOfPlayPile: [...p.outOfPlayPile, eventCard],
        }));
        logDetail(`${cardName}: removed from the game (→ ${current.players[declarerIdx].name}'s out-of-play pile)`);
      }

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
            effect: {
              type: 'fetch-to-deck' as const,
              source: ['deck'],
              filter: { keywords: { $includes: 'agent' } },
              count: 1,
              shuffle: true,
              to: 'hand' as const,
              homeSiteTypes: fetchEff.homeSiteTypes,
              revealToOpponent: true,
            },
            skipDiscard: true,
          },
        ],
      };
    }
  }

  // Flattery-cancel-attack (e.g. Flatter a Foe): when the chain entry resolves
  // un-negated, create a flattery-attempt pending resolution for the defending
  // player to roll 2d6. The roll determines whether the attack is cancelled and
  // the hazard limit reduced. Do NOT immediately cancel the attack here.
  if (entry.payload.type === 'short-event'
    && entry.payload.targetCharacterId
    && !entry.negated
    && entry.card
    && current.combat) {
    const cardDef = defById(current, entry.card.definitionId);
    const flatEffect = getCardEffects(cardDef).find(
      (e): e is FlatteryCancelAttackEffect => e.type === 'flattery-cancel-attack',
    );
    if (flatEffect) {
      const creatureRace = current.combat.creatureRace ?? '';
      const matchedEntry = flatEffect.thresholds.find(t => t.races.includes(creatureRace));
      if (matchedEntry) {
        const defPlayerId = current.combat.defendingPlayerId;
        const scope = companySubphaseScope(current.phaseState.phase, current.combat.companyId);
        logDetail(`Flattery-cancel-attack: enqueuing flattery-attempt for character ${entry.payload.targetCharacterId as string} (race "${creatureRace}", threshold ${matchedEntry.threshold})`);
        current = enqueueResolution(current, {
          source: entry.card.instanceId,
          actor: defPlayerId,
          scope,
          kind: {
            type: 'flattery-attempt',
            characterInstanceId: entry.payload.targetCharacterId,
            creatureRace,
            threshold: matchedEntry.threshold,
            diplomatBonus: flatEffect.diplomatBonus,
            hazardLimitReduction: flatEffect.hazardLimitReduction,
          },
        });
        return { state: current, needsInput: true };
      }
    }
  }

  // Short events that cancel the current attack (e.g. Concealment, Dark
  // Quarrels, Many Turns and Doublings, Vanishment) or resolve a strike
  // effect (e.g. Dodge, Lucky Strike, Risky Blow): when the chain entry
  // resolves un-negated, fire each matching effect through the shared apply
  // dispatcher. The opponent had a chance to negate this entry during chain
  // declaration.
  const resolveEffects: import('../index.js').GameEffect[] = [];
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
      logDetail(`Enqueuing dice-check (call-of-home) pending resolution for character ${entry.payload.targetCharacterId as string}`);
      current = enqueueResolution(current, {
        source: entry.card.instanceId,
        actor: resourcePlayerId,
        scope: { kind: 'phase-step', phase: Phase.MovementHazard, step: 'play-hazards' },
        kind: {
          type: 'dice-check',
          label: `Call of Home: ${cohCharName}`,
          modifiers: [{ kind: 'unused-gi', player: resourcePlayerId }],
          threshold: cohEffect.threshold,
          comparison: 'gte',
          // roll + unused GI < threshold → character returns to hand.
          onFail: { type: 'return-character-to-hand' },
          continuation: { kind: 'chain-entry', match: 'target-character' },
          requireTargetPresent: true,
          targetCharacterId: entry.payload.targetCharacterId,
        },
      });
      return { state: current, needsInput: true };
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
        const autoAttacks = getActiveAutoAttacks(current, destSiteDef);
        if (autoAttacks.length > 0) {
          const hazardPlayerId = hazardPlayer(current, activePlayerId).id;
          const inPlayNames = buildInPlayNames(current);
          const aa0 = autoAttacks[0];
          const race0 = normalizeCreatureRace(aa0.creatureType);
          const tidings0BoostCtx = { companyId: company.id };
          const prowess0 = resolveAttackProwess(current, aa0.prowess, inPlayNames, race0, true, undefined, tidings0BoostCtx);
          const strikes0 = resolveAttackStrikes(current, aa0.strikes, inPlayNames, race0, true, tidings0BoostCtx);
          const body0 = resolveAttackBody(current, aa0.body ?? null, inPlayNames, race0, tidings0BoostCtx);
          const aaAttackerChooses0 = aa0.combatRules?.includes('attacker-chooses-defenders') ?? false;
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
              attackRace: race0 as import('../index.js').Race | null,
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
          // Race-derived discard threshold, computed at enqueue (the card def is
          // static): Orc/Troll minions use their stated discardBodyCheck array
          // (min value), others use body. Pre-resolved into the dice-check.
          const cBody = cDef && isCharacterCard(cDef) && cDef.body != null ? cDef.body : 9;
          const cRace = cDef && isCharacterCard(cDef) ? cDef.race : '';
          const cOrcTroll = cRace === 'orc' || cRace === 'troll';
          const cDiscardValues = cOrcTroll && cDef && isCharacterCard(cDef) && cDef.cardType === 'minion-character' && cDef.discardBodyCheck != null
            ? cDef.discardBodyCheck
            : [cBody];
          const cThreshold = Math.min(...cDiscardValues) + bodyModifier;
          const cName = cDef && isCharacterCard(cDef) ? cDef.name : (charId as string);
          // onFail by race: Orc/Troll are discarded; others are tapped only if
          // currently untapped (the `when` leaves wounded/inverted untouched).
          const onFail = cOrcTroll
            ? { type: 'discard-character' as const }
            : { type: 'set-character-status' as const, status: 'tapped' as const, when: { 'target.status': 'untapped' } };
          current = enqueueResolution(current, {
            source: entry.card.instanceId,
            actor: activePlayerId,
            scope: { kind: 'phase-step', phase: Phase.MovementHazard, step: 'play-hazards' },
            kind: {
              type: 'dice-check',
              label: `Body check (${bodyCheckSourceName}): ${cName}`,
              modifiers: [],
              threshold: cThreshold,
              comparison: 'gte',
              onFail,
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
        const threshold = evaluateExpr(tapEffect.mindBelow, { spawnCardsInPlay });
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
        let possessions: CardInstanceId[] = [];
        for (const p of current.players) {
          const charData = p.characters[targetCharId];
          if (charData) {
            possessions = [
              ...charData.items.map(i => i.instanceId),
              ...charData.allies.map(a => a.instanceId),
              ...charData.hazards.map(h => h.instanceId),
            ];
            break;
          }
        }
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
        }
        const scope = parseConstraintScope(apply.scope ?? 'until-cleared', null);
        if (constraintValue !== undefined && scope) {
          logDetail(`${cardNm} option "${opt.id}": check-modifier ${apply.check} ${constraintValue >= 0 ? '+' : ''}${constraintValue} on ${targetCharId as string} (scope ${apply.scope ?? 'until-cleared'})`);
          current = addConstraint(current, {
            source: entry.card.instanceId,
            sourceDefinitionId: entry.card.definitionId,
            scope,
            target: { kind: 'character', characterId: targetCharId },
            kind: { type: 'check-modifier', check: apply.check, value: constraintValue },
          });
        } else {
          logDetail(`${cardNm} option "${opt.id}": check-modifier could not resolve value/scope — fizzle`);
        }
        const declaringIndex = getPlayerIndex(current, entry.declaredBy);
        current = updatePlayer(current, declaringIndex, p => ({
          ...p,
          discardPile: [...p.discardPile, toCardInstance(entry.card!)],
        }));
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
      let possessions: CardInstanceId[] = [];
      for (const p of current.players) {
        const charData = p.characters[targetCharId];
        if (charData) {
          possessions = [
            ...charData.items.map(i => i.instanceId),
            ...charData.allies.map(a => a.instanceId),
            ...charData.hazards.map(h => h.instanceId),
          ];
          break;
        }
      }
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
    current = resolvePermanentEvent(current, entry);
    current = sweepAutoDiscardResourceEvents(current);
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

  // Flush negated entries: cards still on the chain go to their declaring player's discard
  let current = state;
  for (const entry of chain.entries) {
    if (entry.negated && entry.card) {
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
