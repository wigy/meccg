/**
 * @module reducer-untap
 *
 * Untap phase handlers for the game reducer. Manages untapping of cards,
 * hazard sideboard access, and transition to the organization phase.
 */

import type { GameState, CharacterInPlay, UntapPhaseState, GameAction, CardInstanceId, CardInstance } from '../index.js';
import type { GameEffect } from '../index.js';
import { Phase, shuffle, CardStatus, isSiteCard, SiteType, getPlayerIndex } from '../index.js';
import { resolveInstanceId } from '../types/state.js';
import { logDetail } from './legal-actions/log.js';
import type { ReducerResult } from './reducer-utils.js';
import { clonePlayers, roll2d6, cleanupEmptyCompanies } from './reducer-utils.js';


/**
 * Handles the Untap phase. Both players must pass to advance.
 * Actual untapping of cards will be implemented later.
 */
export function handleUntap(state: GameState, action: GameAction): ReducerResult {
  if (state.phaseState.phase !== Phase.Untap) {
    return { state, error: 'Not in untap phase' };
  }

  const untapState = state.phaseState;

  // ── Hazard sideboard intent actions ──
  if (action.type === 'start-hazard-sideboard-to-deck' || action.type === 'start-hazard-sideboard-to-discard') {
    const destination = action.type === 'start-hazard-sideboard-to-deck' ? 'deck' : 'discard';
    logDetail(`Untap: hazard player declares sideboard access (${destination})`);
    return {
      state: {
        ...state,
        phaseState: { ...untapState, hazardSideboardDestination: destination, hazardSideboardAccessed: true, hazardPlayerPassed: false },
      },
    };
  }

  // ── Hazard sideboard fetch action ──
  if (action.type === 'fetch-hazard-from-sideboard') {
    return handleFetchHazardFromSideboard(state, action);
  }

  // ── Untap action (resource player) ──
  if (action.type === 'untap') {
    if (action.player !== state.activePlayer) {
      return { state, error: 'Only the resource player can untap' };
    }
    if (untapState.untapped) {
      return { state, error: 'Already untapped this phase' };
    }
    logDetail(`Untap: resource player ${action.player as string} untaps cards`);
    const untappedState = performUntap(state);
    const newUntapState = { ...untapState, untapped: true };
    // If hazard player already passed, advance to Organization
    if (newUntapState.hazardPlayerPassed) {
      return advanceToOrganization({ ...untappedState, phaseState: newUntapState });
    }
    return {
      state: { ...untappedState, phaseState: newUntapState },
    };
  }

  // ── Corruption check (Lure hazards at havens) ──
  if (action.type === 'corruption-check') {
    return handleUntapCorruptionCheck(state, action);
  }

  // ── Pass action ──
  if (action.type !== 'pass') {
    return { state, error: `Unexpected action '${action.type}' in untap phase` };
  }

  const isActivePlayer = action.player === state.activePlayer;

  // Pass during hazard sideboard-to-discard sub-flow exits the sub-flow
  if (!isActivePlayer && untapState.hazardSideboardDestination === 'discard') {
    logDetail(`Hazard sideboard: player ${action.player as string} done fetching to discard (${untapState.hazardSideboardFetched} cards)`);
    // Mark that hazard player accessed sideboard (for hazard limit halving)
    const hazardIndex = getPlayerIndex(state, action.player);
    const newPlayers = clonePlayers(state);
    newPlayers[hazardIndex] = { ...newPlayers[hazardIndex], sideboardAccessedDuringUntap: true };
    return {
      state: {
        ...state,
        players: newPlayers,
        phaseState: { ...untapState, hazardSideboardDestination: null },
      },
    };
  }

  // Hazard player passes (declines sideboard access or already done)
  if (!isActivePlayer) {
    logDetail(`Untap: hazard player ${action.player as string} passed`);
    // If resource player already untapped, advance to Organization
    if (untapState.untapped) {
      return advanceToOrganization(state);
    }
    return {
      state: {
        ...state,
        phaseState: { ...untapState, hazardPlayerPassed: true },
      },
    };
  }

  // Active (resource) player should not pass without untapping first
  return { state, error: 'Resource player must untap before passing' };
}

