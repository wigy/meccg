/**
 * @module reducer-events
 *
 * Event card handlers for the game reducer. Covers playing permanent events,
 * short events, long events, and resource short events. These handlers are
 * shared across multiple phases (organization, long-event, movement/hazard).
 */

import type { GameState, CardInstance, ChainEntryPayload, PendingEffect, GameAction } from '../index.js';
import { Phase, CardStatus, getPlayerIndex, BASE_MAX_REGION_DISTANCE, matchesCondition } from '../index.js';
import { logDetail } from './legal-actions/log.js';
import { initiateChain, pushChainEntry } from './chain-reducer.js';
import { resolveInstanceId } from '../types/state.js';
import type { ReducerResult } from './reducer-utils.js';
import { clonePlayers } from './reducer-utils.js';
import { addConstraint, enqueueResolution } from './pending.js';
import { handleUntapBearer } from './reducer-organization.js';


/**
 * Handle playing a permanent-event resource card.
 * Removes the card from hand, places it on the chain, and initiates/pushes
 * a chain of effects. The card enters play upon resolution (see chain-reducer).
 */
export function handlePlayPermanentEvent(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'play-permanent-event') return { state, error: 'Expected play-permanent-event action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const cardIdx = player.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIdx === -1) return { state, error: 'Card not in hand' };

  const handCard = player.hand[cardIdx];
  const def = state.cardPool[handCard.definitionId as string];
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

  logDetail(`Playing permanent event: ${def.name} → enters chain`);

  // Remove card from hand — it now resides on the chain
  const newHand = [...player.hand];
  newHand.splice(cardIdx, 1);

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...player, hand: newHand };
  let newState: GameState = { ...state, players: newPlayers };

  // Initiate or push onto chain — card enters play upon resolution
  const payload: import('../index.js').ChainEntryPayload = {
    type: 'permanent-event',
    ...(action.targetCharacterId ? { targetCharacterId: action.targetCharacterId } : {}),
  };
  if (newState.chain === null) {
    newState = initiateChain(newState, action.player, handCard, payload);
  } else {
    newState = pushChainEntry(newState, action.player, handCard, payload);
  }

  return { state: newState };
}

/**
 * Handle playing a short-event as a resource (e.g. Twilight).
 * Moves the short event from hand to discard and initiates (or pushes onto)
 * a chain of effects. The target environment remains in play until the chain
 * entry resolves — giving both players a chance to respond.
 */
export function handlePlayShortEvent(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'play-short-event') return { state, error: 'Expected play-short-event action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const cardIdx = player.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIdx === -1) return { state, error: 'Card not in hand' };

  const handCard = player.hand[cardIdx];
  const def = state.cardPool[handCard.definitionId as string];
  if (!def || def.cardType !== 'hazard-event' || def.eventType !== 'short') {
    return { state, error: 'Card is not a hazard short-event' };
  }

  if (!action.targetInstanceId) {
    return { state, error: 'Target environment required for hazard short-event' };
  }

  // Validate target exists (in cardsInPlay or the current chain)
  const targetInCards = state.players.some(p =>
    p.cardsInPlay.some(c => c.instanceId === action.targetInstanceId),
  );
  const targetInChain = state.chain?.entries.some(
    e => e.card?.instanceId === action.targetInstanceId && !e.resolved && !e.negated,
  ) ?? false;
  if (!targetInCards && !targetInChain) {
    return { state, error: 'Target environment not in play or on chain' };
  }

  const targetDefId = resolveInstanceId(state, action.targetInstanceId);
  const targetDef = targetDefId ? state.cardPool[targetDefId as string] : undefined;
  logDetail(`Playing short event ${def.name}: targeting environment ${targetDef?.name ?? action.targetInstanceId} (chain will resolve the cancel)`);

  // Move short event from hand → discard
  const newHand = [...player.hand];
  newHand.splice(cardIdx, 1);

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = {
    ...player,
    hand: newHand,
    discardPile: [...player.discardPile, handCard],
  };

  let newState: GameState = { ...state, players: newPlayers };

  // Initiate chain or push onto existing chain — target stored in payload
  const payload: ChainEntryPayload = { type: 'short-event', targetInstanceId: action.targetInstanceId };
  if (newState.chain === null) {
    newState = initiateChain(newState, action.player, handCard, payload);
  } else {
    newState = pushChainEntry(newState, action.player, handCard, payload);
  }

  return { state: newState };
}

