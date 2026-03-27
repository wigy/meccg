/**
 * @module reducer
 *
 * The core game state reducer implementing the pure `(state, action) → state`
 * pattern. Every game mutation flows through {@link reduce}, which validates
 * the action, checks phase legality, and dispatches to the appropriate
 * phase handler.
 *
 * Currently the character draft phase is fully implemented; the remaining
 * phase handlers (Untap, Organisation, Long-Event, Movement/Hazard, Site,
 * End-of-Turn, Free Council) are stubs awaiting implementation.
 *
 * The reducer never mutates its input — it always returns a new state object
 * (or the original state plus an error string if the action was illegal).
 */

import type { GameState, PlayerState, DraftPlayerState, ItemDraftPlayerState, CharacterDeckDraftPlayerState, SetupStepState, CardDefinitionId, CardInstanceId, CompanyId, CharacterInPlay, CardInstance, ChainEntryPayload, OrganizationPhaseState, MovementHazardPhaseState, SitePhaseState, EndOfTurnPhaseState, FreeCouncilPhaseState, Company, CreatureCard, SiteInPlay, HeroItemCard, CombatState, StrikeAssignment, PlayerId } from '../index.js';
import type { GameAction } from '../index.js';
import { Phase, SetupStep, LEGAL_ACTIONS_BY_PHASE, getAlignmentRules, shuffle, nextInt, CardStatus, isCharacterCard, isItemCard, isAllyCard, isSiteCard, SiteType, RegionType, Race, Skill, getPlayerIndex, ZERO_EFFECTIVE_STATS, MAX_STARTING_ITEMS, BASE_MAX_REGION_DISTANCE, HAND_SIZE } from '../index.js';
import { logHeading, logDetail } from './legal-actions/log.js';
import type { TwoDiceSix, DieRoll, GameEffect } from '../index.js';
import { applyDraftResults, transitionAfterItemDraft, enterSiteSelection, startFirstTurn } from './init.js';
import { recomputeDerived } from './recompute-derived.js';
import { computeTournamentScore } from '../state-utils.js';
import { handleChainAction, initiateChain, pushChainEntry } from './chain-reducer.js';

/**
 * Roll 2d6, respecting an optional cheat roll target. If `cheatRollTotal` is
 * set on the state, produces dice that sum to that total (using RNG to pick
 * the split) and clears the cheat field. Otherwise uses normal RNG.
 *
 * Returns the roll, updated RNG, and the new cheatRollTotal (null after use).
 */
function roll2d6(state: GameState): { roll: TwoDiceSix; rng: typeof state.rng; cheatRollTotal: number | null } {
  let rng = state.rng;
  let d1: DieRoll;
  let d2: DieRoll;
  let cheatRollTotal: number | null = state.cheatRollTotal;

  if (cheatRollTotal !== null && cheatRollTotal >= 2 && cheatRollTotal <= 12) {
    // Pick a random valid split for the target total
    const minD1 = Math.max(1, cheatRollTotal - 6);
    const maxD1 = Math.min(6, cheatRollTotal - 1);
    const range = maxD1 - minD1 + 1;
    const [pick, rng2] = nextInt(rng, range);
    rng = rng2;
    d1 = (minD1 + pick) as DieRoll;
    d2 = (cheatRollTotal - d1) as DieRoll;
    cheatRollTotal = null;  // consumed
  } else {
    const [d1raw, rng2] = nextInt(rng, 6);
    const [d2raw, rng3] = nextInt(rng2, 6);
    rng = rng3;
    d1 = (d1raw + 1) as DieRoll;
    d2 = (d2raw + 1) as DieRoll;
  }

  return { roll: { die1: d1, die2: d2 }, rng, cheatRollTotal };
}

/** Creates a mutable copy of the 2-player tuple, preserving the tuple type. */
function clonePlayers(state: GameState): [PlayerState, PlayerState] {
  return [{ ...state.players[0] }, { ...state.players[1] }];
}

/**
 * Handles deck exhaustion for a player when their play deck runs empty.
 *
 * Per CoE rules §10:
 * 1. Return discarded site cards to the location deck
 * 2. (TODO: sideboard exchange — player may swap up to 5 cards between
 *    discard pile and sideboard. This is an interactive step to be added later.)
 * 3. Shuffle the discard pile into a new play deck
 * 4. Increment `deckExhaustionCount`
 *
 * This function is called immediately after drawing the last card from the
 * play deck. It is idempotent — calling it when the discard pile is empty
 * results in an empty play deck (no-op reshuffle).
 *
 * @param state - Current game state (player's playDeck should be empty).
 * @param playerIndex - Index (0 or 1) of the player whose deck is exhausted.
 * @returns Updated game state with reshuffled deck and incremented exhaustion count.
 */
function exhaustPlayDeck(state: GameState, playerIndex: 0 | 1): GameState {
  const player = state.players[playerIndex];
  const newExhaustionCount = player.deckExhaustionCount + 1;
  logHeading(`Deck exhaustion #${newExhaustionCount} for ${player.name}`);

  // Step 1: Return discarded site cards to the location deck
  logDetail(`Returning ${player.siteDiscardPile.length} site card(s) to location deck`);

  // Step 2: TODO — sideboard exchange (interactive, add later)

  // Step 3: Shuffle the discard pile into a new play deck
  const [newPlayDeck, newRng] = shuffle([...player.discardPile], state.rng);
  logDetail(`Shuffled ${player.discardPile.length} card(s) from discard into new play deck`);

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = {
    ...player,
    playDeck: newPlayDeck,
    discardPile: [],
    siteDeck: [...player.siteDeck, ...player.siteDiscardPile],
    siteDiscardPile: [],
    deckExhaustionCount: newExhaustionCount,
  };

  return { ...state, players: newPlayers, rng: newRng };
}

/**
 * Result of applying a {@link GameAction} to a {@link GameState}.
 * If `error` is present, `state` is returned unchanged.
 */
export interface ReducerResult {
  readonly state: GameState;
  /** Human-readable error message if the action was rejected. */
  readonly error?: string;
  /** Visual effects to broadcast to clients (dice rolls, etc.). */
  readonly effects?: readonly GameEffect[];
}

/**
 * Applies a single game action to the current state.
 *
 * Validation pipeline:
 * 1. Verify the action comes from a player allowed to act in the current context.
 * 2. Verify the action type is legal for the current phase.
 * 3. Dispatch to the phase-specific handler for domain logic.
 *
 * @param state - The current authoritative game state.
 * @param action - The player action to apply.
 * @returns A {@link ReducerResult} with the new state or an error.
 */
export function reduce(state: GameState, action: GameAction): ReducerResult {
  logHeading(`Reducer: action '${action.type}' from player ${action.player as string} in phase '${state.phaseState.phase}'`);

  // 1. Validate action is from the correct player for the current context
  const validationError = validateActionPlayer(state, action);
  if (validationError) {
    logDetail(`Player validation failed: ${validationError}`);
    return { state, error: validationError };
  }
  logDetail(`Player validation passed`);

  // 2. Validate action type is legal in current phase
  const phase = state.phaseState.phase;
  const legalActions = LEGAL_ACTIONS_BY_PHASE[phase];
  if (!legalActions.includes(action.type)) {
    logDetail(`Phase validation failed: '${action.type}' not in [${legalActions.join(', ')}]`);
    return { state, error: `Action '${action.type}' is not legal in phase '${phase}'` };
  }
  logDetail(`Phase validation passed: '${action.type}' is legal in '${phase}'`);

  // 2b. Chain of effects: dispatch chain-specific actions when a chain is active
  if (state.chain != null && (action.type === 'pass-chain-priority' || action.type === 'order-passives')) {
    logDetail(`Chain active — dispatching '${action.type}' to chain reducer`);
    const chainResult = handleChainAction(state, action);
    if (!chainResult.error) {
      const recomputed = recomputeDerived(chainResult.state);
      return {
        state: { ...recomputed, stateSeq: recomputed.stateSeq + 1 },
        effects: chainResult.effects,
      };
    }
    return chainResult;
  }

  // 2c. Combat: dispatch combat-specific actions when combat is active
  const combatActionTypes = ['assign-strike', 'choose-strike-order', 'resolve-strike', 'support-strike', 'body-check-roll'];
  if (state.combat != null && (combatActionTypes.includes(action.type) || (action.type === 'pass' && state.combat.phase === 'assign-strikes'))) {
    logDetail(`Combat active — dispatching '${action.type}' to combat handler`);
    const combatResult = handleCombatAction(state, action);
    if (!combatResult.error) {
      const recomputed = recomputeDerived(combatResult.state);
      return {
        state: { ...recomputed, stateSeq: recomputed.stateSeq + 1 },
        effects: combatResult.effects,
      };
    }
    return combatResult;
  }

  // 3. Dispatch to phase handler
  let result: ReducerResult;
  switch (phase) {
    case Phase.Setup:
      result = handleSetup(state, action);
      break;
    case Phase.Untap:
      result = handleUntap(state, action);
      break;
    case Phase.Organization:
      result = handleOrganization(state, action);
      break;
    case Phase.LongEvent:
      result = handleLongEvent(state, action);
      break;
    case Phase.MovementHazard:
      result = handleMovementHazard(state, action);
      break;
    case Phase.Site:
      result = handleSite(state, action);
      break;
    case Phase.EndOfTurn:
      result = handleEndOfTurn(state, action);
      break;
    case Phase.FreeCouncil:
      result = handleFreeCouncil(state, action);
      break;
    case Phase.GameOver:
      return { state, error: 'Game is over' };
    default:
      return { state, error: `Unknown phase: ${String(phase satisfies never)}` };
  }

  // 4. Recompute derived values (MPs, general influence) from ground truth
  //    and increment the state sequence number for log tracking.
  //    Clear reverseActions whenever the phase changes.
  if (!result.error) {
    const recomputed = recomputeDerived(result.state);
    const phaseChanged = recomputed.phaseState.phase !== state.phaseState.phase;
    result = {
      state: {
        ...recomputed,
        stateSeq: recomputed.stateSeq + 1,
        ...(phaseChanged ? { reverseActions: [] } : {}),
      },
      effects: result.effects,
    };
  }

  return result;
}

/**
 * Checks whether the player submitting the action is allowed to act in the
 * current game context.
 *
 * - During the character draft, both players act simultaneously.
 * - During movement/hazard, the *non-active* player plays hazards.
 * - In all other phases, only the active player may act.
 *
 * @returns An error message if the player is not allowed to act, or
 *          `undefined` if the action is permitted.
 */
function validateActionPlayer(state: GameState, action: GameAction): string | undefined {
  const phase = state.phaseState.phase;

  // No active player during simultaneous phases (e.g. draft)
  if (state.activePlayer === null) {
    return undefined;
  }

  // During an active chain, the priority player may act
  if (state.chain != null && (action.type === 'pass-chain-priority' || action.type === 'order-passives' || action.type === 'play-short-event')) {
    if (action.player !== state.chain.priority) {
      return 'You do not have chain priority';
    }
    return undefined;
  }

  // Combat: player validation depends on combat sub-phase
  if (state.combat != null) {
    const combat = state.combat;
    if (action.type === 'assign-strike') {
      const expectedPlayer = combat.assignmentPhase === 'attacker' ? combat.attackingPlayerId : combat.defendingPlayerId;
      return action.player === expectedPlayer ? undefined : `Not the ${combat.assignmentPhase === 'attacker' ? 'attacking' : 'defending'} player`;
    }
    if (action.type === 'resolve-strike' || action.type === 'support-strike') {
      return action.player === combat.defendingPlayerId ? undefined : 'Not the defending player';
    }
    if (action.type === 'body-check-roll') {
      return action.player === combat.attackingPlayerId ? undefined : 'Not the attacking player';
    }
    if (action.type === 'pass' && combat.phase === 'assign-strikes') {
      return action.player === combat.defendingPlayerId ? undefined : 'Not the defending player';
    }
  }

  // During movement/hazard phase, the non-active player plays hazards
  if (phase === 'movement-hazard' && action.type === 'play-hazard') {
    if (action.player === state.activePlayer) {
      return 'Active player cannot play hazards';
    }
    return undefined;
  }

  // Short events (e.g. Twilight) can be played by either player during M/H
  if (phase === 'movement-hazard' && action.type === 'play-short-event') {
    return undefined;
  }

  // During draw-cards and play-hazards steps, both players act
  if (phase === 'movement-hazard' && 'step' in state.phaseState
    && (state.phaseState.step === 'draw-cards' || state.phaseState.step === 'play-hazards' || state.phaseState.step === 'reset-hand')) {
    return undefined;
  }

  // During end-of-turn discard and reset-hand steps, both players act
  if (phase === 'end-of-turn' && 'step' in state.phaseState
    && (state.phaseState.step === 'discard' || state.phaseState.step === 'reset-hand')) {
    return undefined;
  }

  // Most actions are taken by the active player
  if (action.player !== state.activePlayer) {
    return 'It is not your turn';
  }

  return undefined;
}

// ---- Setup phase handler ----

/** Dispatches setup phase actions to the appropriate step handler. */
function handleSetup(state: GameState, action: GameAction): ReducerResult {
  if (state.phaseState.phase !== Phase.Setup) {
    return { state, error: 'Not in setup phase' };
  }
  switch (state.phaseState.setupStep.step) {
    case SetupStep.CharacterDraft:
      return handleCharacterDraft(state, action, state.phaseState.setupStep);
    case SetupStep.ItemDraft:
      return handleItemDraft(state, action, state.phaseState.setupStep);
    case SetupStep.CharacterDeckDraft:
      return handleCharacterDeckDraft(state, action, state.phaseState.setupStep);
    case SetupStep.StartingSiteSelection:
      return handleStartingSiteSelection(state, action, state.phaseState.setupStep);
    case SetupStep.CharacterPlacement:
      return handleCharacterPlacement(state, action, state.phaseState.setupStep);
    case SetupStep.DeckShuffle:
      return handleDeckShuffle(state, action, state.phaseState.setupStep);
    case SetupStep.InitialDraw:
      return handleInitialDraw(state, action, state.phaseState.setupStep);
    case SetupStep.InitiativeRoll:
      return handleInitiativeRoll(state, action, state.phaseState.setupStep);
    default:
      return { state, error: 'Unknown setup step' };
  }
}

/** Helper to wrap a setup step state into a full phase state. */
function setupPhase(setupStep: SetupStepState): { readonly phase: Phase.Setup; readonly setupStep: SetupStepState } {
  return { phase: Phase.Setup, setupStep };
}

// ---- Character draft handler ----

/**
 * Handles actions during the simultaneous character draft step.
 */
function handleCharacterDraft(
  state: GameState,
  action: GameAction,
  draft: SetupStepState & { step: SetupStep.CharacterDraft },
): ReducerResult {
  const playerIndex = getPlayerIndex(state, action.player);
  const playerDraft = draft.draftState[playerIndex];

  switch (action.type) {
    case 'draft-pick': {
      if (playerDraft.stopped) {
        return { state, error: 'You have already stopped drafting' };
      }
      if (playerDraft.currentPick !== null) {
        return { state, error: 'Waiting for opponent to pick' };
      }
      if (!playerDraft.pool.includes(action.characterInstanceId)) {
        return { state, error: 'Character not in your draft pool' };
      }
      // Resolve definition from instance
      const charDefId = state.instanceMap[action.characterInstanceId as string]?.definitionId;
      // Check mind constraint
      const charDef = charDefId ? state.cardPool[charDefId as string] : undefined;
      if (!isCharacterCard(charDef)) {
        return { state, error: 'Invalid character' };
      }
      const currentMind = playerDraft.drafted.reduce((sum, instId) => {
        const defId = state.instanceMap[instId as string]?.definitionId;
        const def = defId ? state.cardPool[defId as string] : undefined;
        return sum + (isCharacterCard(def) && def.mind !== null ? def.mind : 0);
      }, 0);
      if (charDef.mind !== null && currentMind + charDef.mind > 20) {
        return { state, error: 'Would exceed mind limit of 20' };
      }
      const { maxStartingCompanySize } = getAlignmentRules(state.players[playerIndex].alignment);
      if (playerDraft.drafted.length >= maxStartingCompanySize) {
        return { state, error: `Already have ${maxStartingCompanySize} starting characters` };
      }

      // Set the pick
      const newDraftState = [...draft.draftState] as [DraftPlayerState, DraftPlayerState];
      newDraftState[playerIndex] = {
        ...playerDraft,
        currentPick: action.characterInstanceId,
        pool: playerDraft.pool.filter(id => id !== action.characterInstanceId),
      };

      // Check if both players have submitted (or the other has stopped)
      const otherIndex = 1 - playerIndex;
      const otherDraft = newDraftState[otherIndex];
      if (otherDraft.currentPick !== null || otherDraft.stopped) {
        return resolveDraftRound(state, newDraftState, draft.round, draft.setAside);
      }

      // Wait for other player
      return {
        state: {
          ...state,
          phaseState: setupPhase({ ...draft, draftState: newDraftState }),
        },
      };
    }

    case 'draft-stop': {
      if (playerDraft.stopped) {
        return { state, error: 'You have already stopped drafting' };
      }

      const newDraftState = [...draft.draftState] as [DraftPlayerState, DraftPlayerState];
      newDraftState[playerIndex] = { ...playerDraft, stopped: true };

      // If both stopped, end draft
      const otherIndex = 1 - playerIndex;
      if (newDraftState[otherIndex].stopped) {
        return finalizeDraft(state, newDraftState, draft.setAside);
      }

      // If other player has a pending pick, resolve the round
      if (newDraftState[otherIndex].currentPick !== null) {
        return resolveDraftRound(state, newDraftState, draft.round, draft.setAside);
      }

      return {
        state: {
          ...state,
          phaseState: setupPhase({ ...draft, draftState: newDraftState }),
        },
      };
    }

    default:
      return { state, error: `Unexpected action in draft: ${action.type}` };
  }
}

/**
 * Resolves a completed draft round after both players have submitted picks.
 *
 * If both players picked the same character, it is set aside and neither
 * receives it. Otherwise each player adds their pick to their drafted list.
 * Players who hit the 5-character limit, exhaust their pool, or reach 20
 * total mind are auto-stopped. If both are stopped, the draft is finalised.
 */
function resolveDraftRound(
  state: GameState,
  draftState: [DraftPlayerState, DraftPlayerState],
  round: number,
  setAside: readonly CardInstanceId[],
): ReducerResult {
  const pick0 = draftState[0].currentPick;
  const pick1 = draftState[1].currentPick;
  const newSetAside = [...setAside];

  /** Resolve a draft instance ID to its definition ID. */
  const defOf = (instId: CardInstanceId): CardDefinitionId =>
    state.instanceMap[instId as string].definitionId;

  // Resolve each player's pick
  const newDraft: [DraftPlayerState, DraftPlayerState] = [
    { ...draftState[0], currentPick: null },
    { ...draftState[1], currentPick: null },
  ];

  // Collision detection: compare by definition ID (both players may pick the same character)
  const def0 = pick0 !== null ? defOf(pick0) : null;
  const def1 = pick1 !== null ? defOf(pick1) : null;
  if (pick0 !== null && pick1 !== null && def0 === def1) {
    // Duplicate! Neither gets it — set aside both instances, remove same definition from both pools
    newSetAside.push(pick0);
    newDraft[0] = { ...newDraft[0], pool: newDraft[0].pool.filter(id => defOf(id) !== def0) };
    newDraft[1] = { ...newDraft[1], pool: newDraft[1].pool.filter(id => defOf(id) !== def0) };
  } else {
    if (pick0 !== null) {
      newDraft[0] = { ...newDraft[0], drafted: [...newDraft[0].drafted, pick0] };
    }
    if (pick1 !== null) {
      newDraft[1] = { ...newDraft[1], drafted: [...newDraft[1].drafted, pick1] };
    }
  }

  // Auto-stop players who hit limits
  for (let i = 0; i < 2; i++) {
    if (!newDraft[i].stopped) {
      const mind = newDraft[i].drafted.reduce((sum, instId) => {
        const def = state.cardPool[defOf(instId) as string];
        return sum + (isCharacterCard(def) && def.mind !== null ? def.mind : 0);
      }, 0);
      const { maxStartingCompanySize: max } = getAlignmentRules(state.players[i].alignment);
      if (newDraft[i].drafted.length >= max || newDraft[i].pool.length === 0 || mind >= 20) {
        newDraft[i] = { ...newDraft[i], stopped: true };
      }
    }
  }

  // If both stopped, finalize
  if (newDraft[0].stopped && newDraft[1].stopped) {
    return finalizeDraft(state, newDraft, newSetAside);
  }

  return {
    state: {
      ...state,
      phaseState: {
        phase: Phase.Setup,
        setupStep: {
          step: SetupStep.CharacterDraft,
          round: round + 1,
          draftState: newDraft,
          setAside: newSetAside,
        },
      },
    },
  };
}

