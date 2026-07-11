/**
 * @module legal-actions/organization
 *
 * Legal actions during the organization phase. The active player can
 * reorganize companies, recruit characters, transfer items, and plan
 * movement for the upcoming movement/hazard phase.
 *
 * For play-character actions, every character card in the active player's
 * hand is evaluated against the CoE rules. A candidate action is generated
 * for each possible (site, controlledBy) combination. Non-viable candidates
 * carry a human-readable reason so the client can show why a character
 * cannot be played.
 */

import type {
  GameState,
  PlayerId,
  EvaluatedAction,
  CardInstanceId,
  CharacterCard,
  ResourceEventCard,
  MovementHazardPhaseState,
  GameAction,
  PlayerState,
  SiteCard,
} from '../../index.js';
import { hasPlayFlag } from '../../effects/play-flags.js';
import { formatSignedNumber } from '../../format-helpers.js';
import { isCharacterCard, isResourceEventCard, isSiteCard, isAvatarCharacter, isItemCard, isFactionCard } from '../../types/cards.js';
import { requirePhaseState } from '../../state-utils.js';
import { CardStatus, cardStatusToName } from '../../types/common.js';
import { Phase } from '../../types/state-phases.js';
import type { PlayTargetEffect, PlayOptionEffect, Condition, WithdrawAgentEffect } from '../../types/effects.js';
import { matchesCondition } from '../../effects/condition-matcher.js';
import { logDetail, logHeading } from './log.js';
import { notPlayable } from './action-builders.js';
import { buildBearerContext, resolveDef, collectCharacterEffects, resolveStatModifiers, getItemGrantedSkills } from '../effects/index.js';
import { buildInPlayNames, buildControllerInPlayNames } from '../recompute-derived.js';
import { controlCostOf } from '../control-cost.js';
import { activePlayerState, cardName, characterEntries, companyEffectiveSize, defById, defNamesOf, findCharacterCompany, findPlayerAvatar, findFallenWizardAvatarName, getCardEffects, matchesDefinition, playerById, stagePointsOfCard, toCardInstance, findDuplicationLimitEffect, findPlayConditionEffect, playerHasProtectedWizardhaven, parseHomesiteNames, siteRegionTypeOf, isCardNameInPlayForPlayer } from '../reducer-utils.js';
import { countConstraintsFromDefinition } from '../pending.js';
import { findMoveEffectByShape } from '../reducer-move.js';
import type { ResolverContext } from '../effects/index.js';
import { resolveInstanceId } from '../../types/state.js';
import { viableWithRegress } from '../reverse-actions.js';
import { playCharacterActions, discardCharacterActions } from './organization-characters.js';
import { recruitViaEventActions } from './recruit-via-event.js';
import { manifestationSwapActions } from './manifestation-swap.js';
import { playPermanentEventActions, playShortEventActions } from './organization-events.js';
import {
  planMovementActions,
  moveToInfluenceActions,
  transferItemActions,
  storeItemActions,
  splitCompanyActions,
  moveToCompanyActions,
  mergeCompaniesActions,
} from './organization-companies.js';
import { fetchFromSideboardActions, cardSideboardToDeckActions } from './organization-sideboard.js';
import { canPayCost } from '../cost-evaluator.js';

/**
 * Filter mode for {@link grantedActionActivations}. Selects which subset
 * of grant-action effects to emit:
 *
 *  - `'anyPhase'` — only effects flagged `anyPhase: true` (CRF rule
 *    2.1.1). Used by legal-action entry points for phases other than
 *    organization (site, M/H, end-of-turn) on the controller's own turn.
 *  - `'opposingSitePhase'` — only effects flagged `opposingSitePhase:
 *    true`. Emitted for the non-active (hazard) player during the
 *    active player's site phase. Used by Magical Harp.
 *  - `'freeCouncil'` — only effects flagged `freeCouncil: true`.
 *    Emitted for either player during the Free Council's
 *    corruption-checks step. Used by Magical Harp.
 *  - `'activeSitePhase'` — only effects flagged `activeSitePhase: true`.
 *    Emitted for the active (resource) player during their own site phase
 *    (enter-or-skip and play-resources steps). Used by Blasting Fire (wh-51)
 *    and Vile Fumes' (wh-54) transform-site feature.
 */
export type GrantActionPhaseFilter =
  | 'anyPhase'
  | 'opposingSitePhase'
  | 'freeCouncil'
  | 'activeSitePhase';

/**
 * Whether `effect` passes the given {@link GrantActionPhaseFilter}.
 * Each filter mode requires the corresponding boolean flag on the
 * effect (`anyPhase`, `opposingSitePhase`, or `freeCouncil`).
 */
function matchesPhaseFilter(
  effect: import('../../types/effects.js').GrantActionEffect,
  filter: GrantActionPhaseFilter,
): boolean {
  if (filter === 'anyPhase') return effect.anyPhase === true;
  if (filter === 'opposingSitePhase') return effect.opposingSitePhase === true;
  if (filter === 'freeCouncil') return effect.freeCouncil === true;
  if (filter === 'activeSitePhase') return effect.activeSitePhase === true;
  return false;
}

/**
 * Computes the available (unused) direct influence for a character in play,
 * optionally factoring in conditional DI bonuses against a specific target.
 *
 * A character's DI is their effectiveStats.directInfluence minus the sum
 * of mind values of all their followers. When a target character is specified,
 * conditional DI bonuses (e.g. Glorfindel's "+1 DI against Elves") are
 * resolved using an `influence-check` context.
 *
 * @param state - The full game state.
 * @param controllerInstanceId - The controlling character's instance ID.
 * @param player - The player who owns the controller.
 * @param targetDef - Optional target character definition for conditional DI resolution.
 */
export function availableDI(
  state: GameState,
  controllerInstanceId: CardInstanceId,
  player: { readonly characters: Readonly<Record<string, import('../../index.js').CharacterInPlay>> },
  targetDef?: CharacterCard,
): number {
  const controller = player.characters[controllerInstanceId as string];
  if (!controller) return 0;

  let usedDI = 0;
  for (const followerId of controller.followers) {
    const followerChar = player.characters[followerId as string];
    if (!followerChar) continue;
    const followerDef = resolveDef(state, followerChar.instanceId);
    if (isCharacterCard(followerDef) && followerDef.mind !== null) {
      // Use effective mind when available (e.g. The Arkenstone raises Dwarf mind by 1),
      // and honor a `control-restriction` cost override (e.g. Wizard's Myrmidon).
      usedDI += controlCostOf(state, followerChar, followerChar.effectiveStats.mind ?? followerDef.mind) ?? 0;
    }
  }

  let baseDI = controller.effectiveStats.directInfluence;

  // When checking DI for a specific target, resolve conditional DI bonuses
  // (e.g. Glorfindel II "+1 DI against Elves" uses reason: "influence-check")
  if (targetDef) {
    const ctrlDef = resolveDef(state, controller.instanceId);
    if (ctrlDef && isCharacterCard(ctrlDef)) {
      const resolverCtx: ResolverContext = {
        reason: 'influence-check',
        bearer: buildBearerContext(ctrlDef),
        target: {
          name: targetDef.name,
          race: targetDef.race,
          homesite: parseHomesiteNames(targetDef.homesite ?? ''),
          keywords: targetDef.keywords ?? [],
        },
      };
      const charEffects = collectCharacterEffects(state, controller, resolverCtx);
      const conditionalDI = resolveStatModifiers(charEffects, 'direct-influence', 0, resolverCtx);
      if (conditionalDI !== 0) {
        logDetail(`  DI bonus from influence-check effects: ${formatSignedNumber(conditionalDI)} against ${targetDef.name} (${targetDef.race})`);
      }
      baseDI += conditionalDI;
    }
  }

  return baseDI - usedDI;
}

/**
 * Computes all legal actions during the organization phase.
 *
 * Returns {@link EvaluatedAction} items so that non-viable play-character
 * candidates carry a human-readable reason for the client to display.
 */
/**
 * Discard-stage-resource actions (MEWH "The Player Turn"): a Fallen-wizard may
 * discard one of their in-play stage resource permanent-events during the
 * organization phase, but not if doing so would drop their stage-point total
 * below 3. One action is offered per eligible stage permanent-event.
 */
export function discardStageResourceActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player || player.alignment !== 'fallen-wizard') return [];

  const actions: EvaluatedAction[] = [];
  for (const card of player.cardsInPlay) {
    const def = defById(state, card.definitionId);
    if (!def || !isResourceEventCard(def) || (def as { alignment?: string }).alignment !== 'stage' || def.eventType !== 'permanent') continue;
    // Discarding must keep the running total at 3 or more (MEWH).
    const contribution = stagePointsOfCard(def);
    if (player.stagePoints - contribution < 3) {
      logDetail(`Discard-stage-resource: ${def.name} not offered — would drop stage points to ${player.stagePoints - contribution} (< 3)`);
      continue;
    }
    logDetail(`Discard-stage-resource: ${def.name} can be discarded (stage points ${player.stagePoints} → ${player.stagePoints - contribution})`);
    actions.push({
      action: { type: 'discard-stage-resource', player: playerId, cardInstanceId: card.instanceId },
      viable: true,
    });
  }
  return actions;
}

/**
 * Voluntary-discard actions ("Discard during your organization phase if you
 * choose" — Going Ever Under Dark ba-37). One action per in-play permanent-event
 * the player controls that carries a `voluntary-discard` effect with
 * `phase: "organization"`.
 */
export function voluntaryDiscardInPlayActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player) return [];

  const actions: EvaluatedAction[] = [];
  for (const card of player.cardsInPlay) {
    const def = defById(state, card.definitionId);
    const eff = getCardEffects(def).find(e => e.type === 'voluntary-discard');
    if (!eff || (eff as { phase?: string }).phase !== 'organization') continue;
    logDetail(`Voluntary-discard: ${cardName(state, card.definitionId)} can be discarded during the organization phase`);
    actions.push({
      action: { type: 'voluntary-discard-in-play', player: playerId, cardInstanceId: card.instanceId },
      viable: true,
    });
  }
  return actions;
}

/**
 * Org-phase-fetch activations (A Strident Spawn wh-61: "During your
 * organization phase, you may take one Half-orc character from your discard
 * pile to your hand"). For each in-play permanent-event the player controls that
 * carries an `org-phase-fetch` effect, offer one `activate-org-fetch` action —
 * provided the source has not already been used this turn and at least one
 * matching candidate exists in the named source piles.
 */
export function orgPhaseFetchActivations(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player) return [];
  const orgState = requirePhaseState(state, Phase.Organization);
  const used = orgState.discardFetchUsedThisTurn ?? [];
  const actions: EvaluatedAction[] = [];
  for (const card of player.cardsInPlay) {
    if (used.includes(card.instanceId)) continue;
    const def = defById(state, card.definitionId);
    if (!def) continue;
    for (const eff of getCardEffects(def)) {
      if (eff.type !== 'org-phase-fetch') continue;
      const hasCandidate = eff.from.some(src => {
        const pile = src === 'sideboard' ? player.sideboard
          : src === 'deck' ? player.playDeck
          : player.discardPile;
        return pile.some(c => {
          const cDef = defById(state, c.definitionId);
          return cDef !== undefined && matchesDefinition(cDef, eff.filter);
        });
      });
      if (!hasCandidate) {
        logDetail(`${def.name}: org-phase-fetch offered no candidates (none matching filter in [${eff.from.join(', ')}])`);
        continue;
      }
      logDetail(`${def.name}: org-phase-fetch available (take one matching card to hand)`);
      actions.push({
        action: { type: 'activate-org-fetch', player: playerId, cardInstanceId: card.instanceId },
        viable: true,
      });
    }
  }
  return actions;
}

