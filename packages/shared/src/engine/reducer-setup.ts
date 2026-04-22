/**
 * @module reducer-setup
 *
 * Setup phase handlers for the game reducer. Covers character draft,
 * item draft, character deck draft, starting site selection,
 * character placement, deck shuffle, initial draw, and initiative roll.
 */

import type { GameState, DraftPlayerState, ItemDraftPlayerState, CharacterDeckDraftPlayerState, SetupStepState, CardInstance, GameAction } from '../index.js';
import type { TwoDiceSix, GameEffect } from '../index.js';
import { Phase, SetupStep, getAlignmentRules, shuffle, CardStatus, isCharacterCard, getPlayerIndex, MAX_STARTING_ITEMS } from '../index.js';
import { logDetail } from './legal-actions/log.js';
import { applyDraftResults, transitionAfterItemDraft, enterSiteSelection, startFirstTurn } from './init.js';
import type { ReducerResult } from './reducer-utils.js';
import { roll2d6, clonePlayers, cleanupEmptyCompanies, nextCompanyId, updatePlayer, updateCharacter, wrongActionType } from './reducer-utils.js';


export function handleSetup(state: GameState, action: GameAction): ReducerResult {
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
      const poolCard = playerDraft.pool.find(c => c.instanceId === action.characterInstanceId);
      if (!poolCard) {
        return { state, error: 'Character not in your draft pool' };
      }
      // Resolve definition from instance
      const charDefId = poolCard.definitionId;
      // Check mind constraint
      const charDef = charDefId ? state.cardPool[charDefId as string] : undefined;
      if (!isCharacterCard(charDef)) {
        return { state, error: 'Invalid character' };
      }
      const currentMind = playerDraft.drafted.reduce((sum, card) => {
        const def = state.cardPool[card.definitionId as string];
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
        currentPick: poolCard,
        pool: playerDraft.pool.filter(c => c.instanceId !== action.characterInstanceId),
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
  setAside: readonly [readonly CardInstance[], readonly CardInstance[]],
): ReducerResult {
  const pick0 = draftState[0].currentPick;
  const pick1 = draftState[1].currentPick;
  const newSetAside: [CardInstance[], CardInstance[]] = [[...setAside[0]], [...setAside[1]]];

  // Resolve each player's pick
  const newDraft: [DraftPlayerState, DraftPlayerState] = [
    { ...draftState[0], currentPick: null },
    { ...draftState[1], currentPick: null },
  ];

  // Collision detection: compare by definition ID (both players may pick the same character)
  const def0 = pick0 !== null ? pick0.definitionId : null;
  const def1 = pick1 !== null ? pick1.definitionId : null;
  if (pick0 !== null && pick1 !== null && def0 === def1) {
    // Duplicate! Neither gets it — set aside both instances (one per player, so no instance ID is shared).
    // Remove the collided definition from both pools.
    newSetAside[0].push(pick0);
    newSetAside[1].push(pick1);
    newDraft[0] = { ...newDraft[0], pool: newDraft[0].pool.filter(c => c.definitionId !== def0) };
    newDraft[1] = { ...newDraft[1], pool: newDraft[1].pool.filter(c => c.definitionId !== def0) };
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
      const mind = newDraft[i].drafted.reduce((sum, card) => {
        const def = state.cardPool[card.definitionId as string];
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


/**
 * Delegates to {@link applyDraftResults} to place drafted characters on the
 * board and transition to item draft. Set-aside characters from draft
 * collisions are returned to both players' remaining pools.
 */
function finalizeDraft(
  state: GameState,
  draftState: readonly [DraftPlayerState, DraftPlayerState],
  setAside: readonly [readonly CardInstance[], readonly CardInstance[]],
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
    return wrongActionType(state, action, 'assign-starting-item', 'item draft');
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
  const itemCard = itemDraft.unassignedItems.find(card => card.definitionId === action.itemDefId);
  if (!itemCard) {
    return { state, error: 'Item is not in your unassigned items' };
  }
  const itemInstanceId = itemCard.instanceId;

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

  // Remove item from unassigned list
  const newUnassigned = itemDraft.unassignedItems.filter(c => c.instanceId !== itemInstanceId);
  const newItemDraft: ItemDraftPlayerState = {
    unassignedItems: newUnassigned,
    done: newUnassigned.length === 0,
  };

  const newItemDraftState = [...stepState.itemDraftState] as [ItemDraftPlayerState, ItemDraftPlayerState];
  newItemDraftState[playerIndex] = newItemDraft;

  const stateWithChar = updatePlayer(state, playerIndex, p => updateCharacter(p, charKey, c => ({
    ...c,
    items: [...c.items, { instanceId: itemInstanceId, definitionId: itemCard.definitionId, status: CardStatus.Untapped }],
  })));

  // If both players are done, transition to character deck draft (or Untap)
  if (newItemDraftState[0].done && newItemDraftState[1].done) {
    return {
      state: transitionAfterItemDraft(
        stateWithChar,
        stepState.remainingPool,
      ),
    };
  }

  return {
    state: {
      ...stateWithChar,
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
    return wrongActionType(state, action, 'add-character-to-deck', 'character deck draft');
  }

  // Validate character is in remaining pool
  const poolCard = deckDraft.remainingPool.find(c => c.instanceId === action.characterInstanceId);
  if (!poolCard) {
    return { state, error: 'Character is not in your remaining pool' };
  }

  // Resolve definition from draft instance
  const draftDefId = poolCard.definitionId;
  const def = draftDefId ? state.cardPool[draftDefId as string] : undefined;

  // Validate non-avatar limit
  if (isCharacterCard(def) && def.mind !== null) {
    let nonAvatarCount = 0;
    for (const card of state.players[playerIndex].playDeck) {
      const d = state.cardPool[card.definitionId as string];
      if (isCharacterCard(d) && d.mind !== null) nonAvatarCount++;
    }
    if (nonAvatarCount >= 10) {
      return { state, error: 'Already have 10 non-avatar characters in play deck' };
    }
  }

  // Transfer the existing draft-pool instance directly into the play deck — never re-mint.
  // Instance IDs must remain stable for the lifetime of the game.
  if (!draftDefId) return { state, error: 'Invalid character instance' };

  // Remove from remaining pool
  const newPool = deckDraft.remainingPool.filter(c => c.instanceId !== action.characterInstanceId);
  const newDeckDraftState = [...stepState.deckDraftState] as [CharacterDeckDraftPlayerState, CharacterDeckDraftPlayerState];
  newDeckDraftState[playerIndex] = {
    remainingPool: newPool,
    done: newPool.length === 0,
  };

  const newState = {
    ...updatePlayer(state, playerIndex, p => ({ ...p, playDeck: [...p.playDeck, poolCard] })),
    phaseState: setupPhase({ ...stepState, deckDraftState: newDeckDraftState }),
  };

  // Both done → enter site selection (pool exhausted for both players)
  if (newDeckDraftState[0].done && newDeckDraftState[1].done) {
    return { state: enterSiteSelection(newState) };
  }

  return { state: newState };
}

// ---- Starting site selection handler ----

import type { SiteSelectionPlayerState } from '../index.js';

/**
 * Handles the starting site selection step. Each player selects one or two
 * sites from their site deck and forms empty companies at those sites.
 */


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
    return wrongActionType(state, action, 'select-starting-site', 'site selection');
  }

  // Validate site is in player's site deck and not already selected
  const player = state.players[playerIndex];
  const siteCard = player.siteDeck.find(c => c.instanceId === action.siteInstanceId);
  if (!siteCard) {
    return { state, error: 'Site is not in your site deck' };
  }
  if (siteSelection.selectedSites.some(s => s.instanceId === action.siteInstanceId)) {
    return { state, error: 'Site already selected' };
  }
  if (siteSelection.selectedSites.length >= 2) {
    return { state, error: 'Already selected 2 starting sites' };
  }

  // Remove site from site deck
  const newSiteDeck = player.siteDeck.filter(c => c.instanceId !== action.siteInstanceId);

  const newSiteSelectionState = [...stepState.siteSelectionState] as [SiteSelectionPlayerState, SiteSelectionPlayerState];
  newSiteSelectionState[playerIndex] = {
    ...siteSelection,
    selectedSites: [...siteSelection.selectedSites, {
      instanceId: action.siteInstanceId,
      definitionId: siteCard.definitionId,
    }],
  };

  return {
    state: {
      ...updatePlayer(state, playerIndex, p => ({ ...p, siteDeck: newSiteDeck })),
      phaseState: setupPhase({ ...stepState, siteSelectionState: newSiteSelectionState }),
    },
  };
}

/**
 * Assigns the first selected site to the existing company (created during
 * draft with null site). If a second site was selected, creates an
 * additional empty company at that site. Transitions to the first Untap phase.
 */


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
      companies[0] = { ...companies[0], currentSite: { ...selectedSites[0], status: CardStatus.Untapped } };
    }

    // Second site creates an additional empty company
    if (selectedSites.length > 1) {
      companies.push({
        id: nextCompanyId(player),
        characters: [],
        currentSite: { ...selectedSites[1], status: CardStatus.Untapped },
        siteCardOwned: true,
        destinationSite: null,
        movementPath: [],
        moved: false,
        siteOfOrigin: null,
        onGuardCards: [],
        hazards: [],
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
    return wrongActionType(state, action, 'place-character', 'character placement');
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

  return {
    state: updatePlayer(state, playerIndex, p => ({ ...p, companies: newCompanies })),
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
    return wrongActionType(state, action, 'shuffle-play-deck', 'deck shuffle');
  }

  const player = state.players[playerIndex];
  let rng = state.rng;
  const [shuffled, nextRng] = shuffle([...player.playDeck], rng);
  rng = nextRng;

  const stateWithShuffle = updatePlayer(state, playerIndex, p => ({ ...p, playDeck: shuffled }));

  const newShuffled = [...stepState.shuffled] as [boolean, boolean];
  newShuffled[playerIndex] = true;

  // Both shuffled → advance to initial draw
  if (newShuffled[0] && newShuffled[1]) {
    return {
      state: {
        ...stateWithShuffle,
        phaseState: setupPhase({ step: SetupStep.InitialDraw, drawn: [false, false] }),
        rng,
      },
    };
  }

  return {
    state: {
      ...stateWithShuffle,
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
    return wrongActionType(state, action, 'draw-cards', 'initial draw');
  }

  const player = state.players[playerIndex];
  const hand = player.playDeck.slice(0, action.count);
  const playDeck = player.playDeck.slice(action.count);

  const stateWithDraw = updatePlayer(state, playerIndex, p => ({ ...p, hand, playDeck }));

  const newDrawn = [...stepState.drawn] as [boolean, boolean];
  newDrawn[playerIndex] = true;

  // Both drawn → initiative roll
  if (newDrawn[0] && newDrawn[1]) {
    return {
      state: {
        ...cleanupEmptyCompanies(stateWithDraw),
        phaseState: setupPhase({
          step: SetupStep.InitiativeRoll,
          rolls: [null, null],
        }),
      },
    };
  }

  return {
    state: {
      ...stateWithDraw,
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
    return wrongActionType(state, action, 'roll-initiative', 'initiative roll');
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
    label: 'First turn',
  };

  // Store the roll in the player's state
  const stateWithRoll: GameState = {
    ...updatePlayer(state, playerIndex, p => ({ ...p, lastDiceRoll: roll })),
    rng,
    cheatRollTotal,
  };

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