/**
 * Delegates to {@link applyDraftResults} to place drafted characters on the
 * board and transition to item draft. Set-aside characters from draft
 * collisions are returned to both players' remaining pools.
 */
function finalizeDraft(
  state: GameState,
  draftState: readonly [DraftPlayerState, DraftPlayerState],
  setAside: readonly CardInstanceId[],
): ReducerResult {
  return {
    state: applyDraftResults(state, draftState, setAside),
  };
}

// ---- Item draft handler ----

/**
 * Handles the item draft phase where players assign their starting minor
 * items to characters in their starting company. Both players act
 * simultaneously. When all items are assigned, the game transitions to
 * the first Untap phase.
 */
function handleItemDraft(
  state: GameState,
  action: GameAction,
  stepState: SetupStepState & { step: SetupStep.ItemDraft },
): ReducerResult {
  const playerIndex = getPlayerIndex(state, action.player);
  const itemDraft = stepState.itemDraftState[playerIndex];

  if (itemDraft.done) {
    return { state, error: 'You have already finished item assignment' };
  }

  // Pass: skip remaining item assignments
  if (action.type === 'pass') {
    const newItemDraftState = [...stepState.itemDraftState] as [ItemDraftPlayerState, ItemDraftPlayerState];
    newItemDraftState[playerIndex] = { unassignedItems: [], done: true };

    if (newItemDraftState[0].done && newItemDraftState[1].done) {
      return {
        state: transitionAfterItemDraft(state, stepState.remainingPool),
      };
    }

    return {
      state: {
        ...state,
        phaseState: setupPhase({ ...stepState, itemDraftState: newItemDraftState }),
      },
    };
  }

  if (action.type !== 'assign-starting-item') {
    return { state, error: `Unexpected action in item draft: ${action.type}` };
  }

  // Enforce starting item limit
  const player = state.players[playerIndex];
  const assignedCount = Object.values(player.characters).reduce(
    (sum, char) => sum + char.items.length, 0,
  );
  if (assignedCount >= MAX_STARTING_ITEMS) {
    return { state, error: `Already at starting item limit (${assignedCount}/${MAX_STARTING_ITEMS})` };
  }

  // Resolve definition ID to the first matching unassigned instance
  const itemInstanceId = itemDraft.unassignedItems.find(instId => {
    const inst = state.instanceMap[instId as string];
    return inst && inst.definitionId === action.itemDefId;
  });
  if (!itemInstanceId) {
    return { state, error: 'Item is not in your unassigned items' };
  }

  // Validate character belongs to this player's company
  const allCharIds = player.companies.flatMap(c => c.characters);
  if (!allCharIds.includes(action.characterInstanceId)) {
    return { state, error: 'Character is not in your starting company' };
  }
  const charKey = action.characterInstanceId as string;
  const existingChar = player.characters[charKey];
  if (!existingChar) {
    return { state, error: 'Character not found' };
  }

  const itemDef = state.instanceMap[itemInstanceId as string];
  const updatedChar: CharacterInPlay = {
    ...existingChar,
    items: [...existingChar.items, { instanceId: itemInstanceId, definitionId: itemDef.definitionId, status: CardStatus.Untapped }],
  };
  const updatedCharacters = { ...player.characters, [charKey]: updatedChar };
  const updatedPlayer = { ...player, characters: updatedCharacters };

  // Remove item from unassigned list
  const newUnassigned = itemDraft.unassignedItems.filter(id => id !== itemInstanceId);
  const newItemDraft: ItemDraftPlayerState = {
    unassignedItems: newUnassigned,
    done: newUnassigned.length === 0,
  };

  const newItemDraftState = [...stepState.itemDraftState] as [ItemDraftPlayerState, ItemDraftPlayerState];
  newItemDraftState[playerIndex] = newItemDraft;

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = updatedPlayer;

  // If both players are done, transition to character deck draft (or Untap)
  if (newItemDraftState[0].done && newItemDraftState[1].done) {
    return {
      state: transitionAfterItemDraft(
        { ...state, players: newPlayers },
        stepState.remainingPool,
      ),
    };
  }

  return {
    state: {
      ...state,
      players: newPlayers,
      phaseState: setupPhase({ ...stepState, itemDraftState: newItemDraftState }),
    },
  };
}

// ---- Character deck draft handler ----

/**
 * Handles the character deck draft phase where players add remaining pool
 * characters to their play deck (max 10 non-avatar characters).
 * Both players act simultaneously. After finishing, each must shuffle
 * their play deck before the game transitions to Untap (turn 1).
 */
function handleCharacterDeckDraft(
  state: GameState,
  action: GameAction,
  stepState: SetupStepState & { step: SetupStep.CharacterDeckDraft },
): ReducerResult {
  const playerIndex = getPlayerIndex(state, action.player);
  const deckDraft = stepState.deckDraftState[playerIndex];

  if (deckDraft.done) {
    return { state, error: 'You have already finished adding characters' };
  }

  // Pass: done adding characters
  if (action.type === 'pass') {
    const newDeckDraftState = [...stepState.deckDraftState] as [CharacterDeckDraftPlayerState, CharacterDeckDraftPlayerState];
    newDeckDraftState[playerIndex] = { remainingPool: [], done: true };

    // Both done → enter site selection
    if (newDeckDraftState[0].done && newDeckDraftState[1].done) {
      return { state: enterSiteSelection(state) };
    }

    return {
      state: {
        ...state,
        phaseState: setupPhase({ ...stepState, deckDraftState: newDeckDraftState }),
      },
    };
  }

  if (action.type !== 'add-character-to-deck') {
    return { state, error: `Unexpected action in character deck draft: ${action.type}` };
  }

  // Validate character is in remaining pool
  if (!deckDraft.remainingPool.includes(action.characterInstanceId)) {
    return { state, error: 'Character is not in your remaining pool' };
  }

  // Resolve definition from draft instance
  const draftDefId = state.instanceMap[action.characterInstanceId as string]?.definitionId;
  const def = draftDefId ? state.cardPool[draftDefId as string] : undefined;

  // Validate non-avatar limit
  if (isCharacterCard(def) && def.mind !== null) {
    let nonAvatarCount = 0;
    for (const instId of state.players[playerIndex].playDeck) {
      const inst = state.instanceMap[instId as string];
      if (!inst) continue;
      const d = state.cardPool[inst.definitionId as string];
      if (isCharacterCard(d) && d.mind !== null) nonAvatarCount++;
    }
    if (nonAvatarCount >= 10) {
      return { state, error: 'Already have 10 non-avatar characters in play deck' };
    }
  }

  // Mint a new play-deck instance from the draft card's definition and add to play deck
  if (!draftDefId) return { state, error: 'Invalid character instance' };
  const counter = Object.keys(state.instanceMap).length;
  const instanceId = `i-${counter}` as CardInstanceId;
  const newInstance: CardInstance = { instanceId, definitionId: draftDefId };
  const newInstanceMap = { ...state.instanceMap, [instanceId as string]: newInstance };

  const player = state.players[playerIndex];
  const newPlayDeck = [...player.playDeck, instanceId];
  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...player, playDeck: newPlayDeck };

  // Remove from remaining pool
  const newPool = deckDraft.remainingPool.filter(id => id !== action.characterInstanceId);
  const newDeckDraftState = [...stepState.deckDraftState] as [CharacterDeckDraftPlayerState, CharacterDeckDraftPlayerState];
  newDeckDraftState[playerIndex] = {
    remainingPool: newPool,
    done: newPool.length === 0,
  };

  return {
    state: {
      ...state,
      players: newPlayers,
      instanceMap: newInstanceMap,
      phaseState: setupPhase({ ...stepState, deckDraftState: newDeckDraftState }),
    },
  };
}

// ---- Starting site selection handler ----

import type { SiteSelectionPlayerState } from '../index.js';

/**
 * Handles the starting site selection step. Each player selects one or two
 * sites from their site deck and forms empty companies at those sites.
 */
function handleStartingSiteSelection(
  state: GameState,
  action: GameAction,
  stepState: SetupStepState & { step: SetupStep.StartingSiteSelection },
): ReducerResult {
  const playerIndex = getPlayerIndex(state, action.player);
  const siteSelection = stepState.siteSelectionState[playerIndex];

  if (siteSelection.done) {
    return { state, error: 'You have already finished site selection' };
  }

  // Pass: done selecting (must have at least one site)
  if (action.type === 'pass') {
    if (siteSelection.selectedSites.length === 0) {
      return { state, error: 'You must select at least one starting site' };
    }

    const newSiteSelectionState = [...stepState.siteSelectionState] as [SiteSelectionPlayerState, SiteSelectionPlayerState];
    newSiteSelectionState[playerIndex] = { ...siteSelection, done: true };

    if (newSiteSelectionState[0].done && newSiteSelectionState[1].done) {
      return { state: finalizeSiteSelection(state, newSiteSelectionState) };
    }

    return {
      state: {
        ...state,
        phaseState: setupPhase({ ...stepState, siteSelectionState: newSiteSelectionState }),
      },
    };
  }

  if (action.type !== 'select-starting-site') {
    return { state, error: `Unexpected action in site selection: ${action.type}` };
  }

  // Validate site is in player's site deck and not already selected
  const player = state.players[playerIndex];
  if (!player.siteDeck.includes(action.siteInstanceId)) {
    return { state, error: 'Site is not in your site deck' };
  }
  if (siteSelection.selectedSites.includes(action.siteInstanceId)) {
    return { state, error: 'Site already selected' };
  }
  if (siteSelection.selectedSites.length >= 2) {
    return { state, error: 'Already selected 2 starting sites' };
  }

  // Remove site from site deck
  const newSiteDeck = player.siteDeck.filter(id => id !== action.siteInstanceId);
  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...player, siteDeck: newSiteDeck };

  const newSiteSelectionState = [...stepState.siteSelectionState] as [SiteSelectionPlayerState, SiteSelectionPlayerState];
  newSiteSelectionState[playerIndex] = {
    ...siteSelection,
    selectedSites: [...siteSelection.selectedSites, action.siteInstanceId],
  };

  return {
    state: {
      ...state,
      players: newPlayers,
      phaseState: setupPhase({ ...stepState, siteSelectionState: newSiteSelectionState }),
    },
  };
}

/**
 * Assigns the first selected site to the existing company (created during
 * draft with null site). If a second site was selected, creates an
 * additional empty company at that site. Transitions to the first Untap phase.
 */
function finalizeSiteSelection(
  state: GameState,
  siteSelectionState: readonly [SiteSelectionPlayerState, SiteSelectionPlayerState],
): GameState {
  const newPlayers = clonePlayers(state);

  for (let i = 0; i < 2; i++) {
    const player = newPlayers[i];
    const selectedSites = siteSelectionState[i].selectedSites;
    const companies = [...player.companies];

    // Assign first site to existing company
    if (selectedSites.length > 0 && companies.length > 0) {
      companies[0] = { ...companies[0], currentSite: { instanceId: selectedSites[0], definitionId: state.instanceMap[selectedSites[0] as string].definitionId, status: CardStatus.Untapped } };
    }

    // Second site creates an additional empty company
    if (selectedSites.length > 1) {
      companies.push({
        id: nextCompanyId(player),
        characters: [],
        currentSite: { instanceId: selectedSites[1], definitionId: state.instanceMap[selectedSites[1] as string].definitionId, status: CardStatus.Untapped },
        siteCardOwned: true,
        destinationSite: null,
        movementPath: [],
        moved: false,
        siteOfOrigin: null,
        onGuardCards: [],
      });
    }

    newPlayers[i] = { ...player, companies };
  }

  const newState = {
    ...state,
    players: newPlayers,
  };

  const p1NeedsPlacement = newPlayers[0].companies.length > 1;
  const p2NeedsPlacement = newPlayers[1].companies.length > 1;

  // Skip character placement entirely if neither player has multiple companies
  const nextStep = (p1NeedsPlacement || p2NeedsPlacement)
    ? setupPhase({
      step: SetupStep.CharacterPlacement,
      placementDone: [!p1NeedsPlacement, !p2NeedsPlacement],
    })
    : setupPhase({ step: SetupStep.DeckShuffle, shuffled: [false, false] });

  return {
    ...newState,
    activePlayer: null,
    phaseState: nextStep,
    turnNumber: 0,
  };
}

/**
 * Removes companies with no characters and returns their site cards
 * to the player's site deck.
 */
function cleanupEmptyCompanies(state: GameState): GameState {
  const newPlayers = state.players.map(player => {
    const emptyCompanies = player.companies.filter(c => c.characters.length === 0);
    const keptCompanies = player.companies.filter(c => c.characters.length > 0);

    // Return sites from empty companies: tapped sites go to discard, untapped to site deck
    const untappedSites: CardInstanceId[] = [];
    const tappedSites: CardInstanceId[] = [];
    for (const c of emptyCompanies) {
      if (c.currentSite) {
        if (c.currentSite.status === CardStatus.Tapped) {
          tappedSites.push(c.currentSite.instanceId);
        } else {
          untappedSites.push(c.currentSite.instanceId);
        }
      }
    }
    const newSiteDeck = [...player.siteDeck, ...untappedSites];
    const newDiscardPile = [...player.discardPile, ...tappedSites];

    return { ...player, companies: keptCompanies, siteDeck: newSiteDeck, discardPile: newDiscardPile };
  });

  return { ...state, players: [newPlayers[0], newPlayers[1]] };
}

// ---- Character placement handler ----

/**
 * Handles the character placement step where players distribute their
 * characters between starting companies (only when 2 sites were selected).
 */
function handleCharacterPlacement(
  state: GameState,
  action: GameAction,
  stepState: SetupStepState & { step: SetupStep.CharacterPlacement },
): ReducerResult {
  const playerIndex = getPlayerIndex(state, action.player);

  if (stepState.placementDone[playerIndex]) {
    return { state, error: 'You have already finished placement' };
  }

  if (action.type === 'pass') {
    const newDone = [...stepState.placementDone] as [boolean, boolean];
    newDone[playerIndex] = true;

    // Both done → advance to deck shuffle
    if (newDone[0] && newDone[1]) {
      return {
        state: {
          ...state,
          phaseState: setupPhase({ step: SetupStep.DeckShuffle, shuffled: [false, false] }),
        },
      };
    }

    return {
      state: {
        ...state,
        phaseState: setupPhase({ ...stepState, placementDone: newDone }),
      },
    };
  }

  if (action.type !== 'place-character') {
    return { state, error: `Unexpected action in character placement: ${action.type}` };
  }

  const player = state.players[playerIndex];

  // Validate character belongs to this player
  if (!player.characters[action.characterInstanceId as string]) {
    return { state, error: 'Character not found' };
  }

  // Validate target company belongs to this player
  const targetIdx = player.companies.findIndex(c => c.id === action.companyId);
  if (targetIdx < 0) {
    return { state, error: 'Company not found' };
  }

  // Remove character from current company
  const newCompanies = player.companies.map(c => ({
    ...c,
    characters: c.characters.filter(id => id !== action.characterInstanceId),
  }));

  // Add to target company
  newCompanies[targetIdx] = {
    ...newCompanies[targetIdx],
    characters: [...newCompanies[targetIdx].characters, action.characterInstanceId],
  };

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...player, companies: newCompanies };

  return {
    state: {
      ...state,
      players: newPlayers,
    },
  };
}

/** Handles the deck shuffle step. Both players shuffle their play decks. */
function handleDeckShuffle(
  state: GameState,
  action: GameAction,
  stepState: SetupStepState & { step: SetupStep.DeckShuffle },
): ReducerResult {
  const playerIndex = getPlayerIndex(state, action.player);

  if (stepState.shuffled[playerIndex]) {
    return { state, error: 'You have already shuffled' };
  }

  if (action.type !== 'shuffle-play-deck') {
    return { state, error: `Unexpected action in deck shuffle: ${action.type}` };
  }

  const player = state.players[playerIndex];
  let rng = state.rng;
  const [shuffled, nextRng] = shuffle([...player.playDeck], rng);
  rng = nextRng;

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...player, playDeck: shuffled };

  const newShuffled = [...stepState.shuffled] as [boolean, boolean];
  newShuffled[playerIndex] = true;

  // Both shuffled → advance to initial draw
  if (newShuffled[0] && newShuffled[1]) {
    return {
      state: {
        ...state,
        players: newPlayers,
        phaseState: setupPhase({ step: SetupStep.InitialDraw, drawn: [false, false] }),
        rng,
      },
    };
  }

  return {
    state: {
      ...state,
      players: newPlayers,
      phaseState: setupPhase({ ...stepState, shuffled: newShuffled }),
      rng,
    },
  };
}

/** Handles the initial draw step. Both players draw their starting hand. */
function handleInitialDraw(
  state: GameState,
  action: GameAction,
  stepState: SetupStepState & { step: SetupStep.InitialDraw },
): ReducerResult {
  const playerIndex = getPlayerIndex(state, action.player);

  if (stepState.drawn[playerIndex]) {
    return { state, error: 'You have already drawn' };
  }

  if (action.type !== 'draw-cards') {
    return { state, error: `Unexpected action in initial draw: ${action.type}` };
  }

  const player = state.players[playerIndex];
  const hand = player.playDeck.slice(0, action.count);
  const playDeck = player.playDeck.slice(action.count);

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...player, hand, playDeck };

  const newDrawn = [...stepState.drawn] as [boolean, boolean];
  newDrawn[playerIndex] = true;

  // Both drawn → initiative roll
  if (newDrawn[0] && newDrawn[1]) {
    return {
      state: {
        ...cleanupEmptyCompanies({
          ...state,
          players: newPlayers,
        }),
        phaseState: setupPhase({
          step: SetupStep.InitiativeRoll,
          rolls: [null, null],
        }),
      },
    };
  }

  return {
    state: {
      ...state,
      players: newPlayers,
      phaseState: setupPhase({ ...stepState, drawn: newDrawn }),
    },
  };
}

// ---- Initiative roll handler ----

/**
 * Handles the initiative roll step. Each player rolls 2d6. Results are
 * shown immediately (no waiting for opponent). If tied, both rolls are
 * cleared for a reroll. The higher roller goes first.
 */
function handleInitiativeRoll(
  state: GameState,
  action: GameAction,
  stepState: SetupStepState & { step: SetupStep.InitiativeRoll },
): ReducerResult {
  if (action.type !== 'roll-initiative') {
    return { state, error: `Unexpected action in initiative roll: ${action.type}` };
  }

  const playerIndex = getPlayerIndex(state, action.player);
  if (stepState.rolls[playerIndex] !== null) {
    return { state, error: 'You have already rolled' };
  }

  // Roll 2d6
  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const d1 = roll.die1;
  const d2 = roll.die2;
  logDetail(`${state.players[playerIndex].name} rolls initiative: ${d1} + ${d2} = ${d1 + d2}`);
  const rollEffect: GameEffect = {
    effect: 'dice-roll',
    playerName: state.players[playerIndex].name,
    die1: roll.die1,
    die2: roll.die2,
    label: 'Initiative',
  };

  // Store the roll in the player's state
  const playersWithRoll = clonePlayers(state);
  playersWithRoll[playerIndex] = { ...playersWithRoll[playerIndex], lastDiceRoll: roll };
  const stateWithRoll: GameState = { ...state, players: playersWithRoll, rng, cheatRollTotal };

  const newRolls = [...stepState.rolls] as [TwoDiceSix | null, TwoDiceSix | null];
  newRolls[playerIndex] = roll;

  // If opponent hasn't rolled yet, just record and wait
  if (newRolls[0] === null || newRolls[1] === null) {
    return {
      state: {
        ...stateWithRoll,
        phaseState: setupPhase({ ...stepState, rolls: newRolls }),
      },
      effects: [rollEffect],
    };
  }

  // Both rolled — compare
  const total0 = newRolls[0].die1 + newRolls[0].die2;
  const total1 = newRolls[1].die1 + newRolls[1].die2;

  if (total0 === total1) {
    logDetail(`Tie (${total0} vs ${total1}) — rerolling`);
    return {
      state: {
        ...stateWithRoll,
        phaseState: setupPhase({ ...stepState, rolls: [null, null] }),
      },
      effects: [rollEffect],
    };
  }

  // Winner goes first
  const winner = total0 > total1 ? stateWithRoll.players[0] : stateWithRoll.players[1];
  logDetail(`${winner.name} wins initiative (${total0} vs ${total1}) — goes first`);
  const firstPlayer = winner.id;
  return {
    state: startFirstTurn({ ...stateWithRoll, activePlayer: firstPlayer, startingPlayer: firstPlayer }),
    effects: [rollEffect],
  };
}

// ---- Phase handler stubs ----
// Each stub below corresponds to a game phase that is not yet implemented.
// They accept the action but return the state unmodified.

/**
 * Handles the Untap phase. Both players must pass to advance.
 * Actual untapping of cards will be implemented later.
 */
