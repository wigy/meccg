/**
 * @module legal-actions
 *
 * Computes the complete list of candidate actions a player can take
 * given the current game state. Each phase has its own module under this
 * directory. This index dispatches to the appropriate phase module.
 *
 * Setup phases return {@link EvaluatedAction} with viability and reasons
 * via the rules engine. Other phases wrap their actions as viable.
 *
 * The function is pure: `(GameState, PlayerId) → EvaluatedAction[]`.
 */

import type { GameState, PlayerId, EvaluatedAction, FetchToDeckEffect, CardInstanceId } from '../../index.js';
import type { PlayRestrictionEffect, TapDiscardInPlayEffect } from '../../types/effects.js';
import { Alignment, CardStatus } from '../../types/common.js';
import { Phase } from '../../types/state-phases.js';
import { matchesContext } from '../../effects/condition-matcher.js';
import { matchesDefinitionAcrossFallenWizardAlignment, playerById, defById, getCardEffects, findFallenWizardAvatarName, isCardPlayableAtSiteDef, agentHomeSiteMatchesTypes, collectTapDiscardInPlayTargets } from '../reducer-utils.js';
import { isAvatarCharacter, isSiteCard } from '../../types/cards.js';
import { resolveInstanceId } from '../../types/state.js';
import { getPlayerIndex } from '../../state-utils.js';
import { setupActions } from './setup.js';
import { untapActions } from './untap.js';
import { organizationActions } from './organization.js';
import { longEventActions } from './long-event.js';
import { movementHazardActions } from './movement-hazard.js';
import { siteActions } from './site.js';
import { endOfTurnActions } from './end-of-turn.js';
import { freeCouncilActions } from './free-council.js';
import { chainActions } from './chain.js';
import { combatActions } from './combat.js';
import { logDetail, logEvaluated, logHeading, logResult } from './log.js';
import { notPlayable } from './action-builders.js';
import { asViable } from './evaluated.js';
import { topResolutionFor } from '../pending.js';
import { applyCardPlayProhibitions, applyPendingPlayFilter } from '../card-play-prohibition.js';
import { bannedVsBalrogHandCards } from '../balrog-banned-swap.js';
import { applyLocationMagicRestriction } from '../location-magic-restriction.js';
import { applyConstraints } from './pending.js';
import { resolutionLegalActions } from '../pending-handlers.js';

/**
 * Computes legal actions when a pending card effect is being resolved.
 * Dispatches to the appropriate handler based on the effect type.
 */
function pendingEffectLegalActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const current = state.pendingEffects[0];
  if (current.type === 'card-effect' && current.effect.type === 'fetch-to-deck') {
    return fetchFromPileLegalActions(state, playerId, current.effect);
  }
  if (current.type === 'card-effect' && current.effect.type === 'tap-discard-in-play') {
    return tapDiscardInPlayLegalActions(state, playerId, current.effect);
  }
  // Unknown effect type: allow pass to skip
  return [{ action: { type: 'pass', player: playerId }, viable: true }];
}

/**
 * Legal actions while a `tap-discard-in-play` sub-flow is active (Praise to
 * Elbereth tw-305). One `tap-discard-in-play` action per (own untapped
 * character, opponent's untapped in-play card matching the effect's filter)
 * pair, plus `pass` to end the sub-flow. Each pick resolves immediately
 * (`applyTapDiscardInPlay`); the pending effect stays queued so the same
 * player can keep picking until no pairs remain or they pass.
 */
function tapDiscardInPlayLegalActions(
  state: GameState,
  playerId: PlayerId,
  effect: TapDiscardInPlayEffect,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const player = playerById(state, playerId);
  const opponent = state.players.find(p => p.id !== playerId);
  if (player && opponent) {
    const targets = collectTapDiscardInPlayTargets(state, opponent, effect.filter);
    if (targets.length > 0) {
      for (const characterId of Object.keys(player.characters) as CardInstanceId[]) {
        const char = player.characters[characterId];
        if (char.status !== CardStatus.Untapped) continue;
        for (const targetInstanceId of targets) {
          actions.push({
            action: { type: 'tap-discard-in-play', player: playerId, characterId, targetInstanceId },
            viable: true,
          });
        }
      }
    }
  }
  actions.push({ action: { type: 'pass', player: playerId }, viable: true });
  return actions;
}

