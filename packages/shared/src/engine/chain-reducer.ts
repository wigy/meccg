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

import type { GameState, GameAction, PlayerId, CardInstanceId, CardDefinitionId, ChainState, ChainEntry, ChainEntryPayload, ChainRestriction, DeferredPassive } from '../index.js';
import { logHeading, logDetail } from './legal-actions/log.js';
import type { ReducerResult } from './reducer.js';

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
 * @param cardInstanceId - The card being played, or null for non-card entries.
 * @param definitionId - The card definition ID, or null.
 * @param payload - What kind of chain entry this is.
 * @param restriction - Chain restriction mode (default: 'normal').
 * @returns New game state with chain active.
 */
export function initiateChain(
  state: GameState,
  declaredBy: PlayerId,
  cardInstanceId: CardInstanceId | null,
  definitionId: CardDefinitionId | null,
  payload: ChainEntryPayload,
  restriction: ChainRestriction = 'normal',
): GameState {
  logHeading(`Initiating chain of effects`);
  logDetail(`Declared by player ${declaredBy as string}, payload type: ${payload.type}, restriction: ${restriction}`);

  const entry: ChainEntry = {
    index: 0,
    declaredBy,
    cardInstanceId,
    definitionId,
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
 * @param cardInstanceId - The card being played, or null.
 * @param definitionId - The card definition ID, or null.
 * @param payload - What kind of chain entry this is.
 * @returns New game state with entry added and priority flipped.
 */
export function pushChainEntry(
  state: GameState,
  declaredBy: PlayerId,
  cardInstanceId: CardInstanceId | null,
  definitionId: CardDefinitionId | null,
  payload: ChainEntryPayload,
): GameState {
  const chain = state.chain!;
  logDetail(`Pushing chain entry #${chain.entries.length} by player ${declaredBy as string}, payload: ${payload.type}`);

  const entry: ChainEntry = {
    index: chain.entries.length,
    declaredBy,
    cardInstanceId,
    definitionId,
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

  // Check if the other player has already passed
  const otherAlreadyPassed = chain.priorityPlayerPassed
    ? chain.nonPriorityPlayerPassed
    : false;

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
  if (action.type !== 'order-passives') return { state, error: 'Expected order-passives action' };

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
 * Auto-resolves chain entries in LIFO order until the chain is complete
 * or player input is needed.
 *
 * Entries are resolved from the last declared (top of stack) to the first.
 * Each entry is checked for validity before resolution — if the entry's
 * conditions are no longer met, it is negated instead of resolved.
 *
 * When all entries are resolved, the chain completes via {@link completeChain}.
 */
function autoResolve(state: GameState): ReducerResult {
  let current = state;

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

    // If resolution needs player input, stop auto-advancing
    if (result.needsInput) {
      logDetail(`Entry #${nextIndex} needs player input — pausing auto-resolve`);
      break;
    }
  }

  return { state: current };
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
}

/**
 * Resolves a single chain entry at the given index.
 *
 * Currently marks the entry as resolved. When card effects are implemented
 * (Phase 4+), this will apply the card's effects via the DSL resolver and
 * may return `needsInput: true` if the effect requires player decisions.
 */
function resolveEntry(state: GameState, entryIndex: number): ResolveResult {
  const chain = state.chain!;
  const entry = chain.entries[entryIndex];

  logDetail(`Resolving chain entry #${entryIndex}: ${entry.payload.type} by player ${entry.declaredBy as string}`);

  // TODO: check validity (CoE rule 681: conditions must still be legal)
  // TODO: apply card effects via DSL resolver

  // Mark entry as resolved
  const newEntries = chain.entries.map((e, i) =>
    i === entryIndex ? { ...e, resolved: true } : e,
  );

  // Scan for passive conditions triggered by this resolution
  const triggeredPassives = detectTriggeredPassives(state, entry);
  const newDeferredPassives = triggeredPassives.length > 0
    ? [...chain.deferredPassives, ...triggeredPassives]
    : chain.deferredPassives;

  if (triggeredPassives.length > 0) {
    logDetail(`${triggeredPassives.length} passive condition(s) triggered — deferred for follow-up chain`);
  }

  const newChain: ChainState = {
    ...chain,
    entries: newEntries,
    deferredPassives: newDeferredPassives,
  };

  return {
    state: { ...state, chain: newChain },
    needsInput: false,
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
      const def = state.cardPool[card.definitionId as string];
      if (!def || !('effects' in def) || !def.effects) continue;

      for (const effect of def.effects) {
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

  // If deferred passives were triggered, create a follow-up chain
  if (chain.deferredPassives.length > 0) {
    logDetail(`${chain.deferredPassives.length} deferred passive(s) — creating follow-up chain`);
    return createFollowUpChain(state, chain);
  }

  // Restore parent chain if this was a nested sub-chain
  if (chain.parentChain) {
    logDetail(`Restoring parent chain`);
    return { ...state, chain: chain.parentChain };
  }

  // Chain fully complete — clear it
  logDetail(`No parent chain — clearing chain state`);
  return { ...state, chain: null };
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
    cardInstanceId: passive.sourceCardId,
    definitionId: null,
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

/**
 * Creates a nested sub-chain that interrupts the current chain.
 *
 * Used for on-guard reveals (CoE rule 382) and body checks (CoE rule 455).
 * The current chain is saved as `parentChain` on the sub-chain. When the
 * sub-chain completes, the parent chain resumes via {@link completeChain}.
 *
 * @param state - Current game state (chain must be non-null).
 * @param declaredBy - The player initiating the sub-chain.
 * @param cardInstanceId - The card triggering the sub-chain, or null.
 * @param definitionId - The card definition ID, or null.
 * @param payload - What kind of sub-chain entry this is.
 * @param restriction - Sub-chain restriction mode.
 * @returns New game state with the sub-chain active and parent chain saved.
 */
export function interruptWithSubChain(
  state: GameState,
  declaredBy: PlayerId,
  cardInstanceId: CardInstanceId | null,
  definitionId: CardDefinitionId | null,
  payload: ChainEntryPayload,
  restriction: ChainRestriction = 'normal',
): GameState {
  logHeading(`Interrupting with sub-chain (${restriction})`);

  const entry: ChainEntry = {
    index: 0,
    declaredBy,
    cardInstanceId,
    definitionId,
    payload,
    resolved: false,
    negated: false,
  };

  const subChain: ChainState = {
    mode: 'declaring',
    entries: [entry],
    priority: opponent(state, declaredBy),
    priorityPlayerPassed: false,
    nonPriorityPlayerPassed: false,
    deferredPassives: [],
    parentChain: state.chain,
    restriction,
  };

  logDetail(`Sub-chain created, parent chain saved. Priority to ${subChain.priority as string}`);

  return { ...state, chain: subChain };
}
