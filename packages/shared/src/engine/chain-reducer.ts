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

import type { GameState, GameAction, PlayerId, PlayerState, CardInstance, CardInstanceId, ChainState, ChainEntry, ChainEntryPayload, ChainRestriction, DeferredPassive, CombatState, CreatureCard } from '../index.js';
import { getPlayerIndex, CardStatus } from '../index.js';
import { resolveInstanceId } from '../types/state.js';
import { logHeading, logDetail } from './legal-actions/log.js';
import { discardCardsInPlay } from './reducer.js';
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
 * Cancel and discard an environment card targeted by a short-event (e.g. Twilight).
 *
 * The target may be in eventsInPlay (hazard permanent events like Doors of Night),
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
  const targetDefId = resolveInstanceId(state, targetInstanceId);
  const targetDef = targetDefId ? state.cardPool[targetDefId as string] : undefined;
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

  // Check eventsInPlay
  const evtIdx = state.eventsInPlay.findIndex(ev => ev.instanceId === targetInstanceId);
  if (evtIdx !== -1) {
    const ev = state.eventsInPlay[evtIdx];
    const ownerIndex = getPlayerIndex(state, ev.owner);
    logDetail(`Environment cancel: removing ${targetName} from eventsInPlay → player ${ownerIndex} discard`);
    const newEventsInPlay = [...state.eventsInPlay];
    newEventsInPlay.splice(evtIdx, 1);
    const owner = state.players[ownerIndex];
    const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
    const discardEntry = { instanceId: targetInstanceId, definitionId: ev.definitionId };
    newPlayers[ownerIndex] = { ...owner, discardPile: [...owner.discardPile, discardEntry] };
    return { ...state, players: newPlayers, eventsInPlay: newEventsInPlay };
  }

  // Check cardsInPlay across all players
  for (let pi = 0; pi < state.players.length; pi++) {
    const player = state.players[pi];
    if (player.cardsInPlay.some(c => c.instanceId === targetInstanceId)) {
      logDetail(`Environment cancel: removing ${targetName} from player ${pi} cardsInPlay → discard`);
      const removedCard = player.cardsInPlay.find(c => c.instanceId === targetInstanceId)!;
      const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
      newPlayers[pi as 0 | 1] = {
        ...player,
        cardsInPlay: player.cardsInPlay.filter(c => c.instanceId !== targetInstanceId),
        discardPile: [...player.discardPile, { instanceId: targetInstanceId, definitionId: removedCard.definitionId }],
      };
      return { ...state, players: newPlayers };
    }
  }

  // Target already gone (fizzle) — e.g. another effect already canceled it
  logDetail(`Environment cancel: target ${targetName} already gone — fizzle`);
  return state;
}

/**
 * Resolves a permanent-event chain entry: moves the card from the chain
 * into the declaring player's `cardsInPlay` and executes `self-enters-play`
 * effects (e.g. Gates of Morning discarding hazard environments).
 */
function resolvePermanentEvent(state: GameState, entry: ChainEntry): GameState {
  const card = entry.card!;
  const def = state.cardPool[card.definitionId as string];
  const playerIndex = getPlayerIndex(state, entry.declaredBy);

  logDetail(`Permanent event resolves: "${def?.name ?? card.definitionId}" enters play for player ${entry.declaredBy as string}`);

  // Add card to cardsInPlay
  const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
  newPlayers[playerIndex] = {
    ...newPlayers[playerIndex],
    cardsInPlay: [...newPlayers[playerIndex].cardsInPlay, {
      instanceId: card.instanceId,
      definitionId: card.definitionId,
      status: CardStatus.Untapped,
    }],
  };
  let newState: GameState = { ...state, players: newPlayers };

  // Execute self-enters-play effects (e.g. discard-cards-in-play)
  if (def && 'effects' in def && def.effects) {
    for (const effect of def.effects) {
      if (effect.type === 'on-event' && effect.event === 'self-enters-play' && effect.apply.type === 'discard-cards-in-play' && effect.apply.filter) {
        logDetail(`"${def.name}" entered play — discarding cards matching filter`);
        newState = discardCardsInPlay(newState, effect.apply.filter);
      }
    }
  }

  return newState;
}

