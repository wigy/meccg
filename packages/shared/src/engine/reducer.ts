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

import type { GameState, PlayerState, DraftPlayerState, ItemDraftPlayerState, CharacterDeckDraftPlayerState, SetupStepState, CardDefinitionId, CardInstanceId, CompanyId, CharacterInPlay, CardInstance, OrganizationPhaseState, MovementHazardPhaseState, Company } from '../index.js';
import type { GameAction } from '../index.js';
import { Phase, SetupStep, LEGAL_ACTIONS_BY_PHASE, getAlignmentRules, shuffle, nextInt, CardStatus, isCharacterCard, isSiteCard, SiteType, RegionType, Race, Skill, getPlayerIndex, ZERO_EFFECTIVE_STATS, MAX_STARTING_ITEMS, BASE_MAX_REGION_DISTANCE } from '../index.js';
import { logHeading, logDetail } from './legal-actions/log.js';
import type { TwoDiceSix, DieRoll, GameEffect } from '../index.js';
import { applyDraftResults, transitionAfterItemDraft, enterSiteSelection, startFirstTurn } from './init.js';
import { recomputeDerived } from './recompute-derived.js';

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


  // During movement/hazard phase, the non-active player plays hazards
  if (phase === 'movement-hazard' && action.type === 'play-hazard') {
    if (action.player === state.activePlayer) {
      return 'Active player cannot play hazards';
    }
    return undefined;
  }

  // During draw-cards step, both players draw simultaneously
  if (phase === 'movement-hazard' && 'step' in state.phaseState && state.phaseState.step === 'draw-cards') {
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
      companies[0] = { ...companies[0], currentSite: selectedSites[0] };
    }

    // Second site creates an additional empty company
    if (selectedSites.length > 1) {
      companies.push({
        id: `company-${player.id as string}-${companies.length}` as CompanyId,
        characters: [],
        currentSite: selectedSites[1],
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
    state: startFirstTurn({ ...stateWithRoll, activePlayer: firstPlayer }),
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
  const findSite = (charId: CardInstanceId): CardInstanceId | null => {
    for (const company of player.companies) {
      if (company.characters.includes(charId)) return company.currentSite;
    }
    return null;
  };
  const fromSite = findSite(fromCharId);
  const toSite = findSite(toCharId);
  if (!fromSite || !toSite || fromSite !== toSite) {
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

  // Generate a unique company ID
  const maxIdx = player.companies.reduce((max, c) => {
    const match = (c.id as string).match(/company-.*-(\d+)$/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, -1);

  const newCompany: Company = {
    id: `company-${player.id as string}-${maxIdx + 1}` as CompanyId,
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
  if (sourceCompany.currentSite !== targetCompany.currentSite) {
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
  if (sourceCompany.currentSite !== targetCompany.currentSite) {
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

  // Remaining step (play-hazards) — still stub
  if (action.type !== 'pass') {
    return { state, error: `Unexpected action '${action.type}' in movement/hazard phase (step: ${mhState.step})` };
  }

  // After pass, mark current company as handled and return to select-company
  // (or advance to Site phase if all companies are done)
  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const currentCompany = player.companies[mhState.activeCompanyIndex];
  const updatedHandled = [...mhState.handledCompanyIds, currentCompany.id];
  const remainingCount = player.companies.length - updatedHandled.length;

  if (remainingCount <= 0) {
    logDetail(`Movement/Hazard: all companies handled → advancing to Site phase`);
    return {
      state: {
        ...state,
        phaseState: {
          phase: Phase.Site,
          activeCompanyIndex: 0,
          automaticAttacksResolved: 0,
          resourcePlayed: false,
        },
      },
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
  if (action.type === 'pass') {
    logDetail(`Movement/Hazard: non-moving company → advancing to set-hazard-limit`);
    return {
      state: {
        ...state,
        phaseState: {
          ...mhState,
          step: 'set-hazard-limit' as const,
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

  const originInst = company.currentSite ? state.instanceMap[company.currentSite as string] : undefined;
  const originDef = originInst ? state.cardPool[originInst.definitionId as string] : undefined;
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
  const originInst = company.currentSite ? state.instanceMap[company.currentSite as string] : undefined;
  const originDef = originInst ? state.cardPool[originInst.definitionId as string] : undefined;

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

  if (action.type !== 'draw-cards' || action.count !== 1) {
    return { state, error: `Expected 'draw-cards' (count: 1) or 'pass' during draw-cards step, got '${action.type}'` };
  }

  if (drawnSoFar >= drawMax) {
    return { state, error: `${playerLabel} player has already drawn maximum (${drawMax}) cards` };
  }

  // Draw 1 card from play deck into hand
  const player = state.players[actingIndex];
  if (player.playDeck.length === 0) {
    // TODO: reshuffle discard pile into play deck
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

/** Placeholder: automatic attacks at site, resource play, influence attempts. */
function handleSite(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'pass') {
    return { state, error: `Unexpected action '${action.type}' in site phase` };
  }
  // TODO: automatic attacks, resource play, influence attempts
  logDetail(`Site: active player ${action.player as string} passed → advancing to End-of-Turn phase`);
  return {
    state: {
      ...state,
      phaseState: { phase: Phase.EndOfTurn },
    },
  };
}

/** Placeholder: draw/discard to hand size, switch active player, start next turn. */
function handleEndOfTurn(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'pass') {
    return { state, error: `Unexpected action '${action.type}' in end-of-turn phase` };
  }
  // TODO: draw/discard to hand size, check free council trigger
  const currentIndex = state.players.findIndex(p => p.id === state.activePlayer);
  const nextIndex = (currentIndex + 1) % state.players.length;
  const nextPlayer = state.players[nextIndex].id;
  logDetail(`End-of-Turn: active player ${action.player as string} passed → switching to player ${nextPlayer as string}, turn ${state.turnNumber + 1}`);
  return {
    state: {
      ...state,
      activePlayer: nextPlayer,
      turnNumber: state.turnNumber + 1,
      phaseState: { phase: Phase.Untap },
    },
  };
}

/** Stub: tally marshalling points, run tiebreaker corruption checks. */
function handleFreeCouncil(state: GameState, _action: GameAction): ReducerResult {
  // TODO: tally MPs, tiebreaker corruption checks
  return { state };
}
