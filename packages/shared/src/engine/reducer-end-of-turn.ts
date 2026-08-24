/**
 * @module reducer-end-of-turn
 *
 * End-of-turn phase handlers for the game reducer. Covers card discarding,
 * hand resetting, deck exhaustion during end-of-turn, signaling game end,
 * and transitioning to Free Council.
 */

import type { GameState, EndOfTurnPhaseState, PlayerId, GameAction, CardInstance, CardInstanceId, SiteInPlay } from '../index.js';
import type { PlayerState } from '../types/state-player.js';
import { getPlayerIndex, requirePhaseState } from '../state-utils.js';
import { isSiteCard } from '../types/cards.js';
import { CardStatus, Alignment } from '../types/common.js';
import { Phase } from '../types/state-phases.js';
import type { EndOfTurnWinSiteRule } from '../types/effects.js';
import { matchesContext } from '../effects/condition-matcher.js';
import { shuffle } from '../rng.js';
import { resolveHandSize } from './effects/index.js';
import { logHeading, logDetail } from './legal-actions/log.js';
import type { ReducerResult } from './reducer-utils.js';
import { completeDeckExhaust, defById, findById, handleExchangeSideboard, removeById, startDeckExhaust, toCardInstance, updatePlayer } from './reducer-utils.js';
import { enterUntapPhase } from './reducer-untap.js';
import { sweepExpired, removeConstraint } from './pending.js';
import { handleStoreItem, handlePlayCharacter } from './reducer-organization.js';
import { handleGrantActionApply } from './grant-action-apply.js';
import { handlePlayPermanentEvent, handlePlayResourceShortEvent } from './reducer-events.js';
import { endGame } from './reducer-free-council.js';
import { scanEndOfTurnWinConditions } from './reducer-win-conditions.js';


/**
 * Apply CoE rule 2.09: if a player's play deck AND discard pile are both empty,
 * the next discarded card immediately becomes their play deck (not discard pile).
 *
 * Returns a partial player state update to spread into the player object.
 */
function discardOrBecomePlayDeck(player: PlayerState, card: CardInstance): Pick<PlayerState, 'playDeck' | 'discardPile'> {
  if (player.playDeck.length === 0 && player.discardPile.length === 0) {
    logDetail(`Rule 2.09: both play deck and discard empty — discarded card becomes new play deck`);
    return { playDeck: [card], discardPile: player.discardPile };
  }
  return { playDeck: player.playDeck, discardPile: [...player.discardPile, card] };
}

/**
 * Dispatch the actions that both interactive end-of-turn steps (discard and
 * signal-end) accept identically, per the rules that make them
 * phase/step-independent:
 *
 * - `activate-granted-action` — end-of-turn-phase grant-actions (e.g.
 *   Saruman's/Huntsman's Garb's spell/card fetch, wh-92). CRF 22: these may
 *   be activated both in the discard step and after hand size has been
 *   reconciled during signal-end (see `legal-actions/end-of-turn.ts`).
 * - `store-item` — Safe from the Shadow / Tokens to Show: storing allowed
 *   during EOT.
 * - `play-short-event` / `play-permanent-event` — Rule 2.1.1 / CoE 2.VI:
 *   resource events may be played during any phase, including between
 *   end-of-turn steps. Playing one does NOT mark the player done for the
 *   discard step.
 * - `play-character` — CRF 22 (A Chance Meeting tw-188): "may be played on
 *   your turn during any phase the company is at a site" — the recruit is
 *   offered as a `play-character` carrying `viaEventInstanceId` (see
 *   `legal-actions/end-of-turn.ts`'s `recruitViaEventActions` call). Shared
 *   with the organization/M-H/site phases; guarded there on not being the
 *   organization phase for the one-character-per-turn bookkeeping.
 * - `haven-return` / `run-home` — company relocation options that stay open
 *   through the end-of-turn phase.
 *
 * Returns null when the action is none of these, so the caller can fall
 * through to its step-specific error.
 */
