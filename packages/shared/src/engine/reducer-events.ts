/**
 * @module reducer-events
 *
 * Event card handlers for the game reducer. Covers playing permanent events,
 * short events, long events, and resource short events. These handlers are
 * shared across multiple phases (organization, long-event, movement/hazard).
 */

import type { GameState, CardInstance, CardInstanceId, ChainEntryPayload, PendingEffect, GameAction } from '../index.js';
import { Phase, CardStatus, getPlayerIndex, BASE_MAX_REGION_DISTANCE } from '../index.js';
import { logDetail } from './legal-actions/log.js';
import { initiateChain, pushChainEntry } from './chain-reducer.js';
import { resolveInstanceId } from '../types/state.js';
import { revealInstances } from './visibility.js';
import type { ReducerResult } from './reducer-utils.js';
import { updatePlayer, updateCharacter, wrongActionType } from './reducer-utils.js';
import { triggerCouncilCall } from './reducer-end-of-turn.js';
import { addConstraint, enqueueCorruptionCheck } from './pending.js';
import { findMoveEffectByShape } from './reducer-move.js';
import { handleGrantActionApply } from './reducer-organization.js';


/**
 * Handle playing a permanent-event resource card.
 * Removes the card from hand, places it on the chain, and initiates/pushes
 * a chain of effects. The card enters play upon resolution (see chain-reducer).
 */
