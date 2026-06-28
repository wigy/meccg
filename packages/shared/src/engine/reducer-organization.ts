/**
 * @module reducer-organization
 *
 * Organization phase handlers for the game reducer. Covers playing characters,
 * moving characters between companies, transferring items, corruption checks,
 * planning movement, and sideboard access.
 */

import type { GameState, CardInstanceId, CharacterInPlay, CardInstance, OrganizationPhaseState, Company, SiteInPlay, GameAction, GameEffect, FetchWizardOnStoreEffect, PlayerState } from '../index.js';
import type { PlayFlagEffect } from '../types/effects.js';
import { formatSignedNumber } from '../format-helpers.js';
import { shuffle } from '../rng.js';
import { getPlayerIndex, requirePhaseState } from '../state-utils.js';
import { isSiteCard, isResourceEventCard, isCharacterCard, isAvatarCharacter } from '../types/cards.js';
import { CardStatus, SiteType } from '../types/common.js';
import { ZERO_EFFECTIVE_STATS } from '../types/state-cards.js';
import { Phase } from '../types/state-phases.js';
import { logDetail } from './legal-actions/log.js';
import { resolveInstanceId, ownerOf } from '../types/state.js';
import type { ReducerResult } from './reducer-utils.js';
import { roll2d6, diceRollEffect, clonePlayers, nextCompanyId, handleFetchFromPile, sweepAutoDiscardHazards, sweepAutoDiscardResourceEvents, sweepCompanyMembershipChangedEvents, sweepLeaderLeavesCompanyEvents, removeAttachment, removeById, stagePointsOfCard, toCardInstance, updatePlayer, updateCharacter, wrongActionType, findCharacterCompany, findById, playerById, getCardEffects, companyById, defById } from './reducer-utils.js';
import { handlePlayPermanentEvent, handlePlayShortEvent, handlePlayResourceShortEvent } from './reducer-events.js';
import { enqueueResolution, enqueueCorruptionCheck, addConstraint, removeConstraint } from './pending.js';
import { recomputeDerived } from './recompute-derived.js';
import { collectCharacterEffects, resolveCheckModifier, resolveDef, getItemGrantedSkills } from './effects/index.js';
import { directInfluenceControlAllowed } from './control-cost.js';
import { applyMove as applyMoveLocal } from './reducer-move.js';
import { applyCost } from './cost-evaluator.js';


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
  'test-ring-at-site': handleTestRingAtSite,
  'discard-stage-resource': handleDiscardStageResource,
  'activate-org-fetch': handleActivateOrgFetch,
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
  const orgState = requirePhaseState(state, Phase.Organization);
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
    const def = defById(state, card.definitionId);
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
 * Discard one of a Fallen-wizard's in-play stage resource permanent-events
 * during the organization phase (MEWH "The Player Turn"). Rejected if it would
 * drop the stage-point total below 3, or if the target is not the player's own
 * in-play stage permanent-event. The card moves to the owner's discard pile;
 * `recomputeDerived` re-derives the stage total.
 */
function handleDiscardStageResource(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'discard-stage-resource') return wrongActionType(state, action, 'discard-stage-resource');
  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  if (player.alignment !== 'fallen-wizard') {
    return { state, error: 'Only a Fallen-wizard may discard a stage resource' };
  }
  const card = player.cardsInPlay.find(c => c.instanceId === action.cardInstanceId);
  if (!card) return { state, error: 'Stage resource not found in play' };
  const def = defById(state, card.definitionId);
  if (!isResourceEventCard(def) || (def as { alignment?: string }).alignment !== 'stage' || def.eventType !== 'permanent') {
    return { state, error: 'Target is not a stage resource permanent-event' };
  }
  const contribution = stagePointsOfCard(def);
  if (player.stagePoints - contribution < 3) {
    return { state, error: 'Discarding this stage resource would drop stage points below 3' };
  }

  logDetail(`Organization: ${player.name} discards stage resource ${def.name} (stage points ${player.stagePoints} → ${player.stagePoints - contribution})`);
  const next = updatePlayer(state, playerIndex, p => ({
    ...p,
    cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== action.cardInstanceId),
    discardPile: [...p.discardPile, toCardInstance(card)],
  }));
  return { state: recomputeDerived(next) };
}

/**
 * Activates the optional once-per-organization-phase fetch granted by an in-play
 * permanent-event carrying an `org-phase-fetch` effect (A Strident Spawn wh-61).
 * Enqueues the shared `fetch-to-deck` pending effect (`to: 'hand'`, which then
 * drives the pick-one-or-pass sub-flow) and records the source as spent for this
 * turn so it cannot be re-activated.
 */
function handleActivateOrgFetch(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'activate-org-fetch') return wrongActionType(state, action, 'activate-org-fetch');
  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const card = player.cardsInPlay.find(c => c.instanceId === action.cardInstanceId);
  if (!card) return { state, error: 'Org-phase-fetch source not found in play' };
  const def = defById(state, card.definitionId);
  const fetchEffect = def ? getCardEffects(def).find(e => e.type === 'org-phase-fetch') : undefined;
  if (!fetchEffect || fetchEffect.type !== 'org-phase-fetch') {
    return { state, error: 'Target does not grant an organization-phase fetch' };
  }
  const orgState = requirePhaseState(state, Phase.Organization);
  const used = orgState.discardFetchUsedThisTurn ?? [];
  if (used.includes(action.cardInstanceId)) {
    return { state, error: 'This fetch has already been used this turn' };
  }

  logDetail(`Organization: ${player.name} activates ${def?.name ?? '?'} org-phase fetch (take one matching card from [${fetchEffect.from.join(', ')}] to hand)`);
  const next: GameState = {
    ...state,
    phaseState: { ...orgState, discardFetchUsedThisTurn: [...used, action.cardInstanceId] },
    pendingEffects: [
      ...state.pendingEffects,
      {
        type: 'card-effect' as const,
        cardInstanceId: action.cardInstanceId,
        effect: {
          type: 'fetch-to-deck' as const,
          source: [...fetchEffect.from],
          filter: fetchEffect.filter,
          count: 1,
          shuffle: false,
          to: 'hand' as const,
        },
        skipDiscard: true,
      },
    ],
  };
  return { state: next };
}

/**
 * Dispatch a play-short-event action during organization. Hazard short
 * events go through the hazard flow; resource short events resolve their
 * DSL effects.
 *
 * Playing an "end of the organization phase" card (e.g. Stealth) does NOT
 * end the organization phase or foreclose any further normal organization
 * actions. Per CoE 2.II.7 the resource player may declare movement (and
 * otherwise organize) "either before or after organizing" at any point
 * during the organization phase; no rule states that an end-of-org play
 * terminates those actions. The active player stays in the normal
 * play-actions window and advances to the Long-event phase only by passing.
 */
function handleOrganizationPlayShortEvent(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'play-short-event') return wrongActionType(state, action, 'play-short-event');
  if (action.cardInstanceId) {
    const player = playerById(state, action.player);
    const card = player?.hand.find(c => c.instanceId === action.cardInstanceId);
    const def = card ? defById(state, card.definitionId) : undefined;
    if (isResourceEventCard(def)) {
      return handlePlayResourceShortEvent(state, action);
    }
  }
  return handlePlayShortEvent(state, action);
}

