/**
 * @module chain-reducer
 *
 * Reducer logic for the chain of effects sub-state.
 *
 * Handles chain initiation, priority passing, resolution loop, nested chains
 * (on-guard interrupts, body checks), and deferred passive condition processing.
 *
 * The chain reducer is called from the main {@link reduce} function when the
 * action type is chain-specific (`pass-chain-priority`, `order-passives`).
 * Card-play actions that are chain-aware (short events, creatures, etc.) call
 * helpers from this module to push entries onto the chain stack.
 */

import type { GameState, GameAction, PlayerId, PlayerState, CardInstance, CardInstanceId, ChainState, ChainEntry, ChainEntryPayload, ChainRestriction, DeferredPassive, CombatState, CreatureCard, PendingEffect } from '../index.js';
import type { HavenJumpOffer, PostAttackEffect } from '../types/state-combat.js';
import type { OnEventEffect } from '../types/effects.js';
import { getPlayerIndex, CardStatus, matchesCondition, SiteType, isSiteCard } from '../index.js';
import { resolveInstanceId } from '../types/state.js';
import { logHeading, logDetail } from './legal-actions/log.js';
import { applyMove, moveToFetchToDeckPayload } from './reducer-move.js';
import type { ReducerResult } from './reducer.js';
import { resolveAttackProwess, resolveAttackStrikes, isWardedAgainst } from './effects/index.js';
import { buildInPlayNames } from './recompute-derived.js';
import { addConstraint, enqueueResolution } from './pending.js';
import { Phase } from '../index.js';
import { updatePlayer, wrongActionType } from './reducer-utils.js';
import { applyEffect, buildChainApplyContext } from './apply-dispatcher.js';
import { isDetainmentAttack, defenderAlignmentLabel } from './detainment.js';

/**
 * Returns the opponent of the given player in a two-player game.
 */
function opponent(state: GameState, playerId: PlayerId): PlayerId {
  return state.players[0].id === playerId ? state.players[1].id : state.players[0].id;
}

/**
 * Creates a new chain of effects with the given first entry.
 *
 * The initiating player's opponent receives priority first (CoE rule 672:
 * the non-initiator may respond before resolution begins).
 *
 * @param state - Current game state (chain must be null).
 * @param declaredBy - The player initiating the chain.
 * @param card - The card being played (physically held by the chain), or null for non-card entries.
 * @param payload - What kind of chain entry this is.
 * @param restriction - Chain restriction mode (default: 'normal').
 * @returns New game state with chain active.
 */
export function initiateChain(
  state: GameState,
  declaredBy: PlayerId,
  card: CardInstance | null,
  payload: ChainEntryPayload,
  restriction: ChainRestriction = 'normal',
): GameState {
  logHeading(`Initiating chain of effects`);
  logDetail(`Declared by player ${declaredBy as string}, payload type: ${payload.type}, restriction: ${restriction}`);

  const entry: ChainEntry = {
    index: 0,
    declaredBy,
    card,
    payload,
    resolved: false,
    negated: false,
  };

  const chain: ChainState = {
    mode: 'declaring',
    entries: [entry],
    priority: opponent(state, declaredBy),
    priorityPlayerPassed: false,
    nonPriorityPlayerPassed: false,
    deferredPassives: [],
    parentChain: state.chain,
    restriction,
  };

  logDetail(`Priority goes to opponent ${chain.priority as string}`);

  return { ...state, chain };
}

/**
 * Pushes a new entry onto an existing chain's stack and flips priority.
 *
 * Called when a player declares an action in response during the declaring phase.
 * The responder's opponent receives priority next.
 *
 * @param state - Current game state (chain must be non-null and in declaring mode).
 * @param declaredBy - The player declaring the response.
 * @param card - The card being played (physically held by the chain), or null.
 * @param payload - What kind of chain entry this is.
 * @returns New game state with entry added and priority flipped.
 */
export function pushChainEntry(
  state: GameState,
  declaredBy: PlayerId,
  card: CardInstance | null,
  payload: ChainEntryPayload,
): GameState {
  const chain = state.chain!;
  logDetail(`Pushing chain entry #${chain.entries.length} by player ${declaredBy as string}, payload: ${payload.type}`);

  const entry: ChainEntry = {
    index: chain.entries.length,
    declaredBy,
    card,
    payload,
    resolved: false,
    negated: false,
  };

  const newChain: ChainState = {
    ...chain,
    entries: [...chain.entries, entry],
    priority: opponent(state, declaredBy),
    priorityPlayerPassed: false,
    nonPriorityPlayerPassed: false,
  };

  logDetail(`Priority flips to ${newChain.priority as string}`);

  return { ...state, chain: newChain };
}

/**
 * Handles chain-specific actions (`pass-chain-priority`, `order-passives`).
 *
 * Called by the main reducer when `state.chain` is non-null and the action
 * type is a chain action.
 */
export function handleChainAction(state: GameState, action: GameAction): ReducerResult {
  const chain = state.chain;
  if (!chain) {
    return { state, error: 'No active chain' };
  }

  switch (action.type) {
    case 'pass-chain-priority':
      return handlePassChainPriority(state, chain, action.player);
    case 'order-passives':
      return handleOrderPassives(state, chain, action);
    case 'reveal-on-guard':
      return handleChainRevealOnGuard(state, chain, action);
    default:
      return { state, error: `Unexpected chain action: ${action.type}` };
  }
}

/**
 * Handles a player passing priority in the chain's declaring phase.
 *
 * When a player passes:
 * - If the opponent hasn't passed yet, priority flips to the opponent.
 * - If both players have now passed consecutively, the chain transitions
 *   to resolving mode and auto-resolution begins.
 */
function handlePassChainPriority(state: GameState, chain: ChainState, playerId: PlayerId): ReducerResult {
  logHeading(`Chain: player ${playerId as string} passes priority`);

  if (chain.mode !== 'declaring') {
    return { state, error: 'Cannot pass priority: chain is resolving' };
  }
  if (playerId !== chain.priority) {
    return { state, error: 'Cannot pass priority: you do not have priority' };
  }

  // Check if the other player (now the non-priority player) already passed.
  // After the first pass, priority flips and the passer becomes the
  // non-priority player with nonPriorityPlayerPassed = true.
  const otherAlreadyPassed = chain.nonPriorityPlayerPassed;

  // The current priority player is passing. If they were the first to pass,
  // flip priority to the opponent. The "priorityPlayerPassed" always tracks
  // whether the CURRENT priority player has passed.
  // Since we're about to flip priority, the current player's pass becomes
  // the "nonPriorityPlayerPassed" from the new priority holder's perspective.

  if (!otherAlreadyPassed) {
    // First pass — flip priority to opponent, they get a chance to respond
    const newPriority = opponent(state, playerId);
    logDetail(`First pass — priority flips to ${newPriority as string}`);

    const newChain: ChainState = {
      ...chain,
      priority: newPriority,
      priorityPlayerPassed: false,
      nonPriorityPlayerPassed: true,
    };

    return { state: { ...state, chain: newChain } };
  }

  // Both players passed consecutively — transition to resolving and auto-advance
  logDetail(`Both players passed — chain transitions to resolving`);

  const resolvingChain: ChainState = {
    ...chain,
    mode: 'resolving',
    priorityPlayerPassed: false,
    nonPriorityPlayerPassed: false,
  };

  return autoResolve({ ...state, chain: resolvingChain });
}

/**
 * Handles the `order-passives` action, which lets the resource player
 * reorder simultaneously-triggered passive conditions before they are
 * declared in a follow-up chain.
 *
 * The `order` array must contain exactly the card instance IDs from
 * the chain's deferred passives, in the desired declaration order.
 */
function handleOrderPassives(state: GameState, chain: ChainState, action: GameAction): ReducerResult {
  if (action.type !== 'order-passives') return wrongActionType(state, action, 'order-passives');

  if (chain.deferredPassives.length < 2) {
    return { state, error: 'No passives to order (fewer than 2 deferred)' };
  }

  const ordered = action.order;
  if (ordered.length !== chain.deferredPassives.length) {
    return { state, error: `Expected ${chain.deferredPassives.length} entries, got ${ordered.length}` };
  }

  // Validate all IDs are present
  const deferredIds = new Set(chain.deferredPassives.map(p => p.sourceCardId as string));
  for (const id of ordered) {
    if (!deferredIds.has(id as string)) {
      return { state, error: `Unknown passive source: ${id as string}` };
    }
  }

  // Reorder deferred passives to match the requested order
  const reordered: DeferredPassive[] = ordered.map(id =>
    chain.deferredPassives.find(p => p.sourceCardId === id)!,
  );

  logDetail(`Passives reordered: ${reordered.map(p => p.sourceCardId as string).join(', ')}`);

  const newChain: ChainState = {
    ...chain,
    deferredPassives: reordered,
  };

  return { state: { ...state, chain: newChain } };
}