function handleSharedEndOfTurnAction(state: GameState, action: GameAction): ReducerResult | null {
  switch (action.type) {
    case 'activate-granted-action':
      return handleGrantActionApply(state, action);
    case 'store-item':
      return handleStoreItem(state, action);
    case 'play-short-event':
      return handlePlayResourceShortEvent(state, action);
    case 'play-permanent-event':
      return handlePlayPermanentEvent(state, action);
    case 'play-character':
      return handlePlayCharacter(state, action);
    case 'haven-return':
      return handleHavenReturn(state, action);
    case 'run-home':
      return handleRunHome(state, action);
    default:
      return null;
  }
}

/**
 * End-of-turn phase handler (CoE 2.VI).
 *
 * Dispatches to sub-step handlers:
 * 1. discard — voluntary discard by either player
 * 2. reset-hand — draw/discard to base hand size
 * 3. signal-end — resource player ends the turn
 */
export function handleEndOfTurn(state: GameState, action: GameAction): ReducerResult {
  const eotState = requirePhaseState(state, Phase.EndOfTurn);

  switch (eotState.step) {
    case 'discard':
      return handleEndOfTurnDiscard(state, action, eotState);
    case 'reset-hand':
      return handleEndOfTurnResetHand(state, action, eotState);
    case 'signal-end':
      return handleEndOfTurnSignalEnd(state, action);
    default: {
      const _exhaustive: never = eotState.step;
      return { state, error: `Unknown end-of-turn step` };
    }
  }
}

/**
 * Step 1 (discard): Either player may discard a card from hand.
 *
 * Both players act independently. Each may discard one card or pass.
 * Once both have acted (discard or pass), advance to reset-hand.
 */
function handleEndOfTurnDiscard(
  state: GameState,
  action: GameAction,
  eotState: EndOfTurnPhaseState,
): ReducerResult {
  const playerIndex = getPlayerIndex(state, action.player);

  /** Mark this player done and advance to reset-hand if both are done. */
  function markDone(updatedState: GameState, updatedEot: EndOfTurnPhaseState): ReducerResult {
    const newDone: [boolean, boolean] = [...updatedEot.discardDone] as [boolean, boolean];
    newDone[playerIndex] = true;

    if (newDone[0] && newDone[1]) {
      logDetail(`End-of-Turn discard: both players done → advancing to reset-hand`);
      return {
        state: {
          ...updatedState,
          phaseState: { ...updatedEot, step: 'reset-hand' as const, discardDone: newDone },
        },
      };
    }

    logDetail(`End-of-Turn discard: player ${action.player as string} done, waiting for other player`);
    return {
      state: {
        ...updatedState,
        phaseState: { ...updatedEot, discardDone: newDone },
      },
    };
  }

  if (action.type === 'pass') {
    logDetail(`End-of-Turn discard: player ${action.player as string} passed`);
    return markDone(state, eotState);
  }

  if (action.type === 'discard-card') {
    const player = state.players[playerIndex];
    const discardedCard = findById(player.hand, action.cardInstanceId);
    if (!discardedCard) return { state, error: 'Card not found in hand' };
    const newHand = removeById(player.hand, discardedCard.instanceId);

    const updatedState = updatePlayer(state, playerIndex, p => ({
      ...p,
      hand: newHand,
      ...discardOrBecomePlayDeck(p, discardedCard),
    }));

    logDetail(`End-of-Turn discard: player ${player.name} discarded 1 card (hand now ${newHand.length})`);
    return markDone(updatedState, eotState);
  }

  const shared = handleSharedEndOfTurnAction(state, action);
  if (shared) return shared;

  return { state, error: `Unexpected action '${action.type}' in end-of-turn discard step` };
}

/**
 * Step 2 (reset-hand): Both players draw or discard to base hand size (8).
 *
 * Players above hand size must discard one card at a time. Players below
 * hand size draw all at once. Once both are at hand size, advance to
 * signal-end.
 */


/**
 * Step 2 (reset-hand): Both players draw or discard to base hand size (8).
 *
 * Players above hand size must discard one card at a time. Players below
 * hand size draw all at once. Once both are at hand size, advance to
 * signal-end.
 */
