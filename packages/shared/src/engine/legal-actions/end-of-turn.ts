/**
 * @module legal-actions/end-of-turn
 *
 * Legal actions during the end-of-turn phase (CoE 2.VI).
 *
 * The phase has three steps:
 * 1. **discard** — Either player may voluntarily discard a card from hand.
 * 2. **reset-hand** — Both players draw or discard to reach base hand size (8).
 * 3. **signal-end** — Resource player signals end of turn and may call the
 *    Free Council to trigger the endgame.
 */

import type { GameState, PlayerId, GameAction, EvaluatedAction } from '../../index.js';
import { getPlayerIndex, canCallEndgameNow, isMinionOrBalrog, requirePhaseState } from '../../state-utils.js';
import { CardStatus } from '../../types/common.js';
import { Phase } from '../../types/state-phases.js';
import type { CardEffect, TriggeredAction, Condition } from '../../types/effects.js';
import { matchesDefinition, characterEntries, playerById, getCardEffects, defById, findCharacterCompany } from '../reducer-utils.js';
import { isCharacterCard, isSiteCard } from '../../types/cards.js';
import { getEffectiveSiteType } from '../effective.js';
import { matchesCondition } from '../../effects/condition-matcher.js';
import { buildGrantActionContext, grantedActionActivations, storedCombineGrantActions } from './organization.js';
import { resolveHandSize } from '../effects/index.js';
import { logHeading, logDetail } from './log.js';
import { deckExhaustExchangeActions } from './movement-hazard.js';
import { heroResourceShortEventActions } from './long-event.js';
import { recruitViaEventActions } from './recruit-via-event.js';
import { hasPlayFlag } from '../../effects/play-flags.js';
import { storeItemActions } from './organization-companies.js';
import { playPermanentEventActions } from './organization-events.js';
import { asViable as viable } from './evaluated.js';
import { grantedAction } from './granted-action-emit.js';

/**
 * Compute legal actions for a player during the end-of-turn phase.
 *
 * During the 'discard' step, both players may discard any card from hand
 * or pass. During 'reset-hand', players with too many cards must discard
 * and players with too few draw. During 'signal-end', only the active
 * player may pass (ending the turn) or call the Free Council.
 *
 * Rule 2.1.1: the active (resource) player may also play resource
 * short-events and resource permanent-events during the voluntary
 * `discard` and `signal-end` steps. They are not offered during
 * `reset-hand`, which is a mandatory draw/discard step enforced
 * sequentially by the reducer.
 *
 * CRF 22 (Turn Sequence Rulings, End-of-Turn Phase): "Cards may be played
 * during the End-of-Turn phase after hand size has been reconciled" — so
 * end-of-turn-phase grant-actions (e.g. Huntsman's Garb wh-92) are likewise
 * offered to the active player during both `discard` and `signal-end`, via
 * {@link endOfTurnGrantActions}.
 *
 * CRF 22 (A Chance Meeting tw-188): "May be played on your turn during any
 * phase the company is at a site" — this includes end-of-turn, so
 * character-recruitment events are also offered here via
 * {@link recruitViaEventActions}.
 *
 * Rule 2.1.1: the resource player may also activate any-phase grant-actions
 * (e.g. Gandalf tapping to test a gold ring in his company, tw-156) during
 * the end-of-turn phase, via {@link grantedActionActivations}.
 */
export function endOfTurnActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const eotState = requirePhaseState(state, Phase.EndOfTurn);
  const step = eotState.step;
  logHeading(`End-of-Turn legal actions: step '${step}' for player ${playerId as string}`);

  switch (step) {
    case 'discard': {
      const base = viable(discardStepActions(state, playerId));
      // The rule 2.1.1 / CRF extras are offered only while the player's
      // step-1 window is still open (`discardDone` not yet set) —
      // discardStepActions then guarantees a `pass` alongside them. Once the
      // player has acted, the step offers nothing; appending plays here
      // without that pass made any playable permanent event a FORCED play,
      // which livelocked the game with the Demon fána swap pair (playing
      // Flame of Udûn returns Great Shadow to hand and vice versa, forever).
      const playerIndex = getPlayerIndex(state, playerId);
      if (state.activePlayer === playerId && !eotState.discardDone[playerIndex]) {
        base.push(...heroResourceShortEventActions(state, playerId, 'end-of-turn'));
        base.push(...playPermanentEventActions(state, playerId));
        base.push(...recruitViaEventActions(state, playerId));
        base.push(...grantedActionActivations(state, playerId, 'anyPhase'));
        base.push(...storedCombineGrantActions(state, playerId, 'anyPhase'));
      }
      return base;
    }
    case 'reset-hand':
      return viable(resetHandStepActions(state, playerId));
    case 'signal-end': {
      const base = viable(signalEndStepActions(state, playerId));
      if (state.activePlayer === playerId) {
        base.push(...heroResourceShortEventActions(state, playerId, 'end-of-turn'));
        base.push(...playPermanentEventActions(state, playerId));
        base.push(...recruitViaEventActions(state, playerId));
        base.push(...grantedActionActivations(state, playerId, 'anyPhase'));
        base.push(...storedCombineGrantActions(state, playerId, 'anyPhase'));
      }
      return base;
    }
    default:
      return [];
  }
}