/** Computes legal fetch-from-pile actions for a fetch-to-deck effect. */
function fetchFromPileLegalActions(state: GameState, playerId: PlayerId, effect: FetchToDeckEffect): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player) return [];
  const actions: EvaluatedAction[] = [];
  const dest = effect.to ?? 'deck';

  // Identify the triggering event card so it is excluded from candidates.
  // Hazard short events stay in the discard pile while their fetch effects
  // resolve, and their definition type may match their own fetch filter.
  const current = state.pendingEffects[0];
  const sourceCardId = current.type === 'card-effect' ? current.cardInstanceId : undefined;

  // Site-playability restriction (Strider ba-1: "playable at his current
  // site") — the qualifying site was captured when the fetch was enqueued.
  const requiredSite = effect.playableAtSite !== undefined ? defById(state, effect.playableAtSite) : undefined;

  for (const source of effect.source) {
    const pile = source === 'sideboard' ? player.sideboard
      : (source === 'deck' || source === 'play-deck') ? player.playDeck
      : player.discardPile;
    const pileSource: 'sideboard' | 'discard-pile' | 'deck' = source === 'sideboard' ? 'sideboard'
      : (source === 'deck' || source === 'play-deck') ? 'deck'
      : 'discard-pile';
    for (const card of pile) {
      if (card.instanceId === sourceCardId) continue;
      const def = defById(state, card.definitionId);
      if (!def || !matchesDefinitionAcrossFallenWizardAlignment(def, effect.filter, player.alignment)) continue;
      // Home-site-type restriction (Inner Cunning dm-68 mode 2).
      if (effect.homeSiteTypes && effect.homeSiteTypes.length > 0
        && !agentHomeSiteMatchesTypes(state, def as { homesite?: string }, effect.homeSiteTypes)) {
        continue;
      }
      if (effect.playableAtSite !== undefined) {
        if (!isSiteCard(requiredSite) || !isCardPlayableAtSiteDef(def, requiredSite, state)) {
          logDetail(`fetch-from-pile: ${(def as { name?: string }).name ?? (card.definitionId as string)} filtered out — not playable at ${(requiredSite as { name?: string } | undefined)?.name ?? (effect.playableAtSite as string)}`);
          continue;
        }
      }
      actions.push({
        action: { type: 'fetch-from-pile', player: playerId, cardInstanceId: card.instanceId, source: pileSource, to: dest },
        viable: true,
      });
    }
  }

  actions.push({ action: { type: 'pass', player: playerId }, viable: true });
  return actions;
}

/**
 * Cross-phase `reshuffle-card-from-hand` actions — one per hand card
 * whose definition carries a `move` effect with
 * `{ select: 'self', from: 'hand', to: 'deck' }` (e.g. Sudden Call).
 * Called only from strategy steps where at least one other viable action
 * exists; atomic resolution windows are skipped by the caller.
 */
function reshuffleFromHandActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const playerIndex = getPlayerIndex(state, playerId);
  const player = state.players[playerIndex];
  const results: EvaluatedAction[] = [];
  for (const handCard of player.hand) {
    const def = defById(state, handCard.definitionId);
    const hasReshuffle = getCardEffects(def).some(e =>
      e.type === 'move'
      && e.select === 'self'
      && e.from === 'hand'
      && e.to === 'deck',
    );
    if (!hasReshuffle) continue;
    results.push({
      action: { type: 'reshuffle-card-from-hand', player: playerId, cardInstanceId: handCard.instanceId },
      viable: true,
    });
  }
  return results;
}