/**
 * Resolves a long-event chain entry: moves the card from the chain
 * into the declaring player's `cardsInPlay`.
 */
function resolveLongEvent(state: GameState, entry: ChainEntry): GameState {
  const card = entry.card!;
  const def = state.cardPool[card.definitionId as string];
  const playerIndex = getPlayerIndex(state, entry.declaredBy);

  logDetail(`Long event resolves: "${def?.name ?? card.definitionId}" enters play for player ${entry.declaredBy as string}`);

  // Add card to cardsInPlay
  const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
  newPlayers[playerIndex] = {
    ...newPlayers[playerIndex],
    cardsInPlay: [...newPlayers[playerIndex].cardsInPlay, {
      instanceId: card.instanceId,
      definitionId: card.definitionId,
      status: CardStatus.Untapped,
    }],
  };

  return { ...state, players: newPlayers };
}

/**
 * Creates a CombatState when a creature chain entry resolves.
 *
 * The creature card was already moved to the hazard player's discard pile
 * at play time. Combat will determine whether it moves to the defending
 * player's marshalling point pile (all strikes defeated) or stays in discard.
 */
function initiateCreatureCombat(state: GameState, entry: ChainEntry): GameState {
  const creatureDef = state.cardPool[entry.card?.definitionId as string] as CreatureCard | undefined;
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
  const activePlayerIndex = state.players.findIndex(p => p.id === state.activePlayer);
  const resourcePlayer = state.players[activePlayerIndex];
  const company = resourcePlayer.companies[activeCompanyIndex];
  if (!company) {
    logDetail(`Creature resolution: no active company — fizzle`);
    return state;
  }

  const hazardPlayerId = state.players.find(p => p.id !== state.activePlayer)!.id;

  // Check for attacker-chooses-defenders combat rule (e.g. Cave-drake)
  const attackerChooses = creatureDef.effects?.some(
    e => e.type === 'combat-rule' && e.rule === 'attacker-chooses-defenders',
  ) ?? false;
  if (attackerChooses) {
    logDetail('Creature has attacker-chooses-defenders — skipping defender assignment');
  }

  const attackSource = state.phaseState.phase === 'site'
    ? { type: 'on-guard-creature' as const, cardInstanceId: entry.card!.instanceId }
    : { type: 'creature' as const, instanceId: entry.card!.instanceId };

  const combat: CombatState = {
    attackSource,
    companyId: company.id,
    defendingPlayerId: state.activePlayer!,
    attackingPlayerId: hazardPlayerId,
    strikesTotal: creatureDef.strikes,
    strikeProwess: creatureDef.prowess,
    creatureBody: creatureDef.body,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: attackerChooses ? 'attacker' : 'defender',
    bodyCheckTarget: null,
    detainment: false,
  };

  logDetail(`Creature combat initiated: ${creatureDef.name} (${creatureDef.strikes} strikes, ${creatureDef.prowess} prowess) vs company ${company.id as string}`);

  return { ...state, combat };
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

  if (entry.payload.type === 'creature' && entry.card) {
    current = initiateCreatureCombat(current, entry);
  }

  if (entry.payload.type === 'permanent-event' && !entry.negated && entry.card) {
    current = resolvePermanentEvent(current, entry);
  }

  if (entry.payload.type === 'long-event' && !entry.negated && entry.card) {
    current = resolveLongEvent(current, entry);
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

  // Flush negated entries: cards still on the chain go to their declaring player's discard
  let current = state;
  for (const entry of chain.entries) {
    if (entry.negated && entry.card) {
      const playerIndex = getPlayerIndex(current, entry.declaredBy);
      const player = current.players[playerIndex];
      const def = current.cardPool[entry.card.definitionId as string];
      logDetail(`Flushing negated card "${def?.name ?? entry.card.definitionId}" to player ${entry.declaredBy as string} discard`);
      const newPlayers: [PlayerState, PlayerState] = [current.players[0], current.players[1]];
      newPlayers[playerIndex] = {
        ...player,
        discardPile: [...player.discardPile, { instanceId: entry.card.instanceId, definitionId: entry.card.definitionId }],
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

/**
 * Creates a nested sub-chain that interrupts the current chain.
 *
 * Used for on-guard reveals (CoE rule 382) and body checks (CoE rule 455).
 * The current chain is saved as `parentChain` on the sub-chain. When the
 * sub-chain completes, the parent chain resumes via {@link completeChain}.
 *
 * @param state - Current game state (chain must be non-null).
 * @param declaredBy - The player initiating the sub-chain.
 * @param card - The card triggering the sub-chain, or null.
 * @param payload - What kind of sub-chain entry this is.
 * @param restriction - Sub-chain restriction mode.
 * @returns New game state with the sub-chain active and parent chain saved.
 */
export function interruptWithSubChain(
  state: GameState,
  declaredBy: PlayerId,
  card: CardInstance | null,
  payload: ChainEntryPayload,
  restriction: ChainRestriction = 'normal',
): GameState {
  logHeading(`Interrupting with sub-chain (${restriction})`);

  const entry: ChainEntry = {
    index: 0,
    declaredBy,
    card,
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

/**
 * Scans for beginning-of-phase or end-of-phase passive conditions and
 * creates a restricted chain if any are found.
 *
 * Called by phase transition logic in the main reducer:
 * - **Beginning-of-phase**: after transitioning into a new phase, before
 *   any normal actions are allowed (CoE rule 684).
 * - **End-of-phase**: after both players pass in a phase, before advancing
 *   to the next phase (CoE rule 685).
 *
 * If no passives trigger, returns the state unchanged (chain stays null).
 *
 * @param state - Current game state (chain should be null).
 * @param boundary - Which boundary to scan for.
 * @param phase - The phase name to match against trigger events.
 * @returns State with a restricted chain if passives were found, or unchanged.
 */
export function scanPhaseBoundary(
  state: GameState,
  boundary: 'beginning-of-phase' | 'end-of-phase',
  phase: string,
): GameState {
  const triggerEvent = `${boundary}:${phase}`;
  logDetail(`Scanning for ${boundary} passives in phase "${phase}"`);

  const passives: DeferredPassive[] = [];

  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const def = state.cardPool[card.definitionId as string];
      if (!def || !('effects' in def) || !def.effects) continue;

      for (const effect of def.effects) {
        if (effect.type !== 'on-event') continue;
        if (effect.event === triggerEvent) {
          logDetail(`Phase boundary passive: "${def.name}" triggers on "${triggerEvent}"`);
          passives.push({
            sourceCardId: card.instanceId,
            trigger: effect.event,
            payload: { type: 'passive-condition', trigger: effect.event },
          });
        }
      }
    }
  }

  if (passives.length === 0) {
    logDetail(`No ${boundary} passives found`);
    return state;
  }

  logDetail(`${passives.length} ${boundary} passive(s) found — creating restricted chain`);

  const restriction: ChainRestriction = boundary;
  const resourcePlayer = state.activePlayer!;

  const entries: ChainEntry[] = passives.map((passive, index) => ({
    index,
    declaredBy: resourcePlayer,
    card: null, // Passive conditions don't move a card onto the chain
    payload: passive.payload,
    resolved: false,
    negated: false,
  }));

  const chain: ChainState = {
    mode: 'declaring',
    entries,
    priority: opponent(state, resourcePlayer),
    priorityPlayerPassed: false,
    nonPriorityPlayerPassed: false,
    deferredPassives: [],
    parentChain: null,
    restriction,
  };

  return { ...state, chain };
}