/**
 * Step 1: Either player may discard a card from their own hand, or pass.
 * Both players pass to advance to reset-hand.
 */
function discardStepActions(state: GameState, playerId: PlayerId): GameAction[] {
  const eotState = requirePhaseState(state, Phase.EndOfTurn);
  const playerIndex = getPlayerIndex(state, playerId);
  const player = state.players[playerIndex];

  // Already acted this step — no actions
  if (eotState.discardDone[playerIndex]) {
    logDetail(`End-of-Turn discard: player ${player.name} already acted, no actions`);
    return [];
  }

  const actions: GameAction[] = [];

  // Each card in hand can be discarded
  for (const card of player.hand) {
    actions.push({ type: 'discard-card', player: playerId, cardInstanceId: card.instanceId });
  }

  // Grant-action activations (e.g. Saruman's spell fetch) for the resource player
  if (state.activePlayer === playerId) {
    const grantActions = endOfTurnGrantActions(state, playerId);
    for (const ea of grantActions) {
      actions.push(ea.action);
    }
    // Great-road: offer haven-return for any eligible company
    for (const a of havenReturnActions(state, playerId)) {
      actions.push(a);
    }
    // Bill the Pony (tw-198): offer run-home for any eligible company
    for (const a of runHomeActions(state, playerId)) {
      actions.push(a);
    }
  }

  // Safe from the Shadow / Tokens to Show: allow-store-eot flag in cardsInPlay.
  // Unlike the grant-actions above, this is not restricted to the active
  // (resource) player — the card's text ("during the end-of-turn phase") grants
  // its bearer's owner a storing window on every end-of-turn phase, including
  // the opponent's turn (CoE 2.VI: "either player" acts during this phase).
  if (allowStoreEot(state, playerIndex)) {
    logDetail(`End-of-Turn discard: allow-store-eot in play for ${player.name} — adding store-item actions`);
    for (const ea of storeItemActions(state, playerId)) {
      actions.push(ea.action);
    }
  }

  // Always offer pass
  actions.push({ type: 'pass', player: playerId });

  logDetail(`End-of-Turn discard: player ${player.name} has ${player.hand.length} cards in hand, ${actions.length - 1} discard options + pass`);
  return actions;
}

/**
 * Step 2: Both players draw or discard to reach base hand size.
 * Players above hand size must discard; players below draw; at hand size, pass.
 */
function resetHandStepActions(state: GameState, playerId: PlayerId): GameAction[] {
  const eotState = requirePhaseState(state, Phase.EndOfTurn);
  const playerIndex = getPlayerIndex(state, playerId);
  const player = state.players[playerIndex];
  const handSize = resolveHandSize(state, playerIndex);
  const actions: GameAction[] = [];

  // Already done this step — no actions
  if (eotState.resetHandDone[playerIndex]) {
    logDetail(`End-of-Turn reset-hand: player ${player.name} already done, no actions`);
    return [];
  }

  // Deck exhaust exchange sub-flow: only exchange + pass actions
  if (player.deckExhaustPending) {
    return deckExhaustExchangeActions(state, player, playerId);
  }

  if (player.hand.length > handSize) {
    // Must discard down — offer each card as a discard option
    logDetail(`End-of-Turn reset-hand: player ${player.name} has ${player.hand.length} cards, must discard to ${handSize}`);
    for (const card of player.hand) {
      actions.push({ type: 'discard-card', player: playerId, cardInstanceId: card.instanceId });
    }
  } else if (player.hand.length < handSize) {
    if (player.playDeck.length === 0 && player.discardPile.length > 0) {
      // Deck empty but discard has cards — must exhaust before drawing
      logDetail(`End-of-Turn reset-hand: player ${player.name} deck empty — must exhaust`);
      actions.push({ type: 'deck-exhaust', player: playerId });
    } else if (player.playDeck.length === 0) {
      // No cards anywhere — pass
      logDetail(`End-of-Turn reset-hand: player ${player.name} has no cards to draw`);
      actions.push({ type: 'pass', player: playerId });
    } else {
      // Must draw up
      const drawCount = handSize - player.hand.length;
      logDetail(`End-of-Turn reset-hand: player ${player.name} has ${player.hand.length} cards, must draw ${drawCount} to reach ${handSize}`);
      actions.push({ type: 'draw-cards', player: playerId, count: drawCount });
    }
  } else {
    // At hand size — pass (nothing to do)
    logDetail(`End-of-Turn reset-hand: player ${player.name} already at hand size (${handSize})`);
    actions.push({ type: 'pass', player: playerId });
  }

  return actions;
}