export function handlePlayPermanentEvent(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'play-permanent-event') return wrongActionType(state, action, 'play-permanent-event');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const cardIdx = player.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  const handCard = player.hand[cardIdx];
  const def = state.cardPool[handCard.definitionId as string] as import('../types/cards-resources.js').HeroResourceEventCard;

  logDetail(`Playing permanent event: ${def.name} → enters chain`);

  // Remove card from hand — it now resides on the chain
  const newHand = [...player.hand];
  newHand.splice(cardIdx, 1);

  let newState: GameState = updatePlayer(state, playerIndex, p => ({ ...p, hand: newHand }));

  // Discard a card as a play cost (e.g. Sapling of the White Tree for The White Tree)
  if (action.discardCardInstanceId) {
    logDetail(`Discarding ${action.discardCardInstanceId as string} as play cost for ${def.name}`);
    let found = false;
    // Check character items
    for (const [charId, ch] of Object.entries(newState.players[playerIndex].characters)) {
      const itemIdx = ch.items.findIndex(i => i.instanceId === action.discardCardInstanceId);
      if (itemIdx !== -1) {
        const item = ch.items[itemIdx];
        const newItems = [...ch.items];
        newItems.splice(itemIdx, 1);
        newState = updatePlayer(newState, playerIndex, p => ({
          ...updateCharacter(p, charId, c => ({ ...c, items: newItems })),
          discardPile: [...p.discardPile, { instanceId: item.instanceId, definitionId: item.definitionId }],
        }));
        logDetail(`Discarded item ${item.definitionId as string} from character ${charId}`);
        found = true;
        break;
      }
    }
    // Check out-of-play pile (stored items)
    if (!found) {
      const oopIdx = newState.players[playerIndex].outOfPlayPile.findIndex(
        c => c.instanceId === action.discardCardInstanceId,
      );
      if (oopIdx !== -1) {
        const card = newState.players[playerIndex].outOfPlayPile[oopIdx];
        const newOop = [...newState.players[playerIndex].outOfPlayPile];
        newOop.splice(oopIdx, 1);
        newState = updatePlayer(newState, playerIndex, p => ({
          ...p,
          outOfPlayPile: newOop,
          discardPile: [...p.discardPile, { instanceId: card.instanceId, definitionId: card.definitionId }],
        }));
        logDetail(`Discarded stored card ${card.definitionId as string} from out-of-play pile`);
      }
    }
  }

  // Initiate or push onto chain — card enters play upon resolution.
  // Forward targetCharacterId (if any) through the payload so that
  // character-targeting permanent resource events (e.g. Align Palantír,
  // Rebel-talk) attach to the character on resolution instead of going
  // into general cardsInPlay.
  const payload: import('../index.js').ChainEntryPayload = {
    type: 'permanent-event',
    ...(action.targetCharacterId ? { targetCharacterId: action.targetCharacterId } : {}),
    ...(action.targetSiteDefinitionId ? { targetSiteDefinitionId: action.targetSiteDefinitionId } : {}),
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
  if (action.type !== 'play-short-event') return wrongActionType(state, action, 'play-short-event');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const cardIdx = player.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  const handCard = player.hand[cardIdx];
  const def = state.cardPool[handCard.definitionId as string] as import('../types/cards-hazards.js').HazardEventCard;

  const targetDefId = resolveInstanceId(state, action.targetInstanceId!);
  const targetDef = targetDefId ? state.cardPool[targetDefId as string] : undefined;
  logDetail(`Playing short event ${def.name}: targeting environment ${targetDef?.name ?? action.targetInstanceId} (chain will resolve the cancel)`);

  // Move short event from hand → discard
  const newHand = [...player.hand];
  newHand.splice(cardIdx, 1);

  let newState: GameState = updatePlayer(state, playerIndex, p => ({
    ...p,
    hand: newHand,
    discardPile: [...p.discardPile, handCard],
  }));

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
  // Rule 2.1.1: any-phase grant-actions (Cram, Orc-draughts). The
  // legal-action emitter filters to `anyPhase: true` effects during
  // long-event phase, so we delegate unconditionally.
  if (action.type === 'activate-granted-action') {
    return handleGrantActionApply(state, action);
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

    let afterPass = updatePlayer(state, hazardPlayerIndex, p => ({
      ...p,
      cardsInPlay: remainingCards,
      discardPile: [...p.discardPile, ...discardedEvents],
    }));

    // Reset moved flags on the active player's companies for the new M/H phase
    const activeIndex = getPlayerIndex(state, activePlayer);
    afterPass = updatePlayer(afterPass, activeIndex, p => ({
      ...p,
      companies: p.companies.map(c => ({ ...c, moved: false, specialMovement: undefined, extraRegionDistance: undefined })),
    }));

    logDetail(`Long-event: active player ${action.player as string} passed → advancing to Movement/Hazard phase`);
    return {
      state: {
        ...afterPass,
        phaseState: {
          phase: Phase.MovementHazard,
          step: 'select-company',
          activeCompanyIndex: 0,
          handledCompanyIds: [],
          movementType: null,
          declaredRegionPath: [],
          maxRegionDistance: BASE_MAX_REGION_DISTANCE,
          hazardsPlayedThisCompany: 0,
          hazardLimitAtReveal: 0,
          preRevealHazardLimitConstraintIds: [],
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
          ahuntAttacksResolved: 0,
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
  if (action.type !== 'play-short-event') return wrongActionType(state, action, 'play-short-event');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const cardIdx = player.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  const handCard = player.hand[cardIdx];
  const def = state.cardPool[handCard.definitionId as string] as import('../types/cards-resources.js').HeroResourceEventCard;

  logDetail(`Playing resource short-event: ${def.name} (${action.cardInstanceId as string})`);

  // Resource short events skip the chain today — the played card goes
  // straight to the owner's face-down discard pile (see TODO in
  // `visibility.ts`). Announce the identity explicitly so the opponent
  // toast can name the card even though no public pile ever held it.
  state = revealInstances(state, [handCard]);

  const newHand = [...player.hand];
  newHand.splice(cardIdx, 1);

  // Resource-side `call-council` (e.g. Sudden Call, le-235): the card
  // triggers the endgame — discard the card, bypass normal short-event
  // effects, and apply the council-call state transition (opponent gets
  // the last turn).
  const resourceCallCouncil = def.effects?.find(
    (e): e is import('../types/effects.js').CallCouncilEffect =>
      e.type === 'call-council' && e.lastTurnFor === 'opponent',
  );
  if (resourceCallCouncil) {
    const afterDiscard = updatePlayer(state, playerIndex, p => ({
      ...p,
      hand: newHand,
      discardPile: [...p.discardPile, handCard],
    }));
    return { state: triggerCouncilCall(afterDiscard, action.player, 'opponent') };
  }

  // Apply play-target tap cost (e.g. Stealth taps the chosen scout). The
  // legal-actions emitter generates one play-short-event action per eligible
  // target, so the targetScoutInstanceId here is guaranteed to be one of
  // them. We tap the character before any other effect resolution so the
  // visible state matches the player's expectation immediately.
  let newCharacters = player.characters;
  if (action.targetScoutInstanceId) {
    const targetCharId = action.targetScoutInstanceId as string;
    const targetChar = player.characters[targetCharId];
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

  if (selectedOption && action.targetCharacterId && selectedOption.apply.type === 'set-character-status') {
    const targetId = action.targetCharacterId as string;
    const targetChar = newCharacters[targetId];
    const nextStatus = selectedOption.apply.status;
    if (nextStatus === undefined) {
      return { state, error: `${def.name} option '${selectedOption.id}': set-character-status missing status` };
    }
    const statusEnum = nextStatus === 'untapped' ? CardStatus.Untapped
      : nextStatus === 'tapped' ? CardStatus.Tapped
        : CardStatus.Inverted;
    logDetail(`${def.name} option "${selectedOption.id}": set ${targetId} status → ${nextStatus}`);
    newCharacters = { ...newCharacters, [targetId]: { ...targetChar, status: statusEnum } };

    // healing-affects-all — if this was a heal (wounded → well), extend
    // the healing to all other wounded characters in the same company.
    // Triggers either from a character in the company carrying the
    // `company-rule` variant (e.g. Ioreth) or from the company's current
    // site carrying the `site-rule` variant (e.g. Rhosgobel, Old Forest).
    const isHeal = targetChar.status === CardStatus.Inverted && statusEnum !== CardStatus.Inverted;
    if (isHeal) {
      const company = player.companies.find(c => c.characters.includes(action.targetCharacterId!));
      if (company) {
        const hasCompanyRule = company.characters.some(charId => {
          const ch = newCharacters[charId as string];
          if (!ch) return false;
          const charDef = state.cardPool[ch.definitionId as string];
          return charDef && 'effects' in charDef &&
            (charDef as { effects?: readonly import('../types/effects.js').CardEffect[] }).effects?.some(
              e => e.type === 'company-rule' && e.rule === 'healing-affects-all',
            );
        });
        let hasSiteRule = false;
        if (company.currentSite) {
          const siteDef = state.cardPool[company.currentSite.definitionId as string];
          hasSiteRule = !!(siteDef && 'effects' in siteDef &&
            (siteDef as { effects?: readonly import('../types/effects.js').CardEffect[] }).effects?.some(
              e => e.type === 'site-rule' && e.rule === 'healing-affects-all',
            ));
        }
        if (hasCompanyRule || hasSiteRule) {
          const source = hasCompanyRule ? 'company-rule' : 'site-rule';
          for (const charId of company.characters) {
            const cid = charId as string;
            if (cid === targetId) continue;
            const ch = newCharacters[cid];
            if (ch && ch.status === CardStatus.Inverted) {
              logDetail(`${source} healing-affects-all: extending heal to ${cid}`);
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

  let newState: GameState = updatePlayer(state, playerIndex, p => ({ ...p, hand: newHand, characters: newCharacters }));

  // Apply self-enters-play on-event effects (e.g. Stealth's add-constraint).
  // These are non-interactive and resolved immediately when the card is played.
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
  // itself is discarded below. The target may live either in the owner's
  // general cards-in-play list (Eye of Sauron long-events, free-standing
  // permanent-events) or attached to one of their characters as a hazard
  // (Foolish Words, Lure of the Senses, etc.).
  const discardInPlay = findMoveEffectByShape(def, 'target', 'in-play', 'discard');
  if (discardInPlay) {
    const targetId = action.discardTargetInstanceId!;
    let foundOwnerIndex = -1;
    let foundCardsInPlayIdx = -1;
    let foundCharId: string | null = null;
    let foundHazardIdx = -1;
    for (let oi = 0; oi < newState.players.length; oi++) {
      const idx = newState.players[oi].cardsInPlay.findIndex(c => c.instanceId === targetId);
      if (idx !== -1) { foundOwnerIndex = oi; foundCardsInPlayIdx = idx; break; }
      const chars = newState.players[oi].characters;
      for (const charId of Object.keys(chars)) {
        const hIdx = chars[charId].hazards.findIndex(h => h.instanceId === targetId);
        if (hIdx !== -1) { foundOwnerIndex = oi; foundCharId = charId; foundHazardIdx = hIdx; break; }
      }
      if (foundOwnerIndex !== -1) break;
    }
    const owner = newState.players[foundOwnerIndex];
    let targetInstance: { instanceId: CardInstanceId; definitionId: import('../index.js').CardDefinitionId };
    if (foundCardsInPlayIdx !== -1) {
      const targetCard = owner.cardsInPlay[foundCardsInPlayIdx];
      targetInstance = { instanceId: targetCard.instanceId, definitionId: targetCard.definitionId };
      const newOwnerCardsInPlay = [...owner.cardsInPlay];
      newOwnerCardsInPlay.splice(foundCardsInPlayIdx, 1);
      newState = updatePlayer(newState, foundOwnerIndex, p => ({
        ...p,
        cardsInPlay: newOwnerCardsInPlay,
        discardPile: [...p.discardPile, targetInstance],
      }));
    } else {
      const charId = foundCharId!;
      const char = owner.characters[charId];
      const haz = char.hazards[foundHazardIdx];
      targetInstance = { instanceId: haz.instanceId, definitionId: haz.definitionId };
      const newHazards = [...char.hazards];
      newHazards.splice(foundHazardIdx, 1);
      newState = updatePlayer(newState, foundOwnerIndex, p => ({
        ...updateCharacter(p, charId, c => ({ ...c, hazards: newHazards })),
        discardPile: [...p.discardPile, targetInstance],
      }));
    }
    const targetDef = newState.cardPool[targetInstance.definitionId as string];
    logDetail(`${def.name} discards ${targetDef.name} from ${owner.id as string}'s in-play`);

    if (discardInPlay.corruptionCheck && action.targetScoutInstanceId) {
      newState = enqueueCorruptionCheck(newState, {
        source: handCard.instanceId,
        actor: action.player,
        scope: { kind: 'phase' as const, phase: newState.phaseState.phase },
        characterId: action.targetScoutInstanceId,
        modifier: discardInPlay.corruptionCheck.modifier,
        reason: def.name,
      });
    }
  }

  // Handle bounce-hazard-events: return all hazard permanent-events
  // on characters in the target wizard's company to the opponent's hand,
  // then enqueue a corruption check on the wizard.
  const bounceEffect = def.effects?.find(e => e.type === 'bounce-hazard-events');
  if (bounceEffect && bounceEffect.type === 'bounce-hazard-events' && action.targetCharacterId) {
    const wizardId = action.targetCharacterId;
    const company = newState.players[playerIndex].companies.find(
      c => c.characters.includes(wizardId),
    );
    if (company) {
      const opponentIndex = (playerIndex + 1) % newState.players.length;
      const bouncedCards: CardInstance[] = [];

      for (const charId of company.characters) {
        const char = newState.players[playerIndex].characters[charId as string];
        if (!char) continue;
        const remaining: import('../index.js').CardInPlay[] = [];
        for (const haz of char.hazards) {
          const hazDef = newState.cardPool[haz.definitionId as string];
          if (hazDef && hazDef.cardType === 'hazard-event' && 'eventType' in hazDef && (hazDef as { eventType: string }).eventType === 'permanent') {
            logDetail(`${def.name}: returning ${hazDef.name} from ${charId as string} to opponent's hand`);
            bouncedCards.push({ instanceId: haz.instanceId, definitionId: haz.definitionId });
          } else {
            remaining.push(haz);
          }
        }
        if (remaining.length !== char.hazards.length) {
          newState = updatePlayer(newState, playerIndex, p =>
            updateCharacter(p, charId as string, c => ({ ...c, hazards: remaining })),
          );
        }
      }

      if (bouncedCards.length > 0) {
        newState = updatePlayer(newState, opponentIndex, p => ({
          ...p,
          hand: [...p.hand, ...bouncedCards],
        }));
        logDetail(`${def.name}: returned ${bouncedCards.length} hazard permanent-event(s) to opponent's hand`);
      }

      // Enqueue corruption check on the wizard
      newState = enqueueCorruptionCheck(newState, {
        source: handCard.instanceId,
        actor: action.player,
        scope: { kind: 'phase' as const, phase: newState.phaseState.phase },
        characterId: wizardId,
        modifier: bounceEffect.corruptionCheck.modifier,
        reason: def.name,
      });
    }
  }

  if (interactiveEffects.length > 0) {
    // Card goes to player's cardsInPlay (visible on table) while effects resolve
    logDetail(`${def.name} → cardsInPlay, resolving ${interactiveEffects.length} effect(s)`);
    const withCardInPlay = updatePlayer(newState, playerIndex, p => ({
      ...p,
      cardsInPlay: [...p.cardsInPlay, { instanceId: handCard.instanceId, definitionId: handCard.definitionId, status: CardStatus.Untapped }],
    }));
    return {
      state: {
        ...withCardInPlay,
        pendingEffects: [...withCardInPlay.pendingEffects, ...interactiveEffects],
      },
    };
  }

  // No interactive effects: discard immediately
  return {
    state: updatePlayer(newState, playerIndex, p => ({
      ...p,
      discardPile: [...p.discardPile, handCard],
    })),
  };
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

  // Company-targeted constraints: resolve the company from the target character
  const isCompanyTargeted = constraintName === 'hazard-limit-modifier';
  let companyId: import('../types/common.js').CompanyId | undefined;
  if (isCompanyTargeted) {
    const playerIndex = state.players.findIndex(p => targetCharacterId as string in p.characters);
    if (playerIndex < 0) {
      return { error: `${def.name} option '${option.id}': target character not found` };
    }
    const company = state.players[playerIndex].companies.find(c => c.characters.includes(targetCharacterId));
    if (!company) {
      return { error: `${def.name} option '${option.id}': target character not in any company` };
    }
    companyId = company.id;
  }

  let scope: import('../types/pending.js').ConstraintScope;
  switch (scopeName) {
    case 'turn':
      scope = { kind: 'turn' };
      break;
    case 'until-cleared':
      scope = { kind: 'until-cleared' };
      break;
    case 'company-mh-phase':
      if (!companyId) {
        return { error: `${def.name} option '${option.id}': company-mh-phase scope requires a company target` };
      }
      scope = { kind: 'company-mh-phase', companyId };
      break;
    default:
      return { error: `${def.name} option '${option.id}': unsupported scope '${scopeName}' for add-constraint` };
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
    case 'hazard-limit-modifier':
      if (typeof apply.value !== 'number') {
        return { error: `${def.name} option '${option.id}': hazard-limit-modifier requires numeric 'value'` };
      }
      kind = { type: 'hazard-limit-modifier', value: apply.value };
      break;
    default:
      return { error: `${def.name} option '${option.id}': unsupported constraint kind '${constraintName}'` };
  }

  const target: import('../types/pending.js').ActiveConstraint['target'] = isCompanyTargeted
    ? { kind: 'company', companyId: companyId! }
    : { kind: 'character', characterId: targetCharacterId };

  // METD §5: hazard-limit-modifier additions during the site phase have
  // no effect — the hazard limit is locked at the moment a company
  // reveals its new site.
  if (kind.type === 'hazard-limit-modifier' && state.phaseState.phase === Phase.Site) {
    logDetail(`${def.name} option "${option.id}": hazard-limit-modifier ignored — site-phase additions have no effect (METD §5)`);
    return { state };
  }

  logDetail(`${def.name} option "${option.id}": add ${constraintName} on ${isCompanyTargeted ? `company ${companyId as string}` : `character ${targetCharacterId as string}`}, scope ${scopeName}`);
  return {
    state: addConstraint(state, {
      source: handCard.instanceId,
      sourceDefinitionId: handCard.definitionId,
      scope,
      target,
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
          kind = { type: 'site-phase-do-nothing' };
          break;
        case 'deny-scout-resources':
          kind = { type: 'deny-scout-resources' };
          break;
        case 'granted-action': {
          const payload = onEvent.apply.grantedAction;
          if (!payload) {
            logDetail(`add-constraint(granted-action): missing grantedAction payload — fizzle`);
            continue;
          }
          kind = {
            type: 'granted-action',
            action: payload.action,
            phase: payload.phase as import('../types/state-phases.js').Phase,
            window: payload.window,
            cost: payload.cost,
            when: payload.when,
            apply: payload.apply,
          };
          break;
        }
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
  if (action.type !== 'play-long-event') return wrongActionType(state, action, 'play-long-event');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const cardIdx = player.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  const handCard = player.hand[cardIdx];
  const def = state.cardPool[handCard.definitionId as string] as import('../types/cards-resources.js').HeroResourceEventCard;

  logDetail(`Playing resource long-event: ${def.name} → enters chain`);

  // Remove card from hand — it now resides on the chain
  const newHand = [...player.hand];
  newHand.splice(cardIdx, 1);

  let newState: GameState = updatePlayer(state, playerIndex, p => ({ ...p, hand: newHand }));

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