/**
 * Handles a reveal-on-guard action during chain declaring.
 *
 * Removes the on-guard card from the company, pushes it as a new chain entry
 * (permanent-event or short-event based on the card definition), and flips
 * priority to the opponent.
 */
function handleChainRevealOnGuard(state: GameState, chain: ChainState, action: GameAction): ReducerResult {
  if (action.type !== 'reveal-on-guard') return wrongActionType(state, action, 'reveal-on-guard');
  if (chain.mode !== 'declaring') return { state, error: 'Cannot reveal on-guard: chain is resolving' };
  if (action.player !== chain.priority) return { state, error: 'Cannot reveal on-guard: you do not have priority' };

  const siteState = state.phaseState as import('../index.js').SitePhaseState;
  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const resourcePlayer = state.players[activeIndex];
  const company = resourcePlayer.companies[siteState.activeCompanyIndex];
  if (!company) return { state, error: 'No active company' };

  const ogIdx = company.onGuardCards.findIndex(c => c.instanceId === action.cardInstanceId);
  if (ogIdx === -1) return { state, error: 'Card not in on-guard cards' };

  const revealedCard = company.onGuardCards[ogIdx];
  const def = state.cardPool[revealedCard.definitionId as string];
  logDetail(`Chain: hazard player reveals on-guard "${def?.name ?? revealedCard.definitionId}"`);

  // Remove from on-guard
  const newOnGuardCards = [...company.onGuardCards];
  newOnGuardCards.splice(ogIdx, 1);
  const newCompanies = [...resourcePlayer.companies];
  newCompanies[siteState.activeCompanyIndex] = { ...company, onGuardCards: newOnGuardCards };
  const newPlayers: [import('../index.js').PlayerState, import('../index.js').PlayerState] = [state.players[0], state.players[1]];
  newPlayers[activeIndex] = { ...resourcePlayer, companies: newCompanies };

  let newState: GameState = { ...state, players: newPlayers };

  // Push as chain entry
  const isPermanent = def && 'eventType' in def && (def as { eventType?: string }).eventType === 'permanent';
  const payload: ChainEntryPayload = isPermanent
    ? { type: 'permanent-event' as const, targetCharacterId: action.targetCharacterId }
    : { type: 'short-event' as const };
  const cardInstance: CardInstance = { instanceId: revealedCard.instanceId, definitionId: revealedCard.definitionId };
  newState = pushChainEntry(newState, action.player, cardInstance, payload);

  return { state: newState };
}

/**
 * Auto-resolves chain entries in LIFO order until the chain is complete
 * or player input is needed.
 *
 * Entries are resolved from the last declared (top of stack) to the first.
 * Each entry is checked for validity before resolution — if the entry's
 * conditions are no longer met, it is negated instead of resolved.
 *
 * When all entries are resolved, the chain completes via {@link completeChain}.
 */
export function autoResolve(state: GameState): ReducerResult {
  let current = state;
  const allEffects: import('../index.js').GameEffect[] = [];

  while (current.chain && current.chain.mode === 'resolving') {
    const chain = current.chain;

    // Find the next unresolved entry (LIFO = iterate from end to start)
    const nextIndex = findNextUnresolved(chain);

    if (nextIndex === -1) {
      // All entries resolved — complete the chain
      logDetail(`All chain entries resolved — completing chain`);
      current = completeChain(current);
      continue;
    }

    // Resolve this entry
    const result = resolveEntry(current, nextIndex);
    current = result.state;
    if (result.effects) allEffects.push(...result.effects);

    // If resolution needs player input, stop auto-advancing
    if (result.needsInput) {
      logDetail(`Entry #${nextIndex} needs player input — pausing auto-resolve`);
      break;
    }
  }

  return { state: current, ...(allEffects.length > 0 ? { effects: allEffects } : {}) };
}

/**
 * Finds the index of the next unresolved entry in LIFO order.
 * Returns -1 if all entries are resolved or negated.
 */
function findNextUnresolved(chain: ChainState): number {
  for (let i = chain.entries.length - 1; i >= 0; i--) {
    const entry = chain.entries[i];
    if (!entry.resolved && !entry.negated) {
      return i;
    }
  }
  return -1;
}

/**
 * Result of resolving a single chain entry. If `needsInput` is true,
 * auto-resolution should pause and wait for player action.
 */
interface ResolveResult {
  readonly state: GameState;
  readonly needsInput: boolean;
  /** Visual effects produced by this resolution (e.g. dice rolls). */
  readonly effects?: readonly import('../index.js').GameEffect[];
}

/**
 * Cancel and discard an environment card targeted by a short-event (e.g. Twilight).
 *
 * The target may be in a player's cardsInPlay (hazard permanent events like Doors of Night),
 * in a player's cardsInPlay (resource permanent events like Gates of Morning),
 * or on the chain itself (an environment declared earlier in the same chain).
 *
 * If the target is on the chain, it is negated (marked as canceled) instead of
 * being physically moved — the chain entry's card was already discarded on declaration.
 *
 * If the target has already been negated or removed (e.g. another Twilight canceled
 * it first), this is a no-op — the cancel fizzles.
 */
function resolveEnvironmentCancel(state: GameState, targetInstanceId: CardInstanceId, chain: ChainState): GameState {
  const targetDefId = resolveInstanceId(state, targetInstanceId);
  const targetDef = targetDefId ? state.cardPool[targetDefId as string] : undefined;
  const targetName = targetDef?.name ?? (targetInstanceId as string);

  // Check if target is on the chain (environment declared earlier in the same chain)
  const chainIdx = chain.entries.findIndex(
    e => e.card?.instanceId === targetInstanceId && !e.resolved && !e.negated,
  );
  if (chainIdx !== -1) {
    logDetail(`Environment cancel: negating chain entry #${chainIdx} (${targetName})`);
    const newEntries = chain.entries.map((e, i) =>
      i === chainIdx ? { ...e, negated: true } : e,
    );
    return { ...state, chain: { ...chain, entries: newEntries } };
  }

  // Check cardsInPlay across all players
  for (let pi = 0; pi < state.players.length; pi++) {
    const player = state.players[pi];
    if (player.cardsInPlay.some(c => c.instanceId === targetInstanceId)) {
      logDetail(`Environment cancel: removing ${targetName} from player ${pi} cardsInPlay → discard`);
      const removedCard = player.cardsInPlay.find(c => c.instanceId === targetInstanceId)!;
      const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
      newPlayers[pi as 0 | 1] = {
        ...player,
        cardsInPlay: player.cardsInPlay.filter(c => c.instanceId !== targetInstanceId),
        discardPile: [...player.discardPile, { instanceId: targetInstanceId, definitionId: removedCard.definitionId }],
      };
      return { ...state, players: newPlayers };
    }
  }

  // Check active constraints: a card's "ongoing effect" is typically
  // realised as an {@link ActiveConstraint} whose `source` is the played
  // card's instance (the card itself may have moved to discard — e.g.
  // Stealth leaves a `no-creature-hazards-on-company` constraint behind).
  // Searching Eye (le-136) uses this path to discard the ongoing effect
  // of a scout-skill resource.
  const matchingConstraintIds = state.activeConstraints
    .filter(c => c.source === targetInstanceId)
    .map(c => c.id);
  if (matchingConstraintIds.length > 0) {
    logDetail(`Environment cancel: removing ${matchingConstraintIds.length} active constraint(s) sourced from ${targetName}`);
    return {
      ...state,
      activeConstraints: state.activeConstraints.filter(c => c.source !== targetInstanceId),
    };
  }

  // Target already gone (fizzle) — e.g. another effect already canceled it
  logDetail(`Environment cancel: target ${targetName} already gone — fizzle`);
  return state;
}

/**
 * Fire any `on-event company-arrives-at-site → add-constraint` effect
 * carried by a resolving short-event. The target company is the active
 * M/H company (the only company the hazard can be played against), so
 * the constraint can be added immediately on resolution — no deferred
 * tracking state is needed. The card itself has already been moved to
 * the discard pile at play time.
 */