/**
 * Step 3: Resource player signals end of turn. May also call the Free Council.
 * Per CoE 2.VI.iii, "no other action can be taken during this step unless it
 * is specifically allowed" — Safe from the Shadow's storing window is such an
 * allowance, so the non-active player only gets store-item actions here.
 */
function signalEndStepActions(state: GameState, playerId: PlayerId): GameAction[] {
  const playerIndex = getPlayerIndex(state, playerId);
  if (state.activePlayer !== playerId) {
    logDetail(`End-of-Turn signal-end: not the resource player`);
    const nonActiveActions: GameAction[] = [];
    if (allowStoreEot(state, playerIndex)) {
      const player = state.players[playerIndex];
      logDetail(`End-of-Turn signal-end: allow-store-eot in play for ${player.name} — adding store-item actions`);
      for (const ea of storeItemActions(state, playerId)) {
        nonActiveActions.push(ea.action);
      }
      // Storing is optional (CoE 2.II.4: "may attempt to store") — the
      // non-active player must be able to decline rather than being forced
      // to store every eligible item just because the window is open.
      nonActiveActions.push({ type: 'pass', player: playerId });
    } else {
      logDetail(`End-of-Turn signal-end: no allow-store-eot window — hazard player has no actions`);
    }
    return nonActiveActions;
  }

  const actions: GameAction[] = [];

  // CRF 22 (Turn Sequence Rulings, End-of-Turn Phase): "Cards may be played
  // during the End-of-Turn phase after hand size has been reconciled" — the
  // reset-hand step (2.VI.ii) has completed by the time signal-end begins, so
  // end-of-turn-phase grant-actions (e.g. Huntsman's Garb wh-92) must also be
  // offered here, not just during the discard step.
  const grantActions = endOfTurnGrantActions(state, playerId);
  for (const ea of grantActions) {
    actions.push(ea.action);
  }

  // Offer call-free-council if eligible (Short game rules).
  // Per CoE rule 10.41, Ringwraith and Balrog players cannot freely call —
  // they must play Sudden Call instead.
  const player = state.players[playerIndex];
  if (!player.freeCouncilCalled && state.lastTurnFor === null) {
    if (isMinionOrBalrog(player)) {
      logDetail(`End-of-Turn signal-end: ${player.name} (${player.alignment}) cannot freely call Free Council per rule 10.41 — must play Sudden Call`);
    } else if (canCallEndgameNow(player)) {
      const mp = player.marshallingPoints;
      const rawScore = mp.character + mp.item + mp.faction + mp.ally + mp.kill + mp.misc;
      logDetail(`End-of-Turn signal-end: ${player.name} eligible to call Free Council (raw MP ${rawScore}, exhaustions ${player.deckExhaustionCount})`);
      actions.push({ type: 'call-free-council', player: playerId });
    }
  }

  // Great-road: offer haven-return for any eligible company
  for (const a of havenReturnActions(state, playerId)) {
    actions.push(a);
  }

  // Bill the Pony (tw-198): offer run-home for any eligible company
  for (const a of runHomeActions(state, playerId)) {
    actions.push(a);
  }

  // Safe from the Shadow / Tokens to Show: allow-store-eot flag in cardsInPlay
  if (allowStoreEot(state, playerIndex)) {
    logDetail(`End-of-Turn signal-end: allow-store-eot in play for ${player.name} — adding store-item actions`);
    for (const ea of storeItemActions(state, playerId)) {
      actions.push(ea.action);
    }
  }

  actions.push({ type: 'pass', player: playerId });
  logDetail(`End-of-Turn signal-end: resource player ${playerId as string} may pass to end turn`);
  return actions;
}