function handleUntap(state: GameState, action: GameAction): ReducerResult {
  if (state.phaseState.phase !== Phase.Untap) {
    return { state, error: 'Not in untap phase' };
  }
  if (action.type !== 'pass') {
    return { state, error: `Unexpected action '${action.type}' in untap phase` };
  }

  // Untap the active player's cards (not action.player, who may be the
  // previous player that triggered the transition to untap phase)
  const playerIndex = getPlayerIndex(state, state.activePlayer!);
  const player = state.players[playerIndex];

  // Build a set of character IDs at havens for healing wounded characters
  const charsAtHaven = new Set<string>();
  for (const company of player.companies) {
    if (!company.currentSite) continue;
    const siteDef = state.cardPool[company.currentSite.definitionId];
    if (siteDef && isSiteCard(siteDef) && siteDef.siteType === SiteType.Haven) {
      for (const charId of company.characters) {
        charsAtHaven.add(charId as string);
      }
    }
  }

  // Untap all tapped characters and their items/allies;
  // heal wounded (inverted) characters at havens to tapped position
  const newCharacters: Record<string, CharacterInPlay> = {};
  let healedCount = 0;
  for (const [key, ch] of Object.entries(player.characters)) {
    const untappedItems = ch.items.map(item =>
      item.status === CardStatus.Tapped ? { ...item, status: CardStatus.Untapped } : item,
    );
    const untappedAllies = ch.allies.map(ally =>
      ally.status === CardStatus.Tapped ? { ...ally, status: CardStatus.Untapped } : ally,
    );
    let newStatus = ch.status;
    if (ch.status === CardStatus.Tapped) {
      newStatus = CardStatus.Untapped;
    } else if (ch.status === CardStatus.Inverted && charsAtHaven.has(key)) {
      newStatus = CardStatus.Tapped;
      healedCount++;
    }
    newCharacters[key] = {
      ...ch,
      status: newStatus,
      items: untappedItems,
      allies: untappedAllies,
    };
  }

  // Untap all tapped cards in play (permanent events, factions, etc.)
  const newCardsInPlay = player.cardsInPlay.map(card =>
    card.status === CardStatus.Tapped ? { ...card, status: CardStatus.Untapped } : card,
  );

  const tappedCharCount = Object.values(player.characters).filter(ch => ch.status === CardStatus.Tapped).length;
  logDetail(`Untap: untapping ${tappedCharCount} character(s), healing ${healedCount} wounded character(s) at havens`);

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...player, characters: newCharacters, cardsInPlay: newCardsInPlay };

  logDetail(`Untap: active player ${action.player as string} passed → advancing to Organization phase`);
  return {
    state: {
      ...state,
      players: newPlayers,
      phaseState: { phase: Phase.Organization, characterPlayedThisTurn: false, pendingCorruptionCheck: null },
    },
  };
}

/** Handle actions during the organization phase. */
function handleOrganization(state: GameState, action: GameAction): ReducerResult {
  if (action.type === 'play-character') {
    return handlePlayCharacter(state, action);
  }
  if (action.type === 'pass') {
    logDetail(`Organization: player ${action.player as string} passed → advancing to Long-event phase`);

    // [2.III.1] At beginning of long-event phase: resource player discards own resource long-events
    const activePlayer = state.activePlayer!;
    const activeIndex = getPlayerIndex(state, activePlayer);
    const player = state.players[activeIndex];
    const discardedEventIds: CardInstanceId[] = [];
    const remainingCards = player.cardsInPlay.filter(card => {
      const def = state.cardPool[card.definitionId as string];
      if (def && def.cardType === 'hero-resource-event' && def.eventType === 'long') {
        logDetail(`Long-event entry: discarding resource long-event "${def.name}" (${card.instanceId as string})`);
        discardedEventIds.push(card.instanceId);
        return false;
      }
      return true;
    });

    const newPlayers = clonePlayers(state);
    newPlayers[activeIndex] = {
      ...newPlayers[activeIndex],
      cardsInPlay: remainingCards,
      discardPile: [...newPlayers[activeIndex].discardPile, ...discardedEventIds],
    };

    return {
      state: {
        ...state,
        players: newPlayers,
        phaseState: { phase: Phase.LongEvent },
      },
    };
  }
  if (action.type === 'plan-movement') {
    return handlePlanMovement(state, action);
  }
  if (action.type === 'cancel-movement') {
    return handleCancelMovement(state, action);
  }
  if (action.type === 'play-permanent-event') {
    return handlePlayPermanentEvent(state, action);
  }
  if (action.type === 'play-short-event') {
    return handlePlayShortEvent(state, action);
  }
  if (action.type === 'move-to-influence') {
    return handleMoveToInfluence(state, action);
  }
  if (action.type === 'transfer-item') {
    return handleTransferItem(state, action);
  }
  if (action.type === 'split-company') {
    return handleSplitCompany(state, action);
  }
  if (action.type === 'move-to-company') {
    return handleMoveToCompany(state, action);
  }
  if (action.type === 'merge-companies') {
    return handleMergeCompanies(state, action);
  }
  if (action.type === 'corruption-check') {
    return handleOrganizationCorruptionCheck(state, action);
  }
  return { state, error: `Unhandled organization action: ${action.type}` };
}

/**
 * Handle the play-character action during organization.
 *
 * Removes the character from hand, creates a CharacterInPlay entry,
 * adds it to an existing company at the target site or creates a new
 * company (taking the site card from the site deck if needed).
 */
function handlePlayCharacter(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'play-character') return { state, error: 'Expected play-character action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const phaseState = state.phaseState as OrganizationPhaseState;

  // Validate: only one character play per turn
  if (phaseState.characterPlayedThisTurn) {
    return { state, error: 'Already played a character this turn' };
  }

  // Validate: character must be in hand
  const charInstId = action.characterInstanceId;
  if (!player.hand.includes(charInstId)) {
    return { state, error: 'Character not in hand' };
  }

  // Validate: must be a character card
  const instance = state.instanceMap[charInstId as string];
  if (!instance) return { state, error: 'Card instance not found' };
  const charDef = state.cardPool[instance.definitionId as string];
  if (!charDef || !isCharacterCard(charDef)) {
    return { state, error: 'Card is not a character' };
  }

  logDetail(`Play character: ${charDef.name} (mind ${charDef.mind ?? 'null'}) at site ${action.atSite as string}, controlledBy ${action.controlledBy as string}`);

  // Build the new CharacterInPlay
  const newChar: CharacterInPlay = {
    instanceId: charInstId,
    definitionId: instance.definitionId,
    status: CardStatus.Untapped,
    items: [],
    allies: [],
    corruptionCards: [],
    followers: [],
    controlledBy: action.controlledBy,
    effectiveStats: ZERO_EFFECTIVE_STATS,
  };

  // Remove character from hand
  const newHand = player.hand.filter(id => id !== charInstId);

  // Find existing company at the target site
  const companies = [...player.companies];
  const existingCompanyIdx = companies.findIndex(c => c.currentSite?.instanceId === action.atSite);

  // Update or create company
  let newSiteDeck = player.siteDeck;
  if (existingCompanyIdx >= 0) {
    // Add character to existing company
    const company = companies[existingCompanyIdx];
    logDetail(`  Adding to existing company ${company.id as string}`);
    companies[existingCompanyIdx] = {
      ...company,
      characters: [...company.characters, charInstId],
    };
  } else {
    // Need to create a new company — the site comes from the site deck
    const siteInstId = action.atSite;

    // Validate: site must be in the site deck
    if (!player.siteDeck.includes(siteInstId)) {
      return { state, error: 'Site not available in site deck' };
    }

    // Validate: must be a valid site (haven or homesite)
    const siteDef = state.cardPool[state.instanceMap[siteInstId as string]?.definitionId as string];
    if (!siteDef || !isSiteCard(siteDef)) {
      return { state, error: 'Not a valid site card' };
    }
    const isHaven = siteDef.siteType === SiteType.Haven;
    const isHomesite = siteDef.name === charDef.homesite;
    if (!isHaven && !isHomesite) {
      return { state, error: `${siteDef.name} is neither a haven nor ${charDef.name}'s homesite` };
    }

    logDetail(`  Creating new company at ${siteDef.name} (from site deck)`);

    // Remove site from site deck
    newSiteDeck = player.siteDeck.filter(id => id !== siteInstId);

    // Create new company
    const newCompany: Company = {
      id: nextCompanyId({ ...player, companies }),
      characters: [charInstId],
      currentSite: { instanceId: siteInstId, definitionId: state.instanceMap[siteInstId as string].definitionId, status: CardStatus.Untapped },
      siteCardOwned: true,
      destinationSite: null,
      movementPath: [],
      moved: false,
      siteOfOrigin: null,
      onGuardCards: [],
    };
    companies.push(newCompany);
  }

  // If controlled by DI, add as follower of the controlling character
  const newCharacters = { ...player.characters, [charInstId as string]: newChar };
  if (action.controlledBy !== 'general') {
    const controllerId = action.controlledBy;
    const controller = newCharacters[controllerId as string];
    if (!controller) {
      return { state, error: 'Controlling character not found' };
    }
    newCharacters[controllerId as string] = {
      ...controller,
      followers: [...controller.followers, charInstId],
    };
  }

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = {
    ...player,
    hand: newHand,
    siteDeck: newSiteDeck,
    characters: newCharacters,
    companies,
  };

  return {
    state: {
      ...state,
      players: newPlayers,
      phaseState: { ...phaseState, characterPlayedThisTurn: true },
    },
  };
}

/**
 * Handle move-to-influence during organization.
 *
 * Moves a character between general influence and direct influence:
 * - To DI: removes from GI, adds as follower of the controller
 * - To GI: removes from controller's followers, sets controlledBy to 'general'
 */
function handleMoveToInfluence(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'move-to-influence') return { state, error: 'Expected move-to-influence action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const charInstId = action.characterInstanceId;
  const char = player.characters[charInstId as string];
  if (!char) return { state, error: 'Character not found' };

  const charDef = state.cardPool[state.instanceMap[charInstId as string]?.definitionId as string];
  if (!charDef || !isCharacterCard(charDef)) return { state, error: 'Not a character card' };

  logDetail(`Move to influence: ${charDef.name} → ${action.controlledBy as string}`);

  const newCharacters = { ...player.characters };

  if (action.controlledBy === 'general') {
    // Moving from DI to GI
    if (char.controlledBy === 'general') return { state, error: 'Character is already under general influence' };

    // Remove from old controller's followers list
    const oldControllerId = char.controlledBy;
    const oldController = newCharacters[oldControllerId as string];
    if (oldController) {
      newCharacters[oldControllerId as string] = {
        ...oldController,
        followers: oldController.followers.filter(id => id !== charInstId),
      };
    }

    // Set character to GI
    newCharacters[charInstId as string] = {
      ...char,
      controlledBy: 'general',
    };
  } else {
    // Moving from GI to DI (become follower)
    const controllerId = action.controlledBy;
    const controller = newCharacters[controllerId as string];
    if (!controller) return { state, error: 'Controlling character not found' };

    // If already a follower of someone else, remove from old controller first
    if (char.controlledBy !== 'general') {
      const oldControllerId = char.controlledBy;
      const oldController = newCharacters[oldControllerId as string];
      if (oldController) {
        newCharacters[oldControllerId as string] = {
          ...oldController,
          followers: oldController.followers.filter(id => id !== charInstId),
        };
      }
    }

    // Add to new controller's followers
    newCharacters[controllerId as string] = {
      ...controller,
      followers: [...controller.followers, charInstId],
    };

    // Set character's controlledBy
    newCharacters[charInstId as string] = {
      ...char,
      controlledBy: controllerId,
    };
  }

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = {
    ...player,
    characters: newCharacters,
  };

  // Reverse: move the character back to their old influence controller
  const reverseAction: GameAction = {
    type: 'move-to-influence',
    player: action.player,
    characterInstanceId: charInstId,
    controlledBy: char.controlledBy,
  };

  return {
    state: {
      ...state,
      players: newPlayers,
      reverseActions: [...state.reverseActions, reverseAction],
    },
  };
}

/**
 * Handle transfer-item during organization.
 *
 * Moves an item from one character to another at the same site.
 * Validates that the item exists on the source character and that
 * both characters are at the same site (not necessarily same company).
 */
function handleTransferItem(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'transfer-item') return { state, error: 'Expected transfer-item action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const fromCharId = action.fromCharacterId;
  const toCharId = action.toCharacterId;
  const itemInstId = action.itemInstanceId;

  const fromChar = player.characters[fromCharId as string];
  if (!fromChar) return { state, error: 'Source character not found' };

  const toChar = player.characters[toCharId as string];
  if (!toChar) return { state, error: 'Target character not found' };

  // Validate item exists on source character
  const itemIndex = fromChar.items.findIndex(i => i.instanceId === itemInstId);
  if (itemIndex < 0) return { state, error: 'Item not found on source character' };

  // Validate both characters are at the same site
  const findSite = (charId: CardInstanceId): SiteInPlay | null => {
    for (const company of player.companies) {
      if (company.characters.includes(charId)) return company.currentSite;
    }
    return null;
  };
  const fromSite = findSite(fromCharId);
  const toSite = findSite(toCharId);
  if (!fromSite || !toSite || fromSite.instanceId !== toSite.instanceId) {
    return { state, error: 'Characters must be at the same site' };
  }

  const item = fromChar.items[itemIndex];
  const itemDef = state.cardPool[state.instanceMap[itemInstId as string]?.definitionId as string];
  const fromDef = state.cardPool[state.instanceMap[fromCharId as string]?.definitionId as string];
  const toDef = state.cardPool[state.instanceMap[toCharId as string]?.definitionId as string];
  logDetail(`Transfer item: ${itemDef?.name ?? '?'} from ${fromDef?.name ?? '?'} to ${toDef?.name ?? '?'}`);

  // Move the item
  const newCharacters = { ...player.characters };
  newCharacters[fromCharId as string] = {
    ...fromChar,
    items: fromChar.items.filter(i => i.instanceId !== itemInstId),
  };
  newCharacters[toCharId as string] = {
    ...toChar,
    items: [...toChar.items, item],
  };

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = {
    ...player,
    characters: newCharacters,
  };

  // Set pending corruption check for the character who gave away the item
  const orgState = state.phaseState as import('../index.js').OrganizationPhaseState;
  logDetail(`Setting pending corruption check for ${fromDef?.name ?? '?'} after item transfer`);

  return {
    state: {
      ...state,
      players: newPlayers,
      reverseActions: [...state.reverseActions, {
        type: 'transfer-item' as const,
        player: action.player,
        itemInstanceId: itemInstId,
        fromCharacterId: toCharId,
        toCharacterId: fromCharId,
      }],
      phaseState: { ...orgState, pendingCorruptionCheck: { characterId: fromCharId, transferredItemId: itemInstId } },
    },
  };
}

/**
 * Handle corruption check during organization (after item transfer).
 *
 * Per CoE rules (2.II.5), after transferring an item the initial bearer
 * must make a corruption check: roll 2d6 + modifier vs corruption points.
 * - roll > CP: check passes, no effect.
 * - roll == CP or CP-1: character and possessions are discarded. Followers
 *   stay in play, promoted to general influence.
 * - roll < CP-1: character is eliminated (removed from game), possessions
 *   are discarded. Followers stay in play, promoted to general influence.
 */
function handleOrganizationCorruptionCheck(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'corruption-check') return { state, error: 'Expected corruption-check action' };

  const orgState = state.phaseState as import('../index.js').OrganizationPhaseState;
  if (orgState.pendingCorruptionCheck === null) {
    return { state, error: 'No pending corruption check' };
  }
  if (action.characterId !== orgState.pendingCorruptionCheck.characterId) {
    return { state, error: 'Wrong character for pending corruption check' };
  }

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const char = player.characters[action.characterId as string];
  if (!char) return { state, error: 'Character not found' };

  const charDef = state.cardPool[state.instanceMap[action.characterId as string]?.definitionId as string];
  const charName = charDef?.name ?? '?';
  const cp = action.corruptionPoints;
  const modifier = action.corruptionModifier;

  // Roll 2d6 + modifier
  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const d1 = roll.die1;
  const d2 = roll.die2;
  const total = d1 + d2 + modifier;
  const modStr = modifier !== 0 ? ` ${modifier >= 0 ? '+' : ''}${modifier}` : '';
  logDetail(`Corruption check for ${charName}: rolled ${d1} + ${d2}${modStr} = ${total} vs CP ${cp}`);

  const rollEffect: GameEffect = {
    effect: 'dice-roll',
    playerName: player.name,
    die1: roll.die1,
    die2: roll.die2,
    label: `Corruption: ${charName}`,
  };

  // Store the roll on the player
  const playersAfterRoll = clonePlayers(state);
  playersAfterRoll[playerIndex] = { ...playersAfterRoll[playerIndex], lastDiceRoll: roll };

  if (total > cp) {
    // Passed — clear pending check and continue organization
    logDetail(`Corruption check passed (${total} > ${cp})`);
    return {
      state: {
        ...state,
        players: playersAfterRoll,
        rng, cheatRollTotal,
        phaseState: { ...orgState, pendingCorruptionCheck: null },
      },
      effects: [rollEffect],
    };
  }

  const newCharacters = { ...player.characters };

  // Remove the transferred item from the target character (transfer failed)
  const transferredItemId = orgState.pendingCorruptionCheck.transferredItemId;
  for (const [cid, cData] of Object.entries(newCharacters)) {
    if (cid === action.characterId as string) continue;
    const itemIdx = cData.items.findIndex(i => i.instanceId === transferredItemId);
    if (itemIdx >= 0) {
      newCharacters[cid] = { ...cData, items: cData.items.filter(i => i.instanceId !== transferredItemId) };
      break;
    }
  }

  if (total >= cp - 1) {
    // Roll == CP or CP-1: character and possessions are discarded (not followers)
    logDetail(`Corruption check FAILED (${total} is within 1 of ${cp}) — discarding ${charName} and ${action.possessions.length} possession(s)`);

    delete newCharacters[action.characterId as string];

    // Remove character from company (followers stay)
    const newCompanies = player.companies.map(c => ({
      ...c,
      characters: c.characters.filter(id => id !== action.characterId),
    }));

    // Followers lose their controller — promote to general influence
    for (const followerId of char.followers) {
      const follower = newCharacters[followerId as string];
      if (follower) {
        newCharacters[followerId as string] = { ...follower, controlledBy: 'general' };
      }
    }

    const toDiscard = [action.characterId, ...action.possessions];
    const newDiscardPile = [...player.discardPile, ...toDiscard];

    playersAfterRoll[playerIndex] = {
      ...playersAfterRoll[playerIndex],
      characters: newCharacters,
      companies: newCompanies,
      discardPile: newDiscardPile,
    };
  } else {
    // Roll < CP-1: character is eliminated, possessions are discarded
    logDetail(`Corruption check FAILED (${total} < ${cp - 1}) — eliminating ${charName}, discarding ${action.possessions.length} possession(s)`);

    delete newCharacters[action.characterId as string];

    // Remove character from company (followers stay)
    const newCompanies = player.companies.map(c => ({
      ...c,
      characters: c.characters.filter(id => id !== action.characterId),
    }));

    // Followers lose their controller — promote to general influence
    for (const followerId of char.followers) {
      const follower = newCharacters[followerId as string];
      if (follower) {
        newCharacters[followerId as string] = { ...follower, controlledBy: 'general' };
      }
    }

    const newEliminatedPile = [...player.eliminatedPile, action.characterId];
    const newDiscardPile = [...player.discardPile, ...action.possessions];

    playersAfterRoll[playerIndex] = {
      ...playersAfterRoll[playerIndex],
      characters: newCharacters,
      companies: newCompanies,
      eliminatedPile: newEliminatedPile,
      discardPile: newDiscardPile,
    };
  }

  return {
    state: cleanupEmptyCompanies({
      ...state,
      players: playersAfterRoll,
      rng, cheatRollTotal,
      phaseState: { ...orgState, pendingCorruptionCheck: null },
    }),
    effects: [rollEffect],
  };
}

/**
 * Handle split-company during organization.
 *
 * Moves the specified characters (a GI character and their followers)
 * out of the source company into a new company at the same site.
 * Validates that the source company retains at least one character.
 */