export function organizationActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player) return [];

  if (state.activePlayer !== playerId) {
    logDetail(`Not active player (active: ${state.activePlayer as string ?? 'null'}), no actions`);
    return [];
  }

  const orgState = requirePhaseState(state, Phase.Organization);

  // Pending corruption checks (transfer / wound / Lure) are now produced
  // and consumed via the unified pending-resolution system. The
  // resolution short-circuit in `legal-actions/index.ts` collapses the
  // menu to the corruption-check action before this function is reached,
  // so no per-phase short-circuit is needed here.

  // When sideboard sub-flow is active, only fetch actions (+ pass for discard) are legal
  if (orgState.sideboardFetchDestination !== null) {
    logHeading(`Sideboard sub-flow active (destination: ${orgState.sideboardFetchDestination})`);
    return fetchFromSideboardActions(state, playerId);
  }

  // Note: "end of the organization phase" cards (e.g. Stealth) do not open a
  // restrictive sub-step. Per CoE 2.II.7 the resource player may declare
  // movement and otherwise organize at any point during the organization
  // phase, including after playing such a card. End-of-org cards are offered
  // alongside the normal organization actions below (see
  // `playResourceShortEventActions`), and the phase advances to Long-event
  // only when the active player passes.

  const actions: EvaluatedAction[] = [];

  // Cancel movement for companies with planned destinations
  for (const company of player.companies) {
    if (company.destinationSite !== null) {
      logDetail(`Company ${company.id as string} has planned movement → can cancel`);
      const candidate: GameAction = {
        type: 'cancel-movement',
        player: playerId,
        companyId: company.id,
      };
      actions.push(viableWithRegress(candidate, state.reverseActions));
    }
  }

  logDetail(`Organization: ${player.companies.length} company/companies, ${Object.keys(player.characters).length} character(s) in play`);

  // Play-character actions for each character card in hand
  const characterActions = playCharacterActions(state, playerId);
  actions.push(...characterActions);

  // Collect instance IDs that already have a play-character evaluation
  const evaluatedInstances = new Set(
    characterActions.map(ea =>
      (ea.action as { characterInstanceId: CardInstanceId }).characterInstanceId as string,
    ),
  );

  // Play permanent-event resource cards from hand
  const permanentEventActions = playPermanentEventActions(state, playerId);
  actions.push(...permanentEventActions);
  const permanentEventInstances = new Set(
    permanentEventActions.map(ea =>
      (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId as string,
    ),
  );

  // MEWH: a Fallen-wizard may discard an in-play stage resource (keeping ≥3 stage points)
  actions.push(...discardStageResourceActions(state, playerId));

  // "Discard during your organization phase if you choose" (Going Ever Under Dark ba-37)
  actions.push(...voluntaryDiscardInPlayActions(state, playerId));

  // Org-phase fetch granted by an in-play permanent-event (A Strident Spawn wh-61)
  actions.push(...orgPhaseFetchActivations(state, playerId));

  // Play short-event cards as resource (e.g. Twilight cancels an environment)
  const shortEventActions = playShortEventActions(state, playerId);
  actions.push(...shortEventActions);
  const shortEventInstances = new Set(
    shortEventActions.map(ea =>
      (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId as string,
    ),
  );

  // Play resource short-events from hand (e.g. Smoke Rings, Stealth,
  // Marvels Told). Per CoE 2.1.1, resource short-events are playable during
  // any phase of the active player's turn unless a rule or effect restricts
  // them. The helper skips hand cards whose play-window restricts them to
  // a different phase, and cards already evaluated as characters.
  const resourceShortEventEvaluated = playResourceShortEventActions(
    state, playerId, evaluatedInstances, 'organization',
  );
  actions.push(...resourceShortEventEvaluated);
  const resourceShortEventInstances = new Set(
    resourceShortEventEvaluated
      .map(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId as string | undefined)
      .filter((id): id is string => typeof id === 'string'),
  );

  // Character-recruitment events (A Chance Meeting tw-188): bring a character
  // into play at a relaxed set of sites, bypassing the one-character-per-turn
  // limit. Emitted as play-character actions carrying viaEventInstanceId.
  const recruitViaEventEvaluated = recruitViaEventActions(state, playerId);
  actions.push(...recruitViaEventEvaluated);
  const recruitViaEventInstances = new Set<string>();
  for (const ea of recruitViaEventEvaluated) {
    const a = ea.action as { characterInstanceId?: CardInstanceId; viaEventInstanceId?: CardInstanceId };
    if (a.characterInstanceId) recruitViaEventInstances.add(a.characterInstanceId as string);
    if (a.viaEventInstanceId) recruitViaEventInstances.add(a.viaEventInstanceId as string);
  }

  // Manifestation swaps (Strider ba-1 → Aragorn II): playable whenever a
  // normal resource could be played (CRF 22), so offered here too.
  const manifestationSwapEvaluated = manifestationSwapActions(state, playerId);
  actions.push(...manifestationSwapEvaluated);
  for (const ea of manifestationSwapEvaluated) {
    const a = ea.action as { cardInstanceId?: CardInstanceId };
    if (a.cardInstanceId) recruitViaEventInstances.add(a.cardInstanceId as string);
  }

  // Mark remaining hand cards as not playable during organization
  for (const handCard of player.hand) {
    if (evaluatedInstances.has(handCard.instanceId as string)) continue;
    if (permanentEventInstances.has(handCard.instanceId as string)) continue;
    if (shortEventInstances.has(handCard.instanceId as string)) continue;
    if (resourceShortEventInstances.has(handCard.instanceId as string)) continue;
    if (recruitViaEventInstances.has(handCard.instanceId as string)) continue;
    actions.push(notPlayable(playerId, handCard.instanceId, 'Not playable during the organization'));
  }

  // Move-to-influence actions (reassign characters between GI and DI)
  actions.push(...moveToInfluenceActions(state, playerId));

  // Discard-character actions (rule 3.22: non-avatar at a haven or home site)
  actions.push(...discardCharacterActions(state, playerId));

  // Plan-movement actions for each company
  actions.push(...planMovementActions(state, playerId));

  // Transfer-item actions (move items between characters at the same site)
  actions.push(...transferItemActions(state, playerId));

  // Store-item actions (store items at matching sites)
  actions.push(...storeItemActions(state, playerId));

  // Split-company actions (move GI character + followers to a new company)
  actions.push(...splitCompanyActions(state, playerId));

  // Move-to-company actions (move GI character + followers to an existing company at same site)
  actions.push(...moveToCompanyActions(state, playerId));

  // Merge-companies actions (join entire company into another at same site)
  actions.push(...mergeCompaniesActions(state, playerId));

  // Fetch-from-sideboard actions (tap avatar to bring cards from sideboard)
  actions.push(...fetchFromSideboardActions(state, playerId));

  // Card-granted sideboard self-relocation (Terror Heralds Doom ba-78 et al.):
  // a card in the sideboard may bring itself into the play deck.
  actions.push(...cardSideboardToDeckActions(state, playerId));

  // Grant-action activations from attached hazards (e.g. Foolish Words removal)
  actions.push(...grantedActionActivations(state, playerId));

  // Discard-to-effect abilities on the player's in-play factions
  // (e.g. A Panoply of Wings wh-37)
  actions.push(...inPlayFactionGrantActions(state, playerId));

  // Sage-tap ring tests granted by the company's current site (e.g. Mount Doom)
  actions.push(...siteSageRingTestActivations(state, playerId));

  actions.push({ action: { type: 'pass', player: playerId }, viable: true });
  return actions;
}

/**
 * Emit `test-ring-at-site` activations for the `sage-tap-ring-test` site-rule
 * (e.g. Mount Doom, le-393: "Any sage may tap to test a ring at this site,
 * modifying the result by -3.").
 *
 * For each of the player's companies whose current site declares the rule,
 * collect the gold-ring items borne by characters in that company and offer
 * one activation per (untapped sage, gold-ring) pair. The sage need not bear
 * the ring — like Gandalf, any sage may test a ring borne anywhere in the
 * company. Tapping the sage is the cost; the test itself (roll, discard,
 * special-ring offer) reuses the shared `gold-ring-test` resolution.
 */
export function siteSageRingTestActivations(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player) return [];

  const actions: EvaluatedAction[] = [];
  for (const company of player.companies) {
    if (!company.currentSite) continue;
    const siteDefId = resolveInstanceId(state, company.currentSite.instanceId);
    if (!siteDefId) continue;
    const siteDef = defById(state, siteDefId);
    if (!siteDef || !isSiteCard(siteDef) || !siteDef.effects) continue;
    const rule = siteDef.effects.find(
      e => e.type === 'site-rule' && (e as { rule?: string }).rule === 'sage-tap-ring-test',
    );
    if (!rule) continue;

    // Gold-ring items borne by any character in this company.
    const ringInstanceIds: CardInstanceId[] = [];
    for (const charInstId of company.characters) {
      const char = player.characters[charInstId];
      if (!char) continue;
      for (const item of char.items) {
        const itemDef = defById(state, item.definitionId);
        if (itemDef && 'subtype' in itemDef && (itemDef as { subtype?: string }).subtype === 'gold-ring') {
          ringInstanceIds.push(item.instanceId);
        }
      }
    }
    if (ringInstanceIds.length === 0) {
      logDetail(`sage-tap-ring-test at ${siteDef.name}: no gold-ring items borne in company ${company.id as string}`);
      continue;
    }

    // One activation per untapped sage × gold-ring.
    for (const charInstId of company.characters) {
      const sage = player.characters[charInstId];
      if (!sage || sage.status !== CardStatus.Untapped) continue;
      const sageDef = defById(state, sage.definitionId);
      if (!sageDef || !isCharacterCard(sageDef)) continue;
      const skills = [...(sageDef.skills as readonly string[] ?? []), ...getItemGrantedSkills(state, sage)];
      if (!skills.includes('sage')) continue;
      for (const ringInstanceId of ringInstanceIds) {
        logDetail(`sage-tap-ring-test at ${siteDef.name}: ${sageDef.name} may tap to test a gold ring (modifier ${formatSignedNumber((rule as { rollModifier: number }).rollModifier)})`);
        actions.push({
          action: {
            type: 'test-ring-at-site',
            player: playerId,
            characterId: charInstId,
            targetCardId: ringInstanceId,
          },
          viable: true,
        });
      }
    }
  }
  return actions;
}

/**
 * Scans all characters owned by the player for `grant-action` effects
 * on their attached hazards, items, allies, and the character card itself.
 * Returns activate actions for each available granted ability whose
 * cost can be paid.
 *
 * Currently supports:
 * - `remove-self-on-roll` — character taps, rolls 2d6, on success the
 *   source card is discarded (e.g. Foolish Words).
 * - `test-gold-ring` — character taps to test a gold ring item in their
 *   company; rolls 2d6, gold ring is discarded (e.g. Gandalf).
 * - `gwaihir-special-movement` — discard the ally to grant the company
 *   special movement to any non-Shadow-land/Dark-domain/Under-deeps site.
 *   Requires company size ≤ 2.
 * - `untap-bearer` — discard an item to untap its bearer. Bearer must be
 *   tapped.
 * - `extra-region-movement` — discard an item during organization to grant
 *   the bearer's company +1 max region distance for movement this turn.
 */