/**
 * Handle fetch-hazard-from-sideboard during the untap hazard sideboard sub-flow.
 */


/**
 * Handle fetch-hazard-from-sideboard during the untap hazard sideboard sub-flow.
 */
function handleFetchHazardFromSideboard(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'fetch-hazard-from-sideboard') return { state, error: 'Expected fetch-hazard-from-sideboard action' };

  const untapState = state.phaseState as UntapPhaseState;
  if (untapState.hazardSideboardDestination === null) {
    return { state, error: 'No hazard sideboard sub-flow active' };
  }

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  // Validate card is in sideboard
  const cardIdx = player.sideboard.findIndex(c => c.instanceId === action.sideboardCardInstanceId);
  if (cardIdx === -1) {
    return { state, error: 'Card not found in sideboard' };
  }

  // Validate card type is hazard
  const sideboardCard = player.sideboard[cardIdx];
  const def = state.cardPool[sideboardCard.definitionId as string];
  if (!def || !def.cardType.includes('hazard')) {
    return { state, error: 'Only hazard cards can be fetched during untap sideboard access' };
  }

  const destination = untapState.hazardSideboardDestination;

  // Validate limits
  if (destination === 'deck' && untapState.hazardSideboardFetched >= 1) {
    return { state, error: 'Can only fetch 1 card to play deck' };
  }
  if (destination === 'discard' && untapState.hazardSideboardFetched >= 5) {
    return { state, error: 'Can only fetch up to 5 cards to discard pile' };
  }

  const newSideboard = [...player.sideboard];
  newSideboard.splice(cardIdx, 1);

  const newPlayers = clonePlayers(state);
  let newRng = state.rng;

  if (destination === 'discard') {
    logDetail(`Hazard sideboard → discard: ${def.name} (${action.sideboardCardInstanceId as string})`);
    newPlayers[playerIndex] = {
      ...newPlayers[playerIndex],
      sideboard: newSideboard,
      discardPile: [...player.discardPile, sideboardCard],
    };
  } else {
    logDetail(`Hazard sideboard → play deck: ${def.name} (${action.sideboardCardInstanceId as string}), shuffling`);
    const [shuffledDeck, nextRng] = shuffle([...player.playDeck, sideboardCard], state.rng);
    newRng = nextRng;
    newPlayers[playerIndex] = {
      ...newPlayers[playerIndex],
      sideboard: newSideboard,
      playDeck: shuffledDeck,
    };
  }

  // Mark sideboard accessed for hazard limit halving
  newPlayers[playerIndex] = { ...newPlayers[playerIndex], sideboardAccessedDuringUntap: true };

  const newUntapState: UntapPhaseState = {
    ...untapState,
    hazardSideboardFetched: untapState.hazardSideboardFetched + 1,
    // Deck destination: exit sub-flow after 1 card; discard: stay in sub-flow
    hazardSideboardDestination: destination === 'deck' ? null : destination,
  };

  return {
    state: {
      ...state,
      players: newPlayers,
      rng: newRng,
      phaseState: newUntapState,
    },
  };
}

/**
 * Perform the untap mechanics on the active player's cards.
 * Called when entering the untap phase (before any player actions).
 * Untaps all tapped characters, items, allies, and cards in play.
 * Heals wounded characters at havens to tapped position.
 */


/**
 * Perform the untap mechanics on the active player's cards.
 * Called when entering the untap phase (before any player actions).
 * Untaps all tapped characters, items, allies, and cards in play.
 * Heals wounded characters at havens to tapped position.
 */