function handleSplitCompany(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'split-company') return { state, error: 'Expected split-company action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const sourceCompanyIndex = player.companies.findIndex(c => c.id === action.sourceCompanyId);
  if (sourceCompanyIndex < 0) return { state, error: 'Source company not found' };
  const sourceCompany = player.companies[sourceCompanyIndex];

  // Expand to include followers automatically
  const char = player.characters[action.characterId as string];
  if (!char) return { state, error: `Character ${action.characterId as string} not found` };
  const allMovingIds: CardInstanceId[] = [action.characterId, ...char.followers];
  const movingIds = new Set(allMovingIds.map(id => id as string));

  // Validate all characters are in the source company
  for (const id of allMovingIds) {
    if (!sourceCompany.characters.some(c => c === id)) {
      return { state, error: `Character ${id as string} is not in the source company` };
    }
  }

  // Validate source company won't become empty
  const remaining = sourceCompany.characters.filter(id => !movingIds.has(id as string));
  if (remaining.length === 0) {
    return { state, error: 'Source company would become empty' };
  }

  logDetail(`Split company: moving ${movingIds.size} character(s) from ${sourceCompany.id as string}`);

  const newCompany: Company = {
    id: nextCompanyId(player),
    characters: allMovingIds,
    currentSite: sourceCompany.currentSite,
    siteCardOwned: false,
    destinationSite: null,
    movementPath: [],
    moved: false,
    siteOfOrigin: null,
    onGuardCards: [],
  };

  const companies = player.companies.map((c, i) =>
    i === sourceCompanyIndex ? { ...c, characters: remaining } : c,
  );
  companies.push(newCompany);

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...player, companies };

  // Reverse: merge the new company back into the source
  const reverseAction: GameAction = {
    type: 'merge-companies',
    player: action.player,
    sourceCompanyId: newCompany.id,
    targetCompanyId: action.sourceCompanyId,
  };

  return {
    state: {
      ...state,
      players: newPlayers,
      reverseActions: [...state.reverseActions, reverseAction],
    },
  };
}

/**
 * Handle move-to-company during organization.
 *
 * Moves a GI character (and their followers) from one company to another
 * existing company at the same site. Validates source won't become empty
 * and both companies are at the same site.
 */
function handleMoveToCompany(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'move-to-company') return { state, error: 'Expected move-to-company action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const sourceCompany = player.companies.find(c => c.id === action.sourceCompanyId);
  if (!sourceCompany) return { state, error: 'Source company not found' };

  const targetCompany = player.companies.find(c => c.id === action.targetCompanyId);
  if (!targetCompany) return { state, error: 'Target company not found' };

  // Validate same site
  if (sourceCompany.currentSite?.instanceId !== targetCompany.currentSite?.instanceId) {
    return { state, error: 'Companies must be at the same site' };
  }

  const charInstId = action.characterInstanceId;
  const char = player.characters[charInstId as string];
  if (!char) return { state, error: 'Character not found' };
  if (char.controlledBy !== 'general') return { state, error: 'Only characters under general influence can move between companies' };

  // Build set of IDs to move: the character + their followers
  const movingIds = new Set<string>([charInstId as string, ...char.followers.map(id => id as string)]);

  // Validate source company won't become empty
  const remaining = sourceCompany.characters.filter(id => !movingIds.has(id as string));
  if (remaining.length === 0) {
    return { state, error: 'Source company would become empty' };
  }

  const charDef = state.cardPool[state.instanceMap[charInstId as string]?.definitionId as string];
  logDetail(`Move to company: ${charDef?.name ?? '?'} (+ ${char.followers.length} followers) from ${sourceCompany.id as string} to ${targetCompany.id as string}`);

  // Build the moving character list preserving order from source
  const movingChars = sourceCompany.characters.filter(id => movingIds.has(id as string));

  const companies = player.companies.map(c => {
    if (c.id === action.sourceCompanyId) {
      return { ...c, characters: remaining };
    }
    if (c.id === action.targetCompanyId) {
      return { ...c, characters: [...c.characters, ...movingChars] };
    }
    return c;
  });

  // Remove empty companies (shouldn't happen due to validation, but be safe)
  const filteredCompanies = companies.filter(c => c.characters.length > 0);

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...player, companies: filteredCompanies };

  // Reverse: move the character back to the source company
  const reverseAction: GameAction = {
    type: 'move-to-company',
    player: action.player,
    characterInstanceId: charInstId,
    sourceCompanyId: action.targetCompanyId,
    targetCompanyId: action.sourceCompanyId,
  };

  return {
    state: {
      ...state,
      players: newPlayers,
      reverseActions: [...state.reverseActions, reverseAction],
    },
  };
}

/**
 * Handle merge-companies during organization.
 *
 * Moves all characters from the source company into the target company,
 * then removes the source company. Both companies must be at the same site.
 * If the source company owned the site card, ownership transfers to the target.
 */
function handleMergeCompanies(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'merge-companies') return { state, error: 'Expected merge-companies action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const sourceCompany = player.companies.find(c => c.id === action.sourceCompanyId);
  if (!sourceCompany) return { state, error: 'Source company not found' };

  const targetCompany = player.companies.find(c => c.id === action.targetCompanyId);
  if (!targetCompany) return { state, error: 'Target company not found' };

  // Validate same site
  if (sourceCompany.currentSite?.instanceId !== targetCompany.currentSite?.instanceId) {
    return { state, error: 'Companies must be at the same site' };
  }

  logDetail(`Merge companies: ${sourceCompany.id as string} into ${targetCompany.id as string} (${sourceCompany.characters.length} characters moving)`);

  // Transfer site card ownership if source owned it
  const siteCardOwned = targetCompany.siteCardOwned || sourceCompany.siteCardOwned;

  // Build updated companies: merge characters into target, remove source
  const companies = player.companies
    .filter(c => c.id !== action.sourceCompanyId)
    .map(c => {
      if (c.id === action.targetCompanyId) {
        return {
          ...c,
          characters: [...c.characters, ...sourceCompany.characters],
          siteCardOwned,
        };
      }
      return c;
    });

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...player, companies };

  // Reverse: split each GI character from the source back out of the target
  const reverses: GameAction[] = sourceCompany.characters
    .filter(id => {
      const c = player.characters[id as string];
      return c && c.controlledBy === 'general';
    })
    .map(charId => ({
      type: 'split-company' as const,
      player: action.player,
      sourceCompanyId: action.targetCompanyId,
      characterId: charId,
    }));

  return {
    state: {
      ...state,
      players: newPlayers,
      reverseActions: [...state.reverseActions, ...reverses],
    },
  };
}

/**
 * Handle plan-movement during organization.
 *
 * Sets the company's destination site and movement path, and removes
 * the destination site card from the player's site deck (it will be
 * returned on cancel-movement or discarded after movement resolves).
 */
function handlePlanMovement(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'plan-movement') return { state, error: 'Expected plan-movement action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const companyIdx = player.companies.findIndex(c => c.id === action.companyId);
  if (companyIdx === -1) return { state, error: 'Company not found' };

  const company = player.companies[companyIdx];
  if (company.destinationSite) return { state, error: 'Company already has planned movement' };
  if (!player.siteDeck.includes(action.destinationSite)) {
    return { state, error: 'Destination site not in site deck' };
  }

  logDetail(`Plan movement: company ${company.id as string} → ${action.destinationSite as string}`);

  const companies = [...player.companies];
  companies[companyIdx] = {
    ...company,
    destinationSite: action.destinationSite,
    movementPath: [],
  };

  // Remove destination site from site deck
  const siteDeck = player.siteDeck.filter(id => id !== action.destinationSite);

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...player, companies, siteDeck };

  // Reverse: cancel the movement we just planned
  const reverseAction: GameAction = {
    type: 'cancel-movement',
    player: action.player,
    companyId: action.companyId,
  };

  return { state: { ...state, players: newPlayers, reverseActions: [...state.reverseActions, reverseAction] } };
}

/**
 * Handle cancel-movement during organization.
 *
 * Clears the company's planned destination and returns the destination
 * site card back to the player's site deck.
 */
function handleCancelMovement(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'cancel-movement') return { state, error: 'Expected cancel-movement action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const companyIdx = player.companies.findIndex(c => c.id === action.companyId);
  if (companyIdx === -1) return { state, error: 'Company not found' };

  const company = player.companies[companyIdx];
  if (!company.destinationSite) return { state, error: 'Company has no planned movement' };

  logDetail(`Cancel movement: company ${company.id as string}, returning site ${company.destinationSite as string} to site deck`);

  const companies = [...player.companies];
  companies[companyIdx] = {
    ...company,
    destinationSite: null,
    movementPath: [],
  };

  // Return the destination site to the site deck
  const siteDeck = [...player.siteDeck, company.destinationSite];

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...player, companies, siteDeck };

  // Reverse: re-plan movement to the destination we just cancelled
  const reverseAction: GameAction = {
    type: 'plan-movement',
    player: action.player,
    companyId: action.companyId,
    destinationSite: company.destinationSite,
  };

  return { state: { ...state, players: newPlayers, reverseActions: [...state.reverseActions, reverseAction] } };
}

/**
 * Handle playing a permanent-event resource card during organization.
 * Removes the card from hand and adds it to the player's cardsInPlay.
 */
function handlePlayPermanentEvent(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'play-permanent-event') return { state, error: 'Expected play-permanent-event action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const cardIdx = player.hand.indexOf(action.cardInstanceId);
  if (cardIdx === -1) return { state, error: 'Card not in hand' };

  const inst = state.instanceMap[action.cardInstanceId as string];
  if (!inst) return { state, error: 'Card instance not found' };

  const def = state.cardPool[inst.definitionId as string];
  if (!def || def.cardType !== 'hero-resource-event' || def.eventType !== 'permanent') {
    return { state, error: 'Card is not a permanent resource event' };
  }

  // Check duplication-limit with scope "game"
  if (def.effects) {
    for (const effect of def.effects) {
      if (effect.type !== 'duplication-limit' || effect.scope !== 'game') continue;
      const copiesInPlay = state.players.reduce((count, p) =>
        count + p.cardsInPlay.filter(c => {
          const cDef = state.cardPool[c.definitionId as string];
          return cDef && cDef.name === def.name;
        }).length, 0,
      );
      if (copiesInPlay >= effect.max) {
        return { state, error: `${def.name} cannot be duplicated` };
      }
    }
  }

  logDetail(`Playing permanent event: ${def.name}`);

  const newHand = [...player.hand];
  newHand.splice(cardIdx, 1);

  const newCardsInPlay = [...player.cardsInPlay, {
    instanceId: action.cardInstanceId,
    definitionId: inst.definitionId,
    status: CardStatus.Untapped,
  }];

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...player, hand: newHand, cardsInPlay: newCardsInPlay };
  return { state: { ...state, players: newPlayers } };
}

/**
 * Handle playing a short-event as a resource (e.g. Twilight).
 * Moves the short event from hand to discard and initiates (or pushes onto)
 * a chain of effects. The target environment remains in play until the chain
 * entry resolves — giving both players a chance to respond.
 */
function handlePlayShortEvent(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'play-short-event') return { state, error: 'Expected play-short-event action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const cardIdx = player.hand.indexOf(action.cardInstanceId);
  if (cardIdx === -1) return { state, error: 'Card not in hand' };

  const inst = state.instanceMap[action.cardInstanceId as string];
  if (!inst) return { state, error: 'Card instance not found' };

  const def = state.cardPool[inst.definitionId as string];
  if (!def || def.cardType !== 'hazard-event' || def.eventType !== 'short') {
    return { state, error: 'Card is not a hazard short-event' };
  }

  // Validate target exists (in eventsInPlay, cardsInPlay, or the current chain)
  const targetInEvents = state.eventsInPlay.some(ev => ev.instanceId === action.targetInstanceId);
  const targetInCards = state.players.some(p =>
    p.cardsInPlay.some(c => c.instanceId === action.targetInstanceId),
  );
  const targetInChain = state.chain?.entries.some(
    e => e.cardInstanceId === action.targetInstanceId && !e.resolved && !e.negated,
  ) ?? false;
  if (!targetInEvents && !targetInCards && !targetInChain) {
    return { state, error: 'Target environment not in play or on chain' };
  }

  const targetDef = state.cardPool[
    state.instanceMap[action.targetInstanceId as string]?.definitionId as string
  ];
  logDetail(`Playing short event ${def.name}: targeting environment ${targetDef?.name ?? action.targetInstanceId} (chain will resolve the cancel)`);

  // Move short event from hand → discard
  const newHand = [...player.hand];
  newHand.splice(cardIdx, 1);

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = {
    ...player,
    hand: newHand,
    discardPile: [...player.discardPile, action.cardInstanceId],
  };

  let newState: GameState = { ...state, players: newPlayers };

  // Initiate chain or push onto existing chain — target stored in payload
  const payload: ChainEntryPayload = { type: 'short-event', targetInstanceId: action.targetInstanceId };
  if (newState.chain === null) {
    newState = initiateChain(newState, action.player, action.cardInstanceId, inst.definitionId, payload);
  } else {
    newState = pushChainEntry(newState, action.player, action.cardInstanceId, inst.definitionId, payload);
  }

  return { state: newState };
}

/**
 * Handle actions during the long-event phase.
 *
 * The resource player may play resource long-events from hand. On pass,
 * the hazard player's hazard long-events are discarded and the phase advances.
 */
function handleLongEvent(state: GameState, action: GameAction): ReducerResult {
  if (action.type === 'play-long-event') {
    return handlePlayLongEvent(state, action);
  }
  if (action.type === 'pass') {
    // [2.III.3] At end of long-event phase: hazard player discards own hazard long-events
    const activePlayer = state.activePlayer!;
    const hazardPlayerIndex = (getPlayerIndex(state, activePlayer) + 1) % state.players.length;
    const hazardPlayer = state.players[hazardPlayerIndex];
    const discardedEventIds: CardInstanceId[] = [];
    const remainingCards = hazardPlayer.cardsInPlay.filter(card => {
      const def = state.cardPool[card.definitionId as string];
      if (def && def.cardType === 'hazard-event' && def.eventType === 'long') {
        logDetail(`Long-event exit: discarding hazard long-event "${def.name}" (${card.instanceId as string})`);
        discardedEventIds.push(card.instanceId);
        return false;
      }
      return true;
    });

    const newPlayers = clonePlayers(state);
    newPlayers[hazardPlayerIndex] = {
      ...newPlayers[hazardPlayerIndex],
      cardsInPlay: remainingCards,
      discardPile: [...newPlayers[hazardPlayerIndex].discardPile, ...discardedEventIds],
    };

    logDetail(`Long-event: active player ${action.player as string} passed → advancing to Movement/Hazard phase`);
    return {
      state: {
        ...state,
        players: newPlayers,
        phaseState: {
          phase: Phase.MovementHazard,
          step: 'select-company',
          activeCompanyIndex: 0,
          handledCompanyIds: [],
          movementType: null,
          declaredRegionPath: [],
          maxRegionDistance: BASE_MAX_REGION_DISTANCE,
          pendingEffectsToOrder: [],
          hazardsPlayedThisCompany: 0,
          hazardLimit: 0,
          resolvedSitePath: [],
          resolvedSitePathNames: [],
          destinationSiteType: null,
          destinationSiteName: null,
          resourceDrawMax: 0,
          hazardDrawMax: 0,
          resourceDrawCount: 0,
          hazardDrawCount: 0,
          resourcePlayerPassed: false,
          hazardPlayerPassed: false,
          siteRevealed: false,
          onGuardPlacedThisCompany: false,
          returnedToOrigin: false,
        },
      },
    };
  }
  return { state, error: `Unexpected action '${action.type}' in long-event phase` };
}

/**
 * Handle playing a resource long-event card during the long-event phase.
 * Removes the card from hand and adds it to eventsInPlay.
 */
function handlePlayLongEvent(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'play-long-event') return { state, error: 'Expected play-long-event action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const cardIdx = player.hand.indexOf(action.cardInstanceId);
  if (cardIdx === -1) return { state, error: 'Card not in hand' };

  const inst = state.instanceMap[action.cardInstanceId as string];
  if (!inst) return { state, error: 'Card instance not found' };

  const def = state.cardPool[inst.definitionId as string];
  if (!def || def.cardType !== 'hero-resource-event' || def.eventType !== 'long') {
    return { state, error: 'Card is not a resource long-event' };
  }

  // Check uniqueness: unique long-events can't be played if already in play
  if (def.unique) {
    const alreadyInPlay = state.players.some(p =>
      p.cardsInPlay.some(c => c.definitionId === def.id),
    );
    if (alreadyInPlay) return { state, error: `${def.name} is unique and already in play` };
  }

  // Check duplication-limit with scope "game"
  if (def.effects) {
    for (const effect of def.effects) {
      if (effect.type !== 'duplication-limit' || effect.scope !== 'game') continue;
      const copiesInPlay = state.players.reduce((count, p) =>
        count + p.cardsInPlay.filter(c => {
          const cDef = state.cardPool[c.definitionId as string];
          return cDef && cDef.name === def.name;
        }).length, 0,
      );
      if (copiesInPlay >= effect.max) {
        return { state, error: `${def.name} cannot be duplicated` };
      }
    }
  }

  logDetail(`Playing resource long-event: ${def.name}`);

  const newHand = [...player.hand];
  newHand.splice(cardIdx, 1);

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = {
    ...player,
    hand: newHand,
    cardsInPlay: [...player.cardsInPlay, {
      instanceId: action.cardInstanceId,
      definitionId: inst.definitionId,
      status: CardStatus.Untapped,
    }],
  };

  return { state: { ...state, players: newPlayers } };
}

/**
 * Handle actions during the Movement/Hazard phase.
 *
 * The phase begins with the 'select-company' step where the resource player
 * picks which company to handle next. After all companies are handled, the
 * phase advances to the Site phase.
 */
function handleMovementHazard(state: GameState, action: GameAction): ReducerResult {
  const mhState = state.phaseState as MovementHazardPhaseState;

  if (mhState.step === 'select-company') {
    return handleSelectCompany(state, action, mhState);
  }

  if (mhState.step === 'reveal-new-site') {
    return handleRevealNewSite(state, action, mhState);
  }

  // set-hazard-limit step (CoE step 3): compute and fix the hazard limit, then advance
  if (mhState.step === 'set-hazard-limit') {
    if (action.type !== 'pass') {
      return { state, error: `Expected 'pass' during set-hazard-limit step, got '${action.type}'` };
    }
    const playerIndex = getPlayerIndex(state, action.player);
    const company = state.players[playerIndex].companies[mhState.activeCompanyIndex];
    const hazardLimit = computeHazardLimit(state, company);
    logDetail(`Movement/Hazard: hazard limit set to ${hazardLimit} → advancing to order-effects`);
    return {
      state: {
        ...state,
        phaseState: {
          ...mhState,
          step: 'order-effects' as const,
          hazardLimit,
        },
      },
    };
  }

  // order-effects step (CoE step 4): hazard player orders ongoing effects — dummy for now
  if (mhState.step === 'order-effects') {
    if (action.type !== 'pass') {
      return { state, error: `Expected 'pass' during order-effects step, got '${action.type}'` };
    }
    return transitionToDrawCards(state, mhState);
  }

  // draw-cards step (CoE step 5): both players draw cards simultaneously
  if (mhState.step === 'draw-cards') {
    return handleDrawCards(state, action, mhState);
  }

  // play-hazards step (CoE step 7): hazard player plays hazards, resource player may respond
  if (mhState.step === 'play-hazards') {
    return handlePlayHazards(state, action, mhState);
  }

  // reset-hand step (CoE step 8): players discard down to hand size
  if (mhState.step === 'reset-hand') {
    return handleResetHand(state, action, mhState);
  }

  return { state, error: `Unexpected step '${mhState.step as string}' in movement/hazard phase` };
}

/**
 * Handle actions during the play-hazards step (CoE step 7).
 *
 * The hazard player may play hazard long-events (and eventually creatures,
 * short-events, permanent-events, on-guard cards) up to the hazard limit.
 * Both players may pass; the company's M/H phase ends when both have passed.
 * If the hazard player takes an action after the resource player passed,
 * the resource player's pass is reset.
 */
function handlePlayHazards(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  const isResourcePlayer = action.player === state.activePlayer;

  // --- Pass ---
  if (action.type === 'pass') {
    const newMhState = {
      ...mhState,
      ...(isResourcePlayer
        ? { resourcePlayerPassed: true }
        : { hazardPlayerPassed: true }),
    };

    // Both passed → end this company's M/H phase
    if (newMhState.resourcePlayerPassed && newMhState.hazardPlayerPassed) {
      return endCompanyMH(state, newMhState);
    }

    logDetail(`Play-hazards: ${isResourcePlayer ? 'resource' : 'hazard'} player passed`);
    return { state: { ...state, phaseState: newMhState } };
  }

  // --- Play hazard ---
  if (action.type === 'play-hazard') {
    if (isResourcePlayer) {
      return { state, error: 'Only the hazard player may play hazards' };
    }
    if (mhState.hazardsPlayedThisCompany >= mhState.hazardLimit) {
      return { state, error: `Hazard limit reached (${mhState.hazardLimit})` };
    }
    return handlePlayHazardCard(state, action, mhState);
  }

  // --- Short event (e.g. Twilight canceling an environment) ---
  if (action.type === 'play-short-event') {
    return handlePlayShortEvent(state, action);
  }

  return { state, error: `Unexpected action '${action.type}' during play-hazards step` };
}

/**
 * Play a hazard card from hand during the play-hazards step.
 *
 * Currently supports hazard long-events. Playing a hazard counts as one
 * against the hazard limit. If the resource player had passed, their
 * pass is reset (they may resume taking actions).
 *
 * TODO: creatures, short-events, permanent-events, on-guard cards
 */