function applyShortEventArrivalTrigger(state: GameState, entry: ChainEntry): GameState {
  const card = entry.card;
  if (!card) return state;
  const def = state.cardPool[card.definitionId as string];
  if (!def || !('effects' in def) || !def.effects) return state;

  // Collect all on-event effects for company-arrives-at-site. Each
  // effect's apply is either an `add-constraint` (single) or a
  // `sequence` of `add-constraint`s (River — adds
  // site-phase-do-nothing + granted-action together).
  //
  // Multiple effects allow a card to declare several mutually-exclusive
  // modes (e.g. Choking Shadows' +2 prowess vs. type-override); the
  // first effect whose `when` condition matches is applied and the
  // rest skipped.
  const onEvents = def.effects.filter(
    (e): e is import('../types/effects.js').OnEventEffect =>
      e.type === 'on-event'
      && e.event === 'company-arrives-at-site'
      && (e.apply.type === 'add-constraint' || e.apply.type === 'sequence'),
  );
  if (onEvents.length === 0) return state;

  // Only fire during M/H — outside of M/H there is no active company
  // for a "company arrives at site" trigger to attach to.
  if (state.phaseState.phase !== Phase.MovementHazard) {
    logDetail(`Short-event "${def.name}" on-event company-arrives-at-site skipped — not in M/H phase`);
    return state;
  }
  const activePlayerId = state.activePlayer;
  if (!activePlayerId) return state;
  const activeIndex = state.players[0].id === activePlayerId ? 0 : 1;
  const companyIndex = state.phaseState.activeCompanyIndex;
  const targetCompany = state.players[activeIndex].companies[companyIndex];
  if (!targetCompany) return state;

  // "company-arrives-at-site" triggers fire only when a company is
  // actually moving. A non-moving company (no declared destination)
  // never "arrives" at its current site for rules purposes, so cards
  // like River — "A company moving to this site this turn must do
  // nothing…" — have no target and fizzle.
  if (!targetCompany.destinationSite) {
    logDetail(`Short-event "${def.name}" on-event company-arrives-at-site skipped — active company is not moving`);
    return state;
  }

  // Build the context for `when` condition evaluation so each mode can
  // gate on destination site-type / region / environment (Doors of Night).
  const ctx = buildArrivalContext(state);

  for (const onEvent of onEvents) {
    if (onEvent.when && !matchesCondition(onEvent.when, ctx)) {
      logDetail(`Short-event "${def.name}": skipping on-event mode — condition not met`);
      continue;
    }

    // Normalise: a `sequence` apply contains multiple sub-applies;
    // a single `add-constraint` apply is treated as a one-item list.
    const applies: readonly import('../types/effects.js').TriggeredAction[] =
      onEvent.apply.type === 'sequence'
        ? (onEvent.apply.apps ?? [])
        : [onEvent.apply];

    let addedAny = false;
    for (const apply of applies) {
      if (apply.type !== 'add-constraint') continue;
      const constraintKind = apply.constraint;
      const scopeName = apply.scope;
      if (!constraintKind || !scopeName) continue;

      let scope: import('../types/pending.js').ConstraintScope;
      switch (scopeName) {
        case 'company-site-phase':
          scope = { kind: 'company-site-phase', companyId: targetCompany.id };
          break;
        case 'turn':
          scope = { kind: 'turn' };
          break;
        case 'until-cleared':
          scope = { kind: 'until-cleared' };
          break;
        default:
          continue;
      }
      const builtKind = buildConstraintKind(state, { ...onEvent, apply }, constraintKind);
      if (!builtKind) continue;

      logDetail(`Short-event "${def.name}" resolves → adding ${constraintKind} constraint on company ${targetCompany.id as string}`);
      state = addConstraint(state, {
        source: card.instanceId,
        sourceDefinitionId: card.definitionId,
        scope,
        target: { kind: 'company', companyId: targetCompany.id },
        kind: builtKind,
      });
      addedAny = true;
    }

    // Preserve first-match semantics: once one on-event effect has
    // contributed at least one constraint, stop considering the rest.
    if (addedAny) return state;
  }

  logDetail(`Short-event "${def.name}": no on-event mode applied (no condition matched)`);
  return state;
}

/**
 * Build the evaluation context for a `company-arrives-at-site` `when`
 * clause. Exposes the active company's destination site type, destination
 * region type, and whether Doors of Night is in play — enough for a
 * card like Choking Shadows to pick between its modes.
 */
function buildArrivalContext(state: GameState): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};
  if (state.phaseState.phase !== Phase.MovementHazard) return ctx;
  const mh = state.phaseState;
  const company: Record<string, unknown> = {};
  if (mh.destinationSiteType) company.destinationSiteType = mh.destinationSiteType;
  if (mh.destinationSiteName) company.destinationSiteName = mh.destinationSiteName;
  // The destination region type is the last entry in the resolved path
  // (the region the destination site sits in).
  if (mh.resolvedSitePath.length > 0) {
    company.destinationRegionType = mh.resolvedSitePath[mh.resolvedSitePath.length - 1];
  }
  ctx.company = company;
  const inPlayNames = buildInPlayNames(state);
  ctx.inPlay = inPlayNames;
  ctx.environment = { doorsOfNightInPlay: inPlayNames.includes('Doors of Night') };
  return ctx;
}

/**
 * Build the {@link ActiveConstraint} `kind` payload for a supported
 * constraint name. Returns null when the constraint name is unknown or
 * when required fields are missing from the effect. Shared between the
 * short-event and permanent-event add-constraint code paths.
 */
function buildConstraintKind(
  state: GameState,
  onEvent: import('../types/effects.js').OnEventEffect,
  constraintKind: string,
): import('../types/pending.js').ActiveConstraint['kind'] | null {
  switch (constraintKind) {
    case 'site-phase-do-nothing':
      return { type: 'site-phase-do-nothing' };
    case 'no-creature-hazards-on-company':
      return { type: 'no-creature-hazards-on-company' };
    case 'deny-scout-resources':
      return { type: 'deny-scout-resources' };
    case 'auto-attack-prowess-boost': {
      const value = (onEvent.apply as { value?: number }).value;
      const siteType = (onEvent.apply as { siteType?: import('../types/common.js').SiteType }).siteType;
      if (value === undefined || !siteType) return null;
      return {
        type: 'attribute-modifier',
        attribute: 'auto-attack.prowess',
        op: 'add',
        value,
        filter: { 'site.type': siteType },
      };
    }
    case 'site-type-override': {
      const overrideType = (onEvent.apply as { overrideType?: import('../types/common.js').SiteType }).overrideType;
      if (!overrideType) return null;
      const ps = state.phaseState;
      let siteDefinitionId: import('../types/common.js').CardDefinitionId | null = null;
      if (ps.phase === Phase.MovementHazard) {
        // M/H phase: resolve from active company's destination site
        const activePlayer = state.players.find(p => p.id === state.activePlayer);
        const company = activePlayer?.companies[ps.activeCompanyIndex];
        if (company?.destinationSite?.instanceId) {
          siteDefinitionId = resolveInstanceId(state, company.destinationSite.instanceId) ?? null;
        }
        if (!siteDefinitionId && ps.destinationSiteName) {
          for (const [defId, d] of Object.entries(state.cardPool)) {
            const ct = (d as { cardType?: string }).cardType;
            const name = (d as { name?: string }).name;
            if (ct?.includes('site') && name === ps.destinationSiteName) {
              siteDefinitionId = defId as import('../types/common.js').CardDefinitionId;
              break;
            }
          }
        }
      } else if (ps.phase === Phase.Site) {
        // Site phase: resolve from active company's current site
        const activePlayer = state.players.find(p => p.id === state.activePlayer);
        const company = activePlayer?.companies[ps.activeCompanyIndex];
        if (company?.currentSite) {
          siteDefinitionId = company.currentSite.definitionId;
        }
      }
      if (!siteDefinitionId) return null;
      return {
        type: 'attribute-modifier',
        attribute: 'site.type',
        op: 'override',
        value: overrideType,
        filter: { 'site.definitionId': siteDefinitionId as unknown as string },
      };
    }
    case 'region-type-override': {
      const overrideType = (onEvent.apply as { overrideType?: import('../types/common.js').RegionType }).overrideType;
      let regionName = (onEvent.apply as { regionName?: string }).regionName;
      if (!overrideType || !regionName) return null;
      // Special token: pick the destination region (last entry in the
      // resolved site-path names) for the active company. This lets a
      // short event declare "transform wherever the company is going"
      // without knowing specific region names at card-definition time.
      if (regionName === 'destination' && state.phaseState.phase === Phase.MovementHazard) {
        const mh = state.phaseState;
        if (mh.resolvedSitePathNames.length === 0) return null;
        regionName = mh.resolvedSitePathNames[mh.resolvedSitePathNames.length - 1];
      }
      return {
        type: 'attribute-modifier',
        attribute: 'region.type',
        op: 'override',
        value: overrideType,
        filter: { 'region.name': regionName },
      };
    }
    case 'auto-attack-duplicate':
      return { type: 'auto-attack-duplicate' };
    case 'granted-action': {
      const payload = onEvent.apply.grantedAction;
      if (!payload) return null;
      return {
        type: 'granted-action',
        action: payload.action,
        phase: payload.phase as import('../types/state-phases.js').Phase | undefined,
        window: payload.window,
        cost: payload.cost,
        when: payload.when,
        apply: payload.apply,
      };
    }
    case 'skip-automatic-attacks': {
      const ps = state.phaseState;
      let siteDefId: import('../types/common.js').CardDefinitionId | null = null;
      if (ps.phase === Phase.Site) {
        const activePlayer = state.players.find(p => p.id === state.activePlayer);
        const company = activePlayer?.companies[ps.activeCompanyIndex];
        if (company?.currentSite) {
          siteDefId = company.currentSite.definitionId;
        }
      }
      if (!siteDefId) return null;
      return { type: 'skip-automatic-attacks', siteDefinitionId: siteDefId };
    }
    default:
      return null;
  }
}