/**
 * Handle actions during the long-event phase.
 *
 * The resource player may play resource long-events and short-events from
 * hand. On pass, the hazard player's hazard long-events are discarded and
 * the phase advances. Resource short events with fetch-to-deck effects
 * enter a sub-flow for card selection.
 */


/**
 * Handle actions during the long-event phase.
 *
 * The resource player may play resource long-events and short-events from
 * hand. On pass, the hazard player's hazard long-events are discarded and
 * the phase advances. Resource short events with fetch-to-deck effects
 * enter a sub-flow for card selection.
 */
export function handleLongEvent(state: GameState, action: GameAction): ReducerResult {
  if (action.type === 'play-long-event') {
    return handlePlayLongEvent(state, action);
  }
  if (action.type === 'play-short-event') {
    return handlePlayResourceShortEvent(state, action);
  }
  if (action.type === 'activate-granted-action' && action.actionId === 'untap-bearer') {
    return handleUntapBearer(state, action);
  }
  if (action.type === 'pass') {
    // [2.III.3] At end of long-event phase: hazard player discards own hazard long-events
    const activePlayer = state.activePlayer!;
    const hazardPlayerIndex = (getPlayerIndex(state, activePlayer) + 1) % state.players.length;
    const hazardPlayer = state.players[hazardPlayerIndex];
    const discardedEvents: CardInstance[] = [];
    const remainingCards = hazardPlayer.cardsInPlay.filter(card => {
      const def = state.cardPool[card.definitionId as string];
      if (def && def.cardType === 'hazard-event' && def.eventType === 'long') {
        logDetail(`Long-event exit: discarding hazard long-event "${def.name}" (${card.instanceId as string})`);
        discardedEvents.push({ instanceId: card.instanceId, definitionId: card.definitionId });
        return false;
      }
      return true;
    });

    const newPlayers = clonePlayers(state);
    newPlayers[hazardPlayerIndex] = {
      ...newPlayers[hazardPlayerIndex],
      cardsInPlay: remainingCards,
      discardPile: [...newPlayers[hazardPlayerIndex].discardPile, ...discardedEvents],
    };

    // Reset moved flags on the active player's companies for the new M/H phase
    const activeIndex = getPlayerIndex(state, activePlayer);
    newPlayers[activeIndex] = {
      ...newPlayers[activeIndex],
      companies: newPlayers[activeIndex].companies.map(c => ({ ...c, moved: false, specialMovement: undefined, extraRegionDistance: undefined })),
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
          hazardsEncountered: [],
        },
      },
    };
  }
  return { state, error: `Unexpected action '${action.type}' in long-event phase` };
}

/**
 * Handle playing a resource short-event card during the long-event phase.
 *
 * Removes the card from hand, discards it, and if it has a `fetch-to-deck`
 * effect, sets up the pendingFetch sub-flow on the phase state.
 */


/**
 * Handle playing a resource short-event card during the long-event phase.
 *
 * Removes the card from hand, discards it, and if it has a `fetch-to-deck`
 * effect, sets up the pendingFetch sub-flow on the phase state.
 */