function handlePlayHazardCard(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  if (action.type !== 'play-hazard') return { state, error: 'Expected play-hazard action' };

  const hazardIndex = getPlayerIndex(state, action.player);
  const hazardPlayer = state.players[hazardIndex];

  // Validate card is in hand
  const cardIdx = hazardPlayer.hand.indexOf(action.cardInstanceId);
  if (cardIdx === -1) return { state, error: 'Card not in hand' };

  const inst = state.instanceMap[action.cardInstanceId as string];
  if (!inst) return { state, error: 'Card instance not found' };

  const def = state.cardPool[inst.definitionId as string];
  if (!def) return { state, error: 'Card definition not found' };

  // --- Creature handling (via chain of effects) ---
  if (def.cardType === 'hazard-creature') {
    const keyError = checkCreatureKeying(def, mhState);
    if (keyError) return { state, error: keyError };

    // Creatures must initiate a new chain — they cannot be played in response (CoE rule 307)
    if (state.chain != null) {
      return { state, error: 'Creatures must initiate a new chain — cannot be played in response' };
    }

    logDetail(`Play-hazards: hazard player plays creature "${def.name}" (${mhState.hazardsPlayedThisCompany + 1}/${mhState.hazardLimit}) — initiating chain`);

    // Move card from hand to discard
    const newHand = [...hazardPlayer.hand];
    newHand.splice(cardIdx, 1);
    const newPlayers = clonePlayers(state);
    newPlayers[hazardIndex] = {
      ...hazardPlayer,
      hand: newHand,
      discardPile: [...hazardPlayer.discardPile, action.cardInstanceId],
    };

    let newState: GameState = {
      ...state,
      players: newPlayers,
      phaseState: {
        ...mhState,
        hazardsPlayedThisCompany: mhState.hazardsPlayedThisCompany + 1,
        resourcePlayerPassed: false,
      },
    };

    // Initiate chain — when creature entry resolves, combat will start (TODO)
    newState = initiateChain(newState, action.player, action.cardInstanceId, inst.definitionId, { type: 'creature' });

    return { state: newState };
  }

  // --- Short event handling (via chain of effects) ---
  if (def.cardType === 'hazard-event' && def.eventType === 'short') {
    const bypassesLimit = def.effects?.some(e => e.type === 'play-restriction' && e.rule === 'no-hazard-limit');
    const newHazardCount = bypassesLimit ? mhState.hazardsPlayedThisCompany : mhState.hazardsPlayedThisCompany + 1;
    logDetail(`Play-hazards: hazard player plays short-event "${def.name}" (${newHazardCount}/${mhState.hazardLimit})${bypassesLimit ? ' [no-hazard-limit]' : ''}`);

    // Move card from hand to discard (short events are discarded after resolution)
    const newHand = [...hazardPlayer.hand];
    newHand.splice(cardIdx, 1);
    const newPlayers = clonePlayers(state);
    newPlayers[hazardIndex] = {
      ...hazardPlayer,
      hand: newHand,
      discardPile: [...hazardPlayer.discardPile, action.cardInstanceId],
    };

    let newState: GameState = {
      ...state,
      players: newPlayers,
      phaseState: {
        ...mhState,
        hazardsPlayedThisCompany: newHazardCount,
        resourcePlayerPassed: false,
      },
    };

    // Initiate chain or push onto existing chain
    if (newState.chain === null) {
      newState = initiateChain(newState, action.player, action.cardInstanceId, inst.definitionId, { type: 'short-event' });
    } else {
      newState = pushChainEntry(newState, action.player, action.cardInstanceId, inst.definitionId, { type: 'short-event' });
    }

    return { state: newState };
  }

  // --- Event handling (long / permanent) ---
  if (def.cardType !== 'hazard-event' || (def.eventType !== 'long' && def.eventType !== 'permanent')) {
    return { state, error: `Cannot play ${def.cardType} during play-hazards — only creatures, short-events and hazard long/permanent-events are currently supported` };
  }

  // Uniqueness check: unique events can't be played if already in play
  if (def.unique) {
    const alreadyInPlay = state.players.some(p =>
      p.cardsInPlay.some(c => c.definitionId === def.id),
    );
    if (alreadyInPlay) return { state, error: `${def.name} is unique and already in play` };
  }

  // Duplication-limit check
  if (def.effects) {
    for (const effect of def.effects) {
      if (effect.type !== 'duplication-limit' || effect.scope !== 'game') continue;
      const copiesInPlay = state.players.reduce((count, p) =>
        count + p.cardsInPlay.filter(c => {
          const cDef = state.cardPool[c.definitionId as string];
          return cDef && cDef.name === def.name;
        }).length, 0,
      );
      if (copiesInPlay >= effect.max) {
        return { state, error: `${def.name} cannot be duplicated` };
      }
    }
  }

  logDetail(`Play-hazards: hazard player plays event "${def.name}" (${mhState.hazardsPlayedThisCompany + 1}/${mhState.hazardLimit})`);

  // Move card from hand to cardsInPlay
  const newHand = [...hazardPlayer.hand];
  newHand.splice(cardIdx, 1);

  const newPlayers = clonePlayers(state);
  newPlayers[hazardIndex] = {
    ...hazardPlayer,
    hand: newHand,
    cardsInPlay: [...hazardPlayer.cardsInPlay, {
      instanceId: action.cardInstanceId,
      definitionId: inst.definitionId,
      status: CardStatus.Untapped,
    }],
  };

  return {
    state: {
      ...state,
      players: newPlayers,
      phaseState: {
        ...mhState,
        hazardsPlayedThisCompany: mhState.hazardsPlayedThisCompany + 1,
        // Reset resource player's pass — they may respond
        resourcePlayerPassed: false,
      },
    },
  };
}

/**
 * End the current company's M/H phase and either select the next company
 * or advance to the Site phase.
 */
/**
 * End the current company's M/H phase (CoE step 8).
 *
 * 1. Complete movement: update currentSite, handle site of origin.
 * 2. Draw up to hand size (automatic for both players).
 * 3. If either player exceeds hand size, transition to 'reset-hand' step
 *    for interactive discard. Otherwise advance directly.
 *
 * TODO: hand-size-modifier DSL effects (e.g. Elrond +1 at Rivendell)
 * TODO: passive conditions at end of M/H phase
 * TODO: check if other companies have unresolved movement to site of origin
 */
function endCompanyMH(state: GameState, mhState: MovementHazardPhaseState): ReducerResult {
  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const newPlayers = clonePlayers(state);

  // --- Step 8a: Complete movement ---
  const resourcePlayer = newPlayers[activeIndex];
  const company = resourcePlayer.companies[mhState.activeCompanyIndex];

  if (company.destinationSite && !mhState.returnedToOrigin) {
    const originSite = company.currentSite;
    const destSiteId = company.destinationSite;

    const updatedCompanies = [...resourcePlayer.companies];
    updatedCompanies[mhState.activeCompanyIndex] = {
      ...company,
      currentSite: { instanceId: destSiteId, definitionId: state.instanceMap[destSiteId as string].definitionId, status: CardStatus.Untapped },
      destinationSite: null,
      moved: true,
      siteOfOrigin: null,
    };

    // Handle site of origin: return to siteDeck (untapped/haven) or discard (tapped non-haven)
    // TODO: discard tapped non-haven sites once site tapping is implemented
    let newSiteDeck = [...resourcePlayer.siteDeck];
    if (originSite) {
      const originDef = state.cardPool[originSite.definitionId as string];
      const isHaven = originDef && isSiteCard(originDef) && originDef.siteType === 'haven';
      newSiteDeck = newSiteDeck.filter(id => id !== originSite.instanceId);
      if (isHaven) {
        logDetail(`Step 8: site of origin is a haven — returning to location deck`);
      } else {
        logDetail(`Step 8: site of origin is non-haven — returning to location deck (TODO: discard if tapped)`);
      }
      newSiteDeck.push(originSite.instanceId);
    }

    logDetail(`Step 8: company moved to ${mhState.destinationSiteName ?? '?'}, origin site handled`);
    newPlayers[activeIndex] = {
      ...resourcePlayer,
      companies: updatedCompanies,
      siteDeck: newSiteDeck,
    };
  } else if (mhState.returnedToOrigin) {
    const updatedCompanies = [...resourcePlayer.companies];
    updatedCompanies[mhState.activeCompanyIndex] = {
      ...company,
      destinationSite: null,
      siteOfOrigin: null,
    };
    logDetail(`Step 8: company was returned to origin — staying at current site`);
    newPlayers[activeIndex] = { ...resourcePlayer, companies: updatedCompanies };
  } else {
    const updatedCompanies = [...resourcePlayer.companies];
    updatedCompanies[mhState.activeCompanyIndex] = {
      ...company,
      siteOfOrigin: null,
    };
    newPlayers[activeIndex] = { ...resourcePlayer, companies: updatedCompanies };
  }

  // --- Step 8b: Draw up to hand size (automatic) ---
  const handSize = HAND_SIZE; // TODO: compute from DSL hand-size-modifier effects
  for (let i = 0; i < 2; i++) {
    const p = newPlayers[i];
    if (p.hand.length < handSize) {
      const drawCount = Math.min(handSize - p.hand.length, p.playDeck.length);
      if (drawCount > 0) {
        logDetail(`Step 8: player ${p.name} draws ${drawCount} card(s) to reach hand size ${handSize}`);
        newPlayers[i] = {
          ...p,
          hand: [...p.hand, ...p.playDeck.slice(0, drawCount)],
          playDeck: p.playDeck.slice(drawCount),
        };
      }
    }
  }

  // --- Step 8c: If anyone needs to discard, go to reset-hand step ---
  const needsDiscard = newPlayers.some(p => p.hand.length > handSize);
  const updatedState = { ...state, players: newPlayers };

  if (needsDiscard) {
    logDetail(`Step 8: player(s) over hand size — entering reset-hand for discard`);
    return {
      state: {
        ...updatedState,
        phaseState: {
          ...mhState,
          step: 'reset-hand' as const,
        },
      },
    };
  }

  return advanceAfterCompanyMH(updatedState, mhState);
}

/**
 * Handle the reset-hand step: players with hand > HAND_SIZE must discard.
 * Each discard-card action removes one card. Once both players are at or
 * below hand size, advance to the next company or Site phase.
 */
function handleResetHand(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  if (action.type !== 'discard-card') {
    return { state, error: `Expected 'discard-card' during reset-hand step, got '${action.type}'` };
  }

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const handSize = HAND_SIZE; // TODO: compute from DSL hand-size-modifier effects

  if (player.hand.length <= handSize) {
    return { state, error: `Player ${player.name} does not need to discard (hand: ${player.hand.length}/${handSize})` };
  }

  const cardIdx = player.hand.indexOf(action.cardInstanceId);
  if (cardIdx === -1) {
    return { state, error: 'Card not in hand' };
  }

  const newHand = [...player.hand];
  newHand.splice(cardIdx, 1);

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = {
    ...player,
    hand: newHand,
    discardPile: [...player.discardPile, action.cardInstanceId],
  };

  logDetail(`Reset-hand: player ${player.name} discards 1 card (${newHand.length}/${handSize})`);

  const updatedState = { ...state, players: newPlayers };

  // Check if both players are now at hand size
  if (newPlayers.every(p => p.hand.length <= handSize)) {
    logDetail(`Reset-hand: all players at hand size → advancing`);
    return advanceAfterCompanyMH(updatedState, mhState);
  }

  return { state: updatedState };
}

/**
 * Advance to the next company's M/H sub-phase or to the Site phase
 * after the current company's step 8 is fully resolved.
 */
function advanceAfterCompanyMH(state: GameState, mhState: MovementHazardPhaseState): ReducerResult {
  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const currentCompany = state.players[activeIndex].companies[mhState.activeCompanyIndex];
  const updatedHandled = [...mhState.handledCompanyIds, currentCompany.id];
  const remainingCount = state.players[activeIndex].companies.length - updatedHandled.length;

  if (remainingCount <= 0) {
    logDetail(`Movement/Hazard: all companies handled → advancing to Site phase`);
    return {
      state: cleanupEmptyCompanies({
        ...state,
        phaseState: {
          phase: Phase.Site,
          step: 'select-company',
          activeCompanyIndex: 0,
          handledCompanyIds: [],
          automaticAttacksResolved: 0,
          siteEntered: false,
          resourcePlayed: false,
          minorItemAvailable: false,
          declaredOnGuardAttacks: [],
          declaredAgentAttack: null,
        },
      }),
    };
  }

  logDetail(`Movement/Hazard: company ${currentCompany.id} done → returning to select-company (${remainingCount} remaining)`);
  return {
    state: {
      ...state,
      phaseState: {
        ...mhState,
        step: 'select-company' as const,
        handledCompanyIds: updatedHandled,
        movementType: null,
        declaredRegionPath: [],
        maxRegionDistance: BASE_MAX_REGION_DISTANCE,
        pendingEffectsToOrder: [],
        hazardsPlayedThisCompany: 0,
        hazardLimit: 0,
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: null,
        destinationSiteName: null,
        resourceDrawMax: 0,
        hazardDrawMax: 0,
        resourceDrawCount: 0,
        hazardDrawCount: 0,
        resourcePlayerPassed: false,
        hazardPlayerPassed: false,
        siteRevealed: false,
        onGuardPlacedThisCompany: false,
        returnedToOrigin: false,
      },
    },
  };
}

/**
 * Check whether any of the creature's region types can be keyed to the
 * company's site path.
 *
 * Each distinct region type is an independent keying option (OR). If the
 * same type appears N times on the creature card, the path must contain
 * at least N regions of that type.
 *
 * Per CoE: "If multiple of the same region type appear on the creature card,
 * the company must be moving through at least that many corresponding regions
 * (but which need not be consecutive)."
 */
function regionTypesMatch(required: readonly RegionType[], path: readonly RegionType[]): boolean {
  // Count how many of each type the creature requires
  const requiredCounts = new Map<RegionType, number>();
  for (const rt of required) requiredCounts.set(rt, (requiredCounts.get(rt) ?? 0) + 1);
  // Count how many of each type are in the path
  const pathCounts = new Map<RegionType, number>();
  for (const rt of path) pathCounts.set(rt, (pathCounts.get(rt) ?? 0) + 1);
  // Any type with enough matches in the path is sufficient (OR)
  for (const [rt, need] of requiredCounts) {
    if ((pathCounts.get(rt) ?? 0) >= need) return true;
  }
  return false;
}

/**
 * Check whether a creature can be keyed to the current company's site path
 * or destination site (CoE rule 2.IV.vii.2).
 *
 * A creature is keyable if any of its {@link CreatureKeyRestriction} entries
 * match at least one of:
 * - A region type on the company's resolved site path
 * - A region name on the company's resolved site path
 * - The destination site type
 * - The destination site name (TODO: not yet checked)
 *
 * @returns An error string if the creature cannot be keyed, or undefined if legal.
 */
function checkCreatureKeying(def: CreatureCard, mhState: MovementHazardPhaseState): string | undefined {
  for (const key of def.keyedTo) {
    // Check region types against site path (count-based: if the creature
    // lists a region type N times, the path must contain at least N of that type)
    if (key.regionTypes && key.regionTypes.length > 0) {
      if (regionTypesMatch(key.regionTypes, mhState.resolvedSitePath)) {
        logDetail(`Creature "${def.name}" keyable to region type(s): ${key.regionTypes.join(', ')}`);
        return undefined;
      }
    }
    // Check region names against site path names
    if (key.regionNames && key.regionNames.length > 0) {
      const pathNames = mhState.resolvedSitePathNames;
      if (key.regionNames.some(rn => pathNames.includes(rn))) {
        logDetail(`Creature "${def.name}" keyable to region name: ${key.regionNames.join(', ')}`);
        return undefined;
      }
    }
    // Check site types against destination
    if (key.siteTypes && key.siteTypes.length > 0 && mhState.destinationSiteType) {
      if (key.siteTypes.includes(mhState.destinationSiteType)) {
        logDetail(`Creature "${def.name}" keyable to site type: ${mhState.destinationSiteType}`);
        return undefined;
      }
    }
  }

  const keyDesc = def.keyedTo.map(k => {
    const parts: string[] = [];
    if (k.regionTypes?.length) parts.push(`regions: ${k.regionTypes.join('/')}`);
    if (k.regionNames?.length) parts.push(`named: ${k.regionNames.join('/')}`);
    if (k.siteTypes?.length) parts.push(`sites: ${k.siteTypes.join('/')}`);
    return parts.join(', ');
  }).join(' OR ');
  return `${def.name} cannot be keyed to this company's path (requires ${keyDesc})`;
}

/**
 * Handle the 'select-company' action: resource player picks which company
 * resolves its M/H sub-phase next.
 */
function handleSelectCompany(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  if (action.type !== 'select-company') {
    return { state, error: `Expected 'select-company' action during select-company step, got '${action.type}'` };
  }

  if (action.player !== state.activePlayer) {
    return { state, error: `Only the active player may select a company` };
  }

  const playerIndex = getPlayerIndex(state, state.activePlayer);
  const player = state.players[playerIndex];
  const companyIndex = player.companies.findIndex(c => c.id === action.companyId);

  if (companyIndex === -1) {
    return { state, error: `Company '${action.companyId}' not found` };
  }

  if (mhState.handledCompanyIds.includes(action.companyId)) {
    return { state, error: `Company '${action.companyId}' has already been handled this turn` };
  }

  const company = player.companies[companyIndex];
  const isMoving = company.destinationSite !== null;

  // Compute effective max region distance from base + card effects (TODO: card effect modifiers)
  const maxRegionDistance = BASE_MAX_REGION_DISTANCE;
  logDetail(`Movement/Hazard: selected company ${action.companyId} (index ${companyIndex}), moving=${isMoving}, maxRegions=${maxRegionDistance} → advancing to reveal-new-site`);
  return {
    state: {
      ...state,
      phaseState: {
        ...mhState,
        step: 'reveal-new-site' as const,
        activeCompanyIndex: companyIndex,
        siteRevealed: isMoving,
        maxRegionDistance,
      },
    },
  };
}

/**
 * Handle the 'reveal-new-site' step (CoE step 1): the new site card is
 * revealed and the resource player declares their movement path.
 *
 * For non-moving companies, accepts a 'pass' action to advance.
 * For moving companies, accepts a 'declare-path' action that sets the
 * movement type and (for region movement) the region path.
 *
 * TODO: triggering events on site reveal
 * TODO: under-deeps movement roll (stay if roll < site number)
 */
function handleRevealNewSite(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  if (action.player !== state.activePlayer) {
    return { state, error: `Only the active player may act during reveal-new-site` };
  }

  // Non-moving company: pass to advance (skip declare-path, go to set-hazard-limit)
  // Set destinationSiteType/Name to current site so creatures can be keyed to it
  if (action.type === 'pass') {
    const playerIdx = getPlayerIndex(state, action.player);
    const nonMovingCompany = state.players[playerIdx].companies[mhState.activeCompanyIndex];
    const currentSiteDef = nonMovingCompany.currentSite ? state.cardPool[nonMovingCompany.currentSite.definitionId as string] : undefined;
    const currentSite = currentSiteDef && isSiteCard(currentSiteDef) ? currentSiteDef : undefined;
    logDetail(`Movement/Hazard: non-moving company → advancing to set-hazard-limit`);
    return {
      state: {
        ...state,
        phaseState: {
          ...mhState,
          step: 'set-hazard-limit' as const,
          destinationSiteType: currentSite?.siteType ?? null,
          destinationSiteName: currentSite?.name ?? null,
        },
      },
    };
  }

  if (action.type !== 'declare-path') {
    return { state, error: `Expected 'pass' or 'declare-path' during reveal-new-site step, got '${action.type}'` };
  }

  // Resolve origin and destination sites
  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const company = player.companies[mhState.activeCompanyIndex];
  if (!company?.destinationSite) {
    return { state, error: `Active company has no destination site` };
  }

  const originDef = company.currentSite ? state.cardPool[company.currentSite.definitionId as string] : undefined;
  const destInst = state.instanceMap[company.destinationSite as string];
  const destDef = destInst ? state.cardPool[destInst.definitionId as string] : undefined;

  if (!originDef || !isSiteCard(originDef) || !destDef || !isSiteCard(destDef)) {
    return { state, error: `Could not resolve origin or destination site definitions` };
  }

  // Compute resolved site path (region types) and region names
  let resolvedSitePath: RegionType[] = [];
  const resolvedSitePathNames: string[] = [];

  if (action.movementType === 'starter') {
    // Starter: use the site card's sitePath for region types
    const originIsHaven = originDef.siteType === 'haven';
    const destIsHaven = destDef.siteType === 'haven';
    if (originIsHaven && destIsHaven && originDef.havenPaths) {
      resolvedSitePath = [...(originDef.havenPaths[destDef.name] ?? [])];
    } else if (originIsHaven && !destIsHaven) {
      resolvedSitePath = [...destDef.sitePath];
    } else if (!originIsHaven && destIsHaven) {
      resolvedSitePath = [...originDef.sitePath];
    }
    // Names: origin and destination regions
    if (originDef.region) resolvedSitePathNames.push(originDef.region);
    if (destDef.region && destDef.region !== originDef.region) resolvedSitePathNames.push(destDef.region);
  } else if (action.movementType === 'region' && action.regionPath) {
    // Region: look up each region's regionType and name
    for (const regionDefId of action.regionPath) {
      const regionDef = state.cardPool[regionDefId as string];
      if (regionDef && regionDef.cardType === 'region') {
        resolvedSitePath.push(regionDef.regionType);
        resolvedSitePathNames.push(regionDef.name);
      }
    }
  }

  logDetail(`Movement/Hazard: path declared (${action.movementType}, ${resolvedSitePath.length} region types: ${resolvedSitePath.join(', ')}) → advancing to set-hazard-limit`);
  return {
    state: {
      ...state,
      phaseState: {
        ...mhState,
        step: 'set-hazard-limit' as const,
        movementType: action.movementType,
        declaredRegionPath: action.regionPath ?? [],
        resolvedSitePath,
        resolvedSitePathNames,
        destinationSiteType: destDef.siteType,
        destinationSiteName: destDef.name,
      },
    },
  };
}