/**
 * Queues pending {@link FetchToDeckEffect}s for a resolving hazard short-event.
 *
 * The card was discarded at play time (hazard short events go to discard
 * immediately). If the card carries `fetch-to-deck` effects whose `when`
 * conditions are satisfied, move it from the discard pile to cardsInPlay
 * and enqueue the effects as {@link PendingEffect}s so the hazard player
 * can interactively choose which cards to fetch.
 */
function queueFetchToDecEffects(state: GameState, entry: ChainEntry): GameState {
  const card = entry.card;
  if (!card) return state;
  const def = state.cardPool[card.definitionId as string];
  if (!def || !('effects' in def) || !def.effects) return state;

  const inPlayNames = buildInPlayNames(state);
  const ctx: Record<string, unknown> = { inPlay: inPlayNames };

  const fetchEffects: PendingEffect[] = [];
  for (const effect of def.effects) {
    if (effect.type !== 'move') continue;
    const payload = moveToFetchToDeckPayload(effect);
    if (!payload) continue;
    if (effect.when && !matchesCondition(effect.when, ctx)) {
      logDetail(`${def.name}: fetch-to-deck skipped — condition not met`);
      continue;
    }
    fetchEffects.push({
      type: 'card-effect',
      cardInstanceId: card.instanceId,
      effect: payload,
      actor: entry.declaredBy,
    });
  }

  if (fetchEffects.length === 0) return state;

  logDetail(`${def.name}: queuing ${fetchEffects.length} fetch-to-deck effect(s)`);

  const playerIndex = getPlayerIndex(state, entry.declaredBy);
  const player = state.players[playerIndex];

  const discardIdx = player.discardPile.findIndex(c => c.instanceId === card.instanceId);
  if (discardIdx === -1) return state;

  const newDiscard = [...player.discardPile];
  newDiscard.splice(discardIdx, 1);

  return {
    ...updatePlayer(state, playerIndex, p => ({
      ...p,
      discardPile: newDiscard,
      cardsInPlay: [...p.cardsInPlay, { instanceId: card.instanceId, definitionId: card.definitionId, status: CardStatus.Untapped }],
    })),
    pendingEffects: [...state.pendingEffects, ...fetchEffects],
  };
}

/**
 * Resolves a permanent-event chain entry: moves the card from the chain
 * into the declaring player's `cardsInPlay` and executes `self-enters-play`
 * effects (e.g. Gates of Morning discarding hazard environments).
 */
function resolvePermanentEvent(state: GameState, entry: ChainEntry): GameState {
  const card = entry.card!;
  const def = state.cardPool[card.definitionId as string];
  const playerIndex = getPlayerIndex(state, entry.declaredBy);

  logDetail(`Permanent event resolves: "${def?.name ?? card.definitionId}" enters play for player ${entry.declaredBy as string}`);

  const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];

  // "Playable on a character" — attach to target character
  const targetCharId = entry.payload.type === 'permanent-event' ? entry.payload.targetCharacterId : undefined;
  if (targetCharId) {
    // Resource permanent events (e.g. Align Palantír) go into items;
    // hazard permanent events go into hazards.
    const isResource = def && def.cardType === 'hero-resource-event';
    const slot = isResource ? 'items' : 'hazards';
    // Find which player owns the target character
    for (let pi = 0; pi < 2; pi++) {
      const charInPlay = state.players[pi].characters[targetCharId as string];
      if (charInPlay) {
        // Ward check: a hazard permanent-event attaching to a character
        // with a matching ward (e.g. Adamant Helmet vs. dark enchantments)
        // is cancelled — the card goes straight to its owner's discard
        // pile instead of ending up in `character.hazards`.
        if (!isResource && def && isWardedAgainst(state, pi, targetCharId, def)) {
          logDetail(`Ward on ${targetCharId as string} cancels incoming "${def.name}" — routing to owner's discard`);
          newPlayers[playerIndex] = {
            ...newPlayers[playerIndex],
            discardPile: [
              ...newPlayers[playerIndex].discardPile,
              { instanceId: card.instanceId, definitionId: card.definitionId },
            ],
          };
          break;
        }
        logDetail(`Attaching "${def?.name ?? card.definitionId}" to character ${targetCharId as string} (${slot})`);
        newPlayers[pi] = {
          ...newPlayers[pi],
          characters: {
            ...newPlayers[pi].characters,
            [targetCharId as string]: {
              ...charInPlay,
              [slot]: [...charInPlay[slot], {
                instanceId: card.instanceId,
                definitionId: card.definitionId,
                status: CardStatus.Untapped,
              }],
            },
          },
        };
        break;
      }
    }
  } else {
    // General permanent event — just add to cardsInPlay. Site-targeting
    // permanent hazards carry their site binding through the chain
    // payload; record it on the CardInPlay entry so the
    // company-arrives-at-site event hook can match arrivals against
    // the bound site location.
    const targetSiteDefId = entry.payload.type === 'permanent-event'
      ? entry.payload.targetSiteDefinitionId
      : undefined;
    newPlayers[playerIndex] = {
      ...newPlayers[playerIndex],
      cardsInPlay: [...newPlayers[playerIndex].cardsInPlay, {
        instanceId: card.instanceId,
        definitionId: card.definitionId,
        status: CardStatus.Untapped,
        ...(targetSiteDefId ? { attachedToSite: targetSiteDefId } : {}),
      }],
    };
    if (targetSiteDefId) {
      logDetail(`"${def?.name ?? card.definitionId}" attached to site ${targetSiteDefId as string}`);
    }
  }

  // control-restriction: no-direct-influence — revert DI to GI on attach
  if (targetCharId && def && 'effects' in def && def.effects?.some(
    e => e.type === 'control-restriction' && e.rule === 'no-direct-influence',
  )) {
    for (let pi = 0; pi < 2; pi++) {
      const char = newPlayers[pi].characters[targetCharId as string];
      if (char && char.controlledBy !== 'general') {
        logDetail(`"${def.name}" forces ${targetCharId as string} from DI to GI`);
        const oldControllerId = char.controlledBy;
        const oldCtrl = newPlayers[pi].characters[oldControllerId as string];
        if (oldCtrl) {
          newPlayers[pi] = {
            ...newPlayers[pi],
            characters: {
              ...newPlayers[pi].characters,
              [targetCharId as string]: { ...char, controlledBy: 'general' },
              [oldControllerId as string]: {
                ...oldCtrl,
                followers: oldCtrl.followers.filter(id => id !== targetCharId),
              },
            },
          };
        }
        break;
      }
    }
  }

  let newState: GameState = { ...state, players: newPlayers };

  // Execute self-enters-play effects (e.g. move (filter-all → discard), add-constraint)
  if (def && 'effects' in def && def.effects) {
    for (const effect of def.effects) {
      if (effect.type !== 'on-event' || effect.event !== 'self-enters-play') continue;
      if (effect.apply.type === 'move') {
        logDetail(`"${def.name}" entered play — running move apply`);
        const moveEffect = effect.apply as unknown as import('../types/effects.js').MoveEffect;
        const ctx: import('./reducer-move.js').MoveContext = {
          sourceCardId: entry.card!.instanceId,
          sourcePlayerIndex: playerIndex,
        };
        const r = applyMove(newState, moveEffect, ctx);
        if ('error' in r) {
          logDetail(`move apply failed on self-enters-play: ${r.error}`);
        } else {
          newState = r.state;
        }
      } else if (effect.apply.type === 'add-constraint') {
        newState = applyAddConstraintFromOnEvent(newState, entry, effect, def?.name ?? '?');
      }
    }
  }

  return newState;
}