/**
 * Handle the play-character action during organization.
 *
 * Removes the character from hand, creates a CharacterInPlay entry,
 * adds it to an existing company at the target site or creates a new
 * company (taking the site card from the site deck if needed).
 */
export function handlePlayCharacter(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'play-character') return wrongActionType(state, action, 'play-character');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  // The one-character-per-turn bookkeeping lives on the organization phase
  // state. A recruit brought in via a `recruit-character` event (A Chance
  // Meeting, tw-188) may be played in other phases and never consumes that
  // slot, so the phase-state update is guarded on actually being in the
  // organization phase below.
  const isOrgPhase = state.phaseState.phase === Phase.Organization;
  // handlePlayCharacter is shared: A Chance Meeting (tw-188) etc. recruit during
  // the M/H and site phases too, so phaseState is genuinely not always the
  // organization phase here — the org-only fields below are read under the
  // `isOrgPhase` guard. Keep the cast (do not use requirePhaseState here).
  const phaseState = state.phaseState as OrganizationPhaseState;

  const charInstId = action.characterInstanceId;
  const handCard = findById(player.hand, charInstId)!;
  const charDef = state.cardPool[handCard.definitionId as string] as import('../types/cards.js').CharacterCard;

  logDetail(`Play character: ${charDef.name} (mind ${charDef.mind ?? 'null'}) at site ${action.atSite as string}, controlledBy ${action.controlledBy as string}`);

  // Recruitment vehicle (Thrall of the Voice, wh-82): "place this card with the
  // character". When the play is made via a recruitment vehicle, move the
  // vehicle from hand and attach it to the recruit, so its "-1 to his mind"
  // stat-modifier resolves against the recruit during recomputeDerived.
  let recruitItems: readonly import('../types/state-cards.js').ItemInPlay[] = [];
  let handAfterVehicle = player.hand;
  if (action.viaRecruitmentInstanceId) {
    const vehicleCard = findById(player.hand, action.viaRecruitmentInstanceId);
    if (!vehicleCard) {
      return { state, error: 'Recruitment vehicle not in hand' };
    }
    recruitItems = [{ instanceId: vehicleCard.instanceId, definitionId: vehicleCard.definitionId, status: CardStatus.Untapped }];
    handAfterVehicle = removeById(player.hand, vehicleCard.instanceId);
    logDetail(`  Recruitment vehicle ${vehicleCard.definitionId as string} placed with ${charDef.name}`);
  }

  // Character-recruitment event (A Chance Meeting tw-188): the enabling short
  // event is played from hand and goes to the discard pile when the recruit
  // enters play.
  let eventToDiscard: CardInstance | undefined;
  if (action.viaEventInstanceId) {
    const eventCard = findById(handAfterVehicle, action.viaEventInstanceId);
    if (!eventCard) {
      return { state, error: 'Recruitment event not in hand' };
    }
    eventToDiscard = eventCard;
    handAfterVehicle = removeById(handAfterVehicle, eventCard.instanceId);
    logDetail(`  Recruitment event ${eventCard.definitionId as string} discarded as ${charDef.name} enters play`);
  }

  // Build the new CharacterInPlay
  const newChar: CharacterInPlay = {
    instanceId: charInstId,
    definitionId: handCard.definitionId,
    status: CardStatus.Untapped,
    items: recruitItems,
    allies: [],
    hazards: [],
    followers: [],
    controlledBy: action.controlledBy,
    effectiveStats: ZERO_EFFECTIVE_STATS,
  };

  // Remove character from hand
  const newHand = removeById(handAfterVehicle, charInstId);

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
    const siteCard = findById(player.siteDeck, siteInstId)!;
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

  const joinedCompany = findCharacterCompany(companies, charInstId);
  const affectedIds = joinedCompany ? [joinedCompany.id] : [];

  // MELE §8.R1: if the played character matches the Ringwraith that was returned
  // to hand, clear the restriction flag so the player may reveal another Ringwraith
  // and the opponent can reveal it again.
  const clearRingwraithFlag = player.ringwraithReturnedToHand === handCard.definitionId;

  // Buddy-play group tracking: when a character with the buddy-play flag is played,
  // record its definition ID and all companion IDs so its companions may also be
  // played this turn without consuming the one-character-per-turn slot.
  const buddyPlayEffect = (charDef.effects ?? []).find(
    (e): e is PlayFlagEffect => e.type === 'play-flag' && e.flag === 'buddy-play',
  );
  const newBuddyGroup: string[] = [...(phaseState.buddyGroupPlayedThisTurn ?? [])];
  if (buddyPlayEffect) {
    const charDefId = handCard.definitionId as string;
    if (!newBuddyGroup.includes(charDefId)) newBuddyGroup.push(charDefId);
    for (const companion of buddyPlayEffect.companions ?? []) {
      if (!newBuddyGroup.includes(companion)) newBuddyGroup.push(companion);
    }
    logDetail(`  Buddy-play group updated: [${newBuddyGroup.join(', ')}]`);
  }

  // A recruit brought in via a `recruit-character` event (A Chance Meeting,
  // tw-188) bypasses the one-character-per-turn limit and may be played outside
  // the organization phase: the organization-phase bookkeeping is only applied
  // for a normal organization-phase play.
  const bypassOneCharLimit = (() => {
    if (!eventToDiscard) return false;
    const eventDef = defById(state, eventToDiscard.definitionId);
    const effects = (eventDef as { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined)?.effects ?? [];
    return effects.some(e => e.type === 'recruit-character' && e.bypassOneCharacterLimit === true);
  })();
  const updateOrgState = isOrgPhase && !bypassOneCharLimit;

  return {
    state: sweepCompanyMembershipChangedEvents(sweepAutoDiscardResourceEvents(sweepAutoDiscardHazards({
      ...updatePlayer(state, playerIndex, p => ({
        ...p,
        hand: newHand,
        siteDeck: newSiteDeck,
        characters: newCharacters,
        companies,
        ...(eventToDiscard ? { discardPile: [...p.discardPile, eventToDiscard] } : {}),
        ...(clearRingwraithFlag ? { ringwraithReturnedToHand: undefined } : {}),
      })),
      phaseState: updateOrgState
        ? {
            ...phaseState,
            characterPlayedThisTurn: true,
            lastPlayedCharacterDefinitionId: handCard.definitionId as string,
            ...(newBuddyGroup.length > 0 ? { buddyGroupPlayedThisTurn: newBuddyGroup } : {}),
          }
        : state.phaseState,
    })), affectedIds),
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
  if (action.type !== 'move-to-influence') return wrongActionType(state, action, 'move-to-influence');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const charInstId = action.characterInstanceId;
  const char = player.characters[charInstId as string];
  if (!char) return { state, error: 'Character not found' };

  const charDef = resolveDef(state, charInstId);
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

    // Enforce any control-source restriction on the moved character (e.g.
    // Wizard's Myrmidon: "only by general influence or a Fallen-wizard").
    if (!directInfluenceControlAllowed(state, char, controller, player.alignment)) {
      return { state, error: 'Control-source restriction forbids this controller' };
    }

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
function handleTransferItem(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'transfer-item') return wrongActionType(state, action, 'transfer-item');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const fromCharId = action.fromCharacterId;
  const toCharId = action.toCharacterId;
  const itemInstId = action.itemInstanceId;

  if (!player.characters[fromCharId as string]) return { state, error: 'Source character not found' };
  if (!player.characters[toCharId as string]) return { state, error: 'Target character not found' };

  const removed = removeAttachment(player, 'items', itemInstId);
  if (!removed || removed.charId !== fromCharId) return { state, error: 'Item not found on source character' };
  const item = removed.attachment;
  const itemDef = resolveDef(state, itemInstId);
  const fromDef = resolveDef(state, fromCharId);
  const toDef = resolveDef(state, toCharId);
  logDetail(`Transfer item: ${itemDef?.name ?? '?'} from ${fromDef?.name ?? '?'} to ${toDef?.name ?? '?'}`);

  // Move the item
  const playerAfterTransfer = updateCharacter(removed.player, toCharId, c => ({ ...c, items: [...c.items, item] }));

  // Enqueue a corruption-check resolution for the character who gave away
  // the item. The unified pending system replaces the old per-phase
  // `pendingCorruptionCheck` field; the resolver in `pending-reducers.ts`
  // handles the failure case (including removing the transferred item from
  // its new bearer if the check fails).
  logDetail(`Enqueuing corruption check for ${fromDef?.name ?? '?'} after item transfer`);

  const stateAfterTransfer: GameState = {
    ...updatePlayer(state, playerIndex, () => playerAfterTransfer),
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
 * Moves an item from a character to the player's marshalling point pile. The
 * character must be at a site matching the item's storable-at effect.
 * Stored items continue to earn marshalling points (via the item's
 * `storable-at` effect); the initial bearer makes a corruption check.
 */
export function handleStoreItem(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'store-item') return wrongActionType(state, action, 'store-item');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const charId = action.characterId;
  const itemInstId = action.itemInstanceId;

  if (!player.characters[charId as string]) return { state, error: 'Character not found' };
  const removed = removeAttachment(player, 'items', itemInstId);
  if (!removed || removed.charId !== charId) return { state, error: 'Item not found on character' };
  const item = removed.attachment;
  const itemDef = defById(state, item.definitionId);
  const charDef = resolveDef(state, charId);
  logDetail(`Store item: ${itemDef?.name ?? '?'} from ${charDef?.name ?? '?'}`);

  const storedCard: CardInstance = {
    instanceId: item.instanceId,
    definitionId: item.definitionId,
  };

  logDetail(`Enqueuing corruption check for ${charDef?.name ?? '?'} after item storage`);

  const stateAfterStore: GameState = updatePlayer(state, playerIndex, () => ({
    ...removed.player,
    killPile: [...removed.player.killPile, storedCard],
  }));

  let stateAfterCheck = enqueueCorruptionCheck(stateAfterStore, {
    source: itemInstId,
    actor: action.player,
    scope: { kind: 'phase', phase: state.phaseState.phase },
    characterId: charId,
    reason: 'Store',
  });

  // Clear any bearer-cannot-untap constraints that reference the stored card.
  // Rescue Prisoners places this constraint on the bearer; storing removes it
  // so the bearer can untap normally at the next untap phase.
  const bearerConstraints = stateAfterCheck.activeConstraints.filter(
    c => c.kind.type === 'bearer-cannot-untap' && c.kind.cardInstanceId === itemInstId,
  );
  for (const c of bearerConstraints) {
    logDetail(`Store item: clearing bearer-cannot-untap constraint from "${itemDef?.name ?? '?'}" (${c.id as string})`);
    stateAfterCheck = removeConstraint(stateAfterCheck, c.id);
  }

  // Auto-test-gold-ring site-rule (Rule 9.22): storing a gold-ring item at a
  // Darkhaven (or any site declaring this rule) triggers an automatic ring
  // test with the site's roll modifier. Enqueued after the corruption check
  // so both resolve in order.
  const itemSubtype = itemDef && 'subtype' in itemDef ? itemDef.subtype : undefined;
  const autoTestMod = goldRingAutoTestModifier(state, player.companies, charId, itemSubtype);
  if (autoTestMod !== null) {
    const siteName = goldRingAutoTestSiteName(state, player.companies, charId) ?? '?';
    logDetail(`Auto-test gold ring ${itemDef?.name ?? '?'} at ${siteName} (modifier ${formatSignedNumber(autoTestMod)})`);
    return {
      state: enqueueResolution(stateAfterCheck, {
        source: itemInstId,
        actor: action.player,
        scope: { kind: 'phase', phase: Phase.Organization },
        kind: {
          type: 'gold-ring-test',
          goldRingInstanceId: itemInstId,
          rollModifier: autoTestMod,
          characterInstanceId: charId,
        },
      }),
    };
  }

  // fetch-wizard-on-store: The Windlord Found Me triggers a wizard-search
  // window when stored if the resource player's Wizard is not already in play.
  const fetchWizardEffect = (getCardEffects(itemDef) as FetchWizardOnStoreEffect[]).find(e => e.type === 'fetch-wizard-on-store');
  if (fetchWizardEffect) {
    const wizardInPlay = Object.values(stateAfterCheck.players[playerIndex].characters).some(ch => {
      const chDefId = resolveInstanceId(stateAfterCheck, ch.instanceId);
      const chDef = chDefId ? defById(stateAfterCheck, chDefId) : undefined;
      return chDef && isCharacterCard(chDef) && isAvatarCharacter(chDef);
    });
    if (!wizardInPlay) {
      const company = findCharacterCompany(player.companies, charId);
      const havenSiteInstanceId = company?.currentSite?.instanceId;
      if (company && havenSiteInstanceId) {
        logDetail(`The Windlord Found Me: Wizard not in play — opening wizard-search window at ${company.currentSite?.definitionId as string ?? '?'}`);
        return {
          state: enqueueResolution(stateAfterCheck, {
            source: itemInstId,
            actor: action.player,
            scope: { kind: 'phase', phase: Phase.Organization },
            kind: {
              type: 'wizard-search-on-store',
              havenSiteInstanceId,
              companyId: company.id,
            },
          }),
        };
      }
    } else {
      logDetail(`The Windlord Found Me: Wizard already in play — skipping wizard-search window`);
    }
  }

  return { state: stateAfterCheck };
}

/**
 * If the character carrying the item is in a company at a site whose
 * `auto-test-gold-ring` site-rule applies and the item is a gold ring,
 * return the rule's roll modifier. Returns null otherwise (no auto-test).
 */
export function goldRingAutoTestModifier(
  state: GameState,
  companies: readonly Company[],
  characterId: CardInstanceId,
  itemSubtype: string | undefined,
): number | null {
  if (itemSubtype !== 'gold-ring') return null;
  const company = findCharacterCompany(companies, characterId);
  if (!company?.currentSite) return null;
  const siteDefId = resolveInstanceId(state, company.currentSite.instanceId);
  if (!siteDefId) return null;
  const siteDef = defById(state, siteDefId);
  if (!siteDef || !isSiteCard(siteDef) || !siteDef.effects) return null;
  const rule = siteDef.effects.find(e => e.type === 'site-rule' && e.rule === 'auto-test-gold-ring');
  if (!rule || rule.type !== 'site-rule' || rule.rule !== 'auto-test-gold-ring') return null;
  return rule.rollModifier;
}

/** Same lookup as {@link goldRingAutoTestModifier} but returns the site's name. */
export function goldRingAutoTestSiteName(
  state: GameState,
  companies: readonly Company[],
  characterId: CardInstanceId,
): string | null {
  const company = findCharacterCompany(companies, characterId);
  if (!company?.currentSite) return null;
  const siteDefId = resolveInstanceId(state, company.currentSite.instanceId);
  if (!siteDefId) return null;
  const siteDef = defById(state, siteDefId);
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
  const orgState = requirePhaseState(state, Phase.Organization);
  const destination = action.type === 'start-sideboard-to-deck' ? 'deck' : 'discard';

  // Tap the avatar
  const avatarKey = action.characterInstanceId as string;
  const avatarChar = state.players[playerIndex].characters[avatarKey];
  if (avatarChar) {
    const charDef = defById(state, avatarChar.definitionId);
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
function handleFetchFromSideboard(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'fetch-from-sideboard') return wrongActionType(state, action, 'fetch-from-sideboard');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const orgState = requirePhaseState(state, Phase.Organization);

  if (orgState.sideboardFetchDestination === null) {
    return { state, error: 'No sideboard access sub-flow active' };
  }

  const cardIdx = player.sideboard.findIndex(c => c.instanceId === action.sideboardCardInstanceId);
  if (cardIdx === -1) return { state, error: 'Sideboard card not found' };
  const sideboardCard = player.sideboard[cardIdx];
  const def = defById(state, sideboardCard.definitionId)!;
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

/**
 * Handle `test-ring-at-site`: a sage taps to test a gold-ring item at a site
 * whose `sage-tap-ring-test` site-rule grants the ability (Mount Doom, le-393).
 *
 * Validates that the named sage is an untapped sage in a company at such a
 * site, that the target is a gold-ring item borne by a character in that same
 * company, taps the sage, and enqueues the shared `gold-ring-test` resolution
 * with the site's roll modifier. The resolution handles the 2d6 roll, discards
 * the ring, and offers a matching special ring — identical to every other
 * ring-test path.
 */
function handleTestRingAtSite(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'test-ring-at-site') return wrongActionType(state, action, 'test-ring-at-site');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const sage = player.characters[action.characterId as string];
  if (!sage) return { state, error: 'test-ring-at-site: sage not found' };
  if (sage.status !== CardStatus.Untapped) return { state, error: 'test-ring-at-site: sage is tapped' };

  const sageDef = defById(state, sage.definitionId);
  if (!sageDef || !isCharacterCard(sageDef)) return { state, error: 'test-ring-at-site: sage is not a character' };
  const skills = [...(sageDef.skills as readonly string[] ?? []), ...getItemGrantedSkills(state, sage)];
  if (!skills.includes('sage')) return { state, error: 'test-ring-at-site: character is not a sage' };

  const company = findCharacterCompany(player.companies, action.characterId);
  if (!company?.currentSite) return { state, error: 'test-ring-at-site: sage is not at a site' };
  const siteDefId = resolveInstanceId(state, company.currentSite.instanceId);
  const siteDef = siteDefId ? defById(state, siteDefId) : undefined;
  if (!siteDef || !isSiteCard(siteDef) || !siteDef.effects) {
    return { state, error: 'test-ring-at-site: current site has no effects' };
  }
  const rule = siteDef.effects.find(
    e => e.type === 'site-rule' && (e as { rule?: string }).rule === 'sage-tap-ring-test',
  );
  if (!rule) return { state, error: 'test-ring-at-site: site does not grant sage-tap-ring-test' };
  const rollModifier = (rule as { rollModifier: number }).rollModifier;

  // Locate the gold-ring item and its bearer within the same company.
  let bearerId: CardInstanceId | null = null;
  for (const charInstId of company.characters) {
    const char = player.characters[charInstId as string];
    if (!char) continue;
    const item = char.items.find(i => i.instanceId === action.targetCardId);
    if (!item) continue;
    const itemDef = defById(state, item.definitionId);
    if (!itemDef || !('subtype' in itemDef) || (itemDef as { subtype?: string }).subtype !== 'gold-ring') {
      return { state, error: 'test-ring-at-site: target item is not a gold ring' };
    }
    bearerId = charInstId;
    break;
  }
  if (bearerId === null) {
    return { state, error: 'test-ring-at-site: gold ring not borne in the sage\'s company' };
  }

  // Tap the sage (the cost), then enqueue the shared ring-test resolution.
  const tappedState = updatePlayer(state, playerIndex, p =>
    updateCharacter(p, action.characterId, c => ({ ...c, status: CardStatus.Tapped })));
  logDetail(`test-ring-at-site: ${sageDef.name} taps to test a gold ring at ${siteDef.name} (modifier ${formatSignedNumber(rollModifier)})`);
  return {
    state: enqueueResolution(tappedState, {
      source: action.targetCardId,
      actor: action.player,
      scope: { kind: 'phase', phase: state.phaseState.phase },
      kind: {
        type: 'gold-ring-test',
        goldRingInstanceId: action.targetCardId,
        rollModifier,
        characterInstanceId: bearerId,
      },
    }),
  };
}

// handleOrganizationCorruptionCheck moved to engine/pending-reducers.ts
// (`applyCorruptionCheckResolution`) as part of the unified pending
// system. See `specs/2026-04-08-pending-effects-plan.md`.

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
 * Move a fetched item instance from the player's discard pile, sideboard, or
 * hand onto a recipient character's `items`, untapped (The Forge-master wh-117
 * `place-item-on-character` apply). The item is searched across all three zones
 * by instance ID; the recipient is one of the activating player's characters.
 * No card instance is lost — the item simply changes zones.
 */
function placeFetchedItemOnCharacter(
  state: GameState,
  playerIndex: number,
  itemId: CardInstanceId,
  recipientId: CardInstanceId,
): GameState {
  const player = state.players[playerIndex];
  const zones: readonly (keyof Pick<PlayerState, 'hand' | 'discardPile' | 'sideboard'>)[] = ['hand', 'discardPile', 'sideboard'];
  let sourceZone: typeof zones[number] | null = null;
  let card: { instanceId: CardInstanceId; definitionId: import('../types/common.js').CardDefinitionId } | null = null;
  for (const zone of zones) {
    const hit = player[zone].find(c => c.instanceId === itemId);
    if (hit) { sourceZone = zone; card = { instanceId: hit.instanceId, definitionId: hit.definitionId }; break; }
  }
  if (!sourceZone || !card) {
    logDetail(`place-item-on-character: item ${itemId as string} not found in hand/discard/sideboard`);
    return state;
  }
  const recipientDef = resolveDef(state, recipientId);
  logDetail(`place-item-on-character: placing ${defById(state, card.definitionId)?.name ?? card.definitionId as string} from ${sourceZone} onto ${recipientDef && 'name' in recipientDef ? (recipientDef as { name: string }).name : recipientId as string} (untapped)`);
  const itemInPlay = { instanceId: card.instanceId, definitionId: card.definitionId, status: CardStatus.Untapped };
  const sZone = sourceZone;
  return updatePlayer(state, playerIndex, p => {
    const pile = (p[sZone] as readonly { instanceId: CardInstanceId }[]).filter(c => c.instanceId !== itemId);
    const withZoneRemoved: PlayerState = { ...p, [sZone]: pile };
    return updateCharacter(withZoneRemoved, recipientId, c => ({ ...c, items: [...c.items, itemInPlay] }));
  });
}

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
    const company = findCharacterCompany(bearerPlayer.companies, ctx.action.characterId);
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
    const targetDef = defById(state, targetChar.definitionId);
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

  // target-instance: apply a status change to any character in any company/player
  // by instance ID (used by untap-companion-at-site — target may be in a different company).
  if (apply.type === 'set-character-status' && apply.target === 'target-instance') {
    if (apply.status === undefined) {
      return { error: `set-character-status apply missing status on ${ctx.sourceName}` };
    }
    const targetCardId = ctx.action.targetCardId;
    if (!targetCardId) {
      return { error: `set-character-status target-instance: action has no targetCardId on ${ctx.sourceName}` };
    }
    const statusEnum = apply.status === 'untapped' ? CardStatus.Untapped
      : apply.status === 'tapped' ? CardStatus.Tapped
        : CardStatus.Inverted;
    // Find the target across all players
    for (let pi = 0; pi < newPlayers.length; pi++) {
      const p = newPlayers[pi];
      const targetChar = p.characters[targetCardId as string];
      if (!targetChar) continue;
      const targetDef = defById(state, targetChar.definitionId);
      const targetName = targetDef && 'name' in targetDef ? (targetDef as { name: string }).name : '?';
      logDetail(`Grant-action ${ctx.action.actionId}: ${targetName} (player ${p.id as string}) → status ${apply.status}`);
      newPlayers[pi] = {
        ...p,
        characters: {
          ...p.characters,
          [targetCardId as string]: { ...targetChar, status: statusEnum },
        },
      };
      const updatedChar2 = targetCardId === ctx.action.characterId
        ? { ...char, status: statusEnum }
        : char;
      return { updatedChar: updatedChar2, effects: [], stateOps: [] };
    }
    return { error: `set-character-status target-instance: target ${targetCardId as string} not found` };
  }

  if (apply.type === 'increment-company-extra-region-distance') {
    const amount = apply.amount ?? 1;
    const bearerPlayer = newPlayers[ctx.playerIndex];
    const company = findCharacterCompany(bearerPlayer.companies, ctx.action.characterId);
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
    const company = findCharacterCompany(bearerPlayer.companies, ctx.action.characterId);
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
    let kind = buildPayloadConstraintKind(constraintKind, apply)
      ?? constraintKindWithoutPayload(constraintKind);
    // Site-bound constraint kinds resolve their `siteDefinitionId` from the
    // bearer's company's current site (e.g. Blasting Fire wh-51, discarded
    // during the site phase to act on the site the company is facing).
    if (!kind && (constraintKind === 'skip-automatic-attacks' || constraintKind === 'influence-at-site-modifier')) {
      const bearerCompany = findCharacterCompany(newPlayers[ctx.playerIndex].companies, ctx.action.characterId);
      const siteDefId = bearerCompany?.currentSite?.definitionId;
      if (!siteDefId) {
        return { error: `add-constraint: ${constraintKind} requires the bearer's company to be at a site (${ctx.sourceName})` };
      }
      if (constraintKind === 'skip-automatic-attacks') {
        kind = { type: 'skip-automatic-attacks', siteDefinitionId: siteDefId };
      } else {
        const value = typeof apply.value === 'number' ? apply.value : 0;
        kind = { type: 'influence-at-site-modifier', siteDefinitionId: siteDefId, value };
      }
    }
    if (!kind) {
      return { error: `add-constraint: unsupported constraint kind "${constraintKind}" from grant-action (${ctx.sourceName})` };
    }
    const scope = parseConstraintScope(apply.scope, newPlayers[ctx.playerIndex], ctx.action.characterId);
    if (!scope) {
      return { error: `add-constraint: unknown or unresolved scope "${apply.scope ?? ''}" on ${ctx.sourceName}` };
    }
    const target = resolveConstraintTarget(apply.target, newPlayers[ctx.playerIndex], ctx.action.characterId, ctx.action.player, ctx.action);
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
    const company = findCharacterCompany(bearerPlayer.companies, ctx.action.characterId);
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
          const targetDef = defById(state, targetItem.definitionId);
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
      logDetail(`Grant-action ${ctx.action.actionId}: ${ctx.charName} rolls ${roll.die1} + ${roll.die2} = ${base}, modifier ${formatSignedNumber(modifier)} → ${total} (${checkName})`);
    } else {
      logDetail(`Grant-action ${ctx.action.actionId}: ${ctx.charName} rolls ${roll.die1} + ${roll.die2} = ${total} (${checkName})`);
    }

    const rollEffect = diceRollEffect(bearerPlayer.name, roll, label);
    newPlayers[ctx.playerIndex] = { ...newPlayers[ctx.playerIndex], lastDiceRoll: roll };
    return { updatedChar: char, effects: [rollEffect], stateOps: [] };
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
      const def = defById(state, e.card.definitionId);
      if (def && (def.cardType === 'hazard-creature' || def.cardType === 'hazard-event')) {
        entryIndex = i;
        break;
      }
    }
    if (entryIndex === -1) {
      return { error: `cancel-chain-entry: no unresolved hazard entry to cancel on ${ctx.sourceName}` };
    }
    const entry = chain.entries[entryIndex];
    const entryDef = entry.card ? defById(state, entry.card.definitionId) : null;
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
                discardPile: [...hazardPlayer.discardPile, toCardInstance(entry.card)],
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

  if (apply.type === 'move') {
    // Generic card-movement primitive. Phase 1 lands the wiring; no
    // card JSON uses `move` yet. Later phases migrate per-move effect
    // types (discard-self, fetch-to-deck, bounce-hazard-events, …)
    // onto this single branch. See
    // `specs/2026-04-23-card-move-primitive-plan.md`.
    if (!apply.select || !apply.from || !apply.to) {
      return { error: `move apply missing select/from/to on ${ctx.sourceName}` };
    }
    const moveEffect: import('../types/effects.js').MoveEffect = {
      type: 'move',
      select: apply.select as 'self' | 'target' | 'filter-all' | 'named',
      from: apply.from,
      to: apply.to,
      ...(apply.toOwner !== undefined ? { toOwner: apply.toOwner } : {}),
      ...(apply.filter !== undefined ? { filter: apply.filter } : {}),
      ...(apply.count !== undefined ? { count: apply.count } : {}),
      ...(apply.shuffleAfter !== undefined ? { shuffleAfter: apply.shuffleAfter } : {}),
      ...(apply.corruptionCheck !== undefined ? { corruptionCheck: apply.corruptionCheck } : {}),
      ...(apply.cardName !== undefined ? { cardName: apply.cardName } : {}),
    };
    const moveCtx: import('./reducer-move.js').MoveContext = {
      sourceCardId: ctx.action.sourceCardId,
      sourcePlayerIndex: ctx.playerIndex,
      ...(ctx.action.targetCardId ? { targetCardId: ctx.action.targetCardId } : {}),
      ...(ctx.action.characterId ? { targetCharacterId: ctx.action.characterId } : {}),
    };
    const fromLabel = Array.isArray(moveEffect.from)
      ? `[${moveEffect.from.join(',')}]`
      : String(moveEffect.from);
    logDetail(`Grant-action ${ctx.action.actionId}: move (select=${moveEffect.select}, from=${fromLabel}, to=${String(moveEffect.to)})`);
    return {
      updatedChar: char,
      effects: [],
      stateOps: [
        s => {
          const r = applyMoveLocal(s, moveEffect, moveCtx);
          if ('error' in r) {
            logDetail(`move apply failed: ${r.error}`);
            return s;
          }
          return r.state;
        },
      ],
    };
  }

  if (apply.type === 'enqueue-pending-fetch') {
    const fromSources = apply.fetchFrom ?? ['discard-pile'];
    const count = apply.fetchCount ?? 1;
    const shuffle = apply.fetchShuffle ?? true;
    const fetchTo = apply.fetchTo ?? 'deck';
    const filter = apply.filter ?? {};
    const characterId = ctx.action.characterId;
    const sourceId = ctx.action.sourceCardId;
    const ccModifier = apply.postCorruptionCheckModifier ?? 0;
    logDetail(`Grant-action ${ctx.action.actionId}: enqueueing fetch-to-${fetchTo} from [${fromSources.join(', ')}] (count=${count}, shuffle=${shuffle}, postCorruptionCheck=${!!apply.postCorruptionCheck}, ccModifier=${ccModifier})`);
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
                to: fetchTo,
              },
              skipDiscard: true,
              ...(apply.postCorruptionCheck
                ? { postCorruptionCheck: { characterId, modifier: ccModifier } }
                : {}),
            },
          ],
        }),
      ],
    };
  }

  if (apply.type === 'place-item-on-character') {
    // The Forge-master wh-117: the chosen item (ctx.action.targetCardId) is
    // moved from the player's discard pile / sideboard / hand onto the chosen
    // recipient (ctx.action.recipientCharacterId) at the bearer's site,
    // untapped. The bearer-tap cost was already paid; the recipient is not
    // tapped. Deferred to a stateOp so it runs on the post-cost state.
    const itemId = ctx.action.targetCardId;
    const recipientId = ctx.action.recipientCharacterId;
    if (!itemId || !recipientId) {
      return { error: `place-item-on-character: missing item or recipient on ${ctx.sourceName}` };
    }
    return {
      updatedChar: char,
      effects: [],
      stateOps: [s => placeFetchedItemOnCharacter(s, ctx.playerIndex, itemId, recipientId)],
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
    const modText = modifier !== 0 ? ` ${formatSignedNumber(modifier)}` : '';
    logDetail(`Grant-action ${ctx.action.actionId}: ${ctx.charName} rolls ${roll.die1} + ${roll.die2}${modText} = ${total} vs threshold ${apply.threshold}${noTap ? ' (no-tap variant)' : ''}`);

    const playerName = newPlayers[ctx.playerIndex].name;
    const rollEffect = diceRollEffect(playerName, roll, `${ctx.sourceName}: ${ctx.charName}${noTap ? ' (no-tap)' : ''}`);
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

  if (apply.type === 'untap-site') {
    const bearerPlayer = newPlayers[ctx.playerIndex];
    const company = findCharacterCompany(bearerPlayer.companies, ctx.action.characterId);
    if (!company) {
      return { error: `${ctx.charName} is not in any company` };
    }
    const siteInstance = company.currentSite;
    if (!siteInstance) {
      return { error: `${ctx.charName}'s company has no current site` };
    }
    const siteDef = defById(state, siteInstance.definitionId);
    const siteName = siteDef?.name ?? '?';
    logDetail(`Grant-action ${ctx.action.actionId}: untapping site ${siteName}`);
    newPlayers[ctx.playerIndex] = {
      ...bearerPlayer,
      companies: bearerPlayer.companies.map(c =>
        c.id === company.id
          ? { ...c, currentSite: { ...siteInstance, status: CardStatus.Untapped } }
          : c,
      ),
    };
    return { updatedChar: char, effects: [], stateOps: [] };
  }

  if (apply.type === 'transform-site') {
    // Vile Fumes (wh-54): discard the item to permanently transform the
    // bearer's current site. Two `until-cleared` constraints, both filtered
    // by the site's definition ID so they affect "all versions of the site":
    //   1. attribute-modifier on `site.type` → Ruins & Lairs.
    //   2. replace-automatic-attacks → the bespoke Gas attack.
    // The item itself has already been discarded by the `cost.discard` step.
    const bearerPlayer = newPlayers[ctx.playerIndex];
    const company = findCharacterCompany(bearerPlayer.companies, ctx.action.characterId);
    if (!company) {
      return { error: `${ctx.charName} is not in any company` };
    }
    const siteInstance = company.currentSite;
    if (!siteInstance) {
      return { error: `${ctx.charName}'s company has no current site` };
    }
    const overrideType = apply.overrideType;
    const attack = apply.attack;
    if (!overrideType || !attack) {
      return { error: `transform-site requires 'overrideType' and 'attack' on ${ctx.sourceName}` };
    }
    const siteDefId = siteInstance.definitionId;
    const companyId = company.id;
    const sourceId = ctx.action.sourceCardId;
    const sourceDefId = ctx.sourceCardDefinitionId;
    const siteName = defById(state, siteDefId)?.name ?? '?';
    logDetail(`Grant-action ${ctx.action.actionId}: transforming all versions of ${siteName} → ${overrideType}; automatic-attacks replaced with ${attack.creatureType} (${attack.strikes} strike, ${attack.prowess} prowess${attack.uncancelable ? ', uncancelable' : ''})`);
    return {
      updatedChar: char,
      effects: [],
      stateOps: [
        s => addConstraint(s, {
          source: sourceId,
          sourceDefinitionId: sourceDefId,
          scope: { kind: 'until-cleared' },
          target: { kind: 'company', companyId },
          kind: {
            type: 'attribute-modifier',
            attribute: 'site.type',
            op: 'override',
            value: overrideType,
            filter: { 'site.definitionId': siteDefId },
          },
        }),
        s => addConstraint(s, {
          source: sourceId,
          sourceDefinitionId: sourceDefId,
          scope: { kind: 'until-cleared' },
          target: { kind: 'company', companyId },
          kind: {
            type: 'replace-automatic-attacks',
            siteDefinitionId: siteDefId,
            attack: {
              creatureType: attack.creatureType,
              strikes: attack.strikes,
              prowess: attack.prowess,
              ...(attack.body !== undefined ? { body: attack.body } : {}),
              ...(attack.uncancelable ? { uncancelable: true } : {}),
              ...(attack.eachCharacter ? { eachCharacter: true } : {}),
            },
          },
        }),
      ],
    };
  }

  if (apply.type === 'shuffle-deck-top') {
    // Shuffle the top N cards of the target player's play deck, keeping
    // them at the top in a new random order. Used by Palantír of Minas
    // Tirith to randomise the top 5 of both players' decks.
    const n = apply.count ?? 5;
    const isOpponent = apply.toOwner === 'opponent';
    const targetIndex = isOpponent ? 1 - ctx.playerIndex : ctx.playerIndex;
    const targetPlayer = newPlayers[targetIndex];
    if (!targetPlayer) {
      return { error: `shuffle-deck-top: player at index ${targetIndex} not found` };
    }
    const sliceSize = Math.min(n, targetPlayer.playDeck.length);
    if (sliceSize > 0) {
      const topN = targetPlayer.playDeck.slice(0, sliceSize);
      const [shuffled, newRng] = shuffle(topN, rngRef.rng);
      rngRef.rng = newRng;
      const newDeck = [...shuffled, ...targetPlayer.playDeck.slice(sliceSize)];
      const label = isOpponent ? "opponent's" : 'own';
      logDetail(`Grant-action ${ctx.action.actionId}: shuffling top ${sliceSize} of ${label} play deck`);
      newPlayers[targetIndex] = { ...newPlayers[targetIndex], playDeck: newDeck };
    }
    return { updatedChar: char, effects: [], stateOps: [] };
  }

  // `discard-target-character` — discard the character identified by
  // action.targetCardId, along with all their items and allies, to the
  // owning player's discard pile. Followers revert to general influence.
  // Used by The Arkenstone (le-418): discard a Dwarf at the same site.
  if (apply.type === 'discard-target-character') {
    const targetCharId = ctx.action.targetCardId;
    if (!targetCharId) {
      return { error: `${ctx.sourceName}: discard-target-character requires targetCardId` };
    }
    let targetPlayerIndex = -1;
    for (let i = 0; i < newPlayers.length; i++) {
      if (newPlayers[i].characters[targetCharId as string]) {
        targetPlayerIndex = i;
        break;
      }
    }
    if (targetPlayerIndex === -1) {
      return { error: `${ctx.sourceName}: target character ${targetCharId as string} not found` };
    }
    const targetPlayerData = newPlayers[targetPlayerIndex];
    const targetChar = targetPlayerData.characters[targetCharId as string];
    if (!targetChar) {
      return { error: `${ctx.sourceName}: target character ${targetCharId as string} missing` };
    }
    const targetDefId = resolveInstanceId(state, targetCharId);
    const targetName = (targetDefId ? defById(state, targetDefId)?.name : undefined) ?? String(targetCharId);
    logDetail(`Grant-action ${ctx.action.actionId}: discarding ${targetName} to player ${targetPlayerIndex}'s discard pile`);

    // Remove character from all companies
    const newCompanies = targetPlayerData.companies.map(c => ({
      ...c,
      characters: c.characters.filter(ch => ch !== targetCharId),
    }));

    // Build new discard pile: character + items + allies; hazards go to their owner
    let newDiscard = [...targetPlayerData.discardPile];
    const hazardPlayerIdx = 1 - targetPlayerIndex;
    const newHazardDiscard = [...newPlayers[hazardPlayerIdx].discardPile];
    if (targetDefId) {
      newDiscard = [...newDiscard, { instanceId: targetCharId, definitionId: targetDefId }];
    }
    for (const item of targetChar.items) {
      logDetail(`Grant-action ${ctx.action.actionId}: discarding item ${item.instanceId as string} from ${targetName}`);
      newDiscard = [...newDiscard, toCardInstance(item)];
    }
    for (const ally of targetChar.allies) {
      logDetail(`Grant-action ${ctx.action.actionId}: discarding ally ${ally.instanceId as string} from ${targetName}`);
      newDiscard = [...newDiscard, toCardInstance(ally)];
    }
    for (const hazard of targetChar.hazards) {
      logDetail(`Grant-action ${ctx.action.actionId}: discarding hazard ${hazard.instanceId as string} from ${targetName}`);
      const hazOwner = ownerOf(hazard.instanceId);
      let hazOwnerIdx = newPlayers.findIndex(p => p.id === hazOwner);
      if (hazOwnerIdx === -1) hazOwnerIdx = targetPlayerIndex === 0 ? 1 : 0;
      if (hazOwnerIdx === targetPlayerIndex) {
        newDiscard = [...newDiscard, toCardInstance(hazard)];
      } else {
        newPlayers[hazOwnerIdx] = { ...newPlayers[hazOwnerIdx], discardPile: [...newPlayers[hazOwnerIdx].discardPile, toCardInstance(hazard)] };
      }
    }

    // Remove character from characters map and revert followers to GI
    const { [targetCharId as string]: _removed, ...remainingChars } = targetPlayerData.characters;
    let updatedChars = remainingChars;
    for (const followerId of targetChar.followers) {
      const follower = updatedChars[followerId as string];
      if (follower && follower.controlledBy === targetCharId) {
        logDetail(`Grant-action ${ctx.action.actionId}: reverting follower ${followerId as string} to general influence`);
        updatedChars = {
          ...updatedChars,
          [followerId as string]: { ...follower, controlledBy: 'general' as const },
        };
      }
    }

    newPlayers[targetPlayerIndex] = {
      ...targetPlayerData,
      companies: newCompanies,
      characters: updatedChars,
      discardPile: newDiscard,
    };
    newPlayers[hazardPlayerIdx] = { ...newPlayers[hazardPlayerIdx], discardPile: newHazardDiscard };
    return { updatedChar: char, effects: [], stateOps: [] };
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
  if (name === 'hand-size-modifier') {
    if (typeof apply.value !== 'number') return null;
    return { type: 'hand-size-modifier', value: apply.value };
  }
  if (name === 'site-resource-unlocked') {
    if (typeof apply.siteType !== 'string' || typeof apply.subtype !== 'string') return null;
    return { type: 'site-resource-unlocked', siteType: apply.siteType, subtype: apply.subtype };
  }
  if (name === 'check-modifier') {
    // A one-shot roll modifier the engine collects when the targeted
    // character makes a matching check. Consumed the first time the targeted
    // character makes a check of the matching kind — e.g. When You Know More
    // (dm-163) taps a sage to add +2 to one influence attempt by a company-
    // mate, and When I Know Anything (td-166) adds +3 to one corruption check
    // by a character in the sage's company.
    if (typeof apply.check !== 'string') return null;
    if (typeof apply.value !== 'number') return null;
    return { type: 'check-modifier', check: apply.check, value: apply.value };
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
      const company = findCharacterCompany(player.companies, characterId);
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
  action?: import('../types/actions-organization.js').ActivateGrantedAction,
): import('../types/pending.js').ActiveConstraint['target'] | null {
  switch (targetName ?? 'bearer-company') {
    case 'bearer-company': {
      const company = findCharacterCompany(player.companies, characterId);
      if (!company) return null;
      return { kind: 'company', companyId: company.id };
    }
    case 'player':
      return { kind: 'player', playerId };
    case 'action-target-company': {
      const companyId = action?.targetCompanyId;
      if (!companyId) return null;
      return { kind: 'company', companyId };
    }
    case 'action-target-character': {
      // The character carried on the action's `targetCardId` — used when a
      // grant-action modifies a specific other character's pending check
      // (When You Know More dm-163 boosts a company-mate's influence attempt;
      // When I Know Anything td-166 targets the character whose corruption
      // check is being resolved).
      const targetCharId = action?.targetCardId;
      if (!targetCharId) return null;
      return { kind: 'character', characterId: targetCharId };
    }
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

  const charDef = resolveDef(state, action.characterId);
  const charName = charDef?.name ?? '?';
  const sourceDef = defById(state, action.sourceCardDefinitionId);
  const sourceName = sourceDef?.name ?? '?';

  // Grant-actions can originate from either:
  //  - a `grant-action` effect declared on the source card (static),
  //  - a `granted-action` active constraint whose source is the source
  //    card (dynamic, added via on-event / sequence apply).
  // Check the static path first; if that doesn't yield a matching
  // action, fall through to an active constraint lookup.
  const staticEffect = getCardEffects(sourceDef).find(
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
  // METD §7 / rule 10.08: the no-tap variant of corruption removal
  // skips paying the bearer-tap cost (and instead suffers -3 to the
  // roll plus a per-turn lock — both handled in the apply branch).
  const noTap = (action as { noTap?: true }).noTap === true;

  const costResult = applyCost(state, resolved.cost, action.characterId, {
    playerIndex,
    sourceCardId: action.sourceCardId,
    sourceCardDefId: action.sourceCardDefinitionId,
    noTap,
    label: `${action.actionId}/${sourceName}`,
  });
  if ('error' in costResult) return { state, error: `${sourceName}: ${costResult.error}` };

  const newPlayers = clonePlayers(costResult.state);
  let updatedChar: CharacterInPlay = newPlayers[playerIndex].characters[action.characterId as string] ?? char;

  // For sage-and-scout-in-company cost: `applyCost` taps the sage (characterId).
  // Also tap the scout (secondCharacterId) here.
  if (resolved.cost.tap === 'sage-and-scout-in-company' && action.secondCharacterId) {
    const scout = newPlayers[playerIndex].characters[action.secondCharacterId as string];
    if (!scout) return { state, error: `sage-and-scout-in-company: scout ${action.secondCharacterId as string} not found` };
    logDetail(`Grant-action ${action.actionId}: tapping scout ${action.secondCharacterId as string}`);
    newPlayers[playerIndex] = {
      ...newPlayers[playerIndex],
      characters: {
        ...newPlayers[playerIndex].characters,
        [action.secondCharacterId as string]: { ...scout, status: CardStatus.Tapped },
      },
    };
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

/** Returns true if the card definition represents a Leader-keyword character. */
function isLeaderCharacter(def: ReturnType<typeof defById>): boolean {
  return !!(def && isCharacterCard(def) && (def.keywords ?? []).includes('Leader'));
}

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
    const siteDef = defById(state, sourceCompany.currentSite.definitionId);
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

  const charDef = defById(state, char.definitionId);
  const splittingIsLeader = isLeaderCharacter(charDef);

  let result = sweepCompanyMembershipChangedEvents({
    ...updatePlayer(state, playerIndex, p => ({ ...p, companies, siteDeck: newSiteDeck })),
    reverseActions: [...state.reverseActions, reverseAction],
  }, [sourceCompany.id]);

  if (splittingIsLeader) {
    logDetail(`Split company: splitting character is a Leader — sweeping leader-leaves-company events on ${sourceCompany.id as string}`);
    result = sweepLeaderLeavesCompanyEvents(result, [sourceCompany.id]);
  }

  return { state: result };
}

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

  const sourceCompany = companyById(player.companies, action.sourceCompanyId);
  if (!sourceCompany) return { state, error: 'Source company not found' };

  const targetCompany = companyById(player.companies, action.targetCompanyId);
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

  const charDef = resolveDef(state, charInstId);
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

  const movingCharDef = defById(state, char.definitionId);
  const movingIsLeader = isLeaderCharacter(movingCharDef);

  let moveResult = sweepCompanyMembershipChangedEvents(sweepAutoDiscardResourceEvents(sweepAutoDiscardHazards({
    ...updatePlayer(state, playerIndex, p => ({ ...p, companies: filteredCompanies })),
    reverseActions: [...state.reverseActions, reverseAction],
  })), [action.sourceCompanyId, action.targetCompanyId]);

  if (movingIsLeader) {
    logDetail(`Move to company: moving character is a Leader — sweeping leader-leaves-company events on ${action.sourceCompanyId as string}`);
    moveResult = sweepLeaderLeavesCompanyEvents(moveResult, [action.sourceCompanyId]);
  }

  return { state: moveResult };
}

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

  const sourceCompany = companyById(player.companies, action.sourceCompanyId);
  if (!sourceCompany) return { state, error: 'Source company not found' };

  const targetCompany = companyById(player.companies, action.targetCompanyId);
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

  // If the source company had a planned destination, that site card was pulled from
  // the site deck when plan-movement was executed. Merging cancels the source's
  // planned movement, so return the site card to the deck — unless the same card
  // instance is still referenced by another company (rules 3.37 / 3.39).
  let siteDeck = player.siteDeck;
  if (sourceCompany.destinationSite) {
    const srcDestId = sourceCompany.destinationSite.instanceId;
    const anotherCompanyHasIt = player.companies.some(
      c => c.id !== action.sourceCompanyId
        && (c.currentSite?.instanceId === srcDestId || c.destinationSite?.instanceId === srcDestId),
    );
    if (anotherCompanyHasIt) {
      logDetail(`Merge companies: source company had destination ${srcDestId as string} but it is still in play at another company — not returning to site deck`);
    } else {
      logDetail(`Merge companies: source company had destination ${srcDestId as string} — returning to site deck`);
      siteDeck = [...player.siteDeck, toCardInstance(sourceCompany.destinationSite)];
    }
  }

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

  // Check if any character in the source company is a leader
  const sourceHasLeader = sourceCompany.characters.some(id => {
    const c = player.characters[id as string];
    return c && isLeaderCharacter(defById(state, c.definitionId));
  });

  let mergeResult = sweepCompanyMembershipChangedEvents(sweepAutoDiscardResourceEvents(sweepAutoDiscardHazards({
    ...updatePlayer(state, playerIndex, p => ({ ...p, companies, siteDeck })),
    reverseActions: [...state.reverseActions, ...reverses],
  })), [action.sourceCompanyId, action.targetCompanyId]);

  if (sourceHasLeader) {
    logDetail(`Merge companies: source company had a Leader — sweeping leader-leaves-company events on ${action.sourceCompanyId as string}`);
    mergeResult = sweepLeaderLeavesCompanyEvents(mergeResult, [action.sourceCompanyId]);
  }

  return { state: mergeResult };
}

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

  // Hide in Dark Places (le-192) locks its scout's company stationary for the
  // turn — such a company may not declare movement.
  if (state.activeConstraints.some(
    c => c.kind.type === 'company-cannot-move'
      && c.target.kind === 'company'
      && c.target.companyId === company.id,
  )) {
    logDetail(`Plan movement rejected: company ${company.id as string} is locked stationary (company-cannot-move)`);
    return { state, error: 'Company is locked stationary this turn (cannot declare movement)' };
  }

  const deckCard = findById(player.siteDeck, action.destinationSite);
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
        && c.currentSite?.definitionId === company.currentSite!.definitionId
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