export function grantedActionActivations(state: GameState, playerId: PlayerId, phaseFilter?: GrantActionPhaseFilter): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player) return [];

  const actions: EvaluatedAction[] = [];

  for (const [charId, char] of characterEntries(player)) {
    // Collect grant-action effects from hazards attached to this character
    for (const hazard of char.hazards) {
      const grantActions = extractGrantActions(state, hazard.definitionId);
      for (const effect of grantActions) {
        if (phaseFilter && !matchesPhaseFilter(effect, phaseFilter)) continue;
        const hazardDef = defById(state, hazard.definitionId);
        // Rule 10.08: only cards that carry the 'corruption' game keyword
        // (or have cardType 'hazard-corruption') qualify for the no-tap −3
        // removal variant. Foolish Words, Rebel-talk etc. use the same
        // remove-self-on-roll mechanic but are not Corruption cards.
        const hazardKeywords = hazardDef && 'keywords' in hazardDef
          ? (hazardDef as { keywords?: readonly string[] }).keywords
          : undefined;
        const isCorruptionRemoval = effect.action === 'remove-self-on-roll'
          && (hazardDef?.cardType === 'hazard-corruption'
              || hazardKeywords?.includes('corruption') === true);
        // METD §7 / rule 10.08: once a no-tap removal attempt has been
        // made on this character+corruption-card pair, no further
        // attempts (tap or no-tap) are allowed for the rest of the turn.
        const removalLocked = isCorruptionRemoval && state.activeConstraints.some(c =>
          c.kind.type === 'corruption-removal-locked'
          && c.kind.characterId === charId
          && c.kind.corruptionInstanceId === hazard.instanceId,
        );
        if (removalLocked) {
          const charDef = defById(state, char.definitionId);
          logDetail(`Grant-action ${effect.action} on ${hazardDef?.name ?? '?'}: ${charDef?.name ?? '?'} corruption-removal locked this turn`);
          continue;
        }

        // `sage-in-company` cost: a different character — an untapped
        // sage in the bearer's company — pays the tap, not the bearer.
        // One action per eligible sage (e.g. Dragon's Curse: "a sage in
        // the target character's company may tap to attempt to remove
        // this card"). Handled here and we skip the later tap=bearer
        // branches for this effect.
        if (effect.cost.tap === 'sage-in-company') {
          const bearerCompany = findCharacterCompany(player.companies, charId);
          if (!bearerCompany) {
            logDetail(`Grant-action ${effect.action} on ${hazardDef?.name ?? '?'}: bearer has no company`);
            continue;
          }
          let emitted = 0;
          for (const companionId of bearerCompany.characters) {
            const companion = player.characters[companionId];
            if (!companion) continue;
            if (companion.status !== CardStatus.Untapped) continue;
            const companionDef = defById(state, companion.definitionId);
            if (!companionDef || !isCharacterCard(companionDef)) continue;
            if (![...(companionDef.skills as readonly string[] ?? []), ...getItemGrantedSkills(state, companion)].includes('sage')) continue;
            logDetail(`Grant-action ${effect.action} available: ${companionDef.name} (sage) can tap to activate (source: ${hazardDef?.name ?? '?'})`);
            actions.push({
              action: {
                type: 'activate-granted-action',
                player: playerId,
                characterId: companionId,
                sourceCardId: hazard.instanceId,
                sourceCardDefinitionId: hazard.definitionId,
                actionId: effect.action,
                rollThreshold: rollThresholdFor(effect),
              },
              viable: true,
            });
            emitted++;
          }
          if (emitted === 0) {
            logDetail(`Grant-action ${effect.action} on ${hazardDef?.name ?? '?'}: no eligible untapped sage in bearer's company`);
          }
          continue;
        }

        // Check cost: if tap is "bearer", character must be untapped
        if (!canPayCost(effect.cost, char)) {
          const charDef = defById(state, char.definitionId);
          logDetail(`Grant-action ${effect.action} on ${hazardDef?.name ?? '?'}: ${charDef?.name ?? '?'} is tapped, cannot activate`);
          // Fall through to consider the no-tap variant below — the
          // character being tapped doesn't block it.
        } else if (effect.when) {
          const charDefForCtx = defById(state, char.definitionId);
          const charDefCard = charDefForCtx && isCharacterCard(charDefForCtx) ? charDefForCtx : undefined;
          const company = findCharacterCompany(player.companies, charId);
          const ctx = buildGrantActionContext(state, char, charDefCard, company, player);
          if (!matchesCondition(effect.when, ctx)) {
            logDetail(`Grant-action ${effect.action}: when condition failed on ${charDefCard?.name ?? '?'}`);
            // Skip the standard variant below; do still consider no-tap.
          }
        }

        // Standard tap-and-roll variant — emitted only if the bearer
        // is untapped (cost.tap=bearer satisfied).
        if (canPayCost(effect.cost, char)) {
          const charDef = defById(state, char.definitionId);
          logDetail(`Grant-action ${effect.action} available: ${charDef?.name ?? '?'} can tap to activate (source: ${hazardDef?.name ?? '?'})`);
          actions.push({
            action: {
              type: 'activate-granted-action',
              player: playerId,
              characterId: charId,
              sourceCardId: hazard.instanceId,
              sourceCardDefinitionId: hazard.definitionId,
              actionId: effect.action,
              rollThreshold: rollThresholdFor(effect),
            },
            viable: true,
          });
        }

        // METD §7 / rule 10.08: also offer the no-tap variant for
        // corruption-removal grant actions. Available regardless of
        // bearer's tap state; first use locks subsequent attempts.
        if (isCorruptionRemoval) {
          const charDef = defById(state, char.definitionId);
          logDetail(`Grant-action ${effect.action}-no-tap available: ${charDef?.name ?? '?'} may roll without tapping at -3 (source: ${hazardDef?.name ?? '?'})`);
          actions.push({
            action: {
              type: 'activate-granted-action',
              player: playerId,
              characterId: charId,
              sourceCardId: hazard.instanceId,
              sourceCardDefinitionId: hazard.definitionId,
              actionId: effect.action,
              rollThreshold: rollThresholdFor(effect),
              noTap: true,
            },
            viable: true,
          });
        }
      }
    }

    // Collect grant-action effects from the character card itself
    const charDef = defById(state, char.definitionId);
    if (charDef && 'effects' in charDef) {
      const charEffects = (charDef as { effects?: readonly import('../../types/effects.js').CardEffect[] }).effects;
      if (charEffects) {
        for (const effect of charEffects) {
          if (effect.type !== 'grant-action') continue;
          if (phaseFilter && !matchesPhaseFilter(effect, phaseFilter)) continue;

          // Check cost: if tap is "self", the character must be untapped
          if (!canPayCost(effect.cost, char)) {
            logDetail(`Grant-action ${effect.action} on ${charDef.name}: character is tapped, cannot activate`);
            continue;
          }

          // Evaluate the `when` condition against the grant-action context.
          if (effect.when) {
            const charDefCard = isCharacterCard(charDef) ? charDef : undefined;
            const company = findCharacterCompany(player.companies, charId);
            const ctx = buildGrantActionContext(state, char, charDefCard, company, player);
            if (!matchesCondition(effect.when, ctx)) {
              logDetail(`Grant-action ${effect.action} on ${charDef.name}: when condition failed`);
              continue;
            }
          }

          // untap-companion-at-site: enumerate tapped companions in the bearer's
          // company whose definition ID appears in the effect's `companionIds` list.
          // Only use this legacy path when `effect.targets` is absent (older data format).
          if (effect.action === 'untap-companion-at-site' && !effect.targets) {
            const companionIds = (effect as { companionIds?: readonly string[] }).companionIds ?? [];
            const company = findCharacterCompany(player.companies, charId);
            if (!company) {
              logDetail(`Grant-action ${effect.action} on ${charDef.name}: bearer has no company`);
              continue;
            }
            let emitted = 0;
            for (const compId of company.characters) {
              if (compId === charId) continue;
              const companion = player.characters[compId];
              if (!companion || companion.status !== CardStatus.Tapped) continue;
              const compDef = defById(state, companion.definitionId);
              if (!compDef || !isCharacterCard(compDef)) continue;
              if (!companionIds.includes(compDef.id as string)) continue;
              logDetail(`Grant-action ${effect.action} available: ${charDef.name} can tap to untap ${compDef.name}`);
              actions.push({
                action: {
                  type: 'activate-granted-action',
                  player: playerId,
                  characterId: charId,
                  sourceCardId: char.instanceId,
                  sourceCardDefinitionId: char.definitionId,
                  actionId: effect.action,
                  rollThreshold: rollThresholdFor(effect),
                  targetCardId: companion.instanceId,
                },
                viable: true,
              });
              emitted++;
            }
            if (emitted === 0) {
              logDetail(`Grant-action ${effect.action} on ${charDef.name}: no tapped companions in company`);
            }
            continue;
          }

          // Per-target enumeration: emit one activation per candidate in
          // the declared scope (e.g. Gandalf's gold-ring test).
          if (effect.targets) {
            // Player-companies scope: enumerate all companies and emit one activation per company.
            if (effect.targets.scope === 'player-companies') {
              const companies = player.companies;
              if (companies.length === 0) {
                logDetail(`Grant-action ${effect.action} on ${charDef.name}: player has no companies`);
                continue;
              }
              for (const company of companies) {
                logDetail(`Grant-action ${effect.action} available: ${charDef.name} can activate targeting company ${company.id as string}`);
                actions.push({
                  action: {
                    type: 'activate-granted-action',
                    player: playerId,
                    characterId: charId,
                    sourceCardId: char.instanceId,
                    sourceCardDefinitionId: char.definitionId,
                    actionId: effect.action,
                    rollThreshold: rollThresholdFor(effect),
                    targetCompanyId: company.id,
                  },
                  viable: true,
                });
              }
              continue;
            }

            const candidates = enumerateGrantActionTargets(state, player, charId, effect.targets);
            if (candidates.length === 0) {
              logDetail(`Grant-action ${effect.action} on ${charDef.name}: no targets in scope '${effect.targets.scope}'`);
              continue;
            }
            for (const target of candidates) {
              const targetDef = defById(state, target.definitionId);
              logDetail(`Grant-action ${effect.action} available: ${charDef.name} can tap to target ${targetDef?.name ?? '?'}`);
              actions.push({
                action: {
                  type: 'activate-granted-action',
                  player: playerId,
                  characterId: charId,
                  sourceCardId: char.instanceId,
                  sourceCardDefinitionId: char.definitionId,
                  actionId: effect.action,
                  rollThreshold: rollThresholdFor(effect),
                  targetCardId: target.instanceId,
                },
                viable: true,
              });
            }
            continue;
          }

          // Generic character grant-action (future use)
          logDetail(`Grant-action ${effect.action} available: ${charDef.name} can activate`);
          actions.push({
            action: {
              type: 'activate-granted-action',
              player: playerId,
              characterId: charId,
              sourceCardId: char.instanceId,
              sourceCardDefinitionId: char.definitionId,
              actionId: effect.action,
              rollThreshold: rollThresholdFor(effect),
            },
            viable: true,
          });
        }
      }
    }

    // Scan allies attached to this character for grant-action effects
    for (const ally of char.allies) {
      const grantActions = extractGrantActions(state, ally.definitionId);
      for (const effect of grantActions) {
        if (phaseFilter && !matchesPhaseFilter(effect, phaseFilter)) continue;
        // A `tap: self` cost (e.g. Mistress Lobelia dm-178) requires the ally
        // itself to be untapped; `discard: self` and cost-free abilities are
        // always payable (canPayCost returns true when there is no tap cost).
        if (!canPayCost(effect.cost, char, ally)) {
          const def = defById(state, ally.definitionId);
          logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: cost not payable (ally tapped)`);
          continue;
        }
        const charDefForCtx = defById(state, char.definitionId);
        const charDefCard = charDefForCtx && isCharacterCard(charDefForCtx) ? charDefForCtx : undefined;
        const company = findCharacterCompany(player.companies, charId);
        if (effect.when) {
          const ctx = buildGrantActionContext(state, char, charDefCard, company, player);
          if (!matchesCondition(effect.when, ctx)) {
            const def = defById(state, ally.definitionId);
            logDetail(`Grant-action ${effect.action}: when condition failed on ${charDefCard?.name ?? '?'} (source ${def?.name ?? '?'})`);
            continue;
          }
        }

        const charDef = defById(state, char.definitionId);
        const def = defById(state, ally.definitionId);
        logDetail(`Grant-action ${effect.action} available: ${charDef?.name ?? '?'} can discard ${def?.name ?? '?'} to activate`);

        actions.push({
          action: {
            type: 'activate-granted-action',
            player: playerId,
            characterId: charId,
            sourceCardId: ally.instanceId,
            sourceCardDefinitionId: ally.definitionId,
            actionId: effect.action,
            rollThreshold: rollThresholdFor(effect),
          },
          viable: true,
        });
      }
    }

    // Scan items attached to this character for grant-action effects
    for (const item of char.items) {
      const grantActions = extractGrantActions(state, item.definitionId);
      for (const effect of grantActions) {
        if (phaseFilter && !matchesPhaseFilter(effect, phaseFilter)) continue;
        if (!canPayCost(effect.cost, char, item)) {
          const def = defById(state, item.definitionId);
          logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: cost not payable (item or bearer tapped)`);
          continue;
        }

        const charDefForCtx = defById(state, char.definitionId);
        const charDefCard = charDefForCtx && isCharacterCard(charDefForCtx) ? charDefForCtx : undefined;
        const company = findCharacterCompany(player.companies, charId);
        if (effect.when) {
          const ctx = buildGrantActionContext(state, char, charDefCard, company, player);
          if (!matchesCondition(effect.when, ctx)) {
            const def = defById(state, item.definitionId);
            logDetail(`Grant-action ${effect.action}: when condition failed on ${charDefCard?.name ?? '?'} (source ${def?.name ?? '?'})`);
            continue;
          }
        }

        const def = defById(state, item.definitionId);
        const costLabel = effect.cost.tap === 'self' ? 'tap' : 'discard';

        // `place-item-on-character` (The Forge-master wh-117): tap the bearer to
        // place a qualifying minor item — fetched from the player's discard pile,
        // sideboard, or hand — onto any of the player's characters at the bearer's
        // site (the recipient is not tapped). Emit one activation per (item,
        // recipient) pair so the player picks both via the chosen action.
        if (effect.apply?.type === 'place-item-on-character') {
          if (!company?.currentSite) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: bearer not at a site`);
            continue;
          }
          const siteDefId = company.currentSite.definitionId as string;
          const zones = effect.apply.fetchFrom ?? ['discard-pile', 'sideboard', 'hand'];
          const itemFilter = effect.apply.filter;
          const zoneItemIds: CardInstanceId[] = [];
          for (const zone of zones) {
            const pile = zone === 'discard-pile' ? player.discardPile
              : zone === 'sideboard' ? player.sideboard
                : zone === 'hand' ? player.hand
                  : [];
            for (const c of pile) {
              const cdef = defById(state, c.definitionId);
              if (!cdef || !isItemCard(cdef)) continue;
              if (itemFilter && !matchesDefinition(cdef, itemFilter)) continue;
              zoneItemIds.push(c.instanceId);
            }
          }
          if (zoneItemIds.length === 0) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: no qualifying item in discard/sideboard/hand`);
            continue;
          }
          const recipients: CardInstanceId[] = [];
          for (const co of player.companies) {
            if (!co.currentSite || (co.currentSite.definitionId as string) !== siteDefId) continue;
            for (const memberId of co.characters) recipients.push(memberId);
          }
          for (const itemInstId of zoneItemIds) {
            for (const recipientId of recipients) {
              actions.push({
                action: {
                  type: 'activate-granted-action',
                  player: playerId,
                  characterId: charId,
                  sourceCardId: item.instanceId,
                  sourceCardDefinitionId: item.definitionId,
                  actionId: effect.action,
                  rollThreshold: rollThresholdFor(effect),
                  targetCardId: itemInstId,
                  recipientCharacterId: recipientId,
                },
                viable: true,
              });
            }
          }
          logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: offered ${zoneItemIds.length} item(s) × ${recipients.length} recipient(s) at site`);
          continue;
        }

        // `heal-company-character` targets a wounded character in the bearer's
        // company — emit one action per wounded (inverted) candidate, carrying
        // the chosen target on `targetCardId`. If no one is wounded, the
        // ability is not offered. Used by Foul-smelling Paste (le-310).
        if (effect.action === 'heal-company-character') {
          if (!company) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: bearer not in any company`);
            continue;
          }
          const wounded: import('../../index.js').CharacterInPlay[] = [];
          for (const compCharId of company.characters) {
            const compChar = player.characters[compCharId];
            if (compChar && compChar.status === CardStatus.Inverted) wounded.push(compChar);
          }
          if (wounded.length === 0) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: no wounded character in ${charDef?.name ?? '?'}'s company`);
            continue;
          }
          for (const target of wounded) {
            const targetDef = defById(state, target.definitionId);
            logDetail(`Grant-action ${effect.action} available: ${charDef?.name ?? '?'} can ${costLabel} ${def?.name ?? '?'} to heal ${targetDef?.name ?? '?'}`);
            actions.push({
              action: {
                type: 'activate-granted-action',
                player: playerId,
                characterId: charId,
                sourceCardId: item.instanceId,
                sourceCardDefinitionId: item.definitionId,
                actionId: effect.action,
                rollThreshold: rollThresholdFor(effect),
                targetCardId: target.instanceId,
              },
              viable: true,
            });
          }
          continue;
        }

        // `force-discard-dwarf-at-site` targets each Dwarf character at the
        // bearer's current site (any company, any player). Emit one action per
        // Dwarf. If there are no Dwarves at the same site, the ability is not
        // offered. Used by The Arkenstone (le-418).
        if (effect.action === 'force-discard-dwarf-at-site') {
          if (!company) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: bearer not in any company`);
            continue;
          }
          const siteDef = company.currentSite
            ? defById(state, company.currentSite.definitionId)
            : undefined;
          const siteName = siteDef?.name ?? '';
          if (!siteName) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: bearer has no current site`);
            continue;
          }
          const dwarfTargets: { instanceId: import('../../index.js').CardInstanceId; name: string }[] = [];
          for (const p of state.players) {
            for (const co of p.companies) {
              const coSiteDef = co.currentSite
                ? defById(state, co.currentSite.definitionId)
                : undefined;
              const coSiteName = coSiteDef?.name ?? '';
              if (coSiteName !== siteName) continue;
              for (const coCharId of co.characters) {
                const coChar = p.characters[coCharId];
                if (!coChar) continue;
                const coCharDef = defById(state, coChar.definitionId);
                if (!coCharDef || !isCharacterCard(coCharDef)) continue;
                if (coCharDef.race !== 'dwarf') continue;
                dwarfTargets.push({ instanceId: coCharId, name: coCharDef.name });
              }
            }
          }
          if (dwarfTargets.length === 0) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: no Dwarf at site ${siteName}`);
            continue;
          }
          for (const { instanceId: targetId, name: targetName } of dwarfTargets) {
            logDetail(`Grant-action ${effect.action} available: ${charDef?.name ?? '?'} can ${costLabel} ${def?.name ?? '?'} to discard ${targetName}`);
            actions.push({
              action: {
                type: 'activate-granted-action',
                player: playerId,
                characterId: charId,
                sourceCardId: item.instanceId,
                sourceCardDefinitionId: item.definitionId,
                actionId: effect.action,
                rollThreshold: rollThresholdFor(effect),
                targetCardId: targetId,
              },
              viable: true,
            });
          }
          continue;
        }

        // `auto-pass-corruption-check` (Ancient Black Axe as-122): tap this
        // item to grant a character at the bearer's current site (any
        // company, any player, excluding the bearer) an auto-pass shield on
        // its next corruption check. Emit one action per other character at
        // the site. If nobody else is at the site, the ability is not
        // offered.
        if (effect.action === 'auto-pass-corruption-check') {
          if (!company?.currentSite) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: bearer not at a site`);
            continue;
          }
          const siteDefId = company.currentSite.definitionId as string;
          const siteTargets: { instanceId: import('../../index.js').CardInstanceId; name: string }[] = [];
          for (const p of state.players) {
            for (const co of p.companies) {
              if (!co.currentSite || (co.currentSite.definitionId as string) !== siteDefId) continue;
              for (const memberId of co.characters) {
                if (memberId === charId) continue;
                const member = p.characters[memberId];
                if (!member) continue;
                const memberDef = defById(state, member.definitionId);
                siteTargets.push({ instanceId: memberId, name: memberDef?.name ?? (memberId as string) });
              }
            }
          }
          if (siteTargets.length === 0) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: no other character at the bearer's site`);
            continue;
          }
          for (const { instanceId: targetId, name: targetName } of siteTargets) {
            logDetail(`Grant-action ${effect.action} available: ${charDef?.name ?? '?'} can ${costLabel} ${def?.name ?? '?'} to make ${targetName} automatically pass a corruption check`);
            actions.push({
              action: {
                type: 'activate-granted-action',
                player: playerId,
                characterId: charId,
                sourceCardId: item.instanceId,
                sourceCardDefinitionId: item.definitionId,
                actionId: effect.action,
                rollThreshold: rollThresholdFor(effect),
                targetCardId: targetId,
              },
              viable: true,
            });
          }
          continue;
        }

        // `boost-company-influence` (When You Know More dm-163): tap the bearer
        // (a sage carrying the enchantment) to grant +2 to one influence attempt
        // by another untapped character in his company; the bearer then makes a
        // corruption check. Emit one activation per eligible company-mate, carried
        // on `targetCardId`. The bearer is excluded — paying the tap cost leaves
        // it unable to make the boosted attempt — and tapped company-mates cannot
        // make an influence attempt, so they are skipped too.
        if (effect.action === 'boost-company-influence') {
          if (!company) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: bearer not in any company`);
            continue;
          }
          const boostTargets: { instanceId: import('../../index.js').CardInstanceId; name: string }[] = [];
          for (const compCharId of company.characters) {
            if (compCharId === charId) continue;
            const compChar = player.characters[compCharId];
            if (!compChar || compChar.status !== CardStatus.Untapped) continue;
            const compCharDef = defById(state, compChar.definitionId);
            boostTargets.push({ instanceId: compCharId, name: compCharDef?.name ?? (compCharId as string) });
          }
          if (boostTargets.length === 0) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: no other untapped character in ${charDef?.name ?? '?'}'s company to boost`);
            continue;
          }
          for (const { instanceId: targetId, name: targetName } of boostTargets) {
            logDetail(`Grant-action ${effect.action} available: ${charDef?.name ?? '?'} can tap ${def?.name ?? '?'} to give ${targetName} +2 to an influence attempt`);
            actions.push({
              action: {
                type: 'activate-granted-action',
                player: playerId,
                characterId: charId,
                sourceCardId: item.instanceId,
                sourceCardDefinitionId: item.definitionId,
                actionId: effect.action,
                rollThreshold: rollThresholdFor(effect),
                targetCardId: targetId,
              },
              viable: true,
            });
          }
          continue;
        }

        logDetail(`Grant-action ${effect.action} available: ${charDef?.name ?? '?'} can ${costLabel} ${def?.name ?? '?'} to activate`);

        actions.push({
          action: {
            type: 'activate-granted-action',
            player: playerId,
            characterId: charId,
            sourceCardId: item.instanceId,
            sourceCardDefinitionId: item.definitionId,
            actionId: effect.action,
            rollThreshold: rollThresholdFor(effect),
          },
          viable: true,
        });
      }
    }
  }

  return actions;
}