/**
 * Resolve an `on-event: self-enters-play` effect with `apply.type === 'add-constraint'`.
 *
 * Reads `effect.apply.constraint` (the constraint kind name) and
 * `effect.apply.scope` (the scope name) and adds the resulting
 * {@link ActiveConstraint} to the state. The target is derived from
 * `effect.target`:
 *  - `"target-company"` — the active company at the time the chain entry resolved.
 *  - `"scout-company"` — same (alias used by Stealth).
 *  - `"arriving-company"` — same (alias used by River's company-arrives-at-site path; for self-enters-play it falls back to the active company).
 *  - otherwise — bearer's company (only meaningful for character-targeted permanent events).
 */
function applyAddConstraintFromOnEvent(
  state: GameState,
  entry: ChainEntry,
  effect: import('../types/effects.js').OnEventEffect,
  cardName: string,
): GameState {
  const constraintKind = effect.apply.constraint;
  const scopeName = effect.apply.scope;
  if (!constraintKind || !scopeName) return state;

  // Pick a target company. For now we use the active company in the
  // current MH/Site sub-phase, which matches all four cards in the
  // pending-effects plan.
  let companyId: import('../types/common.js').CompanyId | null = null;
  const activePlayer = state.activePlayer;
  if (activePlayer !== null) {
    const activePlayerObj = state.players.find(p => p.id === activePlayer);
    if (activePlayerObj) {
      const ps = state.phaseState;
      let activeCompanyIndex = -1;
      if (ps.phase === 'movement-hazard') activeCompanyIndex = ps.activeCompanyIndex;
      else if (ps.phase === 'site') activeCompanyIndex = ps.activeCompanyIndex;
      if (activeCompanyIndex >= 0) {
        companyId = activePlayerObj.companies[activeCompanyIndex]?.id ?? null;
      }
    }
  }

  // Map the scope name to a ConstraintScope discriminant.
  let scope: import('../types/pending.js').ConstraintScope;
  switch (scopeName) {
    case 'company-site-phase':
      if (!companyId) { logDetail(`add-constraint(${constraintKind}): no active company — fizzle`); return state; }
      scope = { kind: 'company-site-phase', companyId };
      break;
    case 'company-mh-phase':
      if (!companyId) { logDetail(`add-constraint(${constraintKind}): no active company — fizzle`); return state; }
      scope = { kind: 'company-mh-phase', companyId };
      break;
    case 'turn':
      scope = { kind: 'turn' };
      break;
    case 'until-cleared':
      scope = { kind: 'until-cleared' };
      break;
    default:
      logDetail(`add-constraint(${constraintKind}): unknown scope "${scopeName}" — fizzle`);
      return state;
  }

  const kind = buildConstraintKind(state, effect, constraintKind);
  if (!kind) {
    logDetail(`add-constraint: unsupported constraint kind "${constraintKind}" — fizzle`);
    return state;
  }

  // For until-cleared scope, use player target (the effect applies
  // globally, not to a specific company that may later disband).
  let target: import('../types/pending.js').ActiveConstraint['target'];
  if (scopeName === 'until-cleared' && activePlayer !== null) {
    target = { kind: 'player', playerId: activePlayer };
  } else if (companyId) {
    target = { kind: 'company', companyId };
  } else {
    logDetail(`add-constraint(${constraintKind}): no target — fizzle`);
    return state;
  }

  logDetail(`"${cardName}" entered play — adding constraint ${constraintKind}, scope ${scopeName}`);
  return addConstraint(state, {
    source: entry.card!.instanceId,
    sourceDefinitionId: entry.card!.definitionId,
    scope,
    target,
    kind,
  });
}

/**
 * Resolves a long-event chain entry: moves the card from the chain
 * into the declaring player's `cardsInPlay`.
 */
function resolveLongEvent(state: GameState, entry: ChainEntry): GameState {
  const card = entry.card!;
  const def = state.cardPool[card.definitionId as string];
  const playerIndex = getPlayerIndex(state, entry.declaredBy);

  logDetail(`Long event resolves: "${def?.name ?? card.definitionId}" enters play for player ${entry.declaredBy as string}`);

  // Add card to cardsInPlay
  const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
  newPlayers[playerIndex] = {
    ...newPlayers[playerIndex],
    cardsInPlay: [...newPlayers[playerIndex].cardsInPlay, {
      instanceId: card.instanceId,
      definitionId: card.definitionId,
      status: CardStatus.Untapped,
    }],
  };

  return { ...state, players: newPlayers };
}

/**
 * Derives the list of creature races the defending company has already
 * faced this M/H sub-phase by looking up each hazard name in
 * `phaseState.hazardsEncountered` and extracting its race. Used by
 * creature self-effects (e.g. Orc-lieutenant +4 prowess if an Orc attack
 * was already faced).
 */
function deriveFacedRaces(state: GameState, hazardNames: readonly string[]): string[] {
  const races = new Set<string>();
  for (const name of hazardNames) {
    for (const def of Object.values(state.cardPool)) {
      if ((def as { cardType?: string }).cardType !== 'hazard-creature') continue;
      if ((def as { name?: string }).name !== name) continue;
      const race = (def as { race?: string }).race;
      if (race) races.add(race);
      break;
    }
  }
  return Array.from(races);
}

/**
 * Returns the `effects` array of the site that would be the venue for an
 * attack against the given company. Prefers the company's explicit
 * destination (M/H) or current site references, because the same site
 * name (e.g. "Moria") exists in both hero and minion card pools and a
 * name-based lookup is ambiguous. Used by the detainment helper to
 * consult `site-rule: attacks-not-detainment` (Moria etc.).
 */
