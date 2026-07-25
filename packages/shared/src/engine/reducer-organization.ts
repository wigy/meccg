/**
 * @module reducer-organization
 *
 * Organization phase handlers for the game reducer. Covers playing characters,
 * moving characters between companies, transferring items, corruption checks,
 * planning movement, and sideboard access.
 */

import type { GameState, CardInstanceId, CharacterInPlay, CardInstance, OrganizationPhaseState, Company, SiteInPlay, GameAction, FetchWizardOnStoreEffect } from '../index.js';
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
import { findCapturingPressGang, capturePressGang } from './press-gang.js';
import { clonePlayers, companyHasImmobileCharacter, nextCompanyId, handleFetchFromPile, sweepAutoDiscardHazards, sweepAutoDiscardResourceEvents, sweepCompanyMembershipChangedEvents, sweepLeaderLeavesCompanyEvents, removeAttachment, removeById, stagePointsOfCard, toCardInstance, updatePlayer, updateCharacter, wrongActionType, findCharacterCompany, findById, playerById, getCardEffects, companyById, defById, discardCardsInPlayWhere, selfSideboardToDeckMove, siteDeniesCompanyMove, matchesDefinition } from './reducer-utils.js';
import { handlePlayPermanentEvent, handlePlayShortEvent, handlePlayResourceShortEvent } from './reducer-events.js';
import { handleGrantActionApply } from './grant-action-apply.js';
import { enqueueResolution, enqueueCorruptionCheck, removeConstraint, sweepExpired } from './pending.js';
import { recomputeDerived } from './recompute-derived.js';
import { resolveDef, getEffectiveSkills } from './effects/index.js';
import { matchesCondition } from '../effects/condition-matcher.js';
import { directInfluenceControlAllowed } from './control-cost.js';
import { applyMove, type MoveContext } from './reducer-move.js';
import { wizardSpecificName } from './fallen-wizard-specific.js';


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
  'reanimate-from-discard': handleReanimateFromDiscard,
  'manifestation-swap': handleManifestationSwap,
  'discard-to-recruit': handleDiscardToRecruit,
  'pass': handleOrganizationPass,
  'plan-movement': handlePlanMovement,
  'cancel-movement': handleCancelMovement,
  'play-permanent-event': handlePlayPermanentEvent,
  'play-short-event': handleOrganizationPlayShortEvent,
  'fetch-from-pile': handleFetchFromPile,
  'move-to-influence': handleMoveToInfluence,
  'discard-character': handleDiscardCharacter,
  'transfer-item': handleTransferItem,
  'store-item': handleStoreItem,
  'split-company': handleSplitCompany,
  'move-to-company': handleMoveToCompany,
  'merge-companies': handleMergeCompanies,
  'start-sideboard-to-deck': handleStartSideboard,
  'start-sideboard-to-discard': handleStartSideboard,
  'fetch-from-sideboard': handleFetchFromSideboard,
  'card-sideboard-to-deck': handleCardSideboardToDeck,
  'activate-granted-action': handleActivateGrantedAction,
  'test-ring-at-site': handleTestRingAtSite,
  'discard-stage-resource': handleDiscardStageResource,
  'voluntary-discard-in-play': handleVoluntaryDiscardInPlay,
  'return-attached-to-hand': handleReturnAttachedToHand,
  'activate-org-fetch': handleActivateOrgFetch,
  'discard-for-evil-hour-movement': handleDiscardForEvilHourMovement,
  'pay-movement-tax': handlePayMovementTax,
};

export function handleOrganization(state: GameState, action: GameAction): ReducerResult {
  const handler = ORGANIZATION_HANDLERS[action.type];
  if (!handler) return { state, error: `Unhandled organization action: ${action.type}` };
  return handler(state, action);
}

/**
 * Pass during organization. If a sideboard sub-flow is active, exits the
 * sub-flow and returns to normal play. Otherwise advances to the
 * Long-event phase (discarding the active player's resource long-events per
 * CoE rule 2.III.1).
 */