/**
 * Generate `haven-return` actions for companies whose `haven-return-option`
 * constraint (placed by Great-road tw-249, or Ancient Stair dm-115) is still
 * active. Only the resource player may use this option. When the constraint
 * carries `requiresMovedToKeyword` (dm-115: "If company moved to an
 * Under-deeps site…"), the option is only offered if the company's site at
 * end of turn actually carries that keyword.
 */
function havenReturnActions(state: GameState, playerId: PlayerId): GameAction[] {
  if (state.activePlayer !== playerId) return [];
  const player = playerById(state, playerId)!;
  const actions: GameAction[] = [];
  for (const c of state.activeConstraints) {
    if (c.kind.type !== 'haven-return-option') continue;
    if (c.target.kind !== 'company') continue;
    const { companyId } = c.target;
    const company = player.companies.find(co => co.id === companyId);
    if (!company) continue;
    if (c.kind.requiresMovedToKeyword) {
      const currentSiteDef = company.currentSite
        ? defById(state, company.currentSite.definitionId) as { keywords?: readonly string[] } | undefined
        : undefined;
      if (!currentSiteDef?.keywords?.includes(c.kind.requiresMovedToKeyword)) {
        logDetail(`End-of-Turn: haven-return for company ${companyId as string} withheld — site does not carry required keyword ${c.kind.requiresMovedToKeyword}`);
        continue;
      }
    }
    logDetail(`End-of-Turn: offering haven-return for company ${companyId as string} (origin site ${c.kind.originHavenDefinitionId as string})`);
    actions.push({ type: 'haven-return', player: playerId, companyId });
  }
  return actions;
}

/**
 * Generate `run-home` actions for any company containing a `run-home-to-haven`
 * ally (Bill the Pony tw-198). Only the resource player may use this option,
 * and only when the ally's company is at a non-Haven, non-Under-deeps site
 * whose character count is within the ally's `maxCompanySize` and the site's
 * nearest haven is known.
 */
function runHomeActions(state: GameState, playerId: PlayerId): GameAction[] {
  if (state.activePlayer !== playerId) return [];
  const player = playerById(state, playerId)!;
  const actions: GameAction[] = [];
  for (const company of player.companies) {
    const site = company.currentSite;
    if (!site) continue;
    const siteDef = defById(state, site.definitionId);
    if (!siteDef || !isSiteCard(siteDef)) continue;

    // Non-Haven, non-Under-deeps site (the ability's precondition).
    const effType = getEffectiveSiteType(state, site.definitionId, siteDef.siteType, site.instanceId);
    if (effType === 'haven') {
      logDetail(`run-home: company ${company.id as string} is at a haven — skipping`);
      continue;
    }
    if (siteDef.keywords?.includes('under-deeps')) {
      logDetail(`run-home: company ${company.id as string} is at an Under-deeps site — skipping`);
      continue;
    }
    if (!siteDef.nearestHaven) {
      logDetail(`run-home: site ${siteDef.name} has no nearest haven — skipping`);
      continue;
    }

    // The reducer needs the haven card to be reachable: either a sibling
    // company already stands at it, or it sits in the location deck
    // (reducer-end-of-turn.ts). A deck need not carry the haven the site's
    // `nearestHaven` names at all — e.g. a Fallen-wizard deck whose sites
    // name "Rivendell" — and offering the action then guarantees the
    // rejection "nearest haven not found in location deck".
    const havenName = siteDef.nearestHaven;
    const havenAvailable = player.companies.some(c => {
      if (c.id === company.id || !c.currentSite) return false;
      const d = defById(state, c.currentSite.definitionId);
      return d !== undefined && isSiteCard(d) && d.name === havenName;
    }) || player.siteDeck.some(entry => {
      const d = defById(state, entry.definitionId);
      return d !== undefined && isSiteCard(d) && d.siteType === 'haven' && d.name === havenName;
    });
    if (!havenAvailable) {
      logDetail(`run-home: nearest haven ${havenName} is neither in the location deck nor under a sibling company — skipping`);
      continue;
    }

    const size = company.characters.length;
    for (const charId of company.characters) {
      const char = player.characters[charId];
      if (!char) continue;
      for (const ally of char.allies) {
        const allyDef = defById(state, ally.definitionId);
        const effect = getCardEffects(allyDef).find(e => e.type === 'run-home-to-haven');
        if (!effect || effect.type !== 'run-home-to-haven') continue;
        if (size > effect.maxCompanySize) {
          logDetail(`run-home: ${allyDef?.name ?? ally.definitionId as string} — company size ${size} exceeds max ${effect.maxCompanySize}`);
          continue;
        }
        logDetail(`run-home: offering ${allyDef?.name ?? ally.definitionId as string} to move company ${company.id as string} to nearest haven ${siteDef.nearestHaven}`);
        actions.push({ type: 'run-home', player: playerId, companyId: company.id, allyInstanceId: ally.instanceId });
      }
    }
  }
  return actions;
}