/** Mark a player done in the reset-hand step, advancing to signal-end when both are done. */
function markResetHandDone(state: GameState, eotState: EndOfTurnPhaseState, playerIndex: number): ReducerResult {
  const newDone: [boolean, boolean] = [...eotState.resetHandDone] as [boolean, boolean];
  newDone[playerIndex] = true;

  if (newDone[0] && newDone[1]) {
    logDetail(`End-of-Turn reset-hand: both players done → advancing to signal-end`);
    return {
      state: {
        ...state,
        phaseState: { ...eotState, step: 'signal-end' as const, resetHandDone: newDone },
      },
    };
  }

  logDetail(`End-of-Turn reset-hand: player ${state.players[playerIndex].name} done, waiting for other player`);
  return {
    state: {
      ...state,
      phaseState: { ...eotState, resetHandDone: newDone },
    },
  };
}

function handleEndOfTurnResetHand(
  state: GameState,
  action: GameAction,
  eotState: EndOfTurnPhaseState,
): ReducerResult {
  // Pass during deck exhaust exchange sub-flow: complete the exhaust
  if (action.type === 'pass') {
    const pIdx = getPlayerIndex(state, action.player);
    if (state.players[pIdx].deckExhaustPending) {
      logDetail(`End-of-Turn reset-hand: player ${state.players[pIdx].name} completed deck exhaust exchange`);
      return { state: completeDeckExhaust(state, pIdx) };
    }
  }

  if (action.type === 'pass') {
    const playerIndex = getPlayerIndex(state, action.player);
    const player = state.players[playerIndex];
    logDetail(`End-of-Turn reset-hand: player ${player.name} at hand size, passed`);
    return markResetHandDone(state, eotState, playerIndex);
  }

  if (action.type === 'discard-card') {
    const playerIndex = getPlayerIndex(state, action.player);
    const player = state.players[playerIndex];
    const handSize = resolveHandSize(state, playerIndex);
    const discardedCard = findById(player.hand, action.cardInstanceId);
    if (!discardedCard) return { state, error: 'Card not found in hand' };
    const newHand = removeById(player.hand, discardedCard.instanceId);

    const updatedState = updatePlayer(state, playerIndex, p => ({
      ...p,
      hand: newHand,
      ...discardOrBecomePlayDeck(p, discardedCard),
    }));

    logDetail(`End-of-Turn reset-hand: player ${player.name} discards 1 card (${newHand.length}/${handSize})`);

    // At hand size after discarding → mark done
    if (newHand.length === handSize) {
      return markResetHandDone(updatedState, eotState, playerIndex);
    }

    return { state: updatedState };
  }

  if (action.type === 'deck-exhaust') {
    const playerIndex = getPlayerIndex(state, action.player);
    return { state: startDeckExhaust(state, playerIndex) };
  }

  if (action.type === 'exchange-sideboard') {
    return handleExchangeSideboard(state, action);
  }

  if (action.type === 'draw-cards') {
    const playerIndex = getPlayerIndex(state, action.player);
    const player = state.players[playerIndex];
    const handSize = resolveHandSize(state, playerIndex);

    if (player.playDeck.length === 0) {
      logDetail(`End-of-Turn reset-hand: player ${player.name} has no cards to draw`);
      return markResetHandDone(state, eotState, playerIndex);
    }

    const drawCount = Math.min(action.count, handSize - player.hand.length);
    const cardsToDrawCount = Math.min(drawCount, player.playDeck.length);
    const drawnCards = player.playDeck.slice(0, cardsToDrawCount);
    const newHand = [...player.hand, ...drawnCards];
    const newPlayDeck = player.playDeck.slice(cardsToDrawCount);

    const updatedState = updatePlayer(state, playerIndex, p => ({
      ...p,
      hand: newHand,
      playDeck: newPlayDeck,
    }));

    logDetail(`End-of-Turn reset-hand: player ${player.name} drew ${cardsToDrawCount} cards (${newHand.length}/${handSize})`);

    // Rule 2.4: exhaustion (and its reshuffle sub-flow) happens immediately
    // when the last card is drawn — even if this same draw also completed
    // the hand-size requirement. Enter the sub-flow before marking this
    // player done, so a deck that empties exactly on the final needed card
    // doesn't sit un-reshuffled until the next time a draw is required.
    if (newPlayDeck.length === 0 && player.discardPile.length > 0) {
      logDetail(`End-of-Turn reset-hand: player ${player.name}'s last card drawn — play deck exhausted, starting reshuffle`);
      return { state: startDeckExhaust(updatedState, playerIndex) };
    }

    // At hand size after drawing → mark done
    if (newHand.length === handSize) {
      return markResetHandDone(updatedState, eotState, playerIndex);
    }

    return { state: updatedState };
  }

  return { state, error: `Unexpected action '${action.type}' in end-of-turn reset-hand step` };
}