/**
 * Grant-actions carried by the player's *in-play factions* (cards sitting in
 * `cardsInPlay`, not attached to any character). Currently only the
 * discard-self / add-constraint shape is emitted — A Panoply of Wings (wh-37):
 * "Discard this faction to make information playable at such a site". Offered
 * during the active player's organization and site phases; there is no
 * activating character, so `characterId` self-references the faction instance
 * (the reducer routes bearer-less sources to `handleInPlayCardGrantAction`).
 */
export function inPlayFactionGrantActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player) return [];
  const actions: EvaluatedAction[] = [];
  for (const cip of player.cardsInPlay) {
    const def = defById(state, cip.definitionId);
    if (!def || !isFactionCard(def)) continue;
    for (const effect of getCardEffects(def)) {
      if (effect.type !== 'grant-action') continue;
      if (effect.cost.discard !== 'self') continue;
      if (effect.apply?.type !== 'add-constraint') continue;
      logDetail(`In-play faction grant-action ${effect.action} available: discard ${def.name} in play`);
      actions.push({
        action: {
          type: 'activate-granted-action',
          player: playerId,
          characterId: cip.instanceId,
          sourceCardId: cip.instanceId,
          sourceCardDefinitionId: cip.definitionId,
          actionId: effect.action,
          rollThreshold: 0,
        },
        viable: true,
      });
    }
  }
  return actions;
}

/**
 * Builds the DSL context used to evaluate a grant-action effect's
 * {@link EffectBase.when} condition. Exposes `bearer` (the character
 * holding the source card) and `company` (the company that character
 * belongs to, with derived booleans for planned movement and extra
 * region distance).
 *
 * New grant-action preconditions should be expressed as DSL `when`
 * clauses against this context instead of hardcoded action-ID branches
 * in {@link grantedActionActivations}.
 */
export function buildGrantActionContext(
  state: GameState,
  char: import('../../index.js').CharacterInPlay,
  charDef: import('../../index.js').CharacterCard | undefined,
  company: import('../../index.js').Company | undefined,
  player?: import('../../index.js').PlayerState,
): Record<string, unknown> {
  const statusStr = cardStatusToName(char.status);

  const canUsePalantir = hasPlayFlag(charDef, 'can-use-palantir') ||
    char.items.some(item => {
      const itemDef = defById(state, item.definitionId)!;
      return 'effects' in itemDef && hasPlayFlag(itemDef, 'can-use-palantir');
    });

  const siteDef = company?.currentSite
    ? defById(state, company.currentSite.definitionId)
    : undefined;
  const siteType = siteDef && 'siteType' in siteDef
    ? (siteDef as { siteType: string }).siteType
    : '';
  const atHaven = siteType === 'haven';

  // `As your Ringwraith` gating: true only when this character is the player's
  // own revealed avatar (a Ringwraith follower controlled by another avatar is
  // an avatar card but is NOT the player's Ringwraith — see findPlayerAvatar).
  const isRevealedAvatar = player
    ? findPlayerAvatar(state, player)?.instanceId === char.instanceId
    : false;

  const bearer = {
    status: statusStr,
    name: charDef?.name ?? '',
    race: charDef?.race ?? '',
    skills: charDef?.skills ?? [],
    canUsePalantir: !!canUsePalantir,
    siteType,
    atHaven,
    isRevealedAvatar,
  };

  const companyCtx = company ? {
    size: companyEffectiveSize(state, company),
    hasPlannedMovement: company.destinationSite !== null || !!company.specialMovement,
    hasExtraRegionDistance: !!company.extraRegionDistance,
  } : null;
  const playerCtx = player ? {
    playDeckSize: player.playDeck.length,
  } : null;
  const siteName = siteDef?.name ?? '';
  const siteIsTapped = company?.currentSite?.status === CardStatus.Tapped;
  const hasDragonAutoAttack = siteDef && 'automaticAttacks' in siteDef
    ? ((siteDef as { automaticAttacks?: readonly { creatureType: string }[] }).automaticAttacks ?? [])
        .some(a => a.creatureType === 'Dragon')
    : false;
  const siteCtx = siteName ? {
    type: siteType,
    region: (siteDef as { region?: string } | undefined)?.region ?? '',
    hasOneRing: siteHasItemWithKeyword(state, siteName, 'the-one-ring'),
    isTapped: siteIsTapped,
    hasDragonAutoAttack,
  } : null;
  return { bearer, company: companyCtx, player: playerCtx, site: siteCtx };
}

/**
 * Returns true when any character in any company at the same site
 * (matched by site *name* — so opposing-alignment copies of the same
 * physical location count as co-located) holds an item whose card
 * definition carries the given keyword. Used by grant-action conditions
 * to gate abilities on the presence of a specific item at the ally's
 * site (e.g. Stinker's ring-discard ability triggers when The One Ring,
 * tagged `the-one-ring`, is at the same site).
 */
function siteHasItemWithKeyword(
  state: GameState,
  siteName: string,
  keyword: string,
): boolean {
  for (const p of state.players) {
    for (const company of p.companies) {
      const compSite = company.currentSite
        ? defById(state, company.currentSite.definitionId)
        : undefined;
      const compSiteName = compSite?.name ?? '';
      if (compSiteName !== siteName) continue;
      for (const charInstId of company.characters) {
        const char = p.characters[charInstId];
        if (!char) continue;
        for (const item of char.items) {
          const def = defById(state, item.definitionId);
          if (def && 'keywords' in def && (def as { keywords?: readonly string[] }).keywords?.includes(keyword)) return true;
        }
      }
    }
  }
  return false;
}

/**
 * Returns true when an active `site-resource-unlocked` constraint owned by
 * `playerId` makes resource category `subtype` (e.g. `"information"`)
 * playable at `siteDef`. A constraint may select matching sites either by a
 * fixed site type (Records Unread as-130 mode B: "Information at any
 * Shadow-hold") or by a compound `siteCondition` evaluated against the site
 * context (A Panoply of Wings wh-37: "Information at any non-Haven,
 * non-Shadow-hold, non-Dark-hold site in a Wilderness"). Lasts for the turn.
 */
function isSiteResourceUnlocked(
  state: GameState,
  playerId: PlayerId,
  siteDef: SiteCard,
  subtype: string,
): boolean {
  const regionType = siteRegionTypeOf(state, siteDef);
  return state.activeConstraints.some(c => {
    if (c.kind.type !== 'site-resource-unlocked') return false;
    if (c.kind.subtype !== subtype) return false;
    if (c.target.kind !== 'player' || c.target.playerId !== playerId) return false;
    if (c.kind.siteType) return c.kind.siteType === siteDef.siteType;
    if (c.kind.siteCondition) {
      return matchesCondition(c.kind.siteCondition, {
        site: {
          name: siteDef.name,
          siteType: siteDef.siteType,
          regionType,
          region: siteDef.region,
        },
      });
    }
    return false;
  });
}

