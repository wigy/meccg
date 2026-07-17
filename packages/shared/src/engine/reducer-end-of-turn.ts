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
import { BARAD_DUR_HERO, BARAD_DUR_MINION, THE_ONE_RING } from '../card-ids.js';
import { shuffle } from '../rng.js';
import { resolveHandSize } from './effects/index.js';
import { logHeading, logDetail } from './legal-actions/log.js';
import type { ReducerResult } from './reducer-utils.js';
import { completeDeckExhaust, defById, findById, handleExchangeSideboard, removeById, startDeckExhaust, toCardInstance, updatePlayer } from './reducer-utils.js';
import { enterUntapPhase } from './reducer-untap.js';
import { sweepExpired, removeConstraint } from './pending.js';
import { handleStoreItem } from './reducer-organization.js';
import { handleGrantActionApply } from './grant-action-apply.js';
import { handlePlayResourceShortEvent } from './reducer-events.js';
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

  if (action.type === 'activate-granted-action') {
    // Saruman's spell-fetch is the only grant-action offered in the
    // end-of-turn discard step (see `legal-actions/end-of-turn.ts`).
    // Delegate to the shared apply dispatcher.
    return handleGrantActionApply(state, action);
  }

  if (action.type === 'store-item') {
    // Safe from the Shadow / Tokens to Show: storing allowed during EOT.
    return handleStoreItem(state, action);
  }

  // Rule 2.1.1 / CoE 2.VI: resource short-events may be played during any
  // phase, including between end-of-turn steps. Playing a short event does
  // NOT mark the player done for the discard step.
  if (action.type === 'play-short-event') {
    return handlePlayResourceShortEvent(state, action);
  }

  if (action.type === 'haven-return') {
    return handleHavenReturn(state, action);
  }

  if (action.type === 'run-home') {
    return handleRunHome(state, action);
  }

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

    // At hand size after drawing → mark done
    if (newHand.length === handSize) {
      return markResetHandDone(updatedState, eotState, playerIndex);
    }

    return { state: updatedState };
  }

  return { state, error: `Unexpected action '${action.type}' in end-of-turn reset-hand step` };
}

/**
 * Checks whether the active player satisfies the One Ring Ringwraith win condition.
 *
 * MELE §1: if a Ringwraith player's company is bearing The One Ring at
 * Barad-dûr (either the hero site tw-374 or the minion site le-352), that
 * player wins immediately. Returns the winning player's ID if the condition
 * is met, or null otherwise.
 */
function checkOneRingWin(state: GameState): PlayerId | null {
  const activePlayer = state.players.find(p => p.id === state.activePlayer);
  if (!activePlayer || activePlayer.alignment !== 'ringwraith') return null;

  const baradDurIds = new Set<string>([BARAD_DUR_HERO as string, BARAD_DUR_MINION as string]);
  const oneRingId = THE_ONE_RING as string;

  for (const company of activePlayer.companies) {
    const currentSiteDefId = company.currentSite?.definitionId as string | undefined;
    if (!currentSiteDefId || !baradDurIds.has(currentSiteDefId)) continue;

    // Company is at Barad-dûr — check for The One Ring in any character's items
    for (const charId of company.characters) {
      const char = activePlayer.characters[charId];
      if (!char) continue;
      for (const item of char.items) {
        if ((item.definitionId as string) === oneRingId) {
          logDetail(`One Ring win condition: ${activePlayer.name} has The One Ring at Barad-dûr — Ringwraith wins immediately (MELE §1)`);
          return activePlayer.id;
        }
      }
    }
  }
  return null;
}

/**
 * Step 3 (signal-end): Resource player signals end of turn.
 * Pass switches the active player and advances to the next turn's Untap phase.
 */


/**
 * Step 3 (signal-end): Resource player signals end of turn.
 * Pass switches the active player and advances to the next turn's Untap phase.
 */
function handleEndOfTurnSignalEnd(state: GameState, action: GameAction): ReducerResult {
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

    // MELE §1: check Ringwraith One Ring win condition before the turn ends
    const oneRingWinner = checkOneRingWin(state);
    if (oneRingWinner) {
      logHeading(`One Ring win condition triggered — ${oneRingWinner as string} wins immediately (Ringwraith at Barad-dûr, MELE §1)`);
      return {
        state: endGame(
          state,
          { kind: 'one-ring', alignment: Alignment.Ringwraith, card: null },
          oneRingWinner,
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

  if (action.type === 'store-item') {
    // Safe from the Shadow / Tokens to Show: storing allowed during EOT.
    return handleStoreItem(state, action);
  }

  // Rule 2.1.1 / CoE 2.VI: resource short-events may be played during any
  // phase, including at the signal-end step before passing to end the turn.
  if (action.type === 'play-short-event') {
    return handlePlayResourceShortEvent(state, action);
  }

  if (action.type === 'haven-return') {
    return handleHavenReturn(state, action);
  }

  if (action.type === 'run-home') {
    return handleRunHome(state, action);
  }

  return { state, error: `Unexpected action '${action.type}' in end-of-turn signal-end step` };
}

/**
 * Execute a Great-road haven-return: move the company back to the origin haven
 * recorded in the `haven-return-option` constraint. Per the card text, "This is
 * considered movement with no movement/hazard phase", so site card lifecycle
 * rules apply (CoE 2.IV.viii):
 *
 * 1. The company's current (departure) site is returned to the location deck if
 *    untapped or a haven, or discarded if tapped — provided `siteCardOwned` is
 *    true (otherwise a sibling company still holds the card).
 * 2. The origin haven is pulled from the location deck (removed) and becomes the
 *    company's new `currentSite`. If another company is already at the origin
 *    haven, the haven is shared and `siteCardOwned` is set to `false`.
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

  const havenInstance: SiteInPlay = havenAlreadyInPlay
    ? { ...siblingAtHaven!.currentSite! }
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
 * Trigger a call-the-council endgame event. Marks the caller's
 * `freeCouncilCalled`, swaps the active player, increments the turn
 * counter, and sets `lastTurnFor` per the `direction`:
 *
 * - `'opponent'` — the caller's opponent gets one last turn (normal free
 *   call, or resource-side Sudden Call).
 * - `'self'` — the caller gets one last turn (hazard-side Sudden Call
 *   played during the opponent's turn — the caller has just finished
 *   reacting, and per rule 10.41 it's the caller who gets one last turn).
 *
 * Extracted so that both the `call-free-council` action handler and the
 * upcoming `call-council` DSL effect (used by Sudden Call) share the
 * same state transition.
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

  return enterUntapPhase({
    ...updatePlayer(state, callerIndex, p => ({ ...p, freeCouncilCalled: true })),
    activePlayer: nextActive,
    turnNumber: state.turnNumber + 1,
    lastTurnFor,
  });
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
  return {
    ...state,
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