/**
 * Generate a unique company ID for a player by finding the highest existing
 * index among their companies and incrementing it. This avoids ID collisions
 * that can occur when companies are merged (removing lower-indexed IDs) and
 * then new companies are created.
 */
function nextCompanyId(player: PlayerState): CompanyId {
  const maxIdx = player.companies.reduce((max, c) => {
    const match = (c.id as string).match(/company-.*-(\d+)$/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, -1);
  return `company-${player.id as string}-${maxIdx + 1}` as CompanyId;
}

/**
 * Compute the effective company size, accounting for hobbits and orc scouts
 * each counting as half a character (rounded up for the total).
 *
 * Per CoE rules: "The number of characters in a company, with each Hobbit
 * or Orc scout character only counting as half of a character (rounded up)."
 */
function getCompanySize(state: GameState, company: Company): number {
  let halfCount = 0;
  let fullCount = 0;
  for (const charInstId of company.characters) {
    const inst = state.instanceMap[charInstId as string];
    if (!inst) { fullCount++; continue; }
    const def = state.cardPool[inst.definitionId as string];
    if (!def || !isCharacterCard(def)) { fullCount++; continue; }
    const isHobbit = def.race === Race.Hobbit;
    const isOrcScout = def.race === Race.Orc && def.skills.includes(Skill.Scout);
    if (isHobbit || isOrcScout) {
      halfCount++;
      logDetail(`  ${def.name} (${def.race}${isOrcScout ? '/scout' : ''}) counts as half`);
    } else {
      fullCount++;
    }
  }
  const size = Math.ceil(fullCount + halfCount / 2);
  logDetail(`Company size: ${fullCount} full + ${halfCount} half = ${size}`);
  return size;
}

/**
 * Compute the base hazard limit for a company (CoE step 3, rule 2.IV.iii).
 *
 * The limit equals the greater of the company's current size or 2,
 * then halved (rounded up) if the hazard player accessed the sideboard
 * during this turn's untap phase. The result is fixed for the entire
 * company's M/H phase, even if characters are later eliminated.
 */
function computeHazardLimit(state: GameState, company: Company): number {
  const companySize = getCompanySize(state, company);
  let limit = Math.max(companySize, 2);
  logDetail(`Hazard limit (step 3): company size ${companySize} → base limit ${limit}`);

  // Hazard player is the non-active player
  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const hazardIndex = 1 - activeIndex;
  const hazardPlayer = state.players[hazardIndex];

  if (hazardPlayer.sideboardAccessedDuringUntap) {
    const halved = Math.ceil(limit / 2);
    logDetail(`Hazard limit halved (hazard player accessed sideboard during untap): ${limit} → ${halved}`);
    limit = halved;
  }

  logDetail(`Hazard limit set to ${limit}`);
  return limit;
}

/**
 * Transition from order-effects to draw-cards (CoE step 5).
 *
 * If the company is not moving, skip draws entirely and go to play-hazards.
 * Otherwise, compute the max draw counts from the appropriate site card:
 * - New site if moving to a non-haven
 * - Site of origin if moving to a haven
 *
 * The resource player may only draw if the company contains an avatar
 * (wizard/ringwraith with mind null) or a character with mind ≥ 3.
 */
function transitionToDrawCards(state: GameState, mhState: MovementHazardPhaseState): ReducerResult {
  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const player = state.players[activeIndex];
  const company = player.companies[mhState.activeCompanyIndex];

  // Non-moving company: skip draws entirely
  if (!company.destinationSite) {
    logDetail(`Movement/Hazard: company not moving — skipping draw-cards → play-hazards`);
    return {
      state: {
        ...state,
        phaseState: {
          ...mhState,
          step: 'play-hazards' as const,
        },
      },
    };
  }

  // Determine which site card provides draw numbers
  const destInst = state.instanceMap[company.destinationSite as string];
  const destDef = destInst ? state.cardPool[destInst.definitionId as string] : undefined;
  const originDef = company.currentSite ? state.cardPool[company.currentSite.definitionId as string] : undefined;

  // Use new site for non-haven destination, site of origin for haven destination
  const movingToHaven = destDef && isSiteCard(destDef) && destDef.siteType === 'haven';
  const drawSite = movingToHaven ? originDef : destDef;

  let resourceDrawMax = 0;
  let hazardDrawMax = 0;

  if (drawSite && isSiteCard(drawSite)) {
    hazardDrawMax = drawSite.hazardDraws;

    // Resource player may only draw if company has an avatar or character with mind ≥ 3
    const hasEligibleCharacter = company.characters.some(charInstId => {
      const inst = state.instanceMap[charInstId as string];
      if (!inst) return false;
      const def = state.cardPool[inst.definitionId as string];
      if (!def || !isCharacterCard(def)) return false;
      return def.mind === null || def.mind >= 3;
    });

    if (hasEligibleCharacter) {
      resourceDrawMax = drawSite.resourceDraws;
    } else {
      logDetail(`No avatar or character with mind ≥ 3 — resource player cannot draw`);
    }
  }

  logDetail(`Movement/Hazard: order-effects done → draw-cards (resource max: ${resourceDrawMax}, hazard max: ${hazardDrawMax}, site: ${drawSite && isSiteCard(drawSite) ? drawSite.name : '?'})`);

  return {
    state: {
      ...state,
      phaseState: {
        ...mhState,
        step: 'draw-cards' as const,
        resourceDrawMax,
        hazardDrawMax,
        resourceDrawCount: 0,
        hazardDrawCount: 0,
      },
    },
  };
}

/**
 * Handle actions during the draw-cards step (CoE step 5).
 *
 * Both players draw simultaneously. Each gets `draw-cards` (count: 1)
 * to draw one card at a time. After the first mandatory draw, `pass`
 * becomes available to stop drawing early. Once a player has drawn
 * their max or passed, they are done. When both are done, advance
 * to play-hazards.
 */
function handleDrawCards(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  const isResourcePlayer = action.player === state.activePlayer;
  const actingIndex = getPlayerIndex(state, action.player);

  const drawnSoFar = isResourcePlayer ? mhState.resourceDrawCount : mhState.hazardDrawCount;
  const drawMax = isResourcePlayer ? mhState.resourceDrawMax : mhState.hazardDrawMax;
  const playerLabel = isResourcePlayer ? 'resource' : 'hazard';

  // Pass: allowed after first mandatory draw, or if max is 0
  if (action.type === 'pass') {
    if (drawnSoFar === 0 && drawMax > 0) {
      return { state, error: `${playerLabel} player must draw at least 1 card before passing` };
    }

    logDetail(`Movement/Hazard draw-cards: ${playerLabel} player passed (drew ${drawnSoFar}/${drawMax})`);
    return advanceDrawCards(state, mhState, isResourcePlayer, drawMax);
  }

  // Deck exhaustion: reshuffle discard into play deck
  if (action.type === 'deck-exhaust') {
    const exPlayer = state.players[actingIndex];
    if (exPlayer.playDeck.length > 0) {
      return { state, error: 'Cannot exhaust — play deck is not empty' };
    }
    if (exPlayer.discardPile.length === 0) {
      return { state, error: 'Cannot exhaust — discard pile is also empty' };
    }
    return { state: exhaustPlayDeck(state, actingIndex) };
  }

  if (action.type !== 'draw-cards' || action.count !== 1) {
    return { state, error: `Expected 'draw-cards' (count: 1), 'deck-exhaust', or 'pass' during draw-cards step, got '${action.type}'` };
  }

  if (drawnSoFar >= drawMax) {
    return { state, error: `${playerLabel} player has already drawn maximum (${drawMax}) cards` };
  }

  // Draw 1 card from play deck into hand
  const player = state.players[actingIndex];
  if (player.playDeck.length === 0) {
    logDetail(`Movement/Hazard draw-cards: ${playerLabel} player has no cards to draw`);
    return advanceDrawCards(state, mhState, isResourcePlayer, drawMax);
  }

  const drawnCard = player.playDeck[0];
  const newPlayers = clonePlayers(state);
  newPlayers[actingIndex] = {
    ...player,
    hand: [...player.hand, drawnCard],
    playDeck: player.playDeck.slice(1),
  };

  const newDrawCount = drawnSoFar + 1;
  logDetail(`Movement/Hazard draw-cards: ${playerLabel} player drew card ${newDrawCount}/${drawMax}`);

  const newMhState = {
    ...mhState,
    ...(isResourcePlayer
      ? { resourceDrawCount: newDrawCount }
      : { hazardDrawCount: newDrawCount }),
  };

  // If this player just hit their max, check if both are done
  if (newDrawCount >= drawMax) {
    const otherDone = isResourcePlayer
      ? newMhState.hazardDrawCount >= newMhState.hazardDrawMax
      : newMhState.resourceDrawCount >= newMhState.resourceDrawMax;

    if (otherDone) {
      logDetail(`Movement/Hazard draw-cards: both players done → advancing to play-hazards`);
      return {
        state: {
          ...state,
          players: newPlayers,
          phaseState: { ...newMhState, step: 'play-hazards' as const },
        },
      };
    }
  }

  return {
    state: {
      ...state,
      players: newPlayers,
      phaseState: newMhState,
    },
  };
}

/**
 * Mark a player as done drawing and advance to play-hazards if both are done.
 */
function advanceDrawCards(
  state: GameState,
  mhState: MovementHazardPhaseState,
  isResourcePlayer: boolean,
  drawMax: number,
): ReducerResult {
  // Mark this player as done by setting their draw count to max
  const newMhState = {
    ...mhState,
    ...(isResourcePlayer
      ? { resourceDrawCount: drawMax }
      : { hazardDrawCount: drawMax }),
  };

  const otherDone = isResourcePlayer
    ? newMhState.hazardDrawCount >= newMhState.hazardDrawMax
    : newMhState.resourceDrawCount >= newMhState.resourceDrawMax;

  if (otherDone) {
    logDetail(`Movement/Hazard draw-cards: both players done → advancing to play-hazards`);
    return {
      state: {
        ...state,
        phaseState: { ...newMhState, step: 'play-hazards' as const },
      },
    };
  }

  return {
    state: {
      ...state,
      phaseState: newMhState,
    },
  };
}

/**
 * Handle all actions during the site phase.
 *
 * The phase begins with the 'select-company' step where the resource player
 * picks which company to handle next. After all companies are handled, the
 * phase advances to the End-of-Turn phase.
 */
function handleSite(state: GameState, action: GameAction): ReducerResult {
  const siteState = state.phaseState as SitePhaseState;

  if (siteState.step === 'select-company') {
    return handleSiteSelectCompany(state, action, siteState);
  }

  if (siteState.step === 'enter-or-skip') {
    return handleSiteEnterOrSkip(state, action, siteState);
  }

  if (siteState.step === 'reveal-on-guard-attacks') {
    return handleSitePassStep(state, action, siteState, 'reveal-on-guard-attacks', 'automatic-attacks');
  }

  if (siteState.step === 'automatic-attacks') {
    return handleSiteAutomaticAttacks(state, action, siteState);
  }

  if (siteState.step === 'declare-agent-attack') {
    return handleSitePassStep(state, action, siteState, 'declare-agent-attack', 'resolve-attacks', true);
  }

  if (siteState.step === 'resolve-attacks') {
    return handleSitePassStep(state, action, siteState, 'resolve-attacks', 'play-resources');
  }

  if (siteState.step === 'play-resources') {
    return handleSitePlayResources(state, action, siteState);
  }

  // TODO: play-minor-item

  if (action.type !== 'pass') {
    return { state, error: `Unexpected action '${action.type}' in site phase step '${siteState.step}'` };
  }

  logDetail(`Site: active player ${action.player as string} passed → advancing to End-of-Turn phase`);
  return {
    state: {
      ...state,
      phaseState: { phase: Phase.EndOfTurn, step: 'discard' as const, discardDone: [false, false] as const },
    },
  };
}

/**
 * Handle the 'select-company' action in the site phase: resource player
 * picks which company resolves its site phase next.
 *
 * After selection, the company advances to 'enter-or-skip'. Companies
 * that were returned to their site of origin during M/H are automatically
 * skipped (CoE line 336).
 */
function handleSiteSelectCompany(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
): ReducerResult {
  if (action.type !== 'select-company') {
    return { state, error: `Expected 'select-company' action during select-company step, got '${action.type}'` };
  }

  if (action.player !== state.activePlayer) {
    return { state, error: `Only the active player may select a company` };
  }

  const playerIndex = getPlayerIndex(state, state.activePlayer);
  const player = state.players[playerIndex];
  const companyIndex = player.companies.findIndex(c => c.id === action.companyId);

  if (companyIndex === -1) {
    return { state, error: `Company '${action.companyId}' not found` };
  }

  if (siteState.handledCompanyIds.includes(action.companyId)) {
    return { state, error: `Company '${action.companyId}' has already been handled this turn` };
  }

  logDetail(`Site: selected company ${action.companyId} (index ${companyIndex}) → advancing to enter-or-skip`);
  return {
    state: {
      ...state,
      phaseState: {
        ...siteState,
        step: 'enter-or-skip' as const,
        activeCompanyIndex: companyIndex,
        automaticAttacksResolved: 0,
        siteEntered: false,
        resourcePlayed: false,
        minorItemAvailable: false,
        declaredOnGuardAttacks: [],
        declaredAgentAttack: null,
      },
    },
  };
}

/**
 * Handle the 'enter-or-skip' step: resource player decides whether to
 * enter the site or do nothing.
 *
 * - `enter-site`: advances to reveal-on-guard-attacks (if auto-attacks
 *   exist) or directly to play-resources.
 * - `pass`: the company does nothing; its site phase ends immediately
 *   and we advance to the next company (CoE lines 341–343).
 */
function handleSiteEnterOrSkip(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
): ReducerResult {
  if (action.type !== 'enter-site' && action.type !== 'pass') {
    return { state, error: `Expected 'enter-site' or 'pass' during enter-or-skip step, got '${action.type}'` };
  }

  if (action.player !== state.activePlayer) {
    return { state, error: `Only the active player may enter or skip a site` };
  }

  const playerIndex = getPlayerIndex(state, state.activePlayer);
  const player = state.players[playerIndex];
  const company = player.companies[siteState.activeCompanyIndex];

  // Pass = do nothing, company's site phase ends immediately
  if (action.type === 'pass') {
    logDetail(`Site: company ${company.id} does nothing → advancing to next company`);
    return advanceSiteToNextCompany(state, siteState, company.id);
  }

  // Enter site — check whether the site has automatic-attacks
  const siteInPlay = company.currentSite;
  const siteDef = siteInPlay ? state.cardPool[siteInPlay.definitionId as string] : undefined;
  const autoAttackCount = siteDef && isSiteCard(siteDef) ? siteDef.automaticAttacks.length : 0;

  if (autoAttackCount > 0) {
    logDetail(`Site: company ${company.id} enters site with ${autoAttackCount} automatic-attack(s) → advancing to reveal-on-guard-attacks`);
    return {
      state: {
        ...state,
        phaseState: {
          ...siteState,
          step: 'reveal-on-guard-attacks' as const,
        },
      },
    };
  }

  // No automatic-attacks — skip straight to declare-agent-attack
  logDetail(`Site: company ${company.id} enters site with no automatic-attacks → advancing to declare-agent-attack`);
  return {
    state: {
      ...state,
      phaseState: {
        ...siteState,
        step: 'declare-agent-attack' as const,
        siteEntered: true,
      },
    },
  };
}

/**
 * Handle the 'automatic-attacks' step: initiate combat for each automatic
 * attack listed on the site card, one at a time.
 *
 * When entering this step, if no combat is active, the next unresolved
 * automatic attack initiates combat. The `automaticAttacksResolved` counter
 * tracks progress. When all auto-attacks are resolved, advances to
 * 'declare-agent-attack'.
 */
function handleSiteAutomaticAttacks(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
): ReducerResult {
  if (action.type !== 'pass') {
    return { state, error: `Expected 'pass' during automatic-attacks step` };
  }

  const activePlayerIndex = state.players.findIndex(p => p.id === state.activePlayer);
  const company = state.players[activePlayerIndex].companies[siteState.activeCompanyIndex];
  if (!company?.currentSite) return { state, error: 'No company or site for automatic attacks' };

  const siteDef = state.cardPool[company.currentSite.definitionId as string];
  if (!siteDef || !isSiteCard(siteDef)) return { state, error: 'Site definition not found' };

  const attackIndex = siteState.automaticAttacksResolved;
  const autoAttacks = siteDef.automaticAttacks;

  if (attackIndex >= autoAttacks.length) {
    // All automatic attacks resolved — advance to declare-agent-attack
    logDetail('Site: all automatic attacks resolved → declare-agent-attack');
    return {
      state: {
        ...state,
        phaseState: { ...siteState, step: 'declare-agent-attack' as const, siteEntered: true },
      },
    };
  }

  // Initiate combat for the next automatic attack
  const aa = autoAttacks[attackIndex];
  const hazardPlayerId = state.players.find(p => p.id !== state.activePlayer)!.id;

  logDetail(`Site: initiating automatic attack ${attackIndex + 1}/${autoAttacks.length}: ${aa.creatureType} (${aa.strikes} strikes, ${aa.prowess} prowess)`);

  const combat: CombatState = {
    attackSource: { type: 'automatic-attack', siteInstanceId: company.currentSite.instanceId, attackIndex },
    companyId: company.id,
    defendingPlayerId: state.activePlayer!,
    attackingPlayerId: hazardPlayerId,
    strikesTotal: aa.strikes,
    strikeProwess: aa.prowess,
    creatureBody: null,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: 'defender',
    bodyCheckTarget: null,
    detainment: false,
  };

  return {
    state: {
      ...state,
      combat,
      phaseState: { ...siteState, automaticAttacksResolved: attackIndex + 1 },
    },
  };
}

/**
 * Handle the 'play-resources' step: resource player plays items or
 * permanent events, or passes to end the company's site phase.
 *
 * - `play-hero-resource`: play an item at the site. Taps the carrying
 *   character. The item is attached to the character.
 * - `play-permanent-event`: delegated to the existing org-phase handler.
 * - `pass`: ends this company's site phase, advances to next company.
 */
function handleSitePlayResources(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
): ReducerResult {
  if (action.player !== state.activePlayer) {
    return { state, error: `Only the active player may play resources` };
  }

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const company = player.companies[siteState.activeCompanyIndex];

  // Pass — end this company's site phase
  if (action.type === 'pass') {
    logDetail(`Site: company ${company.id} done playing resources → advancing to next company`);
    return advanceSiteToNextCompany(state, siteState, company.id);
  }

  // Permanent events — reuse the existing handler (phase-independent)
  if (action.type === 'play-permanent-event') {
    return handlePlayPermanentEvent(state, action);
  }

  // Play hero resource (items)
  if (action.type === 'play-hero-resource') {
    return handleSitePlayHeroResource(state, action, siteState);
  }

  return { state, error: `Unexpected action '${action.type}' in play-resources step` };
}

/**
 * Handle playing a hero resource (item) at a site.
 *
 * Validates the card is in hand, is an item playable at this site type,
 * the target character is untapped and in the company, then attaches the
 * item and taps the character.
 */
function handleSitePlayHeroResource(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
): ReducerResult {
  if (action.type !== 'play-hero-resource') return { state, error: 'Expected play-hero-resource action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const company = player.companies[siteState.activeCompanyIndex];

  // Validate card is in hand
  const cardIdx = player.hand.indexOf(action.cardInstanceId);
  if (cardIdx === -1) return { state, error: 'Card not in hand' };

  const inst = state.instanceMap[action.cardInstanceId as string];
  if (!inst) return { state, error: 'Card instance not found' };

  const def = state.cardPool[inst.definitionId as string];
  const isItem = isItemCard(def);
  const isAlly = !isItem && isAllyCard(def);
  if (!def || (!isItem && !isAlly)) return { state, error: 'Card is not an item or ally' };

  // Check site allows this resource
  const siteInPlay = company.currentSite;
  const siteDef = siteInPlay ? state.cardPool[siteInPlay.definitionId as string] : undefined;
  if (!siteDef || !isSiteCard(siteDef)) return { state, error: 'Company is not at a valid site' };

  if (isItem) {
    if (!siteDef.playableResources.includes((def as HeroItemCard).subtype)) {
      return { state, error: `${(def as HeroItemCard).subtype} items cannot be played at ${siteDef.name}` };
    }
  }

  // Validate target character
  const targetCharId = action.attachToCharacterId;
  if (!targetCharId) return { state, error: 'Must specify a character to carry this resource' };

  if (!company.characters.includes(targetCharId)) {
    return { state, error: 'Target character is not in this company' };
  }

  const charInPlay = player.characters[targetCharId as string];
  if (!charInPlay) return { state, error: 'Target character not found' };
  if (charInPlay.status !== CardStatus.Untapped) {
    return { state, error: 'Target character is not untapped' };
  }

  // Check site is not already tapped
  if (siteInPlay!.status === CardStatus.Tapped) {
    return { state, error: 'Site is already tapped' };
  }

  const charDef = state.cardPool[charInPlay.definitionId as string];
  const charName = charDef?.name ?? targetCharId;
  logDetail(`Site: playing ${def.name} on ${charName} — tapping character and site`);

  // Remove card from hand
  const newHand = [...player.hand];
  newHand.splice(cardIdx, 1);

  // Tap the character and attach the item or ally
  const updatedChar: CharacterInPlay = {
    ...charInPlay,
    status: CardStatus.Tapped,
    items: isItem
      ? [...charInPlay.items, { instanceId: action.cardInstanceId, definitionId: inst.definitionId, status: CardStatus.Untapped }]
      : charInPlay.items,
    allies: isAlly
      ? [...charInPlay.allies, { instanceId: action.cardInstanceId, definitionId: inst.definitionId, status: CardStatus.Untapped }]
      : charInPlay.allies,
  };

  const newCharacters = { ...player.characters, [targetCharId as string]: updatedChar };
  const newPlayers = clonePlayers(state);

  // Tap the site by updating company's currentSite status
  const newCompanies = [...player.companies];
  newCompanies[siteState.activeCompanyIndex] = {
    ...company,
    currentSite: { ...siteInPlay!, status: CardStatus.Tapped },
  };

  newPlayers[playerIndex] = { ...player, hand: newHand, characters: newCharacters, companies: newCompanies };

  return {
    state: {
      ...state,
      players: newPlayers,
      phaseState: {
        ...siteState,
        resourcePlayed: true,
      },
    },
  };
}

/**
 * Handle a site phase step that currently only accepts 'pass' to advance
 * to the next step. Used as a stub for reveal-on-guard-attacks,
 * automatic-attacks, and declare-agent-attack until full logic is implemented.
 *
 * @param markEntered - If true, sets siteEntered when advancing (used after
 *   the last attack step to mark the company as having successfully entered).
 */
function handleSitePassStep(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
  currentStep: string,
  nextStep: SitePhaseState['step'],
  markEntered?: boolean,
): ReducerResult {
  if (action.type !== 'pass') {
    return { state, error: `Expected 'pass' during ${currentStep} step, got '${action.type}'` };
  }
  if (action.player !== state.activePlayer) {
    return { state, error: `Only the active player may pass during ${currentStep}` };
  }

  logDetail(`Site: ${currentStep} → advancing to ${nextStep}`);
  return {
    state: {
      ...state,
      phaseState: {
        ...siteState,
        step: nextStep,
        ...(markEntered ? { siteEntered: true } : {}),
      },
    },
  };
}

/**
 * Advance the site phase to the next company or to End-of-Turn if all
 * companies have been handled.
 */
function advanceSiteToNextCompany(
  state: GameState,
  siteState: SitePhaseState,
  handledCompanyId: CompanyId,
): ReducerResult {
  const updatedHandled = [...siteState.handledCompanyIds, handledCompanyId];

  const playerIndex = getPlayerIndex(state, state.activePlayer!);
  const remainingCount = state.players[playerIndex].companies.length - updatedHandled.length;

  if (remainingCount <= 0) {
    logDetail(`Site: all companies handled → advancing to End-of-Turn phase`);
    return {
      state: cleanupEmptyCompanies({
        ...state,
        phaseState: { phase: Phase.EndOfTurn, step: 'discard' as const, discardDone: [false, false] as const },
      }),
    };
  }

  logDetail(`Site: company ${handledCompanyId} done → returning to select-company (${remainingCount} remaining)`);
  return {
    state: {
      ...state,
      phaseState: {
        ...siteState,
        step: 'select-company' as const,
        handledCompanyIds: updatedHandled,
        automaticAttacksResolved: 0,
        siteEntered: false,
        resourcePlayed: false,
        minorItemAvailable: false,
        declaredOnGuardAttacks: [],
        declaredAgentAttack: null,
      },
    },
  };
}

/**
 * End-of-turn phase handler (CoE 2.VI).
 *
 * Dispatches to sub-step handlers:
 * 1. discard — voluntary discard by either player
 * 2. reset-hand — draw/discard to base hand size
 * 3. signal-end — resource player ends the turn
 */
function handleEndOfTurn(state: GameState, action: GameAction): ReducerResult {
  const eotState = state.phaseState as EndOfTurnPhaseState;

  switch (eotState.step) {
    case 'discard':
      return handleEndOfTurnDiscard(state, action, eotState);
    case 'reset-hand':
      return handleEndOfTurnResetHand(state, action, eotState);
    case 'signal-end':
      return handleEndOfTurnSignalEnd(state, action);
    default: {
      const _exhaustive: never = eotState.step;
      return { state, error: `Unknown end-of-turn step` };
    }
  }
}

/**
 * Step 1 (discard): Either player may discard a card from hand.
 *
 * Both players act independently. Each may discard one card or pass.
 * Once both have acted (discard or pass), advance to reset-hand.
 */
function handleEndOfTurnDiscard(
  state: GameState,
  action: GameAction,
  eotState: EndOfTurnPhaseState,
): ReducerResult {
  const playerIndex = getPlayerIndex(state, action.player);

  if (eotState.discardDone[playerIndex]) {
    return { state, error: `Player already acted in discard step` };
  }

  /** Mark this player done and advance to reset-hand if both are done. */
  function markDone(updatedState: GameState, updatedEot: EndOfTurnPhaseState): ReducerResult {
    const newDone: [boolean, boolean] = [...updatedEot.discardDone] as [boolean, boolean];
    newDone[playerIndex] = true;

    if (newDone[0] && newDone[1]) {
      logDetail(`End-of-Turn discard: both players done → advancing to reset-hand`);
      return {
        state: {
          ...updatedState,
          phaseState: { ...updatedEot, step: 'reset-hand' as const, discardDone: newDone },
        },
      };
    }

    logDetail(`End-of-Turn discard: player ${action.player as string} done, waiting for other player`);
    return {
      state: {
        ...updatedState,
        phaseState: { ...updatedEot, discardDone: newDone },
      },
    };
  }

  if (action.type === 'pass') {
    logDetail(`End-of-Turn discard: player ${action.player as string} passed`);
    return markDone(state, eotState);
  }

  if (action.type === 'discard-card') {
    const player = state.players[playerIndex];
    const cardIdx = player.hand.indexOf(action.cardInstanceId);

    if (cardIdx === -1) {
      return { state, error: 'Card not in hand' };
    }

    const newHand = [...player.hand];
    newHand.splice(cardIdx, 1);

    const newPlayers = clonePlayers(state);
    newPlayers[playerIndex] = {
      ...player,
      hand: newHand,
      discardPile: [...player.discardPile, action.cardInstanceId],
    };

    logDetail(`End-of-Turn discard: player ${player.name} discarded 1 card (hand now ${newHand.length})`);
    return markDone({ ...state, players: newPlayers }, eotState);
  }

  return { state, error: `Unexpected action '${action.type}' in end-of-turn discard step` };
}

/**
 * Step 2 (reset-hand): Both players draw or discard to base hand size (8).
 *
 * Players above hand size must discard one card at a time. Players below
 * hand size draw all at once. Once both are at hand size, advance to
 * signal-end.
 */
function handleEndOfTurnResetHand(
  state: GameState,
  action: GameAction,
  eotState: EndOfTurnPhaseState,
): ReducerResult {
  const handSize = HAND_SIZE; // TODO: compute from DSL hand-size-modifier effects

  if (action.type === 'pass') {
    // Pass is valid at hand size, or when deck and discard are both empty (can't draw)
    const playerIndex = getPlayerIndex(state, action.player);
    const player = state.players[playerIndex];
    const cannotDraw = player.playDeck.length === 0 && player.discardPile.length === 0;
    if (player.hand.length !== handSize && !cannotDraw) {
      return { state, error: `Cannot pass during reset-hand: hand has ${player.hand.length} cards, need ${handSize}` };
    }

    logDetail(`End-of-Turn reset-hand: player ${player.name} at hand size, passed`);

    // Check if both players are now at hand size
    const otherIndex = (playerIndex === 0 ? 1 : 0);
    if (state.players[otherIndex].hand.length === handSize) {
      logDetail(`End-of-Turn reset-hand: both players at hand size → advancing to signal-end`);
      return {
        state: {
          ...state,
          phaseState: { ...eotState, step: 'signal-end' as const },
        },
      };
    }

    return { state };
  }

  if (action.type === 'discard-card') {
    const playerIndex = getPlayerIndex(state, action.player);
    const player = state.players[playerIndex];

    if (player.hand.length <= handSize) {
      return { state, error: `Player ${player.name} does not need to discard (hand: ${player.hand.length}/${handSize})` };
    }

    const cardIdx = player.hand.indexOf(action.cardInstanceId);
    if (cardIdx === -1) {
      return { state, error: 'Card not in hand' };
    }

    const newHand = [...player.hand];
    newHand.splice(cardIdx, 1);

    const newPlayers = clonePlayers(state);
    newPlayers[playerIndex] = {
      ...player,
      hand: newHand,
      discardPile: [...player.discardPile, action.cardInstanceId],
    };

    logDetail(`End-of-Turn reset-hand: player ${player.name} discards 1 card (${newHand.length}/${handSize})`);

    // Check if both players are now at hand size
    const otherIndex = (playerIndex === 0 ? 1 : 0);
    if (newHand.length === handSize && newPlayers[otherIndex].hand.length === handSize) {
      logDetail(`End-of-Turn reset-hand: both players at hand size → advancing to signal-end`);
      return {
        state: {
          ...state,
          players: newPlayers,
          phaseState: { ...eotState, step: 'signal-end' as const },
        },
      };
    }

    return { state: { ...state, players: newPlayers } };
  }

  if (action.type === 'deck-exhaust') {
    const playerIndex = getPlayerIndex(state, action.player);
    const player = state.players[playerIndex];
    if (player.playDeck.length > 0) {
      return { state, error: 'Cannot exhaust — play deck is not empty' };
    }
    if (player.discardPile.length === 0) {
      return { state, error: 'Cannot exhaust — discard pile is also empty' };
    }
    return { state: exhaustPlayDeck(state, playerIndex) };
  }

  if (action.type === 'draw-cards') {
    const playerIndex = getPlayerIndex(state, action.player);
    const player = state.players[playerIndex];

    if (player.hand.length >= handSize) {
      return { state, error: `Player ${player.name} does not need to draw (hand: ${player.hand.length}/${handSize})` };
    }

    if (player.playDeck.length === 0) {
      logDetail(`End-of-Turn reset-hand: player ${player.name} has no cards to draw`);
      // Treat as if they reached hand size (can't draw more)
      const otherIndex = (playerIndex === 0 ? 1 : 0);
      if (state.players[otherIndex].hand.length === handSize) {
        return {
          state: { ...state, phaseState: { ...eotState, step: 'signal-end' as const } },
        };
      }
      return { state };
    }

    const drawCount = Math.min(action.count, handSize - player.hand.length);
    const cardsToDrawCount = Math.min(drawCount, player.playDeck.length);
    const drawnCards = player.playDeck.slice(0, cardsToDrawCount);
    const newHand = [...player.hand, ...drawnCards];
    const newPlayDeck = player.playDeck.slice(cardsToDrawCount);

    const newPlayers = clonePlayers(state);
    newPlayers[playerIndex] = {
      ...player,
      hand: newHand,
      playDeck: newPlayDeck,
    };

    logDetail(`End-of-Turn reset-hand: player ${player.name} drew ${cardsToDrawCount} cards (${newHand.length}/${handSize})`);

    // Check if both players are now at hand size
    const otherIndex = (playerIndex === 0 ? 1 : 0);
    if (newHand.length === handSize && newPlayers[otherIndex].hand.length === handSize) {
      logDetail(`End-of-Turn reset-hand: both players at hand size → advancing to signal-end`);
      return {
        state: { ...state, players: newPlayers, phaseState: { ...eotState, step: 'signal-end' as const } },
      };
    }

    return { state: { ...state, players: newPlayers } };
  }

  return { state, error: `Unexpected action '${action.type}' in end-of-turn reset-hand step` };
}

/**
 * Step 3 (signal-end): Resource player signals end of turn.
 * Pass switches the active player and advances to the next turn's Untap phase.
 */
function handleEndOfTurnSignalEnd(state: GameState, action: GameAction): ReducerResult {
  if (action.type === 'pass') {
    const currentIndex = getPlayerIndex(state, state.activePlayer!);
    const nextIndex = (currentIndex === 0 ? 1 : 0);
    const nextPlayer = state.players[nextIndex].id;

    // Check if this was the opponent's last turn after a Free Council call
    if (state.lastTurnFor === state.activePlayer) {
      logDetail(`End-of-Turn signal-end: ${action.player as string} finished their last turn → transitioning to Free Council`);
      return {
        state: transitionToFreeCouncil(state, state.activePlayer!),
      };
    }

    // Check auto-end: both players exhausted their deck twice
    if (state.players[0].deckExhaustionCount >= 2 && state.players[1].deckExhaustionCount >= 2) {
      logDetail(`End-of-Turn signal-end: both players exhausted deck twice → transitioning to Free Council`);
      return {
        state: transitionToFreeCouncil(state, state.activePlayer!),
      };
    }

    logDetail(`End-of-Turn signal-end: active player ${action.player as string} ended turn → switching to player ${nextPlayer as string}, turn ${state.turnNumber + 1}`);
    return {
      state: {
        ...state,
        activePlayer: nextPlayer,
        turnNumber: state.turnNumber + 1,
        phaseState: { phase: Phase.Untap },
      },
    };
  }

  if (action.type === 'call-free-council') {
    const currentIndex = getPlayerIndex(state, state.activePlayer!);
    const nextIndex = (currentIndex === 0 ? 1 : 0);
    const nextPlayer = state.players[nextIndex].id;

    const newPlayers = clonePlayers(state);
    newPlayers[currentIndex] = { ...newPlayers[currentIndex], freeCouncilCalled: true };

    logDetail(`End-of-Turn signal-end: ${action.player as string} called the Free Council — opponent ${nextPlayer as string} gets one last turn`);
    return {
      state: {
        ...state,
        players: newPlayers,
        activePlayer: nextPlayer,
        turnNumber: state.turnNumber + 1,
        lastTurnFor: nextPlayer,
        phaseState: { phase: Phase.Untap },
      },
    };
  }

  return { state, error: `Unexpected action '${action.type}' in end-of-turn signal-end step` };
}

/**
 * Creates the initial Free Council phase state. The player who took the last
 * turn performs corruption checks first.
 */
function transitionToFreeCouncil(state: GameState, lastTurnPlayer: PlayerId): GameState {
  logHeading('Transitioning to Free Council phase');
  return {
    ...state,
    activePlayer: lastTurnPlayer,
    phaseState: {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: lastTurnPlayer,
      checkedCharacters: [],
      firstPlayerDone: false,
    },
  };
}

/**
 * Handles actions during the Free Council phase.
 *
 * During 'corruption-checks' step, each player performs corruption checks
 * for their characters in turn. When both players have finished (or passed),
 * final scores are computed and the game transitions to Game Over.
 */
function handleFreeCouncil(state: GameState, action: GameAction): ReducerResult {
  const fcState = state.phaseState as FreeCouncilPhaseState;

  if (fcState.step === 'done') {
    return { state, error: 'Free Council scoring is complete' };
  }

  // Handle corruption check (reuse the same dice logic as organization phase)
  if (action.type === 'corruption-check') {
    const playerIndex = getPlayerIndex(state, action.player);
    const player = state.players[playerIndex];
    const char = player.characters[action.characterId as string];
    if (!char) return { state, error: 'Character not found' };

    const charDef = state.cardPool[state.instanceMap[action.characterId as string]?.definitionId as string];
    const charName = charDef?.name ?? '?';
    const cp = action.corruptionPoints;
    const modifier = action.corruptionModifier;

    const { roll, rng, cheatRollTotal } = roll2d6(state);
    const total = roll.die1 + roll.die2 + modifier;
    const modStr = modifier !== 0 ? ` ${modifier >= 0 ? '+' : ''}${modifier}` : '';
    logDetail(`Free Council corruption check for ${charName}: rolled ${roll.die1} + ${roll.die2}${modStr} = ${total} vs CP ${cp}`);

    const rollEffect: GameEffect = {
      effect: 'dice-roll',
      playerName: player.name,
      die1: roll.die1,
      die2: roll.die2,
      label: `Corruption: ${charName}`,
    };

    const newPlayers = clonePlayers(state);
    newPlayers[playerIndex] = { ...newPlayers[playerIndex], lastDiceRoll: roll };

    const newChecked = [...fcState.checkedCharacters, action.characterId as string];

    if (total > cp) {
      // Passed
      logDetail(`Free Council corruption check passed (${total} > ${cp})`);
      return {
        state: {
          ...state,
          players: newPlayers,
          rng, cheatRollTotal,
          phaseState: { ...fcState, checkedCharacters: newChecked },
        },
        effects: [rollEffect],
      };
    }

    // Failed — character is discarded or eliminated
    const newCharacters = { ...player.characters };
    delete newCharacters[action.characterId as string];

    const newCompanies = player.companies.map(c => ({
      ...c,
      characters: c.characters.filter(id => id !== action.characterId),
    }));

    // Followers promoted to general influence
    for (const followerId of char.followers) {
      const follower = newCharacters[followerId as string];
      if (follower) {
        newCharacters[followerId as string] = { ...follower, controlledBy: 'general' };
      }
    }

    if (total >= cp - 1) {
      // Roll == CP or CP-1: character and possessions discarded
      logDetail(`Free Council corruption check FAILED (${total} within 1 of ${cp}) — discarding ${charName}`);
      const toDiscard = [action.characterId, ...action.possessions];
      newPlayers[playerIndex] = {
        ...newPlayers[playerIndex],
        characters: newCharacters,
        companies: newCompanies,
        discardPile: [...player.discardPile, ...toDiscard],
      };
    } else {
      // Roll < CP-1: character eliminated, possessions discarded
      logDetail(`Free Council corruption check FAILED (${total} < ${cp - 1}) — eliminating ${charName}`);
      newPlayers[playerIndex] = {
        ...newPlayers[playerIndex],
        characters: newCharacters,
        companies: newCompanies,
        eliminatedPile: [...player.eliminatedPile, action.characterId],
        discardPile: [...player.discardPile, ...action.possessions],
      };
    }

    return {
      state: cleanupEmptyCompanies({
        ...state,
        players: newPlayers,
        rng, cheatRollTotal,
        phaseState: { ...fcState, checkedCharacters: newChecked },
      }),
      effects: [rollEffect],
    };
  }

  if (action.type === 'pass') {
    if (fcState.firstPlayerDone) {
      // Both players done — compute final scores and transition to Game Over
      logDetail(`Free Council: both players finished corruption checks → computing final scores`);
      return { state: computeFinalScoresAndEnd(state) };
    }

    // Switch to the other player for their corruption checks
    const currentIndex = getPlayerIndex(state, fcState.currentPlayer);
    const otherIndex = currentIndex === 0 ? 1 : 0;
    const otherPlayer = state.players[otherIndex].id;

    logDetail(`Free Council: ${action.player as string} done with corruption checks → switching to ${otherPlayer as string}`);
    return {
      state: {
        ...state,
        phaseState: { ...fcState, currentPlayer: otherPlayer, checkedCharacters: [], firstPlayerDone: true },
      },
    };
  }

  return { state, error: `Unexpected action '${action.type}' in Free Council phase` };
}

/**
 * Computes final tournament scores for both players and transitions to Game Over.
 * Applies steps 2-4 (via computeTournamentScore), step 6 (avatar elimination penalty),
 * and determines the winner (step 7).
 */
function computeFinalScoresAndEnd(state: GameState): GameState {
  const p0 = state.players[0];
  const p1 = state.players[1];

  let score0 = computeTournamentScore(p0.marshallingPoints, p1.marshallingPoints);
  let score1 = computeTournamentScore(p1.marshallingPoints, p0.marshallingPoints);

  // Step 6: -5 misc MP penalty if avatar is eliminated
  // Avatar is the first character in the eliminated pile that matches the player's avatar type
  // For simplicity, check if any character in eliminatedPile was an avatar (wizard/ringwraith)
  if (hasEliminatedAvatar(state, 0)) {
    logDetail(`Player ${p0.name} has eliminated avatar — applying -5 penalty`);
    score0 -= 5;
  }
  if (hasEliminatedAvatar(state, 1)) {
    logDetail(`Player ${p1.name} has eliminated avatar — applying -5 penalty`);
    score1 -= 5;
  }

  logHeading(`Final scores: ${p0.name} = ${score0}, ${p1.name} = ${score1}`);

  let winner: PlayerId | null = null;
  if (score0 > score1) winner = p0.id;
  else if (score1 > score0) winner = p1.id;

  if (winner) {
    const winnerName = state.players.find(p => p.id === winner)?.name ?? '?';
    logDetail(`Winner: ${winnerName}`);
  } else {
    logDetail(`Game ended in a tie`);
  }

  return {
    ...state,
    phaseState: {
      phase: Phase.GameOver,
      winner,
      finalScores: {
        [p0.id as string]: score0,
        [p1.id as string]: score1,
      },
    },
  };
}

/**
 * Checks whether a player's avatar (wizard or ringwraith) has been eliminated.
 * Looks through the eliminated pile for any character with the avatar flag.
 */
function hasEliminatedAvatar(state: GameState, playerIndex: 0 | 1): boolean {
  const player = state.players[playerIndex];
  for (const cardId of player.eliminatedPile) {
    const inst = state.instanceMap[cardId as string];
    if (!inst) continue;
    const def = state.cardPool[inst.definitionId as string];
    if (def && isCharacterCard(def) && (def.race === Race.Wizard || def.race === Race.Ringwraith)) {
      return true;
    }
  }
  return false;
}

// ---- Combat sub-state handlers ----

/**
 * Dispatch a combat action to the appropriate handler based on the
 * current combat sub-phase.
 */
function handleCombatAction(state: GameState, action: GameAction): ReducerResult {
  const combat = state.combat;
  if (!combat) return { state, error: 'No combat active' };

  switch (action.type) {
    case 'assign-strike':
      return handleAssignStrike(state, action, combat);
    case 'pass':
      return handleCombatPass(state, action, combat);
    case 'choose-strike-order':
      return handleChooseStrikeOrder(state, action, combat);
    case 'resolve-strike':
      return handleResolveStrike(state, action, combat);
    case 'support-strike':
      return handleSupportStrike(state, action, combat);
    case 'body-check-roll':
      return handleBodyCheckRoll(state, action, combat);
    default:
      return { state, error: `Unexpected action '${action.type}' during combat` };
  }
}

/**
 * Compute the next combat phase after all strikes are assigned or a strike finishes resolving.
 * If multiple unresolved strikes remain, enters choose-strike-order so the defender picks.
 * If exactly one remains, auto-selects it and goes to resolve-strike.
 * Returns null if all strikes are resolved (caller should finalize combat).
 */
function nextStrikePhase(combat: CombatState): Partial<CombatState> | null {
  const unresolvedIndices: number[] = [];
  for (let i = 0; i < combat.strikeAssignments.length; i++) {
    if (!combat.strikeAssignments[i].resolved) unresolvedIndices.push(i);
  }
  if (unresolvedIndices.length === 0) return null;
  if (unresolvedIndices.length === 1) {
    logDetail(`One unresolved strike remaining (index ${unresolvedIndices[0]}) — auto-selecting`);
    return { phase: 'resolve-strike', currentStrikeIndex: unresolvedIndices[0], bodyCheckTarget: null };
  }
  logDetail(`${unresolvedIndices.length} unresolved strikes — defender chooses order`);
  return { phase: 'choose-strike-order', bodyCheckTarget: null };
}

/** Handle the defender choosing which strike to resolve next. */
function handleChooseStrikeOrder(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'choose-strike-order') return { state, error: 'Expected choose-strike-order' };
  if (combat.phase !== 'choose-strike-order') return { state, error: 'Not in choose-strike-order phase' };
  if (action.player !== combat.defendingPlayerId) return { state, error: 'Only defending player can choose strike order' };

  const idx = action.strikeIndex;
  if (idx < 0 || idx >= combat.strikeAssignments.length) return { state, error: 'Invalid strike index' };
  if (combat.strikeAssignments[idx].resolved) return { state, error: 'Strike already resolved' };

  logDetail(`Defender chose to resolve strike ${idx} (character ${combat.strikeAssignments[idx].characterId as string})`);
  return {
    state: { ...state, combat: { ...combat, phase: 'resolve-strike', currentStrikeIndex: idx } },
  };
}

/** Assign a strike to a defending character. */
function handleAssignStrike(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'assign-strike') return { state, error: 'Expected assign-strike' };
  if (combat.phase !== 'assign-strikes') return { state, error: 'Not in assign-strikes phase' };

  const totalAllocated = combat.strikeAssignments.length
    + combat.strikeAssignments.reduce((sum, a) => sum + a.excessStrikes, 0);
  const strikesRemaining = combat.strikesTotal - totalAllocated;
  if (strikesRemaining <= 0) return { state, error: 'All strikes already assigned' };

  // Validate character is in the defending company
  const defPlayerIndex = state.players.findIndex(p => p.id === combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];
  const company = defPlayer.companies.find(c => c.id === combat.companyId);
  if (!company) return { state, error: 'Defending company not found' };
  if (!company.characters.includes(action.characterId)) {
    return { state, error: 'Character not in defending company' };
  }

  const existingIdx = combat.strikeAssignments.findIndex(a => a.characterId === action.characterId);

  let newAssignments: StrikeAssignment[];
  if (existingIdx >= 0) {
    // Excess strike: character already has a strike, add -1 prowess penalty
    if (combat.assignmentPhase !== 'attacker') {
      return { state, error: 'Only attacker can assign excess strikes' };
    }
    newAssignments = combat.strikeAssignments.map((a, i) =>
      i === existingIdx ? { ...a, excessStrikes: a.excessStrikes + 1 } : a,
    );
    logDetail(`Excess strike assigned to ${action.characterId as string} (now ${newAssignments[existingIdx].excessStrikes} excess)`);
  } else {
    // Normal assignment: new strike to this character
    newAssignments = [...combat.strikeAssignments, {
      characterId: action.characterId,
      excessStrikes: 0,
      resolved: false,
    }];
    logDetail(`Strike assigned to ${action.characterId as string} (${newAssignments.length}/${combat.strikesTotal})`);
  }

  const newTotalAllocated = newAssignments.length
    + newAssignments.reduce((sum, a) => sum + a.excessStrikes, 0);
  const allAssigned = newTotalAllocated >= combat.strikesTotal;

  let newCombatState: CombatState = { ...combat, strikeAssignments: newAssignments };
  if (allAssigned) {
    const next = nextStrikePhase(newCombatState);
    newCombatState = { ...newCombatState, assignmentPhase: 'done', ...next };
  }

  return { state: { ...state, combat: newCombatState } };
}

/** Defender passes during strike assignment — attacker assigns remaining. */
function handleCombatPass(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'pass') return { state, error: 'Expected pass' };
  if (combat.phase !== 'assign-strikes' || combat.assignmentPhase !== 'defender') {
    return { state, error: 'Can only pass during defender strike assignment' };
  }

  const totalAllocated = combat.strikeAssignments.length
    + combat.strikeAssignments.reduce((sum, a) => sum + a.excessStrikes, 0);
  const strikesRemaining = combat.strikesTotal - totalAllocated;

  // If no strikes remain, transition to resolve (via choose-strike-order if multiple)
  if (strikesRemaining <= 0) {
    logDetail('Defender passed with all strikes assigned — transitioning to resolve');
    const next = nextStrikePhase(combat);
    return {
      state: { ...state, combat: { ...combat, assignmentPhase: 'done', ...next } },
    };
  }

  logDetail(`Defender passed — ${strikesRemaining} strike(s) remaining, attacker assigns`);
  return {
    state: { ...state, combat: { ...combat, assignmentPhase: 'attacker' } },
  };
}