/**
 * Enumerates candidate target cards for a grant-action's `targets`
 * descriptor. Walks the declared scope relative to the bearer character
 * and applies the optional DSL filter to each candidate's card
 * definition.
 *
 * Returns `{ instanceId, definitionId }` pairs — one per match.
 */
function enumerateGrantActionTargets(
  state: GameState,
  player: { readonly companies: readonly import('../../index.js').Company[]; readonly characters: { readonly [key: string]: import('../../index.js').CharacterInPlay } },
  charId: CardInstanceId,
  targets: import('../../types/effects.js').GrantActionTargets,
): readonly { instanceId: CardInstanceId; definitionId: import('../../index.js').CardDefinitionId }[] {
  const matches: { instanceId: CardInstanceId; definitionId: import('../../index.js').CardDefinitionId }[] = [];

  if (targets.scope === 'company-items') {
    const company = findCharacterCompany(player.companies, charId);
    if (!company) return [];
    for (const compCharId of company.characters) {
      const compChar = player.characters[compCharId as string];
      if (!compChar) continue;
      for (const item of compChar.items) {
        const itemDef = defById(state, item.definitionId);
        if (!itemDef) continue;
        if (targets.filter && !matchesDefinition(itemDef, targets.filter)) continue;
        matches.push(toCardInstance(item));
      }
    }
  }

  if (targets.scope === 'characters-at-site') {
    // Find the bearer's current site
    const bearerCompany = findCharacterCompany(player.companies, charId);
    if (!bearerCompany?.currentSite) return [];
    const bearerSiteDefId = bearerCompany.currentSite.definitionId as string;
    const allowedDefIds = targets.definitionIds ?? [];

    // Scan all companies across both players for characters at the same site
    for (const p of state.players) {
      for (const company of p.companies) {
        if (!company.currentSite) continue;
        if ((company.currentSite.definitionId as string) !== bearerSiteDefId) continue;
        for (const memberId of company.characters) {
          // Exclude the bearer themselves
          if (memberId === charId) continue;
          const member = p.characters[memberId];
          if (!member) continue;
          // Restrict to specified definition IDs if given
          if (allowedDefIds.length > 0 && !allowedDefIds.includes(member.definitionId as string)) continue;
          // Only include tapped/inverted characters — untapping an already-untapped character is pointless
          if (member.status === CardStatus.Untapped) continue;
          if (targets.filter) {
            const memberDef = defById(state, member.definitionId);
            if (!memberDef || !matchesDefinition(memberDef, targets.filter)) continue;
          }
          matches.push({ instanceId: member.instanceId, definitionId: member.definitionId });
        }
      }
    }
  }

  return matches;
}

/**
 * Extracts grant-action effects from a card definition.
 */
function extractGrantActions(state: GameState, definitionId: import('../../index.js').CardDefinitionId) {
  return getCardEffects(defById(state, definitionId)).filter(
    (e): e is import('../../types/effects.js').GrantActionEffect =>
      // Corruption-check-window abilities (When I Know Anything td-166) are
      // emitted only by `modifyCorruptionCheckGrantActions` while a check is
      // awaiting its roll — never by the generic per-phase scanner.
      // End-of-turn-only abilities (Great Shadow ba-62) are emitted only by
      // the dedicated end-of-turn discard-pile fetch scanner
      // (`legal-actions/end-of-turn.ts`) — never here, so they don't leak
      // into the organization-phase default scan below.
      // Ally chain-cancel abilities (Tom Bombadil tw-350, Leaflock tw-265) are
      // emitted only by the dedicated M/H `emitAllyCancelChainActions` emitter —
      // a chain cancellation is meaningless outside an active chain, so keep it
      // out of the generic per-phase (including organization) scan.
      e.type === 'grant-action' && e.corruptionCheckWindow !== true && e.endOfTurnOnly !== true
        && e.apply?.type !== 'cancel-chain-entry',
  );
}

/**
 * Emit `activate-granted-action` activations for `corruptionCheckWindow`
 * grant-actions while a corruption check by `resolvingCharacterId` is
 * awaiting its roll. Shared by both corruption-check windows — the unified
 * pending resolution (`legal-actions/pending.ts`) and the Free Council
 * support window (`legal-actions/free-council.ts`).
 *
 * The bearer must be an untapped character in the **same company** as the
 * character making the check (the cost taps the bearer). One activation is
 * emitted per eligible bearer × matching grant-action; the resolving
 * character rides on `targetCardId` so the apply's `add-constraint` /
 * `enqueue-corruption-check` steps know which check to boost.
 *
 * Used by *When I Know Anything* (td-166): a sage taps to add +3 to one
 * corruption check by a character in his company, then makes a check himself.
 */
export function modifyCorruptionCheckGrantActions(
  state: GameState,
  playerId: PlayerId,
  resolvingCharacterId: CardInstanceId,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const player = playerById(state, playerId);
  if (!player) return actions;
  const company = findCharacterCompany(player.companies, resolvingCharacterId);
  if (!company) return actions;

  for (const charId of company.characters) {
    const bearer = player.characters[charId];
    if (!bearer) continue;
    // Cost taps the bearer — only untapped bearers may activate.
    if (bearer.status !== CardStatus.Untapped) continue;
    for (const item of bearer.items) {
      const def = defById(state, item.definitionId);
      const grant = getCardEffects(def).find(
        (e): e is import('../../types/effects.js').GrantActionEffect =>
          e.type === 'grant-action' && e.corruptionCheckWindow === true && !!e.apply,
      );
      if (!grant) continue;
      logDetail(`Corruption-check modifier available: ${def?.name ?? '?'} (bearer ${charId as string}) → boost check by ${resolvingCharacterId as string}`);
      actions.push({
        action: {
          type: 'activate-granted-action',
          player: playerId,
          characterId: charId,
          sourceCardId: item.instanceId,
          sourceCardDefinitionId: item.definitionId,
          actionId: grant.action,
          rollThreshold: 0,
          targetCardId: resolvingCharacterId,
        },
        viable: true,
      });
    }
  }
  return actions;
}

/**
 * Resolve the effective 2d6 threshold for a roll-based granted action.
 * Cards migrated to the generic `apply: roll-then-apply` shape carry
 * the threshold on the apply; legacy cards still expose it as
 * `effect.rollThreshold`. Returns 0 for non-roll actions.
 */
function rollThresholdFor(effect: import('../../types/effects.js').GrantActionEffect): number {
  if (effect.rollThreshold !== undefined) return effect.rollThreshold;
  if (effect.apply?.type === 'roll-then-apply' && typeof effect.apply.threshold === 'number') {
    return effect.apply.threshold;
  }
  return 0;
}

/**
 * Result of an end-of-org play eligibility check. When `eligible` is
 * false, `reason` carries a UI-friendly explanation of why the card
 * cannot currently be played. When `eligible` is true and the card has
 * a `play-target` effect, `eligibleTargets` lists every valid target
 * (e.g. each untapped scout in a company under the size cap) so the
 * action emitter can produce one play action per target.
 */
interface EndOfOrgEligibility {
  readonly eligible: boolean;
  readonly reason: string;
  /** One entry per valid target character. Empty when the card has no play-target. */
  readonly eligibleTargets: readonly CardInstanceId[];
}

/**
 * Checks whether an end-of-org card's `play-target` constraints are
 * satisfied by the active player's current companies. Character targeting
 * is driven entirely by the card's DSL `filter` condition plus an
 * optional `maxCompanySize` — there are no per-card branches here.
 */
export function endOfOrgEligibility(
  state: GameState,
  player: PlayerState,
  def: ResourceEventCard,
): EndOfOrgEligibility {
  const playTarget: PlayTargetEffect | undefined = def.effects?.find(
    (e): e is PlayTargetEffect => e.type === 'play-target',
  );
  if (!playTarget) return { eligible: true, reason: '', eligibleTargets: [] };
  if (playTarget.target !== 'character' && playTarget.target !== 'company') {
    return { eligible: true, reason: '', eligibleTargets: [] };
  }

  // Company targeting: collect eligible character IDs per qualifying company.
  // When a `filter` is present it is evaluated against a company-level context
  // (currently exposes `company.atHaven`).  When a tap cost is declared the
  // eligible targets are all untapped characters in qualifying companies (one
  // action per character, representing the tapper choice).  When there is no
  // tap cost, one representative character per qualifying company is returned so
  // the player can distinguish between multiple valid companies.
  if (playTarget.target === 'company') {
    const eligibleTargets: CardInstanceId[] = [];
    for (const company of player.companies) {
      // Evaluate optional company-level filter (e.g. company.atHaven for Great-road).
      if (playTarget.filter) {
        const siteDef = company.currentSite
          ? defById(state, company.currentSite.definitionId)
          : undefined;
        const siteType = siteDef && 'siteType' in siteDef
          ? (siteDef as { siteType: string }).siteType
          : '';
        const companyFilterCtx = { company: { atHaven: siteType === 'haven' } };
        if (!matchesCondition(playTarget.filter, companyFilterCtx)) continue;
      }
      if (playTarget.cost?.tap === 'character') {
        // Tap-cost: emit one action per untapped character (player chooses tapper).
        for (const charInstId of company.characters) {
          const char = player.characters[charInstId];
          if (!char || char.status !== CardStatus.Untapped) continue;
          eligibleTargets.push(charInstId);
        }
      } else {
        // No tap cost: use the first character as a company representative so
        // the emitter can generate one action per qualifying company.
        const firstChar = company.characters[0];
        if (firstChar) eligibleTargets.push(firstChar);
      }
    }
    if (eligibleTargets.length === 0) {
      return {
        eligible: false,
        reason: playTarget.cost?.tap === 'character'
          ? `${def.name} requires an untapped character in a company`
          : `${def.name} requires a company at the required location`,
        eligibleTargets: [],
      };
    }
    return { eligible: true, reason: '', eligibleTargets };
  }

  const eligibleTargets: CardInstanceId[] = [];
  let foundMatchingCharacter = false;
  for (const company of player.companies) {
    const matchesInCompany: CardInstanceId[] = [];
    for (const charInstId of company.characters) {
      const char = player.characters[charInstId];
      if (!char) continue;
      const charDef = defById(state, char.definitionId);
      if (!charDef || !isCharacterCard(charDef)) continue;
      if (playTarget.filter
          && !matchesCondition(playTarget.filter, buildTargetContext(state, char, player))) {
        continue;
      }
      matchesInCompany.push(charInstId);
    }
    if (matchesInCompany.length === 0) continue;
    foundMatchingCharacter = true;
    if (playTarget.maxCompanySize !== undefined) {
      const size = companyEffectiveSize(state, company);
      if (size > playTarget.maxCompanySize) continue;
    }
    eligibleTargets.push(...matchesInCompany);
  }
  if (eligibleTargets.length === 0) {
    if (!foundMatchingCharacter) {
      return { eligible: false, reason: `${def.name} requires a matching character`, eligibleTargets: [] };
    }
    return {
      eligible: false,
      reason: `${def.name} requires a company of size ≤ ${playTarget.maxCompanySize as number}`,
      eligibleTargets: [],
    };
  }
  return { eligible: true, reason: '', eligibleTargets };
}

/**
 * Returns the {@link PlayTargetEffect} for the given resource event card,
 * or undefined when the card does not declare one.
 */
export function getPlayTargetEffect(def: ResourceEventCard): PlayTargetEffect | undefined {
  return def.effects?.find((e): e is PlayTargetEffect => e.type === 'play-target');
}

/**
 * Collects all in-play card instance IDs across both players that match
 * the supplied `discard-in-play` filter. Searches both general in-play
 * cards ({@link PlayerState.cardsInPlay}, e.g. Eye of Sauron long-events,
 * non-attached permanent-events) and hazard cards attached to characters
 * (`character.hazards`, e.g. Foolish Words, Lure of the Senses). Without
 * the character-hazard pass, cards like Marvels Told would fail to
 * offer any attached hazard permanent-events as discard targets.
 */
export function collectDiscardInPlayTargets(
  state: GameState,
  filter: Condition,
): CardInstanceId[] {
  const targets: CardInstanceId[] = [];
  for (const p of state.players) {
    for (const c of p.cardsInPlay) {
      const cDef = defById(state, c.definitionId);
      if (cDef && matchesDefinition(cDef, filter)) {
        targets.push(c.instanceId);
      }
    }
    for (const charId of Object.keys(p.characters) as CardInstanceId[]) {
      const char = p.characters[charId];
      for (const haz of char.hazards) {
        const hDef = defById(state, haz.definitionId);
        if (hDef && matchesDefinition(hDef, filter)) {
          targets.push(haz.instanceId);
        }
      }
    }
  }
  return targets;
}

/**
 * Returns all {@link PlayOptionEffect}s declared on the given card.
 */
export function getPlayOptionEffects(def: ResourceEventCard): readonly PlayOptionEffect[] {
  return def.effects?.filter((e): e is PlayOptionEffect => e.type === 'play-option') ?? [];
}

/**
 * Maps a character's {@link CardStatus} to the string tokens used by
 * {@link PlayOptionEffect} `when` conditions.
 */