/**
 * Returns true if the active player has a permanent event with the
 * `allow-store-eot` play-flag in their `cardsInPlay`.
 */
function allowStoreEot(state: GameState, playerIndex: number): boolean {
  return state.players[playerIndex].cardsInPlay.some(card => {
    const def = state.cardPool[card.definitionId] as { readonly effects?: readonly import('../../types/effects.js').CardEffect[] } | undefined;
    return hasPlayFlag(def, 'allow-store-eot');
  });
}

/**
 * Finds the discard-pile fetch apply nested inside a grant-action's
 * `apply` field — either directly or as the first app of a `sequence`.
 * Matches two shapes:
 *  - discard-to-hand: `move` with `select: 'target'`, `from: 'discard'`,
 *    `to: 'hand'` (e.g. Saruman) — the specific card is chosen at
 *    activation time, so one action is offered per matching discard card.
 *  - discard-to-deck: `enqueue-pending-fetch` with `fetchFrom:
 *    ['discard-pile']` (e.g. Great Shadow ba-62) — the specific card is
 *    chosen via a follow-up `fetch-from-pile` pending resolution, so a
 *    single activation is offered whenever at least one card matches.
 * Returns the apply (carrying the DSL `filter`) or `null` if this
 * grant-action is not an end-of-turn discard-pile fetch.
 */
function findFetchApply(effect: CardEffect): TriggeredAction | null {
  if (effect.type !== 'grant-action' || !effect.apply) return null;
  const apply = effect.apply;
  if (isDiscardPileFetch(apply)) return apply;
  if (apply.type === 'sequence') {
    const apps = (apply as TriggeredAction & { apps?: readonly TriggeredAction[] }).apps;
    const first = apps?.[0];
    if (first && isDiscardPileFetch(first)) return first;
  }
  return null;
}

function isDiscardToHandMove(apply: TriggeredAction): boolean {
  return apply.type === 'move'
    && apply.select === 'target'
    && apply.from === 'discard'
    && apply.to === 'hand';
}

function isDiscardPileToDeckFetch(apply: TriggeredAction): boolean {
  return apply.type === 'enqueue-pending-fetch'
    && (apply.fetchFrom ?? ['discard-pile']).includes('discard-pile')
    && (apply.fetchTo ?? 'deck') === 'deck';
}

function isDiscardPileFetch(apply: TriggeredAction): boolean {
  return isDiscardToHandMove(apply) || isDiscardPileToDeckFetch(apply);
}

/**
 * Scans the resource player's characters (and their attached items) for
 * grant-action effects that activate during the end-of-turn phase —
 * those whose `apply` (or first step of a `sequence` apply) is a
 * discard-pile fetch (see {@link findFetchApply}). The keyword filter
 * comes from the apply's DSL `filter` condition against the candidate
 * card definition.
 *
 * Discard-to-hand fetches generate one action per eligible card in the
 * discard pile per source (the target is chosen at activation time).
 * Discard-to-deck fetches generate a single activation per source
 * whenever at least one card matches (the target is chosen afterward via
 * a `fetch-from-pile` pending resolution).
 *
 * Called from both the discard step and the signal-end step (CRF 22:
 * "Cards may be played during the End-of-Turn phase after hand size has
 * been reconciled") — but not reset-hand, which is a locked mandatory
 * draw/discard sequence with no side actions.
 */
function endOfTurnGrantActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId)!;
  const actions: EvaluatedAction[] = [];

  /**
   * Scan one "source" (a character's own definition, or an attached item)
   * for end-of-turn fetch grant-actions. `sourceCardId` is the card-instance
   * of the source; `charId` is the bearer-character instance that will pay
   * the tap cost. For character-direct grants these are the same.
   */
  function scanSource(
    charId: import('../../index.js').CardInstanceId,
    char: import('../../index.js').CharacterInPlay,
    sourceCardId: import('../../index.js').CardInstanceId,
    sourceDefinitionId: import('../../index.js').CardDefinitionId,
    sourceStatus: CardStatus,
  ): void {
    const sourceDef = defById(state, sourceDefinitionId);
    const source = { instanceId: sourceCardId, definitionId: sourceDefinitionId };
    for (const effect of getCardEffects(sourceDef)) {
      const fetchApply = findFetchApply(effect);
      if (!fetchApply || effect.type !== 'grant-action') continue;

      // Evaluate the grant-action's `when` gate (e.g. Indûr the Ringwraith's
      // "As your Ringwraith" → bearer.isRevealedAvatar). Built against the
      // bearer-character that pays the tap, so item-borne grants gate on the
      // bearer too.
      if (effect.when) {
        const charDef = defById(state, char.definitionId);
        const charDefCard = charDef && isCharacterCard(charDef) ? charDef : undefined;
        const company = findCharacterCompany(player.companies, charId);
        const ctx = buildGrantActionContext(state, char, charDefCard, company, player, sourceCardId);
        if (!matchesCondition(effect.when, ctx)) {
          logDetail(`Grant-action ${effect.action}: when condition failed on ${sourceDef?.name ?? sourceDefinitionId}`);
          continue;
        }
      }

      const filter: Condition | undefined = (fetchApply as { filter?: Condition }).filter;

      // Cost check.
      //  - `tap: 'self'` taps the source card itself: the character for a
      //    character-direct grant (Saruman), or the attached item for an
      //    item-borne grant (Huntsman's Garb wh-92 — "tap Huntsman's Garb",
      //    independent of the bearer's status). Either way the *source* must be
      //    untapped.
      //  - `tap: 'bearer'` taps the bearer character (Great Shadow ba-62).
      const costTap = effect.cost.tap;
      if (costTap === 'self' && sourceStatus !== CardStatus.Untapped) {
        logDetail(`Grant-action ${effect.action}: ${sourceDef?.name ?? sourceDefinitionId} is tapped, cannot activate`);
        continue;
      }
      if (costTap === 'bearer' && char.status !== CardStatus.Untapped) {
        logDetail(`Grant-action ${effect.action}: bearer of ${sourceDef?.name ?? sourceDefinitionId} is tapped, cannot activate`);
        continue;
      }

      const eligibleCards = player.discardPile.filter(card => {
        const def = defById(state, card.definitionId);
        if (!def) return false;
        if (!filter) return true;
        return matchesDefinition(def, filter);
      });

      if (eligibleCards.length === 0) {
        logDetail(`Grant-action ${effect.action}: no matching cards in discard pile`);
        continue;
      }

      if (isDiscardPileToDeckFetch(fetchApply)) {
        // The specific card is chosen afterward via a `fetch-from-pile`
        // pending resolution — a single activation suffices.
        logDetail(`Grant-action ${effect.action} available: ${sourceDef?.name ?? sourceDefinitionId} can fetch from discard to deck (${eligibleCards.length} eligible)`);
        actions.push(grantedAction(playerId, charId, source, effect.action, 0));
        continue;
      }

      for (const target of eligibleCards) {
        const targetDef = defById(state, target.definitionId);
        logDetail(`Grant-action ${effect.action} available: ${sourceDef?.name ?? sourceDefinitionId} can fetch ${targetDef?.name ?? '?'} from discard`);
        actions.push(grantedAction(playerId, charId, source, effect.action, 0, { targetCardId: target.instanceId }));
      }
    }
  }

  for (const [charId, char] of characterEntries(player)) {
    // Character's own grant-actions (e.g. Saruman) — `tap: self` taps the
    // character, so its status is the source status.
    scanSource(charId, char, charId, char.definitionId, char.status);
    // Attached items' grant-actions (e.g. Huntsman's Garb wh-92) — `tap: self`
    // taps the item itself, so pass the item's own status.
    for (const item of char.items) {
      scanSource(charId, char, item.instanceId, item.definitionId, item.status);
    }
  }

  return actions;
}
