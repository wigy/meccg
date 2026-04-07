/**
 * @module reducer-organization
 *
 * Organization phase handlers for the game reducer. Covers playing characters,
 * moving characters between companies, transferring items, corruption checks,
 * planning movement, and sideboard access.
 */

import type { GameState, CardInstanceId, CharacterInPlay, CardInstance, OrganizationPhaseState, Company, SiteInPlay, GameAction, GameEffect } from '../index.js';
import { Phase, shuffle, CardStatus, isCharacterCard, isSiteCard, SiteType, getPlayerIndex, ZERO_EFFECTIVE_STATS } from '../index.js';
import { logDetail } from './legal-actions/log.js';
import { resolveInstanceId } from '../types/state.js';
import type { ReducerResult } from './reducer-utils.js';
import { roll2d6, clonePlayers, cleanupEmptyCompanies, nextCompanyId, handleFetchFromPile } from './reducer-utils.js';
import { handlePlayPermanentEvent, handlePlayShortEvent, handlePlayResourceShortEvent } from './reducer-events.js';


export function handleOrganization(state: GameState, action: GameAction): ReducerResult {
  if (action.type === 'play-character') {
    return handlePlayCharacter(state, action);
  }
  if (action.type === 'pass') {
    // Pass during sideboard-to-discard sub-flow exits the sub-flow, not the phase
    const orgState = state.phaseState as OrganizationPhaseState;
    if (orgState.sideboardFetchDestination === 'discard') {
      logDetail(`Sideboard access: player ${action.player as string} done fetching to discard (${orgState.sideboardFetchedThisTurn} cards)`);
      return {
        state: {
          ...state,
          phaseState: { ...orgState, sideboardFetchDestination: null },
        },
      };
    }

    logDetail(`Organization: player ${action.player as string} passed → advancing to Long-event phase`);

    // [2.III.1] At beginning of long-event phase: resource player discards own resource long-events
    const activePlayer = state.activePlayer!;
    const activeIndex = getPlayerIndex(state, activePlayer);
    const player = state.players[activeIndex];
    const discardedEvents: CardInstance[] = [];
    const remainingCards = player.cardsInPlay.filter(card => {
      const def = state.cardPool[card.definitionId as string];
      if (def && def.cardType === 'hero-resource-event' && def.eventType === 'long') {
        logDetail(`Long-event entry: discarding resource long-event "${def.name}" (${card.instanceId as string})`);
        discardedEvents.push({ instanceId: card.instanceId, definitionId: card.definitionId });
        return false;
      }
      return true;
    });

    const newPlayers = clonePlayers(state);
    newPlayers[activeIndex] = {
      ...newPlayers[activeIndex],
      cardsInPlay: remainingCards,
      discardPile: [...newPlayers[activeIndex].discardPile, ...discardedEvents],
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
    // Dispatch based on card type: hazard short events target environments,
    // resource short events resolve their DSL effects
    if (action.cardInstanceId) {
      const player = state.players.find(p => p.id === action.player);
      const card = player?.hand.find(c => c.instanceId === action.cardInstanceId);
      const def = card ? state.cardPool[card.definitionId as string] : undefined;
      if (def && def.cardType === 'hero-resource-event') {
        return handlePlayResourceShortEvent(state, action);
      }
    }
    return handlePlayShortEvent(state, action);
  }
  if (action.type === 'fetch-from-pile') {
    return handleFetchFromPile(state, action);
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
  if (action.type === 'start-sideboard-to-deck' || action.type === 'start-sideboard-to-discard') {
    return handleStartSideboard(state, action);
  }
  if (action.type === 'fetch-from-sideboard') {
    return handleFetchFromSideboard(state, action);
  }
  if (action.type === 'corruption-check') {
    return handleOrganizationCorruptionCheck(state, action);
  }
  if (action.type === 'activate-granted-action') {
    return handleActivateGrantedAction(state, action);
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
  const handCard = player.hand.find(c => c.instanceId === charInstId);
  if (!handCard) {
    return { state, error: 'Character not in hand' };
  }

  // Validate: must be a character card
  const charDef = state.cardPool[handCard.definitionId as string];
  if (!charDef || !isCharacterCard(charDef)) {
    return { state, error: 'Card is not a character' };
  }

  logDetail(`Play character: ${charDef.name} (mind ${charDef.mind ?? 'null'}) at site ${action.atSite as string}, controlledBy ${action.controlledBy as string}`);

  // Build the new CharacterInPlay
  const newChar: CharacterInPlay = {
    instanceId: charInstId,
    definitionId: handCard.definitionId,
    status: CardStatus.Untapped,
    items: [],
    allies: [],
    hazards: [],
    followers: [],
    controlledBy: action.controlledBy,
    effectiveStats: ZERO_EFFECTIVE_STATS,
  };

  // Remove character from hand
  const newHand = player.hand.filter(c => c.instanceId !== charInstId);

  // Find existing company at the target site
  const companies = [...player.companies];
  const existingCompanyIdx = companies.findIndex(c => c.currentSite?.instanceId === action.atSite);

  // Update or create company
  let newSiteDeck = player.siteDeck;
  if (existingCompanyIdx >= 0) {
    // Validate home-site-only restriction against existing company's site
    const company = companies[existingCompanyIdx];
    const homeSiteOnlyExisting = charDef.effects?.some(
      e => e.type === 'play-restriction' && e.rule === 'home-site-only',
    );
    if (homeSiteOnlyExisting && company.currentSite) {
      const companySiteDef = state.cardPool[company.currentSite.definitionId as string];
      if (companySiteDef && isSiteCard(companySiteDef) && companySiteDef.name !== charDef.homesite) {
        return { state, error: `${charDef.name} can only be played at homesite (${charDef.homesite})` };
      }
    }
    // Add character to existing company
    logDetail(`  Adding to existing company ${company.id as string}`);
    companies[existingCompanyIdx] = {
      ...company,
      characters: [...company.characters, charInstId],
    };
  } else {
    // Need to create a new company — the site comes from the site deck
    const siteInstId = action.atSite;

    // Validate: site must be in the site deck
    const siteCard = player.siteDeck.find(c => c.instanceId === siteInstId);
    if (!siteCard) {
      return { state, error: 'Site not available in site deck' };
    }

    // Validate: must be a valid site (haven or homesite)
    const siteDef = state.cardPool[siteCard.definitionId as string];
    if (!siteDef || !isSiteCard(siteDef)) {
      return { state, error: 'Not a valid site card' };
    }
    const isHaven = siteDef.siteType === SiteType.Haven;
    const isHomesite = siteDef.name === charDef.homesite;
    // Characters with home-site-only restriction cannot be played at havens
    const homeSiteOnly = charDef.effects?.some(
      e => e.type === 'play-restriction' && e.rule === 'home-site-only',
    );
    if (homeSiteOnly && !isHomesite) {
      return { state, error: `${charDef.name} can only be played at home site (${charDef.homesite})` };
    }
    if (!isHaven && !isHomesite) {
      return { state, error: `${siteDef.name} is neither a haven nor ${charDef.name}'s homesite` };
    }

    logDetail(`  Creating new company at ${siteDef.name} (from site deck)`);

    // Remove site from site deck
    newSiteDeck = player.siteDeck.filter(c => c.instanceId !== siteInstId);

    // Create new company
    const newCompany: Company = {
      id: nextCompanyId({ ...player, companies }),
      characters: [charInstId],
      currentSite: { instanceId: siteInstId, definitionId: siteCard.definitionId, status: CardStatus.Untapped },
      siteCardOwned: true,
      destinationSite: null,
      movementPath: [],
      moved: false,
      siteOfOrigin: null,
      onGuardCards: [],
      hazards: [],
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

  const charDefId = resolveInstanceId(state, charInstId);
  const charDef = charDefId ? state.cardPool[charDefId as string] : undefined;
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
  const itemDefId = resolveInstanceId(state, itemInstId);
  const itemDef = itemDefId ? state.cardPool[itemDefId as string] : undefined;
  const fromDefId = resolveInstanceId(state, fromCharId);
  const fromDef = fromDefId ? state.cardPool[fromDefId as string] : undefined;
  const toDefId = resolveInstanceId(state, toCharId);
  const toDef = toDefId ? state.cardPool[toDefId as string] : undefined;
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
 * Handle start-sideboard-to-deck / start-sideboard-to-discard during organization.
 *
 * Taps the avatar and enters the sideboard sub-flow by setting the destination
 * in the organization phase state. No card is moved yet.
 */


/**
 * Handle start-sideboard-to-deck / start-sideboard-to-discard during organization.
 *
 * Taps the avatar and enters the sideboard sub-flow by setting the destination
 * in the organization phase state. No card is moved yet.
 */
function handleStartSideboard(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'start-sideboard-to-deck' && action.type !== 'start-sideboard-to-discard') {
    return { state, error: 'Expected start-sideboard action' };
  }

  const playerIndex = getPlayerIndex(state, action.player);
  const orgState = state.phaseState as OrganizationPhaseState;
  const destination = action.type === 'start-sideboard-to-deck' ? 'deck' : 'discard';

  // Tap the avatar
  const newPlayers = clonePlayers(state);
  const avatarKey = action.characterInstanceId as string;
  const avatarChar = newPlayers[playerIndex].characters[avatarKey];
  if (avatarChar) {
    const charDef = state.cardPool[avatarChar.definitionId as string];
    logDetail(`Tapping avatar ${charDef?.name ?? '?'} for sideboard access (${destination})`);
    const newChars = { ...newPlayers[playerIndex].characters };
    newChars[avatarKey] = { ...avatarChar, status: CardStatus.Tapped };
    newPlayers[playerIndex] = { ...newPlayers[playerIndex], characters: newChars };
  }

  return {
    state: {
      ...state,
      players: newPlayers,
      phaseState: { ...orgState, sideboardFetchDestination: destination },
    },
  };
}

/**
 * Handle fetch-from-sideboard during organization (CoE 2.II.6).
 *
 * Moves a card from the sideboard to the destination determined by the
 * active sub-flow (set by start-sideboard-to-deck/discard). For deck
 * destination, also shuffles and exits the sub-flow.
 */


/**
 * Handle fetch-from-sideboard during organization (CoE 2.II.6).
 *
 * Moves a card from the sideboard to the destination determined by the
 * active sub-flow (set by start-sideboard-to-deck/discard). For deck
 * destination, also shuffles and exits the sub-flow.
 */
function handleFetchFromSideboard(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'fetch-from-sideboard') return { state, error: 'Expected fetch-from-sideboard action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const orgState = state.phaseState as OrganizationPhaseState;

  if (orgState.sideboardFetchDestination === null) {
    return { state, error: 'No sideboard access sub-flow active' };
  }

  // Validate card is in sideboard
  const cardIdx = player.sideboard.findIndex(c => c.instanceId === action.sideboardCardInstanceId);
  if (cardIdx === -1) {
    return { state, error: 'Card not found in sideboard' };
  }

  // Validate card type is resource or character
  const sideboardCard = player.sideboard[cardIdx];
  const def = state.cardPool[sideboardCard.definitionId as string];
  if (!def || (!def.cardType.includes('character') && !def.cardType.includes('resource'))) {
    return { state, error: 'Only resources and characters can be fetched from sideboard' };
  }

  const destination = orgState.sideboardFetchDestination;

  // Validate limits
  if (destination === 'deck' && orgState.sideboardFetchedThisTurn >= 1) {
    return { state, error: 'Can only fetch 1 card to play deck per avatar tap' };
  }
  if (destination === 'discard' && orgState.sideboardFetchedThisTurn >= 5) {
    return { state, error: 'Can only fetch up to 5 cards to discard pile per avatar tap' };
  }

  const newSideboard = [...player.sideboard];
  newSideboard.splice(cardIdx, 1);

  const newPlayers = clonePlayers(state);
  let newRng = state.rng;

  if (destination === 'discard') {
    logDetail(`Sideboard → discard: ${def.name} (${action.sideboardCardInstanceId as string})`);
    newPlayers[playerIndex] = {
      ...newPlayers[playerIndex],
      sideboard: newSideboard,
      discardPile: [...player.discardPile, sideboardCard],
    };
  } else {
    logDetail(`Sideboard → play deck: ${def.name} (${action.sideboardCardInstanceId as string}), shuffling`);
    const [shuffledDeck, nextRng] = shuffle([...player.playDeck, sideboardCard], state.rng);
    newRng = nextRng;
    newPlayers[playerIndex] = {
      ...newPlayers[playerIndex],
      sideboard: newSideboard,
      playDeck: shuffledDeck,
    };
  }

  const newOrgState: OrganizationPhaseState = {
    ...orgState,
    sideboardFetchedThisTurn: orgState.sideboardFetchedThisTurn + 1,
    // Deck destination: exit sub-flow after 1 card; discard: stay in sub-flow
    sideboardFetchDestination: destination === 'deck' ? null : destination,
  };

  return {
    state: {
      ...state,
      players: newPlayers,
      rng: newRng,
      phaseState: newOrgState,
    },
  };
}

/**
 * Handle activation of a grant-action effect during organization.
 *
 * Dispatches to action-specific handlers based on `actionId`:
 * - `remove-self-on-roll` — Taps the character, rolls 2d6, and if the total
 *   meets the threshold, discards the source card (the attached hazard).
 * - `test-gold-ring` — Taps the character, rolls 2d6, and discards the target
 *   gold ring item. The roll result determines which special ring could replace
 *   it (Rule 9.21).
 */
function handleActivateGrantedAction(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'activate-granted-action') return { state, error: 'Expected activate-granted-action' };

  if (action.actionId === 'test-gold-ring') {
    return handleTestGoldRing(state, action);
  }

  // Dispatch to gwaihir-special-movement handler if applicable
  if (action.actionId === 'gwaihir-special-movement') {
    return handleGwaihirSpecialMovement(state, action);
  }

  return handleRemoveSelfOnRoll(state, action);
}

/**
 * Handle remove-self-on-roll grant-action.
 *
 * Taps the bearer, rolls 2d6, and if the total meets the threshold,
 * discards the source hazard card. Used by Foolish Words.
 */
function handleRemoveSelfOnRoll(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'activate-granted-action') return { state, error: 'Expected activate-granted-action' };


  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const char = player.characters[action.characterId as string];
  if (!char) return { state, error: 'Character not found' };

  const charDefId = resolveInstanceId(state, action.characterId);
  const charDef = charDefId ? state.cardPool[charDefId as string] : undefined;
  const charName = charDef?.name ?? '?';
  const sourceDef = state.cardPool[action.sourceCardDefinitionId as string];
  const sourceName = sourceDef?.name ?? '?';

  // Validate: character must be untapped (cost: tap bearer)
  if (char.status !== CardStatus.Untapped) {
    return { state, error: `${charName} is not untapped` };
  }

  // Validate: source card must be attached to the character
  const hazardIdx = char.hazards.findIndex(h => h.instanceId === action.sourceCardId);
  if (hazardIdx < 0) {
    return { state, error: `${sourceName} is not attached to ${charName}` };
  }

  logDetail(`Activate grant-action '${action.actionId}': ${charName} taps to attempt to remove ${sourceName}`);

  // Pay cost: tap the character
  const tappedChar: CharacterInPlay = { ...char, status: CardStatus.Tapped };

  // Roll 2d6
  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const d1 = roll.die1;
  const d2 = roll.die2;
  const total = d1 + d2;
  logDetail(`Grant-action roll for ${charName}: ${d1} + ${d2} = ${total} vs threshold ${action.rollThreshold}`);

  const rollEffect: GameEffect = {
    effect: 'dice-roll',
    playerName: player.name,
    die1: roll.die1,
    die2: roll.die2,
    label: `Remove ${sourceName}: ${charName}`,
  };

  const newPlayers = clonePlayers(state);

  if (total >= action.rollThreshold) {
    // Success: discard the source card
    logDetail(`Roll succeeded (${total} >= ${action.rollThreshold}) — discarding ${sourceName}`);
    const updatedHazards = char.hazards.filter(h => h.instanceId !== action.sourceCardId);
    const discardedCard: CardInstance = { instanceId: action.sourceCardId, definitionId: action.sourceCardDefinitionId };

    newPlayers[playerIndex] = {
      ...newPlayers[playerIndex],
      characters: {
        ...newPlayers[playerIndex].characters,
        [action.characterId as string]: { ...tappedChar, hazards: updatedHazards },
      },
    };

    // Hazard cards are owned by the opponent (other player). Discard to opponent's pile.
    const opponentIndex = 1 - playerIndex;
    newPlayers[opponentIndex] = {
      ...newPlayers[opponentIndex],
      discardPile: [...newPlayers[opponentIndex].discardPile, discardedCard],
    };
  } else {
    // Failure: character is tapped but card stays
    logDetail(`Roll failed (${total} < ${action.rollThreshold}) — ${sourceName} stays attached to ${charName}`);
    newPlayers[playerIndex] = {
      ...newPlayers[playerIndex],
      characters: {
        ...newPlayers[playerIndex].characters,
        [action.characterId as string]: tappedChar,
      },
    };
  }

  // Store the roll on the player
  newPlayers[playerIndex] = { ...newPlayers[playerIndex], lastDiceRoll: roll };

  return {
    state: {
      ...state,
      players: newPlayers,
      rng, cheatRollTotal,
    },
    effects: [rollEffect],
  };
}

/**
 * Handle test-gold-ring grant-action (Rule 9.21).
 *
 * Taps the character (e.g. Gandalf), rolls 2d6, and discards the target
 * gold ring item from its bearer. The roll result is stored for future
 * special ring replacement support.
 *
 * Per CoE rules: "When a gold ring is tested, the item's player makes a ring
 * test roll... The special ring item replaces the gold ring item, which is
 * immediately discarded regardless of whether a special ring item was played."
 */
function handleTestGoldRing(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'activate-granted-action') return { state, error: 'Expected activate-granted-action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const char = player.characters[action.characterId as string];
  if (!char) return { state, error: 'Character not found' };

  const charDefId = resolveInstanceId(state, action.characterId);
  const charDef = charDefId ? state.cardPool[charDefId as string] : undefined;
  const charName = charDef?.name ?? '?';

  // Validate: character must be untapped (cost: tap self)
  if (char.status !== CardStatus.Untapped) {
    return { state, error: `${charName} is not untapped` };
  }

  // Validate: target gold ring must exist
  if (!action.targetCardId) {
    return { state, error: 'No target gold ring specified' };
  }

  // Find the gold ring item on any character in the company
  const company = player.companies.find(c => c.characters.includes(action.characterId));
  if (!company) return { state, error: `${charName} is not in any company` };

  let ringBearerCharId: CardInstanceId | null = null;
  let ringDefId: import('../index.js').CardDefinitionId | null = null;
  for (const compCharId of company.characters) {
    const compChar = player.characters[compCharId as string];
    if (!compChar) continue;
    const ringItem = compChar.items.find(item => item.instanceId === action.targetCardId);
    if (ringItem) {
      ringBearerCharId = compCharId;
      ringDefId = ringItem.definitionId;
      break;
    }
  }

  if (!ringBearerCharId || !ringDefId) {
    return { state, error: 'Target gold ring not found in company' };
  }

  const ringDef = state.cardPool[ringDefId as string];
  const ringName = ringDef?.name ?? '?';

  logDetail(`Activate grant-action 'test-gold-ring': ${charName} taps to test ${ringName}`);

  // Pay cost: tap the character
  const tappedChar: CharacterInPlay = { ...char, status: CardStatus.Tapped };

  // Roll 2d6
  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const d1 = roll.die1;
  const d2 = roll.die2;
  const total = d1 + d2;
  logDetail(`Gold ring test roll for ${charName}: ${d1} + ${d2} = ${total}`);

  const rollEffect: GameEffect = {
    effect: 'dice-roll',
    playerName: player.name,
    die1: roll.die1,
    die2: roll.die2,
    label: `Gold ring test: ${charName} tests ${ringName}`,
  };

  const newPlayers = clonePlayers(state);

  // Tap the character performing the test
  newPlayers[playerIndex] = {
    ...newPlayers[playerIndex],
    characters: {
      ...newPlayers[playerIndex].characters,
      [action.characterId as string]: tappedChar,
    },
  };

  // Remove the gold ring from its bearer and discard it
  const ringBearer = newPlayers[playerIndex].characters[ringBearerCharId as string];
  const updatedItems = ringBearer.items.filter(item => item.instanceId !== action.targetCardId);
  const discardedRing: CardInstance = { instanceId: action.targetCardId, definitionId: ringDefId };

  logDetail(`Gold ring test: discarding ${ringName} from ${state.cardPool[ringBearer.definitionId as string]?.name ?? '?'}`);

  newPlayers[playerIndex] = {
    ...newPlayers[playerIndex],
    characters: {
      ...newPlayers[playerIndex].characters,
      [ringBearerCharId as string]: { ...ringBearer, items: updatedItems },
    },
    discardPile: [...newPlayers[playerIndex].discardPile, discardedRing],
  };

  // Store the roll on the player
  newPlayers[playerIndex] = { ...newPlayers[playerIndex], lastDiceRoll: roll };

  return {
    state: {
      ...state,
      players: newPlayers,
      rng, cheatRollTotal,
    },
    effects: [rollEffect],
  };
}

/**
 * Handle Gwaihir's special movement ability: discard Gwaihir (ally) during
 * the organization phase to grant the company special movement to any site
 * not in a Shadow-land, Dark-domain, or Under-deeps.
 *
 * Cost: discard the ally (Gwaihir) from the character.
 * Prerequisite: company size ≤ 2 (checked in legal actions).
 * Effect: marks the company with `specialMovement: 'gwaihir'` so that
 * plan-movement offers all valid destinations and the M/H phase uses
 * Special movement type with no region path.
 */
function handleGwaihirSpecialMovement(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'activate-granted-action') return { state, error: 'Expected activate-granted-action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const char = player.characters[action.characterId as string];
  if (!char) return { state, error: 'Character not found' };

  const charDefId = resolveInstanceId(state, action.characterId);
  const charDef = charDefId ? state.cardPool[charDefId as string] : undefined;
  const charName = charDef?.name ?? '?';
  const sourceDef = state.cardPool[action.sourceCardDefinitionId as string];
  const sourceName = sourceDef?.name ?? '?';

  // Validate: source card must be an ally on the character
  const allyIdx = char.allies.findIndex(a => a.instanceId === action.sourceCardId);
  if (allyIdx < 0) {
    return { state, error: `${sourceName} is not an ally of ${charName}` };
  }

  // Find the company this character belongs to
  const company = player.companies.find(c => c.characters.includes(action.characterId));
  if (!company) {
    return { state, error: `${charName} is not in any company` };
  }

  logDetail(`Gwaihir special movement: ${charName} discards ${sourceName} to grant company ${company.id as string} special movement`);

  // Pay cost: remove Gwaihir from the character's allies
  const updatedAllies = char.allies.filter(a => a.instanceId !== action.sourceCardId);
  const discardedCard: CardInstance = { instanceId: action.sourceCardId, definitionId: action.sourceCardDefinitionId };

  const newPlayers = clonePlayers(state);

  // Update the character (remove ally)
  newPlayers[playerIndex] = {
    ...newPlayers[playerIndex],
    characters: {
      ...newPlayers[playerIndex].characters,
      [action.characterId as string]: { ...char, allies: updatedAllies },
    },
    // Ally belongs to this player — discard to own pile
    discardPile: [...newPlayers[playerIndex].discardPile, discardedCard],
  };

  // Mark the company with special movement
  const updatedCompanies = newPlayers[playerIndex].companies.map(c =>
    c.id === company.id ? { ...c, specialMovement: 'gwaihir' as const } : c,
  );
  newPlayers[playerIndex] = {
    ...newPlayers[playerIndex],
    companies: updatedCompanies,
  };

  return {
    state: {
      ...state,
      players: newPlayers,
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

  const charDefId = resolveInstanceId(state, action.characterId);
  const charDef = charDefId ? state.cardPool[charDefId as string] : undefined;
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

    const toDiscard: CardInstance[] = [
      { instanceId: action.characterId, definitionId: char.definitionId },
      ...action.possessions.map(id => ({ instanceId: id, definitionId: resolveInstanceId(state, id)! })),
    ];
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

    const newEliminatedPile = [...player.eliminatedPile, { instanceId: action.characterId, definitionId: char.definitionId }];
    const newDiscardPile = [...player.discardPile, ...action.possessions.map(id => ({ instanceId: id, definitionId: resolveInstanceId(state, id)! }))];

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
    hazards: [],
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

  const charDefId2 = resolveInstanceId(state, charInstId);
  const charDef = charDefId2 ? state.cardPool[charDefId2 as string] : undefined;
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
  if (!player.siteDeck.some(c => c.instanceId === action.destinationSite)) {
    return { state, error: 'Destination site not in site deck' };
  }

  logDetail(`Plan movement: company ${company.id as string} → ${action.destinationSite as string}`);

  const companies = [...player.companies];
  const destCard = player.siteDeck.find(c => c.instanceId === action.destinationSite);
  companies[companyIdx] = {
    ...company,
    destinationSite: { instanceId: destCard!.instanceId, definitionId: destCard!.definitionId, status: CardStatus.Untapped },
    movementPath: [],
  };

  // Remove destination site from site deck
  const siteDeck = player.siteDeck.filter(c => c.instanceId !== action.destinationSite);

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

  logDetail(`Cancel movement: company ${company.id as string}, returning site ${company.destinationSite.instanceId as string} to site deck`);

  const companies = [...player.companies];
  companies[companyIdx] = {
    ...company,
    destinationSite: null,
    movementPath: [],
  };

  // Return the destination site to the site deck
  const siteDeck = [...player.siteDeck, { instanceId: company.destinationSite.instanceId, definitionId: company.destinationSite.definitionId }];

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...player, companies, siteDeck };

  // Reverse: re-plan movement to the destination we just cancelled
  const reverseAction: GameAction = {
    type: 'plan-movement',
    player: action.player,
    companyId: action.companyId,
    destinationSite: company.destinationSite.instanceId,
  };

  return { state: { ...state, players: newPlayers, reverseActions: [...state.reverseActions, reverseAction] } };
}

/**
 * Discards all environment cards belonging to the opposing alignment.
 *
 * When an environment permanent-event enters play, it immediately discards
 * all environment cards of the opposing alignment (CoE environment rules):
 * - Resource environments (e.g. Gates of Morning) discard all hazard environments
 * - Hazard environments (e.g. Doors of Night) discard all resource environments
 *
 * Affected cards are moved from their owner's cardsInPlay to their discardPile.
 *
 * @param state - Current game state (after the card has been added to cardsInPlay).
 * @param filter - A DSL condition evaluated against each card definition in play.
 *                 Cards whose definitions match the filter are discarded.
 * @returns Updated game state with matching cards discarded.
 */