function statusToken(status: CardStatus): 'tapped' | 'untapped' | 'inverted' {
  switch (status) {
    case CardStatus.Tapped: return 'tapped';
    case CardStatus.Untapped: return 'untapped';
    case CardStatus.Inverted: return 'inverted';
  }
}

/**
 * Builds the matcher context used to evaluate a {@link PlayTargetEffect}'s
 * `filter` or a {@link PlayOptionEffect}'s `when` against a candidate
 * target character. The context exposes:
 *
 *  - `target.race`, `target.status`, `target.skills`, `target.keywords`,
 *    `target.name` — per-character attributes for filtering. `target.keywords`
 *    exposes the character's card keywords (e.g. `"leader"`), used by Foe
 *    Dismayed (ba-59) to gate its +3 influence boost on "a leader or The
 *    Balrog".
 *  - `target.inAvatarCompany` — `true` iff the character belongs to the
 *    same company as the player's avatar (wizard/ringwraith/etc.).
 *    Requires the `player` parameter to be passed.
 *  - `company.containsDiplomat` — `true` iff the character's company
 *    contains at least one character with the `diplomat` skill.
 *    Enables cards like New Friendship to offer a corruption-check boost
 *    to any character in a diplomat's company, not just the diplomat.
 *  - `pending.corruptionCheckTargetsMe` — `true` iff a pending
 *    corruption-check resolution exists whose `characterId` matches
 *    the candidate. Enables reactive plays like Halfling Strength's
 *    `+4 corruption check boost` option to declare
 *    `when: { "pending.corruptionCheckTargetsMe": true }` and thereby
 *    satisfy the CoE "cannot play cards without effect" rule.
 *
 * Exported so legal-action computers in other windows (e.g. the
 * corruption-check pending-resolution window) can build the same
 * context shape when scanning a player's hand for reactive plays.
 */
export function buildPlayOptionContext(
  state: GameState,
  char: import('../../index.js').CharacterInPlay,
  player?: PlayerState,
  currentPhase?: string,
): Record<string, unknown> {
  const def = defById(state, char.definitionId);
  if (!def || !isCharacterCard(def)) {
    return { target: {}, pending: { corruptionCheckTargetsMe: false } };
  }
  const corruptionCheckTargetsMe = state.pendingResolutions.some(
    r => r.kind.type === 'corruption-check' && r.kind.characterId === char.instanceId,
  );
  let inAvatarCompany = false;
  let hasFactionInHand = false;
  let companySiteType: string | null = null;
  let containsDiplomat = false;
  let companyMoving = false;
  if (player) {
    const avatar = findPlayerAvatar(state, player);
    if (avatar) {
      const co = findCharacterCompany(player.companies, avatar.instanceId);
      if (co && co.characters.includes(char.instanceId)) {
        inAvatarCompany = true;
      }
    }
    // `hasFactionInHand` is true only while this player's influence-attempt is
    // live in the chain — the faction card has moved from hand to the chain but
    // the boost window is still open for cards like Muster and New Friendship.
    // Pre-checking whether the hand contains a faction card is intentionally
    // excluded: short-event influence boosters must be played in response to an
    // active influence check, not speculatively before one is declared.
    hasFactionInHand = Boolean(state.chain?.entries.some(
      e => !e.resolved && !e.negated && e.payload.type === 'influence-attempt' && e.declaredBy === player.id,
    ));
    const charCompany = findCharacterCompany(player.companies, char.instanceId);
    if (charCompany?.currentSite) {
      const siteDef = defById(state, charCompany.currentSite.definitionId);
      if (siteDef && 'siteType' in siteDef) companySiteType = (siteDef as { siteType: string }).siteType;
    }
    if (charCompany) {
      containsDiplomat = charCompany.characters.some(memberId => {
        const memberChar = player.characters[memberId];
        if (!memberChar) return false;
        const memberDef = defById(state, memberChar.definitionId);
        if (!isCharacterCard(memberDef)) return false;
        const naturalSkills = memberDef.skills as readonly string[] ?? [];
        const grantedSkills = getItemGrantedSkills(state, memberChar);
        return naturalSkills.includes('diplomat') || grantedSkills.includes('diplomat');
      });
    }
    // A character is "moving" when it belongs to the active company during the
    // M/H phase and that company is actually moving to a new site. Use
    // siteRevealed (true only for moving companies) rather than
    // destinationSiteName (which is set to the current site even for
    // stationary companies, making it non-null for both cases).
    const ps = state.phaseState as MovementHazardPhaseState;
    if (ps.phase === 'movement-hazard' && ps.siteRevealed && charCompany) {
      const activeCompany = player.companies[ps.activeCompanyIndex];
      companyMoving = activeCompany?.id === charCompany.id;
    } else if (state.phaseState.phase === 'organization' && charCompany) {
      // During the organization phase a company counts as "moving" once it has
      // a planned destination (plan-movement sets destinationSite; the player
      // may still cancel it before the phase ends). Hide in Dark Places
      // (le-192) gates on `company.moving` being false so it can only be played
      // on a company that has not declared movement.
      companyMoving = charCompany.destinationSite != null;
    }
  }

  // During M/H phase expose destination site type and path region types so
  // play-option `when` conditions can gate on e.g. "destination is R&L" or
  // "path contains wilderness" (used by Deeper Shadow, le-179).
  let destinationSiteType: string | null = null;
  let destinationRegionTypes: string[] = [];
  const mhPs = state.phaseState as MovementHazardPhaseState;
  if (mhPs.phase === 'movement-hazard') {
    destinationSiteType = mhPs.destinationSiteType ?? null;
    destinationRegionTypes = [...mhPs.resolvedSitePath];
  }

  // Names of items / allies the character bears, so play-target filters can
  // gate on a specific borne card (e.g. Cracks of Doom targets the bearer of
  // The One Ring via `{ "target.itemNames": { "$includes": "The One Ring" } }`).
  const itemNames = defNamesOf(state, char.items);
  const allyNames = defNamesOf(state, char.allies);

  return {
    target: {
      race: def.race,
      status: statusToken(char.status),
      skills: [...(def.skills as readonly string[]), ...getItemGrantedSkills(state, char)],
      keywords: (def.keywords as readonly string[] | undefined) ?? [],
      name: def.name,
      mind: def.mind,
      inAvatarCompany,
      itemNames,
      allyNames,
    },
    company: {
      siteType: companySiteType,
      containsDiplomat,
      moving: companyMoving,
      destinationSiteType,
      destinationRegionTypes,
    },
    pending: {
      corruptionCheckTargetsMe,
    },
    player: {
      hasFactionInHand,
    },
    inPlay: buildInPlayNames(state),
    ...(currentPhase !== undefined ? { phase: currentPhase } : {}),
  };
}

/**
 * Builds the condition context for a `play-condition` `requires:
 * 'active-company'` check. Exposes the company's current site (name/type)
 * and the aggregate names of every character, borne item, and borne ally in
 * the company — enough for a generic DSL condition to express positional win
 * prerequisites (e.g. The One Ring and Gollum at Mount Doom) without a
 * per-card keyword.
 */
export function buildActiveCompanyContext(
  state: GameState,
  player: PlayerState,
  company: import('../../types/state-cards.js').Company,
): Record<string, unknown> {
  const siteDef = company.currentSite ? defById(state, company.currentSite.definitionId) : undefined;
  const siteName = siteDef?.name;
  const siteType = siteDef && 'siteType' in siteDef ? (siteDef as { siteType: string }).siteType : undefined;

  const characterNames: string[] = [];
  const itemNames: string[] = [];
  const allyNames: string[] = [];
  for (const charId of company.characters) {
    const char = player.characters[charId];
    if (!char) continue;
    const cn = defById(state, char.definitionId)?.name;
    if (cn != null) characterNames.push(cn);
    itemNames.push(...defNamesOf(state, char.items));
    allyNames.push(...defNamesOf(state, char.allies));
  }

  return {
    site: { name: siteName, type: siteType },
    company: { characterNames, itemNames, allyNames },
  };
}

/**
 * Builds the condition context for a `play-condition` `requires:
 * "player-state"` check. The single source of truth for the player-state
 * context across all three evaluation sites (organization, organization-events,
 * site phases). Exposes:
 *
 * - `player.alignment` / `opponent.alignment` — card-text alignment string
 *   (`"wizard"`, `"ringwraith"`, `"fallen-wizard"`, `"balrog"`).
 * - `player.avatar` — the name of the player's revealed avatar (e.g.
 *   `"Pallando"`, `"Saruman"`), or `undefined` if none is in play. Used by The
 *   Fortress of Isen/Towers (wh-68/69) and A Strident Spawn (wh-61).
 * - `player.hasRingwraithInPlay` — `true` when the player has a Ringwraith-race
 *   avatar character in play. Used by Above the Abyss (as-77).
 * - `player.stagePoints` — the Fallen-wizard stage-point total. Used by
 *   Gatherer of Loyalties (wh-70) and A Strident Spawn (wh-61).
 * - `player.factionCount` — the number of factions the player controls in play.
 *   Used by The White Hand (wh-122).
 * - `player.hasProtectedWizardhaven` — `true` when the player controls a
 *   protected Wizardhaven. Used by A Strident Spawn (wh-61).
 * - `inPlay` — the names of cards the player has in play, for
 *   `{ "inPlay": "<name>" }` prerequisites (e.g. The White Hand wh-122).
 */
export function buildPlayerStateContext(
  state: GameState,
  player: PlayerState,
  playerId: PlayerId,
): Record<string, unknown> {
  const opponent = state.players.find(p => p.id !== playerId);
  let hasRingwraithInPlay = false;
  for (const char of Object.values(player.characters)) {
    const def = defById(state, char.definitionId);
    if (isAvatarCharacter(def) && (def as { race?: string }).race === 'ringwraith') {
      hasRingwraithInPlay = true;
      break;
    }
  }
  const factionCount = player.cardsInPlay.filter(c => {
    const def = defById(state, c.definitionId);
    return def && isFactionCard(def);
  }).length;
  // "Playable if you are X" Stage cards test the Fallen-wizard the player
  // counts *as* (CoE 2.2.F2), which persists from declaration (CoE 1.8.F1)
  // until the avatar is eliminated — the avatar need not be in play. Use the
  // identity helper rather than the in-play-only avatar lookup.
  const avatarName = findFallenWizardAvatarName(state, player);
  return {
    player: {
      alignment: player.alignment,
      avatar: avatarName,
      hasRingwraithInPlay,
      stagePoints: player.stagePoints,
      factionCount,
      hasProtectedWizardhaven: playerHasProtectedWizardhaven(state, playerId),
    },
    opponent: { alignment: opponent?.alignment },
    inPlay: buildControllerInPlayNames(state, playerId),
  };
}

/** Legacy alias retained for call sites inside this module. */
function buildTargetContext(
  state: GameState,
  char: import('../../index.js').CharacterInPlay,
  player?: PlayerState,
  currentPhase?: string,
): Record<string, unknown> {
  return buildPlayOptionContext(state, char, player, currentPhase);
}

/**
 * Enumerates candidate target character instance IDs for a
 * {@link PlayTargetEffect} with `target: "character"`. Applies the
 * optional DSL `filter` condition against each candidate's target
 * context — no per-card / per-keyword branches. Non-character targets
 * yield an empty list here; those are handled by dedicated play paths.
 *
 * When the play-target carries a tap cost (`cost.tap === 'character'`),
 * already-tapped characters are excluded — a tapped character cannot pay
 * the tap cost. Without this guard, cards like Marvels Told would be
 * offered with a tapped sage as the target.
 */
function eligiblePlayOptionTargets(
  state: GameState,
  player: PlayerState,
  playTarget: PlayTargetEffect,
): CardInstanceId[] {
  if (playTarget.target !== 'character') return [];
  const requiresUntapped = playTarget.cost?.tap === 'character';
  const out: CardInstanceId[] = [];
  for (const [charId, char] of characterEntries(player)) {
    const charDef = defById(state, char.definitionId);
    if (!charDef || !isCharacterCard(charDef)) continue;
    if (requiresUntapped && char.status !== CardStatus.Untapped) {
      logDetail(`Play-target rejects ${charDef.name} (${charId}): status ${char.status} (tap cost requires untapped)`);
      continue;
    }
    if (playTarget.filter
        && !matchesCondition(playTarget.filter, buildTargetContext(state, char, player))) {
      continue;
    }
    // Enforce the optional company-size cap (e.g. Sneakin' / Stealth:
    // "company size less than 3" → maxCompanySize 2). Hobbits and Orc
    // scouts count as half via companyEffectiveSize. This mirrors the
    // end-of-org path so
    // cards playable during the normal organization window respect the
    // same size restriction.
    if (playTarget.maxCompanySize !== undefined) {
      const company = findCharacterCompany(player.companies, charId);
      if (company && companyEffectiveSize(state, company) > playTarget.maxCompanySize) {
        logDetail(`Play-target rejects ${charDef.name} (${charId}): company size ${companyEffectiveSize(state, company)} > max ${playTarget.maxCompanySize}`);
        continue;
      }
    }
    out.push(charId);
  }
  return out;
}

/**
 * Generates `play-short-event` actions for a card with {@link PlayOptionEffect}s.
 * One action per (target, option) pair whose `when` (if any) matches the
 * target context. The chosen option is carried on the action via
 * `optionId` so the reducer can dispatch generically via the option's
 * `apply` clause.
 */