function resolveDefendingSiteEffects(
  state: GameState,
  company: {
    currentSite?: { definitionId: import('../types/common.js').CardDefinitionId } | null,
    destinationSite?: { instanceId: import('../types/common.js').CardInstanceId } | null,
  },
): readonly import('../types/effects.js').CardEffect[] {
  let siteDefinitionId: import('../types/common.js').CardDefinitionId | null = null;
  if (company.destinationSite?.instanceId) {
    siteDefinitionId = resolveInstanceId(state, company.destinationSite.instanceId) ?? null;
  }
  if (!siteDefinitionId && company.currentSite) {
    siteDefinitionId = company.currentSite.definitionId;
  }
  if (!siteDefinitionId) return [];
  const siteDef = state.cardPool[siteDefinitionId as string] as { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined;
  return siteDef?.effects ?? [];
}

/**
 * Scan the defending player's characters (across all their companies) for
 * `on-event: creature-attack-begins` effects with `apply: offer-char-join-attack`.
 * Each match whose bearer is at a haven and whose company differs from the
 * attacked company becomes a {@link HavenJumpOffer} the player may accept
 * during the cancel-window. Used by Alatar — generalizable to any card that
 * lets a specific character jump from a haven into an attack.
 */
function collectHavenJumpOffers(
  state: GameState,
  defendingPlayer: PlayerState,
  attackedCompanyId: import('../types/common.js').CompanyId,
): HavenJumpOffer[] {
  const offers: HavenJumpOffer[] = [];
  for (const company of defendingPlayer.companies) {
    if (company.id === attackedCompanyId) continue;
    const siteDef = company.currentSite
      ? state.cardPool[company.currentSite.definitionId as string]
      : undefined;
    const atHaven = !!(siteDef && isSiteCard(siteDef) && siteDef.siteType === SiteType.Haven);
    if (!atHaven) continue;
    for (const charId of company.characters) {
      const charInPlay = defendingPlayer.characters[charId as string];
      if (!charInPlay) continue;
      const charDef = state.cardPool[charInPlay.definitionId as string];
      const effects = (charDef as { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined)?.effects ?? [];
      for (const effect of effects) {
        if (effect.type !== 'on-event') continue;
        const onEvent: OnEventEffect = effect;
        if (onEvent.event !== 'creature-attack-begins') continue;
        if (onEvent.apply.type !== 'offer-char-join-attack') continue;
        if (onEvent.when) {
          const ctx = {
            bearer: { atHaven: true, siteType: SiteType.Haven },
            attack: { attackedCompanyId: attackedCompanyId as string, bearerCompanyId: company.id as string },
          };
          if (!matchesCondition(onEvent.when, ctx)) continue;
        }
        const postAttackEffects: PostAttackEffect[] = [];
        const post = onEvent.apply.postAttack;
        if (post && (post.tapIfUntapped || post.corruptionCheck)) {
          postAttackEffects.push({
            targetCharacterId: charInPlay.instanceId,
            tapIfUntapped: post.tapIfUntapped,
            corruptionCheck: post.corruptionCheck,
          });
        }
        offers.push({
          characterId: charInPlay.instanceId,
          bearerPlayerId: defendingPlayer.id,
          originCompanyId: company.id,
          targetCompanyId: attackedCompanyId,
          discardOwnedAllies: !!onEvent.apply.discardOwnedAllies,
          forceStrike: !!onEvent.apply.forceStrike,
          postAttackEffects,
        });
        logDetail(`Haven-join offer: ${(charDef as { name?: string })?.name ?? charInPlay.definitionId as string} at haven may join attacked company`);
      }
    }
  }
  return offers;
}

/**
 * Creates a CombatState when a creature chain entry resolves.
 *
 * The creature card was already moved to the hazard player's discard pile
 * at play time. Combat will determine whether it moves to the defending
 * player's marshalling point pile (all strikes defeated) or stays in discard.
 */
function initiateCreatureCombat(state: GameState, entry: ChainEntry): GameState {
  const creatureDef = state.cardPool[entry.card?.definitionId as string] as CreatureCard | undefined;
  if (!creatureDef || creatureDef.cardType !== 'hazard-creature') {
    logDetail(`Creature resolution: definition not found or not a creature — fizzle`);
    return state;
  }

  // Determine defending company from phase state (M/H or Site phase)
  let activeCompanyIndex: number;
  if (state.phaseState.phase === 'movement-hazard') {
    activeCompanyIndex = state.phaseState.activeCompanyIndex;
  } else if (state.phaseState.phase === 'site') {
    activeCompanyIndex = state.phaseState.activeCompanyIndex;
  } else {
    logDetail(`Creature resolution: not in M/H or Site phase — fizzle`);
    return state;
  }
  const activePlayerIndex = state.players.findIndex(p => p.id === state.activePlayer);
  const resourcePlayer = state.players[activePlayerIndex];
  const company = resourcePlayer.companies[activeCompanyIndex];
  if (!company) {
    logDetail(`Creature resolution: no active company — fizzle`);
    return state;
  }

  const hazardPlayerId = state.players.find(p => p.id !== state.activePlayer)!.id;

  // Check for attacker-chooses-defenders combat rule (e.g. Cave-drake)
  const attackerChooses = creatureDef.effects?.some(
    e => e.type === 'combat-attacker-chooses-defenders',
  ) ?? false;
  if (attackerChooses) {
    logDetail('Creature has attacker-chooses-defenders — skipping defender assignment');
  }

  // Check for multi-attack combat rule (e.g. Assassin — three attacks of one strike each)
  const multiAttackEffect = creatureDef.effects?.find(
    e => e.type === 'combat-multi-attack',
  );
  const multiAttackCount = multiAttackEffect?.count ?? 1;

  // Check for one-strike-per-character combat rule (e.g. Wandering Eldar,
  // Watcher in the Water — "Each character in the company faces one strike").
  // When present, the creature's raw strikes value is ignored; total strikes
  // equals the defending company's character count.
  const oneStrikePerCharacter = creatureDef.effects?.some(
    e => e.type === 'combat-one-strike-per-character',
  ) ?? false;

  // Check for cancel-attack-by-tap combat rule (e.g. Assassin — tap to cancel attacks)
  const cancelByTapEffect = creatureDef.effects?.find(
    e => e.type === 'combat-cancel-attack-by-tap',
  );
  const cancelByTapMax = cancelByTapEffect?.maxCancels ?? 0;

  const attackSource = state.phaseState.phase === 'site'
    ? { type: 'on-guard-creature' as const, cardInstanceId: entry.card!.instanceId }
    : { type: 'creature' as const, instanceId: entry.card!.instanceId };

  const inPlayNames = buildInPlayNames(state);
  const creatureRace = creatureDef.race;
  const companyFacedRaces = state.phaseState.phase === 'movement-hazard'
    ? deriveFacedRaces(state, state.phaseState.hazardsEncountered)
    : [];
  const defenderAlignment = defenderAlignmentLabel(state.players[activePlayerIndex].alignment);
  const creatureSelf = creatureDef.effects?.length
    ? { effects: creatureDef.effects, companyFacedRaces, defenderAlignment }
    : undefined;
  const effectiveProwess = resolveAttackProwess(state, creatureDef.prowess, inPlayNames, creatureRace, false, creatureSelf);
  const effectiveStrikes = resolveAttackStrikes(state, creatureDef.strikes, inPlayNames, creatureRace);

  // Total strikes resolution. Precedence:
  //   1. combat-one-strike-per-character → strikes = company.characters.length
  //   2. combat-multi-attack             → strikes = count × effectiveStrikes
  //   3. default                         → strikes = effectiveStrikes
  let totalStrikes: number;
  if (oneStrikePerCharacter) {
    totalStrikes = company.characters.length;
    logDetail(`One strike per character: ${totalStrikes} character(s) in company → ${totalStrikes} total strikes`);
  } else {
    totalStrikes = effectiveStrikes * multiAttackCount;
    if (multiAttackCount > 1) {
      logDetail(`Multi-attack: ${multiAttackCount} attacks × ${effectiveStrikes} strike(s) = ${totalStrikes} total strikes`);
    }
  }

  const attackKeying = Array.from(new Set(
    creatureDef.keyedTo.flatMap(k => k.regionTypes ?? []),
  ));
  // Scan for on-event: creature-attack-begins → offer-char-join-attack
  // (e.g. Alatar). If any pending offers match, force a cancel-window so
  // the defender has an explicit opt-in before strike assignment begins.
  const havenJumpOffers = collectHavenJumpOffers(state, resourcePlayer, company.id);

  const combat: CombatState = {
    attackSource,
    companyId: company.id,
    defendingPlayerId: state.activePlayer!,
    attackingPlayerId: hazardPlayerId,
    strikesTotal: totalStrikes,
    strikeProwess: effectiveProwess,
    creatureBody: creatureDef.body,
    creatureRace,
    attackKeying: attackKeying.length > 0 ? attackKeying : undefined,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: (attackerChooses || havenJumpOffers.length > 0) ? 'cancel-window' : 'defender',
    bodyCheckTarget: null,
    havenJumpOffers: havenJumpOffers.length > 0 ? havenJumpOffers : undefined,
    attackerChoosesDefenders: attackerChooses ? true : undefined,
    detainment: isDetainmentAttack({
      attackEffects: creatureDef.effects,
      attackRace: creatureRace,
      attackKeyedTo: creatureDef.keyedTo,
      inPlayNames,
      defendingAlignment: state.players[activePlayerIndex].alignment,
      defendingSiteEffects: resolveDefendingSiteEffects(state, company),
    }),
    forceSingleTarget: multiAttackCount > 1 ? true : undefined,
    multiAttackCount: multiAttackCount > 1 ? multiAttackCount : undefined,
    cancelByTapRemaining: cancelByTapMax > 0 ? cancelByTapMax : undefined,
  };

  logDetail(`Creature combat initiated: ${creatureDef.name} (${creatureDef.strikes} strikes${effectiveStrikes !== creatureDef.strikes ? ` → ${effectiveStrikes}` : ''}, ${creatureDef.prowess} prowess${effectiveProwess !== creatureDef.prowess ? ` → ${effectiveProwess}` : ''}${effectiveStrikes !== creatureDef.strikes || effectiveProwess !== creatureDef.prowess ? ' after global effects' : ''}) vs company ${company.id as string}`);

  // Place the creature card in the hazard player's cardsInPlay during combat.
  // After combat, finalizeCombat moves it to discard or the defender's kill pile.
  const hazardIndex = state.players.findIndex(p => p.id === hazardPlayerId);
  const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
  newPlayers[hazardIndex] = {
    ...newPlayers[hazardIndex],
    cardsInPlay: [...newPlayers[hazardIndex].cardsInPlay, {
      instanceId: entry.card!.instanceId,
      definitionId: entry.card!.definitionId,
      status: CardStatus.Untapped,
    }],
  };

  return { ...state, players: newPlayers, combat };
}

/**
 * Resolves a single chain entry at the given index.
 *
 * Marks the entry as resolved and applies its effects. Short-events targeting
 * environments cancel and discard the target. Other entry types currently
 * resolve as no-ops (effects via DSL resolver to be added).
 */
function resolveEntry(state: GameState, entryIndex: number): ResolveResult {
  const chain = state.chain!;
  const entry = chain.entries[entryIndex];

  logDetail(`Resolving chain entry #${entryIndex}: ${entry.payload.type} by player ${entry.declaredBy as string}`);

  // TODO: check validity (CoE rule 681: conditions must still be legal)

  let current = state;

  // Apply card effects based on payload type
  if (entry.payload.type === 'short-event' && entry.payload.targetInstanceId) {
    current = resolveEnvironmentCancel(current, entry.payload.targetInstanceId, chain);
  }

  // Short events that carry an on-event company-arrives-at-site → add-
  // constraint effect (e.g. *River*) have the target company fully
  // determined at play time (the active M/H company). Fire the trigger
  // directly on resolution so the card can go to discard as a normal
  // short event — no deferred tracking needed.
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    current = applyShortEventArrivalTrigger(current, entry);
  }

  // Short events with fetch-to-deck effects (e.g. An Unexpected Outpost):
  // move the card from the declaring player's discard pile to cardsInPlay
  // and queue the pending effects so the player can pick cards to fetch.
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    current = queueFetchToDecEffects(current, entry);
  }

  // Short events that cancel the current attack (e.g. Concealment, Dark
  // Quarrels, Many Turns and Doublings, Vanishment): when the chain entry
  // resolves un-negated, fire each cancel-attack effect through the
  // shared apply dispatcher. The opponent had a chance to negate this
  // entry during chain declaration (e.g. via a hazard that cancels
  // attack cancels).
  if (entry.payload.type === 'short-event' && !entry.negated && entry.card) {
    const def = current.cardPool[entry.card.definitionId as string];
    if (def && 'effects' in def && def.effects) {
      const ctx = buildChainApplyContext(current, entry);
      for (const effect of def.effects) {
        if (effect.type !== 'cancel-attack') continue;
        logDetail(`Chain resolves cancel-attack from "${def.name}"`);
        const r = applyEffect(current, effect, ctx);
        if ('error' in r) {
          logDetail(`applyEffect cancel-attack failed: ${r.error}`);
          continue;
        }
        current = r.state;
      }
    }
  }

  // Faction-targeting short events (e.g. Muster Disperses): enqueue a
  // muster-roll pending resolution so the faction's owner rolls 2d6 +
  // unused GI vs 11. The entry stays resolved on the chain; the pending
  // resolution drives the actual roll + discard.
  if (entry.payload.type === 'short-event' && !entry.negated && entry.payload.targetFactionInstanceId) {
    const factionInstId = entry.payload.targetFactionInstanceId;
    const factionDefId = resolveInstanceId(current, factionInstId);
    if (factionDefId) {
      // Find the faction's owner
      let factionOwner: PlayerId | null = null;
      for (const p of current.players) {
        if (p.cardsInPlay.some(c => c.instanceId === factionInstId)) {
          factionOwner = p.id;
          break;
        }
      }
      if (factionOwner) {
        logDetail(`Enqueuing muster-roll pending resolution for faction ${factionDefId as string}`);
        current = enqueueResolution(current, {
          source: entry.card!.instanceId,
          actor: factionOwner,
          scope: { kind: 'phase', phase: Phase.MovementHazard },
          kind: {
            type: 'muster-roll',
            factionInstanceId: factionInstId,
            factionDefinitionId: factionDefId,
            factionOwner,
          },
        });
        return { state: current, needsInput: true };
      }
    }
  }

  // Call of Home: hazard short event targeting a character. Enqueue a
  // pending resolution so the character's player rolls 2d6. Like the
  // influence-attempt pattern, do NOT mark the entry resolved yet.
  if (entry.payload.type === 'short-event'
    && entry.payload.targetCharacterId
    && !entry.negated
    && entry.card) {
    const cardDef = current.cardPool[entry.card.definitionId as string];
    const cohEffect = cardDef && 'effects' in cardDef
      ? (cardDef.effects as import('../index.js').CardEffect[])?.find(
        (e): e is import('../index.js').CallOfHomeCheckEffect => e.type === 'call-of-home-check',
      )
      : undefined;
    if (cohEffect) {
      const resourcePlayerId = current.activePlayer!;
      logDetail(`Enqueuing call-of-home-roll pending resolution for character ${entry.payload.targetCharacterId as string}`);
      current = enqueueResolution(current, {
        source: entry.card.instanceId,
        actor: resourcePlayerId,
        scope: { kind: 'phase-step', phase: Phase.MovementHazard, step: 'play-hazards' },
        kind: {
          type: 'call-of-home-roll',
          targetCharacterId: entry.payload.targetCharacterId,
          hazardDefinitionId: entry.card.definitionId,
          threshold: cohEffect.threshold,
        },
      });
      return { state: current, needsInput: true };
    }
  }

  if (entry.payload.type === 'creature' && entry.card) {
    current = initiateCreatureCombat(current, entry);
  }

  if (entry.payload.type === 'permanent-event' && !entry.negated && entry.card) {
    current = resolvePermanentEvent(current, entry);
  }

  if (entry.payload.type === 'long-event' && !entry.negated && entry.card) {
    current = resolveLongEvent(current, entry);
  }

  // Influence attempt: enqueue a pending resolution so the UI can display
  // the situation banner (target number, DI, modifiers) before the roll.
  // Do NOT mark the entry resolved — leave it on the chain (card and all)
  // so `buildInstanceLookup` can still find the faction while the player
  // confirms the roll. The pending faction-influence-roll resolver will
  // mark the entry resolved and re-enter auto-resolution after the roll.
  if (entry.payload.type === 'influence-attempt' && !entry.negated && entry.card) {
    logDetail(`Enqueuing faction-influence-roll pending resolution for ${entry.card.definitionId as string}`);
    current = enqueueResolution(current, {
      source: entry.card.instanceId,
      actor: entry.declaredBy,
      scope: { kind: 'phase-step', phase: Phase.Site, step: 'play-resources' },
      kind: {
        type: 'faction-influence-roll',
        factionInstanceId: entry.card.instanceId,
        factionDefinitionId: entry.card.definitionId,
        influencingCharacterId: entry.payload.influencingCharacterId,
      },
    });
    return { state: current, needsInput: true };
  }

  // Mark entry as resolved
  const resolvedChain = current.chain!;
  const newEntries = resolvedChain.entries.map((e, i) =>
    i === entryIndex ? { ...e, resolved: true } : e,
  );

  // Scan for passive conditions triggered by this resolution
  const triggeredPassives = detectTriggeredPassives(current, entry);
  const newDeferredPassives = triggeredPassives.length > 0
    ? [...resolvedChain.deferredPassives, ...triggeredPassives]
    : resolvedChain.deferredPassives;

  if (triggeredPassives.length > 0) {
    logDetail(`${triggeredPassives.length} passive condition(s) triggered — deferred for follow-up chain`);
  }

  const newChain: ChainState = {
    ...resolvedChain,
    entries: newEntries,
    deferredPassives: newDeferredPassives,
  };

  return {
    state: { ...current, chain: newChain },
    needsInput: false,
  };
}