/**
 * Cross-phase `swap-banned-vs-balrog` actions (CoE 1.8.2 / rule 1.36) — one
 * per (banned hand card, sideboard card) pair while the opponent is a Balrog
 * player. Same offering window as {@link reshuffleFromHandActions}: any
 * strategy step where the player already has another viable action.
 */
function bannedVsBalrogSwapActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const banned = bannedVsBalrogHandCards(state, playerId);
  if (banned.length === 0) return [];
  const player = playerById(state, playerId);
  if (!player) return [];
  const results: EvaluatedAction[] = [];
  for (const handCard of banned) {
    for (const sideboardCard of player.sideboard) {
      results.push({
        action: {
          type: 'swap-banned-vs-balrog',
          player: playerId,
          cardInstanceId: handCard.instanceId,
          sideboardCardInstanceId: sideboardCard.instanceId,
        },
        viable: true,
      });
    }
  }
  return results;
}

/**
 * Collects all card instance IDs referenced by any evaluated action so
 * that we can detect hand cards with no coverage at all. Includes
 * `viaEventInstanceId` (e.g. A Chance Meeting tw-188, We Have Come to Kill
 * le-252) so a recruit-enabling event card is not treated as uncovered when
 * its only actions are the `play-character` recruits it offers — those carry
 * the recruit's `characterInstanceId`, not the event's own instance ID. Also
 * includes `itemInstanceId` so hand items whose only action is keyed by that
 * field (e.g. `store-item-in-cache` for Armory dm-116) are recognized as
 * covered — otherwise this sweep stacks a spurious "cannot be played during
 * this step" not-playable entry alongside the genuinely viable action.
 */
function referencedInstanceIds(evaluated: EvaluatedAction[]): Set<string> {
  const ids = new Set<string>();
  for (const ea of evaluated) {
    const a = ea.action as unknown as Record<string, unknown>;
    if (typeof a['cardInstanceId'] === 'string') ids.add(a['cardInstanceId']);
    if (typeof a['characterInstanceId'] === 'string') ids.add(a['characterInstanceId']);
    if (typeof a['viaEventInstanceId'] === 'string') ids.add(a['viaEventInstanceId']);
    if (typeof a['itemInstanceId'] === 'string') ids.add(a['itemInstanceId']);
  }
  return ids;
}

/**
 * Appends not-playable entries for hand cards that no phase handler
 * evaluated — guarantees every hand card gets a tooltip in the UI.
 */
function fillNotPlayable(state: GameState, playerId: PlayerId, evaluated: EvaluatedAction[]): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player) return evaluated;
  const covered = referencedInstanceIds(evaluated);
  const extras: EvaluatedAction[] = [];
  for (const card of player.hand) {
    if (covered.has(card.instanceId as string)) continue;
    const def = defById(state, card.definitionId);
    const name = def ? (def as unknown as Record<string, unknown>)['name'] as string : card.definitionId as string;
    extras.push(notPlayable(playerId, card.instanceId, `${name} cannot be played during this step`));
  }
  if (extras.length > 0) {
    return [...evaluated, ...extras];
  }
  return evaluated;
}

/**
 * Rewrites any `play-*` action for a card that declares an `unplayable-when`
 * play-restriction whose condition matches the current play context into a
 * not-playable entry. Pass-through for every other action.
 *
 * The condition is evaluated against
 * `{ actor: { alignment }, opponent: { alignment } }`, so cards can declare
 * opponent-conditional play bans (distinct from the unconditional deck-build
 * bans in deck-validation) directly in their JSON — e.g. MEBA's "if you are a
 * Balrog player, your opponent may not play …" list and CoE 1.35's cards with
 * no effect against a Ringwraith player. The CoE 3.10 mirror-match exemption
 * (both players Balrog → Balrog-specific cards stay playable) is expressed in
 * the cards' own conditions via `actor.alignment: { $ne: "balrog" }`.
 */