function performUntap(state: GameState): GameState {
  const playerIndex = getPlayerIndex(state, state.activePlayer!);
  const player = state.players[playerIndex];

  // Build a set of character IDs at havens for healing wounded characters
  const charsAtHaven = new Set<string>();
  for (const company of player.companies) {
    if (!company.currentSite) continue;
    const siteDef = state.cardPool[company.currentSite.definitionId];
    if (!siteDef || !isSiteCard(siteDef)) continue;
    if (siteDef.siteType === SiteType.Haven) {
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
  logDetail(`Untap: untapping ${tappedCharCount} character(s), healing ${healedCount} wounded character(s) at havens/healing sites`);

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...player, characters: newCharacters, cardsInPlay: newCardsInPlay };
  return { ...state, players: newPlayers };
}

/**
 * Build the untap phase state.
 * Called from all entry points into the untap phase.
 */


/**
 * Build the untap phase state.
 * Called from all entry points into the untap phase.
 */
export function enterUntapPhase(state: GameState): GameState {
  return {
    ...state,
    phaseState: { phase: Phase.Untap, untapped: false, hazardSideboardDestination: null, hazardSideboardFetched: 0, hazardSideboardAccessed: false, resourcePlayerPassed: false, hazardPlayerPassed: false, pendingLureChecks: [] },
  };
}

/**
 * Advance from the untap phase to the Organization phase.
 * Called when resource player has untapped and hazard player has passed.
 */


/**
 * Scan the active player's characters for "on-event" effects with
 * event "untap-phase-at-haven" and return instance IDs of characters
 * at havens that have such hazards attached.
 */
function findLureChecks(state: GameState): CardInstanceId[] {
  const activeIdx = getPlayerIndex(state, state.activePlayer!);
  const player = state.players[activeIdx];
  const result: CardInstanceId[] = [];

  for (const company of player.companies) {
    // Check if company is at a haven
    if (!company.currentSite) continue;
    const siteDef = state.cardPool[company.currentSite.definitionId as string];
    if (!siteDef || !isSiteCard(siteDef)) continue;
    if (siteDef.siteType !== SiteType.Haven) continue;

    for (const charId of company.characters) {
      const char = player.characters[charId as string];
      if (!char) continue;
      // Check hazards attached to this character for the trigger
      for (const hazard of char.hazards) {
        const hazDef = state.cardPool[hazard.definitionId as string];
        if (!hazDef || !('effects' in hazDef) || !hazDef.effects) continue;
        const hasLureTrigger = hazDef.effects.some(
          (e: { type: string; event?: string }) =>
            e.type === 'on-event' && e.event === 'untap-phase-at-haven',
        );
        if (hasLureTrigger) {
          logDetail(`Lure corruption check queued for character ${charId as string} at haven ${siteDef.name}`);
          result.push(charId);
          break; // One check per character even if multiple lure hazards
        }
      }
    }
  }
  return result;
}

/**
 * Advance from the untap phase to the Organization phase.
 * Called when resource player has untapped and hazard player has passed.
 * Before transitioning, checks for Lure hazard corruption checks.
 */
function advanceToOrganization(state: GameState): ReducerResult {
  // Check for characters that need Lure corruption checks at havens
  const lureChecks = findLureChecks(state);
  if (lureChecks.length > 0) {
    logDetail(`Untap: ${lureChecks.length} character(s) need Lure corruption checks before advancing`);
    const untapState = state.phaseState as UntapPhaseState;
    return {
      state: {
        ...state,
        phaseState: { ...untapState, pendingLureChecks: lureChecks },
      },
    };
  }

  logDetail('Untap: advancing to Organization phase');
  return {
    state: {
      ...state,
      phaseState: { phase: Phase.Organization, characterPlayedThisTurn: false, sideboardFetchedThisTurn: 0, sideboardFetchDestination: null, pendingCorruptionCheck: null },
    },
  };
}

/**
 * Handle corruption check during untap phase (triggered by Lure hazards
 * on characters at havens). Similar to Free Council corruption checks
 * but occurs at the end of the untap phase.
 */
function handleUntapCorruptionCheck(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'corruption-check') return { state, error: 'Expected corruption-check action' };

  const untapState = state.phaseState as UntapPhaseState;
  if (untapState.pendingLureChecks.length === 0) {
    return { state, error: 'No pending Lure corruption checks' };
  }
  if (!untapState.pendingLureChecks.includes(action.characterId)) {
    return { state, error: 'Character not in pending Lure corruption check list' };
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
  const total = roll.die1 + roll.die2 + modifier;
  const modStr = modifier !== 0 ? ` ${modifier >= 0 ? '+' : ''}${modifier}` : '';
  logDetail(`Lure corruption check for ${charName}: rolled ${roll.die1} + ${roll.die2}${modStr} = ${total} vs CP ${cp}`);

  const rollEffect: GameEffect = {
    effect: 'dice-roll',
    playerName: player.name,
    die1: roll.die1,
    die2: roll.die2,
    label: `Lure Corruption: ${charName}`,
  };

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...newPlayers[playerIndex], lastDiceRoll: roll };

  // Remove this character from pending list
  const remainingChecks = untapState.pendingLureChecks.filter(id => id !== action.characterId);

  if (total > cp) {
    // Passed — continue with remaining checks or advance
    logDetail(`Lure corruption check passed (${total} > ${cp})`);
    if (remainingChecks.length === 0) {
      logDetail('Untap: all Lure corruption checks resolved, advancing to Organization');
      return {
        state: {
          ...state,
          players: newPlayers,
          rng, cheatRollTotal,
          phaseState: { phase: Phase.Organization, characterPlayedThisTurn: false, sideboardFetchedThisTurn: 0, sideboardFetchDestination: null, pendingCorruptionCheck: null },
        },
        effects: [rollEffect],
      };
    }
    return {
      state: {
        ...state,
        players: newPlayers,
        rng, cheatRollTotal,
        phaseState: { ...untapState, pendingLureChecks: remainingChecks },
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
    logDetail(`Lure corruption check FAILED (${total} within 1 of ${cp}) — discarding ${charName}`);
    const toDiscard: CardInstance[] = [
      { instanceId: action.characterId, definitionId: char.definitionId },
      ...action.possessions.map((id: CardInstanceId) => ({ instanceId: id, definitionId: resolveInstanceId(state, id)! })),
    ];
    newPlayers[playerIndex] = {
      ...newPlayers[playerIndex],
      characters: newCharacters,
      companies: newCompanies,
      discardPile: [...player.discardPile, ...toDiscard],
    };
  } else {
    // Roll < CP-1: character eliminated, possessions discarded
    logDetail(`Lure corruption check FAILED (${total} < ${cp - 1}) — eliminating ${charName}`);
    newPlayers[playerIndex] = {
      ...newPlayers[playerIndex],
      characters: newCharacters,
      companies: newCompanies,
      eliminatedPile: [...player.eliminatedPile, { instanceId: action.characterId, definitionId: char.definitionId }],
      discardPile: [...player.discardPile, ...action.possessions.map((id: CardInstanceId) => ({ instanceId: id, definitionId: resolveInstanceId(state, id)! }))],
    };
  }

  const updatedState = cleanupEmptyCompanies({
    ...state,
    players: newPlayers,
    rng, cheatRollTotal,
  });

  if (remainingChecks.length === 0) {
    logDetail('Untap: all Lure corruption checks resolved, advancing to Organization');
    return {
      state: {
        ...updatedState,
        phaseState: { phase: Phase.Organization, characterPlayedThisTurn: false, sideboardFetchedThisTurn: 0, sideboardFetchDestination: null, pendingCorruptionCheck: null },
      },
      effects: [rollEffect],
    };
  }

  return {
    state: {
      ...updatedState,
      phaseState: { ...untapState, pendingLureChecks: remainingChecks },
    },
    effects: [rollEffect],
  };
}

/** Handle actions during the organization phase. */

