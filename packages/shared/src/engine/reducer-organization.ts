/**
 * @module reducer-organization
 *
 * Organization phase handlers for the game reducer. Covers playing characters,
 * moving characters between companies, transferring items, corruption checks,
 * planning movement, and sideboard access.
 */

import type { GameState, CardInstanceId, CharacterInPlay, CardInstance, OrganizationPhaseState, Company, SiteInPlay, GameAction, GameEffect } from '../index.js';
import { Phase, shuffle, CardStatus, isSiteCard, isResourceEventCard, SiteType, getPlayerIndex, ZERO_EFFECTIVE_STATS } from '../index.js';
import { logDetail } from './legal-actions/log.js';
import { isEndOfOrgPlay } from './legal-actions/organization.js';
import { resolveInstanceId } from '../types/state.js';
import type { ReducerResult } from './reducer-utils.js';
import { roll2d6, clonePlayers, nextCompanyId, handleFetchFromPile, sweepAutoDiscardHazards, removeById, toCardInstance, updatePlayer, updateCharacter, wrongActionType } from './reducer-utils.js';
import { handlePlayPermanentEvent, handlePlayShortEvent, handlePlayResourceShortEvent } from './reducer-events.js';
import { enqueueResolution, enqueueCorruptionCheck, addConstraint, removeConstraint } from './pending.js';
import { recomputeDerived } from './recompute-derived.js';
import { collectCharacterEffects, resolveCheckModifier } from './effects/index.js';


type OrgHandler = (state: GameState, action: GameAction) => ReducerResult;

/**
 * Per-action-type dispatch for the Organization phase. Each handler receives
 * the current state and the matching {@link GameAction}; the handler itself
 * validates the action's discriminant. Actions not listed here fall through
 * to the "Unhandled organization action" error.
 *
 * Corruption checks are routed through the unified pending-resolution
 * dispatcher in `pending-reducers.ts` before this table is consulted.
 */
const ORGANIZATION_HANDLERS: Readonly<Partial<Record<GameAction['type'], OrgHandler>>> = {
  'play-character': handlePlayCharacter,
  'pass': handleOrganizationPass,
  'plan-movement': handlePlanMovement,
  'cancel-movement': handleCancelMovement,
  'play-permanent-event': handlePlayPermanentEvent,
  'play-short-event': handleOrganizationPlayShortEvent,
  'fetch-from-pile': handleFetchFromPile,
  'move-to-influence': handleMoveToInfluence,
  'transfer-item': handleTransferItem,
  'store-item': handleStoreItem,
  'split-company': handleSplitCompany,
  'move-to-company': handleMoveToCompany,
  'merge-companies': handleMergeCompanies,
  'start-sideboard-to-deck': handleStartSideboard,
  'start-sideboard-to-discard': handleStartSideboard,
  'fetch-from-sideboard': handleFetchFromSideboard,
  'activate-granted-action': handleActivateGrantedAction,
};

export function handleOrganization(state: GameState, action: GameAction): ReducerResult {
  const handler = ORGANIZATION_HANDLERS[action.type];
  if (!handler) return { state, error: `Unhandled organization action: ${action.type}` };
  return handler(state, action);
}

/**
 * Pass during organization. If a sideboard-to-discard sub-flow is active,
 * exits the sub-flow and returns to normal play. Otherwise advances to the
 * Long-event phase (discarding the active player's resource long-events per
 * CoE rule 2.III.1).
 */
function handleOrganizationPass(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'pass') return wrongActionType(state, action, 'pass');
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

  const activePlayer = state.activePlayer!;
  const activeIndex = getPlayerIndex(state, activePlayer);
  const player = state.players[activeIndex];
  const discardedEvents: CardInstance[] = [];
  const remainingCards = player.cardsInPlay.filter(card => {
    const def = state.cardPool[card.definitionId as string];
    if (def && def.cardType === 'hero-resource-event' && def.eventType === 'long') {
      logDetail(`Long-event entry: discarding resource long-event "${def.name}" (${card.instanceId as string})`);
      discardedEvents.push(toCardInstance(card));
      return false;
    }
    return true;
  });

  return {
    state: {
      ...updatePlayer(state, activeIndex, p => ({
        ...p,
        cardsInPlay: remainingCards,
        discardPile: [...p.discardPile, ...discardedEvents],
      })),
      phaseState: { phase: Phase.LongEvent },
    },
  };
}

/**
 * Dispatch a play-short-event action during organization. Hazard short
 * events go through the hazard flow; resource short events resolve their
 * DSL effects. After a resource end-of-org card plays successfully, the
 * phase implicitly transitions into the end-of-org sub-step so the active
 * player can chain more end-of-org plays but no further normal organization
 * actions this turn.
 */