/**
 * Checks whether the active player satisfies a positional end-of-turn win
 * condition declared by a site their company occupies.
 *
 * Sites declare these via the `end-of-turn-win` site-rule, whose `when`
 * condition is evaluated against
 * `{ player: { alignment }, company: { itemNames } }`. The canonical case is
 * MELE §1: a Ringwraith player's company bearing The One Ring at Barad-dûr
 * (tw-374 / le-352) wins immediately. Returns the winning player's ID if any
 * declared condition is met, or null otherwise.
 */
function checkEndOfTurnSiteWin(state: GameState): PlayerId | null {
  const activePlayer = state.players.find(p => p.id === state.activePlayer);
  if (!activePlayer) return null;

  for (const company of activePlayer.companies) {
    const siteDefId = company.currentSite?.definitionId;
    const siteDef = siteDefId ? defById(state, siteDefId) : undefined;
    if (!siteDef || !isSiteCard(siteDef)) continue;
    const rules = (siteDef.effects ?? []).filter(
      (e): e is EndOfTurnWinSiteRule => e.type === 'site-rule' && e.rule === 'end-of-turn-win',
    );
    if (rules.length === 0) continue;

    const itemNames = company.characters.flatMap(charId => {
      const char = activePlayer.characters[charId];
      if (!char) return [];
      return char.items
        .map(item => defById(state, item.definitionId)?.name)
        .filter((name): name is string => name !== undefined);
    });
    const context = { player: { alignment: activePlayer.alignment }, company: { itemNames } };
    for (const rule of rules) {
      if (matchesContext(rule.when, context)) {
        logDetail(`End-of-turn site win: "${siteDef.name}" condition met for ${activePlayer.name} (${activePlayer.alignment}, company items: [${itemNames.join(', ')}])`);
        return activePlayer.id;
      }
    }
  }
  return null;
}

/**
 * Step 3 (signal-end): Resource player signals end of turn.
 * Pass switches the active player and advances to the next turn's Untap phase.
 */
