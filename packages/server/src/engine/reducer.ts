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

import type { GameState, DraftPlayerState, ItemDraftPlayerState, CharacterDeckDraftPlayerState, SetupStepState, CardDefinitionId, CardInstanceId, CompanyId, CharacterInPlay, CardInstance } from '@meccg/shared';
import type { GameAction } from '@meccg/shared';
import { Phase, SetupStep, LEGAL_ACTIONS_BY_PHASE, getAlignmentRules, shuffle } from '@meccg/shared';
import { applyDraftResults, transitionAfterItemDraft, enterSiteSelection, startFirstTurn } from './init.js';
import { recomputeDerived } from './recompute-derived.js';

/**
 * Result of applying a {@link GameAction} to a {@link GameState}.
 * If `error` is present, `state` is returned unchanged.
 */
export interface ReducerResult {
  readonly state: GameState;
  /** Human-readable error message if the action was rejected. */
  readonly error?: string;
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
  // 1. Validate action is from the correct player for the current context
  const validationError = validateActionPlayer(state, action);
  if (validationError) {
    return { state, error: validationError };
  }

  // 2. Validate action type is legal in current phase
  const phase = state.phaseState.phase;
  const legalActions = LEGAL_ACTIONS_BY_PHASE[phase];
  if (!legalActions.includes(action.type)) {
    return { state, error: `Action '${action.type}' is not legal in phase '${phase}'` };
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
  if (!result.error) {
    result = { state: recomputeDerived(result.state) };
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
  const playerIndex = state.players[0].id === action.player ? 0 : 1;
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
      if (!charDef || charDef.cardType !== 'hero-character') {
        return { state, error: 'Invalid character' };
      }
      const currentMind = playerDraft.drafted.reduce((sum, defId) => {
        const def = state.cardPool[defId as string];
        return sum + (def && def.cardType === 'hero-character' && def.mind !== null ? def.mind : 0);
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
        return finalizeDraft(state, newDraftState);
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
        return sum + (def && def.cardType === 'hero-character' && def.mind !== null ? def.mind : 0);
      }, 0);
      const { maxStartingCompanySize: max } = getAlignmentRules(state.players[i].alignment);
      if (newDraft[i].drafted.length >= max || newDraft[i].pool.length === 0 || mind >= 20) {
        newDraft[i] = { ...newDraft[i], stopped: true };
      }
    }
  }

