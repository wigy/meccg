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

import type { GameState, PlayerState, DraftPlayerState, ItemDraftPlayerState, CharacterDeckDraftPlayerState, SetupStepState, CardDefinitionId, CardInstanceId, CompanyId, CharacterInPlay, CardInstance, OrganizationPhaseState, Company } from '@meccg/shared';
import type { GameAction } from '@meccg/shared';
import { Phase, SetupStep, LEGAL_ACTIONS_BY_PHASE, getAlignmentRules, shuffle, nextInt, CardStatus, isCharacterCard, isSiteCard, SiteType, getPlayerIndex, ZERO_EFFECTIVE_STATS, MAX_STARTING_ITEMS } from '@meccg/shared';
import { logHeading, logDetail } from './legal-actions/log.js';
import type { TwoDiceSix, DieRoll, GameEffect } from '@meccg/shared';
import { applyDraftResults, transitionAfterItemDraft, enterSiteSelection, startFirstTurn } from './init.js';
import { recomputeDerived } from './recompute-derived.js';

/** Creates a mutable copy of the 2-player tuple, preserving the tuple type. */
function clonePlayers(state: GameState): [PlayerState, PlayerState] {
  return [{ ...state.players[0] }, { ...state.players[1] }];
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
  //    Clear touchedCards whenever the phase changes.
  if (!result.error) {
    const recomputed = recomputeDerived(result.state);
    const phaseChanged = recomputed.phaseState.phase !== state.phaseState.phase;
    result = {
      state: {
        ...recomputed,
        stateSeq: recomputed.stateSeq + 1,
        ...(phaseChanged ? { touchedCards: [] } : {}),
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


  // During movement/hazard phase, the non-active player plays hazards
  if (phase === 'movement-hazard' && action.type === 'play-hazard') {
    if (action.player === state.activePlayer) {
      return 'Active player cannot play hazards';
    }
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
      if (!playerDraft.pool.includes(action.characterDefId)) {
        return { state, error: 'Character not in your draft pool' };
      }
      // Check mind constraint
      const charDef = state.cardPool[action.characterDefId as string];
      if (!isCharacterCard(charDef)) {
        return { state, error: 'Invalid character' };
      }
      const currentMind = playerDraft.drafted.reduce((sum, defId) => {
        const def = state.cardPool[defId as string];
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
        currentPick: action.characterDefId,
        pool: playerDraft.pool.filter(id => id !== action.characterDefId),
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
  setAside: readonly CardDefinitionId[],
): ReducerResult {
  const pick0 = draftState[0].currentPick;
  const pick1 = draftState[1].currentPick;
  const newSetAside = [...setAside];

  // Resolve each player's pick
  const newDraft: [DraftPlayerState, DraftPlayerState] = [
    { ...draftState[0], currentPick: null },
    { ...draftState[1], currentPick: null },
  ];

  if (pick0 !== null && pick1 !== null && pick0 === pick1) {
    // Duplicate! Neither gets it — also remove from both pools
    newSetAside.push(pick0);
    newDraft[0] = { ...newDraft[0], pool: newDraft[0].pool.filter(id => id !== pick0) };
    newDraft[1] = { ...newDraft[1], pool: newDraft[1].pool.filter(id => id !== pick0) };
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
      const mind = newDraft[i].drafted.reduce((sum, defId) => {
        const def = state.cardPool[defId as string];
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
  setAside: readonly CardDefinitionId[],
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
  if (!deckDraft.remainingPool.includes(action.characterDefId)) {
    return { state, error: 'Character is not in your remaining pool' };
  }

  // Validate non-avatar limit
  const def = state.cardPool[action.characterDefId as string];
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

  // Mint instance and add to play deck
  const counter = Object.keys(state.instanceMap).length;
  const instanceId = `i-${counter}` as CardInstanceId;
  const newInstance: CardInstance = { instanceId, definitionId: action.characterDefId };
  const newInstanceMap = { ...state.instanceMap, [instanceId as string]: newInstance };

  const player = state.players[playerIndex];
  const newPlayDeck = [...player.playDeck, instanceId];
  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...player, playDeck: newPlayDeck };

  // Remove from remaining pool
  const newPool = deckDraft.remainingPool.filter(id => id !== action.characterDefId);
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

import type { SiteSelectionPlayerState } from '@meccg/shared';

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
      companies[0] = { ...companies[0], currentSite: selectedSites[0] };
    }

    // Second site creates an additional empty company
    if (selectedSites.length > 1) {
      companies.push({
        id: `company-${player.id as string}-${companies.length}` as CompanyId,
        characters: [],
        currentSite: selectedSites[1],
        destinationSite: null,
        movementPath: [],
        moved: false,
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

    // Return sites from empty companies to site deck
    const returnedSites = emptyCompanies
      .map(c => c.currentSite)
      .filter((s): s is CardInstanceId => s !== null);
    const newSiteDeck = [...player.siteDeck, ...returnedSites];

    return { ...player, companies: keptCompanies, siteDeck: newSiteDeck };
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
  let rng = state.rng;
  const [d1raw, rng2] = nextInt(rng, 6);
  const [d2raw, rng3] = nextInt(rng2, 6);
  rng = rng3;
  const d1 = d1raw + 1;
  const d2 = d2raw + 1;
  const roll: TwoDiceSix = { die1: d1 as DieRoll, die2: d2 as DieRoll };
  logDetail(`${state.players[playerIndex].name} rolls initiative: ${d1} + ${d2} = ${d1 + d2}`);
  const rollEffect: GameEffect = {
    effect: 'dice-roll',
    playerName: state.players[playerIndex].name,
    die1: roll.die1,
    die2: roll.die2,
    label: 'Initiative',
  };

  const newRolls = [...stepState.rolls] as [TwoDiceSix | null, TwoDiceSix | null];
  newRolls[playerIndex] = roll;

  // If opponent hasn't rolled yet, just record and wait
  if (newRolls[0] === null || newRolls[1] === null) {
    return {
      state: {
        ...state,
        phaseState: setupPhase({ ...stepState, rolls: newRolls }),
        rng,
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
        ...state,
        phaseState: setupPhase({ ...stepState, rolls: [null, null] }),
        rng,
      },
      effects: [rollEffect],
    };
  }

  // Winner goes first
  const winner = total0 > total1 ? state.players[0] : state.players[1];
  logDetail(`${winner.name} wins initiative (${total0} vs ${total1}) — goes first`);
  const firstPlayer = winner.id;
  return {
    state: startFirstTurn({ ...state, activePlayer: firstPlayer, rng }),
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

  logDetail(`Untap: active player ${action.player as string} passed → advancing to Organization phase`);
  return {
    state: {
      ...state,
      phaseState: { phase: Phase.Organization, characterPlayedThisTurn: false },
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
    return {
      state: {
        ...state,
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
  if (action.type === 'move-to-influence') {
    return handleMoveToInfluence(state, action);
  }
  // TODO: split-company, merge-companies, transfer-item
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
  const existingCompanyIdx = companies.findIndex(c => c.currentSite === action.atSite);

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
      id: `company-${player.id as string}-${companies.length}` as CompanyId,
      characters: [charInstId],
      currentSite: siteInstId,
      destinationSite: null,
      movementPath: [],
      moved: false,
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
      touchedCards: [...state.touchedCards, charInstId],
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

  return {
    state: {
      ...state,
      players: newPlayers,
      touchedCards: [...state.touchedCards, charInstId],
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

  logDetail(`Plan movement: company ${company.id as string} → ${action.destinationSite as string} (${action.movementType})`);

  const companies = [...player.companies];
  companies[companyIdx] = {
    ...company,
    destinationSite: action.destinationSite,
    movementPath: action.regionPath,
  };

  // Remove destination site from site deck
  const siteDeck = player.siteDeck.filter(id => id !== action.destinationSite);

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...player, companies, siteDeck };
  return { state: { ...state, players: newPlayers, touchedCards: [...state.touchedCards, action.destinationSite] } };
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
  return { state: { ...state, players: newPlayers, touchedCards: [...state.touchedCards, company.destinationSite] } };
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

/** Stub: resolve long events, then advance to movement/hazard. */
function handleLongEvent(state: GameState, _action: GameAction): ReducerResult {
  // TODO: resolve long events, advance to movement/hazard
  return { state };
}

/** Stub: reveal destinations, opponent plays hazards, resolve combat. */
function handleMovementHazard(state: GameState, _action: GameAction): ReducerResult {
  // TODO: reveal destinations, hazard play, combat resolution
  return { state };
}

/** Stub: automatic attacks at site, resource play, influence attempts. */
function handleSite(state: GameState, _action: GameAction): ReducerResult {
  // TODO: automatic attacks, resource play, influence attempts
  return { state };
}

/** Stub: draw/discard to hand size, check Free Council trigger. */
function handleEndOfTurn(state: GameState, _action: GameAction): ReducerResult {
  // TODO: draw/discard to hand size, check free council trigger
  return { state };
}

/** Stub: tally marshalling points, run tiebreaker corruption checks. */
function handleFreeCouncil(state: GameState, _action: GameAction): ReducerResult {
  // TODO: tally MPs, tiebreaker corruption checks
  return { state };
}