function handleEndOfTurnSignalEnd(state: GameState, action: GameAction): ReducerResult {
  if (action.type === 'pass' && action.player !== state.activePlayer) {
    // Non-active player declining their optional allow-store-eot storing
    // window (CoE 2.II.4: "may attempt to store"). This is not the
    // turn-ending pass — only the active (resource) player's pass ends the
    // turn — so it is a no-op; the store-item options simply remain
    // available for the rest of the step.
    logDetail(`End-of-Turn signal-end: non-active player ${action.player as string} declined to store`);
    return { state };
  }

  if (action.type === 'pass') {
    // CoE 10.39: A New Ringlord (wh-60) — the Fallen-wizard's end-of-turn
    // One Ring roll. Fires before the turn ends; may win the game or
    // eliminate the Fallen-wizard.
    const ringlordRoll = scanEndOfTurnWinConditions(state);
    if (ringlordRoll) {
      if (ringlordRoll.state.phaseState.phase === Phase.GameOver) {
        return ringlordRoll;
      }
      // No win (eliminated / no effect) — continue ending the turn from the
      // post-roll state so an eliminated Fallen-wizard is reflected below.
      state = ringlordRoll.state;
    }

    // Site-declared positional win conditions (`end-of-turn-win` site-rule,
    // e.g. MELE §1: Ringwraith bearing The One Ring at Barad-dûr) — checked
    // before the turn ends.
    const siteWinner = checkEndOfTurnSiteWin(state);
    if (siteWinner) {
      const winnerAlignment = state.players.find(p => p.id === siteWinner)?.alignment ?? Alignment.Ringwraith;
      logHeading(`End-of-turn site win condition triggered — ${siteWinner as string} wins immediately`);
      return {
        state: endGame(
          state,
          { kind: 'one-ring', alignment: winnerAlignment, card: null },
          siteWinner,
        ),
      };
    }

    const currentIndex = getPlayerIndex(state, state.activePlayer!);
    const nextIndex = (currentIndex === 0 ? 1 : 0);
    const nextPlayer = state.players[nextIndex].id;

    // Check if this was the opponent's last turn after a Free Council call
    if (state.lastTurnFor === state.activePlayer) {
      logDetail(`End-of-Turn signal-end: ${action.player as string} finished their last turn → transitioning to Free Council`);
      return {
        state: transitionToFreeCouncil(state, state.activePlayer!),
      };
    }

    // Check auto-end: both players exhausted their deck twice
    if (state.players[0].deckExhaustionCount >= 2 && state.players[1].deckExhaustionCount >= 2) {
      logDetail(`End-of-Turn signal-end: both players exhausted deck twice → transitioning to Free Council`);
      return {
        state: transitionToFreeCouncil(state, state.activePlayer!),
      };
    }

    logDetail(`End-of-Turn signal-end: active player ${action.player as string} ended turn → switching to player ${nextPlayer as string}, turn ${state.turnNumber + 1}`);
    // Sweep turn-scoped pending resolutions and constraints (Stealth, etc.)
    const swept = sweepExpired(state, { kind: 'turn-end' });
    return {
      state: enterUntapPhase({
        ...swept,
        activePlayer: nextPlayer,
        turnNumber: swept.turnNumber + 1,
      }),
    };
  }

  if (action.type === 'call-free-council') {
    logDetail(`End-of-Turn signal-end: ${action.player as string} called the Free Council — opponent gets one last turn`);
    return { state: triggerCouncilCall(state, action.player, 'opponent') };
  }

  const shared = handleSharedEndOfTurnAction(state, action);
  if (shared) return shared;

  return { state, error: `Unexpected action '${action.type}' in end-of-turn signal-end step` };
}

/**
 * Execute a haven-return: move the company back to the origin site recorded
 * in the `haven-return-option` constraint (Great-road tw-249; also Ancient
 * Stair dm-115, whose origin site is an Under-deeps-adjacent surface site,
 * not a Haven). Per the card text, "This is considered movement with no
 * movement/hazard phase", so site card lifecycle rules apply (CoE 2.IV.viii):
 *
 * 1. The company's current (departure) site is returned to the location deck if
 *    untapped or a haven, or discarded if tapped — provided `siteCardOwned` is
 *    true (otherwise a sibling company still holds the card).
 * 2. The origin site is pulled from the location deck (removed) and becomes the
 *    company's new `currentSite`. If another company is already at the origin
 *    site, the site is shared and `siteCardOwned` is set to `false`.
 * 3. The constraint is consumed so the option cannot be exercised twice.
 */