/**
 * Scans in-play cards for `on-event` effects triggered by the given
 * resolved entry. Triggered passives are queued for a follow-up chain
 * rather than added to the current chain (CoE rules 678-680).
 *
 * Currently matches on the `event` string of `on-event` effects against
 * the resolved entry's payload type. More sophisticated matching
 * (specific card targets, conditions) will be added as cards require it.
 */
function detectTriggeredPassives(state: GameState, resolvedEntry: ChainEntry): DeferredPassive[] {
  const passives: DeferredPassive[] = [];

  // Scan all in-play cards for on-event triggers
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const def = state.cardPool[card.definitionId as string];
      if (!def || !('effects' in def) || !def.effects) continue;

      for (const effect of def.effects) {
        if (effect.type !== 'on-event') continue;

        // Match the event trigger against what just resolved
        if (matchesTrigger(effect.event, resolvedEntry)) {
          logDetail(`Passive triggered: "${def.name}" on-event "${effect.event}"`);
          passives.push({
            sourceCardId: card.instanceId,
            trigger: effect.event,
            payload: { type: 'passive-condition', trigger: effect.event },
          });
        }
      }
    }
  }

  return passives;
}

/**
 * Checks whether a resolved chain entry matches an `on-event` trigger string.
 *
 * Current trigger matching is basic — it maps known trigger strings to
 * entry payload types. As more cards define triggers, this will be extended
 * to support conditions on specific targets, card types, etc.
 */