/** Resolve the current strike — roll dice and determine outcome. */
function handleResolveStrike(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'resolve-strike') return { state, error: 'Expected resolve-strike' };
  if (combat.phase !== 'resolve-strike') return { state, error: 'Not in resolve-strike phase' };

  const strike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (!strike || strike.resolved) return { state, error: 'Current strike already resolved' };

  // Look up character stats
  const defPlayerIndex = state.players.findIndex(p => p.id === combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];
  const charData = defPlayer.characters[strike.characterId as string];
  if (!charData) return { state, error: 'Character not found' };

  // Compute effective prowess
  let prowess = charData.effectiveStats.prowess;
  if (!action.tapToFight) prowess -= 3;  // Stay untapped penalty
  if (charData.status === CardStatus.Tapped) prowess -= 1;
  if (charData.status === CardStatus.Inverted) prowess -= 2; // Wounded
  if (strike.excessStrikes > 0) prowess -= strike.excessStrikes; // Excess strikes penalty

  // Roll dice
  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const rollTotal = roll.die1 + roll.die2;
  const characterTotal = rollTotal + prowess;

  const defPlayer2 = state.players[defPlayerIndex];
  logDetail(`Strike resolution: ${charData.definitionId as string} rolls ${roll.die1}+${roll.die2}=${rollTotal} + prowess ${prowess} = ${characterTotal} vs creature prowess ${combat.strikeProwess}`);

  const charDef = state.cardPool[charData.definitionId as string];
  const charLabel = charDef && 'name' in charDef ? (charDef as { name: string }).name : (charData.definitionId as string);
  const effects: GameEffect[] = [{
    effect: 'dice-roll', playerName: defPlayer2.name,
    die1: roll.die1, die2: roll.die2, label: `Strike: ${charLabel}`,
  }];

  // Determine outcome
  let result: 'success' | 'wounded' | 'eliminated';
  let bodyCheckTarget: 'character' | 'creature' | null = null;

  if (characterTotal > combat.strikeProwess) {
    // Character wins — strike defeated
    result = 'success';
    if (combat.creatureBody !== null) {
      bodyCheckTarget = 'creature'; // Body check against creature
    }
    logDetail(`Character defeats strike — ${bodyCheckTarget ? 'body check vs creature' : 'creature has no body'}`);
  } else if (characterTotal < combat.strikeProwess) {
    // Strike wins — character wounded
    result = 'wounded';
    bodyCheckTarget = 'character'; // Body check against character
    logDetail('Strike succeeds — character wounded, body check vs character');
  } else {
    // Tie — ineffectual
    result = 'success'; // Character survives
    logDetail('Tie — ineffectual, character taps');
  }

  // Update strike assignment
  const newAssignments = combat.strikeAssignments.map((a, i) =>
    i === combat.currentStrikeIndex ? { ...a, resolved: true, result } : a,
  );

  // Tap or wound character
  const newPlayers = clonePlayers(state);
  const newCharacters = { ...defPlayer.characters };
  if (action.tapToFight || characterTotal === combat.strikeProwess) {
    // Tap character (unless staying untapped)
    if (charData.status === CardStatus.Untapped) {
      newCharacters[strike.characterId as string] = { ...charData, status: CardStatus.Tapped };
    }
  }
  if (result === 'wounded' && !combat.detainment) {
    // Wound (invert) character
    newCharacters[strike.characterId as string] = {
      ...(newCharacters[strike.characterId as string] ?? charData),
      status: CardStatus.Inverted,
    };
  } else if (result === 'wounded' && combat.detainment) {
    // Detainment: tap instead of wound
    newCharacters[strike.characterId as string] = {
      ...(newCharacters[strike.characterId as string] ?? charData),
      status: CardStatus.Tapped,
    };
  }
  newPlayers[defPlayerIndex] = { ...defPlayer, characters: newCharacters, lastDiceRoll: roll };

  // Determine next phase
  let newCombat: CombatState;
  if (bodyCheckTarget) {
    newCombat = {
      ...combat,
      strikeAssignments: newAssignments,
      phase: 'body-check',
      bodyCheckTarget,
    };
  } else {
    // No body check — advance to next strike or finish combat
    const combatWithAssignments = { ...combat, strikeAssignments: newAssignments };
    const next = nextStrikePhase(combatWithAssignments);
    if (!next) {
      return finalizeCombat({ ...state, players: newPlayers, rng, cheatRollTotal, combat: combatWithAssignments }, effects);
    }
    newCombat = { ...combatWithAssignments, ...next };
  }

  return {
    state: { ...state, players: newPlayers, rng, cheatRollTotal, combat: newCombat },
    effects,
  };
}