export function handlePlayResourceShortEvent(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'play-short-event') return { state, error: 'Expected play-short-event action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const cardIdx = player.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIdx === -1) return { state, error: 'Card not in hand' };

  const handCard = player.hand[cardIdx];
  const def = state.cardPool[handCard.definitionId as string];
  if (!def || def.cardType !== 'hero-resource-event' || def.eventType !== 'short') {
    return { state, error: 'Card is not a resource short-event' };
  }

  logDetail(`Playing resource short-event: ${def.name} (${action.cardInstanceId as string})`);

  const newHand = [...player.hand];
  newHand.splice(cardIdx, 1);

  // Apply play-target tap cost (e.g. Stealth taps the chosen scout). The
  // legal-actions emitter generates one play-short-event action per eligible
  // target, so the targetScoutInstanceId here is guaranteed to be one of
  // them. We tap the character before any other effect resolution so the
  // visible state matches the player's expectation immediately.
  let newCharacters = player.characters;
  if (action.targetScoutInstanceId) {
    const targetCharId = action.targetScoutInstanceId as string;
    const targetChar = player.characters[targetCharId];
    if (!targetChar) {
      return { state, error: `Target scout ${targetCharId} not in play` };
    }
    if (targetChar.status !== CardStatus.Untapped) {
      return { state, error: `Target scout ${targetCharId} is already tapped` };
    }
    logDetail(`${def.name} taps target scout ${targetCharId}`);
    newCharacters = {
      ...player.characters,
      [targetCharId]: { ...targetChar, status: CardStatus.Tapped },
    };
  }

  // Handle DSL-declared play-option `set-character-status` applies (e.g.
  // Halfling Strength's untap / heal options). Constraint-producing applies
  // are resolved below against the fully-updated state via addConstraint.
  const selectedOption = action.optionId
    ? (def.effects?.find(
        e => e.type === 'play-option' && e.id === action.optionId,
      ) as import('../types/effects.js').PlayOptionEffect | undefined)
    : undefined;

  if (action.optionId && !selectedOption) {
    return { state, error: `${def.name} has no play-option with id '${action.optionId}'` };
  }

  if (selectedOption && action.targetCharacterId && selectedOption.apply.type === 'set-character-status') {
    const targetId = action.targetCharacterId as string;
    const targetChar = newCharacters[targetId];
    if (!targetChar) {
      return { state, error: `Target character ${targetId} not in play` };
    }
    const nextStatus = selectedOption.apply.status;
    if (nextStatus === undefined) {
      return { state, error: `${def.name} option '${selectedOption.id}': set-character-status missing status` };
    }
    const statusEnum = nextStatus === 'untapped' ? CardStatus.Untapped
      : nextStatus === 'tapped' ? CardStatus.Tapped
        : CardStatus.Inverted;
    logDetail(`${def.name} option "${selectedOption.id}": set ${targetId} status → ${nextStatus}`);
    newCharacters = { ...newCharacters, [targetId]: { ...targetChar, status: statusEnum } };

    // company-rule: healing-affects-all — if this was a heal (wounded → well),
    // extend the healing to all other wounded characters in the same company
    const isHeal = targetChar.status === CardStatus.Inverted && statusEnum !== CardStatus.Inverted;
    if (isHeal) {
      const company = player.companies.find(c => c.characters.includes(action.targetCharacterId!));
      if (company) {
        const hasHealingRule = company.characters.some(charId => {
          const ch = newCharacters[charId as string];
          if (!ch) return false;
          const charDef = state.cardPool[ch.definitionId as string];
          return charDef && 'effects' in charDef &&
            (charDef as { effects?: readonly import('../types/effects.js').CardEffect[] }).effects?.some(
              e => e.type === 'company-rule' && e.rule === 'healing-affects-all',
            );
        });
        if (hasHealingRule) {
          for (const charId of company.characters) {
            const cid = charId as string;
            if (cid === targetId) continue;
            const ch = newCharacters[cid];
            if (ch && ch.status === CardStatus.Inverted) {
              logDetail(`company-rule healing-affects-all: extending heal to ${cid}`);
              newCharacters = { ...newCharacters, [cid]: { ...ch, status: statusEnum } };
            }
          }
        }
      }
    }
  }

  // Collect fetch-to-deck effects — these need a sub-flow because the player
  // picks from face-down piles (sideboard / discard) and the choice must be
  // serialised as a separate action. Discard-in-play is resolved inline
  // below: the target is already chosen on the play action.
  const interactiveEffects: PendingEffect[] = (def.effects ?? [])
    .filter(e => e.type === 'fetch-to-deck')
    .map(effect => ({
      type: 'card-effect' as const,
      cardInstanceId: handCard.instanceId,
      effect,
      ...(action.targetScoutInstanceId ? { targetCharacterId: action.targetScoutInstanceId } : {}),
    }));

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...player, hand: newHand, characters: newCharacters };

  // Apply self-enters-play on-event effects (e.g. Stealth's add-constraint).
  // These are non-interactive and resolved immediately when the card is played.
  let newState: GameState = { ...state, players: newPlayers };
  newState = applyShortEventOnEntersPlay(newState, def, handCard, action, playerIndex);

  // If the selected play-option is an `add-constraint` apply targeting the
  // chosen character, add it via the generic DSL handler. The constraint
  // kind, scope, and optional numeric payload come straight from the card
  // JSON — no per-card branches here.
  if (selectedOption && action.targetCharacterId && selectedOption.apply.type === 'add-constraint') {
    const constraintResult = applyPlayOptionAddConstraint(
      newState, def, handCard, selectedOption, action.targetCharacterId,
    );
    if ('error' in constraintResult) return { state, error: constraintResult.error };
    newState = constraintResult.state;
  }

  // Resolve discard-in-play inline (e.g. Marvels Told). The target was
  // chosen by the legal-action emitter as part of the play action, so no
  // sub-flow is needed: we move the target to its owner's discard pile
  // and enqueue the post-discard corruption check, then the event card
  // itself is discarded below.
  const discardInPlay = def.effects?.find(e => e.type === 'discard-in-play');
  if (discardInPlay) {
    if (!action.discardTargetInstanceId) {
      return { state, error: `${def.name} requires a discardTargetInstanceId` };
    }
    const targetId = action.discardTargetInstanceId;
    let foundOwnerIndex = -1;
    let foundCardIdx = -1;
    for (let oi = 0; oi < newState.players.length; oi++) {
      const idx = newState.players[oi].cardsInPlay.findIndex(c => c.instanceId === targetId);
      if (idx !== -1) { foundOwnerIndex = oi; foundCardIdx = idx; break; }
    }
    if (foundOwnerIndex === -1) {
      return { state, error: `Discard target ${targetId as string} not in play` };
    }
    const owner = newState.players[foundOwnerIndex];
    const targetCard = owner.cardsInPlay[foundCardIdx];
    const targetDef = newState.cardPool[targetCard.definitionId as string];
    if (!targetDef || !matchesCondition(discardInPlay.filter, targetDef as unknown as Record<string, unknown>)) {
      return { state, error: `${def.name}: target does not match discard filter` };
    }
    logDetail(`${def.name} discards ${targetDef.name} from ${owner.id as string}'s in-play`);
    const newOwnerCardsInPlay = [...owner.cardsInPlay];
    newOwnerCardsInPlay.splice(foundCardIdx, 1);
    const updatedPlayers = clonePlayers(newState);
    updatedPlayers[foundOwnerIndex] = {
      ...owner,
      cardsInPlay: newOwnerCardsInPlay,
      discardPile: [...owner.discardPile, { instanceId: targetCard.instanceId, definitionId: targetCard.definitionId }],
    };
    newState = { ...newState, players: updatedPlayers };

    if (discardInPlay.corruptionCheck && action.targetScoutInstanceId) {
      newState = enqueueResolution(newState, {
        source: handCard.instanceId,
        actor: action.player,
        scope: { kind: 'phase' as const, phase: newState.phaseState.phase },
        kind: {
          type: 'corruption-check',
          characterId: action.targetScoutInstanceId,
          modifier: discardInPlay.corruptionCheck.modifier,
          reason: def.name,
          possessions: [],
          transferredItemId: null,
        },
      });
    }
  }

  if (interactiveEffects.length > 0) {
    // Card goes to player's cardsInPlay (visible on table) while effects resolve
    logDetail(`${def.name} → cardsInPlay, resolving ${interactiveEffects.length} effect(s)`);
    const updatedPlayers = clonePlayers(newState);
    updatedPlayers[playerIndex] = {
      ...newState.players[playerIndex],
      cardsInPlay: [...newState.players[playerIndex].cardsInPlay, { instanceId: handCard.instanceId, definitionId: handCard.definitionId, status: CardStatus.Untapped }],
    };
    return {
      state: {
        ...newState,
        players: updatedPlayers,
        pendingEffects: [...newState.pendingEffects, ...interactiveEffects],
      },
    };
  }

  // No interactive effects: discard immediately
  const updatedPlayers = clonePlayers(newState);
  updatedPlayers[playerIndex] = {
    ...newState.players[playerIndex],
    discardPile: [...newState.players[playerIndex].discardPile, handCard],
  };
  return { state: { ...newState, players: updatedPlayers } };
}