function playOptionActionsForCard(
  state: GameState,
  player: PlayerState,
  playerId: PlayerId,
  cardInstanceId: CardInstanceId,
  def: { name: string },
  playTarget: PlayTargetEffect,
  options: readonly PlayOptionEffect[],
  currentPhase?: string,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const hasTapCost = playTarget.cost?.tap === 'character';
  const targets = eligiblePlayOptionTargets(state, player, playTarget);

  // Resolve the source definition once to check for an active-check duplication limit.
  const sourceDefId = resolveInstanceId(state, cardInstanceId);
  const sourceDef = sourceDefId ? defById(state, sourceDefId) : undefined;
  const activeCheckLimit = findDuplicationLimitEffect(sourceDef, 'active-check');

  for (const targetId of targets) {
    const char = player.characters[targetId];
    if (!char) continue;
    const charDef = defById(state, char.definitionId);
    const targetName = isCharacterCard(charDef) ? charDef.name : String(targetId);

    // "active-check" duplication limit: skip this target if a constraint from this
    // definition already exists for it (enforces "Cannot be duplicated on a given check").
    if (activeCheckLimit && sourceDefId) {
      const alreadyApplied = state.activeConstraints.some(
        c => c.sourceDefinitionId === sourceDefId
          && c.target.kind === 'character'
          && c.target.characterId === targetId,
      );
      if (alreadyApplied) {
        logDetail(`${def.name}: active-check duplication limit — already applied to ${targetName}`);
        continue;
      }
    }

    const ctx = buildTargetContext(state, char, player, currentPhase);
    for (const opt of options) {
      if (opt.when && !matchesCondition(opt.when, ctx)) {
        logDetail(`${def.name} on ${targetName}: option "${opt.id}" when-condition rejected`);
        continue;
      }
      logDetail(`${def.name} playable on ${targetName}: option "${opt.id}"`);
      actions.push({
        action: {
          type: 'play-short-event',
          player: playerId,
          cardInstanceId,
          targetCharacterId: targetId,
          optionId: opt.id,
          ...(hasTapCost ? { targetScoutInstanceId: targetId } : {}),
        },
        viable: true,
      });
    }
  }
  return actions;
}

/**
 * Enumerates the concrete play actions for a {@link WithdrawAgentEffect} card
 * (Withdrawn to Mordor, dm-165) held by `playerId`:
 *
 * - one `play-short-event` carrying `targetAgentId` per **face-up** agent the
 *   opponent has in play (agent mode); and
 * - when the effect allows the alternative, one carrying `discardTargetInstanceId`
 *   per **unrevealed** on-guard card sitting on the player's own companies
 *   (on-guard mode — the CRF 22 "before it is revealed" window).
 *
 * Returns an empty array when neither target exists, so the caller can mark
 * the card not-playable with a reason.
 */
function withdrawAgentTargetActions(
  state: GameState,
  playerId: PlayerId,
  player: PlayerState,
  cardInstanceId: CardInstanceId,
  effect: WithdrawAgentEffect,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];

  const opponent = state.players.find(p => p.id !== playerId);
  for (const agent of opponent?.agents ?? []) {
    if (!agent.revealed) continue;
    const agentDef = defById(state, agent.character.definitionId);
    const agentName = agentDef?.name ?? (agent.character.definitionId as string);
    logDetail(`Withdrawn to Mordor: can target face-up agent ${agentName} (${agent.id as string})`);
    actions.push({
      action: { type: 'play-short-event', player: playerId, cardInstanceId, targetAgentId: agent.id },
      viable: true,
    });
  }

  if (effect.alternativeDiscardOnGuard) {
    for (const company of player.companies) {
      for (const og of company.onGuardCards) {
        if (og.revealed) continue;
        logDetail(`Withdrawn to Mordor: can discard unrevealed on-guard card (${og.instanceId as string}) at company ${company.id as string}`);
        actions.push({
          action: { type: 'play-short-event', player: playerId, cardInstanceId, discardTargetInstanceId: og.instanceId },
          viable: true,
        });
      }
    }
  }

  return actions;
}

/**
 * Evaluates hero-resource short-event cards in the active player's hand for
 * play in the given phase (CoE rule 2.1.1: resource short-events are legal
 * during any phase of the resource player's turn unless restricted by a
 * rule or effect).
 *
 * Skips cards already considered by an earlier pass (e.g. play-character
 * evaluation in organization) and cards whose `play-window` effect binds
 * them to a different phase. Emits `play-short-event` actions (one per
 * eligible target combination) and `not-playable` entries with a reason
 * for cards whose constraints cannot be satisfied.
 *
 * The returned actions all carry a `cardInstanceId` matching a hand card,
 * so callers can derive the evaluated set to skip duplicates in a final
 * catch-all loop.
 */