function matchesTrigger(event: string, _entry: ChainEntry): boolean {
  // Map well-known trigger events to entry conditions
  switch (event) {
    case 'character-wounded-by-self':
      // Fires when a creature's strike wounds a character — requires combat resolution
      // which is not yet on the chain, so this won't match during chain resolution yet
      return false;
    default:
      // Unknown trigger — no match
      return false;
  }
}

/**
 * Completes the current chain and cleans up.
 *
 * If deferred passives were queued during resolution, creates a follow-up
 * chain for them. If this was a nested chain (e.g. on-guard interrupt),
 * restores the parent chain. Otherwise sets `state.chain` to null.
 */
function completeChain(state: GameState): GameState {
  const chain = state.chain!;
  logHeading(`Chain complete — ${chain.entries.length} entries resolved`);

  // Flush negated entries: cards still on the chain go to their declaring player's discard
  let current = state;
  for (const entry of chain.entries) {
    if (entry.negated && entry.card) {
      const playerIndex = getPlayerIndex(current, entry.declaredBy);
      const player = current.players[playerIndex];
      const def = current.cardPool[entry.card.definitionId as string];
      logDetail(`Flushing negated card "${def?.name ?? entry.card.definitionId}" to player ${entry.declaredBy as string} discard`);
      const newPlayers: [PlayerState, PlayerState] = [current.players[0], current.players[1]];
      newPlayers[playerIndex] = {
        ...player,
        discardPile: [...player.discardPile, { instanceId: entry.card.instanceId, definitionId: entry.card.definitionId }],
      };
      current = { ...current, players: newPlayers };
    }
  }

  // If deferred passives were triggered, create a follow-up chain
  if (chain.deferredPassives.length > 0) {
    logDetail(`${chain.deferredPassives.length} deferred passive(s) — creating follow-up chain`);
    return createFollowUpChain(current, chain);
  }

  // Restore parent chain if this was a nested sub-chain
  if (chain.parentChain) {
    logDetail(`Restoring parent chain`);
    return { ...current, chain: chain.parentChain };
  }

  // Chain fully complete — clear it
  logDetail(`No parent chain — clearing chain state`);
  return { ...current, chain: null };
}

/**
 * Creates a follow-up chain from deferred passive conditions.
 *
 * When a single passive is deferred, it becomes the sole entry in the new chain.
 * When multiple passives are deferred, the resource player must choose the
 * declaration order (via the `order-passives` action) before the chain starts.
 * For now, if there's only one passive, it auto-declares; otherwise the chain
 * is created with all passives declared in the order they were queued.
 */
function createFollowUpChain(state: GameState, completedChain: ChainState): GameState {
  const passives = completedChain.deferredPassives;
  const parentChain = completedChain.parentChain;

  // Determine the resource player (active player initiates follow-up chains, CoE rule 673)
  const resourcePlayer = state.activePlayer!;

  // Create entries from deferred passives
  const entries: ChainEntry[] = passives.map((passive, index) => ({
    index,
    declaredBy: resourcePlayer,
    card: null, // Passive conditions don't move a card onto the chain — source card stays in play
    payload: passive.payload,
    resolved: false,
    negated: false,
  }));

  logDetail(`Follow-up chain with ${entries.length} passive condition(s)`);

  const followUpChain: ChainState = {
    mode: 'declaring',
    entries,
    priority: opponent(state, resourcePlayer),
    priorityPlayerPassed: false,
    nonPriorityPlayerPassed: false,
    deferredPassives: [],
    parentChain,
    restriction: 'normal',
  };

  return { ...state, chain: followUpChain };
}

/**
 * Creates a nested sub-chain that interrupts the current chain.
 *
 * Used for on-guard reveals (CoE rule 382) and body checks (CoE rule 455).
 * The current chain is saved as `parentChain` on the sub-chain. When the
 * sub-chain completes, the parent chain resumes via {@link completeChain}.
 *
 * @param state - Current game state (chain must be non-null).
 * @param declaredBy - The player initiating the sub-chain.
 * @param card - The card triggering the sub-chain, or null.
 * @param payload - What kind of sub-chain entry this is.
 * @param restriction - Sub-chain restriction mode.
 * @returns New game state with the sub-chain active and parent chain saved.
 */
export function interruptWithSubChain(
  state: GameState,
  declaredBy: PlayerId,
  card: CardInstance | null,
  payload: ChainEntryPayload,
  restriction: ChainRestriction = 'normal',
): GameState {
  logHeading(`Interrupting with sub-chain (${restriction})`);

  const entry: ChainEntry = {
    index: 0,
    declaredBy,
    card,
    payload,
    resolved: false,
    negated: false,
  };

  const subChain: ChainState = {
    mode: 'declaring',
    entries: [entry],
    priority: opponent(state, declaredBy),
    priorityPlayerPassed: false,
    nonPriorityPlayerPassed: false,
    deferredPassives: [],
    parentChain: state.chain,
    restriction,
  };

  logDetail(`Sub-chain created, parent chain saved. Priority to ${subChain.priority as string}`);

  return { ...state, chain: subChain };
}

/**
 * Scans for beginning-of-phase or end-of-phase passive conditions and
 * creates a restricted chain if any are found.
 *
 * Called by phase transition logic in the main reducer:
 * - **Beginning-of-phase**: after transitioning into a new phase, before
 *   any normal actions are allowed (CoE rule 684).
 * - **End-of-phase**: after both players pass in a phase, before advancing
 *   to the next phase (CoE rule 685).
 *
 * If no passives trigger, returns the state unchanged (chain stays null).
 *
 * @param state - Current game state (chain should be null).
 * @param boundary - Which boundary to scan for.
 * @param phase - The phase name to match against trigger events.
 * @returns State with a restricted chain if passives were found, or unchanged.
 */
export function scanPhaseBoundary(
  state: GameState,
  boundary: 'beginning-of-phase' | 'end-of-phase',
  phase: string,
): GameState {
  const triggerEvent = `${boundary}:${phase}`;
  logDetail(`Scanning for ${boundary} passives in phase "${phase}"`);

  const passives: DeferredPassive[] = [];

  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const def = state.cardPool[card.definitionId as string];
      if (!def || !('effects' in def) || !def.effects) continue;

      for (const effect of def.effects) {
        if (effect.type !== 'on-event') continue;
        if (effect.event === triggerEvent) {
          logDetail(`Phase boundary passive: "${def.name}" triggers on "${triggerEvent}"`);
          passives.push({
            sourceCardId: card.instanceId,
            trigger: effect.event,
            payload: { type: 'passive-condition', trigger: effect.event },
          });
        }
      }
    }
  }

  if (passives.length === 0) {
    logDetail(`No ${boundary} passives found`);
    return state;
  }

  logDetail(`${passives.length} ${boundary} passive(s) found — creating restricted chain`);

  const restriction: ChainRestriction = boundary;
  const resourcePlayer = state.activePlayer!;

  const entries: ChainEntry[] = passives.map((passive, index) => ({
    index,
    declaredBy: resourcePlayer,
    card: null, // Passive conditions don't move a card onto the chain
    payload: passive.payload,
    resolved: false,
    negated: false,
  }));

  const chain: ChainState = {
    mode: 'declaring',
    entries,
    priority: opponent(state, resourcePlayer),
    priorityPlayerPassed: false,
    nonPriorityPlayerPassed: false,
    deferredPassives: [],
    parentChain: null,
    restriction,
  };

  return { ...state, chain };
}