/** Tap a supporting character for +1 prowess on the current strike. */
function handleSupportStrike(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'support-strike') return { state, error: 'Expected support-strike' };
  if (combat.phase !== 'resolve-strike') return { state, error: 'Not in resolve-strike phase' };

  const defPlayerIndex = state.players.findIndex(p => p.id === combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];

  // Check if supporter is a character
  const supporterChar = defPlayer.characters[action.supportingCharacterId as string];
  if (supporterChar) {
    if (supporterChar.status !== CardStatus.Untapped) return { state, error: 'Supporting character must be untapped' };
    const newPlayers = clonePlayers(state);
    const newCharacters = { ...defPlayer.characters };
    newCharacters[action.supportingCharacterId as string] = { ...supporterChar, status: CardStatus.Tapped };
    newPlayers[defPlayerIndex] = { ...defPlayer, characters: newCharacters };
    logDetail(`${action.supportingCharacterId as string} taps to support — +1 prowess`);
    return { state: { ...state, players: newPlayers } };
  }

  // Check if supporter is an ally
  for (const charId of Object.keys(defPlayer.characters)) {
    const ch = defPlayer.characters[charId];
    const allyIndex = ch.allies.findIndex(a => a.instanceId === action.supportingCharacterId);
    if (allyIndex >= 0) {
      const ally = ch.allies[allyIndex];
      if (ally.status !== CardStatus.Untapped) return { state, error: 'Supporting ally must be untapped' };
      const newPlayers = clonePlayers(state);
      const newAllies = [...ch.allies];
      newAllies[allyIndex] = { ...ally, status: CardStatus.Tapped };
      const newCharacters = { ...defPlayer.characters };
      newCharacters[charId] = { ...ch, allies: newAllies };
      newPlayers[defPlayerIndex] = { ...defPlayer, characters: newCharacters };
      logDetail(`Ally ${action.supportingCharacterId as string} taps to support — +1 prowess`);
      return { state: { ...state, players: newPlayers } };
    }
  }

  return { state, error: 'Supporting character or ally not found' };
}

/** Roll body check — attacker rolls 2d6 vs body value. */
function handleBodyCheckRoll(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'body-check-roll') return { state, error: 'Expected body-check-roll' };
  if (combat.phase !== 'body-check') return { state, error: 'Not in body-check phase' };

  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const rollTotal = roll.die1 + roll.die2;
  const atkPlayerIndex = state.players.findIndex(p => p.id === combat.attackingPlayerId);
  const effects: GameEffect[] = [{
    effect: 'dice-roll', playerName: state.players[atkPlayerIndex].name,
    die1: roll.die1, die2: roll.die2, label: `Body check: ${combat.bodyCheckTarget}`,
  }];

  // Update lastDiceRoll on the attacking player
  const basePlayers = clonePlayers(state);
  basePlayers[atkPlayerIndex] = { ...basePlayers[atkPlayerIndex], lastDiceRoll: roll };
  const stateWithRoll: GameState = { ...state, players: basePlayers, rng, cheatRollTotal };

  if (combat.bodyCheckTarget === 'creature') {
    // Body check against creature
    const body = combat.creatureBody ?? 0;
    logDetail(`Body check vs creature: roll ${rollTotal} vs body ${body}`);
    if (rollTotal > body) {
      logDetail('Creature body check failed — creature defeated');
      // Mark in strike assignment that the creature was defeated on this strike
    } else {
      logDetail('Creature body check passed — creature survives');
    }

    // Advance to next strike or finalize
    const next1 = nextStrikePhase(combat);
    if (next1) {
      return { state: { ...stateWithRoll, combat: { ...combat, ...next1 } }, effects };
    }
    return finalizeCombat(stateWithRoll, effects);
  }

  if (combat.bodyCheckTarget === 'character') {
    // Body check against character
    const strike = combat.strikeAssignments[combat.currentStrikeIndex];
    const defPlayerIndex = stateWithRoll.players.findIndex(p => p.id === combat.defendingPlayerId);
    const defPlayer = stateWithRoll.players[defPlayerIndex];
    const charData = defPlayer.characters[strike.characterId as string];
    if (!charData) return { state, error: 'Character not found for body check' };

    const charDef2 = stateWithRoll.cardPool[charData.definitionId as string] as { body?: number } | undefined;
    const body = charDef2?.body ?? 9; // Default body if not specified
    const woundedBonus = charData.status === CardStatus.Inverted ? 1 : 0;
    const effectiveRoll = rollTotal + woundedBonus;

    logDetail(`Body check vs character: roll ${rollTotal}${woundedBonus ? '+1(wounded)' : ''} = ${effectiveRoll} vs body ${body}`);

    if (effectiveRoll > body) {
      // Character eliminated
      logDetail('Character eliminated');
      const newAssignments = combat.strikeAssignments.map((a, i) =>
        i === combat.currentStrikeIndex ? { ...a, result: 'eliminated' as const } : a,
      );

      // Remove character from company and add to eliminated pile
      const newPlayers2 = clonePlayers(stateWithRoll);
      const newPlayerData = { ...defPlayer };
      const company = newPlayerData.companies.find(c => c.id === combat.companyId);
      if (company) {
        const newCompanies = newPlayerData.companies.map(c =>
          c.id === combat.companyId
            ? { ...c, characters: c.characters.filter(ch => ch !== strike.characterId) }
            : c,
        );
        newPlayerData.companies = newCompanies;
      }
      // Move to eliminated pile (full item transfer deferred to Phase 4)
      newPlayerData.eliminatedPile = [...newPlayerData.eliminatedPile, strike.characterId];
      const { [strike.characterId as string]: _, ...remainingChars } = newPlayerData.characters;
      newPlayerData.characters = remainingChars;
      newPlayers2[defPlayerIndex] = newPlayerData;

      // Advance to next strike or finalize
      const combatWithElim = { ...combat, strikeAssignments: newAssignments };
      const next2 = nextStrikePhase(combatWithElim);
      if (next2) {
        return { state: { ...stateWithRoll, players: newPlayers2, combat: { ...combatWithElim, ...next2 } }, effects };
      }
      return finalizeCombat({ ...stateWithRoll, players: newPlayers2, combat: combatWithElim }, effects);
    }

    logDetail('Character survives body check');
    // Advance to next strike or finalize
    const next3 = nextStrikePhase(combat);
    if (next3) {
      return { state: { ...stateWithRoll, combat: { ...combat, ...next3 } }, effects };
    }
    return finalizeCombat(stateWithRoll, effects);
  }

  return { state, error: 'Invalid body check target' };
}

/**
 * Finalize combat after all strikes are resolved.
 *
 * If all strikes were defeated (result === 'success'), the creature card
 * moves from the hazard player's discard pile to the defending player's
 * marshalling point pile. Otherwise it stays in discard.
 */
function finalizeCombat(state: GameState, effects: GameEffect[] = []): ReducerResult {
  const combat = state.combat;
  if (!combat) return { state, error: 'No combat to finalize' };

  const allDefeated = combat.strikeAssignments.length > 0
    && combat.strikeAssignments.every(a => a.result === 'success');

  const newPlayers = clonePlayers(state);

  if (allDefeated && combat.attackSource.type === 'creature') {
    // Move creature from attacker's discard to defender's MP pile
    const atkIdx = state.players.findIndex(p => p.id === combat.attackingPlayerId);
    const defIdx = state.players.findIndex(p => p.id === combat.defendingPlayerId);
    const creatureInstanceId = combat.attackSource.instanceId;

    const atkDiscard = newPlayers[atkIdx].discardPile.filter(id => id !== creatureInstanceId);
    newPlayers[atkIdx] = { ...newPlayers[atkIdx], discardPile: atkDiscard };
    newPlayers[defIdx] = {
      ...newPlayers[defIdx],
      killPile: [...newPlayers[defIdx].killPile, creatureInstanceId],
    };

    logDetail(`All strikes defeated — creature moved to defender's MP pile`);
  } else {
    logDetail(`Combat ended — creature stays in attacker's discard`);
  }

  logDetail('Combat finalized — returning to enclosing phase');

  return {
    state: { ...state, players: newPlayers, combat: null },
    effects,
  };
}