function handleHavenReturn(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'haven-return') return { state, error: `handleHavenReturn called with ${action.type}` };
  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const companyIdx = player.companies.findIndex(c => c.id === action.companyId);
  if (companyIdx === -1) {
    return { state, error: `haven-return: company ${action.companyId as string} not found for player ${action.player as string}` };
  }

  const constraint = state.activeConstraints.find(
    c => c.kind.type === 'haven-return-option'
      && c.target.kind === 'company'
      && c.target.companyId === action.companyId,
  );
  if (!constraint || constraint.kind.type !== 'haven-return-option') {
    return { state, error: `haven-return: no haven-return-option constraint for company ${action.companyId as string}` };
  }

  const { originHavenInstanceId, originHavenDefinitionId, originHavenStatus } = constraint.kind;
  const originHaven = { instanceId: originHavenInstanceId, definitionId: originHavenDefinitionId, status: originHavenStatus };

  logDetail(`haven-return: company ${action.companyId as string} returns to haven ${originHavenDefinitionId as string} (instance ${originHavenInstanceId as string})`);

  const company = player.companies[companyIdx];
  const currentSite = company.currentSite;

  // Check whether another of this player's companies is already at the origin haven.
  const havenAlreadyInPlay = player.companies.some(
    (c, i) => i !== companyIdx && c.currentSite?.instanceId === originHavenInstanceId,
  );

  const updatedState = updatePlayer(state, playerIndex, p => {
    let siteDeck = p.siteDeck;
    let siteDiscardPile = p.siteDiscardPile;

    // Step 1: handle departure from the current site (CoE 2.IV.viii).
    if (currentSite && company.siteCardOwned) {
      const departureDef = defById(state, currentSite.definitionId);
      const departureIsHaven = departureDef && isSiteCard(departureDef) && departureDef.siteType === 'haven';
      const departureEntry = toCardInstance(currentSite);
      if (!departureIsHaven && currentSite.status === CardStatus.Tapped) {
        logDetail(`haven-return: departure site ${currentSite.definitionId as string} is tapped — discarding to site discard pile`);
        siteDiscardPile = [...siteDiscardPile, departureEntry];
      } else {
        logDetail(`haven-return: departure site ${currentSite.definitionId as string} is ${departureIsHaven ? 'a haven' : 'untapped'} — returning to location deck`);
        siteDeck = [...siteDeck, departureEntry];
      }
    }

    // Step 2: remove the origin haven from the location deck so it becomes the
    // company's current site (same invariant as plan-movement → endCompanyMH).
    if (!havenAlreadyInPlay) {
      logDetail(`haven-return: removing origin haven ${originHavenInstanceId as string} from location deck`);
      siteDeck = removeById(siteDeck, originHavenInstanceId);
    } else {
      logDetail(`haven-return: origin haven already in play at a sibling company — sharing site (siteCardOwned=false)`);
    }

    return {
      ...p,
      siteDeck,
      siteDiscardPile,
      companies: p.companies.map((c, i) =>
        i === companyIdx
          ? { ...c, currentSite: originHaven, siteCardOwned: !havenAlreadyInPlay }
          : c,
      ),
    };
  });

  return { state: removeConstraint(updatedState, constraint.id) };
}

/**
 * Execute a Bill the Pony (tw-198) "run home": discard the `run-home-to-haven`
 * ally and move its company to the current site's nearest Haven. Per the card
 * errata this is considered movement with no movement/hazard phase, so the
 * departure site follows the ordinary site-card lifecycle (CoE 2.IV.viii):
 * untapped / haven → location deck, tapped → site discard pile (only when the
 * company owns the physical card). The nearest haven is pulled from the
 * player's location deck; if a sibling company already holds it, the haven is
 * shared (`siteCardOwned = false`). Legality is pre-checked by `runHomeActions`.
 */