function applyDeclaredPlayRestrictions(
  state: GameState,
  playerId: PlayerId,
  evaluated: EvaluatedAction[],
): EvaluatedAction[] {
  const actor = state.players.find(p => p.id === playerId);
  const opponent = state.players.find(p => p.id !== playerId);
  if (!actor || !opponent) return evaluated;
  const context = {
    actor: { alignment: actor.alignment },
    opponent: { alignment: opponent.alignment },
  };
  return evaluated.map(ea => {
    const a = ea.action as unknown as Record<string, unknown>;
    const type = a['type'];
    if (typeof type !== 'string' || !type.startsWith('play')) return ea;
    const instId = (a['cardInstanceId'] ?? a['characterInstanceId'] ?? a['instanceId']) as string | undefined;
    if (typeof instId !== 'string') return ea;
    const defId = resolveInstanceId(state, instId as CardInstanceId);
    const def = defId ? defById(state, defId) : undefined;
    if (!def) return ea;
    const restriction = getCardEffects(def).find(
      (e): e is PlayRestrictionEffect => e.type === 'play-restriction'
        && e.rule === 'unplayable-when'
        && e.when !== undefined
        && matchesContext(e.when, context),
    );
    if (!restriction) return ea;
    const name = (def as unknown as Record<string, unknown>)['name'] as string ?? (defId as string);
    logDetail(`Play restriction: ${name} is unplayable (actor ${actor.alignment}, opponent ${opponent.alignment}) — ${restriction.reason ?? 'declared unplayable-when matched'}`);
    return notPlayable(playerId, instId as CardInstanceId, `${name}: ${restriction.reason ?? 'cannot be played in the current situation'}`);
  });
}

/**
 * CoE rule 1.37: "Wizard players cannot play the corresponding Wizard avatar
 * of a Fallen-wizard avatar that has been declared by their opponent." Blocks
 * any `play-character` action whose target is the Wizard-alignment avatar
 * sharing a name with the opponent's declared/in-play Fallen-wizard avatar.
 */
function applyFwOpponentAvatarBan(
  state: GameState,
  playerId: PlayerId,
  evaluated: EvaluatedAction[],
): EvaluatedAction[] {
  const opponent = state.players.find(p => p.id !== playerId);
  if (!opponent || opponent.alignment !== Alignment.FallenWizard) return evaluated;
  const fwAvatarName = findFallenWizardAvatarName(state, opponent);
  if (!fwAvatarName) return evaluated;
  return evaluated.map(ea => {
    const a = ea.action as unknown as Record<string, unknown>;
    if (a['type'] !== 'play-character') return ea;
    const instId = a['characterInstanceId'] as string | undefined;
    if (typeof instId !== 'string') return ea;
    const defId = resolveInstanceId(state, instId as CardInstanceId);
    const def = defId ? defById(state, defId) : undefined;
    if (!def || !isAvatarCharacter(def) || (def as { alignment?: string }).alignment !== 'wizard' || def.name !== fwAvatarName) {
      return ea;
    }
    return notPlayable(playerId, instId as CardInstanceId, `${def.name}: cannot be played — declared by your opponent as a Fallen-wizard avatar`);
  });
}

/** Applies card-declared `unplayable-when` play restrictions, then the Fallen-wizard-avatar opponent ban. */
function applyOpponentBans(
  state: GameState,
  playerId: PlayerId,
  evaluated: EvaluatedAction[],
): EvaluatedAction[] {
  const afterDeclared = applyDeclaredPlayRestrictions(state, playerId, evaluated);
  return applyFwOpponentAvatarBan(state, playerId, afterDeclared);
}

/**
 * Returns every candidate action the given player could take in the current
 * game state, annotated with viability. Non-viable actions include a
 * human-readable reason explaining why they cannot be taken.
 *
 * The `prohibit-card-play` lock is applied here rather than inside each phase
 * module: a card that bars other cards from play (The Under-roads as-106 by
 * name, Balance Between Powers dm-118 by class) must do so in every window a
 * card can be played from — phase menus, the chain, and combat responses alike.
 */