function handleOrganizationPlayShortEvent(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'play-short-event') return wrongActionType(state, action, 'play-short-event');
  let result: ReducerResult;
  let endOfOrgPlay = false;
  if (action.cardInstanceId) {
    const player = state.players.find(p => p.id === action.player);
    const card = player?.hand.find(c => c.instanceId === action.cardInstanceId);
    const def = card ? state.cardPool[card.definitionId as string] : undefined;
    if (isResourceEventCard(def)) {
      endOfOrgPlay = isEndOfOrgPlay(def);
      result = handlePlayResourceShortEvent(state, action);
    } else {
      result = handlePlayShortEvent(state, action);
    }
  } else {
    result = handlePlayShortEvent(state, action);
  }
  if (!result.error && endOfOrgPlay) {
    const newOrgState = result.state.phaseState as OrganizationPhaseState;
    if (newOrgState.phase === Phase.Organization && newOrgState.step !== 'end-of-org') {
      logDetail(`Organization: end-of-org card played → entering end-of-org sub-step`);
      return {
        ...result,
        state: {
          ...result.state,
          phaseState: { ...newOrgState, step: 'end-of-org' as const },
        },
      };
    }
  }
  return result;
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
  if (action.type !== 'play-character') return wrongActionType(state, action, 'play-character');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const phaseState = state.phaseState as OrganizationPhaseState;

  const charInstId = action.characterInstanceId;
  const handCard = player.hand.find(c => c.instanceId === charInstId)!;
  const charDef = state.cardPool[handCard.definitionId as string] as import('../types/cards.js').CharacterCard;

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
  const newHand = removeById(player.hand, charInstId);

  // Find existing company at the target site
  const companies = [...player.companies];
  const existingCompanyIdx = companies.findIndex(c => c.currentSite?.instanceId === action.atSite);

  // Update or create company
  let newSiteDeck = player.siteDeck;
  if (existingCompanyIdx >= 0) {
    const company = companies[existingCompanyIdx];
    logDetail(`  Adding to existing company ${company.id as string}`);
    companies[existingCompanyIdx] = {
      ...company,
      characters: [...company.characters, charInstId],
    };
  } else {
    const siteInstId = action.atSite;
    const siteCard = player.siteDeck.find(c => c.instanceId === siteInstId)!;
    const siteDef = state.cardPool[siteCard.definitionId as string] as import('../types/cards.js').SiteCard;

    logDetail(`  Creating new company at ${siteDef.name} (from site deck)`);

    // Remove site from site deck
    newSiteDeck = removeById(player.siteDeck, siteInstId);

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

  return {
    state: sweepAutoDiscardHazards({
      ...updatePlayer(state, playerIndex, p => ({
        ...p,
        hand: newHand,
        siteDeck: newSiteDeck,
        characters: newCharacters,
        companies,
      })),
      phaseState: { ...phaseState, characterPlayedThisTurn: true },
    }),
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
  if (action.type !== 'move-to-influence') return wrongActionType(state, action, 'move-to-influence');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const charInstId = action.characterInstanceId;
  const char = player.characters[charInstId as string];
  if (!char) return { state, error: 'Character not found' };

  const charDefId = resolveInstanceId(state, charInstId);
  const charDef = charDefId ? state.cardPool[charDefId as string] : undefined;
  const narrowedCharDef = charDef as import('../types/cards.js').CharacterCard;

  logDetail(`Move to influence: ${narrowedCharDef.name} → ${action.controlledBy as string}`);

  const newCharacters = { ...player.characters };

  if (action.controlledBy === 'general') {
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

  // Reverse: move the character back to their old influence controller
  const reverseAction: GameAction = {
    type: 'move-to-influence',
    player: action.player,
    characterInstanceId: charInstId,
    controlledBy: char.controlledBy,
  };

  return {
    state: {
      ...updatePlayer(state, playerIndex, p => ({ ...p, characters: newCharacters })),
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
  if (action.type !== 'transfer-item') return wrongActionType(state, action, 'transfer-item');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const fromCharId = action.fromCharacterId;
  const toCharId = action.toCharacterId;
  const itemInstId = action.itemInstanceId;

  const fromChar = player.characters[fromCharId as string];
  if (!fromChar) return { state, error: 'Source character not found' };

  const toChar = player.characters[toCharId as string];
  if (!toChar) return { state, error: 'Target character not found' };

  const itemIndex = fromChar.items.findIndex(i => i.instanceId === itemInstId);
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

  // Enqueue a corruption-check resolution for the character who gave away
  // the item. The unified pending system replaces the old per-phase
  // `pendingCorruptionCheck` field; the resolver in `pending-reducers.ts`
  // handles the failure case (including removing the transferred item from
  // its new bearer if the check fails).
  logDetail(`Enqueuing corruption check for ${fromDef?.name ?? '?'} after item transfer`);

  const stateAfterTransfer: GameState = {
    ...updatePlayer(state, playerIndex, p => ({ ...p, characters: newCharacters })),
    reverseActions: [...state.reverseActions, {
      type: 'transfer-item' as const,
      player: action.player,
      itemInstanceId: itemInstId,
      fromCharacterId: toCharId,
      toCharacterId: fromCharId,
    }],
  };

  return {
    state: enqueueCorruptionCheck(stateAfterTransfer, {
      source: itemInstId,
      actor: action.player,
      scope: { kind: 'phase', phase: Phase.Organization },
      characterId: fromCharId,
      reason: 'Transfer',
      transferredItemId: itemInstId,
    }),
  };
}

/**
 * Handle store-item during organization.
 *
 * Moves an item from a character to the player's out-of-play pile. The
 * character must be at a site matching the item's storable-at effect.
 * Stored items continue to earn marshalling points (via the item's
 * `storable-at` effect); the initial bearer makes a corruption check.
 */
function handleStoreItem(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'store-item') return wrongActionType(state, action, 'store-item');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const charId = action.characterId;
  const itemInstId = action.itemInstanceId;

  const char = player.characters[charId as string];
  const itemIndex = char.items.findIndex(i => i.instanceId === itemInstId);
  const item = char.items[itemIndex];
  const itemDef = state.cardPool[item.definitionId as string];
  const charDefId = resolveInstanceId(state, charId);
  const charDef = charDefId ? state.cardPool[charDefId as string] : undefined;
  logDetail(`Store item: ${itemDef?.name ?? '?'} from ${charDef?.name ?? '?'}`);

  const newCharacters = { ...player.characters };
  newCharacters[charId as string] = {
    ...char,
    items: char.items.filter(i => i.instanceId !== itemInstId),
  };

  const storedCard: CardInstance = {
    instanceId: item.instanceId,
    definitionId: item.definitionId,
  };

  logDetail(`Enqueuing corruption check for ${charDef?.name ?? '?'} after item storage`);

  const stateAfterStore: GameState = updatePlayer(state, playerIndex, p => ({
    ...p,
    characters: newCharacters,
    outOfPlayPile: [...p.outOfPlayPile, storedCard],
  }));

  const stateAfterCheck = enqueueCorruptionCheck(stateAfterStore, {
    source: itemInstId,
    actor: action.player,
    scope: { kind: 'phase', phase: Phase.Organization },
    characterId: charId,
    reason: 'Store',
  });

  // Auto-test-gold-ring site-rule (Rule 9.22): storing a gold-ring item at a
  // Darkhaven (or any site declaring this rule) triggers an automatic ring
  // test with the site's roll modifier. Enqueued after the corruption check
  // so both resolve in order.
  const itemSubtype = itemDef && 'subtype' in itemDef ? itemDef.subtype : undefined;
  const autoTestMod = goldRingAutoTestModifier(state, player.companies, charId, itemSubtype);
  if (autoTestMod !== null) {
    const siteName = goldRingAutoTestSiteName(state, player.companies, charId) ?? '?';
    logDetail(`Auto-test gold ring ${itemDef?.name ?? '?'} at ${siteName} (modifier ${autoTestMod >= 0 ? '+' : ''}${autoTestMod})`);
    return {
      state: enqueueResolution(stateAfterCheck, {
        source: itemInstId,
        actor: action.player,
        scope: { kind: 'phase', phase: Phase.Organization },
        kind: {
          type: 'gold-ring-test',
          goldRingInstanceId: itemInstId,
          rollModifier: autoTestMod,
        },
      }),
    };
  }

  return { state: stateAfterCheck };
}

/**
 * If the character carrying the item is in a company at a site whose
 * `auto-test-gold-ring` site-rule applies and the item is a gold ring,
 * return the rule's roll modifier. Returns null otherwise (no auto-test).
 */
function goldRingAutoTestModifier(
  state: GameState,
  companies: readonly Company[],
  characterId: CardInstanceId,
  itemSubtype: string | undefined,
): number | null {
  if (itemSubtype !== 'gold-ring') return null;
  const company = companies.find(c => c.characters.includes(characterId));
  if (!company?.currentSite) return null;
  const siteDefId = resolveInstanceId(state, company.currentSite.instanceId);
  if (!siteDefId) return null;
  const siteDef = state.cardPool[siteDefId as unknown as string];
  if (!siteDef || !isSiteCard(siteDef) || !siteDef.effects) return null;
  const rule = siteDef.effects.find(e => e.type === 'site-rule' && e.rule === 'auto-test-gold-ring');
  if (!rule || rule.type !== 'site-rule' || rule.rule !== 'auto-test-gold-ring') return null;
  return rule.rollModifier;
}

/** Same lookup as {@link goldRingAutoTestModifier} but returns the site's name. */
function goldRingAutoTestSiteName(
  state: GameState,
  companies: readonly Company[],
  characterId: CardInstanceId,
): string | null {
  const company = companies.find(c => c.characters.includes(characterId));
  if (!company?.currentSite) return null;
  const siteDefId = resolveInstanceId(state, company.currentSite.instanceId);
  if (!siteDefId) return null;
  const siteDef = state.cardPool[siteDefId as unknown as string];
  if (!siteDef || !isSiteCard(siteDef)) return null;
  return siteDef.name;
}

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
  const avatarKey = action.characterInstanceId as string;
  const avatarChar = state.players[playerIndex].characters[avatarKey];
  if (avatarChar) {
    const charDef = state.cardPool[avatarChar.definitionId as string];
    logDetail(`Tapping avatar ${charDef?.name ?? '?'} for sideboard access (${destination})`);
  }
  const newState = avatarChar
    ? updatePlayer(state, playerIndex, p => updateCharacter(p, avatarKey, c => ({ ...c, status: CardStatus.Tapped })))
    : state;

  return {
    state: {
      ...newState,
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
  if (action.type !== 'fetch-from-sideboard') return wrongActionType(state, action, 'fetch-from-sideboard');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const orgState = state.phaseState as OrganizationPhaseState;

  if (orgState.sideboardFetchDestination === null) {
    return { state, error: 'No sideboard access sub-flow active' };
  }

  const cardIdx = player.sideboard.findIndex(c => c.instanceId === action.sideboardCardInstanceId);
  const sideboardCard = player.sideboard[cardIdx];
  const def = state.cardPool[sideboardCard.definitionId as string];
  const destination = orgState.sideboardFetchDestination;

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
 * Handle activation of a grant-action effect during organization. All
 * cards that declare `grant-action` now carry an `apply` clause, so
 * this entry point just delegates to the generic dispatcher — no
 * per-`actionId` branching.
 */
function handleActivateGrantedAction(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'activate-granted-action') return { state, error: 'Expected activate-granted-action' };
  return handleGrantActionApply(state, action);
}



// handleOrganizationCorruptionCheck moved to engine/pending-reducers.ts
// (`applyCorruptionCheckResolution`) as part of the unified pending
// system. See `specs/2026-04-08-pending-effects-plan.md`.

/**
 * Which attachment slot a source card lives in, and which player owns
 * the corresponding discard pile. Hazards are opponent-owned; items and
 * allies belong to the character's own player.
 */
function locateSourceOnCharacter(
  char: CharacterInPlay,
  sourceCardId: CardInstanceId,
  playerIndex: number,
): { slot: 'items' | 'allies' | 'hazards'; discardPileOwnerIndex: number } | null {
  if (char.items.some(i => i.instanceId === sourceCardId)) {
    return { slot: 'items', discardPileOwnerIndex: playerIndex };
  }
  if (char.allies.some(a => a.instanceId === sourceCardId)) {
    return { slot: 'allies', discardPileOwnerIndex: playerIndex };
  }
  if (char.hazards.some(h => h.instanceId === sourceCardId)) {
    return { slot: 'hazards', discardPileOwnerIndex: 1 - playerIndex };
  }
  return null;
}

/**
 * Remove the source card from the character's attachment list and push
 * it into the appropriate discard pile. Returns the updated character
 * (detached) and a function that mutates `newPlayers` to record the
 * discard. Caller is responsible for writing back the updated character.
 */
function detachAndDiscardSource(
  char: CharacterInPlay,
  sourceCardId: CardInstanceId,
  sourceCardDefinitionId: import('../types/common.js').CardDefinitionId,
  playerIndex: number,
  newPlayers: import('../types/state.js').PlayerState[],
): { updatedChar: CharacterInPlay } | { error: string } {
  const loc = locateSourceOnCharacter(char, sourceCardId, playerIndex);
  if (!loc) return { error: `source card ${sourceCardId as string} not attached to character` };
  const discardedCard: CardInstance = { instanceId: sourceCardId, definitionId: sourceCardDefinitionId };
  const updatedChar: CharacterInPlay = loc.slot === 'items'
    ? { ...char, items: removeById(char.items, sourceCardId) }
    : loc.slot === 'allies'
      ? { ...char, allies: removeById(char.allies, sourceCardId) }
      : { ...char, hazards: removeById(char.hazards, sourceCardId) };
  const owner = newPlayers[loc.discardPileOwnerIndex];
  newPlayers[loc.discardPileOwnerIndex] = {
    ...owner,
    discardPile: [...owner.discardPile, discardedCard],
  };
  return { updatedChar };
}

/**
 * Context for executing a grant-action apply: everything the inner
 * dispatch needs. Kept in one record so the recursive apply walker
 * (e.g. `roll-then-apply` → onSuccess) can reuse it without repeating
 * argument lists.
 */
interface GrantApplyContext {
  readonly action: Extract<GameAction, { type: 'activate-granted-action' }>;
  readonly playerIndex: number;
  readonly charName: string;
  readonly sourceName: string;
  readonly sourceCardDefinitionId: import('../types/common.js').CardDefinitionId;
}

/** Result of running one apply: the updated character plus optional
 *  engine effects (dice rolls) and post-write state transforms (adding
 *  constraints, enqueuing corruption checks). The caller writes
 *  `updatedChar` back to players first, then folds `stateOps` over the
 *  resulting state so the transforms see the tapped/detached character.
 */
type ApplyOk = {
  updatedChar: CharacterInPlay;
  effects: GameEffect[];
  stateOps: Array<(state: GameState) => GameState>;
};

/**
 * Apply a single TriggeredAction in a grant-action context. Mutates
 * `newPlayers` in place (via assignment to indices) and returns the
 * updated character + any engine effects produced (e.g. dice rolls) +
 * any state-level transforms to apply after the character is written
 * back (constraint additions, resolution enqueues).
 */
function runGrantApply(
  state: GameState,
  apply: import('../types/effects.js').TriggeredAction,
  char: CharacterInPlay,
  newPlayers: import('../types/state.js').PlayerState[],
  ctx: GrantApplyContext,
  rngRef: { rng: GameState['rng']; cheatRollTotal: GameState['cheatRollTotal'] },
): ApplyOk | { error: string } {
  if (apply.type === 'sequence') {
    if (!apply.apps || apply.apps.length === 0) {
      return { updatedChar: char, effects: [], stateOps: [] };
    }
    let currentChar = char;
    const allEffects: GameEffect[] = [];
    const allOps: Array<(s: GameState) => GameState> = [];
    for (const sub of apply.apps) {
      const r = runGrantApply(state, sub, currentChar, newPlayers, ctx, rngRef);
      if ('error' in r) return r;
      currentChar = r.updatedChar;
      allEffects.push(...r.effects);
      allOps.push(...r.stateOps);
    }
    return { updatedChar: currentChar, effects: allEffects, stateOps: allOps };
  }

  if (apply.type === 'set-character-status' && apply.target === 'bearer') {
    if (apply.status === undefined) {
      return { error: `set-character-status apply missing status on ${ctx.sourceName}` };
    }
    const statusEnum = apply.status === 'untapped' ? CardStatus.Untapped
      : apply.status === 'tapped' ? CardStatus.Tapped
        : CardStatus.Inverted;
    logDetail(`Grant-action ${ctx.action.actionId}: ${ctx.charName} → status ${apply.status}`);
    return { updatedChar: { ...char, status: statusEnum }, effects: [], stateOps: [] };
  }

  if (apply.type === 'set-character-status' && apply.target === 'target-character') {
    if (apply.status === undefined) {
      return { error: `set-character-status apply missing status on ${ctx.sourceName}` };
    }
    const targetCardId = ctx.action.targetCardId;
    if (!targetCardId) {
      return { error: `set-character-status target-character: action has no targetCardId on ${ctx.sourceName}` };
    }
    const bearerPlayer = newPlayers[ctx.playerIndex];
    const company = bearerPlayer.companies.find(c => c.characters.includes(ctx.action.characterId));
    if (!company) {
      return { error: `${ctx.charName} is not in any company` };
    }
    if (!company.characters.includes(targetCardId)) {
      return { error: `set-character-status target-character: target ${targetCardId as string} not in ${ctx.charName}'s company` };
    }
    const targetChar = bearerPlayer.characters[targetCardId as string];
    if (!targetChar) {
      return { error: `set-character-status target-character: target ${targetCardId as string} not found` };
    }
    const statusEnum = apply.status === 'untapped' ? CardStatus.Untapped
      : apply.status === 'tapped' ? CardStatus.Tapped
        : CardStatus.Inverted;
    const targetDef = state.cardPool[targetChar.definitionId as string];
    const targetName = targetDef && 'name' in targetDef ? (targetDef as { name: string }).name : '?';
    logDetail(`Grant-action ${ctx.action.actionId}: ${targetName} → status ${apply.status}`);
    newPlayers[ctx.playerIndex] = {
      ...bearerPlayer,
      characters: {
        ...bearerPlayer.characters,
        [targetCardId as string]: { ...targetChar, status: statusEnum },
      },
    };
    const updatedChar = targetCardId === ctx.action.characterId
      ? { ...char, status: statusEnum }
      : char;
    return { updatedChar, effects: [], stateOps: [] };
  }

  if (apply.type === 'discard-self') {
    const result = detachAndDiscardSource(char, ctx.action.sourceCardId, ctx.sourceCardDefinitionId, ctx.playerIndex, newPlayers);
    if ('error' in result) return { error: result.error };
    logDetail(`Grant-action ${ctx.action.actionId}: discarded ${ctx.sourceName}`);
    return { updatedChar: result.updatedChar, effects: [], stateOps: [] };
  }

  if (apply.type === 'increment-company-extra-region-distance') {
    const amount = apply.amount ?? 1;
    const bearerPlayer = newPlayers[ctx.playerIndex];
    const company = bearerPlayer.companies.find(c => c.characters.includes(ctx.action.characterId));
    if (!company) {
      return { error: `${ctx.charName} is not in any company` };
    }
    const currentExtra = company.extraRegionDistance ?? 0;
    logDetail(`Grant-action ${ctx.action.actionId}: company ${company.id as string} extraRegionDistance ${currentExtra} → ${currentExtra + amount}`);
    newPlayers[ctx.playerIndex] = {
      ...bearerPlayer,
      companies: bearerPlayer.companies.map(c =>
        c.id === company.id ? { ...c, extraRegionDistance: currentExtra + amount } : c,
      ),
    };
    return { updatedChar: char, effects: [], stateOps: [] };
  }

  if (apply.type === 'set-company-special-movement') {
    if (apply.specialMovement === undefined) {
      return { error: `set-company-special-movement missing specialMovement on ${ctx.sourceName}` };
    }
    const bearerPlayer = newPlayers[ctx.playerIndex];
    const company = bearerPlayer.companies.find(c => c.characters.includes(ctx.action.characterId));
    if (!company) {
      return { error: `${ctx.charName} is not in any company` };
    }
    logDetail(`Grant-action ${ctx.action.actionId}: company ${company.id as string} → specialMovement=${apply.specialMovement}`);
    newPlayers[ctx.playerIndex] = {
      ...bearerPlayer,
      companies: bearerPlayer.companies.map(c =>
        c.id === company.id ? { ...c, specialMovement: apply.specialMovement } : c,
      ),
    };
    return { updatedChar: char, effects: [], stateOps: [] };
  }

  if (apply.type === 'add-constraint') {
    const constraintKind = apply.constraint;
    if (!constraintKind) {
      return { error: `add-constraint missing constraint kind on ${ctx.sourceName}` };
    }
    // Most constraint kinds added via grant-action carry no payload
    // (see {@link constraintKindWithoutPayload}). A small set of
    // payload-carrying kinds — currently only `company-stat-modifier`
    // used by discard-to-boost items (Orc-draughts et al.) — read their
    // fields off the apply clause.
    const kind = buildPayloadConstraintKind(constraintKind, apply)
      ?? constraintKindWithoutPayload(constraintKind);
    if (!kind) {
      return { error: `add-constraint: unsupported constraint kind "${constraintKind}" from grant-action (${ctx.sourceName})` };
    }
    const scope = parseConstraintScope(apply.scope, newPlayers[ctx.playerIndex], ctx.action.characterId);
    if (!scope) {
      return { error: `add-constraint: unknown or unresolved scope "${apply.scope ?? ''}" on ${ctx.sourceName}` };
    }
    const target = resolveConstraintTarget(apply.target, newPlayers[ctx.playerIndex], ctx.action.characterId, ctx.action.player);
    if (!target) {
      return { error: `add-constraint: cannot resolve target "${apply.target ?? ''}" on ${ctx.sourceName}` };
    }
    const sourceId = ctx.action.sourceCardId;
    const sourceDefId = ctx.sourceCardDefinitionId;
    // METD §5: hazard-limit-modifier additions during the site phase
    // have no effect — the limit is locked at site reveal.
    if (kind.type === 'hazard-limit-modifier' && state.phaseState.phase === Phase.Site) {
      logDetail(`Grant-action ${ctx.action.actionId}: hazard-limit-modifier ignored — site-phase additions have no effect (METD §5)`);
      return { updatedChar: char, effects: [], stateOps: [] };
    }
    logDetail(`Grant-action ${ctx.action.actionId}: adding constraint ${constraintKind} (scope ${apply.scope ?? '?'})`);
    return {
      updatedChar: char,
      effects: [],
      stateOps: [
        s => addConstraint(s, { source: sourceId, sourceDefinitionId: sourceDefId, scope, target, kind }),
      ],
    };
  }

  if (apply.type === 'enqueue-corruption-check') {
    const modifier = apply.modifier ?? 0;
    const characterId = ctx.action.characterId;
    const actor = ctx.action.player;
    const sourceId = ctx.action.sourceCardId;
    const reason = ctx.sourceName;
    // The corruption check resolves in the phase in which the
    // grant-action was activated. For Organization-only abilities
    // (e.g. Promptings of Wisdom) this is `Phase.Organization`; for
    // any-phase and cross-phase abilities (e.g. Magical Harp, which
    // may fire during the owner's Site phase, the opponent's Site
    // phase, or the Free Council) the current phase is correct.
    const currentPhase = state.phaseState.phase;
    logDetail(`Grant-action ${ctx.action.actionId}: enqueueing corruption check on ${ctx.charName} (reason: ${reason}, modifier ${modifier}, phase: ${currentPhase})`);
    return {
      updatedChar: char,
      effects: [],
      stateOps: [
        s => enqueueCorruptionCheck(s, {
          source: sourceId,
          actor,
          scope: { kind: 'phase', phase: currentPhase },
          characterId,
          modifier,
          reason,
        }),
      ],
    };
  }

  if (apply.type === 'roll-check') {
    const checkName = apply.check;
    if (!checkName) {
      return { error: `roll-check missing check on ${ctx.sourceName}` };
    }
    const bearerPlayer = newPlayers[ctx.playerIndex];
    const company = bearerPlayer.companies.find(c => c.characters.includes(ctx.action.characterId));
    if (!company) {
      return { error: `${ctx.charName} is not in any company` };
    }
    const { roll, rng, cheatRollTotal } = roll2d6({ ...state, rng: rngRef.rng, cheatRollTotal: rngRef.cheatRollTotal });
    rngRef.rng = rng;
    rngRef.cheatRollTotal = cheatRollTotal;
    const base = roll.die1 + roll.die2;

    let modifier = 0;
    const checkContext = { reason: checkName };
    for (const compCharId of company.characters) {
      const compChar = bearerPlayer.characters[compCharId as string];
      if (!compChar) continue;
      const charEffects = collectCharacterEffects(state, compChar, checkContext);
      modifier += resolveCheckModifier(charEffects, checkName);
    }
    const total = base + modifier;

    let targetName = '';
    if (ctx.action.targetCardId) {
      for (const compCharId of company.characters) {
        const compChar = bearerPlayer.characters[compCharId as string];
        if (!compChar) continue;
        const targetItem = compChar.items.find(i => i.instanceId === ctx.action.targetCardId);
        if (targetItem) {
          const targetDef = state.cardPool[targetItem.definitionId as string];
          targetName = targetDef?.name ?? '';
          break;
        }
      }
    }

    const baseLabel = apply.label ?? checkName;
    const labelSuffix = targetName
      ? `${ctx.charName} tests ${targetName}`
      : ctx.charName;
    const label = `${baseLabel}: ${labelSuffix}`;
    if (modifier !== 0) {
      logDetail(`Grant-action ${ctx.action.actionId}: ${ctx.charName} rolls ${roll.die1} + ${roll.die2} = ${base}, modifier ${modifier >= 0 ? '+' : ''}${modifier} → ${total} (${checkName})`);
    } else {
      logDetail(`Grant-action ${ctx.action.actionId}: ${ctx.charName} rolls ${roll.die1} + ${roll.die2} = ${total} (${checkName})`);
    }

    const rollEffect: GameEffect = {
      effect: 'dice-roll',
      playerName: bearerPlayer.name,
      die1: roll.die1,
      die2: roll.die2,
      label,
    };
    newPlayers[ctx.playerIndex] = { ...newPlayers[ctx.playerIndex], lastDiceRoll: roll };
    return { updatedChar: char, effects: [rollEffect], stateOps: [] };
  }

  if (apply.type === 'discard-target-item') {
    const targetCardId = ctx.action.targetCardId;
    if (!targetCardId) {
      return { error: `discard-target-item: action has no targetCardId on ${ctx.sourceName}` };
    }
    const bearerPlayer = newPlayers[ctx.playerIndex];
    const company = bearerPlayer.companies.find(c => c.characters.includes(ctx.action.characterId));
    if (!company) {
      return { error: `${ctx.charName} is not in any company` };
    }
    let bearerOfTargetId: CardInstanceId | null = null;
    let targetDefId: import('../types/common.js').CardDefinitionId | null = null;
    for (const compCharId of company.characters) {
      const compChar = bearerPlayer.characters[compCharId as string];
      if (!compChar) continue;
      const targetItem = compChar.items.find(i => i.instanceId === targetCardId);
      if (targetItem) {
        bearerOfTargetId = compCharId;
        targetDefId = targetItem.definitionId;
        break;
      }
    }
    if (!bearerOfTargetId || !targetDefId) {
      return { error: `discard-target-item: target ${targetCardId as string} not found in ${ctx.charName}'s company` };
    }
    const targetBearer = bearerPlayer.characters[bearerOfTargetId as string];
    const updatedItems = targetBearer.items.filter(i => i.instanceId !== targetCardId);
    const discardedCard: CardInstance = { instanceId: targetCardId, definitionId: targetDefId };
    const targetDef = state.cardPool[targetDefId as string];
    logDetail(`Grant-action ${ctx.action.actionId}: discarding ${targetDef?.name ?? '?'} from ${state.cardPool[targetBearer.definitionId as string]?.name ?? '?'}`);

    newPlayers[ctx.playerIndex] = {
      ...bearerPlayer,
      characters: {
        ...bearerPlayer.characters,
        [bearerOfTargetId as string]: { ...targetBearer, items: updatedItems },
      },
      discardPile: [...bearerPlayer.discardPile, discardedCard],
    };
    // If the target was on the bearer's own character (rare but possible),
    // reflect the items change in the returned character as well so
    // later applies see it.
    const updatedChar = bearerOfTargetId === ctx.action.characterId
      ? { ...char, items: updatedItems }
      : char;
    return { updatedChar, effects: [], stateOps: [] };
  }

  if (apply.type === 'cancel-chain-entry') {
    if (apply.select !== 'most-recent-unresolved-hazard') {
      return { error: `cancel-chain-entry: unsupported select "${apply.select ?? ''}" on ${ctx.sourceName}` };
    }
    const chain = state.chain;
    if (!chain) return { error: `cancel-chain-entry: no active chain on ${ctx.sourceName}` };
    let entryIndex = -1;
    for (let i = chain.entries.length - 1; i >= 0; i--) {
      const e = chain.entries[i];
      if (e.resolved || e.negated || !e.card) continue;
      const def = state.cardPool[e.card.definitionId as string];
      if (def && (def.cardType === 'hazard-creature' || def.cardType === 'hazard-event')) {
        entryIndex = i;
        break;
      }
    }
    if (entryIndex === -1) {
      return { error: `cancel-chain-entry: no unresolved hazard entry to cancel on ${ctx.sourceName}` };
    }
    const entry = chain.entries[entryIndex];
    const entryDef = entry.card ? state.cardPool[entry.card.definitionId as string] : null;
    logDetail(`Grant-action ${ctx.action.actionId}: canceling chain entry ${entryIndex} (${entryDef?.name ?? '?'})`);
    return {
      updatedChar: char,
      effects: [],
      stateOps: [
        s => {
          const liveChain = s.chain;
          if (!liveChain) return s;
          const newEntries = liveChain.entries.map((e, i) => i === entryIndex ? { ...e, negated: true } : e);
          let nextState: GameState = { ...s, chain: { ...liveChain, entries: newEntries } };
          if (entry.card) {
            const hazardPlayerIndex = nextState.players.findIndex(p => p.id === entry.declaredBy);
            if (hazardPlayerIndex >= 0) {
              const hazardPlayer = nextState.players[hazardPlayerIndex];
              const newPlayersLocal = clonePlayers(nextState);
              newPlayersLocal[hazardPlayerIndex] = {
                ...hazardPlayer,
                discardPile: [...hazardPlayer.discardPile, { instanceId: entry.card.instanceId, definitionId: entry.card.definitionId }],
              };
              nextState = { ...nextState, players: newPlayersLocal };
            }
          }
          return nextState;
        },
      ],
    };
  }

  if (apply.type === 'remove-constraint') {
    if (apply.select !== 'constraint-source' && apply.select !== undefined) {
      return { error: `remove-constraint: unsupported select "${apply.select}" on ${ctx.sourceName}` };
    }
    const sourceId = ctx.action.sourceCardId;
    logDetail(`Grant-action ${ctx.action.actionId}: removing constraints sourced from ${ctx.sourceName}`);
    return {
      updatedChar: char,
      effects: [],
      stateOps: [
        s => {
          const matchingIds = s.activeConstraints.filter(c => c.source === sourceId).map(c => c.id);
          let next = s;
          for (const id of matchingIds) next = removeConstraint(next, id);
          return next;
        },
      ],
    };
  }

  if (apply.type === 'discard-named-card-from-company') {
    const cardName = apply.cardName;
    if (!cardName) {
      return { error: `discard-named-card-from-company: missing cardName on ${ctx.sourceName}` };
    }
    const bearerPlayer = newPlayers[ctx.playerIndex];
    const bearerCompany = bearerPlayer.companies.find(c => c.characters.includes(ctx.action.characterId));
    if (!bearerCompany || !bearerCompany.currentSite) {
      return { error: `${ctx.charName} is not in any company with a current site` };
    }
    const bearerSiteDef = state.cardPool[bearerCompany.currentSite.definitionId as string];
    const bearerSiteName = bearerSiteDef && 'name' in bearerSiteDef
      ? (bearerSiteDef as { name: string }).name
      : '';

    let ownerIndex = -1;
    let hostCharId: CardInstanceId | null = null;
    let targetInstanceId: CardInstanceId | null = null;
    let targetDefId: import('../types/common.js').CardDefinitionId | null = null;

    outer: for (let pIdx = 0; pIdx < newPlayers.length; pIdx++) {
      const p = newPlayers[pIdx];
      for (const company of p.companies) {
        const compSiteDef = company.currentSite
          ? state.cardPool[company.currentSite.definitionId as string]
          : undefined;
        const compSiteName = compSiteDef && 'name' in compSiteDef
          ? (compSiteDef as { name: string }).name
          : '';
        if (!compSiteName || compSiteName !== bearerSiteName) continue;
        for (const compCharId of company.characters) {
          const compChar = p.characters[compCharId as string];
          if (!compChar) continue;
          const hit = compChar.items.find(i => {
            const def = state.cardPool[i.definitionId as string];
            return !!(def && 'name' in def && (def as { name: string }).name === cardName);
          });
          if (hit) {
            ownerIndex = pIdx;
            hostCharId = compCharId;
            targetInstanceId = hit.instanceId;
            targetDefId = hit.definitionId;
            break outer;
          }
        }
      }
    }

    if (ownerIndex < 0 || !hostCharId || !targetInstanceId || !targetDefId) {
      return { error: `discard-named-card-from-company: no "${cardName}" at ${ctx.charName}'s site` };
    }

    const ownerPlayer = newPlayers[ownerIndex];
    const hostChar = ownerPlayer.characters[hostCharId as string];
    const updatedItems = hostChar.items.filter(i => i.instanceId !== targetInstanceId);
    const discardedCard: CardInstance = { instanceId: targetInstanceId, definitionId: targetDefId };
    logDetail(`Grant-action ${ctx.action.actionId}: discarding ${cardName} from ${state.cardPool[hostChar.definitionId as string]?.name ?? '?'} (owner: player ${ownerIndex})`);

    newPlayers[ownerIndex] = {
      ...ownerPlayer,
      characters: {
        ...ownerPlayer.characters,
        [hostCharId as string]: { ...hostChar, items: updatedItems },
      },
      discardPile: [...ownerPlayer.discardPile, discardedCard],
    };
    const updatedChar = ownerIndex === ctx.playerIndex && hostCharId === ctx.action.characterId
      ? { ...char, items: updatedItems }
      : char;
    return { updatedChar, effects: [], stateOps: [] };
  }

  if (apply.type === 'move-target-from-discard-to-hand') {
    const targetCardId = ctx.action.targetCardId;
    if (!targetCardId) {
      return { error: `move-target-from-discard-to-hand: action has no targetCardId on ${ctx.sourceName}` };
    }
    const bearerPlayer = newPlayers[ctx.playerIndex];
    const idx = bearerPlayer.discardPile.findIndex(c => c.instanceId === targetCardId);
    if (idx < 0) {
      return { error: `move-target-from-discard-to-hand: ${targetCardId as string} not in discard pile` };
    }
    const card = bearerPlayer.discardPile[idx];
    const cardDef = state.cardPool[card.definitionId as string];
    logDetail(`Grant-action ${ctx.action.actionId}: moving ${cardDef?.name ?? '?'} from discard → hand`);
    newPlayers[ctx.playerIndex] = {
      ...bearerPlayer,
      hand: [...bearerPlayer.hand, card],
      discardPile: [...bearerPlayer.discardPile.slice(0, idx), ...bearerPlayer.discardPile.slice(idx + 1)],
    };
    return { updatedChar: char, effects: [], stateOps: [] };
  }

  if (apply.type === 'enqueue-pending-fetch') {
    const fromSources = apply.fetchFrom ?? ['discard-pile'];
    const count = apply.fetchCount ?? 1;
    const shuffle = apply.fetchShuffle ?? true;
    const filter = apply.filter ?? {};
    const characterId = ctx.action.characterId;
    const sourceId = ctx.action.sourceCardId;
    logDetail(`Grant-action ${ctx.action.actionId}: enqueueing fetch-to-deck from [${fromSources.join(', ')}] (count=${count}, shuffle=${shuffle}, postCorruptionCheck=${!!apply.postCorruptionCheck})`);
    return {
      updatedChar: char,
      effects: [],
      stateOps: [
        s => ({
          ...s,
          pendingEffects: [
            ...s.pendingEffects,
            {
              type: 'card-effect' as const,
              cardInstanceId: sourceId,
              effect: {
                type: 'fetch-to-deck' as const,
                source: fromSources,
                filter,
                count,
                shuffle,
              },
              skipDiscard: true,
              ...(apply.postCorruptionCheck
                ? { postCorruptionCheck: { characterId, modifier: 0 } }
                : {}),
            },
          ],
        }),
      ],
    };
  }

  if (apply.type === 'roll-then-apply') {
    if (apply.threshold === undefined) {
      return { error: `roll-then-apply missing threshold on ${ctx.sourceName}` };
    }
    const { roll, rng, cheatRollTotal } = roll2d6({ ...state, rng: rngRef.rng, cheatRollTotal: rngRef.cheatRollTotal });
    rngRef.rng = rng;
    rngRef.cheatRollTotal = cheatRollTotal;
    // METD §7 / rule 10.08: the no-tap variant of corruption removal
    // applies a -3 modifier to the roll. Standard variant is unmodified.
    const noTap = (ctx.action as { noTap?: true }).noTap === true;
    const modifier = noTap ? -3 : 0;
    const total = roll.die1 + roll.die2 + modifier;
    const modText = modifier !== 0 ? ` ${modifier >= 0 ? '+' : ''}${modifier}` : '';
    logDetail(`Grant-action ${ctx.action.actionId}: ${ctx.charName} rolls ${roll.die1} + ${roll.die2}${modText} = ${total} vs threshold ${apply.threshold}${noTap ? ' (no-tap variant)' : ''}`);

    const playerName = newPlayers[ctx.playerIndex].name;
    const rollEffect: GameEffect = {
      effect: 'dice-roll',
      playerName,
      die1: roll.die1,
      die2: roll.die2,
      label: `${ctx.sourceName}: ${ctx.charName}${noTap ? ' (no-tap)' : ''}`,
    };
    newPlayers[ctx.playerIndex] = { ...newPlayers[ctx.playerIndex], lastDiceRoll: roll };

    const branch = total >= apply.threshold ? apply.onSuccess : apply.onFailure;
    const stateOpsExtra: ((s: GameState) => GameState)[] = [];
    if (noTap) {
      // Lock further attempts on this character+corruption-card pair
      // for the rest of the turn, regardless of roll outcome.
      const charId = ctx.action.characterId;
      const corruptionId = ctx.action.sourceCardId;
      const sourceDefId = ctx.sourceCardDefinitionId;
      stateOpsExtra.push((s: GameState) => addConstraint(s, {
        source: corruptionId,
        sourceDefinitionId: sourceDefId,
        scope: { kind: 'turn' },
        target: { kind: 'character', characterId: charId },
        kind: { type: 'corruption-removal-locked', characterId: charId, corruptionInstanceId: corruptionId },
      }));
    }
    if (!branch) {
      logDetail(`Grant-action ${ctx.action.actionId}: roll ${total >= apply.threshold ? 'succeeded' : 'failed'} — no branch, nothing to apply`);
      return { updatedChar: char, effects: [rollEffect], stateOps: stateOpsExtra };
    }
    const inner = runGrantApply(state, branch, char, newPlayers, ctx, rngRef);
    if ('error' in inner) return inner;
    return { updatedChar: inner.updatedChar, effects: [rollEffect, ...inner.effects], stateOps: [...stateOpsExtra, ...inner.stateOps] };
  }

  return { error: `Unsupported grant-action apply ${JSON.stringify(apply)} on ${ctx.sourceName}` };
}

/**
 * Build an ActiveConstraint.kind for constraint names that carry no
 * payload. Returns null for kinds that need additional fields (those go
 * through the on-event path which knows how to read them from state).
 */
function constraintKindWithoutPayload(
  name: string,
): import('../types/pending.js').ActiveConstraint['kind'] | null {
  switch (name) {
    case 'cancel-return-and-site-tap':
      return { type: 'cancel-return-and-site-tap' };
    case 'cancel-character-discard':
      return { type: 'cancel-character-discard' };
    case 'deny-scout-resources':
      return { type: 'deny-scout-resources' };
    case 'no-creature-hazards-on-company':
      return { type: 'no-creature-hazards-on-company' };
    case 'auto-attack-duplicate':
      return { type: 'auto-attack-duplicate' };
    default:
      return null;
  }
}

/**
 * Build an ActiveConstraint.kind for constraint names whose payload is
 * read directly off the grant-action `apply` clause. Returns null for
 * kinds not handled here (fall back to {@link constraintKindWithoutPayload}).
 */
function buildPayloadConstraintKind(
  name: string,
  apply: import('../types/effects.js').TriggeredAction,
): import('../types/pending.js').ActiveConstraint['kind'] | null {
  if (name === 'company-stat-modifier') {
    if (apply.stat !== 'prowess' && apply.stat !== 'body') return null;
    if (typeof apply.value !== 'number') return null;
    return { type: 'company-stat-modifier', stat: apply.stat, value: apply.value };
  }
  return null;
}

/** Map a DSL scope string to a ConstraintScope. */
function parseConstraintScope(
  scopeName: string | undefined,
  player: import('../types/state.js').PlayerState,
  characterId: CardInstanceId,
): import('../types/pending.js').ConstraintScope | null {
  switch (scopeName) {
    case 'turn':
      return { kind: 'turn' };
    case 'until-cleared':
      return { kind: 'until-cleared' };
    case 'company-site-phase':
    case 'company-mh-phase': {
      const company = player.companies.find(c => c.characters.includes(characterId));
      if (!company) return null;
      return { kind: scopeName, companyId: company.id };
    }
    default:
      return null;
  }
}

/** Resolve a DSL target selector to a ConstraintTarget. */
function resolveConstraintTarget(
  targetName: string | undefined,
  player: import('../types/state.js').PlayerState,
  characterId: CardInstanceId,
  playerId: import('../types/common.js').PlayerId,
): import('../types/pending.js').ActiveConstraint['target'] | null {
  switch (targetName ?? 'bearer-company') {
    case 'bearer-company': {
      const company = player.companies.find(c => c.characters.includes(characterId));
      if (!company) return null;
      return { kind: 'company', companyId: company.id };
    }
    case 'player':
      return { kind: 'player', playerId };
    default:
      return null;
  }
}

/**
 * Generic handler for grant-action effects that declare an `apply`.
 * Pays the effect's cost (discard source attachment or tap the bearer)
 * then dispatches on `apply.type` to mutate state. Shared across all
 * phase reducers so a granted action behaves identically in
 * organization, M/H, site, and long-event windows without per-actionId
 * branches.
 *
 * Supported costs:
 *  - `cost.discard === 'self'` — detach the source card (item, ally,
 *    or hazard) from the bearer and move it to the correct discard.
 *  - `cost.tap === 'bearer'` — tap the bearer (no detach).
 *
 * Supported applies (each extends the primitive as cards demand it):
 *  - `set-character-status` with `target: 'bearer'` — set bearer status.
 *  - `discard-self` — detach the source from the bearer and discard it.
 *  - `roll-then-apply` with `threshold`, `onSuccess`, `onFailure` —
 *    roll 2d6; run the matching branch (recursive apply).
 */
export function handleGrantActionApply(state: GameState, action: GameAction): ReducerResult {
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

  // Grant-actions can originate from either:
  //  - a `grant-action` effect declared on the source card (static),
  //  - a `granted-action` active constraint whose source is the source
  //    card (dynamic, added via on-event / sequence apply).
  // Check the static path first; if that doesn't yield a matching
  // action, fall through to an active constraint lookup.
  const effects = sourceDef && 'effects' in sourceDef
    ? (sourceDef as { effects?: readonly import('../types/effects.js').CardEffect[] }).effects
    : undefined;
  const staticEffect = effects?.find(
    (e): e is import('../types/effects.js').GrantActionEffect =>
      e.type === 'grant-action' && e.action === action.actionId,
  );
  const constraintGrant = staticEffect ? null : state.activeConstraints.find(c =>
    c.source === action.sourceCardId
    && c.kind.type === 'granted-action'
    && c.kind.action === action.actionId,
  );
  const constraintKind = constraintGrant?.kind.type === 'granted-action' ? constraintGrant.kind : null;

  interface ResolvedGrant {
    readonly cost: import('../types/effects.js').ActionCost;
    readonly apply: import('../types/effects.js').TriggeredAction;
  }
  const resolved: ResolvedGrant | null = staticEffect?.apply
    ? { cost: staticEffect.cost, apply: staticEffect.apply }
    : constraintKind
      ? { cost: constraintKind.cost, apply: constraintKind.apply }
      : null;

  if (!resolved) {
    return { state, error: `grant-action ${action.actionId} has no apply on ${sourceName}` };
  }

  // --- Pay cost ---
  const newPlayers = clonePlayers(state);
  let updatedChar: CharacterInPlay = char;

  // METD §7 / rule 10.08: the no-tap variant of corruption removal
  // skips paying the bearer-tap cost (and instead suffers -3 to the
  // roll plus a per-turn lock — both handled in the apply branch).
  const noTap = (action as { noTap?: true }).noTap === true;

  if (resolved.cost.discard === 'self') {
    const detached = detachAndDiscardSource(char, action.sourceCardId, action.sourceCardDefinitionId, playerIndex, newPlayers);
    if ('error' in detached) {
      return { state, error: `${sourceName}: ${detached.error}` };
    }
    updatedChar = detached.updatedChar;
    logDetail(`Grant-action ${action.actionId}: ${charName} discards ${sourceName}`);
  } else if (noTap && (resolved.cost.tap === 'bearer' || resolved.cost.tap === 'character')) {
    logDetail(`Grant-action ${action.actionId}: ${charName} skips tap-cost (no-tap variant, source: ${sourceName})`);
  } else if (resolved.cost.tap === 'bearer' || resolved.cost.tap === 'character') {
    updatedChar = { ...updatedChar, status: CardStatus.Tapped };
    logDetail(`Grant-action ${action.actionId}: ${charName} taps (source: ${sourceName})`);
  } else if (resolved.cost.tap === 'self') {
    // `self` is the source card. When the source IS the bearer
    // character (grant-action declared directly on a character card,
    // e.g. Gandalf / Saruman), tap the character. When the source is
    // attached (item / ally / hazard), tap the attachment in place.
    if (action.sourceCardId === action.characterId) {
      updatedChar = { ...updatedChar, status: CardStatus.Tapped };
      logDetail(`Grant-action ${action.actionId}: ${charName} taps`);
    } else {
      const loc = locateSourceOnCharacter(updatedChar, action.sourceCardId, playerIndex);
      if (!loc) {
        return { state, error: `${sourceName} not attached to ${charName}` };
      }
      const tapAttachment = <T extends { readonly instanceId: CardInstanceId; readonly status: CardStatus }>(
        list: readonly T[],
      ): readonly T[] => list.map(a => a.instanceId === action.sourceCardId ? { ...a, status: CardStatus.Tapped } : a);
      updatedChar = loc.slot === 'items'
        ? { ...updatedChar, items: tapAttachment(updatedChar.items) }
        : loc.slot === 'allies'
          ? { ...updatedChar, allies: tapAttachment(updatedChar.allies) }
          : { ...updatedChar, hazards: tapAttachment(updatedChar.hazards) };
      logDetail(`Grant-action ${action.actionId}: ${charName} taps ${sourceName}`);
    }
  } else {
    return { state, error: `Unsupported grant-action cost ${JSON.stringify(resolved.cost)} on ${sourceName}` };
  }

  // --- Apply effect ---
  const ctx: GrantApplyContext = {
    action,
    playerIndex,
    charName,
    sourceName,
    sourceCardDefinitionId: action.sourceCardDefinitionId,
  };
  const rngRef = { rng: state.rng, cheatRollTotal: state.cheatRollTotal };
  const result = runGrantApply(state, resolved.apply, updatedChar, newPlayers, ctx, rngRef);
  if ('error' in result) {
    return { state, error: result.error };
  }
  updatedChar = result.updatedChar;

  newPlayers[playerIndex] = {
    ...newPlayers[playerIndex],
    characters: {
      ...newPlayers[playerIndex].characters,
      [action.characterId as string]: updatedChar,
    },
  };

  let finalState: GameState = recomputeDerived({
    ...state,
    players: newPlayers,
    rng: rngRef.rng,
    cheatRollTotal: rngRef.cheatRollTotal,
  });
  for (const op of result.stateOps) {
    finalState = op(finalState);
  }

  return {
    state: finalState,
    effects: result.effects.length > 0 ? result.effects : undefined,
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
  if (action.type !== 'split-company') return wrongActionType(state, action, 'split-company');

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

  // Rule 3.31: When a company splits at a haven, the player may place an
  // additional untapped copy of the haven with the new company. Do this
  // automatically whenever a duplicate copy is available in the site deck.
  let newSiteDeck = player.siteDeck;
  let newCompanySite: SiteInPlay | null = sourceCompany.currentSite;
  let newCompanySiteCardOwned = false;
  if (sourceCompany.currentSite) {
    const siteDef = state.cardPool[sourceCompany.currentSite.definitionId as string];
    if (siteDef && isSiteCard(siteDef) && siteDef.siteType === SiteType.Haven) {
      const duplicate = player.siteDeck.find(
        c => c.definitionId === sourceCompany.currentSite!.definitionId,
      );
      if (duplicate) {
        logDetail(`  Split at haven ${siteDef.name}: taking additional untapped copy from site deck for new company`);
        newSiteDeck = removeById(player.siteDeck, duplicate.instanceId);
        newCompanySite = { ...toCardInstance(duplicate), status: CardStatus.Untapped };
        newCompanySiteCardOwned = true;
      }
    }
  }

  const newCompany: Company = {
    id: nextCompanyId(player),
    characters: allMovingIds,
    currentSite: newCompanySite,
    siteCardOwned: newCompanySiteCardOwned,
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

  // Reverse: merge the new company back into the source
  const reverseAction: GameAction = {
    type: 'merge-companies',
    player: action.player,
    sourceCompanyId: newCompany.id,
    targetCompanyId: action.sourceCompanyId,
  };

  return {
    state: {
      ...updatePlayer(state, playerIndex, p => ({ ...p, companies, siteDeck: newSiteDeck })),
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
  if (action.type !== 'move-to-company') return wrongActionType(state, action, 'move-to-company');

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

  // Reverse: move the character back to the source company
  const reverseAction: GameAction = {
    type: 'move-to-company',
    player: action.player,
    characterInstanceId: charInstId,
    sourceCompanyId: action.targetCompanyId,
    targetCompanyId: action.sourceCompanyId,
  };

  return {
    state: sweepAutoDiscardHazards({
      ...updatePlayer(state, playerIndex, p => ({ ...p, companies: filteredCompanies })),
      reverseActions: [...state.reverseActions, reverseAction],
    }),
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
  if (action.type !== 'merge-companies') return wrongActionType(state, action, 'merge-companies');

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
    state: sweepAutoDiscardHazards({
      ...updatePlayer(state, playerIndex, p => ({ ...p, companies })),
      reverseActions: [...state.reverseActions, ...reverses],
    }),
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
  if (action.type !== 'plan-movement') return wrongActionType(state, action, 'plan-movement');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const companyIdx = player.companies.findIndex(c => c.id === action.companyId);
  if (companyIdx === -1) return { state, error: 'Company not found' };

  const company = player.companies[companyIdx];
  if (company.destinationSite) return { state, error: 'Company already has planned movement' };

  const deckCard = player.siteDeck.find(c => c.instanceId === action.destinationSite);
  // Rules 3.37 / 3.39: the destination may be another of this player's
  // companies' currentSite or pending destinationSite. In that case the
  // site is not drawn from the site deck.
  const sharedWith = deckCard
    ? null
    : player.companies.find(
        c => c.id !== action.companyId
          && (c.currentSite?.instanceId === action.destinationSite
            || c.destinationSite?.instanceId === action.destinationSite),
      );
  const sharedSite = sharedWith
    ? (sharedWith.currentSite?.instanceId === action.destinationSite
      ? sharedWith.currentSite
      : sharedWith.destinationSite)
    : null;

  if (!deckCard && !sharedSite) {
    return { state, error: 'Destination site not in site deck and not in play' };
  }

  // Rule 2.II.7.1: no two companies sharing an origin may target the same
  // new site in the same organization phase.
  if (company.currentSite) {
    const rule_7_1_violation = player.companies.find(
      c => c.id !== action.companyId
        && c.currentSite?.instanceId === company.currentSite!.instanceId
        && c.destinationSite?.instanceId === action.destinationSite,
    );
    if (rule_7_1_violation) {
      logDetail(`Plan movement rejected: rule 2.II.7.1 — company ${rule_7_1_violation.id as string} at the same origin already targets ${action.destinationSite as string}`);
      return { state, error: 'Rule 2.II.7.1: another company from the same origin already targets this site' };
    }
  }

  const companies = [...player.companies];
  let siteDeck = player.siteDeck;
  if (deckCard) {
    logDetail(`Plan movement: company ${company.id as string} → ${action.destinationSite as string} (from site deck)`);
    companies[companyIdx] = {
      ...company,
      destinationSite: { ...toCardInstance(deckCard), status: CardStatus.Untapped },
      movementPath: [],
    };
    // Remove destination site from site deck
    siteDeck = removeById(player.siteDeck, action.destinationSite);
  } else {
    logDetail(`Plan movement: company ${company.id as string} → ${action.destinationSite as string} (already in play at sibling ${sharedWith!.id as string} — not drawing from site deck)`);
    companies[companyIdx] = {
      ...company,
      destinationSite: {
        instanceId: sharedSite!.instanceId,
        definitionId: sharedSite!.definitionId,
        status: CardStatus.Untapped,
      },
      movementPath: [],
    };
  }

  // Reverse: cancel the movement we just planned
  const reverseAction: GameAction = {
    type: 'cancel-movement',
    player: action.player,
    companyId: action.companyId,
  };

  return { state: { ...updatePlayer(state, playerIndex, p => ({ ...p, companies, siteDeck })), reverseActions: [...state.reverseActions, reverseAction] } };
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
  if (action.type !== 'cancel-movement') return wrongActionType(state, action, 'cancel-movement');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const companyIdx = player.companies.findIndex(c => c.id === action.companyId);
  if (companyIdx === -1) return { state, error: 'Company not found' };

  const company = player.companies[companyIdx];
  if (!company.destinationSite) return { state, error: 'Company has no planned movement' };

  // Rules 3.37 / 3.39: if the destination is still in play at another
  // sibling company (as its currentSite or as its pending destinationSite),
  // the card instance must stay in play — don't push it back to the site
  // deck. Note this cancels only the sibling relationship for *this*
  // company; the physical card was drawn exactly once, by whichever
  // company actually took it from the deck.
  const siblingStillHasIt = player.companies.some(
    c => c.id !== company.id
      && (c.currentSite?.instanceId === company.destinationSite!.instanceId
        || c.destinationSite?.instanceId === company.destinationSite!.instanceId),
  );

  const companies = [...player.companies];
  companies[companyIdx] = {
    ...company,
    destinationSite: null,
    movementPath: [],
  };

  let siteDeck = player.siteDeck;
  if (siblingStillHasIt) {
    logDetail(`Cancel movement: company ${company.id as string}, destination ${company.destinationSite.instanceId as string} still in play at a sibling — not returning to site deck`);
  } else {
    logDetail(`Cancel movement: company ${company.id as string}, returning site ${company.destinationSite.instanceId as string} to site deck`);
    siteDeck = [...player.siteDeck, toCardInstance(company.destinationSite)];
  }

  // Reverse: re-plan movement to the destination we just cancelled
  const reverseAction: GameAction = {
    type: 'plan-movement',
    player: action.player,
    companyId: action.companyId,
    destinationSite: company.destinationSite.instanceId,
  };

  return { state: { ...updatePlayer(state, playerIndex, p => ({ ...p, companies, siteDeck })), reverseActions: [...state.reverseActions, reverseAction] } };
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