function handleRunHome(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'run-home') return { state, error: `handleRunHome called with ${action.type}` };
  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const companyIdx = player.companies.findIndex(c => c.id === action.companyId);
  if (companyIdx === -1) {
    return { state, error: `run-home: company ${action.companyId as string} not found for player ${action.player as string}` };
  }
  const company = player.companies[companyIdx];
  const currentSite = company.currentSite;
  if (!currentSite) {
    return { state, error: `run-home: company ${action.companyId as string} has no current site` };
  }

  // Locate the ally being discarded and the character bearing it.
  let bearerCharId: CardInstanceId | null = null;
  for (const charId of company.characters) {
    const char = player.characters[charId];
    if (char?.allies.some(a => a.instanceId === action.allyInstanceId)) {
      bearerCharId = charId;
      break;
    }
  }
  if (!bearerCharId) {
    return { state, error: `run-home: ally ${action.allyInstanceId as string} not found in company ${action.companyId as string}` };
  }
  const bearer = player.characters[bearerCharId];
  const ally = bearer.allies.find(a => a.instanceId === action.allyInstanceId)!;

  // Determine the nearest haven from the current site definition.
  const currentSiteDef = defById(state, currentSite.definitionId);
  if (!currentSiteDef || !isSiteCard(currentSiteDef) || !currentSiteDef.nearestHaven) {
    return { state, error: `run-home: current site ${currentSite.definitionId as string} has no nearest haven` };
  }
  const havenName = currentSiteDef.nearestHaven;

  // Is another of this player's companies already at that haven? If so, share it.
  const siblingAtHaven = player.companies.find((c, i) => {
    if (i === companyIdx || !c.currentSite) return false;
    const def = defById(state, c.currentSite.definitionId);
    return def && isSiteCard(def) && def.name === havenName;
  });
  const havenAlreadyInPlay = siblingAtHaven !== undefined;

  // Otherwise pull the haven card from the location deck.
  const havenFromDeck = havenAlreadyInPlay
    ? undefined
    : player.siteDeck.find(entry => {
        const def = defById(state, entry.definitionId);
        return def && isSiteCard(def) && def.siteType === 'haven' && def.name === havenName;
      });
  if (!havenAlreadyInPlay && !havenFromDeck) {
    return { state, error: `run-home: nearest haven "${havenName}" not found in location deck for player ${action.player as string}` };
  }

  const havenInstance: SiteInPlay = siblingAtHaven?.currentSite
    ? { ...siblingAtHaven.currentSite }
    : { instanceId: havenFromDeck!.instanceId, definitionId: havenFromDeck!.definitionId, status: CardStatus.Untapped };

  logDetail(`run-home: company ${action.companyId as string} discards ally ${ally.definitionId as string} and moves to nearest haven ${havenName}${havenAlreadyInPlay ? ' (shared with sibling company)' : ''}`);

  const updatedState = updatePlayer(state, playerIndex, p => {
    let siteDeck = p.siteDeck;
    let siteDiscardPile = p.siteDiscardPile;

    // Step 1: dispose of the departure site (CoE 2.IV.viii), only if owned.
    if (company.siteCardOwned) {
      const departureIsHaven = currentSiteDef.siteType === 'haven';
      const departureEntry = toCardInstance(currentSite);
      if (!departureIsHaven && currentSite.status === CardStatus.Tapped) {
        logDetail(`run-home: departure site ${currentSite.definitionId as string} is tapped — discarding to site discard pile`);
        siteDiscardPile = [...siteDiscardPile, departureEntry];
      } else {
        logDetail(`run-home: departure site ${currentSite.definitionId as string} is ${departureIsHaven ? 'a haven' : 'untapped'} — returning to location deck`);
        siteDeck = [...siteDeck, departureEntry];
      }
    }

    // Step 2: remove the nearest haven from the location deck (unless shared).
    if (!havenAlreadyInPlay) {
      siteDeck = removeById(siteDeck, havenInstance.instanceId);
    }

    return {
      ...p,
      siteDeck,
      siteDiscardPile,
      // Step 3: discard the ally to its owner's discard pile.
      discardPile: [...p.discardPile, toCardInstance(ally)],
      characters: {
        ...p.characters,
        [bearerCharId]: {
          ...p.characters[bearerCharId],
          allies: p.characters[bearerCharId].allies.filter(a => a.instanceId !== action.allyInstanceId),
        },
      },
      // Step 4: relocate the company to the nearest haven.
      companies: p.companies.map((c, i) =>
        i === companyIdx
          ? { ...c, currentSite: havenInstance, siteCardOwned: !havenAlreadyInPlay }
          : c,
      ),
    };
  });

  return { state: updatedState };
}

/**
 * Trigger a call-the-council endgame event at the true end of the caller's
 * turn (rule 10.2.1-10.2.4: "may call to end the game at the end of their
 * own turn"). Marks the caller's `freeCouncilCalled`, swaps the active
 * player, increments the turn counter, and sets `lastTurnFor` to the
 * caller's opponent, who gets one last turn.
 *
 * Only valid when the caller's turn has actually finished — i.e. from the
 * `call-free-council` action, which is offered exclusively during the
 * End-of-Turn phase's signal-end step. Mid-turn endgame calls (Sudden Call,
 * either mode) must use {@link flagCouncilCall} instead so the caller's
 * current turn plays out normally before the swap happens.
 */