export function computeLegalActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  return applyPendingPlayFilter(
    state, playerId,
    applyLocationMagicRestriction(
      state, playerId,
      applyCardPlayProhibitions(state, playerId, computePhaseLegalActions(state, playerId)),
    ),
  );
}

/**
 * The action set presented to a human player: {@link computeLegalActions}
 * plus the `concede` meta-action.
 *
 * Concede is offered unconditionally, in every phase and sub-state (chain,
 * combat, pending resolution) except once the game has already ended —
 * deliberately outside computePhaseLegalActions's chain/combat/pending
 * early-returns, which restrict every other action to a narrow
 * resolution-specific set. It is layered on here rather than inside
 * {@link computeLegalActions} because that function is the engine's own
 * notion of "what can this seat do": auto-resolution and stall detection ask
 * it whether a seat has *any* viable action, AI/sim agents sample from it,
 * and the rules tests assert exact "no actions"/"only X" sets — none of which
 * should see a game-ending option that only a human should ever choose.
 */
export function computePlayerFacingActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  return withConcedeAction(state, playerId, computeLegalActions(state, playerId));
}

/**
 * Appends the `concede` meta-action to an already-computed legal-action set
 * (see {@link computePlayerFacingActions}); a no-op once the game is over.
 * The game server applies this per human connection so projected views used
 * by AI clients and the sim harness never carry it.
 */
export function withConcedeAction(state: GameState, playerId: PlayerId, evaluated: readonly EvaluatedAction[]): EvaluatedAction[] {
  if (state.phaseState.phase === Phase.GameOver) return [...evaluated];
  return [...evaluated, { action: { type: 'concede', player: playerId }, viable: true }];
}

/**
 * The phase/chain/combat dispatch behind {@link computeLegalActions}, before
 * the game-wide play-lock filter is applied.
 */
function computePhaseLegalActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const phase = state.phaseState.phase;
  logHeading(`Computing legal actions for player ${playerId as string} in phase '${phase}'`);

  // Chain of effects takes priority over everything else — except when the
  // chain is paused mid-resolution awaiting a pending resolution (e.g. a
  // faction-influence-roll). In that case the pending resolution drives
  // the legal actions; the chain entry stays alive (so its card is still
  // findable) and is marked resolved by the pending reducer afterwards.
  if (state.chain != null) {
    if (state.chain.mode === 'resolving') {
      const top = topResolutionFor(state, playerId);
      if (top !== null) {
        logHeading(`Chain paused mid-resolution by pending ${top.kind.type} — delegating to resolution actions`);
        return logEvaluated(resolutionLegalActions(state, playerId, top));
      }
      // Chain resolving but no pending resolution for this player — they
      // must wait for the other player (or for auto-resolve to finish).
      if (state.pendingResolutions.length > 0) {
        logHeading(`Chain paused mid-resolution; pending resolution belongs to other player — waiting`);
        logResult(0, []);
        return [];
      }
    }
    logHeading(`Chain active (${state.chain.mode}) — delegating to chain actions`);
    return logEvaluated(chainActions(state, playerId));
  }

  // Combat sub-state takes priority over phase actions, but pending
  // resolutions (e.g. Corpse-candle pre-defense corruption checks) must
  // still be resolved before combat actions are legal.
  if (state.combat != null) {
    // A pending card effect must resolve BEFORE combat actions. This arises
    // when a chain collapses carrying both a higher-priority resource event
    // (whose fetch-to-deck queues a pending effect) and a lower creature entry
    // (whose resolution starts combat) in the same step: the event resolves
    // first per LIFO chain order, so its interactive fetch takes precedence.
    // Without this the fetch was deferred behind combat and then swept away by
    // a later phase `pass` — Smoke Rings (dm-159) "disappeared without effect"
    // (game mrs06zup-du4wde, seq 128).
    if (state.pendingEffects.length > 0) {
      const effectActor = state.pendingEffects[0].actor ?? state.activePlayer;
      if (playerId !== effectActor) {
        logResult(0, []);
        return [];
      }
      logHeading(`Combat active but pending effect queued (${state.pendingEffects[0].type}) — resolving effect before combat`);
      return logEvaluated(pendingEffectLegalActions(state, playerId));
    }
    const pendingTop = topResolutionFor(state, playerId);
    if (pendingTop !== null) {
      logHeading(`Combat: pending resolution (${pendingTop.kind.type}) — delegating to resolution actions`);
      return logEvaluated(resolutionLegalActions(state, playerId, pendingTop));
    }
    if (state.pendingResolutions.length > 0) {
      logHeading(`Combat: pending resolution belongs to other player — waiting`);
      logResult(0, []);
      return [];
    }
    logHeading(`Combat active (phase: ${state.combat.phase}) — delegating to combat actions`);
    return logEvaluated(applyOpponentBans(state, playerId, combatActions(state, playerId)));
  }

  // Pending card effects take priority over phase actions
  if (state.pendingEffects.length > 0) {
    const effectActor = state.pendingEffects[0].actor ?? state.activePlayer;
    if (playerId !== effectActor) {
      logResult(0, []);
      return [];
    }
    logHeading(`Pending effects active (${state.pendingEffects[0].type}) — delegating to effect actions`);
    return logEvaluated(pendingEffectLegalActions(state, playerId));
  }

  // Pending resolutions short-circuit (Shape A — see types/pending.ts).
  // While any resolution is queued for this player, only its resolution
  // actions are legal. While a resolution is queued for the *other*
  // player, this player must wait — they have no legal actions.
  const top = topResolutionFor(state, playerId);
  if (top !== null) {
    logHeading(`Pending resolution active (${top.kind.type}) — delegating to resolution actions`);
    return logEvaluated(resolutionLegalActions(state, playerId, top));
  }
  if (state.pendingResolutions.length > 0) {
    logHeading(`Pending resolution active for another player — waiting`);
    logResult(0, []);
    return [];
  }

  let evaluated: EvaluatedAction[];
  switch (phase) {
    case 'setup':             evaluated = setupActions(state, playerId); break;
    case 'untap':             evaluated = untapActions(state, playerId); break;
    case 'organization':      evaluated = organizationActions(state, playerId); break;
    case 'long-event':        evaluated = longEventActions(state, playerId); break;
    case 'movement-hazard':   evaluated = movementHazardActions(state, playerId); break;
    case 'site':              evaluated = siteActions(state, playerId); break;
    case 'end-of-turn':       evaluated = endOfTurnActions(state, playerId); break;
    case 'free-council':      evaluated = freeCouncilActions(state, playerId); break;
    case 'game-over': {
      const goState = state.phaseState as { finishedPlayers: readonly string[] };
      evaluated = goState.finishedPlayers.includes(playerId as string)
        ? []
        : asViable([{ type: 'finished', player: playerId }]);
      break;
    }
    default:                  evaluated = []; break;
  }

  // Active constraints filter (Shape B — see types/pending.ts). Pass-through
  // when no constraints are in scope.
  evaluated = applyConstraints(state, playerId, evaluated);

  // Cross-phase `reshuffle-card-from-hand` actions (e.g. Sudden Call).
  // Offered once per eligible hand card when the player already has at
  // least one other viable action — this naturally excludes atomic
  // resolution windows where the only "action" is a system-driven
  // resolve.
  const hasOtherViable = evaluated.some(e => e.viable);
  if (hasOtherViable) {
    evaluated = [...evaluated, ...reshuffleFromHandActions(state, playerId)];
    evaluated = [...evaluated, ...bannedVsBalrogSwapActions(state, playerId)];
  }

  // Catch-all: mark remaining hand cards that have no evaluated action as
  // not-playable so the UI can show a tooltip for every dimmed card.
  evaluated = fillNotPlayable(state, playerId, evaluated);

  return logEvaluated(applyOpponentBans(state, playerId, evaluated));
}