  // If both stopped, finalize
  if (newDraft[0].stopped && newDraft[1].stopped) {
    return finalizeDraft(state, newDraft);
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
 * board and transition the game to the Untap phase.
 */
function finalizeDraft(
  state: GameState,
  draftState: readonly [DraftPlayerState, DraftPlayerState],
): ReducerResult {
  return {
    state: applyDraftResults(state, draftState),
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
  const playerIndex = state.players[0].id === action.player ? 0 : 1;
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

  // Resolve definition ID to the first matching unassigned instance
  const itemInstanceId = itemDraft.unassignedItems.find(instId => {
    const inst = state.instanceMap[instId as string];
    return inst && inst.definitionId === action.itemDefId;
  });
  if (!itemInstanceId) {
    return { state, error: 'Item is not in your unassigned items' };
  }

  // Validate character belongs to this player's company
  const player = state.players[playerIndex];
  const allCharIds = player.companies.flatMap(c => c.characters);
  if (!allCharIds.includes(action.characterInstanceId)) {
    return { state, error: 'Character is not in your starting company' };
  }
  const charKey = action.characterInstanceId as string;
  const existingChar = player.characters[charKey];
  if (!existingChar) {
    return { state, error: 'Character not found' };
  }

  const updatedChar: CharacterInPlay = {
    ...existingChar,
    items: [...existingChar.items, itemInstanceId],
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

  const newPlayers = [...state.players] as unknown as [typeof state.players[0], typeof state.players[1]];
  newPlayers[playerIndex] = updatedPlayer;

  // If both players are done, transition to character deck draft (or Untap)
  if (newItemDraftState[0].done && newItemDraftState[1].done) {
    return {
      state: transitionAfterItemDraft(
        { ...state, players: newPlayers as unknown as readonly [typeof state.players[0], typeof state.players[1]] },
        stepState.remainingPool,
      ),
    };
  }

  return {
    state: {
      ...state,
      players: newPlayers as unknown as readonly [typeof state.players[0], typeof state.players[1]],
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
  const playerIndex = state.players[0].id === action.player ? 0 : 1;
  const deckDraft = stepState.deckDraftState[playerIndex];

  if (deckDraft.shuffled) {
    return { state, error: 'You have already finished this phase' };
  }

  // Shuffle: finalize this player's deck
  if (action.type === 'shuffle-play-deck') {
    if (!deckDraft.done) {
      return { state, error: 'Finish adding characters before shuffling' };
    }

    const player = state.players[playerIndex];
    let rng = state.rng;
    const [shuffled, nextRng] = shuffle([...player.playDeck], rng);
    rng = nextRng;

    const newPlayers = [...state.players] as unknown as [typeof state.players[0], typeof state.players[1]];
    newPlayers[playerIndex] = { ...player, playDeck: shuffled };

    const newDeckDraftState = [...stepState.deckDraftState] as [CharacterDeckDraftPlayerState, CharacterDeckDraftPlayerState];
    newDeckDraftState[playerIndex] = { ...deckDraft, shuffled: true };

    // Both shuffled → enter starting site selection
    if (newDeckDraftState[0].shuffled && newDeckDraftState[1].shuffled) {
      return {
        state: enterSiteSelection({
          ...state,
          players: newPlayers as unknown as readonly [typeof state.players[0], typeof state.players[1]],
          rng,
        }),
      };
    }

    return {
      state: {
        ...state,
        players: newPlayers as unknown as readonly [typeof state.players[0], typeof state.players[1]],
        phaseState: setupPhase({ ...stepState, deckDraftState: newDeckDraftState }),
        rng,
      },
    };
  }

  if (deckDraft.done) {
    return { state, error: 'You must shuffle your play deck' };
  }

  // Pass: done adding characters, must shuffle next
  if (action.type === 'pass') {
    const newDeckDraftState = [...stepState.deckDraftState] as [CharacterDeckDraftPlayerState, CharacterDeckDraftPlayerState];
    newDeckDraftState[playerIndex] = { remainingPool: [], done: true, shuffled: false };

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
  if (def && def.cardType === 'hero-character' && def.mind !== null) {
    let nonAvatarCount = 0;
    for (const instId of state.players[playerIndex].playDeck) {
      const inst = state.instanceMap[instId as string];
      if (!inst) continue;
      const d = state.cardPool[inst.definitionId as string];
      if (d && d.cardType === 'hero-character' && d.mind !== null) nonAvatarCount++;
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
  const newPlayers = [...state.players] as unknown as [typeof state.players[0], typeof state.players[1]];
  newPlayers[playerIndex] = { ...player, playDeck: newPlayDeck };

  // Remove from remaining pool
  const newPool = deckDraft.remainingPool.filter(id => id !== action.characterDefId);
  const newDeckDraftState = [...stepState.deckDraftState] as [CharacterDeckDraftPlayerState, CharacterDeckDraftPlayerState];
  newDeckDraftState[playerIndex] = {
    remainingPool: newPool,
    done: newPool.length === 0,
    shuffled: false,
  };

  return {
    state: {
      ...state,
      players: newPlayers as unknown as readonly [typeof state.players[0], typeof state.players[1]],
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
  const playerIndex = state.players[0].id === action.player ? 0 : 1;
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

  const newSiteSelectionState = [...stepState.siteSelectionState] as [SiteSelectionPlayerState, SiteSelectionPlayerState];
  newSiteSelectionState[playerIndex] = {
    ...siteSelection,
    selectedSites: [...siteSelection.selectedSites, action.siteInstanceId],
  };

  return {
    state: {
      ...state,
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
  const newPlayers = [...state.players] as unknown as [typeof state.players[0], typeof state.players[1]];

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

  return startFirstTurn({
    ...state,
    players: newPlayers as unknown as readonly [typeof state.players[0], typeof state.players[1]],
  });
}

// ---- Phase handler stubs ----
// Each stub below corresponds to a game phase that is not yet implemented.
// They accept the action but return the state unmodified.

/** Stub: untap all characters, heal wounded at havens. */
function handleUntap(state: GameState, _action: GameAction): ReducerResult {
  // TODO: untap all cards, heal wounded at havens, advance to organization
  return { state };
}

/** Stub: play characters, split/merge companies, transfer items, plan movement. */
function handleOrganization(state: GameState, _action: GameAction): ReducerResult {
  // TODO: play characters, split/merge companies, transfer items, plan movement
  return { state };
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