export function triggerCouncilCall(
  state: GameState,
  caller: PlayerId,
  direction: 'opponent' | 'self',
): GameState {
  const callerIndex = getPlayerIndex(state, caller);
  const opponentIndex = (callerIndex === 0 ? 1 : 0);
  const opponent = state.players[opponentIndex].id;

  const nextActive = opponent;
  const lastTurnFor = direction === 'opponent' ? opponent : caller;

  // The caller's turn ends here just as it does on a plain signal-end pass,
  // so sweep turn-scoped resolutions and constraints — "rest of the turn"
  // effects from the caller's turn must not leak into the next turn.
  const swept = sweepExpired(state, { kind: 'turn-end' });

  return enterUntapPhase({
    ...updatePlayer(swept, callerIndex, p => ({ ...p, freeCouncilCalled: true })),
    activePlayer: nextActive,
    turnNumber: swept.turnNumber + 1,
    lastTurnFor,
  });
}

/**
 * Flag a call-the-council endgame event without interrupting the turn in
 * progress (rule 10.2.R1/10.2.B1: Sudden Call, played either as a resource
 * on the caller's own turn or as a hazard on the opponent's turn, "after
 * which [the designated player] gets one last turn"). Unlike
 * {@link triggerCouncilCall}, this does not touch `activePlayer`,
 * `turnNumber`, or `phaseState` — the current turn continues through its
 * remaining phases, and the existing End-of-Turn signal-end logic performs
 * the actual player swap (and, on the designated player's own following
 * signal-end, the transition to Free Council) once that turn naturally
 * ends.
 *
 * - `'opponent'` — the caller's opponent gets one last turn (resource-side
 *   Sudden Call, played on the caller's own turn).
 * - `'self'` — the caller gets one last turn (hazard-side Sudden Call,
 *   played on the opponent's turn).
 */
export function flagCouncilCall(
  state: GameState,
  caller: PlayerId,
  direction: 'opponent' | 'self',
): GameState {
  const callerIndex = getPlayerIndex(state, caller);
  const opponentIndex = (callerIndex === 0 ? 1 : 0);
  const opponent = state.players[opponentIndex].id;

  const lastTurnFor = direction === 'opponent' ? opponent : caller;

  return {
    ...updatePlayer(state, callerIndex, p => ({ ...p, freeCouncilCalled: true })),
    lastTurnFor,
  };
}

/**
 * Remove a card from the given player's hand, return it to their play
 * deck, and reshuffle the deck. Used by the `reshuffle-self-from-hand`
 * DSL ability (Sudden Call) and any future cards with the same
 * "show opponent, reshuffle into deck" mechanic.
 *
 * Returns `null` if the card is not in the player's hand. Callers should
 * have already verified legality via the legal-actions computer.
 */
export function reshuffleCardFromHand(
  state: GameState,
  player: PlayerId,
  cardInstanceId: import('../index.js').CardInstanceId,
): GameState | null {
  const playerIndex = getPlayerIndex(state, player);
  const p = state.players[playerIndex];
  const card = findById(p.hand, cardInstanceId);
  if (!card) return null;

  const newHand = removeById(p.hand, cardInstanceId);

  const [shuffled, rng] = shuffle([...p.playDeck, card], state.rng);

  logDetail(`${p.name} reshuffled card ${cardInstanceId as string} (${card.definitionId as string}) from hand into play deck (shown to opponent)`);
  return { ...updatePlayer(state, playerIndex, up => ({ ...up, hand: newHand, playDeck: shuffled })), rng };
}

/**
 * Creates the initial Free Council phase state. The player who took the last
 * turn performs corruption checks first.
 */
function transitionToFreeCouncil(state: GameState, lastTurnPlayer: PlayerId): GameState {
  logHeading('Transitioning to Free Council phase');
  // The last turn ends here — sweep turn-scoped resolutions and constraints
  // so "rest of the turn" effects (e.g. check-modifiers from hazards) do not
  // modify the game-deciding Free Council corruption checks. Effects created
  // DURING the Council rightly last until the end of the game (rule 10.44):
  // they are created after this sweep and no later turn-end sweep runs.
  const swept = sweepExpired(state, { kind: 'turn-end' });
  return {
    ...swept,
    activePlayer: lastTurnPlayer,
    phaseState: {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: lastTurnPlayer,
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck: null,
    },
  };
}


/**
 * Handles actions during the Free Council phase.
 *
 * During 'corruption-checks' step, each player performs corruption checks
 * for their characters in turn. When both players have finished (or passed),
 * final scores are computed and the game transitions to Game Over.
 */