/**
 * Resolves a {@link PlayOptionEffect} whose `apply.type` is `add-constraint`
 * into a concrete {@link ActiveConstraint} placed on the targeted character.
 * Reads constraint kind, scope, and optional numeric payload straight from
 * the DSL so no per-card code is needed.
 */
function applyPlayOptionAddConstraint(
  state: GameState,
  def: { name: string },
  handCard: CardInstance,
  option: import('../types/effects.js').PlayOptionEffect,
  targetCharacterId: import('../types/common.js').CardInstanceId,
): { state: GameState } | { error: string } {
  const apply = option.apply;
  const constraintName = apply.constraint;
  const scopeName = apply.scope;
  if (!constraintName || !scopeName) {
    return { error: `${def.name} option '${option.id}': add-constraint missing constraint or scope` };
  }

  let scope: import('../types/pending.js').ConstraintScope;
  switch (scopeName) {
    case 'turn':
      scope = { kind: 'turn' };
      break;
    case 'until-cleared':
      scope = { kind: 'until-cleared' };
      break;
    default:
      return { error: `${def.name} option '${option.id}': unsupported scope '${scopeName}' for character-targeted add-constraint` };
  }

  type Kind = import('../types/pending.js').ActiveConstraint['kind'];
  let kind: Kind;
  switch (constraintName) {
    case 'check-modifier':
      if (typeof apply.value !== 'number' || typeof apply.check !== 'string') {
        return { error: `${def.name} option '${option.id}': check-modifier requires 'check' and numeric 'value'` };
      }
      kind = { type: 'check-modifier', check: apply.check, value: apply.value };
      break;
    default:
      return { error: `${def.name} option '${option.id}': unsupported constraint kind '${constraintName}' for character target` };
  }

  logDetail(`${def.name} option "${option.id}": add ${constraintName} on character ${targetCharacterId as string}, scope ${scopeName}`);
  return {
    state: addConstraint(state, {
      source: handCard.instanceId,
      sourceDefinitionId: handCard.definitionId,
      scope,
      target: { kind: 'character', characterId: targetCharacterId },
      kind,
    }),
  };
}