export function playResourceShortEventActions(
  state: GameState,
  playerId: PlayerId,
  alreadyEvaluated: ReadonlySet<string>,
  currentPhase: 'organization' | 'site',
): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player) return [];

  const actions: EvaluatedAction[] = [];
  const combatOnlyTypes = new Set(['cancel-attack', 'cancel-strike', 'halve-strikes', 'strike-modifier']);
  const inPlayNames = buildInPlayNames(state);

  for (const handCard of player.hand) {
    const def = defById(state, handCard.definitionId);
    if (!isResourceEventCard(def) || def.eventType !== 'short') continue;
    if (alreadyEvaluated.has(handCard.instanceId as string)) continue;
    const playWindow = def.effects?.find(e => e.type === 'play-window') as { phase?: string; step?: string; siteTypes?: readonly string[] } | undefined;
    // Cards with a play-window restricting them to a different phase
    // are skipped — they'll be marked not-playable by the caller's
    // catch-all loop (or by fillNotPlayable in legal-actions/index.ts).
    if (playWindow && playWindow.phase !== currentPhase) continue;
    // When play-window declares a site-type restriction (e.g. Lucky Search
    // requires shadow-hold or dark-hold), enforce it against the active
    // company's current site. Only applies during the site phase after a
    // company has been selected (activeCompanyIndex is valid outside of the
    // select-company step).
    if (playWindow?.siteTypes && playWindow.siteTypes.length > 0 && currentPhase === 'site') {
      const siteState = state.phaseState as { activeCompanyIndex: number; step: string } | null;
      if (siteState && siteState.step !== 'select-company') {
        const activePlayer = activePlayerState(state);
        const activeCompany = activePlayer?.companies[siteState.activeCompanyIndex];
        const siteDef = activeCompany?.currentSite
          ? defById(state, activeCompany.currentSite.definitionId)
          : undefined;
        if (siteDef && isSiteCard(siteDef) && !playWindow.siteTypes.includes(siteDef.siteType)) {
          logDetail(`${def.name}: play-window siteTypes [${playWindow.siteTypes.join(', ')}] does not include active site type ${siteDef.siteType} — not playable`);
          actions.push(notPlayable(playerId, handCard.instanceId, `${def.name} can only be played at ${playWindow.siteTypes.map((s: string) => s.replace(/-/g, ' ')).join(' or ')}`));
          continue;
        }
      }
    }
    // Withdrawn to Mordor (dm-165): a `withdraw-agent` short event targets an
    // opponent's face-up agent (removed by mind) or, in its alternative mode,
    // discards one of the player's unrevealed on-guard cards. Enumerate one
    // action per eligible target; mark not-playable when neither exists.
    const withdrawAgentEffect = def.effects?.find(
      (e): e is WithdrawAgentEffect => e.type === 'withdraw-agent',
    );
    if (withdrawAgentEffect) {
      const targeted = withdrawAgentTargetActions(
        state, playerId, player, handCard.instanceId, withdrawAgentEffect,
      );
      if (targeted.length === 0) {
        logDetail(`${def.name}: no face-up agent${withdrawAgentEffect.alternativeDiscardOnGuard ? ' or on-guard card' : ''} to target — not playable`);
        actions.push(notPlayable(playerId, handCard.instanceId, `${def.name} has no valid target`));
      } else {
        actions.push(...targeted);
      }
      continue;
    }

    // End-of-org cards (e.g. Stealth) are playable during the organization
    // phase alongside the player's other organization actions. Playing one
    // does not end the phase or lock out further movement/organization (CoE
    // 2.II.7) — the player advances to Long-event only by passing. Mark them
    // not-playable with a reason if their play-target constraints aren't met
    // so the UI can explain why.
    if (playWindow?.step === 'end-of-org') {
      // play-condition requires: "card-in-play" — a named card must be in play
      // for the playing player (any in-play zone, including character-attached
      // permanent events). Enforced here for end-of-org cards because this
      // branch `continue`s before the generic card-in-play check further down.
      // Used by Cloaked by Darkness (ba-53): "Playable on a company if Great
      // Shadow is in play."
      const endOfOrgCardInPlay = findPlayConditionEffect(def, 'card-in-play');
      if (endOfOrgCardInPlay?.cardName
          && !isCardNameInPlayForPlayer(state, player, endOfOrgCardInPlay.cardName)) {
        logDetail(`${def.name}: end-of-org play-condition card-in-play requires ${endOfOrgCardInPlay.cardName} in play`);
        actions.push(notPlayable(playerId, handCard.instanceId, `${def.name} requires ${endOfOrgCardInPlay.cardName} in play`));
        continue;
      }

      const eligibility = endOfOrgEligibility(state, player, def);
      if (!eligibility.eligible) {
        logDetail(`${def.name}: end-of-org card not eligible — ${eligibility.reason}`);
        actions.push(notPlayable(playerId, handCard.instanceId, eligibility.reason));
        continue;
      }

      // If the card has a play-target with a tap cost (e.g. Stealth taps a
      // scout), emit one play action per eligible target so the chosen
      // target can be tapped when the action is reduced. Company-targeting
      // without a tap cost (e.g. Great-road) emits one action per eligible
      // company identified by targetCompanyId. Otherwise emit a single
      // action with no target.
      const eoTarget = getPlayTargetEffect(def);
      if (eoTarget && eligibility.eligibleTargets.length > 0
        && (eoTarget.cost?.tap === 'character' || eoTarget.target === 'character')) {
        // Per-character actions carrying the chosen character as
        // targetScoutInstanceId. This covers two cases:
        //  - a tap-character cost (e.g. Stealth, Great Ship): the targeted
        //    character is the tapper, applied at reduce time via the cost;
        //  - a character target with no cost (e.g. Hide in Dark Places,
        //    le-192): the target simply lets the self-enters-play constraint
        //    resolve the scout's company.
        for (const targetId of eligibility.eligibleTargets) {
          logDetail(`Resource short-event playable (end-of-org, target ${targetId as string}): ${def.name} (${handCard.instanceId as string})`);
          actions.push({
            action: {
              type: 'play-short-event',
              player: playerId,
              cardInstanceId: handCard.instanceId,
              targetScoutInstanceId: targetId,
            },
            viable: true,
          });
        }
      } else if (eoTarget && eligibility.eligibleTargets.length > 0 && eoTarget.target === 'company') {
        // Company target without tap cost: one action per eligible company.
        // eligibleTargets[i] is the first character of the i-th eligible company,
        // used here only to look up the company so we can emit targetCompanyId.
        for (const repCharId of eligibility.eligibleTargets) {
          const company = findCharacterCompany(player.companies, repCharId);
          if (!company) continue;
          logDetail(`Resource short-event playable (end-of-org, company ${company.id as string}): ${def.name} (${handCard.instanceId as string})`);
          actions.push({
            action: {
              type: 'play-short-event',
              player: playerId,
              cardInstanceId: handCard.instanceId,
              targetCompanyId: company.id,
            },
            viable: true,
          });
        }
      } else {
        logDetail(`Resource short-event playable (end-of-org): ${def.name} (${handCard.instanceId as string})`);
        actions.push({
          action: { type: 'play-short-event', player: playerId, cardInstanceId: handCard.instanceId },
          viable: true,
        });
      }
      continue;
    }

    // Skip short events whose effects are only usable during combat
    // (e.g. Concealment's cancel-attack). These require an active attack.
    // Supporting effects like play-target and set-character-status do not
    // confer non-combat playability on their own — they merely describe how
    // the combat effect is applied (e.g. Escape: pick a character, cancel the
    // attack, wound them via set-character-status{inverted}). A move
    // (discard-in-play) effect whose `when` gate IS currently met represents a
    // genuine non-combat mode and does allow the card to be played outside
    // combat (e.g. The Cock Crows' GoM discard mode). A play-option effect
    // with a met `when` also represents a non-combat mode (e.g. Many Turns
    // and Doublings' hazard-limit reduction).
    const combatSupportTypes = new Set([...combatOnlyTypes, 'modify-attack', 'play-target', 'set-character-status']);
    const hasEffects = def.effects && def.effects.length > 0;
    const allCombatOnly = hasEffects && def.effects.every(e => {
      if (combatSupportTypes.has(e.type)) return true;
      if (e.type === 'duplication-limit' && (e as { scope?: string }).scope === 'attack') return true;
      if (e.type === 'move' && e.when && !matchesCondition(e.when, { inPlay: inPlayNames })) return true;
      return false;
    });
    if (allCombatOnly) {
      logDetail(`${def.name}: combat-only short-event, not playable outside combat`);
      continue;
    }

    // play-condition requires: "site-type" (e.g. Glamour of Surpassing Excellence:
    // requires Border-hold or Free-hold). Only meaningful during the site phase.
    const siteTypeCondition = findPlayConditionEffect(def, 'site-type');
    if (siteTypeCondition) {
      let activeSiteType: string | null = null;
      if (currentPhase === 'site') {
        const sitePhaseState = state.phaseState as { activeCompanyIndex: number };
        const activePlayer = activePlayerState(state);
        const company = activePlayer?.companies[sitePhaseState.activeCompanyIndex];
        if (company?.currentSite) {
          const siteDef = defById(state, company.currentSite.definitionId);
          if (siteDef && 'siteType' in siteDef) {
            activeSiteType = (siteDef as { siteType: string }).siteType;
          }
        }
      }
      if (!activeSiteType || !siteTypeCondition.siteTypes?.includes(activeSiteType)) {
        logDetail(`${def.name}: play-condition site-type requires [${siteTypeCondition.siteTypes?.join(', ') ?? '?'}], active site type: ${activeSiteType ?? 'none'}`);
        actions.push(notPlayable(playerId, handCard.instanceId, `${def.name} can only be played at: ${(siteTypeCondition.siteTypes ?? []).map((t: string) => t.replace(/-/g, ' ')).join(' or ')}`));
        continue;
      }
    }

    // play-condition requires: "site-has-resource" — active site must have the
    // given item subtype in its playableResources array. Only meaningful during
    // the site phase (after a company is selected).
    const siteHasResourceCondition = findPlayConditionEffect(def, 'site-has-resource');
    if (siteHasResourceCondition && siteHasResourceCondition.subtype) {
      let siteHasResource = false;
      if (currentPhase === 'site') {
        const sitePhaseState = state.phaseState as { activeCompanyIndex: number };
        const activePlayer = activePlayerState(state);
        const company = activePlayer?.companies[sitePhaseState.activeCompanyIndex];
        if (company?.currentSite) {
          const siteDef = defById(state, company.currentSite.definitionId);
          if (siteDef && isSiteCard(siteDef)) {
            siteHasResource = (siteDef.playableResources ?? []).includes(
              siteHasResourceCondition.subtype as Parameters<typeof siteDef.playableResources.includes>[0],
            );
            // Records Unread (as-130) mode B: a `site-resource-unlocked`
            // constraint (e.g. Information at any Shadow-hold) makes the
            // category playable at matching site types even when the site
            // does not list it natively.
            if (!siteHasResource && isSiteResourceUnlocked(state, playerId, siteDef, siteHasResourceCondition.subtype)) {
              logDetail(`${def.name}: ${siteHasResourceCondition.subtype} unlocked at ${siteDef.siteType} via site-resource-unlocked constraint`);
              siteHasResource = true;
            }
          }
        }
      }
      if (!siteHasResource) {
        logDetail(`${def.name}: play-condition site-has-resource requires ${siteHasResourceCondition.subtype} to be playable at the active site`);
        actions.push(notPlayable(playerId, handCard.instanceId, `${def.name} requires a site where ${siteHasResourceCondition.subtype} is playable`));
        continue;
      }
    }

    // play-condition requires: "company-has-item" — at least one character in the
    // active company must carry an item of the given subtype. Only meaningful
    // during the site phase.
    const companyHasItemCondition = findPlayConditionEffect(def, 'company-has-item');
    if (companyHasItemCondition && companyHasItemCondition.subtype) {
      let companyHasItem = false;
      if (currentPhase === 'site') {
        const sitePhaseState = state.phaseState as { activeCompanyIndex: number };
        const activePlayer = activePlayerState(state);
        const company = activePlayer?.companies[sitePhaseState.activeCompanyIndex];
        if (company) {
          companyHasItem = company.characters.some(charId => {
            const char = player.characters[charId];
            return char?.items.some(item => {
              const itemDef = defById(state, item.definitionId);
              return itemDef && 'subtype' in itemDef
                && (itemDef as { subtype?: string }).subtype === companyHasItemCondition.subtype;
            });
          });
        }
      }
      if (!companyHasItem) {
        logDetail(`${def.name}: play-condition company-has-item requires a ${companyHasItemCondition.subtype} in the active company`);
        actions.push(notPlayable(playerId, handCard.instanceId, `${def.name} requires a character in the company to have a ${companyHasItemCondition.subtype}`));
        continue;
      }
    }

    // play-condition requires: "active-company" — a generic DSL condition
    // evaluated against the active site-phase company's aggregate context
    // ({ site, company: { itemNames, characterNames, allyNames } }). Used by
    // the CoE 10.39 win cards (Cracks of Doom, Gollum's Fate) to require The
    // One Ring (and Gollum) at Mount Doom. Only meaningful during the site
    // phase after a company is selected.
    const activeCompanyCondition = findPlayConditionEffect(def, 'active-company');
    if (activeCompanyCondition?.condition) {
      let met = false;
      if (currentPhase === 'site') {
        const sitePhaseState = state.phaseState as { activeCompanyIndex: number; step?: string };
        const activePlayer = activePlayerState(state);
        const company = activePlayer?.companies[sitePhaseState.activeCompanyIndex];
        if (company) {
          met = matchesCondition(activeCompanyCondition.condition, buildActiveCompanyContext(state, player, company));
        }
      }
      if (!met) {
        logDetail(`${def.name}: play-condition active-company not satisfied`);
        actions.push(notPlayable(playerId, handCard.instanceId, `${def.name}: play conditions not met`));
        continue;
      }
    }

    // play-condition requires: "player-state" — a generic DSL condition
    // evaluated against the active player's avatar/alignment context
    // ({ player: { alignment, hasRingwraithInPlay }, opponent: { alignment } }).
    // Used by Above the Abyss (as-77): "if your opponent is a Wizard and your
    // Ringwraith is in play".
    const playerStateCondition = findPlayConditionEffect(def, 'player-state');
    if (playerStateCondition?.condition) {
      const met = matchesCondition(playerStateCondition.condition, buildPlayerStateContext(state, player, playerId));
      if (!met) {
        logDetail(`${def.name}: play-condition player-state not satisfied`);
        actions.push(notPlayable(playerId, handCard.instanceId, `${def.name}: play conditions not met`));
        continue;
      }
    }

    // play-condition requires: "card-in-play" — a named card must be in play for
    // the playing player (any in-play zone, including character-attached
    // permanent events). Used by Terror Heralds Doom (ba-78): "Playable during
    // the organization phase if Flame of Udûn is in play."
    const cardInPlayCondition = findPlayConditionEffect(def, 'card-in-play');
    if (cardInPlayCondition?.cardName) {
      const requiredName = cardInPlayCondition.cardName;
      if (!isCardNameInPlayForPlayer(state, player, requiredName)) {
        logDetail(`${def.name}: play-condition card-in-play requires ${requiredName} in play`);
        actions.push(notPlayable(playerId, handCard.instanceId, `${def.name} requires ${requiredName} in play`));
        continue;
      }
    }

    // Cards declaring `play-option` DSL effects (e.g. Halfling Strength):
    // enumerate (target, option) pairs, emitting one legal action per
    // combination whose option `when` matches the target's context.
    const playTarget = getPlayTargetEffect(def);
    const playOptions = getPlayOptionEffects(def);
    if (playOptions.length > 0 && playTarget) {
      const optionActions = playOptionActionsForCard(
        state, player, playerId, handCard.instanceId, def, playTarget, playOptions, currentPhase,
      );
      if (optionActions.length === 0) {
        logDetail(`${def.name}: no eligible ${playTarget.target} targets — not playable`);
        actions.push(notPlayable(playerId, handCard.instanceId, `No eligible ${playTarget.target} to target`));
      } else {
        actions.push(...optionActions);
      }
      continue;
    }

    // Collect eligible discard-in-play targets (e.g. Marvels Told forces
    // discard of a hazard non-environment permanent/long event). If the
    // card has a discard-in-play move effect but no valid targets exist,
    // it cannot be played. A `when` gate on the effect is also evaluated
    // (e.g. The Cock Crows requires Gates of Morning in play).
    const discardInPlay = findMoveEffectByShape(def, 'target', 'in-play', 'discard');
    const discardWhenMet = !discardInPlay?.when
      || matchesCondition(discardInPlay.when, { inPlay: inPlayNames });
    let discardTargetIds: CardInstanceId[] | null = null;
    if (discardWhenMet && discardInPlay && discardInPlay.filter) {
      discardTargetIds = collectDiscardInPlayTargets(state, discardInPlay.filter);
      if (discardTargetIds.length === 0) {
        logDetail(`${def.name}: no eligible discard-in-play target — not playable`);
        actions.push(notPlayable(playerId, handCard.instanceId, `${def.name} has no valid target to discard`));
        continue;
      }
    }

    // duplication-limit: scope "turn" — cannot play if a copy was already
    // played this turn (tracked via active constraints sourced from this def).
    const turnDupLimit = findDuplicationLimitEffect(def, 'turn');
    if (turnDupLimit) {
      const priorConstraints = countConstraintsFromDefinition(state, def.id);
      if (priorConstraints >= turnDupLimit.max) {
        logDetail(`${def.name}: cannot be duplicated this turn (${priorConstraints} active constraint(s))`);
        actions.push(notPlayable(playerId, handCard.instanceId, `${def.name} cannot be duplicated on a given turn`));
        continue;
      }
    }

    // Detect enqueue-ring-play-offer apply: requires per-(sage × gold ring) emission.
    const hasRingPlayOffer = def.effects?.some(
      e => e.type === 'on-event'
        && (e as { event?: string; apply?: { type?: string } }).event === 'self-enters-play'
        && (e as { event?: string; apply?: { type?: string } }).apply?.type === 'enqueue-ring-play-offer',
    ) ?? false;

    // Emit one play action per eligible target combination. When the card
    // has a play-target with tap cost AND discard-in-play, emit the cross-
    // product of (tap target × discard target). When the card has
    // enqueue-ring-play-offer, also cross with gold rings in the sage's company.
    const emitPlay = (tapTargetId: CardInstanceId | undefined, goldRingId?: CardInstanceId) => {
      if (discardTargetIds) {
        for (const discardId of discardTargetIds) {
          logDetail(`Resource short-event playable (target ${String(tapTargetId)}, discard ${String(discardId)}): ${def.name}`);
          actions.push({
            action: {
              type: 'play-short-event',
              player: playerId,
              cardInstanceId: handCard.instanceId,
              ...(tapTargetId ? { targetScoutInstanceId: tapTargetId } : {}),
              discardTargetInstanceId: discardId,
            },
            viable: true,
          });
        }
      } else {
        logDetail(`Resource short-event playable${tapTargetId ? ` (target ${String(tapTargetId)})` : ''}${goldRingId ? ` (ring ${String(goldRingId)})` : ''}: ${def.name}`);
        actions.push({
          action: {
            type: 'play-short-event',
            player: playerId,
            cardInstanceId: handCard.instanceId,
            ...(tapTargetId ? { targetScoutInstanceId: tapTargetId } : {}),
            ...(goldRingId ? { targetGoldRingInstanceId: goldRingId } : {}),
          },
          viable: true,
        });
      }
    };

    if (playTarget && playTarget.cost?.tap === 'character') {
      const tapTargets = eligiblePlayOptionTargets(state, player, playTarget);
      if (tapTargets.length === 0) {
        logDetail(`${def.name}: no eligible targets — not playable`);
        actions.push(notPlayable(playerId, handCard.instanceId, `No eligible ${playTarget.target} to target`));
      } else if (hasRingPlayOffer) {
        // Cross sage targets with gold rings in each sage's company.
        let anyOffered = false;
        for (const targetId of tapTargets) {
          const sageCompany = findCharacterCompany(player.companies, targetId);
          const goldRings: CardInstanceId[] = [];
          if (sageCompany) {
            for (const charId of sageCompany.characters) {
              const char = player.characters[charId];
              if (!char) continue;
              for (const item of char.items) {
                const itemDef = defById(state, item.definitionId);
                if (itemDef && 'subtype' in itemDef && (itemDef as { subtype?: string }).subtype === 'gold-ring') {
                  goldRings.push(item.instanceId);
                }
              }
            }
          }
          for (const ringId of goldRings) {
            emitPlay(targetId, ringId);
            anyOffered = true;
          }
        }
        if (!anyOffered) {
          logDetail(`${def.name}: no eligible (sage × gold ring) pair — not playable`);
          actions.push(notPlayable(playerId, handCard.instanceId, `${def.name} requires a sage and a gold ring in the same company`));
        }
      } else {
        for (const targetId of tapTargets) emitPlay(targetId);
      }
    } else if (playTarget && playTarget.target === 'character' && playTarget.filter) {
      // Filter-only character target (no tap cost): emit one action per eligible
      // character so the reducer knows which character to apply effects to.
      const filterTargets = eligiblePlayOptionTargets(state, player, playTarget);
      if (filterTargets.length === 0) {
        logDetail(`${def.name}: no eligible character targets — not playable`);
        actions.push(notPlayable(playerId, handCard.instanceId, `No eligible ${playTarget.target} to target`));
      } else {
        for (const targetId of filterTargets) {
          logDetail(`Resource short-event playable (filter-target ${String(targetId)}): ${def.name}`);
          actions.push({
            action: {
              type: 'play-short-event',
              player: playerId,
              cardInstanceId: handCard.instanceId,
              targetCharacterId: targetId,
            },
            viable: true,
          });
        }
      }
    } else {
      emitPlay(undefined);
    }
  }

  return actions;
}