function handleOrganizationPass(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'pass') return wrongActionType(state, action, 'pass');
  const orgState = requirePhaseState(state, Phase.Organization);
  if (orgState.sideboardFetchDestination !== null) {
    // Exits the to-discard sub-flow (done fetching), or a to-deck sub-flow
    // that has nothing left to fetch (the fetch counter is shared between
    // the two sub-flows, so to-deck can be entered with no fetch available).
    logDetail(`Sideboard access: player ${action.player as string} done fetching to ${orgState.sideboardFetchDestination} (${orgState.sideboardFetchedThisTurn} cards)`);
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

  // Raise the organization-phase-end boundary for the active player so that
  // "through your next organization phase" constraints (Shifter of Hues wh-115)
  // created on an earlier turn expire here. The constraint created during *this*
  // organization phase carries this same turn number and so survives — see
  // `ConstraintScope['next-organization-phase']`.
  const swept = sweepExpired(state, {
    kind: 'organization-phase-end',
    playerId: activePlayer,
    turnNumber: state.turnNumber,
  });

  return {
    state: {
      ...updatePlayer(swept, activeIndex, p => ({
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
 * Voluntarily discards one of the player's in-play permanent-events carrying a
 * `voluntary-discard` effect during their organization phase ("Discard during
 * your organization phase if you choose" — Going Ever Under Dark ba-37). The
 * card leaves `cardsInPlay` for the discard pile; any company binding is
 * severed automatically (the entry is gone), lifting its restrictions.
 */
function handleVoluntaryDiscardInPlay(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'voluntary-discard-in-play') return wrongActionType(state, action, 'voluntary-discard-in-play');
  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const card = player.cardsInPlay.find(c => c.instanceId === action.cardInstanceId);
  if (!card) return { state, error: 'Voluntary-discard target not found in play' };
  const def = defById(state, card.definitionId);
  const eff = def ? getCardEffects(def).find(e => e.type === 'voluntary-discard') : undefined;
  if (!eff || eff.type !== 'voluntary-discard' || eff.phase !== 'organization') {
    return { state, error: 'Target does not allow voluntary discard during the organization phase' };
  }

  logDetail(`Organization: ${player.name} voluntarily discards ${def?.name ?? '?'} from play`);
  const next = updatePlayer(state, playerIndex, p => ({
    ...p,
    cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== action.cardInstanceId),
    discardPile: [...p.discardPile, toCardInstance(card)],
  }));
  return { state: recomputeDerived(next) };
}

/**
 * Returns an attached card to its owner's hand during the organization phase
 * ("You may return … to your hand: during your organization phase").
 *
 * Two kinds of attachment qualify, both carrying a `return-to-hand` effect
 * whose triggers include `organization`:
 * - an **ally** on its controlling character (Radagast's Black Bird wh-114);
 * - a **permanent-event placed on a character**, which the engine stores in
 *   that character's `items` (the Radagast Shapeshifter forms wh-112/115/116:
 *   "Return this card to your hand … if you choose, during your organization
 *   phase").
 *
 * The card is detached and placed into the player's hand, never the discard
 * pile.
 */
function handleReturnAttachedToHand(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'return-attached-to-hand') return wrongActionType(state, action, 'return-attached-to-hand');
  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const removed = removeAttachment(player, 'allies', action.cardInstanceId)
    ?? removeAttachment(player, 'items', action.cardInstanceId);
  if (!removed) return { state, error: 'return-attached-to-hand: card not found in play' };
  const def = defById(state, removed.attachment.definitionId);
  const canReturn = getCardEffects(def).some(
    e => e.type === 'return-to-hand' && e.during.includes('organization'),
  );
  if (!canReturn) return { state, error: 'return-attached-to-hand: card may not return to hand this phase' };

  logDetail(`Organization: ${player.name} returns ${def?.name ?? '?'} to hand`);
  const next = updatePlayer(state, playerIndex, () => ({
    ...removed.player,
    hand: [...removed.player.hand, toCardInstance(removed.attachment)],
  }));
  return { state: recomputeDerived(next) };
}

/**
 * Enchanted Stream (as-27): tap one untapped character toward a company's
 * movement tax. Increments {@link OrganizationPhaseState.movementTaxPaid} for
 * that company; once the required number ("to a maximum of two") have been
 * tapped, `plan-movement` / `split-company` are unlocked for the company this
 * org phase.
 */
function handlePayMovementTax(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'pay-movement-tax') return wrongActionType(state, action, 'pay-movement-tax');
  const orgState = requirePhaseState(state, Phase.Organization);
  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const company = companyById(player.companies, action.companyId);
  if (!company) return { state, error: 'pay-movement-tax: company not found' };
  if (!company.characters.includes(action.characterId)) {
    return { state, error: 'pay-movement-tax: character is not in the company' };
  }
  const char = player.characters[action.characterId];
  if (!char || char.status !== CardStatus.Untapped) {
    return { state, error: 'pay-movement-tax: character is not an untapped member' };
  }
  const cid = action.companyId as string;
  const paidSoFar = (orgState.movementTaxPaid?.[cid] ?? 0) + 1;
  const charName = defById(state, char.definitionId)?.name ?? action.characterId;
  logDetail(`Organization: paying Enchanted Stream movement tax — tapping ${charName} for company ${cid} (${paidSoFar} paid this org phase)`);
  const afterTap = updatePlayer(state, playerIndex, p => ({
    ...p,
    characters: { ...p.characters, [action.characterId]: { ...char, status: CardStatus.Tapped } },
  }));
  return {
    state: recomputeDerived({
      ...afterTap,
      phaseState: { ...orgState, movementTaxPaid: { ...(orgState.movementTaxPaid ?? {}), [cid]: paidSoFar } },
    }),
  };
}

/**
 * Discards an in-play (tapped) A More Evil Hour (ba-48) during the organization
 * phase and marks the targeted company with {@link Company.evilHourMovementBonus},
 * granting it a persistent conditional +2 region-movement bonus.
 */
function handleDiscardForEvilHourMovement(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'discard-for-evil-hour-movement') return wrongActionType(state, action, 'discard-for-evil-hour-movement');
  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const card = player.cardsInPlay.find(c => c.instanceId === action.cardInstanceId);
  if (!card) return { state, error: 'A More Evil Hour not found in play' };
  if (card.status !== CardStatus.Tapped) return { state, error: 'A More Evil Hour must be tapped to grant movement' };
  const def = defById(state, card.definitionId);
  const eff = def ? getCardEffects(def).find(e => e.type === 'evil-hour-grant-movement') : undefined;
  if (!eff || eff.type !== 'evil-hour-grant-movement') {
    return { state, error: 'Card does not grant the A More Evil Hour movement bonus' };
  }
  const company = player.companies.find(c => c.id === action.companyId);
  if (!company) return { state, error: 'Target company not found' };

  logDetail(`Organization: ${player.name} discards ${def?.name ?? '?'} to grant company ${action.companyId as string} the region-movement bonus`);
  const next = updatePlayer(state, playerIndex, p => ({
    ...p,
    cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== action.cardInstanceId),
    discardPile: [...p.discardPile, toCardInstance(card)],
    companies: p.companies.map(c => c.id === action.companyId ? { ...c, evilHourMovementBonus: true } : c),
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
  // MEBA §characters: a Balrog player's non-unique mind≤3 character may be
  // brought into play from his hand, discard pile, or sideboard. Locate the
  // source pile by instance so the character is removed from the right place.
  let charSource: 'hand' | 'discard' | 'sideboard' = 'hand';
  let handCard = findById(player.hand, charInstId);
  if (!handCard) {
    const fromDiscard = findById(player.discardPile, charInstId);
    if (fromDiscard) { handCard = fromDiscard; charSource = 'discard'; }
  }
  if (!handCard) {
    const fromSideboard = findById(player.sideboard, charInstId);
    if (fromSideboard) { handCard = fromSideboard; charSource = 'sideboard'; }
  }
  if (!handCard) {
    return { state, error: 'play-character: character not found in hand, discard pile, or sideboard' };
  }
  const charDef = state.cardPool[handCard.definitionId] as import('../types/cards.js').CharacterCard;

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

  // Remove the character from its source pile. For a hand play this is the
  // hand; MEBA discard/sideboard plays remove it from those piles instead.
  const newHand = charSource === 'hand' ? removeById(handAfterVehicle, charInstId) : handAfterVehicle;
  const newDiscardPileBase = charSource === 'discard' ? removeById(player.discardPile, charInstId) : player.discardPile;
  const newSideboard = charSource === 'sideboard' ? removeById(player.sideboard, charInstId) : player.sideboard;

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
    const siteDef = state.cardPool[siteCard.definitionId] as import('../types/cards.js').SiteCard;

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
  const newCharacters: Record<CardInstanceId, CharacterInPlay> = { ...player.characters };
  newCharacters[charInstId] = newChar;
  if (action.controlledBy !== 'general') {
    const controllerId = action.controlledBy;
    const controller = newCharacters[controllerId];
    if (!controller) {
      return { state, error: 'Controlling character not found' };
    }
    newCharacters[controllerId] = {
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

  const stateAfterPlace = sweepCompanyMembershipChangedEvents(sweepAutoDiscardResourceEvents(sweepAutoDiscardHazards({
    ...updatePlayer(state, playerIndex, p => ({
      ...p,
      hand: newHand,
      siteDeck: newSiteDeck,
      characters: newCharacters,
      companies,
      discardPile: eventToDiscard ? [...newDiscardPileBase, eventToDiscard] : newDiscardPileBase,
      sideboard: newSideboard,
      ...(clearRingwraithFlag ? { ringwraithReturnedToHand: undefined } : {}),
    })),
    phaseState: updateOrgState
      ? {
          ...phaseState,
          characterPlayedThisTurn: true,
          // MEBA: track the running count so a Balrog player's two-character
          // allowance can be enforced (see playCharacterActions).
          charactersBroughtIntoPlayThisTurn: (phaseState.charactersBroughtIntoPlayThisTurn ?? 0) + 1,
          lastPlayedCharacterDefinitionId: handCard.definitionId as string,
          ...(newBuddyGroup.length > 0 ? { buddyGroupPlayedThisTurn: newBuddyGroup } : {}),
        }
      : state.phaseState,
  })), affectedIds);

  // CoE rule 3.09: playing a Fallen-wizard avatar discards the *opponent's*
  // in-play Stage resources specific to that avatar (the opponent can no
  // longer bring that wizard into play, so their wizard-specific stage cards
  // are dead).
  let stateAfterAvatarSweep = stateAfterPlace;
  if (player.alignment === 'fallen-wizard' && isAvatarCharacter(charDef)) {
    stateAfterAvatarSweep = discardCardsInPlayWhere(
      stateAfterPlace,
      (card, cardOwner) =>
        cardOwner.id !== action.player
        && wizardSpecificName(defById(state, card.definitionId)) === charDef.name,
      card => {
        const def = defById(state, card.definitionId);
        logDetail(`Rule 3.09: ${charDef.name} entered play — discarding opponent's ${charDef.name}-specific stage card ${def?.name ?? (card.definitionId as string)}`);
      },
    ).state;
  }

  let finalState = applyCharacterSelfEntersPlayMoveEffects(stateAfterAvatarSweep, charDef, charInstId, playerIndex);

  // Saw Further and Deeper (dm-156): "Discard when you bring your Wizard into
  // play." A permanent event in the acting player's `cardsInPlay` carrying an
  // `on-event: avatar-enters-play` effect fires the moment that player brings
  // their avatar (mind === null) into play. Distinct from `self-enters-play`,
  // which fires for the *entering card itself* — this observes another card's
  // entry (the avatar's).
  if (isAvatarCharacter(charDef)) {
    finalState = applyAvatarEntersPlayEffects(finalState, playerIndex);
  }

  return { state: finalState };
}

/**
 * Handle `reanimate-from-discard` — Urlurtsu Nurn's (le-409)
 * `ringwraith-reanimate-from-discard` site ability. The player's Ringwraith,
 * present at the site, taps to bring one matching character (Orc/Troll) from
 * the discard pile into play at that site "as another company".
 *
 * The new company shares the in-play site instance (`siteCardOwned: false`,
 * like any sibling company at an occupied site) and carries a
 * `reanimatedRingwraithId` marker. The character comes into play under general
 * influence and does **not** consume the one-character-per-turn slot (tapping
 * the Ringwraith is the cost). The "must move to a different site or be
 * discarded" clause is enforced at the M/H→Site boundary (see
 * `discardStrandedReanimatedCompanies` in `mh-hazard-play.ts`).
 */
function handleReanimateFromDiscard(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'reanimate-from-discard') return wrongActionType(state, action, 'reanimate-from-discard');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  // The Ringwraith must be an untapped avatar of race `ringwraith` whose
  // company is at the named site.
  const ringwraith = player.characters[action.ringwraithInstanceId];
  if (!ringwraith) return { state, error: 'reanimate-from-discard: Ringwraith not found' };
  if (ringwraith.status !== CardStatus.Untapped) return { state, error: 'reanimate-from-discard: Ringwraith is not untapped' };
  const rwDef = defById(state, ringwraith.definitionId);
  if (!rwDef || !isCharacterCard(rwDef) || !isAvatarCharacter(rwDef) || (rwDef as { race?: string }).race !== 'ringwraith') {
    return { state, error: 'reanimate-from-discard: character is not a Ringwraith' };
  }
  const rwCompany = findCharacterCompany(player.companies, action.ringwraithInstanceId);
  if (!rwCompany || !rwCompany.currentSite || rwCompany.currentSite.instanceId !== action.siteInstanceId) {
    return { state, error: 'reanimate-from-discard: Ringwraith is not at the named site' };
  }

  // The site must actually carry the rule (and expose the reanimation filter).
  const siteDef = defById(state, rwCompany.currentSite.definitionId);
  const rule = ((siteDef && isSiteCard(siteDef) ? siteDef.effects ?? [] : []).find(
    e => e.type === 'site-rule' && (e as { rule?: string }).rule === 'ringwraith-reanimate-from-discard',
  )) as { filter: import('../types/effects.js').Condition } | undefined;
  if (!rule) return { state, error: 'reanimate-from-discard: site does not grant this ability' };

  // The target must be a matching character in the discard pile.
  const targetCard = findById(player.discardPile, action.characterInstanceId);
  if (!targetCard) return { state, error: 'reanimate-from-discard: character not in discard pile' };
  const targetDef = defById(state, targetCard.definitionId);
  if (!targetDef || !isCharacterCard(targetDef) || !matchesDefinition(targetDef, rule.filter)) {
    return { state, error: 'reanimate-from-discard: character does not match the site filter' };
  }

  logDetail(`Reanimate ${targetDef.name} from discard at ${'name' in (siteDef ?? {}) ? (siteDef as { name: string }).name : action.siteInstanceId as string} — ${rwDef.name} taps to bring it in as a new company`);

  // Tap the Ringwraith (the cost) and mint the reanimated character.
  const newChar: CharacterInPlay = {
    instanceId: targetCard.instanceId,
    definitionId: targetCard.definitionId,
    status: CardStatus.Untapped,
    items: [],
    allies: [],
    hazards: [],
    followers: [],
    controlledBy: 'general',
    effectiveStats: ZERO_EFFECTIVE_STATS,
  };
  const newCharacters: Record<CardInstanceId, CharacterInPlay> = {
    ...player.characters,
    [action.ringwraithInstanceId]: { ...ringwraith, status: CardStatus.Tapped },
    [targetCard.instanceId]: newChar,
  };

  // New company sharing the in-play site instance (the Ringwraith's company
  // owns the physical card).
  const newCompany: Company = {
    id: nextCompanyId(player),
    characters: [targetCard.instanceId],
    currentSite: {
      instanceId: action.siteInstanceId,
      definitionId: rwCompany.currentSite.definitionId,
      status: rwCompany.currentSite.status,
    },
    siteCardOwned: false,
    destinationSite: null,
    movementPath: [],
    moved: false,
    siteOfOrigin: null,
    onGuardCards: [],
    hazards: [],
    reanimatedRingwraithId: action.ringwraithInstanceId,
  };

  const result = sweepCompanyMembershipChangedEvents(
    updatePlayer(state, playerIndex, p => ({
      ...p,
      characters: newCharacters,
      companies: [...p.companies, newCompany],
      discardPile: removeById(p.discardPile, targetCard.instanceId),
    })),
    [newCompany.id],
  );
  return { state: result };
}

/**
 * Fire every `on-event: avatar-enters-play` effect on the acting player's
 * in-play cards, the moment that player brings an avatar into play. Each such
 * effect declares a `move` apply (self → discard); Saw Further and Deeper
 * (dm-156) uses it to discard itself when the Wizard is revealed. Reuses the
 * generic {@link applyMove} primitive, mirroring
 * {@link applyCharacterSelfEntersPlayMoveEffects}.
 */
function applyAvatarEntersPlayEffects(state: GameState, playerIndex: number): GameState {
  let newState = state;
  // Snapshot the instance ids up front — the list is mutated as cards discard.
  const inPlayIds = newState.players[playerIndex].cardsInPlay.map(c => c.instanceId);
  for (const cardId of inPlayIds) {
    const card = newState.players[playerIndex].cardsInPlay.find(c => c.instanceId === cardId);
    if (!card) continue;
    const def = defById(newState, card.definitionId);
    for (const effect of getCardEffects(def)) {
      if (effect.type !== 'on-event' || effect.event !== 'avatar-enters-play') continue;
      if (effect.apply.type !== 'move') continue;
      logDetail(`"${def?.name ?? (card.definitionId as string)}" fires on-event avatar-enters-play — running move apply`);
      const ctx: MoveContext = { sourceCardId: card.instanceId, sourcePlayerIndex: playerIndex };
      const r = applyMove(newState, effect.apply, ctx);
      if ('error' in r) {
        logDetail(`avatar-enters-play move apply failed: ${r.error}`);
      } else {
        newState = r.state;
      }
    }
  }
  return newState;
}

/**
 * Manifestation chains (e.g. The Balrog ba-3 discarding Balrog of Moria tw-12)
 * carry an `on-event: self-enters-play` → `move` effect on the character card
 * itself. Reuses the generic move primitive (`applyMove`) that permanent/short
 * events already run on entering play — a character play just has no chain
 * entry, so this dispatches the same `move` apply directly.
 */
function applyCharacterSelfEntersPlayMoveEffects(
  state: GameState,
  charDef: import('../types/cards.js').CharacterCard,
  charInstId: CardInstanceId,
  playerIndex: number,
): GameState {
  let newState = state;
  for (const effect of getCardEffects(charDef)) {
    if (effect.type !== 'on-event' || effect.event !== 'self-enters-play') continue;
    if (effect.apply.type !== 'move') continue;
    logDetail(`"${charDef.name}" entered play — running move apply`);
    const ctx: MoveContext = { sourceCardId: charInstId, sourcePlayerIndex: playerIndex };
    const r = applyMove(newState, effect.apply, ctx);
    if ('error' in r) {
      logDetail(`move apply failed on self-enters-play: ${r.error}`);
    } else {
      newState = r.state;
    }
  }
  return newState;
}

/**
 * Handle a `manifestation-swap` action (Strider ba-1: "You may bring
 * Aragorn II into play with Strider's company, removing Strider from the
 * game and automatically transferring all cards on Strider to Aragorn II").
 *
 * The named manifestation is played from hand into the old manifestation's
 * company at the same position, entering untapped. Everything referencing
 * the old instance transfers to the new one: attached cards (items, allies,
 * hazards, trophies), the follower list, the `controlledBy` of the old
 * character itself and of any character it controlled, plus any in-play
 * card (leader-controlled faction) it controlled. The old manifestation's
 * card is removed from the game — it lands in its owner's out-of-play pile,
 * preserving the no-card-disappears invariant.
 *
 * Per CRF 22 this is a resource-style play, not a character play: the
 * one-character-per-turn bookkeeping is untouched and the swap is routed
 * from the organization, site, and M/H phase reducers alike.
 */
export function handleManifestationSwap(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'manifestation-swap') return wrongActionType(state, action, 'manifestation-swap');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const oldId = action.characterId;

  const oldChar = player.characters[oldId];
  if (!oldChar) return { state, error: 'manifestation-swap: character not in play' };
  const oldDef = defById(state, oldChar.definitionId);
  if (!oldDef || !isCharacterCard(oldDef)) return { state, error: 'manifestation-swap: source is not a character' };
  const swap = getCardEffects(oldDef).find(
    (e): e is import('../types/effects.js').ManifestationSwapEffect => e.type === 'manifestation-swap',
  );
  if (!swap) return { state, error: `manifestation-swap: ${oldDef.name} has no manifestation-swap effect` };

  const handCard = findById(player.hand, action.cardInstanceId);
  if (!handCard) return { state, error: 'manifestation-swap: replacement not found in hand' };
  const newDef = defById(state, handCard.definitionId);
  if (!newDef || !isCharacterCard(newDef) || newDef.name !== swap.cardName) {
    return { state, error: `manifestation-swap: replacement must be ${swap.cardName}` };
  }
  const newId = handCard.instanceId;

  logDetail(`Manifestation swap: ${newDef.name} enters play with ${oldDef.name}'s company; ${oldDef.name} is removed from the game and all cards on him transfer`);

  // The replacement enters play untapped, inheriting every attachment and
  // control relationship of the old manifestation. Tap/wound state does not
  // transfer — only cards do ("bring Aragorn II into play").
  const newChar: CharacterInPlay = {
    instanceId: newId,
    definitionId: handCard.definitionId,
    status: CardStatus.Untapped,
    items: oldChar.items,
    allies: oldChar.allies,
    hazards: oldChar.hazards,
    followers: oldChar.followers,
    controlledBy: oldChar.controlledBy,
    effectiveStats: ZERO_EFFECTIVE_STATS,
    ...(oldChar.trophies !== undefined ? { trophies: oldChar.trophies } : {}),
  };

  // Rebuild the characters map: drop the old instance, add the new one,
  // repoint follower/controller references from old to new.
  const newCharacters: Record<CardInstanceId, CharacterInPlay> = {};
  for (const [cid, c] of Object.entries(player.characters)) {
    if (cid === (oldId as string)) continue;
    let updated = c;
    if (updated.controlledBy === oldId) {
      updated = { ...updated, controlledBy: newId };
      logDetail(`  Follower ${defById(state, updated.definitionId)?.name ?? cid} now controlled by ${newDef.name}`);
    }
    if (updated.followers.includes(oldId)) {
      updated = { ...updated, followers: updated.followers.map(f => (f === oldId ? newId : f)) };
    }
    newCharacters[cid as CardInstanceId] = updated;
  }
  newCharacters[newId] = newChar;

  // Replace the old instance in its company at the same position.
  const companies = player.companies.map(comp =>
    comp.characters.includes(oldId)
      ? { ...comp, characters: comp.characters.map(c => (c === oldId ? newId : c)) }
      : comp,
  );

  // Leader-controlled in-play cards (e.g. Orcs of Udûn-style factions)
  // transfer with everything else.
  const cardsInPlay = player.cardsInPlay.map(c =>
    c.controlledBy === oldId ? { ...c, controlledBy: newId } : c,
  );

  const newState = updatePlayer(state, playerIndex, p => ({
    ...p,
    hand: removeById(p.hand, newId),
    characters: newCharacters,
    companies,
    cardsInPlay,
    outOfPlayPile: [...p.outOfPlayPile, toCardInstance(oldChar)],
  }));

  return {
    state: newState,
    effects: [{
      effect: 'text-notification',
      message: `${player.name} brings ${newDef.name} into play with ${oldDef.name}'s company — ${oldDef.name} is removed from the game and all cards on him transfer`,
    }],
  };
}

/**
 * Handle a `discard-to-recruit` action (Folco Boffin dm-180: "You may discard
 * Folco Boffin at a Haven to play any Hobbit from your hand with his
 * company").
 *
 * A matching character from hand enters the bearer's company at the same
 * position, untapped. Everything referencing the bearer transfers to the new
 * instance: attached cards (items, allies, hazards, trophies), the follower
 * list, the `controlledBy` of the bearer itself and of any character it
 * controlled, plus any in-play card it controlled — identical to a
 * manifestation swap, which keeps the no-card-disappears invariant. Unlike a
 * manifestation swap, the discarded bearer's card lands in its owner's discard
 * pile (recyclable), not the out-of-play pile.
 *
 * Per CRF 22 this is a resource-style play, not a character play: the
 * one-character-per-turn bookkeeping is untouched and the action is routed
 * from the organization, site, and M/H phase reducers alike.
 */
export function handleDiscardToRecruit(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'discard-to-recruit') return wrongActionType(state, action, 'discard-to-recruit');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const oldId = action.characterId;

  const oldChar = player.characters[oldId];
  if (!oldChar) return { state, error: 'discard-to-recruit: character not in play' };
  const oldDef = defById(state, oldChar.definitionId);
  if (!oldDef || !isCharacterCard(oldDef)) return { state, error: 'discard-to-recruit: source is not a character' };
  const recruit = getCardEffects(oldDef).find(
    (e): e is import('../types/effects.js').DiscardToRecruitEffect => e.type === 'discard-to-recruit',
  );
  if (!recruit) return { state, error: `discard-to-recruit: ${oldDef.name} has no discard-to-recruit effect` };

  const company = findCharacterCompany(player.companies, oldId);
  if (!company) return { state, error: 'discard-to-recruit: bearer has no company' };
  if (recruit.requireHaven) {
    const siteDef = company.currentSite ? defById(state, company.currentSite.definitionId) : undefined;
    if (!siteDef || !isSiteCard(siteDef) || siteDef.siteType !== SiteType.Haven) {
      return { state, error: 'discard-to-recruit: bearer\'s company is not at a Haven' };
    }
  }

  const handCard = findById(player.hand, action.cardInstanceId);
  if (!handCard) return { state, error: 'discard-to-recruit: replacement not found in hand' };
  const newDef = defById(state, handCard.definitionId);
  if (!newDef || !isCharacterCard(newDef)) {
    return { state, error: 'discard-to-recruit: replacement is not a character' };
  }
  if (recruit.filter && !matchesCondition(recruit.filter, { target: newDef })) {
    return { state, error: `discard-to-recruit: ${newDef.name} does not match the recruit filter` };
  }
  const newId = handCard.instanceId;

  logDetail(`Discard-to-recruit: ${newDef.name} enters play with ${oldDef.name}'s company; ${oldDef.name} is discarded and all cards on him transfer`);

  // The replacement enters play untapped, inheriting every attachment and
  // control relationship of the bearer. Tap/wound state does not transfer —
  // only cards do ("play any Hobbit from your hand with his company").
  const newChar: CharacterInPlay = {
    instanceId: newId,
    definitionId: handCard.definitionId,
    status: CardStatus.Untapped,
    items: oldChar.items,
    allies: oldChar.allies,
    hazards: oldChar.hazards,
    followers: oldChar.followers,
    controlledBy: oldChar.controlledBy,
    effectiveStats: ZERO_EFFECTIVE_STATS,
    ...(oldChar.trophies !== undefined ? { trophies: oldChar.trophies } : {}),
  };

  // Rebuild the characters map: drop the bearer, add the new one, repoint
  // follower/controller references from bearer to new instance.
  const newCharacters: Record<CardInstanceId, CharacterInPlay> = {};
  for (const [cid, c] of Object.entries(player.characters)) {
    if (cid === (oldId as string)) continue;
    let updated = c;
    if (updated.controlledBy === oldId) {
      updated = { ...updated, controlledBy: newId };
      logDetail(`  Follower ${defById(state, updated.definitionId)?.name ?? cid} now controlled by ${newDef.name}`);
    }
    if (updated.followers.includes(oldId)) {
      updated = { ...updated, followers: updated.followers.map(f => (f === oldId ? newId : f)) };
    }
    newCharacters[cid as CardInstanceId] = updated;
  }
  newCharacters[newId] = newChar;

  // Replace the bearer in its company at the same position.
  const companies = player.companies.map(comp =>
    comp.characters.includes(oldId)
      ? { ...comp, characters: comp.characters.map(c => (c === oldId ? newId : c)) }
      : comp,
  );

  // Leader-controlled in-play cards transfer with everything else.
  const cardsInPlay = player.cardsInPlay.map(c =>
    c.controlledBy === oldId ? { ...c, controlledBy: newId } : c,
  );

  // The bearer's own card is discarded (its attachments transferred above, so
  // only the bare card instance goes to the discard pile).
  const newState = updatePlayer(state, playerIndex, p => ({
    ...p,
    hand: removeById(p.hand, newId),
    characters: newCharacters,
    companies,
    cardsInPlay,
    discardPile: [...p.discardPile, toCardInstance(oldChar)],
  }));

  return {
    state: newState,
    effects: [{
      effect: 'text-notification',
      message: `${player.name} discards ${oldDef.name} to bring ${newDef.name} into play with his company`,
    }],
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
  const char = player.characters[charInstId];
  if (!char) return { state, error: 'Character not found' };

  const charDef = resolveDef(state, charInstId);
  const narrowedCharDef = charDef as import('../types/cards.js').CharacterCard;

  logDetail(`Move to influence: ${narrowedCharDef.name} → ${action.controlledBy as string}`);

  const newCharacters = { ...player.characters };

  if (action.controlledBy === 'general') {
    // Remove from old controller's followers list
    const oldControllerId = char.controlledBy;
    const oldController = newCharacters[oldControllerId as CardInstanceId];
    if (oldController) {
      newCharacters[oldControllerId as CardInstanceId] = {
        ...oldController,
        followers: oldController.followers.filter(id => id !== charInstId),
      };
    }

    // Set character to GI
    newCharacters[charInstId] = {
      ...char,
      controlledBy: 'general',
    };
  } else {
    // Moving from GI to DI (become follower)
    const controllerId = action.controlledBy;
    const controller = newCharacters[controllerId];
    if (!controller) return { state, error: 'Controlling character not found' };

    // Enforce any control-source restriction on the moved character (e.g.
    // Wizard's Myrmidon: "only by general influence or a Fallen-wizard").
    if (!directInfluenceControlAllowed(state, char, controller, player.alignment)) {
      return { state, error: 'Control-source restriction forbids this controller' };
    }

    // If already a follower of someone else, remove from old controller first
    if (char.controlledBy !== 'general') {
      const oldControllerId = char.controlledBy;
      const oldController = newCharacters[oldControllerId];
      if (oldController) {
        newCharacters[oldControllerId] = {
          ...oldController,
          followers: oldController.followers.filter(id => id !== charInstId),
        };
      }
    }

    // Add to new controller's followers
    newCharacters[controllerId] = {
      ...controller,
      followers: [...controller.followers, charInstId],
    };

    // Set character's controlledBy
    newCharacters[charInstId] = {
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

  if (!player.characters[fromCharId]) return { state, error: 'Source character not found' };
  if (!player.characters[toCharId]) return { state, error: 'Target character not found' };

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

  if (!player.characters[charId]) return { state, error: 'Character not found' };

  // `no-storage` site-rule (Geann a-Lisch le-374): "Resources may never be
  // stored at this site." Reject a store attempt as a backstop to the
  // legal-action suppression in storeItemActions.
  const storeCompany = findCharacterCompany(player.companies, charId);
  const storeSiteDef = storeCompany?.currentSite
    ? defById(state, storeCompany.currentSite.definitionId)
    : undefined;
  if (storeSiteDef && isSiteCard(storeSiteDef)
    && storeSiteDef.effects?.some(e => e.type === 'site-rule' && e.rule === 'no-storage')) {
    logDetail(`Store item rejected: ${storeSiteDef.name} carries no-storage site-rule`);
    return { state, error: `Resources may never be stored at ${storeSiteDef.name}` };
  }

  const removed = removeAttachment(player, 'items', itemInstId);
  if (!removed || removed.charId !== charId) return { state, error: 'Item not found on character' };
  const item = removed.attachment;
  const itemDef = defById(state, item.definitionId);
  const charDef = resolveDef(state, charId);
  logDetail(`Store item: ${itemDef?.name ?? '?'} from ${charDef?.name ?? '?'}`);

  // Record where the card is stored: "stored there" references (Wizard's
  // Trove wh-85 `play-with-stored-card`) match against this site binding.
  const storedCard: CardInstance = {
    instanceId: item.instanceId,
    definitionId: item.definitionId,
    ...(storeCompany?.currentSite ? { storedAtSite: storeCompany.currentSite.definitionId } : {}),
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
  const avatarKey = action.characterInstanceId;
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
 * Handle `card-sideboard-to-deck`: a card carrying a `select: 'self'`
 * sideboard→deck `move` effect brings itself from the player's sideboard into
 * their play deck (reshuffling) during the organization phase. Card-granted
 * relocation of the Balrog sideboard family (Terror Heralds Doom ba-78), it
 * taps nothing and has no deck-size gate — distinct from the CoE 2.II.6
 * avatar-tap access.
 */
function handleCardSideboardToDeck(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'card-sideboard-to-deck') return wrongActionType(state, action, 'card-sideboard-to-deck');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const card = findById(player.sideboard, action.cardInstanceId);
  if (!card) return { state, error: 'Sideboard card not found' };
  const def = defById(state, card.definitionId);
  const move = selfSideboardToDeckMove(def);
  if (!move) return { state, error: `${def?.name ?? String(card.definitionId)} has no sideboard-to-deck move effect` };

  logDetail(`Sideboard self-relocation: ${def?.name ?? String(card.definitionId)} → play deck (reshuffling)`);
  const ctx: MoveContext = { sourceCardId: action.cardInstanceId, sourcePlayerIndex: playerIndex };
  const result = applyMove(state, move, ctx);
  if ('error' in result) return { state, error: result.error };
  return { state: result.state };
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
  const sage = player.characters[action.characterId];
  if (!sage) return { state, error: 'test-ring-at-site: sage not found' };
  if (sage.status !== CardStatus.Untapped) return { state, error: 'test-ring-at-site: sage is tapped' };

  const sageDef = defById(state, sage.definitionId);
  if (!sageDef || !isCharacterCard(sageDef)) return { state, error: 'test-ring-at-site: sage is not a character' };
  const skills = getEffectiveSkills(state, sage, sageDef as { skills?: readonly string[] });
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
    const char = player.characters[charInstId];
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
 * Handle split-company during organization.
 *
 * Moves the specified characters (a GI character and their followers)
 * out of the source company into a new company at the same site.
 * Validates that the source company retains at least one character.
 */

/** Returns true if the card definition represents a Leader-keyword character. */
function isLeaderCharacter(def: ReturnType<typeof defById>): boolean {
  return !!(def && isCharacterCard(def) && (def.keywords ?? []).includes('leader'));
}

function handleSplitCompany(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'split-company') return wrongActionType(state, action, 'split-company');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const sourceCompanyIndex = player.companies.findIndex(c => c.id === action.sourceCompanyId);
  if (sourceCompanyIndex < 0) return { state, error: 'Source company not found' };
  const sourceCompany = player.companies[sourceCompanyIndex];

  // Expand to include followers automatically
  const char = player.characters[action.characterId];
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
  const char = player.characters[charInstId];
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
 * Handle discard-character during organization (CoE rule 3.22).
 *
 * Discards a non-avatar character at a haven or its home site: the character,
 * its items, and its allies go to the player's discard pile; attached hazards
 * return to their owner's discard pile; followers revert to general influence
 * (immediately — this is the player's organization phase, so no deferral);
 * the character is removed from its company (empty companies are dropped).
 */
function handleDiscardCharacter(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'discard-character') return wrongActionType(state, action, 'discard-character');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const charInstId = action.characterInstanceId;
  const char = player.characters[charInstId];
  if (!char) return { state, error: 'Character not found' };

  const charDef = resolveDef(state, charInstId);
  if (!isCharacterCard(charDef)) return { state, error: 'Not a character' };
  if (isAvatarCharacter(charDef)) return { state, error: 'An avatar cannot be discarded (rule 3.22)' };

  const company = findCharacterCompany(player.companies, charInstId);
  if (!company) return { state, error: 'Character is not in a company' };

  // Press-gang (ba-22): a character the active player voluntarily discards
  // (rule 3.22) is instead captured off to the side by an opponent's Press-gang.
  const pressHost = findCapturingPressGang(state, playerIndex);
  if (pressHost) {
    logDetail(`Discard character (rule 3.22): ${charDef.name} redirected to opponent's Press-gang ${pressHost as string}`);
    return { state: capturePressGang(state, playerIndex, charInstId, pressHost) };
  }

  logDetail(`Discard character (rule 3.22): ${charDef.name} at ${company.currentSite?.definitionId as string ?? '?'} — discarding with ${char.items.length} item(s), ${char.allies.length} ally/allies, ${char.hazards.length} hazard(s); ${char.followers.length} follower(s) revert to GI`);

  const newPlayers = clonePlayers(state);
  const opponentIndex = 1 - playerIndex;

  // Character + possessions to the player's own discard pile.
  let ownDiscard = [...newPlayers[playerIndex].discardPile, { instanceId: charInstId, definitionId: char.definitionId }];
  for (const item of char.items) ownDiscard = [...ownDiscard, toCardInstance(item)];
  for (const ally of char.allies) ownDiscard = [...ownDiscard, toCardInstance(ally)];

  // Attached hazards return to their owner's discard pile.
  let opponentDiscard = [...newPlayers[opponentIndex].discardPile];
  for (const hazard of char.hazards) {
    const hazOwner = ownerOf(hazard.instanceId);
    if ((newPlayers[playerIndex].id as string) === hazOwner) {
      ownDiscard = [...ownDiscard, toCardInstance(hazard)];
    } else {
      opponentDiscard = [...opponentDiscard, toCardInstance(hazard)];
    }
  }

  // Remove the character; revert followers to GI (immediate — organization
  // phase); prune the leader's followers list if the character followed one.
  const { [charInstId]: _discarded, ...remainingChars } = newPlayers[playerIndex].characters;
  const newCharacters: Record<CardInstanceId, CharacterInPlay> = { ...remainingChars };
  for (const followerId of char.followers) {
    const follower = newCharacters[followerId];
    if (follower) {
      logDetail(`  follower ${followerId as string} reverts to general influence`);
      newCharacters[followerId] = { ...follower, controlledBy: 'general' };
    }
  }
  if (char.controlledBy !== 'general') {
    const leader = newCharacters[char.controlledBy];
    if (leader) {
      newCharacters[char.controlledBy] = { ...leader, followers: leader.followers.filter(f => f !== charInstId) };
    }
  }

  const companies = newPlayers[playerIndex].companies
    .map(c => c.id === company.id ? { ...c, characters: c.characters.filter(id => id !== charInstId) } : c)
    .filter(c => c.characters.length > 0);

  newPlayers[playerIndex] = { ...newPlayers[playerIndex], characters: newCharacters, companies, discardPile: ownDiscard };
  newPlayers[opponentIndex] = { ...newPlayers[opponentIndex], discardPile: opponentDiscard };

  let result = sweepCompanyMembershipChangedEvents(
    sweepAutoDiscardResourceEvents(sweepAutoDiscardHazards({ ...state, players: newPlayers })),
    [company.id],
  );
  if (isLeaderCharacter(charDef)) {
    logDetail(`Discard character: ${charDef.name} is a Leader — sweeping leader-leaves-company events on ${company.id as string}`);
    result = sweepLeaderLeavesCompanyEvents(result, [company.id]);
  }

  return { state: result };
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
      const c = player.characters[id];
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
    const c = player.characters[id];
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

  // A character who may not move (Shifter of Hues wh-115 on Radagast) keeps
  // their whole company stationary while they remain in it.
  if (companyHasImmobileCharacter(state, player, company)) {
    logDetail(`Plan movement rejected: company ${company.id as string} holds a character with bearer-cannot-move`);
    return { state, error: 'A character in this company may not move' };
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

  // A deny-company-move site-rule (Rivendell as-160: "A Ringwraith may not
  // move to this site") bars this company from declaring movement to the
  // destination — backstop behind the plan-movement legal-action filter.
  const destDef = defById(state, deckCard ? deckCard.definitionId : sharedSite!.definitionId);
  if (destDef && isSiteCard(destDef) && siteDeniesCompanyMove(state, player, company, destDef)) {
    logDetail(`Plan movement rejected: deny-company-move site-rule on ${destDef.name} bars company ${company.id as string}`);
    return { state, error: 'A site rule forbids this company from moving to this site' };
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