/**
 * Process `on-event: self-enters-play` effects for a resource short-event.
 * Currently handles `add-constraint` effects, where the target company is
 * derived from the action's target scout.
 */
function applyShortEventOnEntersPlay(
  state: GameState,
  def: { name: string; effects?: readonly import('../types/effects.js').CardEffect[] },
  handCard: CardInstance,
  action: GameAction,
  playerIndex: number,
): GameState {
  if (!def.effects) return state;

  for (const effect of def.effects) {
    if (effect.type !== 'on-event' || effect.event !== 'self-enters-play') continue;
    const onEvent = effect;

    if (onEvent.apply.type === 'add-constraint') {
      const constraintKind = onEvent.apply.constraint;
      const scopeName = onEvent.apply.scope;
      if (!constraintKind || !scopeName) continue;

      // Resolve the target company from the scout targeted by the action
      const targetCharId = action.type === 'play-short-event' ? action.targetScoutInstanceId : undefined;
      if (!targetCharId) {
        logDetail(`add-constraint(${constraintKind}): no target scout — fizzle`);
        continue;
      }

      const player = state.players[playerIndex];
      const company = player.companies.find(c => c.characters.includes(targetCharId));
      if (!company) {
        logDetail(`add-constraint(${constraintKind}): scout ${targetCharId as string} not in any company — fizzle`);
        continue;
      }

      // Map scope name to ConstraintScope
      let scope: import('../types/pending.js').ConstraintScope;
      switch (scopeName) {
        case 'turn':
          scope = { kind: 'turn' };
          break;
        case 'company-mh-phase':
          scope = { kind: 'company-mh-phase', companyId: company.id };
          break;
        case 'company-site-phase':
          scope = { kind: 'company-site-phase', companyId: company.id };
          break;
        case 'until-cleared':
          scope = { kind: 'until-cleared' };
          break;
        default:
          logDetail(`add-constraint(${constraintKind}): unknown scope "${scopeName}" — fizzle`);
          continue;
      }

      // Map constraint name to kind
      type Kind = import('../types/pending.js').ActiveConstraint['kind'];
      let kind: Kind;
      switch (constraintKind) {
        case 'no-creature-hazards-on-company':
          kind = { type: 'no-creature-hazards-on-company' };
          break;
        case 'site-phase-do-nothing':
          kind = onEvent.apply.cancelWhen
            ? { type: 'site-phase-do-nothing', cancelWhen: onEvent.apply.cancelWhen }
            : { type: 'site-phase-do-nothing' };
          break;
        case 'deny-scout-resources':
          kind = { type: 'deny-scout-resources' };
          break;
        case 'cancel-hazard-by-tap':
          kind = { type: 'cancel-hazard-by-tap' };
          break;
        default:
          logDetail(`add-constraint: unknown constraint kind "${constraintKind}" — fizzle`);
          continue;
      }

      logDetail(`"${def.name}" played — adding constraint ${constraintKind} on company ${company.id as string}, scope ${scopeName}`);
      state = addConstraint(state, {
        source: handCard.instanceId,
        sourceDefinitionId: handCard.definitionId,
        scope,
        target: { kind: 'company', companyId: company.id },
        kind,
      });
    }
  }

  return state;
}

/**
 * Handle fetching a card from sideboard or discard pile into the play deck.
 *
 * Part of the fetch-to-deck effect resolution. The current effect is the
 * first entry in {@link GameState.pendingEffects}. After the fetch,
 * the effect is consumed; if no more effects remain, the event card moves
 * from cardsInPlay to the player's discard pile.
 */


/**
 * Handle playing a resource long-event card during the long-event phase.
 * Removes the card from hand, places it on the chain, and initiates/pushes
 * a chain of effects. The card enters play upon resolution (see chain-reducer).
 */
function handlePlayLongEvent(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'play-long-event') return { state, error: 'Expected play-long-event action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const cardIdx = player.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIdx === -1) return { state, error: 'Card not in hand' };

  const handCard = player.hand[cardIdx];
  const def = state.cardPool[handCard.definitionId as string];
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

  logDetail(`Playing resource long-event: ${def.name} → enters chain`);

  // Remove card from hand — it now resides on the chain
  const newHand = [...player.hand];
  newHand.splice(cardIdx, 1);

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...player, hand: newHand };
  let newState: GameState = { ...state, players: newPlayers };

  // Initiate or push onto chain — card enters play upon resolution
  if (newState.chain === null) {
    newState = initiateChain(newState, action.player, handCard, { type: 'long-event' });
  } else {
    newState = pushChainEntry(newState, action.player, handCard, { type: 'long-event' });
  }

  return { state: newState };
}

/**
 * Handle actions during the Movement/Hazard phase.
 *
 * The phase begins with the 'select-company' step where the resource player
 * picks which company to handle next. After all companies are handled, the
 * phase advances to the Site phase.
 */

